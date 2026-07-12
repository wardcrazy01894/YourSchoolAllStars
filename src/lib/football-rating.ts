// Football rating model: per-position stat line → player rating → team strength
// → projected record out of 16 (a perfect college season is 16-0).
//
// This mirrors the basketball model (`rating.ts`) but football's box score is
// HETEROGENEOUS — a QB's passing yards and a corner's interceptions live on
// totally different scales — so a single shared weight vector can't compare them.
// Instead each position has its own table of {stat, ref, weight}: a stat is
// scored as `value / ref * weight`, where `ref` is an elite single-season mark
// for that position. An "all-refs" season at any position lands at roughly the
// same composite (~42), so the SAME curve gives a 6'5" pocket passer and a ball-
// hawking safety comparable elite ratings. Every constant here is a documented
// FIRST CUT, meant to be retuned (as the basketball model was) once real data and
// playtesting expose where it's too generous or too harsh.

import type {
  FbPlayer,
  FbPosition,
  FbSeason,
  FbStats,
  YearWindow,
} from '../types'
import { NON_POWER5_RATING_FACTOR } from './rating'

/** A perfect college football season — 16-0 (12 regular + conference title +
 *  playoff run, in the expanded-playoff era). */
export const FB_GAMES = 16

// ── Per-player rating ────────────────────────────────────────────────────────

/** One scored stat for a position: `value / ref * weight`, optionally negative
 *  (e.g. a QB's interceptions). `ref` is an elite single-season benchmark. */
interface FbStatTerm {
  stat: keyof FbStats
  ref: number
  weight: number
  /** -1 for a penalty stat (interceptions thrown); defaults to +1. */
  sign?: 1 | -1
}

// Per-position scoring tables. Positive weights sum to ~42 at every position so
// an elite season is comparable across positions; refs are elite-season marks
// (≈ a first-team All-American line). Tunable first cut.
const FB_RATING_TERMS: Record<FbPosition, FbStatTerm[]> = {
  QB: [
    // Passing carries the bulk of the budget so a pure pocket passer rates well
    // on stats alone; rushing is a bonus for dual-threats, not a requirement.
    { stat: 'passYds', ref: 3500, weight: 18 },
    { stat: 'passTD', ref: 35, weight: 16 },
    { stat: 'rushYds', ref: 700, weight: 5 },
    { stat: 'rushTD', ref: 10, weight: 3 },
    { stat: 'passInt', ref: 10, weight: 6, sign: -1 },
  ],
  RB: [
    { stat: 'rushYds', ref: 1500, weight: 20 },
    { stat: 'rushTD', ref: 18, weight: 12 },
    { stat: 'rec', ref: 35, weight: 4 },
    { stat: 'recYds', ref: 400, weight: 4 },
    { stat: 'recTD', ref: 4, weight: 2 },
  ],
  WR: [
    { stat: 'rec', ref: 70, weight: 14 },
    { stat: 'recYds', ref: 1100, weight: 20 },
    { stat: 'recTD', ref: 11, weight: 10 },
    { stat: 'rushYds', ref: 150, weight: 1 },
  ],
  TE: [
    { stat: 'rec', ref: 50, weight: 16 },
    { stat: 'recYds', ref: 650, weight: 18 },
    { stat: 'recTD', ref: 7, weight: 10 },
  ],
  DE: [
    { stat: 'sacks', ref: 11, weight: 18 },
    { stat: 'tfl', ref: 18, weight: 12 },
    { stat: 'tackles', ref: 55, weight: 6 },
    { stat: 'ff', ref: 4, weight: 4 },
    { stat: 'defInt', ref: 2, weight: 2 },
  ],
  DT: [
    { stat: 'sacks', ref: 7, weight: 16 },
    { stat: 'tfl', ref: 13, weight: 12 },
    { stat: 'tackles', ref: 50, weight: 10 },
    { stat: 'ff', ref: 3, weight: 4 },
  ],
  LB: [
    { stat: 'tackles', ref: 120, weight: 16 },
    { stat: 'tfl', ref: 15, weight: 10 },
    { stat: 'sacks', ref: 6, weight: 8 },
    { stat: 'defInt', ref: 3, weight: 5 },
    { stat: 'pbu', ref: 6, weight: 3 },
    { stat: 'ff', ref: 3, weight: 3 },
  ],
  CB: [
    { stat: 'defInt', ref: 5, weight: 16 },
    { stat: 'pbu', ref: 14, weight: 14 },
    { stat: 'tackles', ref: 55, weight: 8 },
    { stat: 'tfl', ref: 4, weight: 3 },
    { stat: 'ff', ref: 2, weight: 3 },
  ],
  S: [
    { stat: 'tackles', ref: 90, weight: 14 },
    { stat: 'defInt', ref: 4, weight: 12 },
    { stat: 'pbu', ref: 9, weight: 8 },
    { stat: 'tfl', ref: 7, weight: 5 },
    { stat: 'ff', ref: 3, weight: 3 },
  ],
}

