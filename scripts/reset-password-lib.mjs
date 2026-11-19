/**
 * Logic behind `npm run account:reset-password` (scripts/reset-password.mjs):
 * the owner's way to help a friend who forgot their password. Accounts have
 * no email, so there is no self-service reset — but the owner knows every
 * player, and can set a temporary password from their own machine with their
 * own Cloudflare login. Nothing here is reachable from the game.
 *
 * The database never holds a password, only PBKDF2(server salt) of the key
 * the BROWSER derives from it (src/lib/account.ts: derivePass), so a reset
 * has to reproduce both halves. `clientKey` mirrors derivePass exactly; a
 * test pins the two together.
 */

import {
  hashPass,
  randomHex,
  validateUsername,
} from '../worker/accounts-lib.mjs'

/** Must equal KDF_ITERATIONS and KDF_SALT_PREFIX in src/lib/account.ts
 *  (reset-password-lib.test.mjs fails if they drift). */
const CLIENT_KDF_ITERATIONS = 150_000
const CLIENT_SALT_PREFIX = 'ysas:v1:'

/** The key the browser would send for this username + password. */
export async function clientKey(username, password) {
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
      salt: enc.encode(CLIENT_SALT_PREFIX + username.trim().toLowerCase()),
      iterations: CLIENT_KDF_ITERATIONS,
    },
    key,
    256,
  )
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/** No 0/o, 1/l/i: it gets read out or typed from a text message. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** A random temporary password like `k7mq-x2hd-9pwe` (~59 bits). */
export function tempPassword() {
  const out = []
  const limit = 256 - (256 % ALPHABET.length) // reject the biased tail
  while (out.length < 12) {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    for (const b of bytes)
      if (b < limit && out.length < 12) out.push(ALPHABET[b % ALPHABET.length])
  }
  const s = out.join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/**
 * The SQL that signs `username` out on every device and gives the account
 * the password `password` — in that order, so a run that dies halfway never
 * leaves an old session alive behind a changed password — plus the `hash`
 * the script reads back to confirm the write landed. Streaks, scores and
 * display name are not touched. Throws on an invalid username — the name is validated to
 * `[a-z0-9_]` and the other values are hex, so the statements are safe to
 * build as text (wrangler's `d1 execute --command` takes no parameters).
 */
export async function resetStatements(rawUsername, password) {
  const u = validateUsername(rawUsername)
  if (!u.ok) throw new Error(`not a valid username: ${u.error}`)
  const username = u.value
  const salt = randomHex(16)
  const hash = await hashPass(await clientKey(username, password), salt)
  return {
    statements: [
      `DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE username = '${username}')`,
      `UPDATE accounts SET pass_salt = '${salt}', pass_hash = '${hash}' WHERE username = '${username}'`,
    ],
    hash,
  }
}

/** The lookup the script runs first, so a typo is caught before any write. */
export function findAccountSql(rawUsername) {
  const u = validateUsername(rawUsername)
  if (!u.ok) throw new Error(`not a valid username: ${u.error}`)
  return `SELECT id, username, name, pass_hash FROM accounts WHERE username = '${u.value}'`
}
