/**
 * Cloudflare Worker: daily leaderboard + per-player streaks + optional
 * accounts for YourSchoolAllStars.
 *
 * Stores one score per (school, sport, mode, date, player) in D1 and answers
 * "you placed Xth of Y today"; keeps a per-(game, player) streak in its own
 * table so a long streak outlives the daily rows and can be repaired server-side.
 * A player is an anonymous device UUID or, when signed in, an account
 * (username + password + display name — no email, no other PII; see
 * accounts-lib.mjs).
 *
 * Routes (the LAST path segment decides, so a route prefix is fine):
 *   GET  ?school=&sport=&mode=&date=          → { total, rows[{strength, score, name}] }
 *   POST (any other path) { school, sport, mode, date, score, strength,
 *                           clientId, seed?, detail?, token? }
 *                                             → { rank, total, streak? }
 *   POST /register { username, pass, name?, clientId? } → { token, username, name }
 *   POST /login    { username, pass, clientId? }        → { token, username, name }
 *   POST /logout   { token }                            → {}
 *   POST /me       { token, streaks? } → { username, name, streaks[], days[] }
 *   POST /name     { token, name }                      → { username, name }
 *   POST /password { token, pass, newPass }             → { username, name }
 * A token never travels in a URL.
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
 *   LOGIN_LIMITER    (native rate-limit binding) the tight limiter on
 *                    /register (per IP), /login and /password (per IP +
 *                    username); those routes fail closed without it
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
  pruneIfDue,
  updateStreak,
} from './leaderboard-lib.mjs'
import {
  accountKey,
  accountForToken,
  isValidPass,
  validateName,
  validateUsername,
  validateClaims,
  createAccount,
  verifyLogin,
  openSession,
  closeSession,
  renameAccount,
  changeAccountPassword,
  foldIntoAccount,
  readProgress,
} from './accounts-lib.mjs'

// Room for a 12-man draft on a submit and a streak claim per game on /me.
const MAX_BODY_BYTES = 8_000
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

const ACCOUNT_ROUTES = new Set([
  'register',
  'login',
  'logout',
  'me',
  'name',
  'password',
])

/**
 * The account routes. Returns `[body, status]`. Throws on a D1 error (the
 * caller answers 503).
 */
