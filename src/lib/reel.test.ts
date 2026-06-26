import { describe, it, expect } from 'vitest'
import type { YearWindow } from '../types'
import { REEL_LOOPS, REEL_VISIBLE, reelYears, buildReelPlan } from './reel'

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

  it('centres the target: offset shifts it into the middle viewport slot', () => {
    const plan = buildReelPlan(rollingWheel(), 1996)
    expect(plan.offset).toBe(plan.targetCell - Math.floor(REEL_VISIBLE / 2))
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

  it('does not throw on an empty wheel', () => {
    const plan = buildReelPlan([], 2000)
    expect(plan.years).toEqual([])
    expect(plan.cells).toEqual([])
    expect(plan.found).toBe(false)
  })
})
