/**
 * Pure helpers + constants for the YourSchoolAllStars leaderboard Worker.
 *
 * These live in a SEPARATE module (not the Worker entry) on purpose: the Workers
 * runtime enumerates the *entry* module's named exports and rejects any that
 * aren't a function/ExportedHandler — so an `export const` in the entry crashes
 * the worker at boot. Keeping constants + validation here lets the entry
 * (leaderboard.mjs) export only `default`, and keeps everything unit testable
 * without a Worker or a database (leaderboard.test.mjs).
 *
 * Ported from KnowYourCity's worker (same design, own deployment): a second,
 * independent Worker + D1 so neither game depends on the other's resources.
 */

/** The game's single timezone — every dateKey is an ET calendar day. Mirrors
 *  the client's GAME_TIMEZONE (src/lib/daily.ts). */
export const GAME_TZ = 'America/New_York'

/**
 * Sport → max score. `score` is the projected-wins number the app shows:
 * basketball rates over a 40-game season (src/lib/rating.ts BBALL_GAMES), football over 16
 * (src/lib/football-rating.ts FB_GAMES). Keep in step with the client.
 */
export const SPORT_MAX_SCORE = { basketball: 40, football: 16 }

/** Team strength ("overall") is a 0..100 rating in both sports. */
export const MAX_STRENGTH = 100

/**
 * The client's strength → projected-wins curve, shared by both sports
 * (src/lib/rating.ts projectedWins, src/lib/football-rating.ts fbProjectedWins):
 * a logistic around WIN_PIVOT, with a displayed (rounded) overall of
 * UNDEFEATED_STRENGTH+ running the table and one below WINLESS_STRENGTH going
 * winless. worker/parity.test.mjs pins these to the client's constants.
 */
export const WIN_PIVOT = 57
export const WIN_SPREAD = 7.5
export const UNDEFEATED_STRENGTH = 85
export const WINLESS_STRENGTH = 30

/** Projected wins out of `games` for a displayed (integer) overall. */
export function expectedWins(strength, games) {
  if (strength >= UNDEFEATED_STRENGTH) return games
  if (strength < WINLESS_STRENGTH) return 0
  const p = 1 / (1 + Math.exp(-(strength - WIN_PIVOT) / WIN_SPREAD))
  return Math.round(p * games)
}

/**
 * Could a real client have produced `score` wins from a displayed overall of
 * `strength`? The overrides are exact; in the logistic middle the client rates
 * the UNROUNDED strength (up to ±0.5 away, ≤0.67 wins at the curve's steepest),
 * so ±1 win covers it. Not anti-cheat — just stops a hand-made
 * `{strength: 100, score: 3}` or a 0-overall 40-0 from reaching the board.
 */
export function isPlausibleScore(score, strength, games) {
  if (strength >= UNDEFEATED_STRENGTH) return score === games
  if (strength < WINLESS_STRENGTH) return score === 0
  return Math.abs(score - expectedWins(strength, games)) <= 1
}

/**
 * The daily (one-shot, streak-bearing) modes. Free-play modes never submit
 * (they're replayable, so a score means nothing on a daily board). Keep in step
 * with src/lib/modes.ts `daily: true` entries.
 */
export const DAILY_MODES = ['daily', 'daily-iq']

/**
 * Known school ids — the real schools (src/schools.ts) plus the two
 * cross-school sentinels the app uses as the streak namespace for its "full"
 * modes (src/lib/full.ts FULL_BBALL_ID / FULL_FB_ID). The worker rejects anything
 * else so a junk slug can't seed its own board. Keep in step when a school is
 * added (worker/parity.test.mjs checks it against src/schools.ts).
 */
export const SCHOOLS = [
  'michigan',
  'unc',
  'florida',
  'vt',
  'pitt',
  'vcu',
  'full-basketball',
  'full-football',
]

/**
 * Days (ET dateKeys) on which the site was unreachable, so NOBODY could play.
 * Mirrors the client's OUTAGE_DAYS (src/lib/progress.ts) — keep the two lists
 * identical so a device's local streak and its server row agree.
 *
 * - 2026-10-07: GitHub Pages offline all day (hosting account suspended).
 */
