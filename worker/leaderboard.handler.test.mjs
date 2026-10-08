// @vitest-environment node
// The worker is Node/Workers-runtime code: run it outside the app's jsdom
// environment (file: URLs for the migrations, real Request/Response).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from './leaderboard.mjs'
import { dateKeyFor, addDays } from './leaderboard-lib.mjs'

/**
 * Handler-level tests for the leaderboard Worker's `fetch`. Pure helpers live in
 * leaderboard.test.mjs; here we drive the whole request path with a mocked `env`
 * (a fake D1 + KV rate limiter) and a mocked global `fetch` (Turnstile), so the
 * abuse-control branches (fail-closed, origin allowlist, rate limit, size cap,
 * Turnstile, validation, D1 outage) can't regress silently.
 */

const ORIGIN = 'https://wardcrazy01894.github.io'
// A real ET "today" so the date-window check passes whenever this runs.
const TODAY = dateKeyFor(new Date())
const CLIENT = '3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e'
const GAME = 'school=michigan&sport=basketball&mode=daily'

// Fake D1: batch() returns [upsertResult, standingResult]; the standing row is
// configurable so we can assert rank = better + 1.
const fakeDB = (rankRow = { better: 2, total: 10 }) => {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    run: async () => ({ meta: { changes: 1 } }),
  }
  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(async () => [{ results: [] }, { results: [rankRow] }]),
  }
}

// Fake D1 for the GET view path: batch() returns [scoresResult, countResult].
const fakeViewDB = (scores = [38, 34, 30], total = scores.length) => {
  const stmt = { bind: () => stmt, first: async () => null }
  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(async () => [
      { results: scores.map((s) => ({ score: s })) },
      { results: [{ total }] },
    ]),
  }
}

// Fake D1 that also serves the streak read/write (first/run), so the POST path
// returns a streak. `prevStreak` is the stored row (or null for first play).
const fakeDBWithStreak = (
  rankRow = { better: 2, total: 7 },
  prevStreak = null,
) => {
  const stmt = {
    bind: () => stmt,
    first: async () => prevStreak,
    run: async () => ({ meta: { changes: 1 } }),
  }
  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(async () => [{ results: [] }, { results: [rankRow] }]),
  }
}

// KV stub for the per-IP rate limiter fallback (env.RL).
const kv = (count = 0) => ({
  get: vi.fn(async () => (count ? String(count) : null)),
  put: vi.fn(async () => {}),
})

const makeEnv = (over = {}) => ({
  ALLOWED_ORIGIN: ORIGIN,
  DB: fakeDB(),
  RL: kv(0), // an anti-abuse control present -> not fail-closed
  ...over,
})

const post = (body, { origin = ORIGIN, headers = {} } = {}) =>
  new Request('https://worker.example/', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.7',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const get = (qs, { origin = ORIGIN } = {}) =>
  new Request(`https://worker.example/?${qs}`, {
    method: 'GET',
    headers: { Origin: origin, 'CF-Connecting-IP': '203.0.113.7' },
  })

const goodBody = (over = {}) => ({
  school: 'michigan',
  sport: 'basketball',
  mode: 'daily',
  date: TODAY,
  score: 31,
  clientId: CLIENT,
  ...over,
})

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url).includes('siteverify'))
        return { json: async () => ({ success: globalThis.__turnstileOk }) }
      throw new Error('unexpected fetch ' + url)
    }),
  )
  globalThis.__turnstileOk = true
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.__turnstileOk
})

