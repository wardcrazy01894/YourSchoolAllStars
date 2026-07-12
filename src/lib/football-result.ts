// Football roster evaluation + (de)serialization — the bridge between a completed
// 12-man draft and what we persist/show, mirroring basketball's `result.ts`.
// Pure, so the rate→record math has one home and the save/replay round-trip is
// unit-tested. Saved state is keyed by FB_SLOTS id (QB/FLEX1/DFLEX/…) into the
// sport-agnostic SavedDaily shape.

import { FB_SLOTS } from '../types'
import type { FbPlayer, YearWindow } from '../types'
import {
  ratedStarters,
  fbDraftResult,
  type FbDraftState,
  type FbDraftPick,
} from './football-game'
import {
  fbPlayerRating,
  fbTeamStrength,
  type RatedFbStarter,
} from './football-rating'
import type { SavedDaily } from './progress'

/** Map each filled slot id → the era window its player was drafted from. */
export function fbWindowBySlot(
  picks: FbDraftPick[],
): Record<string, YearWindow> {
  const m: Record<string, YearWindow> = {}
  for (const pk of picks) m[pk.slotId] = pk.window
  return m
}

export interface FbRosterResult {
  /** One entry per FILLED slot, rated as the player's own position. */
  rated: RatedFbStarter[]
  /** Position-weighted, weak-link-penalized team strength in [0,100] (unrounded). */
  strength: number
  wins: number
  games: number
  /** "12–4" etc. (en dash). */
  label: string
  grade: string
  /** Per-slot rating, null for an empty slot — drives the per-row RTG column. */
  ratingBySlot: Record<string, number | null>
  /** Era each filled slot was drafted from (so callers don't recompute it). */
  windowBySlot: Record<string, YearWindow>
}

/**
 * Rate a (possibly partial) roster and project its record out of 16. Each filled
 * slot is rated by its player's position; empty slots are absent from the team
 * score (and read null per-slot), which drags the projected record. `power5`
 * toggles the non-power-5 conference haircut on every rating.
 */
export function fbEvaluate(
  state: FbDraftState,
  power5: boolean,
): FbRosterResult {
  const rated = ratedStarters(state, power5)
  const res = fbDraftResult(state, power5)
  const pickBySlot = new Map(state.picks.map((pk) => [pk.slotId, pk]))
  const ratingBySlot = Object.fromEntries(
    FB_SLOTS.map((slot) => {
      const pk = pickBySlot.get(slot.id)
      return [slot.id, pk ? fbPlayerRating(pk.player, pk.window, power5) : null]
    }),
  ) as Record<string, number | null>
  return {
    rated,
    strength: fbTeamStrength(rated),
    wins: res.wins,
    games: res.games,
    label: res.label,
    grade: res.grade,
    ratingBySlot,
    windowBySlot: fbWindowBySlot(state.picks),
  }
}

/** Serialize a completed football draft into the persisted daily shape. */
export function fbSavedDailyFrom(
  state: FbDraftState,
  dateKey: string,
  power5: boolean,
): SavedDaily {
  const { wins, grade } = fbEvaluate(state, power5)
  const playerIds: Record<string, string> = {}
  const windows: Record<string, YearWindow> = {}
  for (const pk of state.picks) {
    playerIds[pk.slotId] = pk.player.id
    windows[pk.slotId] = pk.window
  }
  return { dateKey, playerIds, windows, wins, grade }
}

/**
 * Rebuild a football draft from a saved daily so the LOCKED replay view
 * re-renders (and re-rates) exactly as played. Only `slots`/`picks` are
 * reconstructed — all the Results view reads. Slots are rebuilt in FB_SLOTS order
 * (a stable offense-then-defense lineup). A slot is dropped (left empty) if its
 * player is no longer in the dataset or it has no stored window, so a stale/lean
 * save degrades to a partial board rather than throwing.
 */
export function fbRosterFromSaved(
  saved: SavedDaily,
  players: FbPlayer[],
): FbDraftState {
  const byId = new Map(players.map((p) => [p.id, p]))
  const slots = Object.fromEntries(
    FB_SLOTS.map((s) => [s.id, null]),
  ) as FbDraftState['slots']
  const picks: FbDraftPick[] = []
  for (const slot of FB_SLOTS) {
    const id = saved.playerIds[slot.id]
    const player = id ? byId.get(id) : undefined
    const window = saved.windows?.[slot.id]
    if (player && window) {
      slots[slot.id] = player
      picks.push({ player, slotId: slot.id, window })
    }
  }
  return {
    windows: [],
    cursor: 0,
    slots,
    picks,
    respinsUsed: { offense: 0, defense: 0 },
  }
}
