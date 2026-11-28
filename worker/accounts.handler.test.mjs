// @vitest-environment node
// The account routes end to end: the real handler over a real SQLite with the
// real migrations (d1-test-helper.mjs) — register → play → sign in elsewhere.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import handler from './leaderboard.mjs'
import { freshDb } from './d1-test-helper.mjs'
import { dateKeyFor, addDays } from './leaderboard-lib.mjs'

const ORIGIN = 'https://wardcrazy01894.github.io'
const TODAY = dateKeyFor(new Date())
const YESTERDAY = addDays(TODAY, -1)
const PHONE = '3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e'
const LAPTOP = '9c2e7b4d-4e1a-4c2e-8b4d-4e1a9c2e3f1a'
const PASS = 'a'.repeat(64)
const GAME = { school: 'michigan', sport: 'basketball', mode: 'daily' }
const DETAIL = {
  playerIds: { PG: 'trey-burke', C: 'juwan-howard' },
  windows: { PG: { start: 2010, end: 2013 }, C: { start: 1992, end: 1995 } },
  grade: 'ELITE',
}

const limiter = (success = true) => ({
  limit: vi.fn(async () => ({ success })),
})

let env
beforeEach(() => {
  env = {
    ALLOWED_ORIGIN: ORIGIN,
    DB: freshDb(),
    RATE_LIMITER: limiter(),
    LOGIN_LIMITER: limiter(),
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

async function post(route, body, e = env) {
  const res = await handler.fetch(
    new Request(`https://worker.example/${route}`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    e,
    { waitUntil: () => {} },
  )
  return { status: res.status, body: await res.json() }
}
const submit = (over = {}) =>
  post('', {
    ...GAME,
    date: TODAY,
    score: 34,
    strength: 70,
    clientId: PHONE,
    ...over,
  })
const board = async () => {
  const q = new URLSearchParams({ ...GAME, date: TODAY })
  const res = await handler.fetch(
    new Request(`https://worker.example/?${q}`, {
      headers: { Origin: ORIGIN },
    }),
    env,
  )
  return res.json()
}
const register = (over = {}) =>
  post('register', { username: 'spicy_al', pass: PASS, ...over })

describe('register / login', () => {
  it('creates an account and signs the device in', async () => {
    const r = await register({ name: 'Spicy Al' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      ok: true,
      username: 'spicy_al',
      name: 'Spicy Al',
    })
    expect(r.body.token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('refuses a taken username, a bad username, a bad name, and a bad key', async () => {
    await register()
    expect((await register()).status).toBe(409)
    expect((await register({ username: 'a@b.com' })).status).toBe(400)
    expect((await register({ username: 'new_one', name: '<b>' })).status).toBe(
      400,
    )
    expect(
      (await register({ username: 'new_one', pass: 'short' })).status,
    ).toBe(400)
  })

  it('logs in with the right key; one error for everything else', async () => {
    await register()
    const ok = await post('login', { username: 'Spicy_Al', pass: PASS })
    expect(ok.status).toBe(200)
    expect(ok.body.token).toMatch(/^[0-9a-f]{48}$/)
    for (const body of [
      { username: 'spicy_al', pass: 'b'.repeat(64) },
      { username: 'nobody', pass: PASS },
      { username: '!!', pass: PASS },
      { username: 'spicy_al', pass: 'short' },
    ]) {
      const r = await post('login', body)
      expect(r.status).toBe(401)
      expect(r.body.error).toBe('wrong username or password')
    }
  })

  it('fails CLOSED without the login limiter, and honours it when it says no', async () => {
    const { LOGIN_LIMITER: _gone, ...open } = env
    expect(
      (await post('register', { username: 'x_y_z', pass: PASS }, open)).status,
    ).toBe(503)
    env.LOGIN_LIMITER = limiter(false)
    expect((await register()).status).toBe(429)
    expect(env.DB.rows(`SELECT 1 FROM accounts`)).toEqual([])
  })

  it('keys the login limiter on IP + username, registration on IP', async () => {
    await register()
    await post('login', { username: 'spicy_al', pass: PASS })
    const keys = env.LOGIN_LIMITER.limit.mock.calls.map(([a]) => a.key)
    expect(keys).toEqual(['unknown|register', 'unknown|spicy_al'])
  })
})

describe('an account inherits what the device already had', () => {
  it('a streak and a score earned anonymously stay — under the display name', async () => {
    // Played anonymously, with a 12-day streak in localStorage.
    const first = await submit({
      seed: { current: 12, max: 15, lastDate: TODAY },
      detail: DETAIL,
    })
    expect(first.body.streak).toMatchObject({ current: 12, best: 15 })

    const r = await register({ name: 'Spicy Al', clientId: PHONE })
    const me = await post('me', { token: r.body.token })
    expect(me.status).toBe(200)
    expect(me.body.streaks).toEqual([
      { ...GAME, current: 12, best: 15, lastDate: TODAY },
    ])
    expect(me.body.days).toEqual([
      { ...GAME, date: TODAY, score: 34, strength: 70, detail: DETAIL },
    ])
    // One row on the board, now named — no anonymous twin left behind —
    // and the streak the device earned shows on it.
    expect(await board()).toMatchObject({
      total: 1,
      rows: [{ strength: 70, score: 34, name: 'Spicy Al', streak: 12 }],
    })
  })

  it('/me folds in streaks only the device knows about (never submitted)', async () => {
    const r = await register()
    const me = await post('me', {
      token: r.body.token,
      streaks: [
        { ...GAME, current: 30, max: 41, lastDate: YESTERDAY },
        { ...GAME, mode: 'daily-iq', current: 2, max: 2, lastDate: TODAY },
        { ...GAME, school: 'nowhere', current: 9, max: 9, lastDate: TODAY },
      ],
    })
    expect(me.body.streaks).toEqual([
      { ...GAME, current: 30, best: 41, lastDate: YESTERDAY },
      { ...GAME, mode: 'daily-iq', current: 2, best: 2, lastDate: TODAY },
    ])
  })

  it('a second device signing in brings ITS progress too: the longer streak wins', async () => {
    const r = await register({ clientId: PHONE })
    await submit({
      clientId: LAPTOP,
      seed: { current: 5, max: 5, lastDate: TODAY },
    })
    // The phone vouches for a longer one.
    await post('me', {
      token: r.body.token,
      streaks: [{ ...GAME, current: 40, max: 40, lastDate: TODAY }],
    })
    const there = await post('login', {
      username: 'spicy_al',
      pass: PASS,
      clientId: LAPTOP,
    })
    const me = await post('me', { token: there.body.token })
    expect(me.body.streaks).toEqual([
      { ...GAME, current: 40, best: 40, lastDate: TODAY },
    ])
    expect((await board()).total).toBe(1)
  })
})

describe('playing while signed in', () => {
  it('the score is the ACCOUNT’s: two devices are one competitor', async () => {
    const r = await register({ name: 'Spicy Al' })
    const token = r.body.token
    const a = await submit({ token, detail: DETAIL })
    expect(a.body).toMatchObject({ rank: 1, total: 1 })
    const b = await submit({ token, clientId: LAPTOP, score: 38, strength: 80 })
    expect(b.body).toMatchObject({ rank: 1, total: 1 })
    expect(await board()).toMatchObject({
      total: 1,
      rows: [{ strength: 80, score: 38, name: 'Spicy Al', streak: 1 }],
    })
    expect(env.DB.rows(`SELECT client_id FROM scores`)).toEqual([
      { client_id: 'acct:1' },
    ])
  })

  it('a dead token still counts the day, for the anonymous device', async () => {
    const r = await submit({ token: 'f'.repeat(48) })
    expect(r.status).toBe(200)
    expect(env.DB.rows(`SELECT client_id FROM scores`)).toEqual([
      { client_id: PHONE },
    ])
  })
})

describe('signed-in routes', () => {
  it('401 "signed out" for a missing or unknown token', async () => {
    for (const route of ['me', 'name', 'password']) {
      const r = await post(route, { token: 'f'.repeat(48), name: 'Anyone' })
      expect(r.status).toBe(401)
      expect(r.body.error).toBe('signed out')
    }
  })

  it('renames, and the board follows', async () => {
    const { body } = await register()
    await submit({ token: body.token })
    const r = await post('name', { token: body.token, name: ' Big  Blue ' })
    expect(r.body).toMatchObject({ ok: true, name: 'Big Blue' })
    expect((await board()).rows[0].name).toBe('Big Blue')
    expect((await post('name', { token: body.token, name: 'x' })).status).toBe(
      400,
    )
  })

  it('logout ends the session', async () => {
    const { body } = await register()
    expect((await post('logout', { token: body.token })).status).toBe(200)
    expect((await post('me', { token: body.token })).status).toBe(401)
  })

  it('changes the password only with the current one; other devices are signed out', async () => {
    const here = (await register()).body.token
    const there = (await post('login', { username: 'spicy_al', pass: PASS }))
      .body.token
    const next = 'c'.repeat(64)
    const wrong = await post('password', {
      token: here,
      pass: 'b'.repeat(64),
      newPass: next,
    })
    expect(wrong.status).toBe(401)
    expect(
      (await post('password', { token: here, pass: PASS, newPass: 'short' }))
        .status,
    ).toBe(400)
    const ok = await post('password', {
      token: here,
      pass: PASS,
      newPass: next,
    })
    expect(ok.status).toBe(200)
    expect((await post('me', { token: here })).status).toBe(200)
    expect((await post('me', { token: there })).status).toBe(401)
    expect(
      (await post('login', { username: 'spicy_al', pass: PASS })).status,
    ).toBe(401)
    expect(
      (await post('login', { username: 'spicy_al', pass: next })).status,
    ).toBe(200)
  })
})

describe('hygiene', () => {
  it('never logs a password key or a session token', async () => {
    const { body } = await register()
    await post('login', { username: 'spicy_al', pass: 'b'.repeat(64) })
    await post('me', { token: 'f'.repeat(48) })
    const logged = JSON.stringify([
      ...console.warn.mock.calls,
      ...console.error.mock.calls,
    ])
    expect(logged).not.toContain(PASS)
    expect(logged).not.toContain('b'.repeat(64))
    expect(logged).not.toContain(body.token)
    expect(logged).not.toContain('f'.repeat(48))
  })

  it('a D1 failure on an account route is a 503, not a crash', async () => {
    env.DB = {
      prepare: () => {
        throw new Error('D1 down')
      },
    }
    const r = await register()
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('accounts unavailable')
  })

  it('an account route needs a JSON object', async () => {
    expect((await post('me', ['nope'])).status).toBe(400)
  })
})
