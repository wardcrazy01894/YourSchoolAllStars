// Rating model: stat line → player rating → team strength → projected record.
//
// This is OUR model (40-0's is proprietary). Every constant below is tunable and
// documented in docs/PLAN.md §"Rating model". The shape mirrors what 40-0
// teaches in its tutorial:
//   • a player's rating bakes in the whole stat line plus honors,
//   • premium positions (PG, C) weigh more toward the team score,
//   • "no weak links" — one bad starter drags the record down,
//   • the team's strength maps to a projected record out of N games.

import type {
  BballPlayer,
  BballPosition,
  BballSeason,
  BballSeasonStats,
  BballStats,
  YearWindow,
} from '../types'

// ── Per-player rating ────────────────────────────────────────────────────────
//
// Fantasy-style composite: rarer, higher-leverage stats are weighted up. Steals
// and blocks are scarce so they carry the most per-unit value; points the least.
export const STAT_WEIGHTS: Record<keyof BballStats, number> = {
  pts: 1.0,
  reb: 1.2,
  ast: 1.5,
  stl: 3.0,
  blk: 3.0,
}

// Honors add to the composite before the curve (recognition the box score
// misses). Real honor strings carry team qualifiers and hyphens — e.g.
// "Consensus Second-Team All-American (2021)", "First-Team All-Big Ten" — so we
// normalize (lowercase, hyphens→spaces) and score by feature, NOT by brittle
// adjacent-substring matching. `honorTier` returns the single best tier for one
// honor string; `honorsBonus` sums across a player's honors.
export function honorTier(honor: string): number {
  const s = honor.toLowerCase().replace(/-/g, ' ')
  const has = (...words: string[]) => words.every((w) => s.includes(w))
  if (has('national', 'player of the year')) return 12
  if (s.includes('wooden') || s.includes('naismith')) return 10
  if (s.includes('all american')) return s.includes('consensus') ? 9 : 6
  if (s.includes('player of the year')) return 6 // conference POY
  if (s.includes('first team all')) return 4 // all-conference first team
  if (s.includes('freshman of the year')) return 3
  if (s.includes('all big ten') || s.includes('all conference')) return 3
  return 0
}

/** Curve steepness: composite that maps to ~63 rating. Larger = harsher. */
export const RATING_SCALE = 22

/** Position multipliers toward the TEAM score (not the player's own rating). */
export const POSITION_WEIGHT: Record<BballPosition, number> = {
  PG: 1.15,
  SG: 1.0,
  SF: 1.0,
  PF: 1.0,
  C: 1.1,
}

export function honorsBonus(honors: string[]): number {
  return honors.reduce((sum, h) => sum + honorTier(h), 0)
}

/**
 * Stat composite. Accepts a PARTIAL line — a missing field counts as 0 (the
 * data policy allows partial lines for role players; rating must degrade
 * gracefully rather than NaN).
 */
export function statComposite(stats: BballSeasonStats): number {
  return (
    (stats.pts ?? 0) * STAT_WEIGHTS.pts +
    (stats.reb ?? 0) * STAT_WEIGHTS.reb +
    (stats.ast ?? 0) * STAT_WEIGHTS.ast +
    (stats.stl ?? 0) * STAT_WEIGHTS.stl +
    (stats.blk ?? 0) * STAT_WEIGHTS.blk
  )
}

/** A single season's composite (stat line + that season's honors). */
export function seasonComposite(season: BballSeason): number {
  return statComposite(season.stats) + honorsBonus(season.honors)
}

/** Map a raw composite onto the [0,100] diminishing-returns curve. */
function curve(composite: number): number {
  const r = 100 * (1 - Math.exp(-composite / RATING_SCALE))
  return Math.round(Math.max(0, Math.min(100, r)))
}

/**
 * Rating in [0,100] for ONE season. Diminishing-returns curve so elite seasons
 * separate at the top without an arbitrary hard cap.
 */
export function seasonRating(season: BballSeason): number {
  return curve(seasonComposite(season))
}

/**
 * The player's highest-rated season overall (career best). Null if none.
 * Ties resolve to the EARLIER season (strict `>`, seasons are oldest-first).
 */
export function bestSeason(player: BballPlayer): BballSeason | null {
  let best: BballSeason | null = null
  let bestC = -Infinity
  for (const s of player.seasons) {
    const c = seasonComposite(s)
    if (c > bestC) {
      bestC = c
      best = s
    }
  }
  return best
}

/**
 * The player's best season whose `year` falls INSIDE the window. This is the
 * spec'd behavior: a 2010–2013 window may only credit a player's 2010–2013
 * seasons, never a later peak. Null when the player has no season row in-window.
 * Ties resolve to the EARLIER season (strict `>`, seasons are oldest-first).
 */
export function bestSeasonInWindow(
  player: BballPlayer,
  w: YearWindow,
): BballSeason | null {
  let best: BballSeason | null = null
  let bestC = -Infinity
  for (const s of player.seasons) {
    if (s.year < w.start || s.year > w.end) continue
    const c = seasonComposite(s)
    if (c > bestC) {
      bestC = c
      best = s
    }
  }
  return best
}

