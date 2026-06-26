// Draft state machine (pure) — gameplay v2.
//
// Flow (mirrors 40-0, with Alex's daily rule): the day fixes a SEQUENCE of eras
// (windows) — 6 for the basketball daily (5 starters + 1 skip). You move through
// them in order. At each era you either:
//   • pick a player and choose which OPEN slot to put them in (a player may be
//     eligible for several — a combo guard at PG or SG), which advances the era; or
//   • SKIP, which just advances to the next era.
// The game ends when all five slots are filled OR the era sequence runs out.
// Because the eras are fixed up front, the outcome never depends on WHEN you skip.

import type { BballPlayer, BballPosition, YearWindow } from '../types'
import { BBALL_POSITIONS, eligiblePositions } from '../types'
import { playerInWindow } from './windows'

export interface DraftPick {
  player: BballPlayer
  position: BballPosition
}

export interface DraftState {
  /** The fixed era sequence for this game (deterministic for the daily). */
  windows: YearWindow[]
  /** Index of the current era within `windows`. */
  cursor: number
  slots: Record<BballPosition, BballPlayer | null>
  picks: DraftPick[]
}

export function initDraft(windows: YearWindow[]): DraftState {
  const slots = Object.fromEntries(
    BBALL_POSITIONS.map((p) => [p, null]),
  ) as Record<BballPosition, BballPlayer | null>
  return { windows, cursor: 0, slots, picks: [] }
}

export function allSlotsFilled(s: DraftState): boolean {
  return BBALL_POSITIONS.every((p) => s.slots[p] !== null)
}

export function isComplete(s: DraftState): boolean {
  return allSlotsFilled(s) || s.cursor >= s.windows.length
}

export function currentWindow(s: DraftState): YearWindow | null {
  return s.cursor < s.windows.length ? s.windows[s.cursor] : null
}

export function openPositions(s: DraftState): BballPosition[] {
  return BBALL_POSITIONS.filter((p) => s.slots[p] === null)
}

/** The open slots a given player could be placed into this game (regardless of window). */
export function eligibleOpenSlots(
  s: DraftState,
  player: BballPlayer,
): BballPosition[] {
  return eligiblePositions(player).filter((pos) => s.slots[pos] === null)
}

/**
 * Everyone eligible to APPEAR this era: all players whose tenure overlaps the
 * current window — including those whose position is already filled (the UI shows
 * them greyed). Sorted by id for deterministic ordering; the UI groups by position.
 */
export function playersThisEra(
  s: DraftState,
  pool: BballPlayer[],
): BballPlayer[] {
  const w = currentWindow(s)
  if (!w) return []
  return pool
    .filter((p) => playerInWindow(p, w))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Pickable = in the current window, not already drafted, and has an open eligible slot. */
export function isPickable(s: DraftState, player: BballPlayer): boolean {
  const w = currentWindow(s)
  if (!w) return false
  if (alreadyDrafted(s, player)) return false
  return playerInWindow(player, w) && eligibleOpenSlots(s, player).length > 0
}

/** Is this player already on the roster? (Guards multi-eligible double-draft.) */
export function alreadyDrafted(s: DraftState, player: BballPlayer): boolean {
  return s.picks.some((pk) => pk.player.id === player.id)
}

/** Place a player into a chosen open, eligible slot; advance to the next era. */
export function draftToSlot(
  s: DraftState,
  player: BballPlayer,
  position: BballPosition,
): DraftState {
  if (alreadyDrafted(s, player)) return s
  if (!isPickable(s, player)) return s
  if (!eligibleOpenSlots(s, player).includes(position)) return s
  return {
    ...s,
    slots: { ...s.slots, [position]: player },
    picks: [...s.picks, { player, position }],
    cursor: s.cursor + 1,
  }
}

/** Skip the current era (draft nothing), advancing to the next. */
export function skip(s: DraftState): DraftState {
  if (!canSkip(s)) return s
  return { ...s, cursor: s.cursor + 1 }
}

/**
 * Skipping is allowed only while the game isn't over AND a skip wouldn't strand a
 * slot (you get exactly `safeSkipsLeft` skips). The cap lives HERE in the state
 * machine, not just in the button's `disabled`, so no caller can exceed it.
 */
export function canSkip(s: DraftState): boolean {
  return !isComplete(s) && safeSkipsLeft(s) > 0
}

/**
 * How many more eras you can skip and STILL fill every slot. 0 means the next
 * skip will leave a hole. Negative is clamped to 0.
 */
export function safeSkipsLeft(s: DraftState): number {
  const erasLeft = s.windows.length - s.cursor
  const slotsLeft = openPositions(s).length
  return Math.max(0, erasLeft - slotsLeft)
}
