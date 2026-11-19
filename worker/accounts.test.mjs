// @vitest-environment node
// Accounts for the leaderboard Worker: the pure rules, then the SQL against a
// real SQLite with the real migrations (d1-test-helper.mjs).
import { describe, it, expect, beforeEach } from 'vitest'
import { freshDb } from './d1-test-helper.mjs'
import {
  accountKey,
  isClean,
  validateName,
  validateUsername,
  validateClaims,
  mergeStreaks,
  hashPass,
  safeEqual,
  createAccount,
  verifyLogin,
  openSession,
  closeSession,
  accountForToken,
  changeAccountPassword,
  renameAccount,
  foldIntoAccount,
  readProgress,
  MAX_SESSIONS_PER_ACCOUNT,
  MAX_CLAIMS,
} from './accounts-lib.mjs'
import {
  upsertAndRank,
  updateStreak,
  topScores,
  validateDetail,
  validateSubmission,
  dateKeyFor,
  addDays,
  OUTAGE_DAYS,
} from './leaderboard-lib.mjs'

const NOW = new Date('2026-11-19T17:00:00Z')
const TODAY = dateKeyFor(NOW)
const YESTERDAY = addDays(TODAY, -1)
const DEVICE = '3f1a9c2e-7b4d-4e1a-9c2e-7b4d4e1a9c2e'
const OTHER = '9c2e7b4d-4e1a-4c2e-8b4d-4e1a9c2e3f1a'
const PASS = 'a'.repeat(64)
const GAME = { school: 'michigan', sport: 'basketball', mode: 'daily' }
const IQ = { ...GAME, mode: 'daily-iq' }
const DETAIL = JSON.stringify({
  playerIds: { PG: 'trey-burke', C: 'juwan-howard' },
  windows: { PG: { start: 2010, end: 2013 }, C: { start: 1992, end: 1995 } },
  grade: 'ELITE',
})

const row = (current, best, last_played_date, game = GAME) => ({
  ...game,
  current,
  best,
  last_played_date,
})

describe('validation', () => {
  it('usernames: 3–20 of a-z 0-9 _, lowercased, never an email', () => {
    expect(validateUsername('  Spicy_Al ')).toEqual({
      ok: true,
      value: 'spicy_al',
    })
    expect(validateUsername('ab').ok).toBe(false)
    expect(validateUsername('a'.repeat(21)).ok).toBe(false)
    expect(validateUsername('has space').ok).toBe(false)
    expect(validateUsername('me@example.com').error).toMatch(/not an email/)
    expect(validateUsername(42).ok).toBe(false)
  })

  it("display names: 2–20 Latin letters / digits / space _ . - ', tidied", () => {
    expect(validateName('  Spicy   Al ')).toEqual({
      ok: true,
      value: 'Spicy Al',
    })
    expect(validateName("José O'Neil-2").ok).toBe(true)
    expect(validateName('a').ok).toBe(false)
    expect(validateName('x'.repeat(21)).ok).toBe(false)
    expect(validateName('<b>bold</b>').ok).toBe(false)
    expect(validateName('Аlex').ok).toBe(false) // Cyrillic А
  })

  it('blocks the obvious words, through leetspeak and punctuation, not real names', () => {
    expect(isClean('Hancock')).toBe(true)
    expect(isClean('Spicy Al')).toBe(true)
    expect(validateName('f.u.c.k').ok).toBe(false)
    expect(validateName('5h1t head').ok).toBe(false)
    expect(validateUsername('n4zi_fan').ok).toBe(false)
  })

  it('claims: keeps well-formed streaks for known games, drops the rest', () => {
    const claims = validateClaims(
      [
        { ...GAME, current: 4, max: 9, lastDate: TODAY },
        { ...GAME, school: 'nowhere', current: 4, max: 9, lastDate: TODAY },
        { ...IQ, current: 0, max: 3, lastDate: YESTERDAY }, // nothing live
        { ...IQ, current: 5, max: 3, lastDate: YESTERDAY }, // max < current
        { ...IQ, current: 2, max: 2, lastDate: addDays(TODAY, 30) }, // future
        'junk',
        null,
      ],
      NOW,
    )
    expect(claims).toEqual([row(4, 9, TODAY)])
    expect(validateClaims('nope', NOW)).toEqual([])
    expect(validateClaims(undefined, NOW)).toEqual([])
  })

  it('claims: capped, so one request cannot carry an unbounded list', () => {
    const many = Array.from({ length: MAX_CLAIMS + 20 }, () => ({
      ...GAME,
      current: 1,
      max: 1,
      lastDate: TODAY,
    }))
    expect(validateClaims(many, NOW)).toHaveLength(MAX_CLAIMS)
  })

  it('detail: a real draft becomes compact JSON; anything off becomes null', () => {
    expect(validateDetail(JSON.parse(DETAIL))).toBe(DETAIL)
    expect(
      validateDetail({ playerIds: { PG: 'x' }, grade: 'A+', extra: 'dropped' }),
    ).toBe('{"playerIds":{"PG":"x"},"grade":"A+"}')
    expect(validateDetail(null)).toBeNull()
    expect(validateDetail({ playerIds: {}, grade: 'A' })).toBeNull()
    expect(validateDetail({ playerIds: { PG: 7 }, grade: 'A' })).toBeNull()
    expect(validateDetail({ playerIds: { 'P G': 'x' }, grade: 'A' })).toBeNull()
    expect(validateDetail({ playerIds: { PG: 'x' } })).toBeNull() // no grade
    expect(
      validateDetail({ playerIds: { PG: 'x' }, grade: '<script>' }),
    ).toBeNull()
    expect(
      validateDetail({
        playerIds: { PG: 'x' },
        windows: { PG: { start: 2013, end: 2010 } },
        grade: 'A',
      }),
    ).toBeNull()
    expect(
      validateDetail({
        playerIds: { PG: 'x' },
        windows: { SG: { start: 2010, end: 2013 } }, // not a drafted slot
        grade: 'A',
      }),
    ).toBeNull()
    const tooMany = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`S${i}`, 'x']),
    )
    expect(validateDetail({ playerIds: tooMany, grade: 'A' })).toBeNull()
  })

  it('a submission carries its draft through; a bad one never fails the score', () => {
    const body = {
      ...GAME,
      date: TODAY,
      score: 34,
      strength: 70,
      clientId: DEVICE,
    }
    const good = validateSubmission(
      { ...body, detail: JSON.parse(DETAIL) },
      NOW,
    )
    expect(good.ok && good.value.detail).toBe(DETAIL)
    const bad = validateSubmission({ ...body, detail: { playerIds: 3 } }, NOW)
    expect(bad.ok && bad.value.detail).toBeNull()
  })
})

