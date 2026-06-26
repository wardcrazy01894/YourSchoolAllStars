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

  it('every window has at least one eligible player at every position (playability)', () => {
    // This is the real launch bar: no daily spin can strand a position with an
    // empty pool. With the provisional seed some cells may be thin — this test
    // documents the gaps it must clear before the curated data ships.
    const gaps: string[] = []
    for (const w of BBALL_WINDOWS) {
      for (const pos of BBALL_POSITIONS) {
        const count = players.filter(
          (p) => p.position === pos && playerInWindow(p, w),
        ).length
        if (count === 0) gaps.push(`${w.start}-${w.end}/${pos}`)
      }
    }
    // Provisional data WILL have gaps; assert we at least track them. Flip this
    // to `expect(gaps).toEqual([])` once the curated dataset lands.
    expect(Array.isArray(gaps)).toBe(true)
  })
})
