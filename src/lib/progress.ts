// Daily one-shot persistence + streaks. Pure logic (nextStreak, dayDiff) is
// unit-tested; the localStorage wrappers are thin and fail-safe. The device's
// localStorage is the working copy; the leaderboard worker mirrors the streak
// (leaderboard.ts) and, for a signed-in account, keeps every device in step
// (sync.ts).

import type { YearWindow } from '../types'
import { isGameMode, type GameMode } from './modes'

export interface Streak {
  current: number
  max: number
  /** dateKey of the last completed daily, or null if never played. */
  lastDate: string | null
}

export const EMPTY_STREAK: Streak = { current: 0, max: 0, lastDate: null }

/**
 * Days (ET dateKeys) on which the site was unreachable, so NOBODY could play the
 * daily. A gap made up solely of these days doesn't break a streak, and each is
 * credited as played — the player did everything they could. Keep this list
 * short and dated; it's an append-only record of real outages.
 *
 * - 2026-10-07: GitHub Pages offline all day (hosting account suspended).
 */
export const OUTAGE_DAYS: readonly string[] = ['2026-10-07']

/** Whole-day difference between two 'YYYY-MM-DD' keys (b − a). */
export function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** The 'YYYY-MM-DD' key `n` days after `dateKey`. */
function addDays(dateKey: string, n: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/**
 * True when every one of the `diff - 1` days strictly after `from` (and before
 * the day being played) is a listed outage day, i.e. the gap consists only of
 * days nobody could have played.
 */
export function gapIsAllOutage(from: string, diff: number): boolean {
  for (let n = 1; n < diff; n++) {
    if (!OUTAGE_DAYS.includes(addDays(from, n))) return false
  }
  return true
}

/**
 * Whether a finished daily for `dateKey` is an OFFICIAL play (advances the
 * streak + submits to the leaderboard) when it ends on `todayKey`. A puzzle
 * started on its own day still counts if it ends after midnight ET (the
 * worker's ±1-day window exists for exactly this case); one left open 2+ days,
 * a future date, or a `?date=` playtest of a past day does not.
 */
export function isOfficialPlay(
  dateKey: string,
  todayKey: string,
  playtest: boolean,
): boolean {
  const diff = dayDiff(dateKey, todayKey)
  return diff === 0 || (diff === 1 && !playtest)
}

/**
 * Advance a streak when a daily is completed on `dateKey`. Same-day replays don't
 * double-count; a gap of more than one day resets to 1 — unless every skipped
 * day was a site outage (`OUTAGE_DAYS`), in which case the streak continues and
 * the outage days are credited too.
 */
export function nextStreak(prev: Streak, dateKey: string): Streak {
  if (prev.lastDate === dateKey) return prev // already counted today
  const diff = prev.lastDate === null ? null : dayDiff(prev.lastDate, dateKey)
  // A date BEFORE the last completed day (e.g. opening an old `?date=` playtest
  // URL) must leave the streak untouched — rolling `lastDate` backwards would
  // make every later real day read as a gap and silently break the count. The
  // daily itself is still persisted by saveDailyResult; only the streak is held.
  if (diff !== null && diff < 0) return prev
  // diff is null (first play) or ≥ 1 here: 0 was the same-day short-circuit.
  const continues =
    prev.lastDate !== null &&
    diff !== null &&
    (diff === 1 || gapIsAllOutage(prev.lastDate, diff))
  // `diff` counts the outage days plus today, so a forgiven gap credits each.
  const current = continues ? prev.current + diff : 1
  return { current, max: Math.max(prev.max, current), lastDate: dateKey }
}

/**
 * What the UI should SHOW for a stored streak on `todayKey`. Storage only
 * changes on a play, so a streak abandoned weeks ago still holds its old
 * `current`; nothing lowers it until the next play resets it to 1. For display,
 * a streak is alive only if it can still be continued today — last play today
 * or yesterday, or separated only by outage days — otherwise it reads 0 (best
 * kept). Pure; never written back (the stored value is what the next play and
 * the server seed reason from).
 */
export function displayStreak(s: Streak, todayKey: string): Streak {
  if (s.lastDate === null || s.current === 0) return s
  const diff = dayDiff(s.lastDate, todayKey)
  if (diff <= 1 || gapIsAllOutage(s.lastDate, diff)) return s
  return { ...s, current: 0 }
}

/**
 * A completed daily, persisted so the day can't be replayed and reloads restore
 * it. Sport-agnostic by key: `playerIds`/`windows` are keyed by a SLOT string —
 * basketball uses its `BballPosition` ids (`PG`/`SG`/…), football uses its
 * `FB_SLOTS` ids (`QB`/`FLEX1`/`DFLEX`/…). Each sport's (de)serializer owns the
 * key vocabulary; this layer just stores opaque string→value maps so one daily
 * lock + streak path serves both games.
 */
export interface SavedDaily {
  dateKey: string
  playerIds: Record<string, string>
  /**
   * The era each slot was drafted from, so a returning player's LOCKED result
   * re-rates on the same in-window season they earned (rating depends on the
   * window). Optional + sport-agnostic (just year ranges): a save missing it
   * still records the streak; the locked view just can't reconstruct the lineup.
   */
  windows?: Record<string, YearWindow>
  wins: number
  grade: string
  /**
   * Rounded team strength (0..100, the "overall") at the time of play — what
   * the leaderboard ranks by. Optional: saves from before it existed lack it.
   */
  strength?: number
}

// ── localStorage wrappers (fail-safe) ────────────────────────────────────────
// The key namespace is mode-aware but LEGACY-COMPATIBLE: the classic Daily
// (`mode` omitted or `'daily'`) keeps the original `ysas:{school}:{sport}` keys
// so existing streaks survive untouched. Any OTHER daily mode (e.g. `daily-iq`)
// gets its own `ysas:{school}:{sport}:{mode}` namespace — its own lock + streak —
// so a player can complete both Daily and Daily IQ each day independently. Only
// daily modes ever reach these wrappers (classic/IQ free-play never lock).
const ns = (school: string, sport: string, mode?: GameMode) =>
  !mode || mode === 'daily'
    ? `ysas:${school}:${sport}`
    : `ysas:${school}:${sport}:${mode}`
const streakKey = (school: string, sport: string, mode?: GameMode) =>
  `${ns(school, sport, mode)}:streak`
const dailyKey = (
  school: string,
  sport: string,
  dateKey: string,
  mode?: GameMode,
) => `${ns(school, sport, mode)}:daily:${dateKey}`

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    // v1 trusts the stored shape (one schema version). If SavedDaily/Streak ever
    // gain/drop fields, add a runtime validation step here before the cast —
    // a stale object would otherwise surface `undefined` at a consumer.
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Returns whether the value was actually persisted (false if storage threw). */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    // Non-fatal (storage full / disabled) — the caller decides — but a save
    // that silently didn't happen means a streak that silently didn't advance.
    console.warn('progress: localStorage write failed', {
      key,
      error: String(e),
    })
    return false
  }
}

