import { describe, it, expect } from 'vitest'
import {
  MODES,
  DEFAULT_MODE,
  getMode,
  isGameMode,
  modesForSport,
  randomSeed,
} from './modes'

describe('MODES', () => {
  it('has unique ids', () => {
    const ids = MODES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks exactly one mode as the daily (one-shot + streak) flow', () => {
    expect(MODES.filter((m) => m.daily)).toHaveLength(1)
    expect(MODES.find((m) => m.daily)?.id).toBe('daily')
  })

  it('hides stats only in the IQ modes (Hoops IQ + Gridiron IQ)', () => {
    expect(MODES.filter((m) => m.hideStats).map((m) => m.id)).toEqual([
      'hoops-iq',
      'gridiron-iq',
    ])
  })

  it('scopes each stats-hidden mode to exactly one sport', () => {
    // Hoops IQ / Gridiron IQ are sport-flavoured, so each must declare its one
    // sport (the universal modes — daily, classic — omit `sports`).
    for (const m of MODES.filter((x) => x.hideStats)) {
      expect(m.sports).toHaveLength(1)
    }
  })

  it('the daily mode is never a stats-hidden mode', () => {
    // A locked daily result is shared with colored squares; hiding stats there
    // would be incoherent. Guard the combination explicitly.
    for (const m of MODES) if (m.daily) expect(m.hideStats).toBe(false)
  })

  it('every mode carries display copy', () => {
    for (const m of MODES) {
      expect(m.name.length).toBeGreaterThan(0)
      expect(m.blurb.length).toBeGreaterThan(0)
      expect(m.emoji.length).toBeGreaterThan(0)
    }
  })
})

describe('getMode', () => {
  it('resolves a known mode id', () => {
    expect(getMode('classic').id).toBe('classic')
    expect(getMode('hoops-iq').id).toBe('hoops-iq')
  })
  it('falls back to daily for an unknown / missing id', () => {
    expect(getMode('nonsense').id).toBe(DEFAULT_MODE)
    expect(getMode(null).id).toBe(DEFAULT_MODE)
    expect(getMode(undefined).id).toBe(DEFAULT_MODE)
  })
})

describe('isGameMode', () => {
  it('accepts real modes and rejects junk', () => {
    expect(isGameMode('daily')).toBe(true)
    expect(isGameMode('hoops-iq')).toBe(true)
    expect(isGameMode('gridiron-iq')).toBe(true)
    expect(isGameMode('nope')).toBe(false)
    expect(isGameMode(null)).toBe(false)
  })
})

describe('modesForSport', () => {
  it('offers basketball Daily + Classic + Hoops IQ (not Gridiron IQ)', () => {
    expect(modesForSport('basketball').map((m) => m.id)).toEqual([
      'daily',
      'classic',
      'hoops-iq',
    ])
  })

  it('offers football Daily + Classic + Gridiron IQ (not Hoops IQ)', () => {
    expect(modesForSport('football').map((m) => m.id)).toEqual([
      'daily',
      'classic',
      'gridiron-iq',
    ])
  })

  it('always offers the universal modes (daily + classic) to both sports', () => {
    for (const sport of ['basketball', 'football'] as const) {
      const ids = modesForSport(sport).map((m) => m.id)
      expect(ids).toContain('daily')
      expect(ids).toContain('classic')
    }
  })
})

describe('randomSeed', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSeed()
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0xffffffff)
    }
  })
  it('varies across calls (not a constant)', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()))
    expect(seeds.size).toBeGreaterThan(1)
  })
})
