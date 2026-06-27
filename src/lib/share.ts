// Wordle-style share string. Spoiler-free by default (no player names), so
// posting your daily result doesn't give away the answer.

import type { BballPosition } from '../types'
import { BBALL_POSITIONS } from '../types'

export const SITE_URL = 'https://wardcrazy01894.github.io/YourSchoolAllStars/'

/** Rating → colored square tier. */
export function ratingSquare(rating: number | null): string {
  if (rating === null) return '⬛' // unfilled slot
  if (rating >= 90) return '🟩'
  if (rating >= 75) return '🟦'
  if (rating >= 60) return '🟨'
  return '🟥'
}

export interface ShareOptions {
  schoolName: string // "Michigan"
  dateKey: string // "2026-06-25"
  wins: number
  games: number
  grade: string // "SOLID"
  /** Rating per position slot (null = unfilled). */
  ratingsByPosition: Record<BballPosition, number | null>
  emoji?: string // sport emoji, default 🏀
  /**
   * Daily challenge → the subtitle is "Daily <date>". Free-play modes pass
   * `daily: false` so the share doesn't falsely claim to be a daily result.
   * Defaults to daily (true) for backwards compatibility.
   */
  daily?: boolean
  /** Mode label for free-play shares, e.g. "Classic". Ignored when daily. */
  modeLabel?: string
}

export function buildShareString(o: ShareOptions): string {
  const squares = BBALL_POSITIONS.map((p) =>
    ratingSquare(o.ratingsByPosition[p]),
  ).join('')
  // Free-play results must NOT masquerade as the daily — label them by mode and
  // drop the date (a free-play game isn't tied to "today's" puzzle).
  const subtitle =
    o.daily === false ? (o.modeLabel ?? 'Free play') : `Daily ${o.dateKey}`
  return [
    `${o.emoji ?? '🏀'} YourSchoolAllStars — ${o.schoolName}`,
    subtitle,
    `Projected ${o.wins}–${o.games - o.wins} · ${o.grade}`,
    squares,
    SITE_URL,
  ].join('\n')
}

export interface FbShareOptions {
  schoolName: string
  dateKey: string
  wins: number
  games: number
  grade: string
  /** Rating per roster slot, in slot order (null = unfilled). 12 for football. */
  ratings: (number | null)[]
  daily?: boolean
  modeLabel?: string
}

/**
 * Football share string. Same spoiler-free shape as the basketball builder, but
 * the squares come from the 12-man roster (in slot order) rather than the five
 * basketball positions, and the projected record is out of 16.
 */
export function buildFbShareString(o: FbShareOptions): string {
  const squares = o.ratings.map(ratingSquare).join('')
  const subtitle =
    o.daily === false ? (o.modeLabel ?? 'Free play') : `Daily ${o.dateKey}`
  return [
    `🏈 YourSchoolAllStars — ${o.schoolName}`,
    subtitle,
    `Projected ${o.wins}–${o.games - o.wins} · ${o.grade}`,
    squares,
    SITE_URL,
  ].join('\n')
}