describe('mergeStreaks', () => {
  it('one side missing → the other', () => {
    expect(mergeStreaks(null, null)).toBeNull()
    expect(mergeStreaks(null, row(3, 5, TODAY))).toEqual(row(3, 5, TODAY))
    expect(mergeStreaks(row(3, 5, TODAY), null)).toEqual(row(3, 5, TODAY))
  })

  it('same last day → the LONGER streak, and the higher best', () => {
    const m = mergeStreaks(row(3, 20, TODAY), row(12, 12, TODAY))
    expect(m).toMatchObject({ current: 12, best: 20, last_played_date: TODAY })
  })

  it('consecutive days → one unbroken run (at least the earlier + 1)', () => {
    // Yesterday on the phone (a 9-day run), today on the laptop (its first).
    expect(mergeStreaks(row(9, 9, YESTERDAY), row(1, 4, TODAY))).toMatchObject({
      current: 10,
      best: 10,
      last_played_date: TODAY,
    })
    // …but never double-counted when the later one already includes it.
    expect(
      mergeStreaks(row(9, 9, YESTERDAY), row(10, 10, TODAY)),
    ).toMatchObject({ current: 10, best: 10 })
  })

  it('a gap → the later streak stands; the lapsed one only keeps its best', () => {
    const m = mergeStreaks(row(40, 40, addDays(TODAY, -5)), row(2, 2, TODAY))
    expect(m).toMatchObject({ current: 2, best: 40, last_played_date: TODAY })
  })

  it('a gap made only of outage days continues the run, crediting each day', () => {
    const outage = OUTAGE_DAYS[0]
    const m = mergeStreaks(
      row(5, 5, addDays(outage, -1)),
      row(1, 1, addDays(outage, 1)),
    )
    expect(m).toMatchObject({ current: 7, best: 7 })
  })

  it('is symmetric', () => {
    const a = row(9, 11, YESTERDAY)
    const b = row(1, 30, TODAY)
    expect(mergeStreaks(a, b)).toEqual(mergeStreaks(b, a))
  })
})

