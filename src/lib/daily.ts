// Deterministic daily spins.
//
// GOAL: everyone who loads the game on a given day sees the SAME fixed sequence
// of era windows, with NO backend. We hash the date string (in America/New_York
// — the originals roll over at "midnight ET") into a seed, drive a seeded PRNG,
// and draw the day's era sequence (6 for basketball: 5 starters + 1 skip). The
// sequence is fixed up front, so a player's result never depends on when they skip.
//
// Stability note: spins are a pure function of (dateKey, sport, window list). If
// the window list changes, past/future spins shift — fine for a friends game.

import type { YearWindow } from '../types'

/** Basketball starters to draft (PG/SG/SF/PF/C). */
export const BBALL_STARTERS = 5
/** Daily basketball era sequence: starters + 1 skip = 6 fixed windows. */
export const DAILY_BBALL_ERAS = BBALL_STARTERS + 1

const GAME_TIMEZONE = 'America/New_York'

/** 'YYYY-MM-DD' for the given instant in the game's timezone (midnight ET roll). */
export function getDateKey(
  date: Date = new Date(),
  timeZone = GAME_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isValidDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(key))
}

/** FNV-1a-ish string hash → unsigned 32-bit seed. */
export function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 PRNG — small, fast, deterministic. Returns a () => [0,1) fn. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The deterministic seed for a (date, sport) puzzle. */
export function seedFor(dateKey: string, sport: string): number {
  return hashStringToSeed(`${sport}:${dateKey}`)
}

/**
 * The fixed era SEQUENCE for a game: `count` windows drawn from `windows` by the
 * seeded PRNG. The daily uses count = slots + 1 (6 for basketball) so the player
 * gets one skip; everyone on a given ET day gets the same sequence. Because the
 * sequence is fixed up front, a player's result never depends on WHEN they skip.
 */
export function generateSpins(
  seed: number,
  count: number,
  windows: YearWindow[],
): YearWindow[] {
  // Dead-era safety net: an empty wheel (a data-less school → no rolling windows)
  // has nothing to draw. Returning early avoids `windows[Math.floor(rng()*0)]`,
  // which is `windows[0]` = undefined — a sequence of holes that would corrupt
  // currentWindow and the rating layer. An empty wheel ⇒ an empty sequence.
  if (windows.length === 0) return []
  const rng = mulberry32(seed)
  const out: YearWindow[] = []
  for (let i = 0; i < count; i++) {
    out.push(windows[Math.floor(rng() * windows.length)])
  }
  return out
}
