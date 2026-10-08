/**
 * Anonymous daily leaderboard + server-side streak — client side.
 *
 * On finishing a REAL, current-day play of a daily mode, the app submits the
 * projected-wins score to the leaderboard Worker (worker/leaderboard.mjs) and
 * shows "you placed Xth of Y today". No accounts, no names: identity is an
 * anonymous random UUID kept in localStorage (`ysas:clientId`) — the seam a
 * future login would link to.
 *
 * STREAKS: the submission carries the device's local streak as a `seed`. The
 * worker RECONCILES it with its stored row — both advanced to today, the better
 * one wins — and returns the result. So a streak earned before the worker
 * existed carries over, missed submits (offline / 503) can never cost a streak,
 * and a server-side repair wins over a locally-reset copy. We MIRROR the
 * returned streak into localStorage (progress.ts:writeStreak), so a repair
 * shows up on the device at the next play and Landing/Results keep reading the
 * local key as before.
 *
 * INTEGRITY: only official daily plays submit. Free-play modes and `?date=`
 * playtests never do (the `official` gate, computed by the caller as
 * `mode.daily && dateKey === getDateKey()`), and the worker independently
 * rejects unknown games and out-of-window dates.
 *
 * GRACEFUL: every failure path (endpoint unset, offline, non-official game, bad
 * response) resolves to `null` so Results simply omits the line — the
 * leaderboard can never block or break the game.
 */

import { writeStreak, type Streak } from './progress'
import type { GameMode } from './modes'

const CLIENT_ID_KEY = 'ysas:clientId'
const CACHE_PREFIX = 'ysas:lb:v1'

export interface Standing {
  /** 1-based competition rank (ties share a rank). */
  rank: number
  /** Total devices on this game's board today. */
  total: number
  /** The server-side streak after this submission, in client shape, when
   *  available. */
  streak?: Streak
}

/**
 * Only surface a "top X%" once the field is big enough for a percentile to mean
 * anything (below this, "3rd of 7" is clearer than "top 43%").
 */
export const PERCENTILE_MIN_TOTAL = 20

/** Random id used when crypto.randomUUID or storage is unavailable. */
function fallbackId(): string {
  return (
    'ysas-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  ).slice(0, 36)
}

/**
 * The stable anonymous device id, created once and reused. This is what a
 * future account would adopt/link, so it lives at a top-level key.
 */
export function getClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : fallbackId()
    localStorage.setItem(CLIENT_ID_KEY, id)
    return id
  } catch {
    // Storage blocked (private mode) — degrade to an ephemeral id.
    return fallbackId()
  }
}

/** English ordinal: 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** "Top X%" for a rank within a field — rank 1 of 100 → 1, clamped to ≥1. */
export function percentile(rank: number, total: number): number {
  if (total <= 0) return 100
  return Math.min(100, Math.max(1, Math.round((rank / total) * 100)))
}

/**
 * Human standing line for the Results screen. Pure. The standing is a snapshot
 * taken when the player finished (the cache never re-ranks), so a RETURNING
 * visit must not say "today" — by then hundreds more may have played.
 */
export function formatStanding(
  { rank, total }: Standing,
  returning = false,
): string {
  if (total <= 1)
    return returning
      ? 'You were the first to finish when you played'
      : 'You’re the first to finish today!'
  const when = returning ? 'when you finished' : 'today'
  const base = `You placed ${ordinal(rank)} of ${total.toLocaleString(
    'en-US',
  )} ${when}`
  return total >= PERCENTILE_MIN_TOTAL
    ? `${base} · top ${percentile(rank, total)}%`
    : base
}

const cacheKey = (
  school: string,
  sport: string,
  mode: GameMode,
  dateKey: string,
) => `${CACHE_PREFIX}:${school}:${sport}:${mode}:${dateKey}`

