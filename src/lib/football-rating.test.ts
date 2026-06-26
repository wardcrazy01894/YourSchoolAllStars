import { describe, it, expect } from 'vitest'
import type { FbPlayer, FbPosition, FbStats } from '../types'
import {
  FB_GAMES,
  fbStatComposite,
  fbHonorTier,
  fbHonorsBonus,
  fbPlayerRating,
  fbTeamStrength,
  fbProjectedWins,
  fbRecordLabel,
  fbGradeLabel,
  FB_NON_POWER5_RATING_FACTOR,
  type RatedFbStarter,
} from './football-rating'

// Reference-level ("elite") single-season lines per position — each is tuned to
// land near the top of the rating curve, so they double as parity fixtures.
const ELITE: Record<FbPosition, FbStats> = {
  QB: { passYds: 3500, passTD: 35, passInt: 8, rushYds: 700, rushTD: 10 },
  RB: { rushYds: 1500, rushTD: 18, rec: 35, recYds: 400, recTD: 4 },
  WR: { rec: 70, recYds: 1100, recTD: 11 },
  TE: { rec: 50, recYds: 650, recTD: 7 },
  DE: { tackles: 55, tfl: 18, sacks: 11, ff: 4, defInt: 2 },
  DT: { tackles: 50, tfl: 13, sacks: 7, ff: 3 },
  LB: { tackles: 120, tfl: 15, sacks: 6, defInt: 3, pbu: 6, ff: 3 },
  CB: { tackles: 55, tfl: 4, defInt: 5, pbu: 14, ff: 2 },
  S: { tackles: 90, tfl: 7, defInt: 4, pbu: 9, ff: 3 },
}

const ALL_POSITIONS = Object.keys(ELITE) as FbPosition[]

function mkPlayer(
  position: FbPosition,
  stats: FbStats,
  honors: string[] = [],
): FbPlayer {
  return {
    id: `${position}-x`,
    name: `${position} Player`,
    position,
    firstYear: 2010,
    lastYear: 2010,
    bestSeason: 2010,
    stats,
    honors,
    source: 'https://example.com',
  }
}

describe('fbStatComposite', () => {
  it('rewards a bigger line over a smaller one, per position', () => {
    const eliteQB = fbStatComposite('QB', ELITE.QB)
    const scrubQB = fbStatComposite('QB', {
      passYds: 800,
      passTD: 4,
      passInt: 6,
      rushYds: 100,
      rushTD: 1,
    })
    expect(eliteQB).toBeGreaterThan(scrubQB)
  })

  it('treats a missing stat field as zero (no NaN on a partial line)', () => {
    const c = fbStatComposite('WR', { rec: 40 })
    expect(Number.isFinite(c)).toBe(true)
    expect(c).toBeGreaterThan(0)
  })

  it('penalizes QB interceptions (more picks → lower composite)', () => {
    const clean = fbStatComposite('QB', { ...ELITE.QB, passInt: 3 })
    const sloppy = fbStatComposite('QB', { ...ELITE.QB, passInt: 18 })
    expect(clean).toBeGreaterThan(sloppy)
  })

  it('only reads stats relevant to the position (a WR rushYds-only line ≈ 0)', () => {
    // tackles are a defensive stat; on a WR they should not contribute.
    expect(fbStatComposite('WR', { tackles: 100 })).toBe(0)
  })
})

describe('fbHonorTier / fbHonorsBonus', () => {
  it('orders the marquee honors sensibly', () => {
    expect(fbHonorTier('Heisman Trophy (2006)')).toBeGreaterThan(
      fbHonorTier('Consensus All-American'),
    )
    expect(fbHonorTier('Consensus All-American')).toBeGreaterThan(
      fbHonorTier('First-Team All-Big Ten'),
    )
    expect(fbHonorTier('First-Team All-Big Ten')).toBeGreaterThan(
      fbHonorTier('Honorable Mention All-Big Ten'),
    )
  })

  it('is case- and hyphen-insensitive', () => {
    expect(fbHonorTier('first team all big ten')).toBe(
      fbHonorTier('First-Team All-Big Ten'),
    )
  })

  it('scores an unknown string as 0 and sums across honors', () => {
    expect(fbHonorTier('Team Captain')).toBe(0)
    const bonus = fbHonorsBonus(['Heisman Trophy', 'Team Captain'])
    expect(bonus).toBe(fbHonorTier('Heisman Trophy'))
  })
})

