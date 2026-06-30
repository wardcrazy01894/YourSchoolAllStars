import { describe, it, expect } from 'vitest'
import {
  MODES,
  DEFAULT_MODE,
  getMode,
  isGameMode,
  modesForSport,
  sportOffersMode,
  randomSeed,
} from './modes'

describe('MODES', () => {
  it('has unique ids', () => {
    const ids = MODES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks both daily flows (Daily Challenge + Daily IQ) as date-seeded one-shots', () => {
    // Two modes now lock + advance a streak: the classic Daily Challenge and the
    // stats-hidden Daily IQ. They share the day's eras (the seed ignores mode) but
    // each carries its OWN lock + streak (see progress.ts mode namespacing).
    expect(MODES.filter((m) => m.daily).map((m) => m.id)).toEqual([
      'daily',
      'daily-iq',
    ])
  })

  it('hides stats in the IQ modes (Daily IQ, Hoops IQ, Gridiron IQ)', () => {
    expect(MODES.filter((m) => m.hideStats).map((m) => m.id)).toEqual([
      'daily-iq',
      'hoops-iq',
      'gridiron-iq',
    ])
  })

  it('scopes each SPORT-FLAVOURED stats-hidden mode to exactly one sport', () => {
    // Hoops IQ / Gridiron IQ are sport-flavoured, so each must declare its one
    // sport. Daily IQ is a universal daily flow (omits `sports`) — so the scope
    // check is on the non-daily IQ modes only.
    for (const m of MODES.filter((x) => x.hideStats && !x.daily)) {
      expect(m.sports).toHaveLength(1)
    }
  })

  it('the CLASSIC Daily Challenge is never a stats-hidden mode', () => {
    // The headline Daily Challenge reveals stats during the draft (Daily IQ is the
    // hidden-stats sibling). Guard that the classic daily stays revealed so its
    // streak headline + reputation-free draft don't silently flip.
    expect(getMode('daily').hideStats).toBe(false)
  })

  it('Daily IQ is a universal daily flow with stats hidden', () => {
    const iq = getMode('daily-iq')
    expect(iq.id).toBe('daily-iq')
    expect(iq.daily).toBe(true)
    expect(iq.hideStats).toBe(true)
    expect(iq.sports).toBeUndefined() // universal — offered to every sport
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
    expect(isGameMode('daily-iq')).toBe(true)
    expect(isGameMode('hoops-iq')).toBe(true)
    expect(isGameMode('gridiron-iq')).toBe(true)
    expect(isGameMode('nope')).toBe(false)
    expect(isGameMode(null)).toBe(false)
  })
})

describe('modesForSport', () => {
  it('offers basketball Daily + Daily IQ + Classic + Hoops IQ (not Gridiron IQ)', () => {
    expect(modesForSport('basketball').map((m) => m.id)).toEqual([
      'daily',
      'daily-iq',
      'classic',
      'hoops-iq',
    ])
  })

  it('offers football Daily + Daily IQ + Classic + Gridiron IQ (not Hoops IQ)', () => {
    expect(modesForSport('football').map((m) => m.id)).toEqual([
      'daily',
      'daily-iq',
      'classic',
      'gridiron-iq',
    ])
  })

  it('always offers the universal modes (daily + daily-iq + classic) to both sports', () => {
    for (const sport of ['basketball', 'football'] as const) {
      const ids = modesForSport(sport).map((m) => m.id)
      expect(ids).toContain('daily')
      expect(ids).toContain('daily-iq')
      expect(ids).toContain('classic')
    }
  })
})

describe('sportOffersMode', () => {
  it('accepts a universal mode for any sport', () => {
    expect(sportOffersMode('basketball', 'daily')).toBe(true)
    expect(sportOffersMode('football', 'classic')).toBe(true)
    expect(sportOffersMode('basketball', 'daily-iq')).toBe(true)
    expect(sportOffersMode('football', 'daily-iq')).toBe(true)
  })

  it('rejects the other sport’s stats-hidden mode (URL-param cross-sport guard)', () => {
    // The bug this guards: ?sport=basketball&mode=gridiron-iq passes isGameMode
    // (it IS a real mode) but must NOT be honored for basketball, or the header
    // and share string mislabel the game with football’s mode.
    expect(sportOffersMode('basketball', 'gridiron-iq')).toBe(false)
    expect(sportOffersMode('football', 'hoops-iq')).toBe(false)
  })

  it('accepts each sport’s own stats-hidden mode', () => {
    expect(sportOffersMode('basketball', 'hoops-iq')).toBe(true)
    expect(sportOffersMode('football', 'gridiron-iq')).toBe(true)
  })

  it('rejects junk / missing ids', () => {
    expect(sportOffersMode('basketball', 'nope')).toBe(false)
    expect(sportOffersMode('football', null)).toBe(false)
    expect(sportOffersMode('basketball', undefined)).toBe(false)
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
