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
  const consecutive =
    prev.lastDate !== null && dayDiff(prev.lastDate, dateKey) === 1
  const current = consecutive ? prev.current + 1 : 1
  return { current, max: Math.max(prev.max, current), lastDate: dateKey }
}

/** A completed daily, persisted so the day can't be replayed and reloads restore it. */
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
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full / disabled — non-fatal */
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
  write(dailyKey(school, sport, result.dateKey), result)
  const prev = loadStreak(school, sport)
  if (already) return prev // don't double-count a re-save of the same day
  const updated = nextStreak(prev, result.dateKey)
  write(streakKey(school, sport), updated)
  return updated
}
