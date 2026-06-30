// Spin-wheel geometry (pure).
//
// The era spinner is a vertical wheel of era START years in chronological order.
// It scrolls upward — years counting up — fast at first then easing to a stop, so
// a player can see the wheel approaching its landing year. Where it stops is the
// FIRST year of the era they'll draft from.
//
// This module computes the deterministic geometry of that wheel (which years to
// render, and how far to translate so the target lands centred). The actual
// easing/timing lives in the React shell + CSS; everything here is unit-testable
// with no DOM.

import type { YearWindow } from '../types'

/** Whole cells visible in the wheel viewport; the MIDDLE one is the landing slot. */
export const REEL_VISIBLE = 3
/** Full passes through the year strip before it lands — the length of the "spin". */
export const REEL_LOOPS = 4

export interface ReelPlan {
  /** Ascending, de-duplicated era START years — the chronological strip. */
  years: number[]
  /** `years` repeated REEL_LOOPS+1 times, top→bottom: the cells we render. */
  cells: number[]
  /** Index into `cells` of the year the wheel lands on (placed in the LAST pass). */
  targetCell: number
  /** Cells to translate UP so `targetCell` sits in the centre (landing) slot. Never negative. */
  offset: number
  /** False if `targetYear` isn't on this wheel (defensive — shouldn't happen). */
  found: boolean
}

/** The chronological strip of era start years (ascending, de-duplicated). */
export function reelYears(windows: YearWindow[]): number[] {
  const set = new Set<number>()
  for (const w of windows) set.add(w.start)
  return [...set].sort((a, b) => a - b)
}

/** Index-based spin geometry — the same wheel maths over abstract cell indices. */
export interface IndexReelPlan {
  /** Strip length (distinct cells per pass). */
  count: number
  /** `0..count-1` repeated `loops+1` times, top→bottom: the cells we render. */
  cells: number[]
  /** Index into `cells` of the landing cell (placed in the LAST pass). */
  targetCell: number
  /** Cells to translate UP so `targetCell` sits in the centre slot. Never negative. */
  offset: number
  /** False if `targetIndex` is outside `[0, count)` (defensive). */
  found: boolean
}

/**
 * Plan a spin over a strip of `count` indexed cells that lands on `targetIndex`.
 * The strip is repeated `loops + 1` times and the landing cell is taken from the
 * LAST pass, so the wheel always travels at least `loops` full strips regardless
 * of where the target sits. `offset` centres the target in the viewport. This is
 * the index-based core; {@link buildReelPlan} layers era YEARS on top, and the
 * team reel (Full Basketball) drives it directly over school indices.
 */
export function buildIndexReelPlan(
  count: number,
  targetIndex: number,
  loops: number = REEL_LOOPS,
): IndexReelPlan {
  const passes = Math.max(1, loops) + 1
  const cells: number[] = []
  for (let i = 0; i < passes; i++) {
    for (let j = 0; j < count; j++) cells.push(j)
  }
  const found = targetIndex >= 0 && targetIndex < count
  // Land in the final pass so the wheel scrolls through every earlier pass first.
  const targetCell =
    count === 0 ? 0 : (passes - 1) * count + (found ? targetIndex : 0)
  // Centre it: the viewport shows REEL_VISIBLE cells; the middle slot is at
  // floor(REEL_VISIBLE/2) from the top. Clamp at 0 so the "translate UP" invariant
  // holds even for the degenerate zero-count reel.
  const offset = Math.max(0, targetCell - Math.floor(REEL_VISIBLE / 2))
  return { count, cells, targetCell, offset, found }
}

/**
 * Plan a spin that lands on `targetYear`. The strip is repeated `loops + 1` times
 * and the landing year is taken from the LAST pass, so the wheel always travels
 * at least `loops` full strips regardless of where the target sits — a 1994 land
 * spins just as long as a 2023 land. `offset` centres the target in the viewport.
 * Delegates the geometry to {@link buildIndexReelPlan}, mapping indices back to
 * the era start years.
 */
export function buildReelPlan(
  windows: YearWindow[],
  targetYear: number,
  loops: number = REEL_LOOPS,
): ReelPlan {
  const years = reelYears(windows)
  const plan = buildIndexReelPlan(
    years.length,
    years.indexOf(targetYear),
    loops,
  )
  return {
    years,
    cells: plan.cells.map((i) => years[i]),
    targetCell: plan.targetCell,
    offset: plan.offset,
    found: plan.found,
  }
}
