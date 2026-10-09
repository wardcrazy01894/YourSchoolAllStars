// Worker ↔ client contract parity. The worker is plain .mjs and can't import the
// app's TS, so each side keeps its own copy of these lists and rules — this test
// imports BOTH and fails the moment they drift (a school, mode or outage day
// added on one side only would otherwise ship green: the worker would silently
// 400 every submit for it, or the device and server streaks would fork).
import { describe, it, expect } from 'vitest'
import {
  SCHOOLS as WORKER_SCHOOLS,
  DAILY_MODES,
  SPORT_MAX_SCORE,
  OUTAGE_DAYS as WORKER_OUTAGE_DAYS,
  advanceStreak,
  addDays,
  isPlausibleScore,
  WIN_PIVOT as W_PIVOT,
  WIN_SPREAD as W_SPREAD,
  UNDEFEATED_STRENGTH as W_UNDEFEATED,
  WINLESS_STRENGTH as W_WINLESS,
} from './leaderboard-lib.mjs'
import { SCHOOLS } from '../src/schools'
import { MODES } from '../src/lib/modes'
import { SPORTS } from '../src/lib/sports'
import { FULL_BBALL_ID, FULL_FB_ID } from '../src/lib/full'
import {
  BBALL_GAMES,
  projectedWins,
  WIN_PIVOT,
  WIN_SPREAD,
  UNDEFEATED_STRENGTH,
  WINLESS_STRENGTH,
} from '../src/lib/rating'
import {
  FB_GAMES,
  fbProjectedWins,
  FB_WIN_PIVOT,
  FB_WIN_SPREAD,
  FB_UNDEFEATED_STRENGTH,
  FB_WINLESS_STRENGTH,
} from '../src/lib/football-rating'
import { OUTAGE_DAYS, nextStreak, EMPTY_STREAK } from '../src/lib/progress'

describe('worker allowlists match the client', () => {
  it('SCHOOLS = every available school + the two Full sentinels', () => {
    const client = [
      ...SCHOOLS.filter((s) => s.available).map((s) => s.id),
      FULL_BBALL_ID,
      FULL_FB_ID,
    ]
    expect([...WORKER_SCHOOLS].sort()).toEqual(client.sort())
  })

  it('DAILY_MODES = the modes flagged daily: true', () => {
    const client = MODES.filter((m) => m.daily).map((m) => m.id)
    expect([...DAILY_MODES].sort()).toEqual(client.sort())
  })

  it('SPORT_MAX_SCORE covers every sport at its season length', () => {
    expect(Object.keys(SPORT_MAX_SCORE).sort()).toEqual(
      SPORTS.map((s) => s.id).sort(),
    )
    expect(SPORT_MAX_SCORE).toEqual({
      basketball: BBALL_GAMES,
      football: FB_GAMES,
    })
  })

  it('OUTAGE_DAYS are identical', () => {
    expect([...WORKER_OUTAGE_DAYS]).toEqual([...OUTAGE_DAYS])
  })
})

// The worker stores rows as { current, best, last_played_date } (null = no row
// yet); the client as { current, max, lastDate } (EMPTY_STREAK = never played).
const toRow = (s) =>
  s.lastDate === null
    ? null
    : { current: s.current, best: s.max, last_played_date: s.lastDate }
const fromRow = (r) => ({
  current: r.current,
  max: r.best,
  lastDate: r.last_played_date,
})

describe('advanceStreak (worker) ≡ nextStreak (client)', () => {
  // Anchor the cases around each outage day plus an ordinary stretch, so the
  // forgiven-gap branch is exercised as well as plain steps, resets and replays.
  const anchors = ['2026-06-01', ...OUTAGE_DAYS]
  const prevs = [EMPTY_STREAK]
  for (const a of anchors) {
    for (const off of [-3, -2, -1, 0, 1]) {
      for (const [current, max] of [
        [1, 1],
        [4, 9],
        [12, 12],
      ]) {
        prevs.push({ current, max, lastDate: addDays(a, off) })
      }
    }
  }

  it.each(anchors)('agrees on every (prev, date) pair around %s', (a) => {
    for (const prev of prevs) {
      for (let off = -4; off <= 5; off++) {
        const date = addDays(a, off)
        expect(
          fromRow(advanceStreak(toRow(prev), date)),
          `${JSON.stringify(prev)} → ${date}`,
        ).toEqual(nextStreak(prev, date))
      }
    }
  })
})

describe('worker score plausibility accepts every real client result', () => {
  it('uses the same win-curve constants as both sports', () => {
    const worker = [W_PIVOT, W_SPREAD, W_UNDEFEATED, W_WINLESS]
    expect(worker).toEqual([
      WIN_PIVOT,
      WIN_SPREAD,
      UNDEFEATED_STRENGTH,
      WINLESS_STRENGTH,
    ])
    expect(worker).toEqual([
      FB_WIN_PIVOT,
      FB_WIN_SPREAD,
      FB_UNDEFEATED_STRENGTH,
      FB_WINLESS_STRENGTH,
    ])
  })

  // One starter → team strength = its rating, so this sweeps the client's own
  // strength → wins path over an unrounded grid and submits it exactly as the
  // app does (strength rounded, wins as rated).
  it('for every unrounded strength 0..100 in both sports', () => {
    for (let t = 0; t <= 10_000; t++) {
      const strength = t / 100
      const shown = Math.round(strength)
      const bb = projectedWins([{ position: 'PG', rating: strength }])
      const fb = fbProjectedWins([{ position: 'QB', rating: strength }])
      expect(isPlausibleScore(bb, shown, BBALL_GAMES), `bb ${strength}`).toBe(
        true,
      )
      expect(isPlausibleScore(fb, shown, FB_GAMES), `fb ${strength}`).toBe(true)
    }
  })
})
