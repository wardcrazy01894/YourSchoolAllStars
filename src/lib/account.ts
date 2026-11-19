/**
 * Optional accounts — client side (ported from CampusPin Showdown's
 * account.ts).
 *
 * An account is a username, a password and a display name; no email. It
 * lives in the leaderboard Worker (worker/accounts-lib.mjs), so it is only
 * offered when `VITE_LEADERBOARD_ENDPOINT` is set. Signing in gives this
 * device a session token (`ysas:account` in localStorage); from then on its
 * daily scores are the ACCOUNT's, shown under its display name, and
 * src/lib/sync.ts keeps every game's streak and today's results in step
 * across every device signed in to it.
 *
 * Every call resolves to `{ ok: true, … }` or `{ ok: false, error }` — never
 * throws — so the game is fully playable when the worker is unset, down or
 * blocked.
 */

import { getClientId } from './leaderboard'

const ACCOUNT_KEY = 'ysas:account'

/** This device's sign-in. */
export interface Account {
  /** Session token (bearer). Only ever sent in a POST body. */
  token: string
  username: string
  /** Display name, shown on the leaderboard. */
  name: string
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const a = JSON.parse(raw) as Partial<Account> | null
    return typeof a?.token === 'string' &&
      typeof a.username === 'string' &&
      typeof a.name === 'string'
      ? { token: a.token, username: a.username, name: a.name }
      : null
  } catch {
    return null
  }
}

/** Remember the sign-in, or forget it (`null`). Best-effort. */
export function saveAccount(account: Account | null): void {
  try {
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch (e) {
    console.warn('account: could not save sign-in', { error: String(e) })
  }
}

/** Accounts ride on the leaderboard worker: no endpoint, no accounts. */
export function accountsEnabled(): boolean {
  return Boolean(import.meta.env.VITE_LEADERBOARD_ENDPOINT)
}

/** `<endpoint>/<route>`, whether or not the endpoint ends in a slash. */
export function accountUrl(endpoint: string, route: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${route}`
}

// ---- Form checks (the server validates again) -----------------------------------

/** What is wrong with a username, or null. Mirrors the worker's rule. */
export function usernameProblem(raw: string): string | null {
  const u = raw.trim().toLowerCase()
  if (u.includes('@'))
    return 'A username is not an email address. Make up any name: 3 to 20 letters, numbers or _.'
  if (u.length < 3 || u.length > 20) return 'A username is 3 to 20 characters.'
  if (!/^[a-z0-9_]+$/.test(u))
    return 'A username can use letters, numbers and _ only.'
  return null
}

export function passwordProblem(password: string): string | null {
  return password.length < 8 ? 'A password needs at least 8 characters.' : null
}

// ---- API ------------------------------------------------------------------------

export type ApiResult<T> =
  ({ ok: true } & T) | { ok: false; error: string; status?: number }

async function post<T>(route: string, body: unknown): Promise<ApiResult<T>> {
  const endpoint = import.meta.env.VITE_LEADERBOARD_ENDPOINT
  if (!endpoint) return { ok: false, error: 'offline' }
  try {
    const res = await fetch(accountUrl(endpoint, route), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || data.ok !== true) {
      const error = String(data.error ?? `HTTP ${res.status}`)
      console.warn(`account: ${route} refused`, { status: res.status, error })
      return { ok: false, error, status: res.status }
    }
    return data as ApiResult<T>
  } catch (e) {
    console.warn(`account: ${route} failed (network)`, { error: String(e) })
    return { ok: false, error: 'network error' }
  }
}

/** One game's streak as the server keeps it. */
export interface ServerStreak {
  school: string
  sport: string
  mode: string
  current: number
  best: number
  /** Last day counted, YYYY-MM-DD (ET). */
  lastDate: string
}

/** The draft behind a result (the server stores it verbatim). */
export interface ServerDetail {
  playerIds: Record<string, string>
  windows?: Record<string, { start: number; end: number }>
  grade: string
}

/** One of the account's own recent results. */
export interface ServerDay {
  school: string
  sport: string
  mode: string
  date: string
  /** Projected wins. */
  score: number
  /** Team strength, 0..100. */
  strength: number
  /** null for a day submitted before drafts were stored. */
  detail: ServerDetail | null
}

/** A device's local streak for one game, as it vouches for it to the server. */
export interface StreakClaim {
  school: string
  sport: string
  mode: string
  current: number
  max: number
  lastDate: string
}

export interface Identity {
  username: string
  name: string
}
export interface Me extends Identity {
  /** Absent from a worker that predates accounts' sync. */
  streaks?: ServerStreak[]
  days?: ServerDay[]
}

/** Client half of the split KDF (see worker/accounts-lib.mjs: hashPass). */
export const KDF_ITERATIONS = 150_000
/** Versioned, so the scheme can change without colliding with old keys. */
export const KDF_SALT_PREFIX = 'ysas:v1:'

/**
 * Stretch the password in the browser; only this key is ever sent. Salted
 * with the username, so the same password on two accounts gives two keys.
 */
export async function derivePass(
  username: string,
  password: string,
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(KDF_SALT_PREFIX + username.trim().toLowerCase()),
      iterations: KDF_ITERATIONS,
    },
    key,
    256,
  )
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Create an account and sign this device in. `clientId` is the device's
 * anonymous id: the server moves what it already played (scores, streaks —
 * every game) to the new account, so there is no anonymous twin left on any
 * board.
 */
export async function register(
  username: string,
  password: string,
  name: string,
) {
  return post<Identity & { token: string }>('register', {
    username,
    pass: await derivePass(username, password),
    name: name.trim() || undefined,
    clientId: getClientId(),
  })
}

/** Sign this device in; what it played anonymously joins the account. */
export async function login(username: string, password: string) {
  return post<Identity & { token: string }>('login', {
    username,
    pass: await derivePass(username, password),
    clientId: getClientId(),
  })
}

export const logout = (token: string) => post<object>('logout', { token })

export const setDisplayName = (token: string, name: string) =>
  post<Identity>('name', { token, name })

/**
 * Change the password from a signed-in device. The current password is
 * required; every OTHER device is signed out. Both travel as derived keys.
 */
export async function changePassword(
  account: Account,
  currentPassword: string,
  newPassword: string,
) {
  return post<Identity>('password', {
    token: account.token,
    pass: await derivePass(account.username, currentPassword),
    newPass: await derivePass(account.username, newPassword),
  })
}

/**
 * Who this token is and what the account has. `streaks` are this device's own
 * local streaks, which the server folds into the account's before answering —
 * that is how an account inherits streaks built before it existed.
 */
export const fetchMe = (token: string, streaks: StreakClaim[] = []) =>
  post<Me>('me', { token, streaks })

/** A sentence for the dialog from a failed call. */
export function friendlyError(r: { error: string; status?: number }): string {
  if (r.error === 'network error' || r.error === 'offline')
    return 'Couldn’t reach the server. Check your connection and try again.'
  // A worker deployed before accounts treats every POST as a score.
  if (r.error === 'unknown school' || r.status === 404 || r.status === 405)
    return 'Accounts aren’t switched on yet. Try again a little later.'
  if (r.status !== undefined && r.status >= 500)
    return 'The server is having trouble. Please try again in a minute.'
  const text = r.error.trim()
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}