describe('fbPlayerRating', () => {
  it('is bounded to [0, 100]', () => {
    for (const pos of ALL_POSITIONS) {
      const r = fbPlayerRating(mkPlayer(pos, ELITE[pos]))
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(100)
    }
  })

  it('rates an elite reference season highly at EVERY position (cross-position parity)', () => {
    for (const pos of ALL_POSITIONS) {
      const r = fbPlayerRating(mkPlayer(pos, ELITE[pos]))
      expect(r, `${pos} elite rating`).toBeGreaterThanOrEqual(80)
    }
  })

  it('rates a replacement-level season low', () => {
    const r = fbPlayerRating(
      mkPlayer('RB', { rushYds: 120, rushTD: 1, rec: 4, recYds: 30 }),
    )
    expect(r).toBeLessThan(35)
  })

  it('honors lift the rating', () => {
    const base = mkPlayer('QB', ELITE.QB)
    const decorated = mkPlayer('QB', ELITE.QB, ['Heisman Trophy (2006)'])
    expect(fbPlayerRating(decorated)).toBeGreaterThanOrEqual(
      fbPlayerRating(base),
    )
  })

  it('applies the non-power-5 haircut when power5 is false', () => {
    const p = mkPlayer('WR', ELITE.WR)
    const full = fbPlayerRating(p, true)
    const docked = fbPlayerRating(p, false)
    expect(docked).toBeLessThan(full)
    expect(docked).toBe(Math.round(full * FB_NON_POWER5_RATING_FACTOR))
  })
})

describe('fbTeamStrength', () => {
  const flat = (rating: number): RatedFbStarter[] =>
    ALL_POSITIONS.flatMap((position) => [{ position, rating }]).concat(
      // pad to a full 12 with extra skill/flex bodies so length is realistic
      [
        { position: 'WR', rating },
        { position: 'RB', rating },
        { position: 'LB', rating },
      ],
    )

  it('returns 0 for an empty roster', () => {
    expect(fbTeamStrength([])).toBe(0)
  })

  it('a uniform roster scores ~ that rating', () => {
    expect(fbTeamStrength(flat(80))).toBeCloseTo(80, 0)
  })

  it('a single weak link drags the team below the mean (no weak links)', () => {
    const strong = flat(90)
    const withHole = strong.map((s, i) => (i === 0 ? { ...s, rating: 40 } : s))
    const meanOnly =
      withHole.reduce((a, s) => a + s.rating, 0) / withHole.length
    expect(fbTeamStrength(withHole)).toBeLessThan(meanOnly)
  })

  it('weights the QB premium higher than a non-premium slot', () => {
    // One elite player; everyone else identical. Putting the elite at QB beats
    // putting them at a 1.0-weight slot (DT).
    const baseRating = 60
    const eliteRating = 95
    const atQB: RatedFbStarter[] = [
      { position: 'QB', rating: eliteRating },
      { position: 'DT', rating: baseRating },
    ]
    const atDT: RatedFbStarter[] = [
      { position: 'QB', rating: baseRating },
      { position: 'DT', rating: eliteRating },
    ]
    expect(fbTeamStrength(atQB)).toBeGreaterThan(fbTeamStrength(atDT))
  })
})

describe('fbProjectedWins / labels', () => {
  const roster = (rating: number): RatedFbStarter[] =>
    Array.from({ length: 12 }, () => ({
      position: 'LB' as FbPosition,
      rating,
    }))

  it('plays a 16-game season', () => {
    expect(FB_GAMES).toBe(16)
  })

  it('an elite roster runs the table (16-0)', () => {
    expect(fbProjectedWins(roster(95))).toBe(16)
  })

  it('a hopeless roster goes winless (0-16)', () => {
    expect(fbProjectedWins(roster(20))).toBe(0)
  })

  it('wins are monotonic in roster strength', () => {
    const a = fbProjectedWins(roster(50))
    const b = fbProjectedWins(roster(65))
    const c = fbProjectedWins(roster(80))
    expect(a).toBeLessThanOrEqual(b)
    expect(b).toBeLessThanOrEqual(c)
  })

  it('clamps wins to [0, FB_GAMES]', () => {
    for (const r of [0, 20, 45, 60, 75, 95, 100]) {
      const w = fbProjectedWins(roster(r))
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(FB_GAMES)
    }
  })

  it('labels the record and grade', () => {
    expect(fbRecordLabel(12)).toBe('12–4')
    expect(fbRecordLabel(16)).toBe('16–0')
    expect(fbGradeLabel(16)).toBe('PERFECT')
    expect(fbGradeLabel(0)).toBe('WINLESS')
  })
})
