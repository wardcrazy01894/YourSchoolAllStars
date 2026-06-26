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

/**
 * Per-game stats for ONE season. Partial by design: older role players don't
 * always have a full published line (per the data policy — see CLAUDE.md /
 * docs/DATA-SOURCING.md). A missing field means "unknown", which the rating
 * model treats as 0. Starters should still carry the full five.
 */
export type BballSeasonStats = Partial<BballStats>

/**
 * One season of a player's career. The dataset stores every season a player is
 * relevant for, so the game can represent them by their best season WITHIN the
 * spun window (not a single career-best line). `year` is the season-ending year
 * (2012-13 → 2013).
 */
export interface BballSeason {
  year: number
  stats: BballSeasonStats
  /** Honors earned THAT season (e.g. "Consensus All-American (2013)"). */
  honors: string[]
  /** Provenance: the URL the season's stats were sourced/verified from. */
  source: string
}

export interface BballPlayer {
  id: string
  /** Primary position — used for grouping/display in the pool. */
  position: BballPosition
  /**
   * All slots this player may fill (defaults to `[position]`). Lets a combo guard
   * be drafted at PG or SG, etc. The player picks which open slot at draft time.
   */
  eligible?: BballPosition[]
  name: string
  /** Year the player's FIRST Michigan season ended (1993-94 → 1994). */
  firstYear: number
  /** Year the player's LAST Michigan season ended. */
  lastYear: number
  /**
   * Every season the player is represented by, oldest first. Always non-empty.
   * The engine picks the best season within the spun window for stats/rating;
   * tenure ([firstYear, lastYear]) still governs which windows they APPEAR in.
   */
  seasons: BballSeason[]
}

/** The slots a player may fill — their explicit `eligible` list or just primary. */
export function eligiblePositions(p: BballPlayer): BballPosition[] {
  return p.eligible && p.eligible.length > 0 ? p.eligible : [p.position]
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

// ── Football ─────────────────────────────────────────────────────────────────
// 16-0 style: a 12-man roster — 6 offense (QB/RB/WR/TE + 2 FLEX) and 6 defense
// (DE/DT/LB/CB/S + 1 FLEX). Football data starts at 2005 (defensive box-score
// stats — tackles/sacks — aren't reliable before then).

export type FbOffPosition = 'QB' | 'RB' | 'WR' | 'TE'
export type FbDefPosition = 'DE' | 'DT' | 'LB' | 'CB' | 'S'
export type FbPosition = FbOffPosition | FbDefPosition

export const FB_OFF_POSITIONS: FbOffPosition[] = ['QB', 'RB', 'WR', 'TE']
export const FB_DEF_POSITIONS: FbDefPosition[] = ['DE', 'DT', 'LB', 'CB', 'S']

/**
 * Per-season stats. Heterogeneous by position, so every field is optional; the
 * UI/rating reads the columns relevant to the player's position. Per-game where
 * it makes sense for defense (tackles), season totals for the rest (yards, TDs).
 */
export interface FbStats {
  // Offense
  passYds?: number
  passTD?: number
  passInt?: number // interceptions thrown (QB)
  rushYds?: number
  rushTD?: number
  rec?: number
  recYds?: number
  recTD?: number
  // Defense
  tackles?: number // total tackles (season)
  tfl?: number // tackles for loss
  sacks?: number
  defInt?: number // interceptions made
  pbu?: number // passes broken up / defended
  ff?: number // forced fumbles
}

export interface FbPlayer {
  id: string
  name: string
  position: FbPosition
  firstYear: number
  lastYear: number
  bestSeason: number
  stats: FbStats
  honors: string[]
  source: string
}

/** A roster slot. Single-position slots accept one position; FLEX accepts many. */
export interface RosterSlot {
  id: string
  label: string
  side: 'offense' | 'defense'
  accepts: FbPosition[]
}

/** The 12 starting slots, in draft/display order (offense, then defense). */
export const FB_SLOTS: RosterSlot[] = [
  { id: 'QB', label: 'QB', side: 'offense', accepts: ['QB'] },
  { id: 'RB', label: 'RB', side: 'offense', accepts: ['RB'] },
  { id: 'WR', label: 'WR', side: 'offense', accepts: ['WR'] },
  { id: 'TE', label: 'TE', side: 'offense', accepts: ['TE'] },
  { id: 'FLEX1', label: 'FLEX', side: 'offense', accepts: ['RB', 'WR', 'TE'] },
  { id: 'FLEX2', label: 'FLEX', side: 'offense', accepts: ['RB', 'WR', 'TE'] },
  { id: 'DE', label: 'DE', side: 'defense', accepts: ['DE'] },
  { id: 'DT', label: 'DT', side: 'defense', accepts: ['DT'] },
  { id: 'LB', label: 'LB', side: 'defense', accepts: ['LB'] },
  { id: 'CB', label: 'CB', side: 'defense', accepts: ['CB'] },
  { id: 'S', label: 'S', side: 'defense', accepts: ['S'] },
  {
    id: 'DFLEX',
    label: 'FLEX',
    side: 'defense',
    accepts: ['DE', 'DT', 'LB', 'CB', 'S'],
  },
]
