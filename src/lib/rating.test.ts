import { describe, it, expect } from 'vitest'
import {
  statComposite,
  honorsBonus,
  playerRating,
  bestSeason,
  bestSeasonInWindow,
  seasonForWindow,
  teamStrength,
  winProbability,
  projectedWins,
  recordLabel,
  gradeLabel,
} from './rating'
import type {
  BballPlayer,
  BballPosition,
  BballSeason,
  BballSeasonStats,
} from '../types'

/** A single-season player (the common case in the migrated dataset). */
function mk(
  position: BballPosition,
  stats: BballSeasonStats,
  honors: string[] = [],
  year = 2013,
): BballPlayer {
  return {
    id: 'x',
    name: 'x',
    position,
    firstYear: 2010,
    lastYear: 2013,
    seasons: [{ year, stats, honors, source: 'test' }],
  }
}

/** A multi-season player. */
function mkSeasons(
  position: BballPosition,
  seasons: BballSeason[],
): BballPlayer {
  const years = seasons.map((s) => s.year)
  return {
    id: 'x',
    name: 'x',
    position,
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
    seasons,
  }
}

describe('statComposite', () => {
  it('weights steals/blocks above points', () => {
    const pts = statComposite({ pts: 1, reb: 0, ast: 0, stl: 0, blk: 0 })
    const stl = statComposite({ pts: 0, reb: 0, ast: 0, stl: 1, blk: 0 })
    expect(stl).toBeGreaterThan(pts)
    expect(stl).toBe(3)
  })
})

describe('honorsBonus', () => {
  it('takes the best tier per honor, then sums across honors', () => {
    expect(honorsBonus(['Consensus All-American (2013)'])).toBe(9)
    expect(honorsBonus(['Wooden Award', 'Big Ten Player of the Year'])).toBe(16)
    expect(honorsBonus([])).toBe(0)
  })
  it('credits the REAL hyphenated dataset formats (regression for the silent-miss bug)', () => {
    // These are the exact shapes in michigan-basketball.json; the old
    // adjacent-substring matcher scored them too low.
    expect(honorsBonus(['Consensus Second-Team All-American (2021)'])).toBe(9)
    expect(honorsBonus(['AP Third-Team All-American (1994)'])).toBe(6) // not consensus
    expect(honorsBonus(['First-Team All-Big Ten (2006)'])).toBe(4)
    expect(honorsBonus(['All-Big Ten'])).toBe(3)
    expect(honorsBonus(['Big Ten Freshman of the Year (2003)'])).toBe(3)
    expect(honorsBonus(['National Player of the Year (2013)'])).toBe(12)
  })
  it('does not double-count overlapping substrings within one honor', () => {
    // "Consensus All-American" contains "all-american" too — count 9, not 15.
    expect(honorsBonus(['Consensus All-American'])).toBe(9)
  })
})

describe('playerRating', () => {
  it('is in [0,100] and monotonic in production', () => {
    const weak = playerRating(
      mk('SG', { pts: 3, reb: 1, ast: 0.5, stl: 0.2, blk: 0.1 }),
    )
    const star = playerRating(
      mk('SG', { pts: 20, reb: 6, ast: 4, stl: 1.5, blk: 0.5 }),
    )
    expect(weak).toBeGreaterThanOrEqual(0)
    expect(star).toBeLessThanOrEqual(100)
    expect(star).toBeGreaterThan(weak)
  })
  it('honors raise the rating', () => {
    const base = mk('PF', { pts: 18, reb: 8, ast: 2, stl: 1, blk: 1 })
    const withHonor = mk('PF', { pts: 18, reb: 8, ast: 2, stl: 1, blk: 1 }, [
      'Consensus All-American',
    ])
    expect(playerRating(withHonor)).toBeGreaterThan(playerRating(base))
  })
})

describe('partial stat lines', () => {
  it('treats a missing field as 0 (no NaN)', () => {
    // Only points published — the rest are unknown, not zero-by-fiat, but the
    // composite must degrade gracefully to a finite number.
    expect(statComposite({ pts: 10 })).toBe(10)
    expect(statComposite({})).toBe(0)
    const r = playerRating(mk('SG', { pts: 12 }))
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeGreaterThan(0)
  })
})

