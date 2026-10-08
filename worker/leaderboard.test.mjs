// @vitest-environment node
// The worker is Node/Workers-runtime code: run it outside the app's jsdom
// environment (file: URLs for the migrations, real Request/Response).
import { describe, it, expect } from 'vitest'
import {
  GAME_TZ,
  SPORT_MAX_SCORE,
  DAILY_MODES,
  SCHOOLS,
  OUTAGE_DAYS,
  MAX_SEED_STREAK,
  dateKeyFor,
  validDateKeys,
  isValidScore,
  isValidClientId,
  isValidDateKey,
  validateGame,
  validateView,
  validateSeed,
  validateSubmission,
  cutoffDateKey,
  RETENTION_DAYS,
  dayDiff,
  addDays,
  advanceStreak,
} from './leaderboard-lib.mjs'

/**
 * Pure-helper tests for the leaderboard Worker. These are the validation gates
 * that keep junk out of D1 (unknown games, forged dates, impossible scores, bad
 * seeds) — exercise them directly so a regression can't ship silently. The full
 * request path is covered in leaderboard.handler.test.mjs; the SQL in
 * leaderboard-db.test.mjs.
 */

const CLIENT = '3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e'

describe('constants mirror the client', () => {
  it('uses the game timezone (ET)', () => {
    expect(GAME_TZ).toBe('America/New_York')
  })
  it('scores are projected wins: 40 basketball, 16 football', () => {
    expect(SPORT_MAX_SCORE).toEqual({ basketball: 40, football: 16 })
  })
  it('only the two daily modes submit', () => {
    expect(DAILY_MODES).toEqual(['daily', 'daily-iq'])
  })
  it('covers the six schools plus the two full-mode sentinels', () => {
    expect([...SCHOOLS].sort()).toEqual([
      'florida',
      'full-basketball',
      'full-football',
      'michigan',
      'pitt',
      'unc',
      'vcu',
      'vt',
    ])
  })
  it('lists the 2026-10-07 outage (same as src/lib/progress.ts)', () => {
    expect(OUTAGE_DAYS).toEqual(['2026-10-07'])
  })
})

describe('dateKeyFor', () => {
  it('formats an ET calendar day as YYYY-MM-DD', () => {
    // 2026-06-15T02:00Z is still 2026-06-14 in US Eastern.
    const d = new Date('2026-06-15T02:00:00Z')
    expect(dateKeyFor(d)).toBe('2026-06-14')
    expect(dateKeyFor(d, 'UTC')).toBe('2026-06-15')
  })
})

describe('validDateKeys', () => {
  it('accepts yesterday/today/tomorrow in ET (skew + rollover)', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const keys = validDateKeys(now)
    expect(keys.has('2026-06-14')).toBe(true)
    expect(keys.has('2026-06-15')).toBe(true)
    expect(keys.has('2026-06-16')).toBe(true)
    expect(keys.has('2026-06-13')).toBe(false)
    expect(keys.has('2099-01-01')).toBe(false)
  })
})

describe('isValidScore', () => {
  it('accepts integers in [0, max]', () => {
    expect(isValidScore(0, 40)).toBe(true)
    expect(isValidScore(40, 40)).toBe(true)
    expect(isValidScore(16, 16)).toBe(true)
  })
  it('rejects out-of-range, floats, NaN, and non-numbers', () => {
    expect(isValidScore(-1, 40)).toBe(false)
    expect(isValidScore(41, 40)).toBe(false)
    expect(isValidScore(17, 16)).toBe(false)
    expect(isValidScore(12.5, 40)).toBe(false)
    expect(isValidScore(NaN, 40)).toBe(false)
    expect(isValidScore('20', 40)).toBe(false)
    expect(isValidScore(undefined, 40)).toBe(false)
  })
})

describe('isValidClientId', () => {
  it('accepts a crypto.randomUUID-shaped id', () => {
    expect(isValidClientId(CLIENT)).toBe(true)
  })
  it('rejects empty, too-short, too-long, or unsafe-charset ids', () => {
    expect(isValidClientId('')).toBe(false)
    expect(isValidClientId('short')).toBe(false)
    expect(isValidClientId('x'.repeat(65))).toBe(false)
    expect(isValidClientId('has spaces!!')).toBe(false)
    expect(isValidClientId(42)).toBe(false)
  })
})

describe('isValidDateKey', () => {
  it('accepts a real date, rejects bad format and impossible dates', () => {
    expect(isValidDateKey('2026-06-15')).toBe(true)
    expect(isValidDateKey('2026-6-15')).toBe(false)
    expect(isValidDateKey('2026-99-99')).toBe(false)
    expect(isValidDateKey('not-a-date')).toBe(false)
    expect(isValidDateKey(null)).toBe(false)
  })
})

