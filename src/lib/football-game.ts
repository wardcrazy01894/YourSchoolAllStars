// Football draft state machine (pure) — the 12-man, two-phase parallel to the
// basketball reducer in game.ts.
//
// Flow (16-0 style, with Alex's rules): the day fixes a SEQUENCE of era windows
// (one per round; see `FB_DRAFT_ROUNDS`). You draft OFFENSE first — its 6 slots
// (QB/RB/WR/TE + 2 FLEX) — then DEFENSE (DE/DT/LB/CB/S + 1 FLEX). At each round
// you either:
//   • pick a player and drop them into an OPEN slot their position fits — a
//     single-position slot or a FLEX that accepts several — which advances the
//     round; or
//   • RE-SPIN, which advances to the next round's window WITHOUT drafting. You get
//     one re-spin PER SIDE (offense and defense each), and an unused offensive
//     re-spin does NOT carry into defense.
// The side is derived from the slots: while any offensive slot is open you're on
// offense; once they're all filled you're on defense. The game ends when all 12
// slots are filled OR the era sequence runs out. Because the eras are fixed up
// front, the outcome never depends on WHEN you re-spin.

import type { FbPlayer, FbPosition, RosterSlot, YearWindow } from '../types'
import { FB_SLOTS, FB_OFF_POSITIONS } from '../types'
import {
  OFFENSE_SLOT_IDS,
  FB_RESPINS_PER_SIDE,
  playerInWindow,
} from './football'
import {
  fbPlayerRating,
  fbProjectedWins,
  fbRecordLabel,
  fbGradeLabel,
  FB_GAMES,
  type RatedFbStarter,
} from './football-rating'

export type FbSide = 'offense' | 'defense'

export interface FbDraftPick {
  player: FbPlayer
  /** The roster slot the player was placed into (FB_SLOTS id). */
  slotId: string
  /** The era this player was drafted FROM (for display/provenance). */
  window: YearWindow
}

export interface FbDraftState {
  /** The fixed era sequence for this game (deterministic for the daily). */
  windows: YearWindow[]
  /** Index of the current era within `windows`. */
  cursor: number
  /** All 12 slots, keyed by FB_SLOTS id; null = open. */
  slots: Record<string, FbPlayer | null>
  picks: FbDraftPick[]
  /** Re-spins consumed on each side (each capped at FB_RESPINS_PER_SIDE). */
  respinsUsed: Record<FbSide, number>
}

const OFFENSE_SLOT_ID_SET: ReadonlySet<string> = new Set(OFFENSE_SLOT_IDS)

/** Which side a position plays — the gate that enforces offense-before-defense. */
export function sideOfPosition(pos: FbPosition): FbSide {
  return (FB_OFF_POSITIONS as readonly FbPosition[]).includes(pos)
    ? 'offense'
    : 'defense'
}

export function initFbDraft(windows: YearWindow[]): FbDraftState {
  const slots = Object.fromEntries(FB_SLOTS.map((s) => [s.id, null])) as Record<
    string,
    FbPlayer | null
  >
  return {
    windows,
    cursor: 0,
    slots,
    picks: [],
    respinsUsed: { offense: 0, defense: 0 },
  }
}

/** Offense while any offensive slot is open; defense once they're all filled. */
export function currentSide(s: FbDraftState): FbSide {
  const offenseOpen = FB_SLOTS.some(
    (slot) => OFFENSE_SLOT_ID_SET.has(slot.id) && s.slots[slot.id] === null,
  )
  return offenseOpen ? 'offense' : 'defense'
}

export function openFbSlots(s: FbDraftState): RosterSlot[] {
  return FB_SLOTS.filter((slot) => s.slots[slot.id] === null)
}

export function allFbSlotsFilled(s: FbDraftState): boolean {
  return FB_SLOTS.every((slot) => s.slots[slot.id] !== null)
}

export function isFbComplete(s: FbDraftState): boolean {
  return allFbSlotsFilled(s) || s.cursor >= s.windows.length
}

export function currentFbWindow(s: FbDraftState): YearWindow | null {
  return s.cursor < s.windows.length ? s.windows[s.cursor] : null
}

export function alreadyDrafted(s: FbDraftState, player: FbPlayer): boolean {
  return s.picks.some((pk) => pk.player.id === player.id)
}

/**
 * The open slots a player could be dropped into RIGHT NOW: position fits, slot
 * open, and the slot is on the current side (so defenders aren't draftable until
 * offense is done, even though their slots start open).
 */
export function eligibleOpenSlots(
  s: FbDraftState,
  player: FbPlayer,
): RosterSlot[] {
  const side = currentSide(s)
  return FB_SLOTS.filter(
    (slot) =>
      slot.side === side &&
      s.slots[slot.id] === null &&
      slot.accepts.includes(player.position),
  )
}