describe('leaderboard worker handler', () => {
  it('answers CORS preflight (OPTIONS) advertising GET + POST', async () => {
    const res = await handler.fetch(
      new Request('https://worker.example/', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
      makeEnv(),
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('rejects an unsupported method (PUT) with 405', async () => {
    const res = await handler.fetch(
      new Request('https://worker.example/', {
        method: 'PUT',
        headers: { Origin: ORIGIN },
      }),
      makeEnv(),
    )
    expect(res.status).toBe(405)
  })

  it('GET returns the day’s top scores + total for a known game', async () => {
    const env = makeEnv({ DB: fakeViewDB([38, 34, 30], 12) })
    const res = await handler.fetch(get(`${GAME}&date=${TODAY}`), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      total: 12,
      scores: [38, 34, 30],
    })
  })

  it('GET rejects an unknown school / free-play mode / malformed date with 400', async () => {
    const env = makeEnv({ DB: fakeViewDB() })
    let res = await handler.fetch(
      get(`school=osu&sport=basketball&mode=daily&date=${TODAY}`),
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unknown school/)
    res = await handler.fetch(
      get(`school=michigan&sport=basketball&mode=classic&date=${TODAY}`),
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unknown mode/)
    res = await handler.fetch(get(`${GAME}&date=nope`), env)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid date/)
  })

  it('GET is rate-limited too (shared per-IP budget)', async () => {
    const res = await handler.fetch(
      get(`${GAME}&date=${TODAY}`),
      makeEnv({ RL: kv(30), DB: fakeViewDB() }),
    )
    expect(res.status).toBe(429)
  })

  it('fails CLOSED (503) when no rate-limit or Turnstile is configured', async () => {
    const res = await handler.fetch(
      post(goodBody()),
      makeEnv({ RL: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('uses the native RATE_LIMITER binding when present', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) }
    const res = await handler.fetch(
      post(goodBody()),
      makeEnv({ RL: undefined, RATE_LIMITER: limiter }),
    )
    expect(res.status).toBe(429)
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('rejects a disallowed Origin with 403', async () => {
    const res = await handler.fetch(
      post(goodBody(), { origin: 'https://evil.example' }),
      makeEnv(),
    )
    expect(res.status).toBe(403)
  })

  it('returns 503 when the D1 binding is missing', async () => {
    const res = await handler.fetch(
      post(goodBody()),
      makeEnv({ DB: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('rejects an oversized body (413) via Content-Length', async () => {
    const res = await handler.fetch(
      post(goodBody(), { headers: { 'Content-Length': '999999' } }),
      makeEnv(),
    )
    expect(res.status).toBe(413)
  })

  it('rate-limits per IP (429) once the KV counter is at the cap', async () => {
    const res = await handler.fetch(post(goodBody()), makeEnv({ RL: kv(30) }))
    expect(res.status).toBe(429)
  })

  it('rejects invalid JSON with 400', async () => {
    const res = await handler.fetch(post('{ not json'), makeEnv())
    expect(res.status).toBe(400)
  })

  it('rejects a failed Turnstile check with 403 (when configured)', async () => {
    globalThis.__turnstileOk = false
    const res = await handler.fetch(
      post(goodBody({ turnstileToken: 'tok' })),
      makeEnv({ TURNSTILE_SECRET: 'secret' }),
    )
    expect(res.status).toBe(403)
  })

  it('rejects an unknown school, an out-of-window date, and a bad score with 400', async () => {
    let res = await handler.fetch(post(goodBody({ school: 'osu' })), makeEnv())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/unknown school/)
    res = await handler.fetch(post(goodBody({ date: '2020-01-01' })), makeEnv())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/date out of range/)
    res = await handler.fetch(post(goodBody({ score: 41 })), makeEnv())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid score/)
  })

  it('returns 200 with rank = better + 1 and total on the happy path', async () => {
    const env = makeEnv({ DB: fakeDB({ better: 2, total: 47 }) })
    const res = await handler.fetch(post(goodBody()), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      rank: 3,
      total: 47,
      streak: { current: 1, best: 1, lastDate: TODAY },
    })
    expect(env.DB.batch).toHaveBeenCalledOnce()
  })

  it('returns a starting streak of 1 for a first-ever play', async () => {
    const env = makeEnv({ DB: fakeDBWithStreak({ better: 0, total: 1 }, null) })
    const res = await handler.fetch(post(goodBody()), env)
    expect(await res.json()).toEqual({
      ok: true,
      rank: 1,
      total: 1,
      streak: { current: 1, best: 1, lastDate: TODAY },
    })
  })

  it('bootstraps the streak from the client seed on a first-ever play', async () => {
    const env = makeEnv({ DB: fakeDBWithStreak({ better: 0, total: 1 }, null) })
    const seed = { current: 54, max: 54, lastDate: TODAY }
    const res = await handler.fetch(post(goodBody({ seed })), env)
    expect((await res.json()).streak).toEqual({
      current: 54,
      best: 54,
      lastDate: TODAY,
    })
  })

  it('increments the streak when yesterday was played', async () => {
    const prev = { current: 3, best: 4, last_played_date: addDays(TODAY, -1) }
    const env = makeEnv({ DB: fakeDBWithStreak({ better: 1, total: 9 }, prev) })
    const res = await handler.fetch(post(goodBody()), env)
    expect((await res.json()).streak).toEqual({
      current: 4,
      best: 4,
      lastDate: TODAY,
    })
  })

  it('still returns the standing if the streak write fails (best-effort)', async () => {
    const db = fakeDBWithStreak({ better: 2, total: 7 }, null)
    db.prepare = vi.fn(() => ({
      bind: () => ({
        first: async () => {
          throw new Error('streak D1 error')
        },
        run: async () => ({}),
      }),
    }))
    db.batch = vi.fn(async () => [
      { results: [] },
      { results: [{ better: 2, total: 7 }] },
    ])
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await handler.fetch(post(goodBody()), makeEnv({ DB: db }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, rank: 3, total: 7 })
    expect(body.streak).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).toMatch(/streak/i)
    spy.mockRestore()
  })

  it('degrades to 503 (not 500) when D1 throws, and logs the failure', async () => {
    const broken = fakeDB()
    broken.batch = vi.fn(async () => {
      throw new Error('D1_ERROR')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler.fetch(post(goodBody()), makeEnv({ DB: broken }))
    expect(res.status).toBe(503)
    expect(spy).toHaveBeenCalled()
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).toMatch(/submit/i)
    expect(logged).toMatch(/D1_ERROR/)
    expect(logged).toMatch(/michigan:basketball:daily/)
    spy.mockRestore()
  })

  it('logs the failure when the GET board read throws', async () => {
    const broken = fakeViewDB()
    broken.batch = vi.fn(async () => {
      throw new Error('READ_D1_ERROR')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler.fetch(
      get(`${GAME}&date=${TODAY}`),
      makeEnv({ DB: broken }),
    )
    expect(res.status).toBe(503)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/READ_D1_ERROR/)
    spy.mockRestore()
  })
})

describe('leaderboard worker scheduled (retention prune)', () => {
  const pruneDB = () => {
    const calls = { sql: '', bound: null }
    const stmt = {
      bind: (...args) => {
        calls.bound = args
        return stmt
      },
      run: vi.fn(async () => ({ meta: { changes: 4 } })),
    }
    return {
      calls,
      prepare: vi.fn((sql) => {
        calls.sql = sql
        return stmt
      }),
    }
  }
  const ctx = () => ({ waitUntil: (p) => p })

  it('prunes scores (not streaks) older than the retention cutoff', async () => {
    const db = pruneDB()
    await handler.scheduled({}, { DB: db }, ctx())
    expect(db.calls.sql).toMatch(/DELETE FROM scores WHERE date <\s*\?1/)
    expect(db.calls.sql).not.toMatch(/streaks/)
    expect(db.calls.bound[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is a no-op when D1 is not bound', async () => {
    await handler.scheduled({}, {}, ctx())
  })

  it('logs when the prune fails (so an unbounded table is visible)', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({
          run: async () => {
            throw new Error('PRUNE_D1_ERROR')
          },
        }),
      })),
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = []
    await handler.scheduled(
      {},
      { DB: db },
      { waitUntil: (p) => pending.push(p) },
    )
    await Promise.allSettled(pending)
    expect(JSON.stringify(spy.mock.calls)).toMatch(/prune/i)
    spy.mockRestore()
  })
})
