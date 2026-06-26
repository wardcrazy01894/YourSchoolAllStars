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
}

export function buildShareString(o: ShareOptions): string {
  const squares = BBALL_POSITIONS.map((p) =>
    ratingSquare(o.ratingsByPosition[p]),
  ).join('')
  return [
    `${o.emoji ?? '🏀'} YourSchoolAllStars — ${o.schoolName}`,
    `Daily ${o.dateKey}`,
    `Projected ${o.wins}–${o.games - o.wins} · ${o.grade}`,
    squares,
    SITE_URL,
  ].join('\n')
}
