import { describe, it, expect } from 'vitest'
import {
  buildWindows,
  buildRollingWindows,
  datasetMaxYear,
  BBALL_WINDOWS,
  playerInWindow,
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
    seasons: [
      {
        year: last,
        stats: { pts: 10, reb: 4, ast: 3, stl: 1, blk: 0.5 },
        honors: [],
        source: 'test',
      },
    ],
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
    // The trailing partial year (2026) is folded into the final block rather
    // than left as a 1-year window, so the last era spans 2022–2026 (5 years).
    expect(BBALL_WINDOWS[BBALL_WINDOWS.length - 1]).toEqual({
      start: 2022,
      end: 2026,
    })
  })
})

describe('buildRollingWindows', () => {
  it('makes overlapping windows starting every year from `from`', () => {
    // size 4, maxYear 2000 → last start is 2000 - 4 + 1 = 1997.
    expect(buildRollingWindows(1994, 2000, 4)).toEqual([
      { start: 1994, end: 1997 },
      { start: 1995, end: 1998 },
      { start: 1996, end: 1999 },
      { start: 1997, end: 2000 },
    ])
  })

  it('caps the last era so it never extends past the most recent season', () => {
    // No window may end after maxYear. The latest start = maxYear - size + 1.
    const ws = buildRollingWindows(1994, 2026, 4)
    expect(ws[ws.length - 1]).toEqual({ start: 2023, end: 2026 })
    expect(ws.every((w) => w.end <= 2026)).toBe(true)
  })

  it('advances the era cap by one as a new season is added', () => {
    const ws2025 = buildRollingWindows(1994, 2025, 4)
    const ws2026 = buildRollingWindows(1994, 2026, 4)
    expect(ws2025[ws2025.length - 1]).toEqual({ start: 2022, end: 2025 })
    expect(ws2026[ws2026.length - 1]).toEqual({ start: 2023, end: 2026 })
  })

  it('slides the window start by exactly one year each step', () => {
    const ws = buildRollingWindows(2010, 2020, 4)
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i].start).toBe(ws[i - 1].start + 1) // slide-by-1 ⇒ size-1 overlap
      expect(ws[i].start).toBeLessThanOrEqual(ws[i - 1].end) // genuine overlap
    }
  })

  it('size 1 degenerates to one-year, non-overlapping windows', () => {
    expect(buildRollingWindows(2010, 2013, 1)).toEqual([
      { start: 2010, end: 2010 },
      { start: 2011, end: 2011 },
      { start: 2012, end: 2012 },
      { start: 2013, end: 2013 },
    ])
  })

  it('returns [] for a non-positive size', () => {
    expect(buildRollingWindows(1994, 2026, 0)).toEqual([])
    expect(buildRollingWindows(1994, 2026, -4)).toEqual([])
  })

  it('returns nothing when the span is shorter than one window', () => {
    expect(buildRollingWindows(2024, 2026, 4)).toEqual([]) // need 4 years, only 3
  })

  it('returns [] when `from` is past the cap entirely', () => {
    expect(buildRollingWindows(2030, 2026, 4)).toEqual([]) // from > maxYear
  })
})

describe('datasetMaxYear', () => {
  it('is the most recent season any player reached', () => {
    expect(
      datasetMaxYear([mk('a', 'PG', 1998, 2001), mk('b', 'C', 2010, 2014)]),
    ).toBe(2014)
  })

  it('is null for an empty player set', () => {
    expect(datasetMaxYear([])).toBe(null)
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
