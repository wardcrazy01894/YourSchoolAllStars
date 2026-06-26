import { describe, it, expect } from 'vitest'
import {
  getDateKey,
  isValidDateKey,
  hashStringToSeed,
  mulberry32,
  seedFor,
  generateSpins,
  DAILY_BBALL_ERAS,
} from './daily'
import { BBALL_WINDOWS } from './windows'

describe('getDateKey', () => {
  it('formats in America/New_York', () => {
    // 2026-06-25 03:30 UTC is still 2026-06-24 in ET (EDT, UTC-4).
    expect(getDateKey(new Date('2026-06-25T03:30:00Z'))).toBe('2026-06-24')
    // 2026-06-25 12:00 UTC is 08:00 ET, same day.
    expect(getDateKey(new Date('2026-06-25T12:00:00Z'))).toBe('2026-06-25')
  })
})

describe('isValidDateKey', () => {
  it('accepts YYYY-MM-DD and rejects junk', () => {
    expect(isValidDateKey('2026-06-25')).toBe(true)
    expect(isValidDateKey('2026-6-25')).toBe(false)
    expect(isValidDateKey('nope')).toBe(false)
  })
})

describe('seeded PRNG', () => {
  it('hashStringToSeed is stable and unsigned', () => {
    const a = hashStringToSeed('basketball:2026-06-25')
    expect(a).toBe(hashStringToSeed('basketball:2026-06-25'))
    expect(a).toBeGreaterThanOrEqual(0)
  })
  it('mulberry32 is deterministic for a seed', () => {
    const r1 = mulberry32(123)
    const r2 = mulberry32(123)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('generateSpins', () => {
  it('is deterministic for a given (date, sport) and yields the daily era count', () => {
    const seed = seedFor('2026-06-25', 'basketball')
    const a = generateSpins(seed, DAILY_BBALL_ERAS, BBALL_WINDOWS)
    const b = generateSpins(seed, DAILY_BBALL_ERAS, BBALL_WINDOWS)
    expect(a).toEqual(b)
    expect(a).toHaveLength(6)
  })
  it('different days give different spin sequences (usually)', () => {
    const a = generateSpins(
      seedFor('2026-06-25', 'basketball'),
      5,
      BBALL_WINDOWS,
    )
    const b = generateSpins(
      seedFor('2026-06-26', 'basketball'),
      5,
      BBALL_WINDOWS,
    )
    expect(a).not.toEqual(b)
  })
  it('only returns windows from the provided list', () => {
    const spins = generateSpins(42, 20, BBALL_WINDOWS)
    for (const s of spins) expect(BBALL_WINDOWS).toContainEqual(s)
  })
  it('returns [] for an empty window list instead of undefined spins', () => {
    // Dead-era safety net: a data-less school yields no rolling windows
    // (datasetMaxYear → null → buildRollingWindows → []). Drawing from []
    // must NOT produce [undefined, …] (which would corrupt currentWindow and
    // the rating layer downstream) — an empty wheel means an empty sequence.
    const spins = generateSpins(seedFor('2026-06-26', 'basketball'), 6, [])
    expect(spins).toEqual([])
  })
})
