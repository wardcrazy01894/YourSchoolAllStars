// @vitest-environment node
// The worker is Node/Workers-runtime code: run it outside the app's jsdom
// environment (file: URLs for the migrations, real Request/Response).
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
// node:sqlite is unflagged from Node 22.13 (package.json `engines` enforces it).
import { DatabaseSync } from 'node:sqlite'
import { upsertAndRank, topScores, updateStreak } from './leaderboard-lib.mjs'

/**
 * SQL-level tests for the standing/board/streak queries against a REAL SQLite
 * with the REAL migrations. The handler tests stub D1 entirely, so without
 * these the query SEMANTICS (what counts as a competitor, that keys isolate
 * games, that a seed bootstraps exactly once) are unpinned.
 */

/** Minimal D1-shaped adapter over node:sqlite for the lib's query helpers. */
function d1(db) {
  const wrap = (sql, args) => ({
    sql,
    args,
    all: () => db.prepare(sql).all(...args),
    run: () => {
      const info = db.prepare(sql).run(...args)
      return { meta: { changes: Number(info.changes) } }
    },
    first: () => db.prepare(sql).all(...args)[0] ?? null,
  })
  return {
    prepare: (sql) => ({ bind: (...args) => wrap(sql, args) }),
    batch: async (stmts) => stmts.map((s) => ({ results: s.all() })),
    raw: db,
  }
}

function freshDb() {
  const raw = new DatabaseSync(':memory:')
  const dir = new URL('./migrations/', import.meta.url)
  for (const f of readdirSync(dir).sort()) {
    raw.exec(readFileSync(new URL(f, dir), 'utf8'))
  }
  return d1(raw)
}

let db
beforeEach(() => {
  db = freshDb()
})

const NOW = 1_760_000_000_000
const UM = { school: 'michigan', sport: 'basketball', mode: 'daily' }
const DATE = '2026-07-08'
const submit = (clientId, score, game = UM, date = DATE) =>
  upsertAndRank(db, { ...game, date, clientId, score }, NOW)

describe('standing (one device = one competitor, keep-max)', () => {
  it('ranks by strictly-greater count and totals the field', async () => {
    await submit('device-A', 34)
    await submit('device-B', 30)
    const c = await submit('device-C', 32)
    expect(c).toEqual({ rank: 2, total: 3 })
  })
  it('keep-max: a reload cannot lower a stored score', async () => {
    await submit('device-A', 34)
    const again = await submit('device-A', 20)
    expect(again).toEqual({ rank: 1, total: 1 })
    const { scores } = await topScores(db, { ...UM, date: DATE })
    expect(scores).toEqual([34])
  })
  it('ties across devices share a rank', async () => {
    await submit('device-A', 34)
    await submit('device-B', 34)
    const c = await submit('device-C', 30)
    expect(c).toEqual({ rank: 3, total: 3 })
  })
  it('boards are isolated by school, sport, mode and date', async () => {
    await submit('device-A', 40)
    await submit('device-B', 16, { ...UM, sport: 'football' })
    await submit('device-C', 40, { ...UM, mode: 'daily-iq' })
    await submit('device-D', 40, { ...UM, school: 'unc' })
    await submit('device-E', 40, UM, '2026-07-09')
    const f = await submit('device-F', 30)
    // Only device-A shares michigan/basketball/daily/2026-07-08 with F.
    expect(f).toEqual({ rank: 2, total: 2 })
  })
})

describe('topScores board', () => {
  it('returns scores desc capped at the limit but totals the whole field', async () => {
    for (let i = 0; i < 5; i++) await submit(`device-${i}`, 20 + i)
    const { scores, total } = await topScores(db, { ...UM, date: DATE }, 3)
    expect(scores).toEqual([24, 23, 22])
    expect(total).toBe(5)
  })
})

