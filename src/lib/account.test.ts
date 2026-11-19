import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  accountUrl,
  accountsEnabled,
  changePassword,
  derivePass,
  fetchMe,
  friendlyError,
  loadAccount,
  login,
  logout,
  passwordProblem,
  register,
  saveAccount,
  setDisplayName,
  usernameProblem,
} from './account'

/** In-memory localStorage stub (vitest Node env has no DOM). */
function makeStorageStub(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    clear: () => map.clear(),
  } as Storage
}

const TOKEN = 'f'.repeat(48)
const okJson = (body: object, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub())
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', 'https://lb.example/')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('sign-up form checks', () => {
  it('tells someone typing an email that a username is not one', () => {
    expect(usernameProblem('al@umich.edu')).toMatch(/not an email/i)
  })
  it('explains the allowed shape, and passes a good one', () => {
    expect(usernameProblem('al')).toMatch(/3 to 20/)
    expect(usernameProblem('spicy al')).toMatch(/letters, numbers/)
    expect(usernameProblem(' Spicy_Al ')).toBeNull()
  })
  it('wants 8+ characters of password', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/)
    expect(passwordProblem('long enough')).toBeNull()
  })
})

describe('the saved sign-in', () => {
  it('round-trips, and clears', () => {
    expect(loadAccount()).toBeNull()
    saveAccount({ token: TOKEN, username: 'spicy_al', name: 'Spicy Al' })
    expect(loadAccount()).toEqual({
      token: TOKEN,
      username: 'spicy_al',
      name: 'Spicy Al',
    })
    saveAccount(null)
    expect(loadAccount()).toBeNull()
  })
  it('treats a malformed value as signed out', () => {
    localStorage.setItem('ysas:account', '{"token":5}')
    expect(loadAccount()).toBeNull()
    localStorage.setItem('ysas:account', 'not json')
    expect(loadAccount()).toBeNull()
  })
})

describe('endpoint', () => {
  it('hangs the route off the leaderboard endpoint, slash or not', () => {
    expect(accountUrl('https://lb.example', 'login')).toBe(
      'https://lb.example/login',
    )
    expect(accountUrl('https://lb.example/api/', 'me')).toBe(
      'https://lb.example/api/me',
    )
  })
  it('is off when the leaderboard is', () => {
    expect(accountsEnabled()).toBe(true)
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    expect(accountsEnabled()).toBe(false)
  })
})

describe('derivePass', () => {
  it('is a 64-hex key that depends on both username and password, never the password itself', async () => {
    const a = await derivePass('Spicy_Al', 'correct horse')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await derivePass(' spicy_al ', 'correct horse')).toBe(a)
    expect(await derivePass('spicy_al', 'correct horsf')).not.toBe(a)
    expect(await derivePass('other', 'correct horse')).not.toBe(a)
  }, 20_000)
})

describe('API calls', () => {
  it('register sends the derived key, the display name and this device’s id — never the password', async () => {
    const f = vi.fn(async () =>
      okJson({ ok: true, token: TOKEN, username: 'spicy_al', name: 'Al' }),
    )
    vi.stubGlobal('fetch', f)
    const r = await register('Spicy_Al', 'correct horse', 'Al')
    expect(r).toMatchObject({ ok: true, token: TOKEN, username: 'spicy_al' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://lb.example/register')
    const body = JSON.parse(String(init.body))
    expect(body.username).toBe('Spicy_Al')
    expect(body.name).toBe('Al')
    expect(body.pass).toMatch(/^[0-9a-f]{64}$/)
    expect(body.clientId).toBe(localStorage.getItem('ysas:clientId'))
    expect(String(init.body)).not.toContain('correct horse')
  }, 20_000)

  it('login posts to /login with the device id', async () => {
    const f = vi.fn(async () =>
      okJson({ ok: true, token: TOKEN, username: 'spicy_al', name: 'Al' }),
    )
    vi.stubGlobal('fetch', f)
    expect((await login('spicy_al', 'correct horse')).ok).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://lb.example/login')
    expect(JSON.parse(String(init.body)).clientId).toBeTruthy()
  }, 20_000)

  it('fetchMe carries the token and the streak claims in the body, never the URL', async () => {
    const f = vi.fn(async () =>
      okJson({
        ok: true,
        username: 'spicy_al',
        name: 'Al',
        streaks: [],
        days: [],
      }),
    )
    vi.stubGlobal('fetch', f)
    const claim = {
      school: 'michigan',
      sport: 'basketball',
      mode: 'daily',
      current: 5,
      max: 9,
      lastDate: '2026-11-12',
    }
    await fetchMe(TOKEN, [claim])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://lb.example/me')
    expect(url).not.toContain(TOKEN)
    expect(JSON.parse(String(init.body))).toMatchObject({
      token: TOKEN,
      streaks: [claim],
    })
  })

  it('changePassword sends both derived keys, never either password', async () => {
    const f = vi.fn(async () =>
      okJson({ ok: true, username: 'spicy_al', name: 'Al' }),
    )
    vi.stubGlobal('fetch', f)
    const r = await changePassword(
      { token: TOKEN, username: 'spicy_al', name: 'Al' },
      'old horse 1',
      'new horse 2',
    )
    expect(r.ok).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://lb.example/password')
    const body = JSON.parse(String(init.body))
    expect(body.token).toBe(TOKEN)
    expect(body.pass).toBe(await derivePass('spicy_al', 'old horse 1'))
    expect(body.newPass).toBe(await derivePass('spicy_al', 'new horse 2'))
    expect(String(init.body)).not.toMatch(/horse/)
  }, 30_000)

  it('surfaces the server’s error and status; never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({ error: 'that username is taken' }, 409)),
    )
    expect(await setDisplayName(TOKEN, 'Al')).toEqual({
      ok: false,
      error: 'that username is taken',
      status: 409,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await logout(TOKEN)).toEqual({ ok: false, error: 'network error' })
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    expect(await fetchMe(TOKEN)).toEqual({ ok: false, error: 'offline' })
  })
})

describe('friendlyError', () => {
  it('passes the server’s own words through, capitalised', () => {
    expect(
      friendlyError({ error: 'that username is taken', status: 409 }),
    ).toBe('That username is taken.')
  })
  it('explains a worker that does not have accounts yet, and an outage', () => {
    // An older worker treats any POST as a score submission.
    expect(friendlyError({ error: 'unknown school', status: 400 })).toMatch(
      /aren’t switched on/,
    )
    expect(friendlyError({ error: 'network error' })).toMatch(/connection/)
    expect(
      friendlyError({ error: 'accounts unavailable', status: 503 }),
    ).toMatch(/try again/i)
  })
})