describe('best season within a window', () => {
  const player = mkSeasons('SF', [
    { year: 2010, stats: { pts: 8 }, honors: [], source: 't' },
    { year: 2013, stats: { pts: 20 }, honors: [], source: 't' }, // career peak
    { year: 2016, stats: { pts: 14 }, honors: [], source: 't' },
  ])

  it('bestSeason is the career peak', () => {
    expect(bestSeason(player)?.year).toBe(2013)
  })

  it('bestSeasonInWindow only considers in-window seasons', () => {
    // 2014–2017 window may NOT credit the 2013 peak — only the 2016 line.
    expect(bestSeasonInWindow(player, { start: 2014, end: 2017 })?.year).toBe(
      2016,
    )
    // 2009–2012 window only sees 2010.
    expect(bestSeasonInWindow(player, { start: 2009, end: 2012 })?.year).toBe(
      2010,
    )
    // A window with no season row → null.
    expect(bestSeasonInWindow(player, { start: 2017, end: 2020 })).toBe(null)
  })

  it('playerRating(window) rates the in-window best, not the career peak', () => {
    const peak = playerRating(player, { start: 2012, end: 2015 }) // sees 2013
    const lull = playerRating(player, { start: 2014, end: 2017 }) // sees 2016
    expect(peak).toBeGreaterThan(lull)
  })

  it('seasonForWindow falls back to career-best when no row is in-window', () => {
    // Transitional: a single-best-season player still appears (by tenure) in a
    // window their one row falls outside of — they get their best line, not 0.
    const single = mk('PG', { pts: 18, reb: 4, ast: 6 }, [], 2013)
    expect(seasonForWindow(single, { start: 2010, end: 2011 })?.year).toBe(2013)
    expect(playerRating(single, { start: 2010, end: 2011 })).toBe(
      playerRating(single),
    )
  })
})

describe('teamStrength weak-link penalty', () => {
  it('a single bad starter drags the team below the plain mean', () => {
    const balanced = [
      { position: 'PG' as const, rating: 80 },
      { position: 'SG' as const, rating: 80 },
      { position: 'SF' as const, rating: 80 },
      { position: 'PF' as const, rating: 80 },
      { position: 'C' as const, rating: 80 },
    ]
    const hole = [
      { position: 'PG' as const, rating: 90 },
      { position: 'SG' as const, rating: 90 },
      { position: 'SF' as const, rating: 90 },
      { position: 'PF' as const, rating: 90 },
      { position: 'C' as const, rating: 30 }, // weak link
    ]
    expect(teamStrength(balanced)).toBeCloseTo(80, 5)
    // Mean of `hole` (weighted) is ~78 but the min=30 should pull it well down.
    expect(teamStrength(hole)).toBeLessThan(70)
  })
  it('PG carries more weight than a wing', () => {
    const pgStar = teamStrength([
      { position: 'PG', rating: 90 },
      { position: 'SG', rating: 60 },
    ])
    const sgStar = teamStrength([
      { position: 'PG', rating: 60 },
      { position: 'SG', rating: 90 },
    ])
    expect(pgStar).toBeGreaterThan(sgStar)
  })
})

describe('projected record', () => {
  it('winProbability is 0.5 at the pivot and monotonic', () => {
    expect(winProbability(60)).toBeCloseTo(0.5, 5)
    expect(winProbability(90)).toBeGreaterThan(winProbability(70))
  })
  it('an elite balanced five approaches a perfect 40-0', () => {
    const elite = (['PG', 'SG', 'SF', 'PF', 'C'] as BballPosition[]).map(
      (position) => ({
        position,
        rating: 97,
      }),
    )
    expect(projectedWins(elite, 40)).toBeGreaterThanOrEqual(38)
  })
  it('recordLabel and gradeLabel', () => {
    expect(recordLabel(40, 40)).toBe('40–0')
    expect(recordLabel(34, 40)).toBe('34–6')
    expect(gradeLabel(40, 40)).toBe('PERFECT')
    expect(gradeLabel(20, 40)).toBe('BUBBLE')
  })
})
