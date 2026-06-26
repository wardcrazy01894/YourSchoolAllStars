import { describe, it, expect } from 'vitest'
import {
  statComposite,
  honorsBonus,
  playerRating,
  teamStrength,
  winProbability,
  projectedWins,
  recordLabel,
  gradeLabel,
} from './rating'
import type { BballPlayer, BballPosition } from '../types'

function mk(
  position: BballPosition,
  stats: BballPlayer['stats'],
  honors: string[] = [],
): BballPlayer {
  return {
    id: 'x',
    name: 'x',
    position,
    firstYear: 2010,
    lastYear: 2013,
    bestSeason: 2013,
    stats,
    honors,
    source: 'test',
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
