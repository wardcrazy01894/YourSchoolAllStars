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
    // Reference identity is intentional: the same-day short-circuit returns the
    // prior object so React state doesn't churn. (A value-equal new object would
    // be harmless behaviour, but we assert the short-circuit on purpose here.)
    expect(nextStreak(day1, '2026-06-25')).toBe(day1)
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
  it('leaves the streak fully untouched on a backwards date', () => {
    // A backwards date (old ?date= playtest URL) must NOT roll lastDate back —
    // doing so makes every later real day read as a gap. The whole streak,
    // including lastDate, stays put.
    const june26 = nextStreak(
      nextStreak(EMPTY_STREAK, '2026-06-25'),
      '2026-06-26',
    )
    const after = nextStreak(june26, '2026-06-24')
    expect(after).toBe(june26) // unchanged, lastDate still 2026-06-26
  })

  it('preserves a real streak after a backwards playtest date is opened', () => {
    let s = nextStreak(EMPTY_STREAK, '2026-06-25') // current 1
    s = nextStreak(s, '2026-06-26') // current 2
    s = nextStreak(s, '2026-06-24') // backwards — ignored
    s = nextStreak(s, '2026-06-27') // the genuine next day
    expect(s).toEqual({ current: 3, max: 3, lastDate: '2026-06-27' })
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
  it('does not advance the streak when the daily write fails (quota/disabled)', () => {
    // If persistence throws, the day isn't saved — so the streak must NOT bump,
    // else the day stays replayable and would double-count on the next play.
    const orig = localStorage.setItem.bind(localStorage)
    localStorage.setItem = () => {
      throw new Error('QuotaExceeded')
    }
    try {
      const streak = saveDailyResult(SCHOOL, SPORT, sampleDaily('2026-06-25'))
      expect(streak).toEqual(EMPTY_STREAK) // not advanced
    } finally {
      localStorage.setItem = orig
    }
    expect(loadDaily(SCHOOL, SPORT, '2026-06-25')).toBeNull() // still replayable
    expect(loadStreak(SCHOOL, SPORT)).toEqual(EMPTY_STREAK)
  })
})
