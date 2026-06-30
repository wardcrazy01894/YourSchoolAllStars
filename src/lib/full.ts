// "Full Basketball" engine (pure).
//
// The single-school games lock the draft to one school's eras. Full Basketball
// spins BOTH a team and an era each pick, so a starting five can be drawn from
// any live school. This module builds the cross-school player pool and the
// per-school era wheels, and generates the seeded spin sequence (team uniformly,
// then era uniformly within that team — "each team equal", Alex's call).
//
// Everything here is school-agnostic data + pure functions: the draft state
// machine (`game.ts`), rating, and reel geometry are reused unchanged. The only
// Full-specific wrinkle is per-player provenance — each pooled player carries its
// own school + power5 flag, so the non-power-5 rating haircut hits ONLY that
// player (a VCU pick is dinged; their power-5 teammates are not).

import type { BballPlayer, YearWindow } from '../types'
import type { School } from '../schools'
import { buildRollingWindows, datasetMaxYear } from './windows'
import { mulberry32 } from './daily'

/** Basketball rolling-wheel base year — overlapping 4-year eras start here. */
export const FULL_WINDOW_FROM = 1994
/** Rolling-era length in years (matches the single-school basketball wheel). */
export const FULL_WINDOW_SIZE = 4

/**
 * A pooled player tagged with its origin school. `id` is namespaced
 * (`${schoolId}:${player.id}`) so two schools' identically-id'd players never
 * collide in one pool — and a saved Full daily can reload unambiguously. The
 * per-player `power5` is what makes the conference haircut player-scoped.
 */
export interface FullPlayer extends BballPlayer {
  schoolId: string
  schoolName: string
  emoji: string
  power5: boolean
}

/** One spin's outcome: which school, and which of its eras. */
export interface EraSpin {
  schoolId: string
  window: YearWindow
}

/** A school's era wheel — the windows a Full spin can land on for that team. */
export interface SchoolWheel {
  schoolId: string
  windows: YearWindow[]
}

/** Schools that actually offer a playable basketball draft right now. */
function liveBasketballSchools(schools: School[]): School[] {
  return schools.filter((s) => s.available && s.basketball)
}

/**
 * The combined cross-school player pool. Only `available` schools with a
 * basketball dataset contribute; each player's id is namespaced by school and the
 * player is stamped with its school metadata + power5 flag for per-player rating.
 */
export function buildFullPool(schools: School[]): FullPlayer[] {
  const pool: FullPlayer[] = []
  for (const s of liveBasketballSchools(schools)) {
    for (const p of s.basketball!.players) {
      pool.push({
        ...p,
        id: `${s.id}:${p.id}`,
        schoolId: s.id,
        schoolName: s.name,
        emoji: s.emoji,
        power5: s.power5,
      })
    }
  }
  return pool
}

/**
 * The per-school era wheels. Each school's wheel is the data-driven rolling set
 * (1994 → its most recent season, 4-year blocks). Schools whose wheel would be
 * empty (no seasons / no data) are dropped, so a spin can never land on a dead
 * team — mirrors the single-school dead-era guard.
 */
export function buildSchoolWheels(schools: School[]): SchoolWheel[] {
  const wheels: SchoolWheel[] = []
  for (const s of liveBasketballSchools(schools)) {
    const maxYear = datasetMaxYear(s.basketball!.players)
    if (maxYear === null) continue
    const windows = buildRollingWindows(
      FULL_WINDOW_FROM,
      maxYear,
      FULL_WINDOW_SIZE,
    )
    if (windows.length === 0) continue
    wheels.push({ schoolId: s.id, windows })
  }
  return wheels
}

/**
 * The fixed era SEQUENCE for a Full game: `count` (school, era) spins drawn by the
 * seeded PRNG. Each spin picks a school uniformly (each team equal), then a window
 * uniformly within that school. Wheels with no windows are skipped so a spin never
 * lands on a holey era; if NO wheel has windows the sequence is empty (dead-era
 * safety net, mirroring `generateSpins`). Deterministic for a given seed — so a
 * daily/Daily-IQ Full puzzle is identical for everyone on the ET day.
 */
export function generateFullSpins(
  seed: number,
  count: number,
  wheels: SchoolWheel[],
): EraSpin[] {
  const playable = wheels.filter((w) => w.windows.length > 0)
  if (playable.length === 0) return []
  const rng = mulberry32(seed)
  const out: EraSpin[] = []
  for (let i = 0; i < count; i++) {
    const wheel = playable[Math.floor(rng() * playable.length)]
    const window = wheel.windows[Math.floor(rng() * wheel.windows.length)]
    out.push({ schoolId: wheel.schoolId, window })
  }
  return out
}

/**
 * The per-player power-5 flag for the rating resolver. A pooled {@link FullPlayer}
 * carries its own `power5`; a plain `BballPlayer` (e.g. a single-school game) has
 * none, so it defaults to true — the conference haircut only ever applies where a
 * flag explicitly says non-power-5.
 */
export function power5OfFull(p: BballPlayer): boolean {
  return (p as Partial<FullPlayer>).power5 ?? true
}
