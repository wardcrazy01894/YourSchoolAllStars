/**
 * Cloudflare Worker: anonymous daily leaderboard + per-player streaks for
 * YourSchoolAllStars.
 *
 * Stores one score per (school, sport, mode, date, device) in D1 and answers
 * "you placed Xth of Y today"; keeps a per-(game, device) streak in its own
 * table so a long streak outlives the daily rows and can be repaired server-side.
 * No accounts, no names, no PII — just an anonymous device UUID. The schema
 * reserves a `user_id` column so accounts can be layered on later.
 *
 * Pure helpers + constants live in leaderboard-lib.mjs — NOT here — because the
 * Workers runtime rejects non-function named exports on the *entry* module. This
 * file therefore exports only `default`.
 *
 * SECURITY: this is a public, unauthenticated endpoint. The abuse surface is
 * *leaderboard inflation* — stuffing junk rows to distort the "of Y" denominator.
 * Mitigations:
 *   - fail CLOSED unless a rate limiter OR Turnstile is configured;
 *   - per-IP rate limit (native binding, KV fallback) caps a single source's
 *     write rate;
 *   - the server RE-derives the ET date and rejects anything outside a ±1-day
 *     window, and rejects unknown schools/sports/modes — so you can't seed
 *     arbitrary past/future days or junk games;
 *   - score must be an integer in [0, that sport's max].
 * Turnstile is plumbed through (verified when TURNSTILE_SECRET is set) but is
 * OPTIONAL: the client submits automatically at the end of a daily with no
 * widget, so requiring a token would need an invisible-widget execute. Scores
 * are client-computed, so a determined actor can still POST a fake number;
 * anti-cheat is a non-goal for an anonymous board — the rate limit bounds it.
 *
 * Bindings / vars (worker/wrangler.toml):
 *   DB               (D1 database) the scores + streaks tables
 *   ALLOWED_ORIGIN   comma-separated origin allowlist; "*" disables the check
 *                    (dev only)
 *   RATE_LIMITER     (native rate-limit binding) preferred per-IP limiter
 *   RL               (optional KV namespace) per-IP limiter fallback
 *   TURNSTILE_SECRET (optional secret) when set, a valid token is required
 */

import {
  validateSubmission,
  upsertAndRank,
  validateView,
  topScores,
  cutoffDateKey,
  pruneOldScores,
  updateStreak,
} from './leaderboard-lib.mjs'

const MAX_BODY_BYTES = 4_000
// KV-fallback rate limit, kept in step with the native [[ratelimits]] binding.
const RL_MAX = 30
const RL_WINDOW_SECONDS = 60

/** ALLOWED_ORIGIN may be "*" or a comma-separated list of origins. */
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
function originAllowed(env, origin) {
  const list = allowedOrigins(env)
  return list.includes('*') || (origin && list.includes(origin))
}
function cors(env, origin) {
  const list = allowedOrigins(env)
  // Reflect the request origin when it's allowed (can't use "*" + a specific
  // list); fall back to the first configured origin.
  const allow = list.includes('*')
    ? '*'
    : origin && list.includes(origin)
      ? origin
      : list[0] || '*'
  return {
    'Access-Control-Allow-Origin': allow,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

async function verifyTurnstile(token, secret, ip) {
  if (!token) return { ok: false, errors: ['missing-token'] }
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const r = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    )
    const data = await r.json()
    return {
      ok: Boolean(data.success),
      // Why siteverify said no — tells a misconfigured key
      // (invalid-input-secret) apart from a real bot (invalid-input-response).
      errors: data['error-codes'] ?? [],
    }
  } catch (e) {
    // A siteverify NETWORK failure looks identical to a bot rejection (both
    // return false → 403). Log it distinctly so "every legit user is blocked"
    // is diagnosable from an unreachable-siteverify outage.
    console.warn('leaderboard turnstile siteverify network error', {
      error: String(e),
    })
    return { ok: false, errors: ['siteverify-unreachable'] }
  }
}

/** The (school, sport, mode) triple as one log-friendly string. Also used on
 *  UNVALIDATED input, so each part is stringified and length-capped. */
const gameTag = (v) =>
  [v?.school, v?.sport, v?.mode]
    .map((x) => String(x ?? '').slice(0, 32))
    .join(':')

/**
 * Refuse a request AND log why. Every non-2xx answer goes through here so a
 * contract drift (a client sending something the worker now rejects), a
 * misconfigured Turnstile key, or an abuse burst shows up in `wrangler tail`
 * with its status, reason and context — not only in players' browser consoles.
 */
