import { describe, it, expect } from 'vitest'
import {
  FB_FIRST_YEAR,
  fbWindows,
  FB_ROUNDS,
  FB_RESPINS_PER_SIDE,
  OFFENSE_SLOT_IDS,
  DEFENSE_SLOT_IDS,
  sideForRound,
  canFillSlot,
  eligibleSlotsFor,
  eligiblePlayers,
  playerInWindow,
} from './football'
import { FB_SLOTS } from '../types'
import type { FbPlayer, FbPosition } from '../types'

function mk(
  id: string,
  position: FbPosition,
  first: number,
  last: number,
): FbPlayer {
  return {
    id,
    name: id,
    position,
    firstYear: first,
    lastYear: last,
    seasons: Array.from({ length: last - first + 1 }, (_, i) => ({
      year: first + i,
      stats: {},
      honors: [],
      source: 'test',
    })),
  }
}

const slot = (id: string) => FB_SLOTS.find((s) => s.id === id)!

describe('FB_SLOTS / windows', () => {
  it('is a 12-man roster: 6 offense + 6 defense', () => {
    expect(FB_SLOTS).toHaveLength(12)
    expect(FB_ROUNDS).toBe(12)
    expect(FB_SLOTS.filter((s) => s.side === 'offense')).toHaveLength(6)
    expect(FB_SLOTS.filter((s) => s.side === 'defense')).toHaveLength(6)
  })

  it('fbWindows is the rolling 4-year wheel from 1994 to the dataset max', () => {
    // Same data-driven rolling scheme basketball uses: one era per starting year
    // from FB_FIRST_YEAR (1994, same floor as basketball) up to maxYear.
    const wheel = fbWindows([{ lastYear: 2024 }])
    expect(FB_FIRST_YEAR).toBe(1994)
    expect(wheel[0]).toEqual({ start: 1994, end: 1997 })
    expect(wheel[wheel.length - 1]).toEqual({ start: 2021, end: 2024 })
    expect(wheel).toHaveLength(28)
    // No data → no windows (a school without football).
    expect(fbWindows([])).toEqual([])
  })

  it('playerInWindow requires a season ROW inside the window', () => {
    expect(
      playerInWindow(mk('a', 'QB', 2006, 2009), { start: 2005, end: 2008 }),
    ).toBe(true)
    expect(
      playerInWindow(mk('b', 'QB', 2010, 2013), { start: 2005, end: 2008 }),
    ).toBe(false)
    // Tenure overlaps but the only season ROW is outside → NOT eligible. This
    // is the wrong-era-stats fix: with no in-window row there is nothing the
    // era could honestly credit, so the player simply isn't offered.
    const sparse: FbPlayer = {
      ...mk('c', 'QB', 2006, 2009),
      seasons: [{ year: 2009, stats: {}, honors: [], source: 'test' }],
    }
    expect(playerInWindow(sparse, { start: 2005, end: 2008 })).toBe(false)
  })
})

describe('draft order + re-spins', () => {
  it('offense is drafted first (rounds 0–5), defense second (6–11)', () => {
    expect(OFFENSE_SLOT_IDS).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX1', 'FLEX2'])
    expect(DEFENSE_SLOT_IDS).toEqual(['DE', 'DT', 'LB', 'CB', 'S', 'DFLEX'])
    expect(sideForRound(0)).toBe('offense')
    expect(sideForRound(5)).toBe('offense')
    expect(sideForRound(6)).toBe('defense')
    expect(sideForRound(11)).toBe('defense')
  })

  it('one re-spin per side', () => {
    expect(FB_RESPINS_PER_SIDE).toBe(1)
  })
})

describe('slot eligibility + FLEX', () => {
  it('single-position slots only accept their position', () => {
    expect(canFillSlot(mk('q', 'QB', 2010, 2013), slot('QB'))).toBe(true)
    expect(canFillSlot(mk('r', 'RB', 2010, 2013), slot('QB'))).toBe(false)
  })

  it('offensive FLEX accepts RB/WR/TE but not QB', () => {
    expect(canFillSlot(mk('r', 'RB', 2010, 2013), slot('FLEX1'))).toBe(true)
    expect(canFillSlot(mk('w', 'WR', 2010, 2013), slot('FLEX2'))).toBe(true)
    expect(canFillSlot(mk('t', 'TE', 2010, 2013), slot('FLEX1'))).toBe(true)
    expect(canFillSlot(mk('q', 'QB', 2010, 2013), slot('FLEX1'))).toBe(false)
  })

  it('defensive FLEX accepts any defender', () => {
    for (const pos of ['DE', 'DT', 'LB', 'CB', 'S'] as FbPosition[]) {
      expect(canFillSlot(mk('d', pos, 2010, 2013), slot('DFLEX'))).toBe(true)
    }
    expect(canFillSlot(mk('w', 'WR', 2010, 2013), slot('DFLEX'))).toBe(false)
  })

  it('eligibleSlotsFor: a WR can go to WR or either offensive FLEX when open', () => {
    const wr = mk('w', 'WR', 2010, 2013)
    const ids = eligibleSlotsFor(wr, new Set()).map((s) => s.id)
    expect(ids).toEqual(['WR', 'FLEX1', 'FLEX2'])
  })

  it('eligibleSlotsFor: once WR + both FLEX are filled, a WR has nowhere to go', () => {
    const wr = mk('w', 'WR', 2010, 2013)
    expect(
      eligibleSlotsFor(wr, new Set(['WR', 'FLEX1', 'FLEX2'])),
    ).toHaveLength(0)
  })
})

describe('eligiblePlayers', () => {
  const pool = [
    mk('zwr', 'WR', 2010, 2013),
    mk('arb', 'RB', 2010, 2013),
    mk('old', 'QB', 2005, 2008),
  ]
  it('filters by window + an available fitting slot, sorted by id', () => {
    const out = eligiblePlayers(pool, { start: 2010, end: 2013 }, new Set())
    expect(out.map((p) => p.id)).toEqual(['arb', 'zwr'])
  })

  it('excludes players whose only fitting slots are all filled', () => {
    // Fill RB and both FLEX → the RB ('arb') has nowhere to go; WR still fits WR.
    const out = eligiblePlayers(
      pool,
      { start: 2010, end: 2013 },
      new Set(['RB', 'FLEX1', 'FLEX2']),
    )
    expect(out.map((p) => p.id)).toEqual(['zwr'])
  })
})
