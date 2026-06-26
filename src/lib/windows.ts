// Year-window config + player eligibility.
//
// A "window" is a 4-year span of season-ending years (one window ≈ one college
// career, per Alex's call). The daily game spins one window per draft round; you
// may only draft players whose Michigan tenure OVERLAPS the spun window.
//
// The LIVE daily wheel is now the data-driven ROLLING wheel: the app spins
// `buildRollingWindows(1994, datasetMaxYear(players), 4)` (overlapping 4-year
// eras, capped at the most recent season). `BBALL_WINDOWS` (the old fixed,
// non-overlapping blocks) is retained as a reference fixture and is still
// exercised by the dataset/coverage tests — it's no longer what the game spins.
// Windows are just data — the engine reads whatever array it's handed.

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
 * shorter than one full window, or for a non-positive `size`.
 */
export function buildRollingWindows(
  from: number,
  maxYear: number,
  size: number,
): YearWindow[] {
  if (size <= 0) return []
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
  return players.reduce<number>((m, p) => Math.max(m, p.lastYear), -Infinity)
}

/**
 * Basketball: 1994–2026 in 4-year blocks → 1994–97, 1998–01, … 2022–26. The span
 * (33 years) doesn't tile evenly into 4-year blocks, so the trailing partial year
 * (2026 — the championship season) is FOLDED into the final block: the last era
 * is 2022–26 (5 years) rather than a degenerate one-year 2026–26 window. Keeps the
 * wheel at 8 non-overlapping eras. As of #16 the live daily spins the data-driven
 * rolling wheel (`buildRollingWindows` + `datasetMaxYear`) instead; this fixed
 * list stays as a reference fixture and coverage-test baseline.
 */
export const BBALL_WINDOWS: YearWindow[] = (() => {
  const ws = buildWindows(1994, 2026, 4)
  const last = ws[ws.length - 1]
  if (ws.length > 1 && last.end - last.start + 1 < 4) {
    ws[ws.length - 2] = { ...ws[ws.length - 2], end: last.end }
    ws.pop()
  }
  return ws
})()

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
