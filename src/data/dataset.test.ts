// Dataset integrity guard. Runs against whatever is bundled, so it protects both
// the provisional seed and the curated set: a malformed player row fails CI.

import { describe, it, expect } from 'vitest'
import { michiganBasketball } from './index'
import { BBALL_WINDOWS, playerInWindow } from '../lib/windows'
import { BBALL_POSITIONS } from '../types'

const { players } = michiganBasketball

describe('michigan basketball dataset', () => {
  it('has players', () => {
    expect(players.length).toBeGreaterThan(0)
  })

  it('every id is unique', () => {
    const ids = players.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every row is well-formed', () => {
    for (const p of players) {
      expect(BBALL_POSITIONS).toContain(p.position)
      expect(p.firstYear).toBeLessThanOrEqual(p.lastYear)
      expect(p.bestSeason).toBeGreaterThanOrEqual(p.firstYear)
      expect(p.bestSeason).toBeLessThanOrEqual(p.lastYear)
      for (const v of Object.values(p.stats)) {
        expect(typeof v).toBe('number')
        expect(v).toBeGreaterThanOrEqual(0)
      }
      expect(p.source.length).toBeGreaterThan(0)
      expect(Array.isArray(p.honors)).toBe(true)
    }
  })

  it('every player overlaps at least one basketball window', () => {
    for (const p of players) {
      expect(BBALL_WINDOWS.some((w) => playerInWindow(p, w))).toBe(true)
    }
  })

  it('window × position coverage only has the known (tracked) gaps', () => {
    // Launch bar: no daily spin should strand a position with an empty pool.
    // These cells still lack a sourced player (thin late-90s/early-00s + one
    // 2018-21/PF). Each gap-fill PR deletes an entry here until it's []. Until
    // then the UI's reroll/skip covers a stranded cell. See docs/BACKLOG.md.
    const KNOWN_GAPS = [
      '1998-2001/PF',
      '1998-2001/PG',
      '2002-2005/C',
      '2002-2005/PF',
      '2018-2021/PF',
    ]
    const gaps: string[] = []
    for (const w of BBALL_WINDOWS) {
      for (const pos of BBALL_POSITIONS) {
        const count = players.filter(
          (p) => p.position === pos && playerInWindow(p, w),
        ).length
        if (count === 0) gaps.push(`${w.start}-${w.end}/${pos}`)
      }
    }
    // A data edit that empties a covered cell adds a NEW gap and fails CI;
    // filling a known gap without updating KNOWN_GAPS also fails. Trends to [].
    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort())
  })
})
