// Sports registry.
//
// A school can field more than one sport. Each sport shares the school → sport →
// mode → game flow, but the playable engine (positions, roster size, eras,
// dataset) is sport-specific. Both basketball and football are live (#7); the
// per-sport `available` flag stays so a future sport can be scaffolded behind a
// "coming soon" screen rather than shipping a half-built draft. Whether a given
// SCHOOL can actually play a live sport still depends on it carrying that
// dataset — a data-less school degrades to the empty-wheel "no data yet" landing.
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
  /** Playable now? Both basketball and football are live; the flag remains so a
   *  future sport can be scaffolded behind a "coming soon" screen. */
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
    available: true,
    blurb: 'Draft a 12-man roster across the eras and chase a perfect 16–0.',
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

/**
 * Is this sport actually PLAYABLE for THIS school right now? `sportsForSchool`
 * decides whether to *show* a sport's card; this decides whether that card routes
 * into a real draft or to the "coming soon" screen. A sport is playable only when
 * it's globally `available` AND the school carries that sport's dataset — football
 * ships for Michigan only today, so every other school's football card (it still
 * fields football) reads as "coming soon" instead of opening an empty draft.
 */
export function sportPlayableForSchool(
  school: School,
  sportId: SportId,
): boolean {
  const sport = SPORTS.find((s) => s.id === sportId)
  if (!sport?.available) return false
  return sportId === 'football' ? !!school.football : !!school.basketball
}
