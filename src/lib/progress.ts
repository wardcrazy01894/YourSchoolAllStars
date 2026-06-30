// Daily one-shot persistence + streaks. Pure logic (nextStreak, dayDiff) is
// unit-tested; the localStorage wrappers are thin and fail-safe. No backend —
// streaks are per-device, exactly like KnowYourCity. (A cross-player leaderboard
// would be the only thing needing a server.)

import type { YearWindow } from '../types'
import type { GameMode } from './modes'

export interface Streak {
  current: number
  max: number
  /** dateKey of the last completed daily, or null if never played. */
  lastDate: string | null
}

export const EMPTY_STREAK: Streak = { current: 0, max: 0, lastDate: null }

/** Whole-day difference between two 'YYYY-MM-DD' keys (b − a). */
export function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * Advance a streak when a daily is completed on `dateKey`. Same-day replays don't
 * double-count; a gap of more than one day resets to 1.
 */
export function nextStreak(prev: Streak, dateKey: string): Streak {
  if (prev.lastDate === dateKey) return prev // already counted today
  const diff = prev.lastDate === null ? null : dayDiff(prev.lastDate, dateKey)
  // A date BEFORE the last completed day (e.g. opening an old `?date=` playtest
  // URL) must leave the streak untouched — rolling `lastDate` backwards would
  // make every later real day read as a gap and silently break the count. The
  // daily itself is still persisted by saveDailyResult; only the streak is held.
  if (diff !== null && diff < 0) return prev
  const current = diff === 1 ? prev.current + 1 : 1
  return { current, max: Math.max(prev.max, current), lastDate: dateKey }
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
  } catch {
    return false // storage full / disabled — non-fatal, caller decides
  }
}

export function loadStreak(
  school: string,
  sport: string,
  mode?: GameMode,
): Streak {
  return read<Streak>(streakKey(school, sport, mode), EMPTY_STREAK)
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