describe('accounts + sessions (SQL)', () => {
  let db
  beforeEach(() => {
    db = freshDb()
  })
  const make = (username = 'spicy_al', name = '') =>
    createAccount(db, { username, name, pass: PASS }, 1)

  it('creates an account; the display name defaults to the username', async () => {
    const a = await make()
    expect(a).toEqual({
      ok: true,
      value: { id: 1, username: 'spicy_al', name: 'spicy_al' },
    })
    const b = await make('other', 'Big Blue')
    expect(b.value.name).toBe('Big Blue')
  })

  it('refuses a taken username', async () => {
    await make()
    expect(await make()).toMatchObject({ ok: false, status: 409 })
  })

  it('never stores the password key itself', async () => {
    await make()
    const [acct] = db.rows(`SELECT pass_salt, pass_hash FROM accounts`)
    expect(acct.pass_hash).not.toBe(PASS)
    expect(
      safeEqual(acct.pass_hash, await hashPass(PASS, acct.pass_salt)),
    ).toBe(true)
  })

  it('logs in with the right key only — same error for a wrong key and no such user', async () => {
    await make()
    expect((await verifyLogin(db, 'spicy_al', PASS)).ok).toBe(true)
    const wrong = await verifyLogin(db, 'spicy_al', 'b'.repeat(64))
    const nobody = await verifyLogin(db, 'nobody', PASS)
    expect(wrong).toEqual({
      ok: false,
      status: 401,
      error: 'wrong username or password',
    })
    expect(nobody).toEqual(wrong)
  })

  it('sessions: a token resolves to its account until closed; only its hash is stored', async () => {
    const { value } = await make()
    const token = await openSession(db, value.id, 1)
    expect(await accountForToken(db, token)).toEqual(value)
    expect(db.rows(`SELECT token_hash FROM sessions`)[0].token_hash).not.toBe(
      token,
    )
    expect(await accountForToken(db, 'f'.repeat(48))).toBeNull()
    expect(await accountForToken(db, 'not-a-token')).toBeNull()
    await closeSession(db, token)
    expect(await accountForToken(db, token)).toBeNull()
  })

  it('keeps only the newest sessions per account', async () => {
    const { value } = await make()
    const first = await openSession(db, value.id, 1)
    for (let i = 0; i < MAX_SESSIONS_PER_ACCOUNT; i++)
      await openSession(db, value.id, 2 + i)
    expect(db.rows(`SELECT 1 FROM sessions`)).toHaveLength(
      MAX_SESSIONS_PER_ACCOUNT,
    )
    expect(await accountForToken(db, first)).toBeNull()
  })

  it('changing the password signs out every OTHER device', async () => {
    const { value } = await make()
    const here = await openSession(db, value.id, 1)
    const there = await openSession(db, value.id, 2)
    const next = 'c'.repeat(64)
    await changeAccountPassword(db, value.id, next, here)
    expect(await accountForToken(db, here)).toEqual(value)
    expect(await accountForToken(db, there)).toBeNull()
    expect((await verifyLogin(db, 'spicy_al', PASS)).ok).toBe(false)
    expect((await verifyLogin(db, 'spicy_al', next)).ok).toBe(true)
  })

  it('renames', async () => {
    const { value } = await make()
    await renameAccount(db, value.id, 'Big Blue')
    expect((await verifyLogin(db, 'spicy_al', PASS)).value.name).toBe(
      'Big Blue',
    )
  })
})

