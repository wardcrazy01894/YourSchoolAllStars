/**
 * Optional accounts for the leaderboard Worker: a username, a password and a
 * display name (no email). Validation, password hashing, sessions, and the
 * fold that lets an account INHERIT what its devices already have. Ported
 * from CampusPin Showdown's accounts-lib.mjs (itself from WhereHePlay),
 * reshaped for this worker's many games: every (school, sport, mode) has its
 * own board and its own streak, so the fold and the sync cover all of them.
 *
 * How an account sits in the existing schema: its scores and streaks are
 * ordinary `scores` / `streaks` rows whose `client_id` is the player key
 * `acct:<id>` (accountKey). A browser-minted device id cannot contain ':'
 * (isValidClientId), so the key cannot be forged, and rank / total / board /
 * keep-max / streak all treat a signed-in player on three devices as ONE
 * competitor with no change to those queries.
 *
 * Kept out of the entry module for the same reason as leaderboard-lib.mjs
 * (the Workers runtime rejects non-handler exports on the entry).
 *
 * Trust model: scores and streaks are computed in the browser, so anti-cheat
 * stays a non-goal. The controls here stop accidents, drive-by abuse and
 * account takeover.
 */

import {
  dayDiff,
  gapIsAllOutage,
  isValidClientId,
  validDateKeys,
  validateGame,
  validateSeed,
} from './leaderboard-lib.mjs'

export const MAX_SESSIONS_PER_ACCOUNT = 10
/** Server half of the split KDF — small because Workers Free allows ~10 ms CPU. */
export const SERVER_KDF_ITERATIONS = 1000
/** Most streak claims one `/me` may carry (there are ~30 daily games). */
export const MAX_CLAIMS = 64

const fail = (status, error) => ({ ok: false, status, error })

/** The `client_id` under which an account's scores and streaks are stored. */
export function accountKey(id) {
  return `acct:${id}`
}

// ---- Validation ---------------------------------------------------------------

/** A session token: 48 hex chars (24 random bytes). */
export function isValidToken(t) {
  return typeof t === 'string' && /^[0-9a-f]{48}$/.test(t)
}

/** The client-derived password key: 64 hex chars (PBKDF2-SHA256 output). */
export function isValidPass(p) {
  return typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)
}

/**
 * Words a display name or username may not contain (matched on the letters
 * only, so "f.u.c.k" and "FUCK" are caught). Deliberately short, and free of
 * fragments that sit inside real names (Hancock, Dickinson, "Spicy"): it
 * stops the obvious, it is not a moderation system (an admin can rename by
 * hand — worker/README.md).
 */
const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'faggot',
  'bitch',
  'whore',
  'slut',
  'rapist',
  'nazi',
  'hitler',
  'kike',
  'porn',
  'pussy',
]
/** Digits and symbols commonly swapped in for letters. */
const LEET = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  '@': 'a',
  $: 's',
  '!': 'i',
}

export function isClean(text) {
  // Fold compatibility forms and accents, undo leetspeak, then match on the
  // bare letters. Names are Latin-script only (validateName), so lookalike
  // letters from other scripts never get here.
  const letters = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
  return !BLOCKED.some((w) => letters.includes(w))
}

/**
 * Display name: 2–20 chars of Latin letters (accents allowed), digits, space
 * and _ . - '. NFKC first, so fullwidth forms become plain characters;
 * Latin-only, so a Cyrillic or Greek lookalike cannot impersonate another
 * player or slip a blocked word past the filter. The charset also keeps
 * markup out of the leaderboard.
 */