function reject(status, error, headers, context = {}) {
  console.warn('leaderboard rejected', { status, error, ...context })
  return json({ error }, status, headers)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const headers = cors(env, origin)
    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (request.method !== 'POST' && request.method !== 'GET')
      return reject(405, 'method not allowed', headers, {
        method: request.method,
      })

    // Fail CLOSED: refuse to operate without at least one anti-abuse control.
    if (!env.RATE_LIMITER && !env.RL && !env.TURNSTILE_SECRET) {
      console.error(
        'leaderboard fails closed: no rate limit or Turnstile configured',
      )
      return json(
        { error: 'leaderboard disabled: configure a rate limit or Turnstile' },
        503,
        headers,
      )
    }

    // Server-side Origin allowlist (CORS headers alone don't stop curl).
    if (origin && !originAllowed(env, origin))
      return reject(403, 'forbidden origin', headers, {
        origin: String(origin).slice(0, 200),
      })

    if (!env.DB) {
      console.error('leaderboard unavailable: no D1 binding (env.DB)')
      return json({ error: 'leaderboard unavailable' }, 503, headers)
    }

    const len = parseInt(request.headers.get('Content-Length') || '0', 10)
    if (len > MAX_BODY_BYTES)
      return reject(413, 'payload too large', headers, { bytes: len })

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

    // Per-IP rate limit (native binding preferred, KV counter fallback).
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip })
      if (!success) return reject(429, 'rate limited, try later', headers)
    } else if (env.RL) {
      const key = `rl:${ip}`
      const n = parseInt((await env.RL.get(key)) || '0', 10)
      if (n >= RL_MAX) return reject(429, 'rate limited, try later', headers)
      await env.RL.put(key, String(n + 1), { expirationTtl: RL_WINDOW_SECONDS })
    }

    // GET — view the day's leaderboard (read-only, anonymous: scores only).
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams
      const vv = validateView({
        school: q.get('school'),
        sport: q.get('sport'),
        mode: q.get('mode'),
        date: q.get('date'),
      })
      if (!vv.ok)
        return reject(vv.status, vv.error, headers, {
          method: 'GET',
          game: gameTag({
            school: q.get('school'),
            sport: q.get('sport'),
            mode: q.get('mode'),
          }),
          date: String(q.get('date') ?? '').slice(0, 32),
        })
      try {
        const board = await topScores(env.DB, vv.value)
        return json({ ok: true, ...board }, 200, headers)
      } catch (e) {
        console.error('leaderboard read failed', {
          game: gameTag(vv.value),
          date: vv.value.date,
          error: String(e),
        })
        return json({ error: 'leaderboard unavailable' }, 503, headers)
      }
    }

    let body
    try {
      const raw = await request.text()
      const bytes = new TextEncoder().encode(raw).byteLength
      if (bytes > MAX_BODY_BYTES)
        return reject(413, 'payload too large', headers, { bytes })
      body = JSON.parse(raw)
    } catch {
      return reject(400, 'invalid json', headers)
    }
    // Context for any rejection below (raw, capped — it isn't validated yet).
    const subject = () => ({
      game: gameTag(body),
      date: String(body?.date ?? '').slice(0, 32),
    })

    // Bot check (only when Turnstile is configured for this worker).
    if (env.TURNSTILE_SECRET) {
      const ts = await verifyTurnstile(
        body?.turnstileToken,
        env.TURNSTILE_SECRET,
        ip,
      )
      if (!ts.ok)
        return reject(403, 'verification failed', headers, {
          ...subject(),
          turnstileErrors: ts.errors,
        })
    }

    const v = validateSubmission(body, new Date())
    if (!v.ok) return reject(v.status, v.error, headers, subject())

    try {
      const now = Date.now()
      const standing = await upsertAndRank(env.DB, v.value, now)
      // Advance the per-player streak. Best-effort: a streak failure must not
      // fail the score submission, so it's caught independently.
      let streak
      try {
        streak = await updateStreak(env.DB, v.value, now)
      } catch (e) {
        // Best-effort, but a PERSISTENT streak failure (e.g. a missing
        // migration) would silently strip everyone's streak — make it visible.
        console.warn('leaderboard streak update failed', {
          game: gameTag(v.value),
          error: String(e),
        })
        streak = undefined
      }
      return json({ ok: true, ...standing, streak }, 200, headers)
    } catch (e) {
      // D1 outage / quota exhaustion — degrade gracefully; the client just
      // omits the leaderboard line. Never 500 on the player. Log it so a
      // failing submit has a server-side trace.
      console.error('leaderboard submit failed', {
        game: gameTag(v.value),
        error: String(e),
      })
      return json({ error: 'leaderboard unavailable' }, 503, headers)
    }
  },

  /**
   * Cron Trigger (see [triggers] in wrangler.toml): prune daily scores older
   * than RETENTION_DAYS so the table stays bounded forever. Best effort — a
   * failure just retries next run; it never affects the live game. Streaks are
   * NOT pruned.
   */
  async scheduled(_event, env, ctx) {
    if (!env.DB) return
    ctx.waitUntil(
      pruneOldScores(env.DB, cutoffDateKey(new Date())).catch((e) =>
        // A failure just retries next run, but a PERMANENT one (table grows
        // unbounded) must not be invisible.
        console.error('leaderboard prune failed', { error: String(e) }),
      ),
    )
  },
}