describe('foldIntoAccount (SQL)', () => {
  let db, id, key
  beforeEach(async () => {
    db = freshDb()
    id = (await createAccount(db, { username: 'spicy_al', pass: PASS }, 1))
      .value.id
    key = accountKey(id)
  })
  const play = (clientId, over = {}) =>
    upsertAndRank(
      db,
      { ...GAME, date: TODAY, clientId, score: 30, strength: 70, ...over },
      5,
    )
  const streakOf = (clientId, game = GAME) =>
    db.rows(
      `SELECT current, best, last_played_date FROM streaks
       WHERE school = ? AND sport = ? AND mode = ? AND client_id = ?`,
      game.school,
      game.sport,
      game.mode,
      clientId,
    )[0]
  const seedStreak = (clientId, current, best, last, game = GAME) =>
    updateStreak(
      db,
      {
        ...game,
        clientId,
        date: last,
        seed: { current, max: best, lastDate: last },
      },
      5,
    )

  it("moves the device's scores and streaks, in every game, and leaves no anonymous twin", async () => {
    await play(DEVICE, { detail: DETAIL })
    await play(DEVICE, { ...IQ, score: 20, strength: 60 })
    await seedStreak(DEVICE, 7, 9, TODAY)
    await seedStreak(DEVICE, 3, 3, YESTERDAY, IQ)

    await foldIntoAccount(db, id, { clientId: DEVICE }, 9)

    expect(db.rows(`SELECT 1 FROM scores WHERE client_id = ?`, DEVICE)).toEqual(
      [],
    )
    expect(
      db.rows(`SELECT 1 FROM streaks WHERE client_id = ?`, DEVICE),
    ).toEqual([])
    expect(
      db.rows(
        `SELECT mode, score, strength, detail FROM scores WHERE client_id = ? ORDER BY mode`,
        key,
      ),
    ).toEqual([
      { mode: 'daily', score: 30, strength: 70, detail: DETAIL },
      { mode: 'daily-iq', score: 20, strength: 60, detail: null },
    ])
    expect(streakOf(key)).toEqual({
      current: 7,
      best: 9,
      last_played_date: TODAY,
    })
    expect(streakOf(key, IQ)).toEqual({
      current: 3,
      best: 3,
      last_played_date: YESTERDAY,
    })
    // One competitor on the board, not two.
    expect((await topScores(db, { ...GAME, date: TODAY })).total).toBe(1)
  })

  it('same game and day on both: the better (strength, score) pair stands, with ITS draft', async () => {
    const theirs = JSON.stringify({ playerIds: { PG: 'a' }, grade: 'B' })
    await play(key, { score: 34, strength: 80, detail: theirs })
    await play(DEVICE, { score: 30, strength: 70, detail: DETAIL })
    await foldIntoAccount(db, id, { clientId: DEVICE }, 9)
    expect(db.rows(`SELECT score, strength, detail FROM scores`)).toEqual([
      { score: 34, strength: 80, detail: theirs },
    ])

    await play(OTHER, { score: 38, strength: 92, detail: DETAIL })
    await foldIntoAccount(db, id, { clientId: OTHER }, 9)
    expect(db.rows(`SELECT score, strength, detail FROM scores`)).toEqual([
      { score: 38, strength: 92, detail: DETAIL },
    ])
  })

  it('an identical pair fills in a draft the account row was missing', async () => {
    await play(key) // written before drafts were stored
    await play(DEVICE, { detail: DETAIL })
    await foldIntoAccount(db, id, { clientId: DEVICE }, 9)
    expect(db.rows(`SELECT detail FROM scores`)).toEqual([{ detail: DETAIL }])
  })

  it('merges the device streak into a longer account streak instead of replacing it', async () => {
    await seedStreak(key, 20, 20, YESTERDAY)
    await seedStreak(DEVICE, 1, 4, TODAY)
    await foldIntoAccount(db, id, { clientId: DEVICE }, 9)
    expect(streakOf(key)).toEqual({
      current: 21,
      best: 21,
      last_played_date: TODAY,
    })
  })

  it('claims (a device vouching for its local streaks) are merged per game', async () => {
    await seedStreak(key, 2, 2, TODAY)
    await foldIntoAccount(
      db,
      id,
      { claims: [row(11, 15, TODAY), row(4, 4, YESTERDAY, IQ)] },
      9,
    )
    expect(streakOf(key)).toEqual({
      current: 11,
      best: 15,
      last_played_date: TODAY,
    })
    expect(streakOf(key, IQ)).toEqual({
      current: 4,
      best: 4,
      last_played_date: YESTERDAY,
    })
  })

  it('is idempotent: folding the same claim twice changes nothing', async () => {
    const claims = [row(11, 15, TODAY)]
    await foldIntoAccount(db, id, { claims }, 9)
    await foldIntoAccount(db, id, { claims }, 10)
    expect(streakOf(key)).toEqual({
      current: 11,
      best: 15,
      last_played_date: TODAY,
    })
    expect(db.rows(`SELECT updated_at FROM streaks`)).toEqual([
      { updated_at: 9 },
    ])
  })

  it('never writes a stale merge over a streak that advanced meanwhile', async () => {
    // A streak row that is AHEAD of the claim being folded keeps its day and
    // its count; only `best` can still grow.
    await seedStreak(key, 8, 8, TODAY)
    await db
      .prepare(
        `INSERT INTO streaks (school, sport, mode, client_id, current, best, last_played_date, updated_at)
         VALUES ('michigan', 'basketball', 'daily', ?1, 3, 30, ?2, 9)
         ON CONFLICT(school, sport, mode, client_id) DO UPDATE SET
           current = CASE
             WHEN excluded.last_played_date > last_played_date THEN excluded.current
             ELSE MAX(current, excluded.current) END,
           best = MAX(best, excluded.best),
           last_played_date = excluded.last_played_date,
           updated_at = excluded.updated_at
         WHERE excluded.last_played_date >= last_played_date`,
      )
      .bind(key, YESTERDAY)
      .run()
    expect(streakOf(key)).toEqual({
      current: 8,
      best: 8,
      last_played_date: TODAY,
    })
  })

  it("never folds another ACCOUNT's rows: a forged player key is ignored", async () => {
    const victim = (
      await createAccount(db, { username: 'victim', pass: PASS }, 1)
    ).value.id
    await play(accountKey(victim), { score: 38, strength: 92 })
    await seedStreak(accountKey(victim), 50, 50, TODAY)
    await foldIntoAccount(db, id, { clientId: accountKey(victim) }, 9)
    expect(db.rows(`SELECT 1 FROM scores WHERE client_id = ?`, key)).toEqual([])
    expect(streakOf(key)).toBeUndefined()
    expect(streakOf(accountKey(victim)).current).toBe(50)
  })
})

