// Roster evaluation + (de)serialization — the bridge between a completed draft
// and what we persist/show. Pure so the rate→record math has ONE home (was
// copy-pasted in App's `finish` and `Results`) and the save/replay round-trip is
// unit-tested.

import { BBALL_POSITIONS } from '../types'
import type { BballPlayer, BballPosition, YearWindow } from '../types'
import type { DraftState, DraftPick } from './game'
import {
  playerRating,
  projectedWins,
  teamStrength,
  gradeLabel,
  type RatedStarter,
} from './rating'
import type { SavedDaily } from './progress'

/** Map each filled position to the era window its player was drafted from. */
export function windowByPosition(
  picks: DraftPick[],
): Partial<Record<BballPosition, YearWindow>> {
  const m: Partial<Record<BballPosition, YearWindow>> = {}
  for (const pk of picks) m[pk.position] = pk.window
  return m
}

export interface RosterResult {
  /** One entry per FILLED slot, rated as the slot it fills (premium weights). */
  rated: RatedStarter[]
  /** Position-weighted, weak-link-penalized team strength in [0,100] (unrounded). */
  strength: number
  wins: number
  grade: string
  /** Per-position rating, null for an empty slot — drives the per-row RTG column. */
  ratingsByPosition: Record<BballPosition, number | null>
  /** Era each filled slot was drafted from (so callers don't recompute it). */
  windowByPosition: Partial<Record<BballPosition, YearWindow>>
}

/**
 * Rate a (possibly partial) roster and project its record. Each player is rated
 * AS THE SLOT they fill, using the window they were drafted from — matching the
 * per-row RTG and the draft-time view. Empty slots are simply absent from the
 * team score (and read null per-position), which drags the projected record.
 */
export function evaluateRoster(state: DraftState, games: number): RosterResult {
  const winByPos = windowByPosition(state.picks)
  const rated: RatedStarter[] = BBALL_POSITIONS.filter(
    (pos) => state.slots[pos] !== null,
  ).map((pos) => ({
    position: pos,
    rating: playerRating(state.slots[pos]!, winByPos[pos]),
  }))
  const wins = projectedWins(rated, games)
  const ratingsByPosition = Object.fromEntries(
    BBALL_POSITIONS.map((pos) => [
      pos,
      state.slots[pos] ? playerRating(state.slots[pos]!, winByPos[pos]) : null,
    ]),
  ) as Record<BballPosition, number | null>
  return {
    rated,
    strength: teamStrength(rated),
    wins,
    grade: gradeLabel(wins, games),
    ratingsByPosition,
    windowByPosition: winByPos,
  }
}

/** Serialize a completed draft into the persisted daily shape. */
export function savedDailyFrom(
  state: DraftState,
  dateKey: string,
  games: number,
): SavedDaily {
  const { wins, grade } = evaluateRoster(state, games)
  const winByPos = windowByPosition(state.picks)
  const playerIds: Partial<Record<BballPosition, string>> = {}
  const windows: Partial<Record<BballPosition, YearWindow>> = {}
  for (const pos of BBALL_POSITIONS) {
    const p = state.slots[pos]
    if (!p) continue
    playerIds[pos] = p.id
    const w = winByPos[pos]
    if (w) windows[pos] = w
  }
  return { dateKey, playerIds, windows, wins, grade }
}

/**
 * Rebuild a draft from a saved daily so the LOCKED replay view re-renders (and
 * re-rates) exactly as played. Only `slots`/`picks` are reconstructed — that's
 * all the Results view reads. A slot is dropped (left empty) if its player is no
 * longer in the dataset or it has no stored window, so a stale/lean save degrades
 * to a partial board rather than throwing.
 */
export function rosterFromSaved(
  saved: SavedDaily,
  players: BballPlayer[],
): DraftState {
  const byId = new Map(players.map((p) => [p.id, p]))
  const slots = Object.fromEntries(
    BBALL_POSITIONS.map((p) => [p, null]),
  ) as DraftState['slots']
  const picks: DraftPick[] = []
  for (const pos of BBALL_POSITIONS) {
    const id = saved.playerIds[pos]
    const player = id ? byId.get(id) : undefined
    const window = saved.windows?.[pos]
    if (player && window) {
      slots[pos] = player
      picks.push({ player, position: pos, window })
    }
  }
  return { windows: [], cursor: 0, slots, picks }
}
