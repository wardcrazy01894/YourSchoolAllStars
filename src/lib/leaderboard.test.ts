import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getClientId,
  ordinal,
  percentile,
  formatStanding,
  buildSubmitPayload,
  readStanding,
  submitDaily,
  PERCENTILE_MIN_TOTAL,
  type Standing,
} from './leaderboard'
import { loadStreak, saveDailyResult } from './progress'

const ENDPOINT = 'https://ysas-leaderboard.example.workers.dev'
const ARGS = {
  school: 'michigan',
  sport: 'basketball',
  mode: 'daily' as const,
  dateKey: '2026-10-08',
  score: 31,
  seed: { current: 54, max: 54, lastDate: '2026-10-08' },
  official: true,
}

function okResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', ENDPOINT)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getClientId', () => {
  it('mints a UUID-shaped id once and reuses it', () => {
    const a = getClientId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(getClientId()).toBe(a)
    expect(localStorage.getItem('ysas:clientId')).toBe(a)
  })
})

describe('ordinal / percentile / formatStanding', () => {
  it('ordinal handles the teens', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(23)).toBe('23rd')
  })
  it('percentile clamps to [1, 100]', () => {
    expect(percentile(1, 100)).toBe(1)
    expect(percentile(100, 100)).toBe(100)
    expect(percentile(1, 0)).toBe(100)
  })
  it('formatStanding: first finisher, small field, big field', () => {
    expect(formatStanding({ rank: 1, total: 1 })).toBe(
      'You’re the first to finish today!',
    )
    expect(formatStanding({ rank: 3, total: 7 })).toBe(
      'You placed 3rd of 7 today',
    )
    expect(formatStanding({ rank: 2, total: PERCENTILE_MIN_TOTAL })).toBe(
      `You placed 2nd of ${PERCENTILE_MIN_TOTAL} today · top 10%`,
    )
  })
})

describe('buildSubmitPayload', () => {
  it('matches the worker contract and carries the seed', () => {
    const p = buildSubmitPayload(ARGS)
    expect(p).toEqual({
      school: 'michigan',
      sport: 'basketball',
      mode: 'daily',
      date: '2026-10-08',
      score: 31,
      clientId: getClientId(),
      seed: ARGS.seed,
    })
  })
})

describe('submitDaily', () => {
  it('returns null and never fetches when the play is not official', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await submitDaily({ ...ARGS, official: false })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('returns null and never fetches when the endpoint is unset', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await submitDaily(ARGS)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('POSTs the payload and returns the standing with the streak in client shape', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        ok: true,
        rank: 3,
        total: 47,
        streak: { current: 54, best: 60, lastDate: '2026-10-08' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const s = await submitDaily(ARGS)
    expect(s).toEqual({
      rank: 3,
      total: 47,
      streak: { current: 54, max: 60, lastDate: '2026-10-08' },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      school: 'michigan',
      seed: ARGS.seed,
    })
  })
  it('MIRRORS the server streak into localStorage (server copy wins)', async () => {
    saveDailyResult('michigan', 'basketball', {
      dateKey: '2026-10-08',
      playerIds: {},
      wins: 31,
      grade: 'GOOD',
    })
    expect(loadStreak('michigan', 'basketball').current).toBe(1)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          rank: 1,
          total: 1,
          streak: { current: 54, best: 54, lastDate: '2026-10-08' },
        }),
      ),
    )
    await submitDaily(ARGS)
    expect(loadStreak('michigan', 'basketball')).toEqual({
      current: 54,
      max: 54,
      lastDate: '2026-10-08',
    })
  })
  it('mirrors into the daily-iq namespace for a daily-iq submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          rank: 1,
          total: 1,
          streak: { current: 7, best: 7, lastDate: '2026-10-08' },
        }),
      ),
    )
    await submitDaily({ ...ARGS, mode: 'daily-iq' })
    expect(loadStreak('michigan', 'basketball', 'daily-iq').current).toBe(7)
    expect(loadStreak('michigan', 'basketball', 'daily').current).toBe(0)
  })
  it('leaves the local streak alone when the server omits one', async () => {
    saveDailyResult('michigan', 'basketball', {
      dateKey: '2026-10-08',
      playerIds: {},
      wins: 31,
      grade: 'GOOD',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ ok: true, rank: 1, total: 1 })),
    )
    const s = await submitDaily(ARGS)
    expect(s).toEqual({ rank: 1, total: 1 })
    expect(loadStreak('michigan', 'basketball').current).toBe(1)
  })
  it('caches the standing per game + day and does not re-POST on reload', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ ok: true, rank: 2, total: 9 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await submitDaily(ARGS)
    const again = await submitDaily(ARGS)
    expect(again).toEqual({ rank: 2, total: 9 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      readStanding('michigan', 'basketball', 'daily', '2026-10-08'),
    ).toEqual({ rank: 2, total: 9 })
    expect(
      readStanding('michigan', 'basketball', 'daily-iq', '2026-10-08'),
    ).toBeNull()
  })
  it('resolves null on a rejected submit, a bad shape, or a network error', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ error: 'invalid score' }, false, 400)),
    )
    expect(await submitDaily(ARGS)).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ ok: true })),
    )
    expect(await submitDaily(ARGS)).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await submitDaily(ARGS)).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('a Standing with no streak is still a valid cache entry', () => {
    const s: Standing = { rank: 1, total: 1 }
    expect(formatStanding(s)).toContain('first')
  })
})
