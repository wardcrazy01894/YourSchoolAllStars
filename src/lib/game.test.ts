import { describe, it, expect } from 'vitest'
import {
  initDraft,
  draft,
  reroll,
  canReroll,
  skipRound,
  isComplete,
  currentWindow,
  currentPool,
  openPositions,
} from './game'
import type { BballPlayer, BballPosition, YearWindow } from '../types'

function mk(
  id: string,
  position: BballPosition,
  first: number,
  last: number,
): BballPlayer {
  return {
    id,
    name: id,
    position,
    firstYear: first,
    lastYear: last,
    bestSeason: last,
    stats: { pts: 12, reb: 4, ast: 3, stl: 1, blk: 0.4 },
    honors: [],
    source: 'test',
  }
}

const W10: YearWindow = { start: 2010, end: 2013 }
const W14: YearWindow = { start: 2014, end: 2017 }
const W94: YearWindow = { start: 1994, end: 1997 }

const pool = [
  mk('pg10', 'PG', 2010, 2013),
  mk('sg10', 'SG', 2011, 2014),
  mk('sf10', 'SF', 2010, 2013),
  mk('pf10', 'PF', 2012, 2015),
  mk('c10', 'C', 2010, 2013),
  mk('pg94', 'PG', 1994, 1997),
]

describe('initDraft', () => {
  it('starts at round 0 with five empty slots and one reroll', () => {
    const s = initDraft([W10, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    expect(s.round).toBe(0)
    expect(openPositions(s)).toEqual(['PG', 'SG', 'SF', 'PF', 'C'])
    expect(s.rerollsLeft).toBe(1)
    expect(isComplete(s)).toBe(false)
  })
})

describe('draft', () => {
  it('assigns a player to their slot, locks it, and advances the round', () => {
    let s = initDraft([W10, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    s = draft(s, pool[0]) // pg10 → PG
    expect(s.slots.PG?.id).toBe('pg10')
    expect(s.round).toBe(1)
    expect(openPositions(s)).not.toContain('PG')
  })

  it('refuses a player whose slot is already filled', () => {
    let s = initDraft([W10, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    s = draft(s, mk('pgA', 'PG', 2010, 2013))
    const before = s
    s = draft(s, mk('pgB', 'PG', 2010, 2013)) // PG full now
    expect(s).toBe(before) // no-op
  })

  it('refuses a player not eligible in the current window', () => {
    let s = initDraft([W10, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    const before = s
    s = draft(s, pool[5]) // pg94, not in 2010-2013
    expect(s).toBe(before)
  })

  it('a full valid draft completes with five filled slots', () => {
    let s = initDraft([W10, W10, W10, W10, W10], [W94, W94, W94, W94, W94])
    for (const p of [pool[0], pool[1], pool[2], pool[3], pool[4]])
      s = draft(s, p)
    expect(isComplete(s)).toBe(true)
    expect(Object.values(s.slots).every((v) => v !== null)).toBe(true)
    expect(s.picks).toHaveLength(5)
  })
})

describe('currentPool', () => {
  it('only shows eligible players for open slots in the current window', () => {
    const s = initDraft([W94, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    expect(currentPool(s, pool).map((p) => p.id)).toEqual(['pg94'])
  })
})

describe('reroll', () => {
  it('swaps the current window to its alternate and spends the reroll', () => {
    let s = initDraft([W94, W10, W10, W10, W10], [W10, W14, W14, W14, W14])
    expect(currentWindow(s)).toEqual(W94)
    expect(canReroll(s)).toBe(true)
    s = reroll(s)
    expect(currentWindow(s)).toEqual(W10)
    expect(s.rerollsLeft).toBe(0)
    expect(canReroll(s)).toBe(false)
  })

  it('cannot reroll twice in a game', () => {
    let s = initDraft([W94, W10, W10, W10, W10], [W10, W14, W14, W14, W14])
    s = reroll(s)
    s = draft(s, pool[0]) // advance to round 1
    expect(canReroll(s)).toBe(false)
    const before = s
    expect(reroll(s)).toBe(before)
  })
})

describe('skipRound', () => {
  it('advances leaving the slot unfilled', () => {
    let s = initDraft([W94, W10, W10, W10, W10], [W14, W14, W14, W14, W14])
    s = skipRound(s)
    expect(s.round).toBe(1)
    expect(s.picks).toHaveLength(0)
  })
})