describe('readProgress + the board (SQL)', () => {
  let db, id
  beforeEach(async () => {
    db = freshDb()
    id = (
      await createAccount(
        db,
        { username: 'spicy_al', name: 'Spicy Al', pass: PASS },
        1,
      )
    ).value.id
  })

  it("returns every game's streak and the recent results with their drafts", async () => {
    const key = accountKey(id)
    await upsertAndRank(
      db,
      {
        ...GAME,
        date: TODAY,
        clientId: key,
        score: 30,
        strength: 70,
        detail: DETAIL,
      },
      5,
    )
    await upsertAndRank(
      db,
      {
        ...GAME,
        date: addDays(TODAY, -9),
        clientId: key,
        score: 12,
        strength: 44,
      },
      5,
    )
    await foldIntoAccount(db, id, { claims: [row(6, 8, TODAY)] }, 9)
    // Someone else's rows never leak in.
    await upsertAndRank(
      db,
      { ...GAME, date: TODAY, clientId: DEVICE, score: 40, strength: 99 },
      5,
    )

    expect(await readProgress(db, id, NOW)).toEqual({
      streaks: [{ ...GAME, current: 6, best: 8, lastDate: TODAY }],
      days: [
        {
          ...GAME,
          date: TODAY,
          score: 30,
          strength: 70,
          detail: JSON.parse(DETAIL),
        },
      ],
    })
  })

  it('the board resolves names by primary key, not by scanning accounts per row', () => {
    const plan = db
      .rows(
        `EXPLAIN QUERY PLAN
         SELECT COALESCE(a.name, '') FROM scores s LEFT JOIN accounts a
           ON s.client_id LIKE 'acct:%'
          AND a.id = CAST(substr(s.client_id, 6) AS INTEGER)
         WHERE s.school = 'michigan' AND s.sport = 'basketball'
           AND s.mode = 'daily' AND s.date = '2026-11-19'`,
      )
      .map((r) => r.detail)
      .join(' | ')
    expect(plan).toMatch(/SEARCH a USING INTEGER PRIMARY KEY/)
    expect(plan).not.toMatch(/SCAN a/)
  })

  it('a device id that merely looks numeric is never given an account’s name', async () => {
    await upsertAndRank(
      db,
      {
        ...GAME,
        date: TODAY,
        clientId: '1'.repeat(8),
        score: 30,
        strength: 70,
      },
      5,
    )
    expect((await topScores(db, { ...GAME, date: TODAY })).rows[0].name).toBe(
      '',
    )
  })

  it('the board shows a signed-in player’s display name and nothing for a device', async () => {
    await upsertAndRank(
      db,
      {
        ...GAME,
        date: TODAY,
        clientId: accountKey(id),
        score: 30,
        strength: 70,
      },
      5,
    )
    await upsertAndRank(
      db,
      { ...GAME, date: TODAY, clientId: DEVICE, score: 38, strength: 92 },
      6,
    )
    expect(await topScores(db, { ...GAME, date: TODAY })).toEqual({
      total: 2,
      rows: [
        { strength: 92, score: 38, name: '' },
        { strength: 70, score: 30, name: 'Spicy Al' },
      ],
    })
  })
})