describe('validateGame', () => {
  it('accepts a known school + sport + daily mode', () => {
    expect(
      validateGame({ school: 'michigan', sport: 'basketball', mode: 'daily' }),
    ).toEqual({
      ok: true,
      value: { school: 'michigan', sport: 'basketball', mode: 'daily' },
    })
  })
  it('accepts the full-mode sentinels as schools', () => {
    expect(
      validateGame({
        school: 'full-football',
        sport: 'football',
        mode: 'daily',
      }).ok,
    ).toBe(true)
  })
  it('rejects an unknown school / sport / mode', () => {
    expect(
      validateGame({ school: 'osu', sport: 'basketball', mode: 'daily' }),
    ).toMatchObject({ ok: false, status: 400, error: 'unknown school' })
    expect(
      validateGame({ school: 'michigan', sport: 'hockey', mode: 'daily' }),
    ).toMatchObject({ ok: false, error: 'unknown sport' })
    expect(
      validateGame({
        school: 'michigan',
        sport: 'basketball',
        mode: 'classic',
      }),
    ).toMatchObject({ ok: false, error: 'unknown mode' })
  })
})

describe('validateView', () => {
  const game = { school: 'unc', sport: 'football', mode: 'daily-iq' }
  it('accepts a known game + valid date (any day — read-only)', () => {
    expect(validateView({ ...game, date: '2020-01-01' })).toEqual({
      ok: true,
      value: { ...game, date: '2020-01-01' },
    })
  })
  it('rejects an unknown game', () => {
    expect(
      validateView({ ...game, school: 'atlantis', date: '2026-06-15' }),
    ).toMatchObject({ ok: false, error: 'unknown school' })
  })
  it('rejects a malformed date', () => {
    expect(validateView({ ...game, date: 'nope' })).toMatchObject({
      ok: false,
      error: 'invalid date',
    })
  })
})

describe('validateSeed', () => {
  const DATE = '2026-10-08'
  it('absent → no seed', () => {
    expect(validateSeed(undefined, DATE)).toEqual({ ok: true, value: null })
    expect(validateSeed(null, DATE)).toEqual({ ok: true, value: null })
  })
  it('passes a well-formed client streak through', () => {
    expect(
      validateSeed({ current: 54, max: 54, lastDate: '2026-10-08' }, DATE),
    ).toEqual({
      ok: true,
      value: { current: 54, max: 54, lastDate: '2026-10-08' },
    })
  })
  it('a never-played streak is the same as no seed', () => {
    expect(validateSeed({ current: 0, max: 0, lastDate: null }, DATE)).toEqual({
      ok: true,
      value: null,
    })
  })
  it('rejects non-integers, max < current, absurd values, bad dates', () => {
    const bad = { ok: false, status: 400, error: 'invalid seed' }
    expect(
      validateSeed({ current: 1.5, max: 2, lastDate: DATE }, DATE),
    ).toMatchObject(bad)
    expect(
      validateSeed({ current: 5, max: 2, lastDate: DATE }, DATE),
    ).toMatchObject(bad)
    expect(
      validateSeed(
        {
          current: MAX_SEED_STREAK + 1,
          max: MAX_SEED_STREAK + 1,
          lastDate: DATE,
        },
        DATE,
      ),
    ).toMatchObject(bad)
    expect(
      validateSeed({ current: 1, max: 1, lastDate: 'yesterday' }, DATE),
    ).toMatchObject(bad)
    expect(validateSeed('54', DATE)).toMatchObject(bad)
  })
  it('rejects a seed claiming a play after the submitted day', () => {
    expect(
      validateSeed({ current: 1, max: 1, lastDate: '2026-10-09' }, DATE),
    ).toMatchObject({ ok: false, error: 'invalid seed' })
  })
})

describe('cutoffDateKey', () => {
  it('is RETENTION_DAYS before now (keep boundary, exclusive)', () => {
    expect(cutoffDateKey(new Date('2026-06-15T12:00:00Z'))).toBe('2026-03-17')
  })
  it('honors a custom window and defaults to 90 days', () => {
    expect(cutoffDateKey(new Date('2026-06-15T12:00:00Z'), 1)).toBe(
      '2026-06-14',
    )
    expect(RETENTION_DAYS).toBe(90)
  })
})