/** Read a previously-returned standing for this game + day, or null. */
export function readStanding(
  school: string,
  sport: string,
  mode: GameMode,
  dateKey: string,
): Standing | null {
  try {
    const raw = localStorage.getItem(cacheKey(school, sport, mode, dateKey))
    if (!raw) return null
    const s = JSON.parse(raw) as Standing
    return typeof s?.rank === 'number' && typeof s?.total === 'number'
      ? s
      : null
  } catch {
    return null
  }
}

function writeStanding(
  school: string,
  sport: string,
  mode: GameMode,
  dateKey: string,
  s: Standing,
): void {
  try {
    localStorage.setItem(
      cacheKey(school, sport, mode, dateKey),
      JSON.stringify(s),
    )
  } catch {
    /* best-effort */
  }
}

export interface SubmitArgs {
  school: string
  sport: string
  mode: GameMode
  dateKey: string
  /** Projected wins (0..40 basketball, 0..16 football). */
  score: number
  /** The device's local streak AFTER saveDailyResult — the worker reconciles
   *  its stored row against this (the better one wins). */
  seed: Streak
  /** True only for a real current-day play of a daily mode. */
  official: boolean
  /** Cloudflare Turnstile token, when the widget is enabled (optional). */
  turnstileToken?: string
}

/** The JSON body POSTed to the leaderboard endpoint. Pure + testable. */
export function buildSubmitPayload(args: SubmitArgs) {
  return {
    school: args.school,
    sport: args.sport,
    mode: args.mode,
    date: args.dateKey,
    score: args.score,
    clientId: getClientId(),
    seed: args.seed,
    ...(args.turnstileToken ? { turnstileToken: args.turnstileToken } : {}),
  }
}

/**
 * The worker's streak shape → the client's `Streak` (`best` → `max`). Only a
 * REAL streak qualifies for mirroring: a played day and a count ≥ 1. The
 * worker can't send an empty one today, but a future change must never be
 * able to overwrite a good local streak with nothing.
 */
function streakFromServer(s: unknown): Streak | undefined {
  const o = s as { current?: unknown; best?: unknown; lastDate?: unknown }
  if (
    o &&
    typeof o.current === 'number' &&
    o.current >= 1 &&
    typeof o.best === 'number' &&
    typeof o.lastDate === 'string'
  )
    return { current: o.current, max: o.best, lastDate: o.lastDate }
  return undefined
}

/**
 * Submit today's official score and resolve the player's standing — or `null`
 * when the leaderboard shouldn't/can't run. A cached standing short-circuits
 * the network so a reload doesn't re-POST; the Worker UPSERT is idempotent
 * (keep-max) so even a racing duplicate POST is harmless. When the server
 * returns a streak it is mirrored into localStorage before resolving.
 */
export async function submitDaily(args: SubmitArgs): Promise<Standing | null> {
  if (!args.official) return null
  const endpoint = import.meta.env.VITE_LEADERBOARD_ENDPOINT
  if (!endpoint) return null

  const { school, sport, mode, dateKey } = args
  const cached = readStanding(school, sport, mode, dateKey)
  if (cached) return cached

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSubmitPayload(args)),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.warn('leaderboard submit rejected', {
        status: r.status,
        game: `${school}:${sport}:${mode}`,
        body: body.slice(0, 200),
      })
      return null
    }
    const data = (await r.json().catch(() => null)) as Partial<Standing> | null
    if (typeof data?.rank !== 'number' || typeof data?.total !== 'number') {
      console.warn('leaderboard submit: unexpected response shape', { data })
      return null
    }
    const standing: Standing = { rank: data.rank, total: data.total }
    const streak = streakFromServer(data.streak)
    // Mirror only an answer at least as recent as the seed we just sent — a
    // stale one (dated before the day we just saved locally) is ignored.
    if (
      streak &&
      (args.seed.lastDate === null || streak.lastDate >= args.seed.lastDate)
    ) {
      standing.streak = streak
      writeStreak(school, sport, streak, mode)
    }
    writeStanding(school, sport, mode, dateKey, standing)
    return standing
  } catch (e) {
    console.warn('leaderboard submit failed (network)', { error: String(e) })
    return null
  }
}