export function loadStreak(
  school: string,
  sport: string,
  mode?: GameMode,
): Streak {
  return read<Streak>(streakKey(school, sport, mode), EMPTY_STREAK)
}

/**
 * Persist a streak verbatim — used to MIRROR the server-authoritative streak
 * returned by the leaderboard worker (src/lib/leaderboard.ts) so the device's
 * local copy (what Landing + Results read) matches the record. Returns whether
 * the write persisted.
 */
export function writeStreak(
  school: string,
  sport: string,
  streak: Streak,
  mode?: GameMode,
): boolean {
  return write(streakKey(school, sport, mode), streak)
}

export function loadDaily(
  school: string,
  sport: string,
  dateKey: string,
  mode?: GameMode,
): SavedDaily | null {
  return read<SavedDaily | null>(dailyKey(school, sport, dateKey, mode), null)
}

/**
 * Persist a completed daily and (by default) advance the streak. Idempotent for
 * a given day: if today's result is already saved, the streak isn't bumped again.
 * Returns the (possibly unchanged) streak.
 *
 * `advanceStreak: false` saves + LOCKS the day but leaves the streak untouched —
 * used for `?date=` playtest days, which aren't real daily play and must never
 * contaminate the streak (e.g. testing an OLD day shouldn't reset it, nor should
 * a FUTURE day inflate it). The daily is still persisted so the playtest day
 * locks like a real one.
 *
 * `mode` selects the namespace: omitted/`'daily'` uses the legacy keys (the
 * classic Daily Challenge), any other daily mode (`daily-iq`) gets its own lock +
 * streak — so completing one leaves the other free for the same day.
 */
