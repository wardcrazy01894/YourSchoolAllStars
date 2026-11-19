import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mergeStreak,
  planSync,
  savedFromDay,
  streakClaims,
  syncProgress,
} from './sync'
import type { ServerDay, ServerStreak } from './account'
import { getDateKey } from './daily'
import {
  EMPTY_STREAK,
  OUTAGE_DAYS,
  loadDaily,
  loadOwner,
  loadStreak,
  saveDailyResult,
  saveOwner,
  writeStreak,
  type GameRef,
  type SavedDaily,
  type Streak,
} from './progress'

const ENDPOINT = 'https://ysas-leaderboard.example.workers.dev'
const TOKEN = 'f'.repeat(48)
const TODAY = getDateKey()
const day = (n: number, from = TODAY) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
const YESTERDAY = day(-1)

const UM: GameRef = { school: 'michigan', sport: 'basketball', mode: 'daily' }
const IQ: GameRef = { ...UM, mode: 'daily-iq' }
const FB: GameRef = {
  school: 'full-football',
  sport: 'football',
  mode: 'daily',
}

const streak = (current: number, max: number, lastDate: string): Streak => ({
  current,
  max,
  lastDate,
})
const serverStreak = (
  g: GameRef,
  current: number,
  best: number,
  lastDate: string,
): ServerStreak => ({ ...g, current, best, lastDate })

const DETAIL = {
  playerIds: { PG: 'trey-burke', C: 'juwan-howard' },
  windows: { PG: { start: 2010, end: 2013 }, C: { start: 1992, end: 1995 } },
  grade: 'ELITE',
}
const serverDay = (g: GameRef, date: string, over = {}): ServerDay => ({
  ...g,
  date,
  score: 34,
  strength: 70,
  detail: DETAIL,
  ...over,
})
const saved = (
  dateKey: string,
  over: Partial<SavedDaily> = {},
): SavedDaily => ({
  dateKey,
  playerIds: { PG: 'cazzie-russell' },
  windows: { PG: { start: 1964, end: 1967 } },
  wins: 31,
  grade: 'SOLID',
  strength: 66,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', ENDPOINT)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('mergeStreak', () => {
  it('nothing on the other side → the same object back', () => {
    const mine = streak(4, 9, TODAY)
    expect(mergeStreak(mine, EMPTY_STREAK)).toBe(mine)
    expect(mergeStreak(mine, streak(4, 9, TODAY))).toBe(mine)
  })

  it('a device that never played takes the account’s streak', () => {
    expect(mergeStreak(EMPTY_STREAK, streak(12, 15, TODAY))).toEqual(
      streak(12, 15, TODAY),
    )
  })

  it('same last day → the longer one, with the higher best', () => {
    expect(mergeStreak(streak(3, 20, TODAY), streak(12, 12, TODAY))).toEqual(
      streak(12, 20, TODAY),
    )
  })

  it('consecutive days → one unbroken run, never double-counted', () => {
    expect(mergeStreak(streak(9, 9, YESTERDAY), streak(1, 4, TODAY))).toEqual(
      streak(10, 10, TODAY),
    )
    expect(mergeStreak(streak(1, 4, TODAY), streak(9, 9, YESTERDAY))).toEqual(
      streak(10, 10, TODAY),
    )
    expect(mergeStreak(streak(10, 10, TODAY), streak(9, 9, YESTERDAY))).toEqual(
      streak(10, 10, TODAY),
    )
  })

  it('a lapsed streak does not come back, but its best does', () => {
    expect(mergeStreak(streak(40, 40, day(-5)), streak(2, 2, TODAY))).toEqual(
      streak(2, 40, TODAY),
    )
  })

  it('a gap of only outage days continues the run', () => {
    const outage = OUTAGE_DAYS[0]
    expect(
      mergeStreak(streak(5, 5, day(-1, outage)), streak(1, 1, day(1, outage))),
    ).toEqual(streak(7, 7, day(1, outage)))
  })
})

describe('savedFromDay', () => {
  it('rebuilds the saved daily from a server result', () => {
    expect(savedFromDay(serverDay(UM, TODAY))).toEqual({
      dateKey: TODAY,
      playerIds: DETAIL.playerIds,
      windows: DETAIL.windows,
      wins: 34,
      grade: 'ELITE',
      strength: 70,
    })
  })

  it('null without a usable draft', () => {
    expect(savedFromDay(serverDay(UM, TODAY, { detail: null }))).toBeNull()
    expect(
      savedFromDay(serverDay(UM, TODAY, { detail: { playerIds: {} } })),
    ).toBeNull()
    expect(
      savedFromDay(
        serverDay(UM, TODAY, {
          detail: { playerIds: { PG: 7 }, grade: 'A' },
        }),
      ),
    ).toBeNull()
    expect(savedFromDay(serverDay(UM, 'not-a-date'))).toBeNull()
    expect(savedFromDay(serverDay(UM, TODAY, { strength: 400 }))).toBeNull()
  })
})

