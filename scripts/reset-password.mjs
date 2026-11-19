#!/usr/bin/env node
/**
 * Give a player a temporary password (they forgot theirs; accounts have no
 * email, so only the owner can do this). Their streaks, scores and display
 * name are untouched; every device is signed out.
 *
 *   npm run account:reset-password -- <username>            # production
 *   npm run account:reset-password -- <username> --local    # local dev D1
 *
 * Runs `wrangler d1 execute` with YOUR Cloudflare login (`wrangler login`).
 * Send the printed password to the player privately; they sign in with it
 * and pick their own under 👤 → Change password. See worker/README.md.
 */

import { execFileSync } from 'node:child_process'
import {
  findAccountSql,
  resetStatements,
  tempPassword,
} from './reset-password-lib.mjs'

const args = process.argv.slice(2)
const local = args.includes('--local')
const username = args.find((a) => !a.startsWith('--'))
if (!username) {
  console.error('usage: npm run account:reset-password -- <username> [--local]')
  process.exit(2)
}

/** Run SQL on the leaderboard D1 and return wrangler's parsed JSON. */
function d1(sql) {
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'ysas-leaderboard',
      local ? '--local' : '--remote',
      '-c',
      'worker/wrangler.toml',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  return JSON.parse(out.slice(out.indexOf('[')))
}

try {
  const found = d1(findAccountSql(username))[0]?.results?.[0]
  if (!found) {
    console.error(`No account with the username "${username}".`)
    process.exit(1)
  }
  const password = tempPassword()
  const { statements, hash } = await resetStatements(found.username, password)
  d1(statements.join('; '))
  // Never print a password that was not actually stored.
  const after = d1(findAccountSql(found.username))[0]?.results?.[0]
  if (after?.pass_hash !== hash) {
    console.error(
      'The new password was NOT saved (the account changed or the write failed). Nothing to send — run the command again.',
    )
    process.exit(1)
  }
  console.log(
    [
      '',
      `Password reset for ${found.username} (display name: ${found.name}).`,
      `Temporary password:  ${password}`,
      '',
      'They are signed out everywhere. Send them the password privately;',
      'they sign in with it, then pick their own under 👤 → Change password.',
      '',
    ].join('\n'),
  )
} catch (e) {
  console.error(`Reset failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