export const OUTAGE_DAYS = ['2026-10-07']

/** Upper bound for a client-supplied streak seed (sanity only — anti-cheat is a
 *  documented non-goal; this just keeps an absurd value out of the table). */
export const MAX_SEED_STREAK = 10_000

/** ET calendar day ("YYYY-MM-DD") for `now` — mirrors the client's getDateKey
 *  (src/lib/daily.ts) so client and server agree on the rollover. */
export function dateKeyFor(now, timeZone = GAME_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

/**
 * The set of ET date keys we accept for `now`: yesterday, today, and tomorrow.
 * The ±1-day window tolerates clock skew, the midnight rollover (a player who
 * started before and finished after), and DST transitions, while still
 * rejecting attempts to seed arbitrary days.
 */
export function validDateKeys(now, timeZone = GAME_TZ) {
  const DAY = 86_400_000
  return new Set([
    dateKeyFor(new Date(now.getTime() - DAY), timeZone),
    dateKeyFor(now, timeZone),
    dateKeyFor(new Date(now.getTime() + DAY), timeZone),
  ])
}

/** True for a real integer in [0, max]. Rejects NaN/floats/strings. */
export function isValidScore(score, max) {
  return Number.isInteger(score) && score >= 0 && score <= max
}

/** Anonymous device id shape: UUID-ish, kept short and charset-safe. */
export function isValidClientId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
}

/** True if `key` is a REAL calendar date in YYYY-MM-DD form (rejects
 *  2026-99-99 etc. via a UTC round-trip). */
export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const d = new Date(key + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key
}

/** Max rows the view endpoint returns — caps the read so a busy day stays cheap
 *  and the anonymous list can't be scraped wholesale. */
export const TOP_LIMIT = 100

/**
 * Validate the (school, sport, mode) triple that keys every board + streak.
 * Returns `{ ok: true, value }` or `{ ok: false, status, error }`. Pure.
 */
export function validateGame(q) {
  const school = String(q?.school ?? '')
  if (!SCHOOLS.includes(school))
    return { ok: false, status: 400, error: 'unknown school' }
  const sport = String(q?.sport ?? '')
  if (!(sport in SPORT_MAX_SCORE))
    return { ok: false, status: 400, error: 'unknown sport' }
  const mode = String(q?.mode ?? '')
  if (!DAILY_MODES.includes(mode))
    return { ok: false, status: 400, error: 'unknown mode' }
  return { ok: true, value: { school, sport, mode } }
}

/**
 * Validate a leaderboard VIEW query (read-only). Any real past/today/future date
 * is allowed (read-only, capped), but the game must be known. Pure.
 */
export function validateView(query) {
  const g = validateGame(query)
  if (!g.ok) return { ok: false, status: g.status, error: g.error }
  const date = String(query?.date ?? '')
  if (!isValidDateKey(date))
    return { ok: false, status: 400, error: 'invalid date' }
  return { ok: true, value: { ...g.value, date } }
}

/**
 * Validate an OPTIONAL client-held streak (`{ current, max, lastDate }`) sent
 * with a submission — see updateStreak for how it's used. ADVISORY: a missing,
 * empty, or malformed seed simply becomes `null`; it never fails the score.
 * (The client always builds it from a typed Streak, so "malformed" means a
 * hand-crafted request — dropping it is the right outcome.)
 *
 * `lastDate` may be up to the LATEST day the submit window accepts for `now`
 * (tomorrow, ET): that keeps the legitimate "old tab finishing yesterday after
 * today was played" case, while a seed dated further ahead (a device clock
 * once set years forward) is dropped — otherwise it would win on `current`,
 * park `last_played_date` in the future, and freeze the row behind the
 * backwards guard forever.
 */