describe('planSync', () => {
  const plan = (
    me: { streaks?: ServerStreak[]; days?: ServerDay[] },
    local: {
      streaks?: [GameRef, Streak][]
      dailies?: [GameRef, SavedDaily][]
    } = {},
  ) => {
    const id = (g: GameRef) => `${g.school}:${g.sport}:${g.mode}`
    const dailies = local.dailies ?? []
    return planSync({
      me,
      todayKey: TODAY,
      streakOf: (g) =>
        (local.streaks ?? []).find(([x]) => id(x) === id(g))?.[1] ??
        EMPTY_STREAK,
      dailyOf: (g, dateKey) =>
        dailies.find(
          ([x, s]) => id(x) === id(g) && s.dateKey === dateKey,
        )?.[1] ?? null,
      localToday: dailies
        .filter(([, s]) => s.dateKey === TODAY)
        .map(([g, s]) => ({ ...g, saved: s })),
    })
  }

  it('nothing to do when the device already matches the account', () => {
    expect(
      plan(
        {
          streaks: [serverStreak(UM, 4, 9, TODAY)],
          days: [serverDay(UM, TODAY)],
        },
        {
          streaks: [[UM, streak(4, 9, TODAY)]],
          dailies: [[UM, saved(TODAY)]],
        },
      ),
    ).toEqual({ streaks: [], adopt: [], unsent: [] })
  })

  it('takes the account’s streak per game, leaving other games alone', () => {
    const p = plan(
      {
        streaks: [
          serverStreak(UM, 12, 15, TODAY),
          serverStreak(FB, 3, 3, YESTERDAY),
        ],
      },
      { streaks: [[IQ, streak(8, 8, TODAY)]] },
    )
    expect(p.streaks).toEqual([
      { ...UM, streak: streak(12, 15, TODAY) },
      { ...FB, streak: streak(3, 3, YESTERDAY) },
    ])
  })

  it('adopts a day finished on another device, oldest first', () => {
    const p = plan({
      days: [serverDay(UM, TODAY), serverDay(IQ, YESTERDAY)],
    })
    expect(p.adopt.map((a) => [a.mode, a.saved.dateKey])).toEqual([
      ['daily-iq', YESTERDAY],
      ['daily', TODAY],
    ])
    expect(p.adopt[1].saved.playerIds).toEqual(DETAIL.playerIds)
    expect(p.unsent).toEqual([])
  })

  it('never swaps out a day this device finished itself', () => {
    const p = plan(
      { days: [serverDay(UM, TODAY)] },
      { dailies: [[UM, saved(TODAY)]] },
    )
    expect(p.adopt).toEqual([])
    expect(p.unsent).toEqual([])
  })

  it('hands over today’s day when the account lacks it, or lacks its draft', () => {
    const mine = saved(TODAY)
    expect(plan({ days: [] }, { dailies: [[UM, mine]] }).unsent).toEqual([
      { ...UM, saved: mine },
    ])
    expect(
      plan(
        { days: [serverDay(UM, TODAY, { detail: null })] },
        { dailies: [[UM, mine]] },
      ).unsent,
    ).toEqual([{ ...UM, saved: mine }])
  })

  it('does not hand over an older day, or a save too old to rank', () => {
    expect(
      plan({ days: [] }, { dailies: [[UM, saved(YESTERDAY)]] }).unsent,
    ).toEqual([])
    expect(
      plan(
        { days: [] },
        { dailies: [[UM, saved(TODAY, { strength: undefined })]] },
      ).unsent,
    ).toEqual([])
  })

  it('ignores rows it cannot place (unknown mode, junk) instead of throwing', () => {
    const junk = [
      { ...UM, mode: 'made-up', current: 9, best: 9, lastDate: TODAY },
      { school: '../etc', sport: 'basketball', mode: 'daily' },
      null,
    ] as unknown as ServerStreak[]
    expect(
      plan({ streaks: junk, days: junk as unknown as ServerDay[] }),
    ).toEqual({ streaks: [], adopt: [], unsent: [] })
    expect(
      plan({
        streaks: 'nope' as unknown as ServerStreak[],
        days: undefined,
      }),
    ).toEqual({ streaks: [], adopt: [], unsent: [] })
  })
})

describe('streakClaims', () => {
  it('lists every game’s real local streak, legacy and mode-qualified keys alike', () => {
    writeStreak('michigan', 'basketball', streak(5, 9, TODAY)) // legacy key
    writeStreak('michigan', 'basketball', streak(2, 2, YESTERDAY), 'daily-iq')
    writeStreak('full-football', 'football', streak(7, 7, TODAY), 'daily')
    writeStreak('unc', 'basketball', EMPTY_STREAK) // never played: no claim
    localStorage.setItem('ysas:school', 'michigan')
    expect(streakClaims().sort((a, b) => a.current - b.current)).toEqual([
      { ...IQ, current: 2, max: 2, lastDate: YESTERDAY },
      { ...UM, current: 5, max: 9, lastDate: TODAY },
      { ...FB, current: 7, max: 7, lastDate: TODAY },
    ])
  })
})

