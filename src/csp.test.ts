import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The page's Content-Security-Policy (index.html) must allow the browser to
 * reach the leaderboard worker. `connect-src 'self'` alone silently blocks
 * every submit — the fetch rejects with "Failed to fetch", submitDaily resolves
 * null, and nothing is ever written to the table. Unit tests (jsdom) and curl
 * don't enforce CSP, so this is the only automated guard. Keep the origin here
 * in step with the deployed worker (worker/README.md).
 */
const WORKER_ORIGIN = 'https://ysas-leaderboard.wardcrazy01894.workers.dev'

function connectSrc(): string[] {
  // process.cwd() is the repo root under vitest; import.meta.url is not a
  // file: URL in the jsdom environment, so it can't be used here.
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const m = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )
  if (!m) throw new Error('index.html has no CSP meta tag')
  const directive = m[1]
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src'))
  if (!directive) throw new Error('CSP has no connect-src directive')
  return directive.split(/\s+/).slice(1)
}

describe('index.html Content-Security-Policy', () => {
  it("connect-src allows the leaderboard worker origin (not just 'self')", () => {
    const sources = connectSrc()
    expect(sources).toContain("'self'")
    expect(sources).toContain(WORKER_ORIGIN)
  })
})
