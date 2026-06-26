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
      // Always at least one season; each season is in-tenure and well-formed.
      expect(p.seasons.length).toBeGreaterThan(0)
      for (const s of p.seasons) {
        expect(s.year).toBeGreaterThanOrEqual(p.firstYear)
        expect(s.year).toBeLessThanOrEqual(p.lastYear)
        // Stats are PARTIAL by policy — but any present value is a number ≥ 0.
        for (const v of Object.values(s.stats)) {
          expect(typeof v).toBe('number')
          expect(v).toBeGreaterThanOrEqual(0)
        }
        expect(s.source.length).toBeGreaterThan(0)
        expect(Array.isArray(s.honors)).toBe(true)
      }
      // Season years are unique within a player (no duplicate season rows).
      const years = p.seasons.map((s) => s.year)
      expect(new Set(years).size).toBe(years.length)
    }
  })

  it('every player overlaps at least one basketball window', () => {
    for (const p of players) {
      expect(BBALL_WINDOWS.some((w) => playerInWindow(p, w))).toBe(true)
    }
  })

  it('every window × position has at least one eligible player (launch bar)', () => {
    // No daily spin can strand a position with an empty pool. All gaps filled —
    // a data edit that empties any cell adds a gap here and fails CI.
    const KNOWN_GAPS: string[] = []
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
