// Shared domain types for YourSchoolAllStars.
//
// A "school" hosts two games — basketball and football — but only the data
// differs; the engine (windows, daily spins, rating → projected record, draft
// reducer) is sport-parameterized. v1 ships Michigan basketball; football
// (2005+) and North Carolina are staged behind the same contracts.

export type Sport = 'basketball' | 'football'

// ── Basketball ───────────────────────────────────────────────────────────────
export type BballPosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C'

export const BBALL_POSITIONS: BballPosition[] = ['PG', 'SG', 'SF', 'PF', 'C']

export interface BballStats {
  pts: number // points per game
  reb: number // rebounds per game
  ast: number // assists per game
  stl: number // steals per game
  blk: number // blocks per game
}

export interface BballPlayer {
  id: string
  name: string
  position: BballPosition
  /** Year the player's FIRST Michigan season ended (1993-94 → 1994). */
  firstYear: number
  /** Year the player's LAST Michigan season ended. */
  lastYear: number
  /** Year of the season the `stats` below describe (their best season). */
  bestSeason: number
  /** Per-game stats for `bestSeason`. */
  stats: BballStats
  /** Honors earned (e.g. "Consensus All-American (2013)"). Empty if none. */
  honors: string[]
  /** Provenance: the URL the stats were sourced/verified from. */
  source: string
}

// ── Windows ──────────────────────────────────────────────────────────────────
/** A draft era: an inclusive range of season-ending years, e.g. 1994–1997. */
export interface YearWindow {
  start: number
  end: number
}

export function windowLabel(w: YearWindow): string {
  return `${w.start}–${w.end}`
}