export function validateSeed(seed, now = new Date()) {
  const none = { ok: true, value: null }
  if (seed == null || typeof seed !== 'object') return none
  const { current, max, lastDate } = seed
  const okInt = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_SEED_STREAK
  if (!okInt(current) || !okInt(max) || max < current) return none
  if (lastDate !== null && !isValidDateKey(lastDate)) return none
  // Nothing played yet is the same as no seed.
  if (lastDate === null || current === 0) return none
  const latest = [...validDateKeys(now)].sort().pop()
  if (lastDate > latest) return none
  return { ok: true, value: { current, max, lastDate } }
}

/**
 * Validate + normalize a submission against the server's clock. Returns
 * `{ ok: true, value }` or `{ ok: false, status, error }`. Pure given `now`, so
 * every branch (unknown game, out-of-window date, bad score/id/seed) is
 * unit-testable without a Worker or a database.
 */
export function validateSubmission(body, now = new Date()) {
  const g = validateGame(body)
  if (!g.ok) return { ok: false, status: g.status, error: g.error }
  const { school, sport, mode } = g.value

  const date = String(body?.date ?? '')
  if (!validDateKeys(now).has(date))
    return { ok: false, status: 400, error: 'date out of range' }

  const score = body?.score
  if (!isValidScore(score, SPORT_MAX_SCORE[sport]))
    return { ok: false, status: 400, error: 'invalid score' }

  const clientId = body?.clientId
  if (!isValidClientId(clientId))
    return { ok: false, status: 400, error: 'invalid clientId' }

  // Team strength, the 0..100 "overall" — what the leaderboard ranks by.
  // Optional only for old clients (absent → null, ranks as 0); when present it
  // must be a real integer in range.
  const strength = body?.strength == null ? null : body.strength
  if (strength !== null && !isValidScore(strength, MAX_STRENGTH))
    return { ok: false, status: 400, error: 'invalid strength' }
  if (
    strength !== null &&
    !isPlausibleScore(score, strength, SPORT_MAX_SCORE[sport])
  )
    return { ok: false, status: 400, error: 'score does not match strength' }

  const seed = validateSeed(body?.seed, now).value

  return {
    ok: true,
    value: { school, sport, mode, date, score, strength, clientId, seed },
  }
}

/**
 * UPSERT the device's result for a (game, date) and read back the standing in
 * one atomic D1 batch.
 *
 * Ordering is by (strength, score) compared IN THAT ORDER — the 0..100 overall
 * first, projected wins as the tiebreak — and the SAME key drives the keep-max,
 * the standing and the board, so "Xth of Y" always agrees with the board order.
 * Keep-max keeps the better PAIR (never a mix of one submit's strength with
 * another's wins). NULL strength (rows from before the column existed, or an
 * old client) reads as 0, so an all-NULL day still ranks by wins exactly as it
 * did before — the deploy window is harmless. Ties share a rank
 * (strictly-greater counting), rank = better + 1; `total` is the number of
 * devices on the day's board.
 */
export async function upsertAndRank(
  db,
  { school, sport, mode, date, clientId, score, strength = null },
  now,
) {
  const upsert = db
    .prepare(
      `INSERT INTO scores (school, sport, mode, date, client_id, score, strength, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(school, sport, mode, date, client_id) DO UPDATE SET
         score = CASE WHEN (COALESCE(excluded.strength, 0), excluded.score)
                           > (COALESCE(strength, 0), score)
                      THEN excluded.score ELSE score END,
         -- NOTE: a re-posted legacy row's NULL becomes 0 here, so NULL does
         -- NOT reliably mean "written before the migration"; every read
         -- COALESCEs and nothing distinguishes the two.
         strength = CASE WHEN (COALESCE(excluded.strength, 0), excluded.score)
                              > (COALESCE(strength, 0), score)
                         THEN COALESCE(excluded.strength, 0)
                         ELSE COALESCE(strength, 0) END,
         updated_at = excluded.updated_at`,
    )
    .bind(school, sport, mode, date, clientId, score, strength, now)
  const standing = db
    .prepare(
      `WITH me AS (
         SELECT COALESCE(strength, 0) AS s, score AS w FROM scores
         WHERE school = ?1 AND sport = ?2 AND mode = ?3
           AND date = ?4 AND client_id = ?5)
       SELECT
         (SELECT COUNT(*) FROM scores, me
            WHERE school = ?1 AND sport = ?2 AND mode = ?3 AND date = ?4
              AND (COALESCE(strength, 0), score) > (me.s, me.w)
         ) AS better,
         (SELECT COUNT(*) FROM scores
            WHERE school = ?1 AND sport = ?2 AND mode = ?3 AND date = ?4
         ) AS total`,
    )
    .bind(school, sport, mode, date, clientId)
  const results = await db.batch([upsert, standing])
  const row = results[1].results[0]
  return { rank: Number(row.better) + 1, total: Number(row.total) }
}

