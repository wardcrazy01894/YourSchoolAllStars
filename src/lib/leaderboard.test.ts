import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getClientId,
  ordinal,
  percentile,
  formatStanding,
  buildSubmitPayload,
  readStanding,
  submitDaily,
  fetchLeaderboard,
  buildLeaderboardRows,
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
  strength: 79,
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
  it('formatStanding on a returning visit is a snapshot, not "today"', () => {
    expect(formatStanding({ rank: 3, total: 7 }, true)).toBe(
      'You placed 3rd of 7 when you finished',
    )
    expect(formatStanding({ rank: 1, total: 1 }, true)).toBe(
      'You were the first to finish when you played',
    )
    expect(formatStanding({ rank: 2, total: 40 }, true)).toBe(
      'You placed 2nd of 40 when you finished · top 5%',
    )
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
      strength: 79,
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
  it('MIRRORS the server streak into localStorage (the reconciled value)', async () => {
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
  it('does not mirror a server streak that is empty or older than the seed', async () => {
    saveDailyResult('michigan', 'basketball', {
      dateKey: '2026-10-08',
      playerIds: {},
      wins: 31,
      grade: 'GOOD',
    })
    // Empty / undated streak: never overwrite a real local one with nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          rank: 1,
          total: 1,
          streak: { current: 0, best: 9, lastDate: null },
        }),
      ),
    )
    let s = await submitDaily(ARGS)
    expect(s).toEqual({ rank: 1, total: 1 })
    expect(loadStreak('michigan', 'basketball').current).toBe(1)
    // Dated today but with no count: isolates the `current >= 1` guard.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          rank: 1,
          total: 1,
          streak: { current: 0, best: 9, lastDate: '2026-10-08' },
        }),
      ),
    )
    localStorage.removeItem('ysas:lb:v1:michigan:basketball:daily:2026-10-08')
    s = await submitDaily(ARGS)
    expect(s).toEqual({ rank: 1, total: 1 })
    expect(loadStreak('michigan', 'basketball').current).toBe(1)
    // Dated BEFORE the seed we just sent: a stale answer, keep the local copy.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          rank: 1,
          total: 1,
          streak: { current: 3, best: 3, lastDate: '2026-10-07' },
        }),
      ),
    )
    localStorage.removeItem('ysas:lb:v1:michigan:basketball:daily:2026-10-08')
    s = await submitDaily(ARGS)
    expect(s).toEqual({ rank: 1, total: 1 })
    expect(loadStreak('michigan', 'basketball').current).toBe(1)
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
  // Each failure path logs its OWN warn with enough to act on (status/reason,
  // game, day) — pinned per case so dropping one can't hide behind another.
  describe('resolves null and logs on every failure path', () => {
    let warn: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())
    const ctx = { game: 'michigan:basketball:daily', date: '2026-10-08' }

    it('a rejected submit logs status + server reason', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => okResponse({ error: 'invalid score' }, false, 400)),
      )
      expect(await submitDaily(ARGS)).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'leaderboard submit rejected',
        expect.objectContaining({ status: 400, ...ctx }),
      )
      expect(JSON.stringify(warn.mock.calls)).toMatch(/invalid score/)
    })
    it('an unexpected response shape', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => okResponse({ ok: true })),
      )
      expect(await submitDaily(ARGS)).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'leaderboard submit: unexpected response shape',
        expect.objectContaining(ctx),
      )
    })
    it('a network error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('offline')
        }),
      )
      expect(await submitDaily(ARGS)).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'leaderboard submit failed (network)',
        expect.objectContaining({ ...ctx, error: 'Error: offline' }),
      )
    })
    it('a board read rejected by the server logs status + game + day', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => okResponse({ error: 'invalid date' }, false, 400)),
      )
      expect(
        await fetchLeaderboard('michigan', 'basketball', 'daily', '2026-10-08'),
      ).toBeNull()
      expect(warn).toHaveBeenCalledWith(
        'leaderboard read rejected',
        expect.objectContaining({ status: 400, ...ctx }),
      )
    })
    it('a standing that cannot be cached locally', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => okResponse({ ok: true, rank: 1, total: 1 })),
      )
      const orig = localStorage.setItem.bind(localStorage)
      localStorage.setItem = () => {
        throw new Error('QuotaExceeded')
      }
      try {
        expect(await submitDaily(ARGS)).toEqual({ rank: 1, total: 1 })
      } finally {
        localStorage.setItem = orig
      }
      expect(warn).toHaveBeenCalledWith(
        'leaderboard standing not cached',
        expect.objectContaining({ key: expect.stringContaining('2026-10-08') }),
      )
    })
  })
  it('a Standing with no streak is still a valid cache entry', () => {
    const s: Standing = { rank: 1, total: 1 }
    expect(formatStanding(s)).toContain('first')
  })
})

