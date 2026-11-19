// The account around the game: the way in, the overlay, and the cross-device
// sync landing on the screens (streak chips, a day finished elsewhere). The
// worker is a stubbed fetch; storage and the app are real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import App from './App'
import { getDateKey } from './lib/daily'
import { loadAccount, saveAccount } from './lib/account'
import {
  EMPTY_STREAK,
  loadDaily,
  loadStreak,
  saveDailyResult,
  writeStreak,
} from './lib/progress'

const ENDPOINT = 'https://ysas-leaderboard.example.workers.dev'
const TOKEN = 'f'.repeat(48)
const AL = { token: TOKEN, username: 'spicy_al', name: 'Spicy Al' }
const TODAY = getDateKey()
const UM = { school: 'michigan', sport: 'basketball', mode: 'daily' }
const DETAIL = {
  playerIds: {
    PG: 'jalen-rose',
    SG: 'jimmy-king',
    SF: 'ray-jackson',
    PF: 'juwan-howard',
    C: 'makhtar-ndiaye',
  },
  windows: Object.fromEntries(
    ['PG', 'SG', 'SF', 'PF', 'C'].map((p) => [p, { start: 1992, end: 1995 }]),
  ),
  grade: 'ELITE',
}

type Me = { streaks?: object[]; days?: object[] } | { status: number }
let calls: { route: string; body: Record<string, unknown> }[]
/** Stub the worker: `/me` answers `me`; every other POST succeeds. */
function server(me: Me = { streaks: [], days: [] }) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const route = String(url).replace(ENDPOINT, '').replace(/^\//, '')
      calls.push({ route, body: JSON.parse(String(init?.body ?? '{}')) })
      const status = route === 'me' && 'status' in me ? me.status : 200
      const body =
        status !== 200
          ? { error: 'signed out' }
          : route === 'me'
            ? { ok: true, username: 'spicy_al', name: 'Spicy Al', ...me }
            : { ok: true }
      return {
        ok: status === 200,
        status,
        json: async () => body,
        text: async () => '',
      }
    }),
  )
}
const at = (query: string) => window.history.replaceState(null, '', `/${query}`)

beforeEach(() => {
  cleanup()
  localStorage.clear()
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', ENDPOINT)
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  at('')
  server()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the way in', () => {
  it('is not offered when there is no leaderboard worker', () => {
    vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', '')
    render(<App />)
    expect(screen.queryByText(/Sign in/)).toBeNull()
  })

  it('signed out: "Sign in" in the top bar and the footer opens the dialog; Back returns', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '👤 Sign in' })).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: '👤 Sign in / create account' }),
    )
    expect(screen.getByRole('dialog', { name: 'Your account' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText("Build your school's all-time team.")).toBeTruthy()
  })

  it('the game stays mounted under the dialog (a draft survives a visit)', () => {
    at('?school=michigan&sport=basketball&mode=classic')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Play Classic/ }))
    const draft = document.querySelector('.app')
    fireEvent.click(
      screen.getByRole('button', { name: '👤 Sign in / create account' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    // The very same DOM node: hidden and shown, never remounted.
    expect(document.querySelector('.app')).toBe(draft)
    expect(screen.queryByRole('button', { name: /Play Classic/ })).toBeNull()
  })

  it('signed in: the display name is the button', () => {
    saveAccount(AL)
    render(<App />)
    expect(screen.getAllByRole('button', { name: '👤 Spicy Al' })).toHaveLength(
      2,
    )
  })
})

describe('sync on load', () => {
  it('a streak from another device shows up on the mode menu', async () => {
    saveAccount(AL)
    server({
      streaks: [{ ...UM, current: 12, best: 15, lastDate: TODAY }],
      days: [],
    })
    at('?school=michigan&sport=basketball')
    render(<App />)
    expect(screen.queryByText(/12 days/)).toBeNull()
    expect((await screen.findAllByText(/🔥 12 days/)).length).toBeGreaterThan(0)
    expect(loadStreak('michigan', 'basketball')).toEqual({
      current: 12,
      max: 15,
      lastDate: TODAY,
    })
  })

  it('a daily finished on another device opens locked here, with its record', async () => {
    saveAccount(AL)
    server({
      streaks: [{ ...UM, current: 3, best: 3, lastDate: TODAY }],
      days: [{ ...UM, date: TODAY, score: 34, strength: 70, detail: DETAIL }],
    })
    at('?school=michigan&sport=basketball&mode=daily')
    render(<App />)
    expect(screen.getByRole('button', { name: /Play Today/ })).toBeTruthy()
    expect(await screen.findByText(/in the books/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Play Today/ })).toBeNull()
    expect(screen.getAllByText('Jalen Rose').length).toBeGreaterThan(0)
    expect(loadDaily('michigan', 'basketball', TODAY)?.wins).toBe(34)
  })

  it('a streak this device earned before the account is sent, and kept', async () => {
    saveAccount(AL)
    writeStreak('michigan', 'basketball', {
      current: 9,
      max: 9,
      lastDate: TODAY,
    })
    render(<App />)
    await waitFor(() => expect(calls.some((c) => c.route === 'me')).toBe(true))
    expect(calls.find((c) => c.route === 'me')?.body.streaks).toEqual([
      { ...UM, current: 9, max: 9, lastDate: TODAY },
    ])
    expect(loadStreak('michigan', 'basketball').current).toBe(9)
  })

  it('a session the server ended signs the device out, keeping its progress', async () => {
    saveAccount(AL)
    writeStreak('michigan', 'basketball', {
      current: 9,
      max: 9,
      lastDate: TODAY,
    })
    server({ status: 401 })
    render(<App />)
    expect(
      await screen.findByRole('button', { name: '👤 Sign in' }),
    ).toBeTruthy()
    expect(loadAccount()).toBeNull()
    expect(loadStreak('michigan', 'basketball').current).toBe(9)
  })
})

describe('sign out', () => {
  it('saves to the account first, then returns the device to a fresh anonymous player', async () => {
    saveAccount(AL)
    saveDailyResult('michigan', 'basketball', {
      dateKey: TODAY,
      ...DETAIL,
      wins: 34,
      strength: 70,
    })
    at('?school=michigan&sport=basketball&mode=daily')
    render(<App />)
    expect(screen.getByText(/in the books/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '👤 Spicy Al' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('status')).textContent).toBe('Signed out.')

    // The day went to the account before anything was wiped…
    const routes = calls.map((c) => c.route)
    expect(routes.lastIndexOf('')).toBeLessThan(routes.indexOf('logout'))
    expect(calls.find((c) => c.route === '')?.body).toMatchObject({
      ...UM,
      date: TODAY,
      token: TOKEN,
    })
    // …and the device is anonymous again, with nothing of the account's.
    expect(loadAccount()).toBeNull()
    expect(loadStreak('michigan', 'basketball')).toEqual(EMPTY_STREAK)
    expect(loadDaily('michigan', 'basketball', TODAY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('button', { name: /Play Today/ })).toBeTruthy()
  })

  it('offline: nothing is wiped until the player insists', async () => {
    saveAccount(AL)
    writeStreak('michigan', 'basketball', {
      current: 9,
      max: 9,
      lastDate: TODAY,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: '👤 Spicy Al' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /hasn’t been saved/,
    )
    expect(loadAccount()).toEqual(AL)
    expect(loadStreak('michigan', 'basketball').current).toBe(9)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }))
    await waitFor(() => expect(loadAccount()).toBeNull())
    expect(loadStreak('michigan', 'basketball')).toEqual(EMPTY_STREAK)
  })
})
