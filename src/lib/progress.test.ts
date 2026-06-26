import { describe, it, expect, beforeEach } from 'vitest'
import {
  EMPTY_STREAK,
  dayDiff,
  nextStreak,
  loadStreak,
  loadDaily,
  saveDailyResult,
  type SavedDaily,
} from './progress'

const SCHOOL = 'michigan'
const SPORT = 'basketball'

function sampleDaily(dateKey: string): SavedDaily {
  return {
    dateKey,
    playerIds: { PG: 'trey-burke', C: 'hunter-dickinson' },
    wins: 34,
    grade: 'ELITE',
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('dayDiff', () => {
  it('is 0 for the same day', () => {
    expect(dayDiff('2026-06-25', '2026-06-25')).toBe(0)
  })
  it('is +1 for the next day', () => {
    expect(dayDiff('2026-06-25', '2026-06-26')).toBe(1)
  })
  it('counts whole days across a month boundary', () => {
    expect(dayDiff('2026-06-30', '2026-07-01')).toBe(1)
    expect(dayDiff('2026-01-01', '2026-01-08')).toBe(7)
  })
  it('counts across a year boundary (incl. leap years)', () => {
    expect(dayDiff('2023-12-31', '2024-01-01')).toBe(1)
    expect(dayDiff('2024-02-28', '2024-03-01')).toBe(2) // 2024 is a leap year
  })
  it('is negative when b precedes a', () => {
    expect(dayDiff('2026-06-26', '2026-06-25')).toBe(-1)
  })
})

describe('nextStreak', () => {
  it('starts a streak at 1 from EMPTY_STREAK', () => {
    expect(nextStreak(EMPTY_STREAK, '2026-06-25')).toEqual({
      current: 1,
      max: 1,
      lastDate: '2026-06-25',
    })
  })
  it('does not double-count a same-day replay', () => {
    const day1 = nextStreak(EMPTY_STREAK, '2026-06-25')
    expect(nextStreak(day1, '2026-06-25')).toBe(day1) // unchanged reference
  })
  it('increments on consecutive days and tracks max', () => {
    let s = nextStreak(EMPTY_STREAK, '2026-06-25')
    s = nextStreak(s, '2026-06-26')
    s = nextStreak(s, '2026-06-27')
    expect(s).toEqual({ current: 3, max: 3, lastDate: '2026-06-27' })
  })
  it('resets current to 1 on a gap of more than one day, preserving max', () => {
    let s = nextStreak(EMPTY_STREAK, '2026-06-25')
    s = nextStreak(s, '2026-06-26') // current 2, max 2
    s = nextStreak(s, '2026-06-29') // 3-day gap → reset
    expect(s).toEqual({ current: 1, max: 2, lastDate: '2026-06-29' })
  })
  it('treats a backwards date as a reset, not an increment', () => {
    const s = nextStreak(nextStreak(EMPTY_STREAK, '2026-06-25'), '2026-06-24')
    expect(s.current).toBe(1)
  })
})

describe('localStorage persistence', () => {
  it('returns EMPTY_STREAK when nothing is stored', () => {
    expect(loadStreak(SCHOOL, SPORT)).toEqual(EMPTY_STREAK)
  })
  it('returns null for an unplayed day', () => {
    expect(loadDaily(SCHOOL, SPORT, '2026-06-25')).toBeNull()
  })
  it('persists a completed daily and advances the streak', () => {
    const streak = saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
    expect(streak).toEqual({ current: 1, max: 1, lastDate: '2026-06-25' })
    expect(loadDaily(SCHOOL, SPORT, '2026-06-25')).toEqual(
      sampleDaily('2026-06-25'),
    )
    expect(loadStreak(SCHOOL, SPORT)).toEqual(streak)
  })
  it('advances the streak across consecutive saved days', () => {
    saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
    const streak = saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-26'))
    expect(streak).toEqual({ current: 2, max: 2, lastDate: '2026-06-26' })
  })
  it('is idempotent — re-saving the same day does not double-count', () => {
    saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
    const again = saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
    expect(again).toEqual({ current: 1, max: 1, lastDate: '2026-06-25' })
  })
  it('namespaces by school+sport so they do not collide', () => {
    saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
    expect(loadStreak('ohio-state', SPORT)).toEqual(EMPTY_STREAK)
    expect(loadDaily(SCHOOL, 'football', '2026-06-25')).toBeNull()
  })
  it('falls back safely on corrupt stored JSON', () => {
    localStorage.setItem(`ysas:${SCHOOL}:${SPORT}:streak`, '{not valid json')
    expect(loadStreak(SCHOOL, SPORT)).toEqual(EMPTY_STREAK)
  })
})
