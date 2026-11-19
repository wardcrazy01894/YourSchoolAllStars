/**
 * Cross-device sync for a signed-in account (ported from CampusPin Showdown's
 * sync.ts, reshaped for this game's many boards).
 *
 * The server keeps the account's streak in EVERY game (school · sport · mode)
 * and its recent results with their drafts (worker `/me`). This folds them
 * into the device's localStorage, so that on every device signed in to the
 * account:
 *
 * - each streak is the same number — and when the account is new, it is the
 *   LONGER of the streaks its devices already had (each device vouches for
 *   its own local streaks; the server merges them: worker mergeStreaks);
 * - a daily finished on another device shows as finished here, locked, with
 *   its roster and score, instead of being offered again.
 *
 * `planSync` is pure (what should storage become); `syncProgress` does the
 * network and storage around it. What does NOT sync: a draft still in
 * progress (only finished days reach the server), free-play games, and the
 * chosen school.
 */

import {
  fetchMe,
  type Me,
  type ServerDay,
  type ServerStreak,
  type StreakClaim,
} from './account'
import { getDateKey, isValidDateKey } from './daily'
import { submitDaily } from './leaderboard'
import { isGameMode } from './modes'
import {
  dayDiff,
  gameId,
  gapIsAllOutage,
  listDailies,
  listStreaks,
  loadDaily,
  loadOwner,
  loadStreak,
  resetProgressForSignOut,
  saveDailyResult,
  saveOwner,
  writeStreak,
  type GameRef,
  type SavedDaily,
  type Streak,
} from './progress'

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0

/**
 * Two streaks for the same player in the same game, as one — the same rule
 * the server uses (worker mergeStreaks; worker/parity.test.mjs pins the two
 * together): the later last-played day decides; on the same day the longer
 * wins; when the later day continues the earlier one (the next day, or only
 * outage days between) the run is unbroken, so it is at least the earlier
 * count plus the days since; a streak that lapsed before that does not come
 * back, though its best does. Returns `a` ITSELF when nothing changes.
 */
