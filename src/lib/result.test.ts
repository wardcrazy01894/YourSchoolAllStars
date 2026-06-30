import { describe, it, expect } from 'vitest'
import { BBALL_POSITIONS } from '../types'
import type { BballPlayer, BballPosition, YearWindow } from '../types'
import type { DraftState, DraftPick } from './game'
import { playerRating } from './rating'
import {
  evaluateRoster,
  savedDailyFrom,
  rosterFromSaved,
  teamStatTotals,
  windowByPosition,
} from './result'

const W = (start: number, end: number): YearWindow => ({ start, end })

function player(
  id: string,
  position: BballPosition,
  year: number,
  stats: BballPlayer['seasons'][number]['stats'],
  honors: string[] = [],
): BballPlayer {
  return {
    id,
    name: id,
    position,
    firstYear: year,
    lastYear: year,
    seasons: [{ year, stats, honors, source: 'test' }],
  }
}

const STARTER_LINE = { pts: 20, reb: 8, ast: 5, stl: 1, blk: 1 }

function emptySlots(): DraftState['slots'] {
  return Object.fromEntries(
    BBALL_POSITIONS.map((p) => [p, null]),
  ) as DraftState['slots']
}

/** Build a DraftState from picks (bypassing the reducer — we test result.ts). */
function stateFrom(picks: DraftPick[]): DraftState {
  const slots = emptySlots()
  for (const pk of picks) slots[pk.position] = pk.player
  return { windows: [], cursor: picks.length, slots, picks }
}

/** A full five, each starter the same elite line, drafted from its own window. */
function fullPicks(): DraftPick[] {
  return BBALL_POSITIONS.map((pos, i) => {
    const year = 2000 + i
    return {
      player: player(`p-${pos}`, pos, year, STARTER_LINE),
      position: pos,
      window: W(year - 1, year + 2), // contains `year`
    }
  })
}

describe('evaluateRoster', () => {
  it('rates a full five and projects a record (window-correct)', () => {
    const result = evaluateRoster(stateFrom(fullPicks()), 40)
    // Each starter: composite 20*1 + 8*1.2 + 5*1.5 + 1*3 + 1*3 = 43.1 → curve 86.
    expect(result.rated).toHaveLength(5)
    for (const pos of BBALL_POSITIONS) {
      expect(result.ratingsByPosition[pos]).toBe(86)
    }
    expect(Math.round(result.strength)).toBe(86)
    expect(result.wins).toBe(40) // 86 ≥ the 85 undefeated cutoff ⇒ runs the table
    expect(result.grade).toBe('PERFECT') // 40/40
  })

  it('rates only filled slots; empty slots read null and are absent from the score', () => {
    const picks = fullPicks().filter(
      (pk) => pk.position === 'PG' || pk.position === 'C',
    )
    const result = evaluateRoster(stateFrom(picks), 40)
    expect(result.rated).toHaveLength(2)
    expect(result.ratingsByPosition.PG).toBe(86)
    expect(result.ratingsByPosition.C).toBe(86)
    expect(result.ratingsByPosition.SG).toBeNull()
    expect(result.ratingsByPosition.SF).toBeNull()
    expect(result.ratingsByPosition.PF).toBeNull()
    // Shipped behavior preserved: an empty slot is ABSENT from teamStrength, not a
    // zero — so two elite starters still score 86 (the rating model averages the
    // starters present). Incomplete rosters are unreachable in normal daily play
    // (6 eras, 5 slots, 1 safe skip, ≥1 eligible per window×position); this just
    // guarantees evaluateRoster degrades gracefully (no NaN) rather than penalizes.
    expect(result.strength).toBeCloseTo(86, 0)
    expect(result.wins).toBe(40) // 86 ≥ 85 ⇒ undefeated
  })

  it('uses the drafted window, not career-best, to pick the season', () => {
    // A player with an elite later peak drafted from an EARLIER, weaker window
    // must be rated on the in-window season — proving evaluateRoster threads the
    // pick window through to playerRating.
    const p: BballPlayer = {
      id: 'late-bloomer',
      name: 'Late Bloomer',
      position: 'SF',
      firstYear: 2001,
      lastYear: 2004,
      seasons: [
        { year: 2001, stats: { pts: 4 }, honors: [], source: 'test' },
        {
          year: 2004,
          stats: { pts: 28, reb: 9, ast: 4 },
          honors: [],
          source: 'test',
        },
      ],
    }
    const window = W(2000, 2002) // only the weak 2001 season is in-window
    const result = evaluateRoster(
      stateFrom([{ player: p, position: 'SF', window }]),
      40,
    )
    expect(result.ratingsByPosition.SF).toBe(playerRating(p, window))
    // Sanity: the in-window rating is well below the career-peak rating.
    expect(playerRating(p, window)).toBeLessThan(playerRating(p, W(2003, 2005)))
  })

  it('threads a non-power-5 flag through to every per-position rating and the record', () => {
    const state = stateFrom(fullPicks()) // five elite 86-rated starters
    const power5 = evaluateRoster(state, 40) // default true
    const midMajor = evaluateRoster(state, 40, false)
    for (const pos of BBALL_POSITIONS) {
      expect(midMajor.ratingsByPosition[pos]).toBeLessThan(
        power5.ratingsByPosition[pos]!,
      )
      // Penalty is applied at the player level (matches playerRating(power5=false)).
      expect(midMajor.ratingsByPosition[pos]).toBe(
        playerRating(state.slots[pos]!, midMajor.windowByPosition[pos], false),
      )
    }
    expect(midMajor.strength).toBeLessThan(power5.strength)
    // The power-5 elite five runs the table; the haircut knocks the mid-major off it.
    expect(power5.wins).toBe(40)
    expect(midMajor.wins).toBeLessThan(40)
  })

  it('applies a power-5 RESOLVER per player — only the non-power-5 starter is dinged', () => {
    // The mixed-school case (Full Basketball): power5 is resolved per player, not
    // per team. One starter (the SF) is non-power-5; the rest are power-5. Only the
    // SF's rating takes the haircut — its power-5 teammates are untouched.
    const state = stateFrom(fullPicks()) // five identical elite 86-rated starters
    const resolver = (p: BballPlayer) => p.position !== 'SF'
    const result = evaluateRoster(state, 40, resolver)
    for (const pos of BBALL_POSITIONS) {
      const expected = playerRating(
        state.slots[pos]!,
        result.windowByPosition[pos],
        pos !== 'SF', // SF resolves false, everyone else true
      )
      expect(result.ratingsByPosition[pos]).toBe(expected)
    }
    // The four power-5 starters keep the full 86; only the SF is knocked below it.
    expect(result.ratingsByPosition.PG).toBe(86)
    expect(result.ratingsByPosition.SF).toBeLessThan(86)
    // And it is strictly between the all-power-5 and all-mid-major team strengths.
    const allPower5 = evaluateRoster(state, 40, true)
    const allMidMajor = evaluateRoster(state, 40, false)
    expect(result.strength).toBeLessThan(allPower5.strength)
    expect(result.strength).toBeGreaterThan(allMidMajor.strength)
  })

  it('savedDailyFrom accepts a per-player power-5 resolver too', () => {
    const state = stateFrom(fullPicks())
    const resolver = (p: BballPlayer) => p.position !== 'SF'
    const mixed = savedDailyFrom(state, '2026-06-26', 40, resolver)
    const allPower5 = savedDailyFrom(state, '2026-06-26', 40, true)
    const allMidMajor = savedDailyFrom(state, '2026-06-26', 40, false)
    // One dinged starter sits the record between all-power-5 and all-mid-major.
    expect(mixed.wins).toBeLessThanOrEqual(allPower5.wins)
    expect(mixed.wins).toBeGreaterThanOrEqual(allMidMajor.wins)
  })
})