/**
 * Position-aware stat composite. Reads ONLY the columns relevant to the player's
 * position; a missing field counts as 0 (a partial line degrades gracefully
 * rather than NaN). Penalty stats (QB interceptions) subtract.
 */
export function fbStatComposite(position: FbPosition, stats: FbStats): number {
  let c = 0
  for (const t of FB_RATING_TERMS[position]) {
    const v = stats[t.stat] ?? 0
    c += (v / t.ref) * t.weight * (t.sign ?? 1)
  }
  return c
}

// Honors add to the composite before the curve (recognition the box score
// misses). Normalized (lowercase, hyphens→spaces) and matched by feature, not by
// brittle adjacent-substring matching — mirrors `rating.honorTier`.
export function fbHonorTier(honor: string): number {
  const s = honor.toLowerCase().replace(/-/g, ' ')
  const has = (...words: string[]) => words.every((w) => s.includes(w))
  if (s.includes('heisman')) return 12
  if (s.includes('all american'))
    return s.includes('consensus') || s.includes('unanimous') ? 9 : 6
  if (has('player of the year')) return 6 // national or conference POY
  if (has('first team all')) return 4 // first-team all-conference
  if (has('freshman of the year')) return 3
  if (s.includes('all big ten') || s.includes('all conference')) return 3
  return 0
}

export function fbHonorsBonus(honors: string[]): number {
  return honors.reduce((sum, h) => sum + fbHonorTier(h), 0)
}

/** Curve steepness: composite that maps to ~63 rating. Larger = harsher. */
export const FB_RATING_SCALE = 22

/** Map a raw composite onto the [0,100] diminishing-returns curve. */
function fbCurve(composite: number): number {
  const r = 100 * (1 - Math.exp(-composite / FB_RATING_SCALE))
  return Math.round(Math.max(0, Math.min(100, r)))
}

/** A non-power-5 program's production is discounted, same flat factor as
 *  basketball (a school-level conference adjustment, sport-independent). */
export const FB_NON_POWER5_RATING_FACTOR = NON_POWER5_RATING_FACTOR

// ── Season selection (mirrors rating.ts) ─────────────────────────────────────

/** Raw composite for ONE season: position-relevant stats + that year's honors. */
export function fbSeasonComposite(
  position: FbPosition,
  season: FbSeason,
): number {
  return fbStatComposite(position, season.stats) + fbHonorsBonus(season.honors)
}

/** Rating in [0,100] for ONE season at the player's position. */
export function fbSeasonRating(position: FbPosition, season: FbSeason): number {
  return fbCurve(fbSeasonComposite(position, season))
}

/**
 * The player's highest-rated season overall (career best). Null if none.
 * Ties resolve to the EARLIER season (strict `>`, seasons are oldest-first).
 */
export function fbBestSeason(player: FbPlayer): FbSeason | null {
  let best: FbSeason | null = null
  let bestC = -Infinity
  for (const s of player.seasons) {
    const c = fbSeasonComposite(player.position, s)
    if (c > bestC) {
      bestC = c
      best = s
    }
  }
  return best
}

/**
 * The player's best season whose `year` falls INSIDE the window — a 2014–2017
 * era may only credit 2014–2017 seasons, never a peak outside it. Null when
 * the player has no season row in-window.
 */
export function fbBestSeasonInWindow(
  player: FbPlayer,
  w: YearWindow,
): FbSeason | null {
  let best: FbSeason | null = null
  let bestC = -Infinity
  for (const s of player.seasons) {
    if (s.year < w.start || s.year > w.end) continue
    const c = fbSeasonComposite(player.position, s)
    if (c > bestC) {
      bestC = c
      best = s
    }
  }
  return best
}

