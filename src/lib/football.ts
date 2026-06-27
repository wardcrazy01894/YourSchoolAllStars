// Football engine: windows + roster-slot eligibility (incl. FLEX).
//
// The draft mirrors basketball but onto the 12-man roster (FB_SLOTS): each round
// spins a window; you pick an eligible player and drop them into an OPEN slot
// their position fits — a single-position slot (QB, DE, …) or a FLEX that
// accepts several. Football data starts at 2005 (see docs/DATA-SOURCING.md).

import { buildWindows, tenureOverlaps } from './windows'
import type { FbPlayer, RosterSlot, YearWindow } from '../types'
import { FB_SLOTS } from '../types'

/** 2005–2024 in 4-year blocks → 2005-08, 2009-12, 2013-16, 2017-20, 2021-24.
 *  (2025+ folds into the next block once enough seasons exist.) */
export const FB_WINDOWS: YearWindow[] = buildWindows(2005, 2024, 4)

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
 * How many era windows the daily draws for a football game: one per slot plus the
 * per-side re-spins (one offense + one defense). The extra windows are consumed
 * only if the player re-spins; the per-side cap in the reducer still limits a
 * side to one. With this many windows the sequence can never run dry before the
 * roster is full, even if both re-spins are used.
 */
export const FB_DRAFT_ROUNDS = FB_SLOTS.length + 2 * FB_RESPINS_PER_SIDE

/** Which side draft round `r` belongs to (0–5 offense, 6–11 defense). */
export function sideForRound(round: number): 'offense' | 'defense' {
  return round < OFFENSE_SLOT_IDS.length ? 'offense' : 'defense'
}

export function playerInWindow(player: FbPlayer, w: YearWindow): boolean {
  return tenureOverlaps(player.firstYear, player.lastYear, w)
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
