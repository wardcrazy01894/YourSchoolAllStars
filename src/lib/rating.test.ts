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
  UNDEFEATED_STRENGTH,
  WINLESS_STRENGTH,
  WIN_PIVOT,
  WEAK_LINK_BLEND,
  NON_POWER5_RATING_FACTOR,
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
  it('credits sub-first-team and rookie/tournament honors (awards-rethink, 2026-06-27)', () => {
    // The award-first ledger surfaces honors the old tiers scored as 0: lower
    // all-conference teams, honorable mention, all-freshman, rookie of the year,
    // and the Final Four Most Outstanding Player. They should all carry weight,
    // ordered below the first-team/POY tiers.
    expect(honorsBonus(['Second-Team All-ACC (2012)'])).toBe(3)
    expect(honorsBonus(['Third-Team All-ACC (2009)'])).toBe(2)
    expect(honorsBonus(['All-ACC Honorable Mention (2005)'])).toBe(1)
    expect(honorsBonus(['ACC All-Freshman Team (2005)'])).toBe(2)
    expect(honorsBonus(['ACC Rookie of the Year (2005)'])).toBe(3)
    expect(honorsBonus(['ACC Defensive Player of the Year (2011)'])).toBe(6)
    expect(honorsBonus(['First-Team All-ACC (2008)'])).toBe(4)
    expect(honorsBonus(['NCAA Final Four Most Outstanding Player (2005)'])).toBe(
      5,
    )
    // A bare all-conference nod with no stated team level still scores (the
    // generic league-token catch), at the first-team-adjacent default of 3.
    expect(honorsBonus(['All-ACC (1999)'])).toBe(3)
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

describe('conference strength (non-power-5 penalty)', () => {
  // 17 ppg in the Big Ten is worth more than 17 ppg in the A-10. Non-power-5
  // schools take a flat haircut on the FINAL player rating (Alex, 2026-06-26).
  const line = { pts: 17, reb: 6, ast: 3, stl: 1, blk: 0.5 }

  it('the penalty is a slight (<1) multiplier, not a flat subtraction', () => {
    expect(NON_POWER5_RATING_FACTOR).toBeGreaterThan(0)
    expect(NON_POWER5_RATING_FACTOR).toBeLessThan(1)
  })

  it('power5 (default true) is unchanged; non-power-5 is scaled down', () => {
    const p = mk('SG', line)
    const big10 = playerRating(p) // defaults to power-5
    const a10 = playerRating(p, undefined, false)
    expect(playerRating(p, undefined, true)).toBe(big10) // explicit true == default
    expect(a10).toBeLessThan(big10)
    expect(a10).toBe(Math.round(big10 * NON_POWER5_RATING_FACTOR))
  })

  it('applies the penalty to the in-window rating too (window + power5 thread together)', () => {
    const player = mkSeasons('SF', [
      { year: 2013, stats: line, honors: [], source: 't' },
    ])
    const w = { start: 2012, end: 2015 }
    expect(playerRating(player, w, false)).toBe(
      Math.round(playerRating(player, w, true) * NON_POWER5_RATING_FACTOR),
    )
  })

  it('stays in [0,100] and a 0-rated (no-season) player stays 0', () => {
    const elite = mk('C', { pts: 28, reb: 14, ast: 4, stl: 2, blk: 4 }, [
      'National Player of the Year',
    ])
    const r = playerRating(elite, undefined, false)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(100)
    const empty: BballPlayer = {
      id: 'x',
      name: 'x',
      position: 'PG',
      firstYear: 2010,
      lastYear: 2010,
      seasons: [],
    }
    expect(playerRating(empty, undefined, false)).toBe(0)
  })

  it('makes a non-power-5 40-0 hard: a near-elite five drops below the 85 cutoff', () => {
    // A five whose power-5 rating sits at the undefeated cutoff (85) no longer
    // runs the table once the conference haircut applies — exactly the intent
    // ("might make it impossible for a VCU team to go 40-0, and that's OK").
    const penalized = Math.round(85 * NON_POWER5_RATING_FACTOR)
    expect(penalized).toBeLessThan(UNDEFEATED_STRENGTH)
    const fivePenalized = (
      ['PG', 'SG', 'SF', 'PF', 'C'] as BballPosition[]
    ).map((position) => ({ position, rating: penalized }))
    expect(projectedWins(fivePenalized, 40)).toBeLessThan(40)
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
  it('weighs the worst starter at exactly WEAK_LINK_BLEND (0.25)', () => {
    // Two equal-weight wings (both ×1.0): mean 60, min 30. teamStrength is
    // (1-blend)·mean + blend·min, so this pins the blend exactly — a regression
    // to the old 0.4 would read 48, not 52.5. (Alex eased 0.4→0.25, 2026-06-26.)
    const pair = [
      { position: 'SG' as const, rating: 90 },
      { position: 'SF' as const, rating: 30 },
    ]
    expect(WEAK_LINK_BLEND).toBe(0.25)
    expect(teamStrength(pair)).toBeCloseTo(0.75 * 60 + 0.25 * 30, 5) // 52.5
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
    expect(winProbability(WIN_PIVOT)).toBeCloseTo(0.5, 5)
    expect(winProbability(90)).toBeGreaterThan(winProbability(70))
  })
  // A balanced five of equal ratings R has teamStrength === R (mean === min === R),
  // so `five(R)` lets us anchor record expectations directly to an overall.
  const five = (rating: number) =>
    (['PG', 'SG', 'SF', 'PF', 'C'] as BballPosition[]).map((position) => ({
      position,
      rating,
    }))

  it('the undefeated cutoff is a displayed overall of 85 (Alex, 2026-06-26)', () => {
    // Pin the intent: anything rating 85 or better (as shown) runs the table.
    expect(UNDEFEATED_STRENGTH).toBe(85)
  })

  it('an 85+ overall runs the table — undefeated, for sure', () => {
    expect(projectedWins(five(UNDEFEATED_STRENGTH), 40)).toBe(40)
    expect(projectedWins(five(85), 40)).toBe(40)
    expect(projectedWins(five(90), 40)).toBe(40)
    expect(projectedWins(five(95), 40)).toBe(40)
    expect(projectedWins(five(100), 40)).toBe(40)
  })

  it('every overall from 85 up through 89 is undefeated, not just the cutoff', () => {
    for (const r of [85, 86, 87, 88, 89]) {
      expect(projectedWins(five(r), 40)).toBe(40)
    }
  })

  it('the undefeated cutoff follows the DISPLAYED (rounded) overall', () => {
    // Anchor to the constant: a strength rounding UP to it is undefeated; one
    // rounding DOWN below it drops at least a game. (84.5→85 vs 84.4→84.)
    expect(projectedWins(five(UNDEFEATED_STRENGTH - 0.5), 40)).toBe(40)
    expect(projectedWins(five(UNDEFEATED_STRENGTH - 0.6), 40)).toBeLessThan(40)
  })

  it('every overall 80 and up is at least 37 wins (Alex, 2026-06-26)', () => {
    // The curve was eased so the 80s feel rewarding: 80–84 land in the high 30s
    // (just shy of the 85 undefeated cutoff), 85+ run the table.
    for (const r of [80, 81, 82, 83, 84]) {
      const wins = projectedWins(five(r), 40)
      expect(wins).toBeGreaterThanOrEqual(37)
      expect(wins).toBeLessThan(40) // still short of undefeated below 85
    }
  })

  it('the winless floor is a displayed overall of 30 (Alex, 2026-06-26)', () => {
    expect(WINLESS_STRENGTH).toBe(30)
  })

  it('anything below a 30 overall goes 0-40, full stop', () => {
    for (const r of [0, 10, 20, 25, 29]) {
      expect(projectedWins(five(r), 40)).toBe(0)
    }
  })

  it('the winless floor follows the DISPLAYED (rounded) overall', () => {
    // Mirror of the undefeated override: a strength rounding DOWN below 30 is
    // winless; one rounding UP to 30 scrapes a win. (29.4→29 vs 29.5→30.)
    expect(projectedWins(five(WINLESS_STRENGTH - 0.6), 40)).toBe(0) // 29.4→29
    expect(projectedWins(five(WINLESS_STRENGTH - 0.5), 40)).toBeGreaterThan(0) // 29.5→30
  })

  it('a 30 overall is NOT winless — it scrapes at least one win', () => {
    expect(projectedWins(five(WINLESS_STRENGTH), 40)).toBeGreaterThan(0)
    expect(projectedWins(five(30), 40)).toBe(1)
  })

  it('the non-power-5 haircut can tip a marginal team over the winless cliff', () => {
    // Where the two new features meet: a base 31 (1 win as power-5) is cut to 29 —
    // under the 30 floor → 0-40. A base 32 is cut to 30 → still scrapes a win. Pin
    // the 31/32 cliff so neither the factor nor the floor can drift unnoticed.
    expect(Math.round(31 * NON_POWER5_RATING_FACTOR)).toBe(29)
    expect(Math.round(32 * NON_POWER5_RATING_FACTOR)).toBe(30)
    expect(projectedWins(five(31), 40)).toBe(1) // power-5: a 31 wins one
    expect(
      projectedWins(five(Math.round(31 * NON_POWER5_RATING_FACTOR)), 40),
    ).toBe(0) // haircut ⇒ winless
    expect(
      projectedWins(five(Math.round(32 * NON_POWER5_RATING_FACTOR)), 40),
    ).toBe(1) // just clears the floor
  })

  it('a team at the pivot is ~.500; the curve sits a touch easier overall', () => {
    expect(projectedWins(five(WIN_PIVOT), 40)).toBe(20) // pivot ⇒ 50%
    // Eased curve (pivot lowered): a plain 60 overall now clears .500.
    expect(projectedWins(five(60), 40)).toBeGreaterThan(20)
    // A 75 overall is strong but clearly short of undefeated (and not a stealth
    // 39-win HISTORIC) — pin it exactly so the bound can't silently drift up.
    expect(projectedWins(five(75), 40)).toBe(37)
  })
  it('recordLabel and gradeLabel', () => {
    expect(recordLabel(40, 40)).toBe('40–0')
    expect(recordLabel(34, 40)).toBe('34–6')
    expect(gradeLabel(40, 40)).toBe('PERFECT')
    expect(gradeLabel(20, 40)).toBe('BUBBLE')
  })
})
