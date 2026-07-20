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
import { hashStringToSeed, mulberry32 } from './daily'
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

/**
 * Gridiron IQ "fewer names" reduction. Given ONE position's candidates for an era
 * (already in display/name order), return a stable subset of at most `limit`:
 *
 *   • the `topN` highest-rated are ALWAYS kept — so the strongest options never
 *     vanish and the draft can't soft-lock on a hidden pickable player; and
 *   • the remaining slots fill from a DETERMINISTIC shuffle of the rest, seeded by
 *     the pool itself (its ids + a `salt` naming the era + position).
 *
 * Because the seed is a pure function of the candidates, flipping the toggle off
 * and back on yields the EXACT same names every time — you can't re-roll the
 * "random" three to spot which two are always present (i.e. the good ones). The
 * output preserves the input order, so the kept names stay name-sorted and the
 * top-rated ones aren't betrayed by their position in the list.
 *
 * `limit` or fewer candidates → returned unchanged (nothing to hide). Pure; the
 * `rate` fn lets the caller inject `fbPlayerRating(p, window, power5)` without this
 * module owning the window/power-5 plumbing. NOTE: reduction is rating-based and
 * has no notion of pickability — feed it only draftable candidates (see
 * {@link fewerNamesForGroup}), or an already-drafted, unpickable player could take
 * a keep slot and hide the real choices.
 */
export function reduceIqNames<T extends { id: string }>(
  players: T[],
  rate: (p: T) => number,
  salt: string,
  limit = 5,
  topN = 2,
): T[] {
  if (players.length <= limit) return players
  // Top `topN` by rating, ties broken by id so the pick is deterministic.
  const ranked = [...players].sort(
    (a, b) => rate(b) - rate(a) || a.id.localeCompare(b.id),
  )
  const keep = new Set(ranked.slice(0, topN).map((p) => p.id))
  // Deterministically shuffle the remainder (in canonical id order, so the seed
  // maps the same way regardless of the input's order) and take enough to fill up
  // to `limit`. Fisher–Yates driven by a pool-derived seed. `Math.max(0, …)`
  // guards a `topN >= limit` call (keep already ≥ limit → take nothing).
  const rest = players.filter((p) => !keep.has(p.id))
  rest.sort((a, b) => a.id.localeCompare(b.id))
  const seed = hashStringToSeed(`${salt}|${rest.map((p) => p.id).join(',')}`)
  const rng = mulberry32(seed)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  for (const p of rest.slice(0, Math.max(0, limit - keep.size))) keep.add(p.id)
  // Preserve the caller's (name-sorted) order.
  return players.filter((p) => keep.has(p.id))
}

/**
 * The names to show for ONE position group in Gridiron IQ's "fewer names" view.
 *
 * Crucially, this drops already-drafted players FIRST. `playersThisEra` doesn't
 * filter them out (they render as `.locked`), and because the era wheel draws
 * overlapping windows with replacement, a player picked in an earlier round
 * routinely reappears in a later one. Left in the pool, such a locked player's
 * rating could claim a keep slot (or the shuffle could favour it) and crowd every
 * genuinely-pickable candidate out of the visible five — stranding an open slot.
 * Filtering to the not-yet-drafted set first means every reduced group with an
 * open slot still surfaces a draftable player, so the reduction can't soft-lock.
 *
 * The already-drafted set is fixed within an era (a pick advances the cursor to a
 * new era), so the reduced subset stays stable across toggles — the anti-cheese
 * guarantee holds. `positionPlayers` must already be filtered to one position and
 * in display order; the result preserves that order.
 */
export function fewerNamesForGroup(
  state: FbDraftState,
  positionPlayers: FbPlayer[],
  rate: (p: FbPlayer) => number,
  salt: string,
  limit = 5,
  topN = 2,
): FbPlayer[] {
  const live = positionPlayers.filter((p) => !alreadyDrafted(state, p))
  return reduceIqNames(live, rate, salt, limit, topN)
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
 * SCOPE CAVEAT: that per-window×side coverage is enforced for exactly the rolling
 * wheel the live game spins — `fbWindows(players)` = rolling 4-year eras from 1994
 * to the dataset max — since the dataset guard iterates that same wheel. A
 * synthetic or out-of-range window passed by hand is outside the guarantee. The
 * count guard below still holds unconditionally (it only reasons about how many
 * windows REMAIN) — it's the "a pickable player always exists" half that leans on
 * the dataset invariant.
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

/**
 * Resolve the power-5 flag to use when rating a given player. A plain `boolean`
 * means "every player on this roster shares the school's conference strength"
 * (the single-school games); a function lets a MIXED roster (Full Football)
 * resolve the haircut PER PLAYER from that player's own school — so a
 * non-power-5 starter is dinged without dragging their power-5 teammates.
 * Football's twin of basketball's `Power5Spec` (result.ts).
 */
export type FbPower5Spec = boolean | ((player: FbPlayer) => boolean)

/** Normalize a {@link FbPower5Spec} to a per-player resolver. */
export function fbPower5Resolver(
  spec: FbPower5Spec,
): (player: FbPlayer) => boolean {
  return typeof spec === 'function' ? spec : () => spec
}

/** One RatedFbStarter per filled slot (in pick order), each rated by the best
 *  season INSIDE the era they were drafted from — never an out-of-era peak. */
export function ratedStarters(
  s: FbDraftState,
  power5: FbPower5Spec,
): RatedFbStarter[] {
  const p5 = fbPower5Resolver(power5)
  return s.picks.map((pk) => ({
    position: pk.player.position,
    rating: fbPlayerRating(pk.player, pk.window, p5(pk.player)),
  }))
}

export interface FbDraftResult {
  wins: number
  games: number
  label: string
  grade: string
}

/** Projected record out of 16 for the drafted roster. */
export function fbDraftResult(
  s: FbDraftState,
  power5: FbPower5Spec,
): FbDraftResult {
  const wins = fbProjectedWins(ratedStarters(s, power5))
  return {
    wins,
    games: FB_GAMES,
    label: fbRecordLabel(wins),
    grade: fbGradeLabel(wins),
  }
}