describe('teamStatTotals', () => {
  const KEYS: (keyof BballPlayer['seasons'][number]['stats'])[] = [
    'pts',
    'reb',
    'ast',
    'stl',
    'blk',
  ]

  it('sums each stat across the full five (window-correct season)', () => {
    const picks = fullPicks() // five identical STARTER_LINE starters
    const state = stateFrom(picks)
    const totals = teamStatTotals(state.slots, windowByPosition(picks), KEYS)
    // 5 × {pts:20, reb:8, ast:5, stl:1, blk:1}
    expect(totals.pts).toBe(100)
    expect(totals.reb).toBe(40)
    expect(totals.ast).toBe(25)
    expect(totals.stl).toBe(5)
    expect(totals.blk).toBe(5)
  })

  it('counts empty slots as zero (partial roster still sums what is filled)', () => {
    const picks = fullPicks().filter(
      (pk) => pk.position === 'PG' || pk.position === 'C',
    )
    const totals = teamStatTotals(
      stateFrom(picks).slots,
      windowByPosition(picks),
      ['pts'],
    )
    expect(totals.pts).toBe(40) // two starters only
  })

  it('sums the SAME in-window season the box score shows, not career-best', () => {
    // Late bloomer: weak 2001 in-window season, elite 2004 peak out of window.
    const p: BballPlayer = {
      id: 'late-bloomer',
      name: 'Late Bloomer',
      position: 'SF',
      firstYear: 2001,
      lastYear: 2004,
      seasons: [
        { year: 2001, stats: { pts: 4 }, honors: [], source: 'test' },
        { year: 2004, stats: { pts: 28 }, honors: [], source: 'test' },
      ],
    }
    const window = W(2000, 2002) // only 2001 is in-window
    const picks: DraftPick[] = [{ player: p, position: 'SF', window }]
    const totals = teamStatTotals(
      stateFrom(picks).slots,
      windowByPosition(picks),
      ['pts'],
    )
    expect(totals.pts).toBe(4) // the in-window season, NOT the 28-pt peak
  })

  it('treats a missing (unpublished) stat as zero rather than NaN', () => {
    const p = player('scorer', 'PG', 2001, { pts: 10 }) // no reb/ast/stl/blk
    const window = W(2000, 2003)
    const picks: DraftPick[] = [{ player: p, position: 'PG', window }]
    const totals = teamStatTotals(
      stateFrom(picks).slots,
      windowByPosition(picks),
      ['pts', 'reb'],
    )
    expect(totals.pts).toBe(10)
    expect(totals.reb).toBe(0)
  })
})

