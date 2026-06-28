// Shared domain types for YourSchoolAllStars.
//
// A "school" hosts two games — basketball and football — but only the data
// differs; the engine (windows, daily spins, rating → projected record, draft
// reducer) is sport-parameterized. Multiple schools ship basketball, and
// Michigan football (2016+) is live — all behind the same contracts.

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
  /**
   * Honors the player earned within the seasons this row represents (e.g.
   * "Consensus All-American (2013)"). A migrated single-season row represents a
   * player's whole career and so carries their full honor set; the per-season
   * backfill splits players into one row per year and binds each honor to its
   * own year. Until then, honors here may carry a year outside `year`.
   */
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
  /** Year the player's FIRST season at their school ended (1993-94 → 1994). */
  firstYear: number
  /** Year the player's LAST season at their school ended. */
  lastYear: number
  /**
   * Every season the player is represented by, oldest first. Always non-empty.
   * The engine picks the best season within the spun window for stats/rating;
   * tenure ([firstYear, lastYear]) still governs which windows they APPEAR in.
   */
  seasons: BballSeason[]
  /**
   * Years INSIDE [firstYear, lastYear] the player was on the roster but did not
   * play — a medical (or other) redshirt. They legitimately have no `seasons` row
   * for these years, yet the year still falls within their tenure (so they keep
   * the real seasons on both sides instead of being truncated to a shorter span).
   * The per-player tenure-coverage guard treats a declared redshirt year as
   * covered; an UNdeclared hole is still a sourcing gap and fails CI. (Alex,
   * 2026-06-27: "the guard shouldn't forbid a medical redshirt year — keep all
   * those years, it's OK he doesn't have the redshirt one.")
   */
  redshirtYears?: number[]
}

/** The slots a player may fill — their explicit `eligible` list or just primary. */
export function eligiblePositions(p: BballPlayer): BballPosition[] {
  return p.eligible && p.eligible.length > 0 ? p.eligible : [p.position]
}

/**
 * Years in a player's tenure that lack a season row AND aren't a declared
 * redshirt — i.e. real sourcing holes. Empty = fully covered. A medical redshirt
 * (in `redshirtYears`) is an intentional gap and is NOT reported here, so the
 * player keeps every real season on both sides of it rather than being truncated.
 */
export function tenureGapYears(p: BballPlayer): number[] {
  const have = new Set(p.seasons.map((s) => s.year))
  const redshirt = new Set(p.redshirtYears ?? [])
  const gaps: number[] = []
  for (let y = p.firstYear; y <= p.lastYear; y++) {
    if (!have.has(y) && !redshirt.has(y)) gaps.push(y)
  }
  return gaps
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
// (DE/DT/LB/CB/S + 1 FLEX). Football data starts at 2016 — the CFBD API's
// defensive box scores (tackles/sacks/TFL) only exist from then, and a window
// needs both sides (see docs/DATA-SOURCING.md).

export type FbOffPosition = 'QB' | 'RB' | 'WR' | 'TE'
export type FbDefPosition = 'DE' | 'DT' | 'LB' | 'CB' | 'S'
export type FbPosition = FbOffPosition | FbDefPosition

export const FB_OFF_POSITIONS: FbOffPosition[] = ['QB', 'RB', 'WR', 'TE']
export const FB_DEF_POSITIONS: FbDefPosition[] = ['DE', 'DT', 'LB', 'CB', 'S']

/**
 * Per-season stats. Heterogeneous by position, so every field is optional; the
 * UI/rating reads the columns relevant to the player's position. All counting
 * stats are SEASON TOTALS — yards, TDs, and the defensive box score (tackles,
 * TFL, sacks, INTs, PBUs, FFs) alike. The rating refs in `football-rating.ts`
 * assume totals (e.g. an elite LB ≈ 120 tackles/season), so entering per-game
 * numbers would silently crater a defender's rating.
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

/**
 * Every valid `FbStats` field, as a runtime list. `satisfies` ties it to the type
 * so a typo (or a renamed field) fails to compile; the dataset guard uses it to
 * reject rows carrying an unknown stat key (which would silently score 0).
 */
export const FB_STAT_KEYS = [
  'passYds',
  'passTD',
  'passInt',
  'rushYds',
  'rushTD',
  'rec',
  'recYds',
  'recTD',
  'tackles',
  'tfl',
  'sacks',
  'defInt',
  'pbu',
  'ff',
] as const satisfies readonly (keyof FbStats)[]

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