export function validateName(raw) {
  if (typeof raw !== 'string') return fail(400, 'invalid name')
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 20)
    return fail(400, 'name must be 2 to 20 characters')
  if (!/^[\p{Script=Latin}0-9 _.'-]+$/u.test(name))
    return fail(400, "name can use letters, numbers, spaces and _ . - '")
  if (!isClean(name)) return fail(400, 'pick a different name')
  return { ok: true, value: name }
}

/** Username: 3–20 of a-z 0-9 _ (stored lowercased). Never an email. */
export function validateUsername(raw) {
  if (typeof raw !== 'string') return fail(400, 'invalid username')
  const username = raw.trim().toLowerCase()
  if (username.includes('@'))
    return fail(
      400,
      'a username is not an email: use 3 to 20 letters, numbers or _',
    )
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return fail(400, 'username must be 3 to 20 letters, numbers or _')
  if (!isClean(username)) return fail(400, 'pick a different username')
  return { ok: true, value: username }
}

/**
 * The streaks a device vouches for from its localStorage — one per game — so
 * an account created today inherits streaks built before accounts existed,
 * and before the server streak table did. Each is exactly the `seed` a score
 * submission already carries (`{ current, max, lastDate }`), tagged with its
 * game, and is trusted exactly as much (validateSeed). Anything malformed, for
 * an unknown game, or past MAX_CLAIMS is dropped; the rest come back as streak
 * rows.
 */
export function validateClaims(raw, now) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw.slice(0, MAX_CLAIMS)) {
    const g = validateGame(c)
    if (!g.ok) continue
    const seed = validateSeed(c, now).value
    if (!seed) continue
    out.push({
      ...g.value,
      current: seed.current,
      best: seed.max,
      last_played_date: seed.lastDate,
    })
  }
  return out
}

// ---- Crypto -------------------------------------------------------------------

const hex = (buf) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )

export async function sha256Hex(text) {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
}

export function randomHex(bytes) {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return hex(b)
}

/**
 * Passwords use a SPLIT KDF: the browser stretches the password (PBKDF2,
 * 150k iterations, salted with the username — src/lib/account.ts) and sends
 * only that derived key; the server stretches it again with a random
 * per-account salt before storing. The plaintext password never leaves the
 * device, the expensive part runs on the client (Workers Free = ~10 ms CPU),
 * and the stored hash is not replayable as a login.
 */
export async function hashPass(pass, saltHex) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pass),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(saltHex),
      iterations: SERVER_KDF_ITERATIONS,
    },
    key,
    256,
  )
  return hex(bits)
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
    return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---- Accounts + sessions ------------------------------------------------------

/**
 * Create an account. 409 when the username is taken (the UNIQUE constraint
 * decides a race). An empty display name defaults to the username.
 */