describe('fetchLeaderboard', () => {
  it('returns null when the endpoint is unset', async () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    expect(
      await fetchLeaderboard('michigan', 'basketball', 'daily', '2026-10-08'),
    ).toBeNull()
  })
  it('GETs the board for the game + day and returns total + rows', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        ok: true,
        total: 3,
        rows: [
          { strength: 92, score: 38 },
          { strength: 80, score: 34 },
          { strength: 70, score: 30 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const board = await fetchLeaderboard(
      'michigan',
      'basketball',
      'daily-iq',
      '2026-10-08',
    )
    expect(board).toEqual({
      total: 3,
      rows: [
        { strength: 92, score: 38, name: '', streak: 0 },
        { strength: 80, score: 34, name: '', streak: 0 },
        { strength: 70, score: 30, name: '', streak: 0 },
      ],
    })
    const calls = fetchMock.mock.calls as unknown as [string][]
    const url = new URL(calls[0][0])
    expect(url.origin).toBe(ENDPOINT)
    expect(url.searchParams.get('school')).toBe('michigan')
    expect(url.searchParams.get('sport')).toBe('basketball')
    expect(url.searchParams.get('mode')).toBe('daily-iq')
    expect(url.searchParams.get('date')).toBe('2026-10-08')
  })
  it('reads each row’s streak, and a missing or malformed one as 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          total: 5,
          rows: [
            { strength: 92, score: 38, name: 'Spicy Al', streak: 12 },
            { strength: 80, score: 34 },
            { strength: 70, score: 30, streak: '7' },
            { strength: 60, score: 28, streak: -2 },
            { strength: 50, score: 25, streak: 2.5 },
          ],
        }),
      ),
    )
    const board = await fetchLeaderboard(
      'michigan',
      'basketball',
      'daily',
      '2026-10-08',
    )
    expect(board?.rows.map((r) => r.streak)).toEqual([12, 0, 0, 0, 0])
  })
  it('drops malformed rows and resolves null on a bad response / network error', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          total: 2,
          rows: [{ strength: 92, score: 38 }, { strength: 'x' }],
        }),
      ),
    )
    expect(
      await fetchLeaderboard('michigan', 'basketball', 'daily', '2026-10-08'),
    ).toEqual({
      total: 2,
      rows: [{ strength: 92, score: 38, name: '', streak: 0 }],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ error: 'x' }, false, 400)),
    )
    expect(
      await fetchLeaderboard('michigan', 'basketball', 'daily', '2026-10-08'),
    ).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(
      await fetchLeaderboard('michigan', 'basketball', 'daily', '2026-10-08'),
    ).toBeNull()
    spy.mockRestore()
  })
})

describe('buildLeaderboardRows streaks', () => {
  it('keeps each streak on its own row through the sort, 0 when absent', () => {
    expect(
      buildLeaderboardRows([
        { strength: 70, score: 30, streak: 3 },
        { strength: 92, score: 38, streak: 12 },
        { strength: 80, score: 34 },
      ]).map((r) => [r.strength, r.streak]),
    ).toEqual([
      [92, 12],
      [80, 0],
      [70, 3],
    ])
  })
})

