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
  /** Cells to translate UP so `targetCell` sits in the centre (landing) slot. */
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

/**
 * Plan a spin that lands on `targetYear`. The strip is repeated `loops + 1` times
 * and the landing year is taken from the LAST pass, so the wheel always travels
 * at least `loops` full strips regardless of where the target sits — a 1994 land
 * spins just as long as a 2023 land. `offset` centres the target in the viewport.
 */
export function buildReelPlan(
  windows: YearWindow[],
  targetYear: number,
  loops: number = REEL_LOOPS,
): ReelPlan {
  const years = reelYears(windows)
  const passes = Math.max(1, loops) + 1
  const cells: number[] = []
  for (let i = 0; i < passes; i++) cells.push(...years)

  const idx = years.indexOf(targetYear)
  const found = idx >= 0
  // Land in the final pass so the wheel scrolls through every earlier pass first.
  const targetCell =
    years.length === 0 ? 0 : (passes - 1) * years.length + (found ? idx : 0)
  // Centre it: the viewport shows REEL_VISIBLE cells; the middle slot is at
  // floor(REEL_VISIBLE/2) from the top, so shift the target up by that many.
  const offset = targetCell - Math.floor(REEL_VISIBLE / 2)

  return { years, cells, targetCell, offset, found }
}