describe('updateStreak (real streaks table)', () => {
  const sub = (clientId, date, seed = null) => ({
    ...UM,
    clientId,
    date,
    seed,
  })
  const row = (clientId) =>
    db.raw
      .prepare(
        `SELECT current, best, last_played_date FROM streaks
         WHERE school=? AND sport=? AND mode=? AND client_id=?`,
      )
      .get(UM.school, UM.sport, UM.mode, clientId)

  it('starts at 1 for a first-ever play with no seed', async () => {
    expect(await updateStreak(db, sub('dev', '2026-07-08'), NOW)).toEqual({
      current: 1,
      best: 1,
      lastDate: '2026-07-08',
    })
  })
  it('increments day over day and persists the row', async () => {
    await updateStreak(db, sub('dev', '2026-07-08'), NOW)
    const s = await updateStreak(db, sub('dev', '2026-07-09'), NOW)
    expect(s).toEqual({ current: 2, best: 2, lastDate: '2026-07-09' })
    expect(row('dev')).toEqual({
      current: 2,
      best: 2,
      last_played_date: '2026-07-09',
    })
  })
  it("BOOTSTRAPS a device's first row from the client's seed (the 54 carries over)", async () => {
    // The client saved locally first (lastDate = today, current already 54),
    // then submitted: the seed IS the post-save streak, so the server adopts
    // it as-is — no double count.
    const seed = { current: 54, max: 54, lastDate: '2026-10-08' }
    const s = await updateStreak(db, sub('friend', '2026-10-08', seed), NOW)
    expect(s).toEqual({ current: 54, best: 54, lastDate: '2026-10-08' })
    expect(row('friend')).toMatchObject({ current: 54, best: 54 })
  })
  it('a seed whose lastDate is yesterday is advanced, not copied', async () => {
    const seed = { current: 10, max: 12, lastDate: '2026-07-08' }
    const s = await updateStreak(db, sub('dev', '2026-07-09', seed), NOW)
    expect(s).toEqual({ current: 11, best: 12, lastDate: '2026-07-09' })
  })
  it('keeps the stored row when the seed is no better (normal consecutive play)', async () => {
    await updateStreak(db, sub('dev', '2026-07-08'), NOW) // row: 1
    // Client saved locally first, so its seed already reads 2 for 07-09; the
    // stored row advances to the same 2 — a tie keeps the stored row.
    const seed = { current: 2, max: 2, lastDate: '2026-07-09' }
    const s = await updateStreak(db, sub('dev', '2026-07-09', seed), NOW)
    expect(s).toEqual({ current: 2, best: 2, lastDate: '2026-07-09' })
  })
  it('RECONCILES to the client when submits were missed (no lost streak)', async () => {
    // Server row stuck at 5 / 10-08 because the 10-09 and 10-10 submits failed
    // (offline, 503, 429). Locally the player legitimately reached 8 / 10-11.
    // The server must NOT reset to 1 and then have the client mirror 1.
    await updateStreak(
      db,
      sub('dev', '2026-10-08', { current: 5, max: 5, lastDate: '2026-10-08' }),
      NOW,
    )
    const seed = { current: 8, max: 8, lastDate: '2026-10-11' }
    const s = await updateStreak(db, sub('dev', '2026-10-11', seed), NOW)
    expect(s).toEqual({ current: 8, best: 8, lastDate: '2026-10-11' })
    expect(row('dev')).toMatchObject({ current: 8, best: 8 })
  })
  it('a server-side REPAIR beats a reset local streak', async () => {
    // Operator repaired the row to 54 (last counted yesterday). The device's
    // local copy had reset to 1 and is submitting today with that as its seed.
    db.raw
      .prepare(
        `INSERT INTO streaks (school, sport, mode, client_id, current, best, last_played_date, updated_at)
         VALUES (?, ?, ?, ?, 54, 54, '2026-10-07', 0)`,
      )
      .run(UM.school, UM.sport, UM.mode, 'friend')
    const seed = { current: 1, max: 54, lastDate: '2026-10-08' }
    const s = await updateStreak(db, sub('friend', '2026-10-08', seed), NOW)
    expect(s).toEqual({ current: 55, best: 55, lastDate: '2026-10-08' })
  })
  it('best is the max across both records, even when the LOSING side holds it', async () => {
    await updateStreak(db, sub('dev', '2026-10-08'), NOW) // stored: 1 / best 1
    // Stored advances to 2 and wins on current; the seed loses but carries 30.
    const seed = { current: 1, max: 30, lastDate: '2026-10-09' }
    const s = await updateStreak(db, sub('dev', '2026-10-09', seed), NOW)
    expect(s).toEqual({ current: 2, best: 30, lastDate: '2026-10-09' })
    expect(row('dev')).toMatchObject({ current: 2, best: 30 })
  })
  it('streaks are per (school, sport, mode)', async () => {
    await updateStreak(db, sub('dev', '2026-07-08'), NOW)
    await updateStreak(db, sub('dev', '2026-07-09'), NOW)
    const iq = await updateStreak(
      db,
      { ...sub('dev', '2026-07-09'), mode: 'daily-iq' },
      NOW,
    )
    expect(iq.current).toBe(1)
    expect(row('dev').current).toBe(2)
  })
  it('same-day double submit converges', async () => {
    await updateStreak(db, sub('dev', '2026-07-08'), NOW)
    const s = await updateStreak(db, sub('dev', '2026-07-08'), NOW)
    expect(s.current).toBe(1)
  })
})
