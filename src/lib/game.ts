// Draft state machine (pure). The UI holds one DraftState and calls these
// transitions; everything here is deterministic and unit-tested.
//
// Flow (mirrors 40-0): each round shows the window spun for that round; you draft
// one eligible player into their position slot, which locks. You get ONE reroll
// for the whole game, which swaps the current round's window for its deterministic
// alternate. If a window has no eligible players for any open slot you may skip
// the round (leaving a hole — a guaranteed weak link).

import type { BballPlayer, BballPosition, YearWindow } from '../types'
import { BBALL_POSITIONS } from '../types'
import { eligiblePlayers, playerInWindow } from './windows'

export interface DraftState {
  spins: YearWindow[] // effective window per round (reroll mutates one entry)
  rerollWindows: YearWindow[] // the alternate for each round
  round: number // 0-based index of the current round
  slots: Record<BballPosition, BballPlayer | null>
  picks: BballPlayer[] // drafted players in order
  rerollsLeft: number
  rerolledRounds: number[] // rounds already swapped (so a round can't double-reroll)
}

export function initDraft(
  spins: YearWindow[],
  rerollWindows: YearWindow[],
  rerolls = 1,
): DraftState {
  const slots = Object.fromEntries(
    BBALL_POSITIONS.map((p) => [p, null]),
  ) as Record<BballPosition, BballPlayer | null>
  return {
    spins,
    rerollWindows,
    round: 0,
    slots,
    picks: [],
    rerollsLeft: rerolls,
    rerolledRounds: [],
  }
}

export function isComplete(s: DraftState): boolean {
  return s.round >= s.spins.length
}

export function currentWindow(s: DraftState): YearWindow | null {
  return isComplete(s) ? null : s.spins[s.round]
}

export function openPositions(s: DraftState): BballPosition[] {
  return BBALL_POSITIONS.filter((p) => s.slots[p] === null)
}

/** Players the user can pick this round (eligible window + open slot). */
export function currentPool(s: DraftState, pool: BballPlayer[]): BballPlayer[] {
  const w = currentWindow(s)
  if (!w) return []
  return eligiblePlayers(pool, w, openPositions(s))
}

export function canDraft(s: DraftState, player: BballPlayer): boolean {
  const w = currentWindow(s)
  if (!w) return false
  if (s.slots[player.position] !== null) return false
  return playerInWindow(player, w)
}

/** Draft a player into their position slot and advance to the next round. */
export function draft(s: DraftState, player: BballPlayer): DraftState {
  if (!canDraft(s, player)) return s
  return {
    ...s,
    slots: { ...s.slots, [player.position]: player },
    picks: [...s.picks, player],
    round: s.round + 1,
  }
}

/** Use the single reroll on the current round (swap to its alternate window). */
export function reroll(s: DraftState): DraftState {
  if (
    isComplete(s) ||
    s.rerollsLeft <= 0 ||
    s.rerolledRounds.includes(s.round)
  ) {
    return s
  }
  const spins = [...s.spins]
  spins[s.round] = s.rerollWindows[s.round]
  return {
    ...s,
    spins,
    rerollsLeft: s.rerollsLeft - 1,
    rerolledRounds: [...s.rerolledRounds, s.round],
  }
}

export function canReroll(s: DraftState): boolean {
  return (
    !isComplete(s) && s.rerollsLeft > 0 && !s.rerolledRounds.includes(s.round)
  )
}

/** Skip the current round, leaving its slot(s) unfilled. Advances the round. */
export function skipRound(s: DraftState): DraftState {
  if (isComplete(s)) return s
  return { ...s, round: s.round + 1 }
}
