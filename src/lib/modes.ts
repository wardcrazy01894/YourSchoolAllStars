// Game modes.
//
// One school's basketball game can be played three ways. They share the whole
// engine (windows, spins, draft reducer, rating) and differ only in three knobs:
//   • daily    — date-seeded so everyone gets the same eras; one result per day,
//                which locks and feeds the streak (the original 20-0 flow).
//   • classic  — free play: a fresh RANDOM era sequence every game, replay forever,
//                no lock, no streak.
//   • hoops-iq — like classic, but stats, ratings, AND award stars are HIDDEN
//                during the draft (you pick on names alone); all revealed at Results.
//
// Keeping this as plain data + flags means the React shell branches on the flags
// rather than the mode id, so adding a fourth mode is a data change, not new
// control flow scattered through the UI.

export type GameMode = 'daily' | 'classic' | 'hoops-iq'

export interface ModeConfig {
  id: GameMode
  name: string
  emoji: string
  blurb: string
  /** Date-seeded, one result per day, locks + advances the streak. */
  daily: boolean
  /** Hide stats during the draft (revealed at Results) — draft by reputation. */
  hideStats: boolean
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
 * A fresh unsigned-32-bit seed for a replayable (non-daily) game. Non-deterministic
 * by design — each Classic/Hoops IQ play draws a different era sequence. Daily uses
 * `seedFor(dateKey, …)` instead so its sequence is stable for the whole ET day.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}
