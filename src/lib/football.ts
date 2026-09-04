// Football engine: windows + roster-slot eligibility (incl. FLEX).
//
// The draft mirrors basketball but onto the 12-man roster (FB_SLOTS): each round
// spins a window; you pick an eligible player and drop them into an OPEN slot
// their position fits — a single-position slot (QB, DE, …) or a FLEX that
// accepts several. Football data starts at 1994 (see docs/DATA-SOURCING.md).

import { buildRollingWindows, datasetMaxYear } from './windows'
import type { FbPlayer, RosterSlot, YearWindow } from '../types'
import { FB_SLOTS } from '../types'

/**
 * First season on the football era wheel — matches basketball's 1994 floor.
 * Official per-player stats (mgoblue.com) cover 1997+ on both sides of the
 * ball; 1994–96 offense comes from Sports-Reference, while pre-1997 defense
 * is INT-only (no source publishes tackles that far back). Since eligibility
 * is season-ROW-based, windows starting 1994–96 still fill every defensive
 * slot from the 1997 rows they contain. See docs/DATA-SOURCING.md.
 */
export const FB_FIRST_YEAR = 1994

/**
 * The live football era wheel: rolling 4-year windows from the DATASET's own
 * floor (its earliest firstYear, never before {@link FB_FIRST_YEAR}) to its
 * most recent season — the same data-driven rolling scheme basketball uses
 * (`buildRollingWindows` + `datasetMaxYear`), so the daily "pick a year,
 * span 4" plays identically across sports. The data-driven START lets a
 * school whose sourced coverage begins later (Pitt: 1996) spin a wheel that
 * never offers an era its data can't fill. Empty for a school with no
 * football data (no seasons → no windows).
 */
export function fbWindows(
  players: ReadonlyArray<{ firstYear: number; lastYear: number }>,
): YearWindow[] {
  const maxYear = datasetMaxYear(players)
  if (maxYear === null) return []
  const minYear = players.reduce<number>(
    (m, p) => Math.min(m, p.firstYear),
    Infinity,
  )
  return buildRollingWindows(Math.max(FB_FIRST_YEAR, minYear), maxYear, 4)
}

/** One draft round per roster slot. */
export const FB_ROUNDS = FB_SLOTS.length

/** Slot ids by side, in draft order. Offense is drafted first, then defense. */
export const OFFENSE_SLOT_IDS = FB_SLOTS.filter(
  (s) => s.side === 'offense',
).map((s) => s.id)
export const DEFENSE_SLOT_IDS = FB_SLOTS.filter(
  (s) => s.side === 'defense',
).map((s) => s.id)

/**
 * Re-spins allowed PER SIDE: one usable while drafting the 6 offensive slots, a
 * separate one while drafting the 6 defensive slots (Alex's call). Unused
 * offensive re-spins do NOT carry into defense.
 */
export const FB_RESPINS_PER_SIDE = 1

/**
 * Era windows drawn PER SIDE: one per slot on that side plus that side's re-spin.
 * Offense and defense each get their OWN fixed sequence — offense draws only
 * from its 7, defense only from its 7 — so the defensive eras a player sees never
 * depend on whether they burned the offensive re-spin (Alex's call).
 */
export const FB_OFFENSE_ERAS = OFFENSE_SLOT_IDS.length + FB_RESPINS_PER_SIDE
export const FB_DEFENSE_ERAS = DEFENSE_SLOT_IDS.length + FB_RESPINS_PER_SIDE

/**
 * How many era windows the daily draws for a football game in total: the offense
 * sequence followed by the defense sequence (see {@link fbEraSequences}). Each
 * side's spare window is consumed only if that side re-spins; the per-side cap
 * in the reducer still limits a side to one. With this many windows neither
 * side's sequence can run dry before its slots are full.
 */
export const FB_DRAFT_ROUNDS = FB_OFFENSE_ERAS + FB_DEFENSE_ERAS

/** The two fixed per-side era sequences a football draft runs on. */
export interface FbEraSequences {
  offense: YearWindow[]
  defense: YearWindow[]
}

/**
 * Split the day's flat draw (`generateSpins(seed, FB_DRAFT_ROUNDS, wheel)`) into
 * its per-side sequences: the first {@link FB_OFFENSE_ERAS} windows are
 * offense's, the rest defense's. Slicing (rather than drawing twice) keeps the
 * flat index meaningful for callers that pair each window with extra spin data
 * by position (Full Football's per-era school). An empty draw (dead wheel) →
 * two empty sequences.
 */
export function fbEraSequences(spins: YearWindow[]): FbEraSequences {
  return {
    offense: spins.slice(0, FB_OFFENSE_ERAS),
    defense: spins.slice(FB_OFFENSE_ERAS),
  }
}

/** Which side draft round `r` belongs to (0–5 offense, 6–11 defense). */
export function sideForRound(round: number): 'offense' | 'defense' {
  return round < OFFENSE_SLOT_IDS.length ? 'offense' : 'defense'
}

/**
 * Football eligibility is SEASON-ROW-based, not tenure-based (deliberately
 * stricter than basketball): a player may be drafted from an era only if they
 * have an actual season row inside it, so the stats/rating shown can never
 * come from a year outside the spun window. A tenure year with no sourced
 * line (e.g. a pre-1997 defensive season no source publishes) shrinks
 * eligibility instead of leaking a wrong-year line into the era.
 */
export function playerInWindow(player: FbPlayer, w: YearWindow): boolean {
  return player.seasons.some((s) => s.year >= w.start && s.year <= w.end)
}

/** Can this player's position go in this slot? (single-position or FLEX). */
export function canFillSlot(player: FbPlayer, slot: RosterSlot): boolean {
  return slot.accepts.includes(player.position)
}

/** The open slots a player could be dropped into (position fits + slot open). */
export function eligibleSlotsFor(
  player: FbPlayer,
  filledSlotIds: ReadonlySet<string>,
): RosterSlot[] {
  return FB_SLOTS.filter(
    (s) => !filledSlotIds.has(s.id) && canFillSlot(player, s),
  )
}

/**
 * Players draftable this round: eligible for the window AND with at least one
 * open slot their position fits. Sorted by id for deterministic ordering.
 */
export function eligiblePlayers(
  pool: FbPlayer[],
  w: YearWindow,
  filledSlotIds: ReadonlySet<string>,
): FbPlayer[] {
  return pool
    .filter(
      (p) =>
        playerInWindow(p, w) && eligibleSlotsFor(p, filledSlotIds).length > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}