/**
 * How long a day's scores are kept. Old daily boards have no value once the day
 * passes, so a scheduled prune (see the worker's `scheduled` handler) deletes
 * rows older than this, keeping the table bounded no matter how busy it gets.
 * NOTE: this only prunes `scores`; per-player streaks live in their own table so
 * a long streak survives even after its early daily rows are pruned.
 */
export const RETENTION_DAYS = 90

/**
 * The oldest date key to KEEP — anything strictly before this is pruned. Uses a
 * UTC-based offset; a few hours of timezone slack is irrelevant at a 90-day
 * horizon, and date keys are ISO strings so a lexical `<` compares correctly.
 * Pure given `now`.
 */
export function cutoffDateKey(now, days = RETENTION_DAYS) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Delete daily scores older than `cutoff` (YYYY-MM-DD). Returns rows removed. */
export async function pruneOldScores(db, cutoff) {
  const res = await db
    .prepare(`DELETE FROM scores WHERE date < ?1`)
    .bind(cutoff)
    .run()
  return res?.meta?.changes ?? 0
}

/** Whole-day difference between two 'YYYY-MM-DD' keys (b − a). Mirrors the
 *  client's dayDiff (src/lib/progress.ts). */
export function dayDiff(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** The 'YYYY-MM-DD' key `n` days after `dateKey`. */
export function addDays(dateKey, n) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** True when every one of the `diff - 1` days strictly after `from` is a listed
 *  outage day, i.e. the gap consists only of days nobody could have played. */
function gapIsAllOutage(from, diff) {
  for (let n = 1; n < diff; n++) {
    if (!OUTAGE_DAYS.includes(addDays(from, n))) return false
  }
  return true
}

/**
 * Advance a per-player streak to account for playing `dateKey`. Mirrors the
 * client's nextStreak (src/lib/progress.ts) EXACTLY — same-day replay keeps the
 * count, the previous day increments, a gap made only of OUTAGE_DAYS is carried
 * and each outage day credited, any other gap resets to 1, and a date BEFORE
 * the stored last play leaves the row untouched. `best` is the running max.
 * Pure — `prev` is the stored row (or null for a first-ever play).
 */
export function advanceStreak(prev, dateKey) {
  if (!prev) return { current: 1, best: 1, last_played_date: dateKey }
  if (prev.last_played_date === dateKey) return prev // replay safety
  const diff = dayDiff(prev.last_played_date, dateKey)
  if (diff < 0) return prev // backwards — never roll last_played_date back
  const continues = diff === 1 || gapIsAllOutage(prev.last_played_date, diff)
  const current = continues ? prev.current + diff : 1
  return {
    current,
    best: Math.max(prev.best ?? 0, current),
    last_played_date: dateKey,
  }
}

/**
 * Read → reconcile → advance → upsert the player's streak for (game, client_id)
 * on a daily submission. Returns `{ current, best, lastDate }`.
 *
 * RECONCILE: the submission carries `seed`, the streak the client holds in
 * localStorage. Both the stored row (if any) and the seed are advanced to the
 * submitted day and the BETTER one wins (higher `current`; a tie keeps the
 * stored row — unless the seed is dated AFTER the submit, then the seed wins
 * so `last_played_date` never rolls back; `best` is the max of both). This one rule covers every case:
 *   - first-ever submit → no row, the seed bootstraps, so a streak earned
 *     before this table existed carries over;
 *   - missed submits (offline / 503 / 429) → the stored row is stale and would
 *     reset, but the seed carried the real count → the seed wins, so the
 *     worker can never destroy a streak the player legitimately earned;
 *   - server-side REPAIR (an operator UPDATE) → the stored row is better than
 *     a locally-reset seed → the repair wins and the client mirrors it.
 * The seed is trusted exactly as much as the bootstrap already was (anti-cheat
 * is a documented non-goal for an anonymous board).
 *
 * Separate from the score write so a streak hiccup never blocks the score;
 * SQLite serializes the read/write and a same-device double-submit converges to
 * the same value.
 */
export async function updateStreak(
  db,
  { school, sport, mode, clientId, date, seed },
  now,
) {
  const stored = await db
    .prepare(
      `SELECT current, best, last_played_date FROM streaks
       WHERE school = ?1 AND sport = ?2 AND mode = ?3 AND client_id = ?4`,
    )
    .bind(school, sport, mode, clientId)
    .first()
  const fromSeed = seed
    ? { current: seed.current, best: seed.max, last_played_date: seed.lastDate }
    : null
  const next = reconcileStreak(stored, fromSeed, date)
  await db
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
      school,
      sport,
      mode,
      clientId,
      next.current,
      next.best,
      next.last_played_date,
      now,
    )
    .run()
  return {
    current: next.current,
    best: next.best,
    lastDate: next.last_played_date,
  }
}

