// Sports registry.
//
// A school can field more than one sport. Each sport shares the school → sport →
// mode → game flow, but the playable engine (positions, roster size, eras,
// dataset) is sport-specific. Basketball is live; football is scaffolded here so
// the picker is a REAL step now — its config exists and routes, but `available`
// is false until the football dataset + engine land (#7). No fabricated data: an
// unavailable sport opens a "coming soon" screen, never a half-built draft.
//
// Which sports a given SCHOOL offers is a separate question (a school may not
// field football at all — see `School.hasFootball`); `sportsForSchool` combines
// the two so the picker shows football only where it actually exists.

import type { School } from '../schools'

export type SportId = 'basketball' | 'football'

export interface SportConfig {
  id: SportId
  name: string // "Basketball"
  emoji: string // 🏀
  /** Playable now? Basketball yes; football is scaffolding until #7 lands. */
  available: boolean
  /** One-line tease for the sport card. */
  blurb: string
}

export const SPORTS: SportConfig[] = [
  {
    id: 'basketball',
    name: 'Basketball',
    emoji: '🏀',
    available: true,
    blurb: 'Draft an all-time starting five and chase a perfect 40–0.',
  },
  {
    id: 'football',
    name: 'Football',
    emoji: '🏈',
    available: false,
    blurb: 'Build an all-time roster across the eras. Coming soon.',
  },
]

export const DEFAULT_SPORT_ID: SportId = 'basketball'

/** Resolve a sport id (e.g. from a `?sport=` param) to its config; basketball if unknown. */
export function getSport(id: string | null | undefined): SportConfig {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0]
}

/** True if `id` names a real sport — gate `?sport=` URLs before trusting them. */
export function isSportId(id: string | null | undefined): id is SportId {
  return SPORTS.some((s) => s.id === id)
}

/**
 * The sports a school offers, in pick order. Basketball is the flagship and is
 * always listed; football only where the school actually fields it
 * (`hasFootball`) — so VCU (no football program) never shows a football card.
 * The per-sport `available` flag still governs whether the card is playable or
 * "coming soon".
 */
export function sportsForSchool(school: School): SportConfig[] {
  return SPORTS.filter(
    (s) => s.id === 'basketball' || (s.id === 'football' && school.hasFootball),
  )
}
