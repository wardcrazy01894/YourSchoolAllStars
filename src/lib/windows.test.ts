import { describe, it, expect } from 'vitest'
import {
  buildWindows,
  BBALL_WINDOWS,
  playerInWindow,
  eligiblePlayers,
} from './windows'
import type { BballPlayer } from '../types'

function mk(
  id: string,
  position: BballPlayer['position'],
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
    stats: { pts: 10, reb: 4, ast: 3, stl: 1, blk: 0.5 },
    honors: [],
    source: 'test',
  }
}

describe('buildWindows', () => {
  it('makes contiguous non-overlapping 4-year blocks', () => {
    expect(buildWindows(1994, 2025, 4)).toEqual([
      { start: 1994, end: 1997 },
      { start: 1998, end: 2001 },
      { start: 2002, end: 2005 },
      { start: 2006, end: 2009 },
      { start: 2010, end: 2013 },
      { start: 2014, end: 2017 },
      { start: 2018, end: 2021 },
      { start: 2022, end: 2025 },
    ])
  })

  it('clamps the final window to `to`', () => {
    expect(buildWindows(1994, 2000, 4)).toEqual([
      { start: 1994, end: 1997 },
      { start: 1998, end: 2000 },
    ])
  })

  it('exposes 8 basketball windows starting in 1994', () => {
    expect(BBALL_WINDOWS).toHaveLength(8)
    expect(BBALL_WINDOWS[0]).toEqual({ start: 1994, end: 1997 })
  })
})

describe('playerInWindow', () => {
  const w = { start: 2010, end: 2013 }
  it('includes a player whose tenure overlaps the window', () => {
    expect(playerInWindow(mk('a', 'PG', 2012, 2015), w)).toBe(true) // straddles
    expect(playerInWindow(mk('b', 'PG', 2010, 2013), w)).toBe(true) // exact
    expect(playerInWindow(mk('c', 'PG', 2009, 2010), w)).toBe(true) // last year touches
  })
  it('excludes a player entirely outside the window', () => {
    expect(playerInWindow(mk('d', 'PG', 2014, 2017), w)).toBe(false)
    expect(playerInWindow(mk('e', 'PG', 2006, 2009), w)).toBe(false)
  })
})

describe('eligiblePlayers', () => {
  const pool = [
    mk('zeke', 'PG', 2010, 2013),
    mk('alpha', 'PG', 2010, 2013),
    mk('center', 'C', 2011, 2014),
    mk('old', 'SF', 2000, 2003),
  ]
  it('filters by window AND open position, sorted by id', () => {
    const out = eligiblePlayers(pool, { start: 2010, end: 2013 }, ['PG', 'C'])
    expect(out.map((p) => p.id)).toEqual(['alpha', 'center', 'zeke'])
  })
  it('drops players whose position is already filled', () => {
    const out = eligiblePlayers(pool, { start: 2010, end: 2013 }, ['C'])
    expect(out.map((p) => p.id)).toEqual(['center'])
  })
})