/**
 * Advance both candidate rows to `dateKey` and keep the better one (see
 * updateStreak). Pure. Either side may be null; both null = first play.
 */
export function reconcileStreak(stored, fromSeed, dateKey) {
  const a = advanceStreak(stored, dateKey)
  if (!fromSeed) return a
  // A submit dated BEFORE the stored row's last play (old tab, or two requests
  // racing) must not let the seed roll `last_played_date` backwards — the
  // stored row stands, exactly as advanceStreak's own backwards guard does.
  if (stored && dateKey < stored.last_played_date) return a
  const b = advanceStreak(fromSeed, dateKey)
  // Ties keep the stored row — unless the seed is AHEAD of this submit (a late
  // finish of yesterday's tab after a lost submit for today): then the seed
  // wins, so last_played_date never rolls back behind what the device played.
  const winner =
    b.current > a.current ||
    (b.current === a.current && b.last_played_date > a.last_played_date)
      ? b
      : a
  // `winner.current` is in the max so a repair that raised `current` without
  // `best` still reads best ≥ current (advanceStreak returns prev unchanged on
  // a same-day / backwards submit, so it wouldn't fix that up itself).
  return { ...winner, best: Math.max(a.best, b.best, winner.current) }
}

/**
 * Read the day's board — one `{ strength, score }` row per device, best overall
 * first (then most wins), capped at TOP_LIMIT — plus the total entry count for
 * a game + date. Anonymous: numbers only — no ids, no names. The client
 * assigns display ranks (ties share a rank) and flags its own row.
 */
export async function topScores(
  db,
  { school, sport, mode, date },
  limit = TOP_LIMIT,
) {
  const list = db
    .prepare(
      `SELECT COALESCE(strength, 0) AS strength, score FROM scores
       WHERE school = ?1 AND sport = ?2 AND mode = ?3 AND date = ?4
       ORDER BY COALESCE(strength, 0) DESC, score DESC LIMIT ?5`,
    )
    .bind(school, sport, mode, date, limit)
  const count = db
    .prepare(
      `SELECT COUNT(*) AS total FROM scores
       WHERE school = ?1 AND sport = ?2 AND mode = ?3 AND date = ?4`,
    )
    .bind(school, sport, mode, date)
  const [listRes, countRes] = await db.batch([list, count])
  return {
    total: Number(countRes.results[0].total) || 0,
    rows: listRes.results.map((r) => ({
      strength: Number(r.strength),
      score: Number(r.score),
    })),
  }
}