describe('syncProgress', () => {
  type Call = { route: string; body: Record<string, unknown> }
  /** Stub fetch: `/me` answers `me`; a score submit answers a standing. */
  function server(
    me: object | { status: number },
    submitStreak?: { current: number; best: number; lastDate: string },
  ) {
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const route = url.replace(ENDPOINT, '').replace(/^\//, '')
        calls.push({ route, body: JSON.parse(String(init.body)) })
        if (route === 'me') {
          const status = 'status' in me ? me.status : 200
          return {
            ok: status === 200,
            status,
            json: async () =>
              status === 200
                ? { ok: true, username: 'spicy_al', name: 'Spicy Al', ...me }
                : { error: 'signed out' },
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            rank: 1,
            total: 1,
            streak: submitStreak,
          }),
          text: async () => '',
        }
      }),
    )
    return calls
  }
  const run = () => syncProgress({ token: TOKEN, username: 'spicy_al' })

  it('a new account keeps the device’s streak: it is sent as a claim', async () => {
    writeStreak('michigan', 'basketball', streak(12, 15, TODAY))
    const calls = server({
      streaks: [serverStreak(UM, 12, 15, TODAY)],
      days: [],
    })
    const r = await run()
    expect(calls[0]).toEqual({
      route: 'me',
      body: {
        token: TOKEN,
        streaks: [{ ...UM, current: 12, max: 15, lastDate: TODAY }],
      },
    })
    expect(r).toMatchObject({ status: 'ok', changed: [], reset: false })
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(12, 15, TODAY))
    expect(loadOwner()).toBe('spicy_al')
  })

  it('a second device takes the account’s streaks and its finished day, locked', async () => {
    server({
      streaks: [
        serverStreak(UM, 12, 15, TODAY),
        serverStreak(IQ, 3, 3, YESTERDAY),
      ],
      days: [serverDay(UM, TODAY)],
    })
    const r = await run()
    expect(r.changed.sort()).toEqual([
      'michigan:basketball:daily',
      'michigan:basketball:daily-iq',
    ])
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(12, 15, TODAY))
    expect(loadStreak('michigan', 'basketball', 'daily-iq')).toEqual(
      streak(3, 3, YESTERDAY),
    )
    expect(loadDaily('michigan', 'basketball', TODAY)).toMatchObject({
      wins: 34,
      strength: 70,
      playerIds: DETAIL.playerIds,
    })
    expect(r.name).toBe('Spicy Al')
  })

  it('adopting a day the server streak missed bumps the streak exactly once', async () => {
    writeStreak('michigan', 'basketball', streak(4, 4, YESTERDAY))
    server({ streaks: [], days: [serverDay(UM, TODAY)] })
    await run()
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(5, 5, TODAY))
    server({ streaks: [], days: [serverDay(UM, TODAY)] })
    const again = await run()
    expect(again.changed).toEqual([])
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(5, 5, TODAY))
  })

  it('hands today’s result to the account, once per page load', async () => {
    const mine = saved(TODAY)
    saveDailyResult('michigan', 'basketball', mine)
    // The device already has a cached standing from playing anonymously —
    // the hand-over must go out anyway.
    localStorage.setItem(
      `ysas:lb:v1:michigan:basketball:daily:${TODAY}`,
      JSON.stringify({ rank: 3, total: 9 }),
    )
    const calls = server(
      { streaks: [], days: [] },
      { current: 1, best: 1, lastDate: TODAY },
    )
    await run()
    const submit = calls.find((c) => c.route === '')
    expect(submit?.body).toMatchObject({
      ...UM,
      date: TODAY,
      score: 31,
      strength: 66,
      token: TOKEN,
      detail: { playerIds: mine.playerIds, grade: 'SOLID' },
    })
    await run()
    expect(calls.filter((c) => c.route === '')).toHaveLength(1)
  })

  it('progress left by ANOTHER account is wiped before anything is claimed', async () => {
    saveOwner('someone_else')
    writeStreak('michigan', 'basketball', streak(50, 50, TODAY))
    saveDailyResult('michigan', 'basketball', saved(TODAY), {
      advanceStreak: false,
    })
    const calls = server({ streaks: [], days: [] })
    const r = await run()
    expect(r.reset).toBe(true)
    expect(calls[0].body.streaks).toEqual([])
    expect(calls.filter((c) => c.route === '')).toEqual([])
    expect(loadStreak('michigan', 'basketball')).toEqual(EMPTY_STREAK)
    expect(loadDaily('michigan', 'basketball', TODAY)).toBeNull()
    expect(loadOwner()).toBe('spicy_al')
  })

  it('a dead session is reported, and nothing on the device changes', async () => {
    writeStreak('michigan', 'basketball', streak(5, 5, TODAY))
    server({ status: 401 })
    expect(await run()).toEqual({
      status: 'signed-out',
      changed: [],
      reset: false,
    })
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(5, 5, TODAY))
  })

  it('an outage is "offline": nothing changes, nothing is wiped', async () => {
    writeStreak('michigan', 'basketball', streak(5, 5, TODAY))
    server({ status: 503 })
    expect((await run()).status).toBe('offline')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect((await run()).status).toBe('offline')
    expect(loadStreak('michigan', 'basketball')).toEqual(streak(5, 5, TODAY))
  })
})
