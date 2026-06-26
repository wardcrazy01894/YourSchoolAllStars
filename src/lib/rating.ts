// Rating model: stat line → player rating → team strength → projected record.
//
// This is OUR model (40-0's is proprietary). Every constant below is tunable and
// documented in docs/PLAN.md §"Rating model". The shape mirrors what 40-0
// teaches in its tutorial:
//   • a player's rating bakes in the whole stat line plus honors,
//   • premium positions (PG, C) weigh more toward the team score,
//   • "no weak links" — one bad starter drags the record down,
//   • the team's strength maps to a projected record out of N games.

import type { BballPlayer, BballPosition, BballStats } from '../types'

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
// misses). Matched case-insensitively as substrings of each honor string.
export const HONOR_BONUS: { match: string; bonus: number }[] = [
  { match: 'national player of the year', bonus: 12 },
  { match: 'wooden', bonus: 10 },
  { match: 'naismith', bonus: 10 },
  { match: 'consensus all-american', bonus: 9 },
  { match: 'all-american', bonus: 6 },
  { match: 'player of the year', bonus: 6 }, // conference POY
  { match: 'first team all', bonus: 4 }, // all-conference first team
  { match: 'all-big ten', bonus: 3 },
  { match: 'freshman of the year', bonus: 3 },
  { match: 'all-conference', bonus: 2 },
]

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
  let bonus = 0
  for (const h of honors) {
    const lc = h.toLowerCase()
    // Take the single best-matching honor tier, not the sum of overlapping ones.
    let best = 0
    for (const { match, bonus: b } of HONOR_BONUS) {
      if (lc.includes(match)) best = Math.max(best, b)
    }
    bonus += best
  }
  return bonus
}

export function statComposite(stats: BballStats): number {
  return (
    stats.pts * STAT_WEIGHTS.pts +
    stats.reb * STAT_WEIGHTS.reb +
    stats.ast * STAT_WEIGHTS.ast +
    stats.stl * STAT_WEIGHTS.stl +
    stats.blk * STAT_WEIGHTS.blk
  )
}

/**
 * Player rating in [0,100]. Diminishing-returns curve so elite seasons separate
 * at the top without an arbitrary hard cap. rating = 100·(1 − e^(−composite/scale)).
 */
export function playerRating(player: BballPlayer): number {
  const composite = statComposite(player.stats) + honorsBonus(player.honors)
  const r = 100 * (1 - Math.exp(-composite / RATING_SCALE))
  return Math.round(Math.max(0, Math.min(100, r)))
}

// ── Team strength & projected record ─────────────────────────────────────────
//
// "No weak links": blend the position-weighted mean rating with the WORST
// starter's rating, so a single hole costs you. Then logistic-map to a per-game
// win probability and scale to N games.
export const WEAK_LINK_BLEND = 0.4 // share of team strength from the worst starter
export const WIN_PIVOT = 60 // team strength giving a coin-flip team
export const WIN_SPREAD = 8 // smaller = steeper (perfection harder to reach)

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
  return Math.round(winProbability(teamStrength(starters)) * games)
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