/** Pickable = in the current window, not drafted, with ≥1 open eligible slot. */
export function isPickable(s: FbDraftState, player: FbPlayer): boolean {
  const w = currentFbWindow(s)
  if (!w) return false
  if (alreadyDrafted(s, player)) return false
  return playerInWindow(player, w) && eligibleOpenSlots(s, player).length > 0
}

/**
 * Players to show this era: in the current window AND on the current side, sorted
 * by id (the UI groups by position). The opposite side is hidden — it isn't
 * draftable until the current side's slots are full.
 */
export function playersThisEra(s: FbDraftState, pool: FbPlayer[]): FbPlayer[] {
  const w = currentFbWindow(s)
  if (!w) return []
  const side = currentSide(s)
  return pool
    .filter((p) => sideOfPosition(p.position) === side && playerInWindow(p, w))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Place a player into a chosen open, eligible slot; advance to the next era. */
export function draftToSlot(
  s: FbDraftState,
  player: FbPlayer,
  slotId: string,
): FbDraftState {
  if (!isPickable(s, player)) return s
  if (!eligibleOpenSlots(s, player).some((slot) => slot.id === slotId)) return s
  const window = currentFbWindow(s)
  if (!window) return s
  return {
    ...s,
    slots: { ...s.slots, [slotId]: player },
    picks: [...s.picks, { player, slotId, window }],
    cursor: s.cursor + 1,
  }
}

/**
 * Re-spinning is allowed only while the game isn't over, you have a re-spin left
 * ON THE CURRENT SIDE, and advancing wouldn't strand a slot (enough windows must
 * remain after the skip to fill every open slot). Like basketball's skip cap,
 * this lives in the state machine so no caller can exceed it.
 *
 * Soft-lock freedom depends on a DATA invariant, not on this count guard: the
 * guard only ensures enough windows REMAIN, not that each remaining window holds
 * a *pickable* player. And football's requirement is STRONGER than basketball's —
 * side-gating hides the opposite side, so every window must hold a player who
 * fits an open slot on the side you'll be drafting when you reach it (in practice
 * every window needs both an offensive and a defensive option for the open
 * position-classes). That per-window-PER-SIDE coverage is enforced in the dataset
 * guard (`src/data/football-dataset.test.ts`, the Hall's-condition check per
 * window × side). With that invariant, a pickable player always exists in the
 * current era, so the cap never strands you. Do NOT loosen the cap here to
 * compensate for a weaker dataset — fix the dataset guard instead.
 *
 * SCOPE CAVEAT: that per-window×side coverage is enforced only for the windows in
 * `FB_WINDOWS` (the five non-overlapping 2005–2024 blocks the dataset guard
 * iterates). The LIVE game spins the data-driven ROLLING wheel
 * (`buildRollingWindows(2005, …, 4)`), whose overlapping eras are NOT the same
 * set. In practice a rolling window is a 4-year span contained within the dataset's
 * range, so it's at least as rich as the block guard checks; but a synthetic or
 * out-of-range window is outside the guarantee. The count guard below still holds
 * unconditionally (it only reasons about how many windows REMAIN) — it's the
 * "a pickable player always exists" half that leans on the dataset invariant.
 */
export function canRespin(s: FbDraftState): boolean {
  if (isFbComplete(s)) return false
  if (s.respinsUsed[currentSide(s)] >= FB_RESPINS_PER_SIDE) return false
  const windowsAfter = s.windows.length - (s.cursor + 1)
  return windowsAfter >= openFbSlots(s).length
}

/** Advance past the current era without drafting; consumes a side re-spin. */
export function respin(s: FbDraftState): FbDraftState {
  if (!canRespin(s)) return s
  const side = currentSide(s)
  return {
    ...s,
    cursor: s.cursor + 1,
    respinsUsed: { ...s.respinsUsed, [side]: s.respinsUsed[side] + 1 },
  }
}

/** One RatedFbStarter per filled slot (in pick order). */
export function ratedStarters(
  s: FbDraftState,
  power5: boolean,
): RatedFbStarter[] {
  return s.picks.map((pk) => ({
    position: pk.player.position,
    rating: fbPlayerRating(pk.player, power5),
  }))
}

export interface FbDraftResult {
  wins: number
  games: number
  label: string
  grade: string
}

/** Projected record out of 16 for the drafted roster. */
export function fbDraftResult(s: FbDraftState, power5: boolean): FbDraftResult {
  const wins = fbProjectedWins(ratedStarters(s, power5))
  return {
    wins,
    games: FB_GAMES,
    label: fbRecordLabel(wins),
    grade: fbGradeLabel(wins),
  }
}