/**
 * The season to represent a player by within a window: their best IN-window
 * season, or — only as a transitional fallback while season coverage is still
 * being backfilled — their career-best season. Once every player carries a row
 * for each window their tenure overlaps, the fallback never fires and this is
 * exactly {@link bestSeasonInWindow}. Null only for a player with no seasons
 * (which the dataset guard forbids).
 */
export function seasonForWindow(
  player: BballPlayer,
  w: YearWindow,
): BballSeason | null {
  return bestSeasonInWindow(player, w) ?? bestSeason(player)
}

// Conference strength: a non-power-5 program's box-score production is discounted
// — 17 ppg in the Big Ten is worth more than 17 ppg in the A-10 (Alex's call). We
// treat it as a binary (power-5 or not, per school) and apply a flat multiplier to
// the FINAL player rating of non-power-5 schools. Slight by design — a strong five
// still contends — but it makes a non-power-5 40-0 genuinely hard: an 85 power-5
// rating becomes 81 here, dropping below the undefeated cutoff. Applied at the
// player level so the per-position RTG, team strength, AND projected record all
// reflect it. (Alex, 2026-06-26; he's OK if this makes a VCU 40-0 near-impossible.)
export const NON_POWER5_RATING_FACTOR = 0.95

/**
 * Player rating in [0,100]. With a window, rate the player's best season within
 * it (transitional fallback to career-best); without one, rate their career
 * best. 0 for a player with no seasons. `power5` defaults true (no penalty); pass
 * false to apply the non-power-5 conference haircut ({@link NON_POWER5_RATING_FACTOR}).
 */
export function playerRating(
  player: BballPlayer,
  w?: YearWindow,
  power5 = true,
): number {
  const season = w ? seasonForWindow(player, w) : bestSeason(player)
  const base = season ? seasonRating(season) : 0
  return power5 ? base : Math.round(base * NON_POWER5_RATING_FACTOR)
}

// ── Team strength & projected record ─────────────────────────────────────────
//
// "No weak links": blend the position-weighted mean rating with the WORST
// starter's rating, so a single hole costs you. Then logistic-map to a per-game
// win probability and scale to N games.
export const WEAK_LINK_BLEND = 0.4 // share of team strength from the worst starter
// Team strength giving a coin-flip team. Lowered 60→57 (Alex, 2026-06-26) to
// shift the whole curve slightly easier — every overall now wins a touch more,
// and an 80+ team clears 37 wins.
export const WIN_PIVOT = 57
export const WIN_SPREAD = 7.5 // smaller = steeper; this lifts the high-80s a touch
// A roster whose DISPLAYED overall is this or better simply runs the table — an
// 85+ team should never have the sigmoid's rounding shave a game off a 40-0.
// (Alex, 2026-06-26: lowered 90→85 — any basketball rating 85+ goes undefeated.)
export const UNDEFEATED_STRENGTH = 85
// The mirror image at the bottom: a roster whose DISPLAYED (rounded) overall is
// below this is simply winless (0-40) — the logistic tail alone would still hand
// a sub-30 team a stray win or two, which feels wrong for a truly hopeless five.
// (Alex, 2026-06-26: anything below a 30 goes 0-40.)
export const WINLESS_STRENGTH = 30

export interface RatedStarter {
  position: BballPosition
  rating: number
}

/** Position-weighted, weak-link-penalized team strength in [0,100]. */
export function teamStrength(starters: RatedStarter[]): number {
  if (starters.length === 0) return 0
  let wSum = 0
  let wTot = 0
  let min = Infinity
  for (const s of starters) {
    const w = POSITION_WEIGHT[s.position]
    wSum += s.rating * w
    wTot += w
    if (s.rating < min) min = s.rating
  }
  const weightedMean = wSum / wTot
  return (1 - WEAK_LINK_BLEND) * weightedMean + WEAK_LINK_BLEND * min
}

/** Per-game win probability for a given team strength. */
export function winProbability(strength: number): number {
  return 1 / (1 + Math.exp(-(strength - WIN_PIVOT) / WIN_SPREAD))
}

/** Projected wins out of `games` (default 40 for basketball). */
export function projectedWins(starters: RatedStarter[], games = 40): number {
  const strength = teamStrength(starters)
  // An 85+ overall (as displayed, i.e. rounded) is undefeated, full stop — the
  // logistic curve alone would round a true elite down to 39-1, which feels wrong.
  if (Math.round(strength) >= UNDEFEATED_STRENGTH) return games
  // Mirror floor: a sub-30 overall is winless (0-40), full stop.
  if (Math.round(strength) < WINLESS_STRENGTH) return 0
  return Math.round(winProbability(strength) * games)
}

/** "34–6", "40–0", etc. */
export function recordLabel(wins: number, games = 40): string {
  return `${wins}–${games - wins}`
}

/** A flavor grade for the final record, à la 40-0's tiers. */
export function gradeLabel(wins: number, games = 40): string {
  const pct = wins / games
  if (wins === games) return 'PERFECT'
  if (pct >= 0.9) return 'HISTORIC'
  if (pct >= 0.8) return 'ELITE'
  if (pct >= 0.65) return 'SOLID'
  if (pct >= 0.5) return 'BUBBLE'
  return 'LOTTERY'
}
