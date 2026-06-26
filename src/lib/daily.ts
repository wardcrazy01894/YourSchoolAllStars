// Deterministic daily spins.
//
// GOAL: everyone who loads the game on a given day sees the SAME sequence of
// spun windows, with NO backend. We hash the date string (in America/New_York —
// the originals roll over at "midnight ET") into a seed, drive a seeded PRNG,
// and pick one window per round. The reroll stream is a second deterministic
// pass salted off the same seed, so a reroll is also stable per day.
//
// Stability note: spins are a pure function of (dateKey, sport, window list). If
// the window list changes, past/future spins shift — fine for a friends game.

import type { YearWindow } from '../types'

export const BBALL_ROUNDS = 5

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

/** One window per round, picked from `windows` by the seeded PRNG. */
export function generateSpins(
  seed: number,
  rounds: number,
  windows: YearWindow[],
): YearWindow[] {
  const rng = mulberry32(seed)
  const out: YearWindow[] = []
  for (let i = 0; i < rounds; i++) {
    out.push(windows[Math.floor(rng() * windows.length)])
  }
  return out
}

/**
 * A deterministic alternate window per round for the single allowed reroll.
 * Salted off the seed and guaranteed to differ from the original spin for that
 * round (when more than one window exists).
 */
export function generateRerollSpins(
  seed: number,
  mains: YearWindow[],
  windows: YearWindow[],
): YearWindow[] {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0)
  return mains.map((main) => {
    if (windows.length <= 1) return main
    let pick = main
    let guard = 0
    while (pick.start === main.start && guard++ < 20) {
      pick = windows[Math.floor(rng() * windows.length)]
    }
    return pick
  })
}