/**
 * The season to represent a player by within a window: their best IN-window
 * season. The career-best fallback exists only for out-of-contract callers
 * (e.g. replaying a stale save whose window no longer matches the player's
 * rows) — live eligibility requires an in-window season row, so the fallback
 * never fires during play.
 */
export function fbSeasonForWindow(
  player: FbPlayer,
  w: YearWindow,
): FbSeason | null {
  return fbBestSeasonInWindow(player, w) ?? fbBestSeason(player)
}

/**
 * Player rating in [0,100]. With a window, rate the player's best season
 * within it (stale-save fallback to career best); without one, rate their
 * career best. 0 for a player with no seasons. `power5` defaults true (no
 * penalty); pass false to apply the non-power-5 haircut.
 */
export function fbPlayerRating(
  player: FbPlayer,
  w?: YearWindow,
  power5 = true,
): number {
  const season = w ? fbSeasonForWindow(player, w) : fbBestSeason(player)
  const base = season ? fbSeasonRating(player.position, season) : 0
  return power5 ? base : Math.round(base * FB_NON_POWER5_RATING_FACTOR)
}

// ── Team strength & projected record ─────────────────────────────────────────
//
// Same shape as basketball: position-weighted mean blended with the WORST
// starter ("no weak links"), logistic-mapped to a per-game win probability and
// scaled to 16 games, with hard undefeated/winless cutoffs at the tails.

/** Position multipliers toward the TEAM score (not the player's own rating).
 *  QB is the premium spot; edge and the off-ball linebacker tick up slightly. */
export const FB_POSITION_WEIGHT: Record<FbPosition, number> = {
  QB: 1.25,
  RB: 1.0,
  WR: 1.05,
  TE: 0.95,
  DE: 1.1,
  DT: 1.0,
  LB: 1.05,
  CB: 1.05,
  S: 1.0,
}

/** Share of team strength from the worst starter (mirrors basketball's eased value). */
export const FB_WEAK_LINK_BLEND = 0.25
/** Team strength giving a coin-flip team. */
export const FB_WIN_PIVOT = 57
export const FB_WIN_SPREAD = 7.5
/** A roster this strong (displayed/rounded) simply runs the table — 16-0. */
export const FB_UNDEFEATED_STRENGTH = 85
/** The mirror floor: below this a roster is winless (0-16). */
export const FB_WINLESS_STRENGTH = 30

export interface RatedFbStarter {
  position: FbPosition
  rating: number
}

/** Position-weighted, weak-link-penalized team strength in [0,100]. */
export function fbTeamStrength(starters: RatedFbStarter[]): number {
  if (starters.length === 0) return 0
  let wSum = 0
  let wTot = 0
  let min = Infinity
  for (const s of starters) {
    const w = FB_POSITION_WEIGHT[s.position]
    wSum += s.rating * w
    wTot += w
    if (s.rating < min) min = s.rating
  }
  const weightedMean = wSum / wTot
  return (1 - FB_WEAK_LINK_BLEND) * weightedMean + FB_WEAK_LINK_BLEND * min
}

/** Per-game win probability for a given team strength. */
export function fbWinProbability(strength: number): number {
  return 1 / (1 + Math.exp(-(strength - FB_WIN_PIVOT) / FB_WIN_SPREAD))
}

/** Projected wins out of `games` (default 16 for football). */
export function fbProjectedWins(
  starters: RatedFbStarter[],
  games = FB_GAMES,
): number {
  const strength = fbTeamStrength(starters)
  if (Math.round(strength) >= FB_UNDEFEATED_STRENGTH) return games
  if (Math.round(strength) < FB_WINLESS_STRENGTH) return 0
  return Math.round(fbWinProbability(strength) * games)
}

/** "12–4", "16–0", etc. (en dash). */
export function fbRecordLabel(wins: number, games = FB_GAMES): string {
  return `${wins}–${games - wins}`
}

/** A flavor grade for the final record. */
export function fbGradeLabel(wins: number, games = FB_GAMES): string {
  if (wins === games) return 'PERFECT'
  if (wins === 0) return 'WINLESS'
  const pct = wins / games
  if (pct >= 0.9) return 'HISTORIC'
  if (pct >= 0.8) return 'ELITE'
  if (pct >= 0.65) return 'SOLID'
  if (pct >= 0.5) return 'BOWL'
  return 'REBUILD'
}
