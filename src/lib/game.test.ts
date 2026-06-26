import { describe, it, expect } from 'vitest'
import {
  initDraft,
  draftToSlot,
  skip,
  canSkip,
  safeSkipsLeft,
  isComplete,
  isPickable,
  currentWindow,
  playersThisEra,
  eligibleOpenSlots,
  openPositions,
} from './game'
import type { BballPlayer, BballPosition, YearWindow } from '../types'

function mk(
  id: string,
  position: BballPosition,
  first: number,
  last: number,
  eligible?: BballPosition[],
): BballPlayer {
  return {
    id,
    name: id,
    position,
    eligible,
    firstYear: first,
    lastYear: last,
    seasons: [
      {
        year: last,
        stats: { pts: 12, reb: 4, ast: 3, stl: 1, blk: 0.4 },
        honors: [],
        source: 'test',
      },
    ],
  }
}

const W10: YearWindow = { start: 2010, end: 2013 }
const W14: YearWindow = { start: 2014, end: 2017 }
const SIX = [W10, W10, W10, W10, W10, W10]

const pool = [
  mk('pg10', 'PG', 2010, 2013),
  mk('sg10', 'SG', 2010, 2013),
  mk('sf10', 'SF', 2010, 2013),
  mk('pf10', 'PF', 2010, 2013),
  mk('c10', 'C', 2010, 2013),
  mk('combo', 'PG', 2010, 2013, ['PG', 'SG']), // combo guard
]

describe('initDraft', () => {
  it('starts at era 0 with five open slots', () => {
    const s = initDraft(SIX)
    expect(s.cursor).toBe(0)
    expect(openPositions(s)).toEqual(['PG', 'SG', 'SF', 'PF', 'C'])
    expect(isComplete(s)).toBe(false)
    expect(currentWindow(s)).toEqual(W10)
  })
})

describe('draftToSlot + player-then-slot', () => {
  it('places a player into the chosen open slot and advances the era', () => {
    let s = initDraft(SIX)
    s = draftToSlot(s, pool[0], 'PG')
    expect(s.slots.PG?.id).toBe('pg10')
    expect(s.cursor).toBe(1)
    expect(s.picks).toEqual([{ player: pool[0], position: 'PG', window: W10 }])
  })

  it('lets a multi-eligible player choose among open slots (combo guard → SG)', () => {
    const s = initDraft(SIX)
    const combo = pool[5]
    expect(eligibleOpenSlots(s, combo).sort()).toEqual(['PG', 'SG'])
    const sg = draftToSlot(s, combo, 'SG')
    expect(sg.slots.SG?.id).toBe('combo')
    expect(sg.slots.PG).toBe(null)
  })

  it('refuses a slot the player is not eligible for', () => {
    const s = initDraft(SIX)
    expect(draftToSlot(s, pool[0], 'SG')).toBe(s) // pg10 only eligible at PG
  })

  it('refuses a player not in the current window', () => {
    const s = initDraft([W14, ...SIX])
    expect(draftToSlot(s, pool[0], 'PG')).toBe(s) // pg10 not in 2014-2017
  })

  it('refuses to draft the same multi-eligible player into a second slot', () => {
    // combo (PG/SG) → PG in era 0; next era is the same window, SG still open.
    let s = initDraft(SIX)
    s = draftToSlot(s, pool[5], 'PG')
    expect(s.slots.PG?.id).toBe('combo')
    expect(isPickable(s, pool[5])).toBe(false) // already on the roster
    const before = s
    s = draftToSlot(s, pool[5], 'SG') // attempt double-draft
    expect(s).toBe(before) // no-op; combo is not in SG
    expect(s.slots.SG).toBe(null)
  })
})

describe('isPickable + still-show-filled', () => {
  it('a player whose primary is filled but an eligible alt is open is still pickable', () => {
    let s = initDraft(SIX)
    s = draftToSlot(s, mk('otherpg', 'PG', 2010, 2013), 'PG') // PG now filled
    const combo = pool[5] // eligible PG,SG — PG filled, SG open
    expect(isPickable(s, combo)).toBe(true)
    expect(eligibleOpenSlots(s, combo)).toEqual(['SG'])
  })

  it('a player with every eligible slot filled is shown but NOT pickable', () => {
    let s = initDraft(SIX)
    s = draftToSlot(s, mk('otherpg', 'PG', 2010, 2013), 'PG')
    s = draftToSlot(s, mk('othersg', 'SG', 2010, 2013), 'SG')
    const combo = pool[5]
    expect(isPickable(s, combo)).toBe(false)
    // …but still appears in the era's list (greyed in the UI):
    expect(playersThisEra(s, [combo]).map((p) => p.id)).toEqual(['combo'])
  })

  it('playersThisEra returns everyone in the window regardless of filled slots', () => {
    const s = initDraft(SIX)
    expect(playersThisEra(s, pool).length).toBe(pool.length)
  })
})

describe('skip + fixed-era skip budget', () => {
  it('six eras for five slots grants exactly one safe skip', () => {
    const s = initDraft(SIX)
    expect(safeSkipsLeft(s)).toBe(1)
  })

  it('skip advances the era without filling a slot', () => {
    let s = initDraft(SIX)
    s = skip(s)
    expect(s.cursor).toBe(1)
    expect(s.picks).toHaveLength(0)
    expect(safeSkipsLeft(s)).toBe(0) // used the buffer
  })

  it('enforces the skip cap in the state machine, not just the UI', () => {
    let s = initDraft(SIX)
    s = skip(s) // the one allowed skip
    expect(canSkip(s)).toBe(false)
    const before = s
    expect(skip(s)).toBe(before) // a second skip is a no-op
    expect(s.cursor).toBe(1)
  })

  it('a clean draft of five completes the game', () => {
    let s = initDraft(SIX)
    for (const p of pool.slice(0, 5)) s = draftToSlot(s, p, p.position)
    expect(isComplete(s)).toBe(true)
    expect(canSkip(s)).toBe(false)
    expect(Object.values(s.slots).every((v) => v !== null)).toBe(true)
  })

  it('running out of eras ends the game even with open slots', () => {
    let s = initDraft([W10, W10]) // only two eras, five slots
    s = draftToSlot(s, pool[0], 'PG')
    s = draftToSlot(s, pool[1], 'SG')
    expect(isComplete(s)).toBe(true) // eras exhausted
    expect(openPositions(s)).toEqual(['SF', 'PF', 'C']) // holes
  })
})