export async function createAccount(db, { username, name, pass }, now) {
  const taken = await db
    .prepare(`SELECT 1 AS x FROM accounts WHERE username = ?1`)
    .bind(username)
    .first()
  if (taken) return fail(409, 'that username is taken')
  const salt = randomHex(16)
  const hash = await hashPass(pass, salt)
  const shown = name || username
  let row
  try {
    row = await db
      .prepare(
        `INSERT INTO accounts (username, name, pass_salt, pass_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      )
      .bind(username, shown, salt, hash, now)
      .first()
  } catch {
    return fail(409, 'that username is taken')
  }
  return { ok: true, value: { id: row.id, username, name: shown } }
}

/** A salt to burn equal work on when the username does not exist. */
const DUMMY_SALT = '00000000000000000000000000000000'

/**
 * Check a username + password key. The same error and the same amount of
 * hashing whether the username exists or not.
 */
export async function verifyLogin(db, username, pass) {
  const row = await db
    .prepare(
      `SELECT id, username, name, pass_salt, pass_hash FROM accounts WHERE username = ?1`,
    )
    .bind(username)
    .first()
  const hash = await hashPass(pass, row?.pass_salt ?? DUMMY_SALT)
  if (!row || !safeEqual(hash, row.pass_hash))
    return fail(401, 'wrong username or password')
  return {
    ok: true,
    value: { id: row.id, username: row.username, name: row.name },
  }
}

/** Mint a session token for one device; keeps only the newest few. */
export async function openSession(db, accountId, now) {
  const token = randomHex(24)
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?1, ?2, ?3)`,
    )
    .bind(await sha256Hex(token), accountId, now)
    .run()
  await db
    .prepare(
      `DELETE FROM sessions WHERE account_id = ?1 AND token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE account_id = ?1
         ORDER BY created_at DESC, token_hash LIMIT ?2)`,
    )
    .bind(accountId, MAX_SESSIONS_PER_ACCOUNT)
    .run()
  return token
}

export async function closeSession(db, token) {
  if (!isValidToken(token)) return
  await db
    .prepare(`DELETE FROM sessions WHERE token_hash = ?1`)
    .bind(await sha256Hex(token))
    .run()
}

/** The account behind a session token, or null. */
export async function accountForToken(db, token) {
  if (!isValidToken(token)) return null
  const row = await db
    .prepare(
      `SELECT a.id, a.username, a.name FROM sessions s
       JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1`,
    )
    .bind(await sha256Hex(token))
    .first()
  return row ?? null
}

/**
 * Replace an account's password (a fresh salt each time) and sign it out
 * everywhere except the session behind `keepToken` — one atomic batch, so a
 * changed password never leaves the old sessions alive.
 */
export async function changeAccountPassword(db, accountId, pass, keepToken) {
  const salt = randomHex(16)
  const hash = await hashPass(pass, salt)
  await db.batch([
    db
      .prepare(
        `DELETE FROM sessions WHERE account_id = ?1 AND token_hash != ?2`,
      )
      .bind(accountId, await sha256Hex(keepToken)),
    db
      .prepare(
        `UPDATE accounts SET pass_salt = ?1, pass_hash = ?2 WHERE id = ?3`,
      )
      .bind(salt, hash, accountId),
  ])
}

export async function renameAccount(db, accountId, name) {
  await db
    .prepare(`UPDATE accounts SET name = ?1 WHERE id = ?2`)
    .bind(name, accountId)
    .run()
}

// ---- Inheriting a device's progress -------------------------------------------

/**
 * Two streaks for the same player in the same game, as one. The later
 * last-played day decides the count — on the same day, the LONGER one (the
 * owner's rule: two devices with different streaks become the longer). When
 * the later day CONTINUES the earlier one — the next day, or separated only by
 * site-outage days, the same rule as advanceStreak — the run is unbroken, so
 * it is at least the earlier count plus the days since. A streak whose last
 * day is older than that has lapsed and does not come back; `best` only ever
 * grows. The client applies the same rule (src/lib/sync.ts mergeStreak;
 * worker/parity.test.mjs pins the two together).
 */
export function mergeStreaks(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  const [older, newer] =
    a.last_played_date <= b.last_played_date ? [a, b] : [b, a]
  const diff = dayDiff(older.last_played_date, newer.last_played_date)
  let current
  if (diff === 0) current = Math.max(older.current, newer.current)
  else if (diff === 1 || gapIsAllOutage(older.last_played_date, diff))
    current = Math.max(newer.current, older.current + diff)
  else current = newer.current
  return {
    current,
    best: Math.max(a.best, b.best, current),
    last_played_date: newer.last_played_date,
  }
}

const gameOf = (r) => `${r.school}|${r.sport}|${r.mode}`

const streakRows = (db, clientId) =>
  db
    .prepare(
      `SELECT school, sport, mode, current, best, last_played_date
       FROM streaks WHERE client_id = ?1`,
    )
    .bind(clientId)

/** `(strength, score)` of the incoming row beats the stored one. */
const BETTER = `(COALESCE(excluded.strength, 0), excluded.score) > (COALESCE(strength, 0), score)`
const SAME = `(COALESCE(excluded.strength, 0), excluded.score) = (COALESCE(strength, 0), score)`

/**
 * Fold what a device already has into account `accountId`, across every game:
 *
 * - `clientId` — the device's ANONYMOUS id. Its score rows move to the
 *   account (where both have one for the same game and day, the better
 *   (strength, score) pair stands, with its draft) and its server streaks are
 *   merged, then the anonymous rows are deleted — so signing in after playing
 *   leaves one row on the board, not an anonymous twin. Knowing the id is the
 *   proof of owning it (the board never shows ids). Anything that is not a
 *   device id — junk, or another account's key — is ignored: accounts never
 *   merge.
 * - `claims` — the device's local streaks (validateClaims), merged too.
 *
 * Bounded D1 work whatever the number of games: the streaks are read once,
 * merged here, and written in one batch (Workers Free caps queries per
 * request).
 *
 * @param {{ clientId?: unknown, claims?: Array<{ school: string, sport: string, mode: string, current: number, best: number, last_played_date: string }> }} from
 */
export async function foldIntoAccount(db, accountId, from, now) {
  const key = accountKey(accountId)
  const incoming = []
  const cleanup = []
  if (isValidClientId(from.clientId)) {
    const device = from.clientId
    await db.batch([
      db
        .prepare(
          `INSERT INTO scores (school, sport, mode, date, client_id, score, strength, detail, created_at, updated_at)
           SELECT school, sport, mode, date, ?2, score, strength, detail, created_at, updated_at
             FROM scores WHERE client_id = ?1
           ON CONFLICT(school, sport, mode, date, client_id) DO UPDATE SET
             detail = CASE
               WHEN ${BETTER} THEN excluded.detail
               WHEN detail IS NULL AND ${SAME} THEN excluded.detail
               ELSE detail END,
             score = CASE WHEN ${BETTER} THEN excluded.score ELSE score END,
             strength = CASE WHEN ${BETTER} THEN COALESCE(excluded.strength, 0)
                             ELSE COALESCE(strength, 0) END,
             updated_at = MAX(updated_at, excluded.updated_at)`,
        )
        .bind(device, key),
      db.prepare(`DELETE FROM scores WHERE client_id = ?1`).bind(device),
    ])
    const rows = await streakRows(db, device).all()
    incoming.push(...rows.results)
    cleanup.push(
      db.prepare(`DELETE FROM streaks WHERE client_id = ?1`).bind(device),
    )
  }
  incoming.push(...(from.claims ?? []))
  if (incoming.length === 0) return

  const mine = new Map(
    (await streakRows(db, key).all()).results.map((r) => [gameOf(r), r]),
  )
  const changed = new Map()
  for (const row of incoming) {
    const g = gameOf(row)
    const before = mine.get(g) ?? null
    const next = mergeStreaks(before, row)
    if (
      before &&
      before.current === next.current &&
      before.best === next.best &&
      before.last_played_date === next.last_played_date
    )
      continue
    const merged = {
      school: row.school,
      sport: row.sport,
      mode: row.mode,
      ...next,
    }
    mine.set(g, merged)
    changed.set(g, merged)
  }
  const writes = [...changed.values()].map((r) =>
    db
      .prepare(
        `INSERT INTO streaks (school, sport, mode, client_id, current, best, last_played_date, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(school, sport, mode, client_id) DO UPDATE SET
           current = excluded.current,
           best = excluded.best,
           last_played_date = excluded.last_played_date,
           updated_at = excluded.updated_at`,
      )
      .bind(
        r.school,
        r.sport,
        r.mode,
        key,
        r.current,
        r.best,
        r.last_played_date,
        now,
      ),
  )
  // The device's streak rows go in the SAME batch as the account's new ones,
  // so a failure can never delete a streak that was not carried over.
  if (writes.length + cleanup.length > 0)
    await db.batch([...writes, ...cleanup])
}

function parseDetail(text) {
  if (typeof text !== 'string') return null
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/**
 * What another device needs to pick up where this account left off: every
 * game's streak, and the results still inside the submission window (so
 * "today", whatever the device's clock) with their drafts. Only ever the
 * caller's own rows.
 */
export async function readProgress(db, accountId, now) {
  const key = accountKey(accountId)
  const since = [...validDateKeys(now)].sort()[0]
  const days = db
    .prepare(
      `SELECT school, sport, mode, date, score, COALESCE(strength, 0) AS strength, detail
       FROM scores WHERE client_id = ?1 AND date >= ?2
       ORDER BY date, school, sport, mode`,
    )
    .bind(key, since)
  const [st, sc] = await db.batch([streakRows(db, key), days])
  return {
    streaks: st.results.map((s) => ({
      school: s.school,
      sport: s.sport,
      mode: s.mode,
      current: Number(s.current),
      best: Number(s.best),
      lastDate: s.last_played_date,
    })),
    days: sc.results.map((r) => ({
      school: r.school,
      sport: r.sport,
      mode: r.mode,
      date: r.date,
      score: Number(r.score),
      strength: Number(r.strength),
      detail: parseDetail(r.detail),
    })),
  }
}