export function mergeStreak(a: Streak, b: Streak): Streak {
  if (b.lastDate === null) {
    return b.max > a.max ? { ...a, max: b.max } : a
  }
  if (a.lastDate === null) {
    return { ...b, max: Math.max(a.max, b.max, b.current) }
  }
  const [older, newer] = a.lastDate <= b.lastDate ? [a, b] : [b, a]
  const diff = dayDiff(older.lastDate!, newer.lastDate!)
  let current: number
  if (diff === 0) current = Math.max(older.current, newer.current)
  else if (diff === 1 || gapIsAllOutage(older.lastDate!, diff))
    current = Math.max(newer.current, older.current + diff)
  else current = newer.current
  const max = Math.max(a.max, b.max, current)
  if (current === a.current && max === a.max && newer.lastDate === a.lastDate)
    return a
  return { current, max, lastDate: newer.lastDate }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const SLUG_RE = /^[a-z0-9-]{1,32}$/

/** The game a server row is for — or null for one this build can't place. */
function gameOf(row: unknown): GameRef | null {
  if (!isRecord(row)) return null
  const { school, sport, mode } = row
  if (typeof school !== 'string' || !SLUG_RE.test(school)) return null
  if (typeof sport !== 'string' || !/^[a-z]{1,32}$/.test(sport)) return null
  if (typeof mode !== 'string' || !isGameMode(mode)) return null
  return { school, sport, mode }
}

/** A server streak in the client's shape — or null when it isn't a real one. */
function streakOf(s: ServerStreak): Streak | null {
  if (
    !isCount(s?.current) ||
    s.current < 1 ||
    !isCount(s.best) ||
    typeof s.lastDate !== 'string' ||
    !isValidDateKey(s.lastDate)
  )
    return null
  return {
    current: s.current,
    max: Math.max(s.best, s.current),
    lastDate: s.lastDate,
  }
}

/**
 * The saved daily behind one of the account's server results — or null when
 * the row carries no draft (played before drafts were stored) or one that
 * isn't well-formed. The roster ids are NOT checked against the dataset here:
 * the locked view already degrades a missing player to an empty slot.
 */
export function savedFromDay(day: ServerDay): SavedDaily | null {
  const d = day?.detail
  if (!isValidDateKey(day?.date) || !isCount(day.score)) return null
  if (!isCount(day.strength) || day.strength > 100) return null
  if (!isRecord(d) || !isRecord(d.playerIds) || typeof d.grade !== 'string')
    return null
  const playerIds: Record<string, string> = {}
  for (const [slot, id] of Object.entries(d.playerIds)) {
    if (typeof id !== 'string') return null
    playerIds[slot] = id
  }
  if (Object.keys(playerIds).length === 0) return null
  const windows: Record<string, { start: number; end: number }> = {}
  if (d.windows != null) {
    if (!isRecord(d.windows)) return null
    for (const [slot, w] of Object.entries(d.windows)) {
      if (!isRecord(w) || !isCount(w.start) || !isCount(w.end)) return null
      windows[slot] = { start: w.start, end: w.end }
    }
  }
  return {
    dateKey: day.date,
    playerIds,
    windows,
    wins: day.score,
    grade: d.grade,
    strength: day.strength,
  }
}

/** The device's local streaks, for the server to fold into the account. */
export function streakClaims(): StreakClaim[] {
  return listStreaks().map(({ school, sport, mode, streak }) => ({
    school,
    sport,
    mode,
    current: streak.current,
    max: streak.max,
    lastDate: streak.lastDate!,
  }))
}

export interface SyncPlan {
  /** Streaks to write (only the ones that change). */
  streaks: (GameRef & { streak: Streak })[]
  /** Days finished on another device, to save + lock here. Oldest first. */
  adopt: (GameRef & { saved: SavedDaily })[]
  /** Today's dailies finished on this device that the account does not have
   *  (in full): played before signing in, offline, or before drafts were
   *  stored. */
  unsent: (GameRef & { saved: SavedDaily })[]
}

export function planSync(input: {
  me: Pick<Me, 'streaks' | 'days'>
  /** The real current day (ET) — the only day handed over. */
  todayKey: string
  streakOf: (g: GameRef) => Streak
  dailyOf: (g: GameRef, dateKey: string) => SavedDaily | null
  /** Every daily saved on this device for `todayKey`. */
  localToday: (GameRef & { saved: SavedDaily })[]
}): SyncPlan {
  const { me, todayKey } = input
  const plan: SyncPlan = { streaks: [], adopt: [], unsent: [] }

  for (const s of Array.isArray(me?.streaks) ? me.streaks : []) {
    const game = gameOf(s)
    const theirs = game && streakOf(s)
    if (!game || !theirs) continue
    const mine = input.streakOf(game)
    const merged = mergeStreak(mine, theirs)
    if (merged !== mine) plan.streaks.push({ ...game, streak: merged })
  }

  // The account's days, by game + date; one with a draft is "complete".
  const complete = new Set<string>()
  const days = (Array.isArray(me?.days) ? me.days : [])
    .map((day) => ({ game: gameOf(day), day }))
    .filter((d): d is { game: GameRef; day: ServerDay } => d.game !== null)
    .sort((a, b) => String(a.day.date).localeCompare(String(b.day.date)))
  for (const { game, day } of days) {
    const saved = savedFromDay(day)
    if (!saved) continue
    complete.add(`${gameId(game)}|${saved.dateKey}`)
    // Never swap out a day this device finished itself.
    if (!input.dailyOf(game, saved.dateKey)) plan.adopt.push({ ...game, saved })
  }

  for (const local of input.localToday) {
    // A save from before strength existed can't be ranked — nothing to send.
    if (local.saved.strength === undefined) continue
    if (!complete.has(`${gameId(local)}|${todayKey}`)) plan.unsent.push(local)
  }
  return plan
}

export interface SyncResult {
  /** 'signed-out': the server no longer knows this token. 'offline': no
   *  answer worth acting on (network, outage, a worker without accounts). */
  status: 'ok' | 'signed-out' | 'offline'
  /** Games (gameId) whose streak or saved daily changed on this device — a
   *  mounted screen for one of them must re-read storage. */
  changed: string[]
  /** The device's progress was wiped first (it belonged to another account):
   *  EVERY mounted screen must re-read storage. */
  reset: boolean
  /** The account as the server has it (a name changed on another device). */
  username?: string
  name?: string
}

/** Hand-overs already tried this page load: one attempt each, so a day the
 *  server refuses is not re-posted every time the tab comes back. A reload
 *  tries again. */
const attempted = new Set<string>()

/**
 * Ask the server what the account has and apply it to this device.
 *
 * The device remembers which account its progress was last synced to
 * (`ysas:owner`). If that is a DIFFERENT account — a shared device whose
 * previous session the server ended, so nothing was wiped — the progress is
 * reset first: those streaks and finished days are someone else's and must
 * not be claimed for this account.
 */
export async function syncProgress(input: {
  token: string
  /** The signed-in account's username. */
  username: string
}): Promise<SyncResult> {
  const { token, username } = input
  const owner = loadOwner()
  const reset = owner !== null && owner !== username
  if (reset) {
    console.info('sync: progress belonged to another account — reset')
    resetProgressForSignOut()
  }
  const me = await fetchMe(token, streakClaims())
  if (!me.ok)
    return {
      status: me.status === 401 ? 'signed-out' : 'offline',
      changed: [],
      reset,
    }

  // Storage is read AFTER the await: the player may have finished a day while
  // the request was in flight.
  const todayKey = getDateKey()
  const plan = planSync({
    me,
    todayKey,
    streakOf: (g) => loadStreak(g.school, g.sport, g.mode),
    dailyOf: (g, dateKey) => loadDaily(g.school, g.sport, dateKey, g.mode),
    localToday: listDailies(todayKey),
  })
  const changed = new Set<string>()
  for (const s of plan.streaks) {
    writeStreak(s.school, s.sport, s.streak, s.mode)
    changed.add(gameId(s))
  }
  for (const a of plan.adopt) {
    // Same bookkeeping as finishing it here. The streak normally already
    // counts the day (it came from the server, just above); if the server's
    // best-effort streak write missed it, this bumps it exactly once.
    saveDailyResult(a.school, a.sport, a.saved, { mode: a.mode })
    changed.add(gameId(a))
  }
  saveOwner(username)

  for (const u of plan.unsent) {
    const key = `${token}|${gameId(u)}|${todayKey}`
    if (attempted.has(key)) continue
    attempted.add(key)
    const before = loadStreak(u.school, u.sport, u.mode)
    const standing = await submitDaily({
      school: u.school,
      sport: u.sport,
      mode: u.mode,
      dateKey: todayKey,
      score: u.saved.wins,
      strength: u.saved.strength ?? 0,
      seed: before,
      official: true,
      saved: u.saved,
      token,
      force: true,
    })
    // submitDaily mirrors the account's streak into storage.
    const s = standing?.streak
    if (s && (s.current !== before.current || s.max !== before.max))
      changed.add(gameId(u))
  }
  if (changed.size > 0 || reset)
    console.info('sync: applied account progress', {
      changed: [...changed],
      reset,
    })
  return {
    status: 'ok',
    changed: [...changed],
    reset,
    username: me.username,
    name: me.name,
  }
}