export function saveDailyResult(
  school: string,
  sport: string,
  result: SavedDaily,
  opts: { advanceStreak?: boolean; mode?: GameMode } = {},
): Streak {
  const { advanceStreak = true, mode } = opts
  const already = loadDaily(school, sport, result.dateKey, mode)
  const saved = write(dailyKey(school, sport, result.dateKey, mode), result)
  const prev = loadStreak(school, sport, mode)
  // Don't advance the streak if (a) streak advancement is opted out (playtest
  // day), (b) the day was already counted, or (c) the daily didn't actually
  // persist — otherwise a swallowed write would bump the streak while leaving the
  // day replayable, double-counting on the next play.
  if (!advanceStreak || already || !saved) return prev
  const updated = nextStreak(prev, result.dateKey)
  write(streakKey(school, sport, mode), updated)
  return updated
}

// ── Every game at once (accounts: src/lib/sync.ts) ───────────────────────────

/** One daily game: the (school, sport, mode) triple that owns a lock + streak. */
export interface GameRef {
  school: string
  sport: string
  mode: GameMode
}

/** `school:sport:mode` — a stable id for a game (React keys, change lists). */
export const gameId = (g: GameRef) => `${g.school}:${g.sport}:${g.mode}`

// The two key shapes `ns` produces: legacy (classic Daily, no mode segment) and
// mode-qualified. School ids are slugs, sport ids are words.
const GAME_KEY_RE =
  /^ysas:([a-z0-9-]+):([a-z]+)(?::([a-z-]+))?:(streak|daily:(\d{4}-\d{2}-\d{2}))$/
const OWNER_KEY = 'ysas:owner'
const STANDING_PREFIX = 'ysas:lb:v1:'

interface GameKey extends GameRef {
  key: string
  /** Set for a saved daily; undefined for a streak key. */
  dateKey?: string
}

/** Every progress key in storage, parsed. Fail-safe: [] when storage throws. */
function gameKeys(): GameKey[] {
  const out: GameKey[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const m = key?.match(GAME_KEY_RE)
      if (!key || !m) continue
      const mode = m[3] ?? 'daily'
      if (!isGameMode(mode)) continue
      out.push({ key, school: m[1], sport: m[2], mode, dateKey: m[5] })
    }
  } catch {
    // Storage blocked — nothing to list.
  }
  return out
}

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/** Every game this device holds a real streak for (a played day, count ≥ 1). */
export function listStreaks(): (GameRef & { streak: Streak })[] {
  const out: (GameRef & { streak: Streak })[] = []
  for (const { school, sport, mode, dateKey } of gameKeys()) {
    if (dateKey) continue
    const s = loadStreak(school, sport, mode) as Partial<Streak> | null
    if (
      s &&
      isCount(s.current) &&
      s.current >= 1 &&
      isCount(s.max) &&
      typeof s.lastDate === 'string'
    )
      out.push({
        school,
        sport,
        mode,
        streak: {
          current: s.current,
          max: Math.max(s.max, s.current),
          lastDate: s.lastDate,
        },
      })
  }
  return out
}

/** Every game with a daily saved on this device for `dateKey`. */
export function listDailies(
  dateKey: string,
): (GameRef & { saved: SavedDaily })[] {
  const out: (GameRef & { saved: SavedDaily })[] = []
  for (const k of gameKeys()) {
    if (k.dateKey !== dateKey) continue
    const saved = loadDaily(k.school, k.sport, dateKey, k.mode)
    if (saved)
      out.push({ school: k.school, sport: k.sport, mode: k.mode, saved })
  }
  return out
}

/** The account (username) this device's progress was last synced to. */
export function loadOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export function saveOwner(username: string): void {
  try {
    localStorage.setItem(OWNER_KEY, username)
  } catch {
    // Best-effort: without it a shared device just skips the foreign-save check.
  }
}

/**
 * Sign-out: this device goes back to a fresh anonymous player. Every streak,
 * every saved daily and every cached standing here is the ACCOUNT's (it was
 * synced there first — sync.ts), so leaving them would hand them to whoever
 * uses the device next, and their next sign-in would claim them for a
 * different account. The chosen school and the anonymous device id stay.
 */
export function resetProgressForSignOut(): void {
  try {
    const doomed = gameKeys().map((k) => k.key)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STANDING_PREFIX)) doomed.push(key)
    }
    doomed.push(OWNER_KEY)
    for (const key of doomed) localStorage.removeItem(key)
  } catch (e) {
    console.warn('progress: sign-out reset failed', { error: String(e) })
  }
}
