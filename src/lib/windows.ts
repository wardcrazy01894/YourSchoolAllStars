// Year-window config + player eligibility.
//
// A "window" is a 4-year span of season-ending years (one window ≈ one college
// career, per Alex's call). The daily game spins one window per draft round; you
// may only draft players whose Michigan tenure OVERLAPS the spun window.
//
// Windows are NON-overlapping 4-year blocks from 1994 on. They're just data —
// to retune granularity (e.g. to 3-year or rolling windows) edit `buildWindows`
// or the exported arrays; the engine reads whatever is here.

import type { BballPlayer, BballPosition, YearWindow } from '../types'

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

/** Basketball: 1994–2025 in 4-year blocks → 1994–97, 1998–01, … 2022–25. */
export const BBALL_WINDOWS: YearWindow[] = buildWindows(1994, 2025, 4)

/** True if the player's tenure [firstYear, lastYear] overlaps the window. */
export function playerInWindow(player: BballPlayer, w: YearWindow): boolean {
  return player.firstYear <= w.end && player.lastYear >= w.start
}

/**
 * Players draftable right now: eligible for the window AND playing a position
 * that is still open. Returned sorted by id for deterministic ordering (the UI
 * re-sorts by the user's chosen stat column).
 */
export function eligiblePlayers(
  pool: BballPlayer[],
  w: YearWindow,
  openPositions: BballPosition[],
): BballPlayer[] {
  const open = new Set(openPositions)
  return pool
    .filter((p) => open.has(p.position) && playerInWindow(p, w))
    .sort((a, b) => a.id.localeCompare(b.id))
}