describe('dayDiff / addDays', () => {
  it('count whole days across month and leap boundaries', () => {
    expect(dayDiff('2026-06-14', '2026-06-15')).toBe(1)
    expect(dayDiff('2026-06-15', '2026-06-14')).toBe(-1)
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })
})

describe('advanceStreak (mirrors the client nextStreak exactly)', () => {
  it('starts a new streak at 1 when there is no prior row', () => {
    expect(advanceStreak(null, '2026-06-15')).toEqual({
      current: 1,
      best: 1,
      last_played_date: '2026-06-15',
    })
  })
  it('increments when the prior play was yesterday and tracks best', () => {
    const prev = { current: 5, best: 5, last_played_date: '2026-06-14' }
    expect(advanceStreak(prev, '2026-06-15')).toEqual({
      current: 6,
      best: 6,
      last_played_date: '2026-06-15',
    })
  })
  it('resets to 1 after a gap, preserving best', () => {
    const prev = { current: 9, best: 9, last_played_date: '2026-06-10' }
    expect(advanceStreak(prev, '2026-06-15')).toMatchObject({
      current: 1,
      best: 9,
    })
  })
  it('is a no-op on same-day replay (returns the stored row)', () => {
    const prev = { current: 4, best: 7, last_played_date: '2026-06-15' }
    expect(advanceStreak(prev, '2026-06-15')).toBe(prev)
  })
  it('leaves the row untouched on a backwards date', () => {
    const prev = { current: 4, best: 7, last_played_date: '2026-06-15' }
    expect(advanceStreak(prev, '2026-06-14')).toBe(prev)
  })
  it('carries a streak across the 2026-10-07 outage and credits it', () => {
    const prev = { current: 52, best: 52, last_played_date: '2026-10-06' }
    expect(advanceStreak(prev, '2026-10-08')).toEqual({
      current: 54,
      best: 54,
      last_played_date: '2026-10-08',
    })
  })
  it('does not forgive a gap that includes a non-outage day', () => {
    const prev = { current: 52, best: 52, last_played_date: '2026-10-05' }
    expect(advanceStreak(prev, '2026-10-08')).toMatchObject({ current: 1 })
    const late = { current: 52, best: 52, last_played_date: '2026-10-06' }
    expect(advanceStreak(late, '2026-10-09')).toMatchObject({ current: 1 })
  })
})

describe('validateSubmission', () => {
  const now = new Date('2026-06-15T16:00:00Z') // afternoon Eastern
  const today = dateKeyFor(now)
  const good = {
    school: 'michigan',
    sport: 'basketball',
    mode: 'daily',
    date: today,
    score: 31,
    clientId: CLIENT,
  }

  it('accepts a well-formed submission for a known game + today', () => {
    expect(validateSubmission(good, now)).toEqual({
      ok: true,
      value: { ...good, seed: null },
    })
  })
  it('carries a well-formed seed when provided', () => {
    const seed = { current: 54, max: 54, lastDate: today }
    const r = validateSubmission({ ...good, seed }, now)
    expect(r.ok).toBe(true)
    expect(r.value.seed).toEqual(seed)
  })
  it('rejects a malformed seed', () => {
    expect(
      validateSubmission({ ...good, seed: { current: -1 } }, now),
    ).toMatchObject({ ok: false, error: 'invalid seed' })
  })
  it('rejects an unknown school', () => {
    expect(validateSubmission({ ...good, school: 'osu' }, now)).toMatchObject({
      ok: false,
      status: 400,
      error: 'unknown school',
    })
  })
  it('rejects a free-play mode', () => {
    expect(validateSubmission({ ...good, mode: 'classic' }, now)).toMatchObject(
      {
        ok: false,
        error: 'unknown mode',
      },
    )
  })
  it('rejects a date outside the ±1-day window (no seeding past/future days)', () => {
    expect(
      validateSubmission({ ...good, date: '2020-01-01' }, now),
    ).toMatchObject({ ok: false, error: 'date out of range' })
  })
  it("rejects a score over the sport's max (41 for basketball, 17 for football)", () => {
    expect(validateSubmission({ ...good, score: 41 }, now)).toMatchObject({
      ok: false,
      error: 'invalid score',
    })
    expect(
      validateSubmission({ ...good, sport: 'football', score: 17 }, now),
    ).toMatchObject({ ok: false, error: 'invalid score' })
    expect(
      validateSubmission({ ...good, sport: 'football', score: 16 }, now).ok,
    ).toBe(true)
  })
  it('rejects a malformed clientId', () => {
    expect(
      validateSubmission({ ...good, clientId: 'nope!' }, now),
    ).toMatchObject({ ok: false, error: 'invalid clientId' })
  })
})
