import { describe, it, expect } from 'vitest'
import type { YearWindow } from '../types'
import {
  REEL_LOOPS,
  REEL_VISIBLE,
  reelYears,
  buildReelPlan,
  buildIndexReelPlan,
} from './reel'

const W = (start: number, end: number): YearWindow => ({ start, end })

/** A rolling-style wheel: overlapping 4-year eras 1994–97 … 2000–03. */
function rollingWheel(): YearWindow[] {
  const out: YearWindow[] = []
  for (let s = 1994; s <= 2000; s++) out.push(W(s, s + 3))
  return out
}

describe('reelYears', () => {
  it('returns ascending, de-duplicated era start years', () => {
    const years = reelYears(rollingWheel())
    expect(years).toEqual([1994, 1995, 1996, 1997, 1998, 1999, 2000])
  })

  it('de-duplicates repeated starts and sorts out-of-order input', () => {
    const years = reelYears([W(2000, 2003), W(1994, 1997), W(2000, 2003)])
    expect(years).toEqual([1994, 2000])
  })

  it('is empty for an empty wheel', () => {
    expect(reelYears([])).toEqual([])
  })
})

describe('buildReelPlan', () => {
  it('renders REEL_LOOPS+1 passes of the strip', () => {
    const plan = buildReelPlan(rollingWheel(), 1997)
    expect(plan.years).toHaveLength(7)
    expect(plan.cells).toHaveLength((REEL_LOOPS + 1) * 7)
  })

  it('lands on the target year, in the final pass', () => {
    const plan = buildReelPlan(rollingWheel(), 1998)
    expect(plan.found).toBe(true)
    expect(plan.cells[plan.targetCell]).toBe(1998)
    // The landing cell is in the last pass, so the wheel travels every pass before it.
    expect(plan.targetCell).toBeGreaterThanOrEqual(
      REEL_LOOPS * plan.years.length,
    )
  })

  it('centres the target in the middle viewport slot', () => {
    const plan = buildReelPlan(rollingWheel(), 1996)
    // 1996 is index 2 of [1994..2000]; it lands in the final pass:
    //   targetCell = REEL_LOOPS * 7 + 2 = 4*7 + 2 = 30
    // and centres up by floor(3/2) = 1 → offset 29.
    expect(REEL_LOOPS).toBe(4) // guards the pinned 30/29 below
    expect(plan.targetCell).toBe(30)
    expect(plan.offset).toBe(29)
    expect(plan.cells[plan.targetCell]).toBe(1996)
  })

  it('travels a comparable distance for an early vs a late land', () => {
    const early = buildReelPlan(rollingWheel(), 1994)
    const late = buildReelPlan(rollingWheel(), 2000)
    // Both land in the final pass — the gap is at most one strip, never instant.
    expect(Math.abs(late.targetCell - early.targetCell)).toBeLessThan(
      early.years.length,
    )
    expect(early.targetCell).toBeGreaterThanOrEqual(
      REEL_LOOPS * early.years.length,
    )
  })

  it('honours a custom loop count', () => {
    const plan = buildReelPlan(rollingWheel(), 1995, 1)
    expect(plan.cells).toHaveLength(2 * 7) // (1 + 1) passes
  })

  it('flags a target that is not on the wheel (defensive)', () => {
    const plan = buildReelPlan(rollingWheel(), 2099)
    expect(plan.found).toBe(false)
    // Degrades to the first year rather than throwing.
    expect(plan.cells[plan.targetCell]).toBe(1994)
  })

  it('does not throw on an empty wheel, and keeps offset non-negative', () => {
    const plan = buildReelPlan([], 2000)
    expect(plan.years).toEqual([])
    expect(plan.cells).toEqual([])
    expect(plan.found).toBe(false)
    // Degenerate case: nothing to scroll to — offset must not go negative.
    expect(plan.targetCell).toBe(0)
    expect(plan.offset).toBe(0)
  })
})

describe('buildIndexReelPlan', () => {
  it('renders loops+1 passes of count cells, each pass 0..count-1', () => {
    const plan = buildIndexReelPlan(6, 2)
    expect(plan.count).toBe(6)
    expect(plan.cells).toHaveLength((REEL_LOOPS + 1) * 6)
    // First pass is the strip 0..5 in order.
    expect(plan.cells.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('lands on the target index, in the final pass, centred', () => {
    const plan = buildIndexReelPlan(6, 2)
    expect(plan.found).toBe(true)
    expect(plan.cells[plan.targetCell]).toBe(2)
    // Final pass: targetCell = REEL_LOOPS * 6 + 2 = 26; centre up by floor(3/2)=1.
    expect(plan.targetCell).toBe(REEL_LOOPS * 6 + 2)
    expect(plan.offset).toBe(plan.targetCell - Math.floor(REEL_VISIBLE / 2))
    expect(plan.targetCell).toBeGreaterThanOrEqual(REEL_LOOPS * plan.count)
  })

  it('honours a custom loop count', () => {
    const plan = buildIndexReelPlan(6, 0, 1)
    expect(plan.cells).toHaveLength(2 * 6) // (1 + 1) passes
  })

  it('flags an out-of-range index (defensive) and degrades to index 0', () => {
    const hi = buildIndexReelPlan(6, 9)
    expect(hi.found).toBe(false)
    expect(hi.cells[hi.targetCell]).toBe(0)
    const lo = buildIndexReelPlan(6, -1)
    expect(lo.found).toBe(false)
    expect(lo.cells[lo.targetCell]).toBe(0)
  })

  it('does not throw on a zero-count reel, keeping offset non-negative', () => {
    const plan = buildIndexReelPlan(0, 0)
    expect(plan.count).toBe(0)
    expect(plan.cells).toEqual([])
    expect(plan.found).toBe(false)
    expect(plan.targetCell).toBe(0)
    expect(plan.offset).toBe(0)
  })
})