describe('buildLeaderboardRows (pure)', () => {
  const rows = [
    { strength: 92, score: 38 },
    { strength: 80, score: 34 },
    { strength: 80, score: 30 },
    { strength: 80, score: 30 },
    { strength: 70, score: 31 },
  ]
  it('assigns competition ranks: ties on BOTH numbers share a rank, next rank skips', () => {
    expect(buildLeaderboardRows(rows).map((r) => r.rank)).toEqual([
      1, 2, 3, 3, 5,
    ])
  })
  it('sorts by strength then score even if the server order is off', () => {
    const shuffled = [rows[4], rows[2], rows[0], rows[1], rows[3]]
    expect(buildLeaderboardRows(shuffled).map((r) => r.strength)).toEqual([
      92, 80, 80, 80, 70,
    ])
    expect(buildLeaderboardRows(shuffled)[1].score).toBe(34)
  })
  it('flags exactly ONE row as yours — the first matching pair', () => {
    const out = buildLeaderboardRows(rows, { strength: 80, score: 30 })
    expect(out.filter((r) => r.you).length).toBe(1)
    expect(out.findIndex((r) => r.you)).toBe(2)
  })
  it('flags nothing when your pair is not on the (capped) list', () => {
    expect(
      buildLeaderboardRows(rows, { strength: 10, score: 5 }).some((r) => r.you),
    ).toBe(false)
  })
})

describe('accounts: token, draft and names', () => {
  const SAVED = {
    dateKey: ARGS.dateKey,
    playerIds: { PG: 'trey-burke' },
    windows: { PG: { start: 2010, end: 2013 } },
    wins: 31,
    grade: 'SOLID',
    strength: 79,
  }

  it('an anonymous submit carries no token; a signed-in one does, in the body', () => {
    expect(buildSubmitPayload(ARGS)).not.toHaveProperty('token')
    expect(buildSubmitPayload({ ...ARGS, token: 'f'.repeat(48) }).token).toBe(
      'f'.repeat(48),
    )
  })

  it('sends the draft (roster, eras, grade) — not the numbers twice', () => {
    expect(buildSubmitPayload(ARGS)).not.toHaveProperty('detail')
    expect(buildSubmitPayload({ ...ARGS, saved: SAVED }).detail).toEqual({
      playerIds: SAVED.playerIds,
      windows: SAVED.windows,
      grade: 'SOLID',
    })
  })

  it('force re-submits past this device’s cached standing', async () => {
    const f = vi.fn(async () => okResponse({ ok: true, rank: 2, total: 5 }))
    vi.stubGlobal('fetch', f)
    await submitDaily(ARGS)
    await submitDaily(ARGS)
    expect(f).toHaveBeenCalledTimes(1)
    await submitDaily({ ...ARGS, force: true })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('the board keeps each row’s display name; anything else is no name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          total: 3,
          rows: [
            { strength: 92, score: 38, name: 'Spicy Al', streak: 0 },
            { strength: 80, score: 34 }, // an older worker
            { strength: 70, score: 30, name: 7 },
          ],
        }),
      ),
    )
    const board = await fetchLeaderboard(
      'michigan',
      'basketball',
      'daily',
      ARGS.dateKey,
    )
    expect(board?.rows.map((r) => r.name)).toEqual(['Spicy Al', '', ''])
  })

  it('signed in: among tied rows, the one under YOUR name is yours', () => {
    const rows = buildLeaderboardRows(
      [
        { strength: 80, score: 34, name: '', streak: 0 },
        { strength: 80, score: 34, name: 'Rival', streak: 0 },
        { strength: 80, score: 34, name: 'Spicy Al', streak: 0 },
      ],
      { strength: 80, score: 34 },
      'Spicy Al',
    )
    expect(rows.map((r) => r.you)).toEqual([false, false, true])
    expect(rows.map((r) => r.name)).toEqual(['', 'Rival', 'Spicy Al'])
  })

  it('signed in but not on the list: an anonymous stranger with your numbers is not you', () => {
    const rows = buildLeaderboardRows(
      [{ strength: 80, score: 34, name: '', streak: 0 }],
      { strength: 80, score: 34 },
      'Spicy Al',
    )
    expect(rows[0].you).toBe(false)
  })

  it('anonymous: yours is the first ANONYMOUS tied row, never a named player’s', () => {
    const yours = { strength: 80, score: 34 }
    expect(
      buildLeaderboardRows(
        [
          { strength: 80, score: 34, name: 'Rival', streak: 0 },
          { strength: 80, score: 34, name: '', streak: 0 },
          { strength: 80, score: 34, name: '', streak: 0 },
        ],
        yours,
      ).map((r) => r.you),
    ).toEqual([false, true, false])
    expect(
      buildLeaderboardRows(
        [{ strength: 80, score: 34, name: 'Rival', streak: 0 }],
        yours,
      )[0].you,
    ).toBe(false)
  })
})