describe('savedDailyFrom', () => {
  it('serializes the filled roster, its windows, and the record', () => {
    const picks = fullPicks()
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    expect(saved.dateKey).toBe('2026-06-26')
    expect(saved.wins).toBe(40)
    expect(saved.grade).toBe('PERFECT')
    for (const pos of BBALL_POSITIONS) {
      expect(saved.playerIds[pos]).toBe(`p-${pos}`)
      expect(saved.windows?.[pos]).toEqual(
        picks.find((pk) => pk.position === pos)!.window,
      )
    }
  })

  it('omits empty slots from playerIds and windows', () => {
    const picks = fullPicks().filter((pk) => pk.position === 'PG')
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    expect(saved.playerIds).toEqual({ PG: 'p-PG' })
    expect(Object.keys(saved.windows ?? {})).toEqual(['PG'])
  })

  it('threads the non-power-5 haircut through to the saved record', () => {
    const state = stateFrom(fullPicks())
    const power5 = savedDailyFrom(state, '2026-06-26', 40, true)
    const midMajor = savedDailyFrom(state, '2026-06-26', 40, false)
    expect(midMajor.wins).toBeLessThan(power5.wins)
  })
})

describe('rosterFromSaved (round-trip)', () => {
  it('reconstructs a roster that re-evaluates identically', () => {
    const picks = fullPicks()
    const original = stateFrom(picks)
    const saved = savedDailyFrom(original, '2026-06-26', 40)
    const players = picks.map((pk) => pk.player)

    const recon = rosterFromSaved(saved, players)
    const before = evaluateRoster(original, 40)
    const after = evaluateRoster(recon, 40)

    expect(after.wins).toBe(before.wins)
    expect(after.grade).toBe(before.grade)
    expect(after.ratingsByPosition).toEqual(before.ratingsByPosition)
    for (const pos of BBALL_POSITIONS) {
      expect(recon.slots[pos]?.id).toBe(`p-${pos}`)
    }
  })

  it('preserves holes from a partial save', () => {
    const picks = fullPicks().filter(
      (pk) => pk.position === 'PG' || pk.position === 'C',
    )
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    const recon = rosterFromSaved(
      saved,
      picks.map((pk) => pk.player),
    )
    expect(recon.slots.PG?.id).toBe('p-PG')
    expect(recon.slots.C?.id).toBe('p-C')
    expect(recon.slots.SG).toBeNull()
    expect(recon.slots.SF).toBeNull()
    expect(recon.slots.PF).toBeNull()
  })

  it('drops a slot whose player is no longer in the dataset (graceful)', () => {
    const picks = fullPicks()
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    // Dataset changed since they played: the PG no longer exists.
    const players = picks.map((pk) => pk.player).filter((p) => p.id !== 'p-PG')
    const recon = rosterFromSaved(saved, players)
    expect(recon.slots.PG).toBeNull()
    expect(recon.slots.C?.id).toBe('p-C')
    expect(recon.picks.some((pk) => pk.position === 'PG')).toBe(false)
  })

  it('drops a slot with no stored window (forward-compat with lean saves)', () => {
    const picks = fullPicks()
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    // Simulate a save that lacks windows entirely (older/lean shape).
    const lean = { ...saved, windows: undefined }
    const recon = rosterFromSaved(
      lean,
      picks.map((pk) => pk.player),
    )
    for (const pos of BBALL_POSITIONS) {
      expect(recon.slots[pos]).toBeNull()
    }
  })

  it('drops only the slots missing a window in a partial-windows save', () => {
    // savedDailyFrom never emits a partial windows map (it's all-or-nothing per
    // filled slot), but a hand-edited/migrated save could — reconstruct only the
    // slots that have BOTH a known player and a stored window.
    const picks = fullPicks()
    const saved = savedDailyFrom(stateFrom(picks), '2026-06-26', 40)
    const partial = { ...saved, windows: { PG: saved.windows!.PG } }
    const recon = rosterFromSaved(
      partial,
      picks.map((pk) => pk.player),
    )
    expect(recon.slots.PG?.id).toBe('p-PG')
    expect(recon.picks).toHaveLength(1)
    for (const pos of BBALL_POSITIONS.filter((p) => p !== 'PG')) {
      expect(recon.slots[pos]).toBeNull()
    }
  })
})