async function accountRoute(route, body, env, ip, now) {
  const db = env.DB
  const signedIn = (account, token) => ({
    ok: true,
    ...(token ? { token } : {}),
    username: account.username,
    name: account.name,
  })

  if (route === 'register' || route === 'login') {
    const u = validateUsername(body.username)
    const passOk = isValidPass(body.pass)
    if (route === 'login' && (!u.ok || !passOk))
      return [{ error: 'wrong username or password' }, 401]
    if (!u.ok) return [{ error: u.error }, u.status]
    if (!passOk) return [{ error: 'invalid password' }, 400]
    let name = ''
    if (route === 'register' && body.name != null && body.name !== '') {
      const n = validateName(body.name)
      if (!n.ok) return [{ error: n.error }, n.status]
      name = n.value
    }
    // Password guessing is the one attack here with a real payoff, and every
    // registration is a row someone has to look at: both sit behind a much
    // tighter limiter than the rest, and fail closed without it.
    if (!env.LOGIN_LIMITER) return [{ error: 'accounts disabled' }, 503]
    const gate = await env.LOGIN_LIMITER.limit({
      key: route === 'login' ? `${ip}|${u.value}` : `${ip}|register`,
    })
    if (!gate.success)
      return [{ error: 'too many attempts, try again in a minute' }, 429]

    const r =
      route === 'register'
        ? await createAccount(
            db,
            { username: u.value, name, pass: body.pass },
            now.getTime(),
          )
        : await verifyLogin(db, u.value, body.pass)
    if (!r.ok) return [{ error: r.error }, r.status]
    // What this device did before signing in becomes the account's. Best
    // effort: a failure here must not leave a freshly created account
    // without a session (a retry would then say "username taken"), and the
    // fold is idempotent — the next sign-in from this device redoes it.
    try {
      await foldIntoAccount(
        db,
        r.value.id,
        { clientId: body.clientId },
        now.getTime(),
      )
    } catch (e) {
      console.warn('leaderboard account fold failed', {
        route,
        error: String(e),
      })
    }
    const token = await openSession(db, r.value.id, now.getTime())
    return [signedIn(r.value, token), 200]
  }

  if (route === 'logout') {
    await closeSession(db, body.token)
    return [{ ok: true }, 200]
  }

  const account = await accountForToken(db, body.token)
  // 401 = "this device is no longer signed in" (signed out, or its session
  // pushed out by the account's ten newest); the client drops the token and
  // carries on anonymously. Sessions do not otherwise expire: there is no
  // self-service password reset, so an expiry would lock people out.
  if (!account) return [{ error: 'signed out' }, 401]

  if (route === 'name') {
    const n = validateName(body.name)
    if (!n.ok) return [{ error: n.error }, n.status]
    await renameAccount(db, account.id, n.value)
    return [signedIn({ ...account, name: n.value }), 200]
  }

  if (route === 'password') {
    // Change the password from a signed-in device. The CURRENT password is
    // still required (a borrowed, unlocked phone must not be enough to take
    // the account), behind the same tight limiter as login.
    if (!isValidPass(body.newPass)) return [{ error: 'invalid password' }, 400]
    if (!env.LOGIN_LIMITER) return [{ error: 'accounts disabled' }, 503]
    const gate = await env.LOGIN_LIMITER.limit({
      key: `${ip}|${account.username}`,
    })
    if (!gate.success)
      return [{ error: 'too many attempts, try again in a minute' }, 429]
    const current = isValidPass(body.pass)
      ? await verifyLogin(db, account.username, body.pass)
      : { ok: false }
    if (!current.ok) return [{ error: 'wrong password' }, 401]
    // Whoever else was signed in with the old password is signed out.
    await changeAccountPassword(db, account.id, body.newPass, body.token)
    return [signedIn(account), 200]
  }

  // route === 'me': fold the device's local streaks in, then say what the
  // account has (src/lib/sync.ts applies it).
  const claims = validateClaims(body.streaks, now)
  if (claims.length > 0)
    await foldIntoAccount(db, account.id, { claims }, now.getTime())
  const progress = await readProgress(db, account.id, now)
  return [{ ...signedIn(account), ...progress }, 200]
}

export default {
  async fetch(request, env, ctx) {
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

    // GET — view the day's leaderboard (read-only: numbers + display names).
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

    const route = new URL(request.url).pathname
      .replace(/\/+$/, '')
      .split('/')
      .pop()
    if (ACCOUNT_ROUTES.has(route)) {
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return reject(400, 'invalid json', headers, { route })
      try {
        const [out, status] = await accountRoute(
          route,
          body,
          env,
          ip,
          new Date(),
        )
        // Refusals are logged like every other one — never the body, which
        // holds a password key or a session token.
        if (status >= 400)
          console.warn('leaderboard rejected', {
            status,
            error: out.error,
            route,
          })
        return json(out, status, headers)
      } catch (e) {
        console.error('leaderboard account request failed', {
          route,
          error: String(e),
        })
        return json({ error: 'accounts unavailable' }, 503, headers)
      }
    }

    const v = validateSubmission(body, new Date())
    if (!v.ok) return reject(v.status, v.error, headers, subject())

    try {
      const now = Date.now()
      // Signed in → the score is the ACCOUNT's (one row across its devices).
      // A token that no longer resolves is not an error: the day still counts
      // for the anonymous device, and the next sign-in folds it in.
      const account = body?.token
        ? await accountForToken(env.DB, body.token)
        : null
      if (account) v.value.clientId = accountKey(account.id)
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
      // Lazy retention prune (at most once per UTC day; see pruneIfDue). Runs
      // after the response is built and never affects it.
      ctx?.waitUntil?.(
        pruneIfDue(env.DB, new Date()).catch((e) =>
          console.error('leaderboard lazy prune failed', { error: String(e) }),
        ),
      )
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
   * Cron Trigger handler, kept for the day a cron is wanted again — the
   * account's Workers Free plan allows 5 per account and they were all taken,
   * so [triggers] is NOT in the toml today. Retention is covered by the lazy
   * prune in `fetch` (pruneIfDue). Best effort either way.
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
