// "Full Football" engine (pure) — the football sibling of `full.ts`.
//
// Full Football spins BOTH a team and an era each round, so the 12-man roster
// can be drawn from any live football school. This module builds the
// cross-school player pool and the per-school era wheels; the spin sequence
// itself reuses `generateFullSpins` (the wheel shape is sport-agnostic), and
// the draft state machine (`football-game.ts`), rating, and reel geometry are
// reused unchanged.
//
// Two football-specific wrinkles vs Full Basketball:
//   • A school joins the pool only with a REAL dataset — `provisional` (mock)
//     football data is playable single-school behind a "mock data" banner, but
//     placeholder stats must never mix into the real cross-school pool.
//   • Each school's wheel comes from `fbWindows`, whose floor is data-driven
//     (its own earliest sourced season, never before 1994), so a spin can
//     never offer a school an era its data can't fill.

import type { FbPlayer } from '../types'
import type { School } from '../schools'
import { fbWindows } from './football'
import type { SchoolWheel } from './full'

/**
 * A pooled football player tagged with its origin school. `id` is namespaced
 * (`${schoolId}:${player.id}`) so two schools' identically-id'd players never
 * collide in one pool — and a saved Full daily can reload unambiguously. The
 * per-player `power5` is what makes the conference haircut player-scoped.
 */
export interface FullFbPlayer extends FbPlayer {
  schoolId: string
  schoolName: string
  emoji: string
  power5: boolean
}

/**
 * Schools that can contribute to the cross-school football pool right now:
 * available, carrying a football dataset, and that dataset is REAL (not the
 * provisional mock). A school auto-joins the moment a real dataset lands —
 * no registry change beyond attaching the data.
 */
function liveFootballSchools(schools: School[]): School[] {
  return schools.filter(
    (s) => s.available && s.football && !s.football.provisional,
  )
}

/**
 * The combined cross-school football pool. Each player's id is namespaced by
 * school and the player is stamped with its school metadata + power5 flag for
 * per-player rating (a non-power-5 pick is dinged; their teammates are not).
 */
export function buildFullFbPool(schools: School[]): FullFbPlayer[] {
  const pool: FullFbPlayer[] = []
  for (const s of liveFootballSchools(schools)) {
    for (const p of s.football!.players) {
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
 * The per-school era wheels, each derived from that school's OWN data via
 * `fbWindows` (rolling 4-year blocks from its data-driven floor to its most
 * recent season). Schools whose wheel would be empty are dropped, so a Full
 * spin can never land on a dead team — mirrors `buildSchoolWheels`.
 */
export function buildFbSchoolWheels(schools: School[]): SchoolWheel[] {
  const wheels: SchoolWheel[] = []
  for (const s of liveFootballSchools(schools)) {
    const windows = fbWindows(s.football!.players)
    if (windows.length === 0) continue
    wheels.push({ schoolId: s.id, windows })
  }
  return wheels
}

/**
 * The per-player power-5 flag for the rating resolver. A pooled
 * {@link FullFbPlayer} carries its own `power5`; a plain `FbPlayer` (a
 * single-school game) has none, so it defaults to true — the conference
 * haircut only ever applies where a flag explicitly says non-power-5.
 */
export function power5OfFullFb(p: FbPlayer): boolean {
  return (p as Partial<FullFbPlayer>).power5 ?? true
}
