// Daily one-shot persistence + streaks. Pure logic (nextStreak, dayDiff) is
// unit-tested; the localStorage wrappers are thin and fail-safe. No backend —
// streaks are per-device, exactly like KnowYourCity. (A cross-player leaderboard
// would be the only thing needing a server.)

import type { BballPosition } from '../types'

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
 * it. NOTE: `playerIds` is keyed by `BballPosition` — when football lands its
 * positions differ, so this will need to generalize (a sport-tagged union or a
 * `Record<string, string>`) rather than be reused as-is.
 */
export interface SavedDaily {
  dateKey: string
  playerIds: Partial<Record<BballPosition, string>>
  wins: number
  grade: string
}

// ── localStorage wrappers (fail-safe) ────────────────────────────────────────
const ns = (school: string, sport: string) => `ysas:${school}:${sport}`
const streakKey = (school: string, sport: string) =>
  `${ns(school, sport)}:streak`
const dailyKey = (school: string, sport: string, dateKey: string) =>
  `${ns(school, sport)}:daily:${dateKey}`

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

export function loadStreak(school: string, sport: string): Streak {
  return read<Streak>(streakKey(school, sport), EMPTY_STREAK)
}

export function loadDaily(
  school: string,
  sport: string,
  dateKey: string,
): SavedDaily | null {
  return read<SavedDaily | null>(dailyKey(school, sport, dateKey), null)
}

/**
 * Persist a completed daily and advance the streak. Idempotent for a given day:
 * if today's result is already saved, the streak isn't bumped again. Returns the
 * (possibly unchanged) streak.
 */
export function saveDailyResult(
  school: string,
  sport: string,
  result: SavedDaily,
): Streak {
  const already = loadDaily(school, sport, result.dateKey)
  const saved = write(dailyKey(school, sport, result.dateKey), result)
  const prev = loadStreak(school, sport)
  // Don't advance the streak if (a) the day was already counted, or (b) the
  // daily didn't actually persist — otherwise a swallowed write would bump the
  // streak while leaving the day replayable, double-counting on the next play.
  if (already || !saved) return prev
  const updated = nextStreak(prev, result.dateKey)
  write(streakKey(school, sport), updated)
  return updated
}
