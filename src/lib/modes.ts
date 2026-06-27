// Game modes.
//
// A school's game can be played several ways. They share the whole engine
// (windows, spins, draft reducer, rating) and differ only in a few flag knobs:
//   • daily       — date-seeded so everyone gets the same eras; one result per
//                   day, which locks and feeds the streak (the original 20-0 flow).
//   • classic     — free play: a fresh RANDOM era sequence every game, replay
//                   forever, no lock, no streak.
//   • hoops-iq    — like classic, but stats, ratings, AND award stars are HIDDEN
//                   during the draft (pick on names alone); revealed at Results.
//   • gridiron-iq — the football analog of Hoops IQ (same hidden-stats conceit).
//
// Daily + Classic are universal; the IQ modes are sport-flavoured, so each carries
// a `sports` scope (see `modesForSport`). Keeping this as plain data + flags means
// the React shell branches on the flags rather than the mode id, so adding a mode
// is a data change, not new control flow scattered through the UI.

import type { SportId } from './sports'

export type GameMode = 'daily' | 'classic' | 'hoops-iq' | 'gridiron-iq'

export interface ModeConfig {
  id: GameMode
  name: string
  emoji: string
  blurb: string
  /** Date-seeded, one result per day, locks + advances the streak. */
  daily: boolean
  /** Hide stats during the draft (revealed at Results) — draft by reputation. */
  hideStats: boolean
  /**
   * Which sports offer this mode, in menu order. Omitted = every sport (daily +
   * classic are universal). The stats-hidden modes are sport-flavoured — Hoops IQ
   * is basketball-only, Gridiron IQ football-only — so each scopes to its sport.
   */
  sports?: SportId[]
}

export const MODES: ModeConfig[] = [
  {
    id: 'daily',
    name: 'Daily Challenge',
    emoji: '🗓️',
    blurb:
      "Today's puzzle — the same eras for everyone. One shot. Build a streak.",
    daily: true,
    hideStats: false,
  },
  {
    id: 'classic',
    name: 'Classic',
    emoji: '♾️',
    blurb:
      'Free play — fresh random eras every game. Go again as often as you like.',
    daily: false,
    hideStats: false,
  },
  {
    id: 'hoops-iq',
    name: 'Hoops IQ',
    emoji: '🧠',
    blurb:
      'Stats, ratings, and award stars hidden. Draft on names alone — they reveal at the end.',
    daily: false,
    hideStats: true,
    sports: ['basketball'],
  },
  {
    id: 'gridiron-iq',
    name: 'Gridiron IQ',
    emoji: '🧠',
    blurb:
      'Stats, ratings, and award stars hidden. Draft on names alone — they reveal at the end.',
    daily: false,
    hideStats: true,
    sports: ['football'],
  },
]

export const DEFAULT_MODE: GameMode = 'daily'

/** Resolve a mode id (e.g. from a `?mode=` param) to its config; daily if unknown. */
export function getMode(id: string | null | undefined): ModeConfig {
  return MODES.find((m) => m.id === id) ?? MODES[0]
}

/** True if `id` names a real mode — gate `?mode=` URLs before trusting them. */
export function isGameMode(id: string | null | undefined): id is GameMode {
  return MODES.some((m) => m.id === id)
}

/**
 * The modes a sport offers, in menu order. A mode with no `sports` scope is
 * universal (daily + classic); a scoped mode (the sport-flavoured IQ modes) shows
 * only for its sport — so basketball gets Hoops IQ and football gets Gridiron IQ,
 * never the other's.
 */
export function modesForSport(sport: SportId): ModeConfig[] {
  return MODES.filter((m) => !m.sports || m.sports.includes(sport))
}

/**
 * A fresh unsigned-32-bit seed for a replayable (non-daily) game. Non-deterministic
 * by design — each Classic/Hoops IQ play draws a different era sequence. Daily uses
 * `seedFor(dateKey, …)` instead so its sequence is stable for the whole ET day.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}
