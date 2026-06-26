// Year-window config + player eligibility.
//
// A "window" is a 4-year span of season-ending years (one window ≈ one college
// career, per Alex's call). The daily game spins one window per draft round; you
// may only draft players whose Michigan tenure OVERLAPS the spun window.
//
// The live `BBALL_WINDOWS` wheel is still NON-overlapping 4-year blocks from 1994
// on. `buildRollingWindows` (overlapping, data-driven era cap) is the tested
// foundation for the planned move to a rolling wheel; wiring it into the daily
// follows once the draft engine gains dead-era handling. Windows are just data —
// the engine reads whatever array is exported here.

import type { BballPlayer, YearWindow } from '../types'

/** Build contiguous non-overlapping windows of `size` years from `from`..`to`. */
export function buildWindows(
  from: number,
  to: number,
  size: number,
): YearWindow[] {
  const out: YearWindow[] = []
  for (let start = from; start <= to; start += size) {
    out.push({ start, end: Math.min(start + size - 1, to) })
  }
  return out
}

/**
 * Build ROLLING (overlapping) windows: every year in `from`..(maxYear-size+1)
 * starts its own `size`-year era, so 2012, 2013 and 2014 each begin an era and
 * consecutive windows slide by one year. The cap is data-driven — the latest
 * start is `maxYear - size + 1`, so an era never extends past the most recent
 * completed season (`maxYear`); when a new season lands in the data, `maxYear`
 * rises and the cap advances by one automatically. Returns [] when the span is
 * shorter than one full window.
 */
export function buildRollingWindows(
  from: number,
  maxYear: number,
  size: number,
): YearWindow[] {
  const out: YearWindow[] = []
  for (let start = from; start <= maxYear - size + 1; start++) {
    out.push({ start, end: start + size - 1 })
  }
  return out
}

/**
 * The most recent season any player in the set reached — the data-driven era
 * cap input for {@link buildRollingWindows}. Null for an empty set (no seasons,
 * so no windows).
 */
export function datasetMaxYear(
  players: ReadonlyArray<{ lastYear: number }>,
): number | null {
  if (players.length === 0) return null
  return players.reduce((m, p) => Math.max(m, p.lastYear), -Infinity)
}

/** Basketball: 1994–2025 in 4-year blocks → 1994–97, 1998–01, … 2022–25. */
export const BBALL_WINDOWS: YearWindow[] = buildWindows(1994, 2025, 4)

/** True if a tenure [firstYear, lastYear] overlaps the window. Sport-agnostic. */
export function tenureOverlaps(
  firstYear: number,
  lastYear: number,
  w: YearWindow,
): boolean {
  return firstYear <= w.end && lastYear >= w.start
}

/** True if the player's tenure [firstYear, lastYear] overlaps the window. */
export function playerInWindow(player: BballPlayer, w: YearWindow): boolean {
  return tenureOverlaps(player.firstYear, player.lastYear, w)
}
