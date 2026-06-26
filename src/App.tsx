import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { BBALL_POSITIONS, windowLabel, eligiblePositions } from './types'
import type {
  BballPlayer,
  BballPosition,
  BballSeason,
  BballStats,
  YearWindow,
} from './types'
import {
  getSchool,
  applyTheme,
  DEFAULT_SCHOOL_ID,
  SCHOOLS,
  type School,
} from './schools'
import { buildRollingWindows, datasetMaxYear } from './lib/windows'
import {
  DAILY_BBALL_ERAS,
  getDateKey,
  isValidDateKey,
  seedFor,
  generateSpins,
} from './lib/daily'
import {
  initDraft,
  draftToSlot,
  skip,
  canSkip,
  safeSkipsLeft,
  isComplete,
  isPickable,
  currentWindow,
  playersThisEra,
  eligibleOpenSlots,
  type DraftState,
} from './lib/game'
import {
  playerRating,
  bestSeason,
  seasonForWindow,
  recordLabel,
} from './lib/rating'
import {
  evaluateRoster,
  savedDailyFrom,
  rosterFromSaved,
  windowByPosition,
} from './lib/result'
import {
  loadDaily,
  loadStreak,
  saveDailyResult,
  type Streak,
  type SavedDaily,
} from './lib/progress'
import { buildShareString } from './lib/share'
import { setupAutoUpdate } from './lib/version'

const SPORT = 'basketball'

const GAMES = 40

type StatKey = keyof BballStats
const STAT_COLS: { key: StatKey; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
]

/** The season to show/rate for a player, given the era they're seen in. */
function seasonFor(p: BballPlayer, w?: YearWindow): BballSeason | null {
  return w ? seasonForWindow(p, w) : bestSeason(p)
}

/** Stat cell: a missing (unpublished) value shows as an em dash, not 0.0. */
function fmtStat(season: BballSeason | null, key: StatKey): string {
  const v = season?.stats[key]
  return v === undefined ? '—' : v.toFixed(1)
}

/** Year chip from a season, e.g. "'13"; em dash when there's no season. */
function fmtYear(season: BballSeason | null): string {
  return season ? `'${String(season.year).slice(2)}` : '—'
}

const SCHOOL_STORAGE_KEY = 'ysas:school'

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

function activeDateKey(): string {
  const q = param('date')
  if (q && isValidDateKey(q)) return q
  return getDateKey()
}

function initialSchoolId(): string | null {
  const q = param('school')
  if (q && getSchool(q)?.available) return q
  const saved = localStorage.getItem(SCHOOL_STORAGE_KEY)
  if (saved && getSchool(saved)?.available) return saved
  return null
}

export default function App() {
  const [schoolId, setSchoolId] = useState<string | null>(initialSchoolId)
  const school = getSchool(schoolId ?? DEFAULT_SCHOOL_ID)!

  useEffect(() => {
    applyTheme(school.theme)
  }, [school])

  useEffect(() => setupAutoUpdate(), [])

  function chooseSchool(id: string) {
    localStorage.setItem(SCHOOL_STORAGE_KEY, id)
    setSchoolId(id)
  }

  if (!schoolId) return <Picker onPick={chooseSchool} />
  // key={school.id} makes the per-school remount explicit: Game's useState
  // initializers (phase/state/streak below) all derive from the loaded save for
  // THIS school, so a school change must start a fresh Game, not reuse stale state.
  return (
    <Game key={school.id} school={school} onExit={() => setSchoolId(null)} />
  )
}

function Picker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="puck">🏀</span>
          <div>
            YourSchoolAllStars
            <small>Pick your school</small>
          </div>
        </div>
      </header>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1>Build your school's all-time team.</h1>
        <p>
          Spin a 4-year window, draft a starting five, and see how close to a
          perfect season you can get. Choose a school to start.
        </p>
      </section>
      <div className="picker">
        {SCHOOLS.map((s) => (
          <div
            key={s.id}
            className={`school-card${s.available ? '' : ' soon'}`}
            style={{
              background: `linear-gradient(160deg, ${s.theme.brand}, ${s.theme.brand2})`,
              boxShadow: s.available
                ? `inset 0 0 0 2px ${s.theme.accent}55`
                : 'none',
            }}
            onClick={() => s.available && onPick(s.id)}
            role={s.available ? 'button' : undefined}
            aria-disabled={!s.available}
          >
            {!s.available && <span className="soon-chip">Coming soon</span>}
            <div
              className="crest"
              style={{ background: s.theme.accent, color: s.theme.brand }}
            >
              {s.emoji}
            </div>
            <div className="sc-name">{s.name}</div>
            <div className="sc-mascot">{s.mascot}</div>
          </div>
        ))}
      </div>
      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by any
        university. Player data curated from public sources.
      </footer>
    </div>
  )
}

function Game({ school, onExit }: { school: School; onExit: () => void }) {
  // Memoized so its reference is stable across renders — it feeds the `windows`
  // useMemo below, which would otherwise recompute every render on a fresh `[]`.
  const players = useMemo(
    () => school.basketball?.players ?? [],
    [school.basketball],
  )
  const provisional = school.basketball?.provisional ?? false

  const dateKey = useMemo(activeDateKey, [])
  const seed = useMemo(
    () => seedFor(dateKey, `${school.id}:basketball`),
    [dateKey, school.id],
  )
  // Data-driven ROLLING wheel (#16): overlapping 4-year eras from 1994 up to the
  // dataset's most recent season, so the wheel grows itself as new seasons land
  // (no hand-maintained fixed block list). A data-less school yields no windows;
  // generateSpins then returns [] (dead-era safety net) rather than undefined spins.
  const windows = useMemo(() => {
    const maxYear = datasetMaxYear(players)
    return maxYear === null ? [] : buildRollingWindows(1994, maxYear, 4)
  }, [players])
  const spins = useMemo(
    () => generateSpins(seed, DAILY_BBALL_ERAS, windows),
    [seed, windows],
  )

  // The daily is a ONE-SHOT: if today's result is already saved, open straight to
  // the locked Results (reconstructed from the save) instead of letting them
  // replay. `?date=` playtest days hydrate the same way, per day. Read ONCE via a
  // useState initializer — it's a side-effectful localStorage read, not a derived
  // value, so it must not live in a useMemo (which React may recompute).
  const [savedToday] = useState(() => loadDaily(school.id, SPORT, dateKey))

  const [phase, setPhase] = useState<'landing' | 'playing' | 'done'>(
    savedToday ? 'done' : 'landing',
  )
  const [state, setState] = useState<DraftState>(() =>
    savedToday ? rosterFromSaved(savedToday, players) : initDraft(spins),
  )
  const [streak, setStreak] = useState<Streak>(() =>
    loadStreak(school.id, SPORT),
  )
  // The persisted result for the locked view. Carries the EARNED wins/grade so a
  // returning player sees what they actually scored, even if the dataset's stats
  // were corrected since (the live re-rate would otherwise drift). Null until done.
  const [result, setResult] = useState<SavedDaily | null>(savedToday)
  // Already in the books on load (a returning visit), vs a fresh finish this
  // session — drives whether Results shows the "come back tomorrow" banner.
  const returning = savedToday !== null

  function start() {
    // Dead-era safety net (UI half): an empty wheel ⇒ no spins ⇒ an
    // already-complete draft that can never advance to Results. Don't enter the
    // playing phase at all — the Landing button is also disabled in this case.
    if (spins.length === 0) return
    setState(initDraft(spins))
    setPhase('playing')
  }

  function advance(next: DraftState) {
    setState(next)
    if (isComplete(next)) finish(next)
  }

  function finish(s: DraftState) {
    setPhase('done')
    const saved = savedDailyFrom(s, dateKey, GAMES)
    setResult(saved)
    // Persist + advance the per-device streak. saveDailyResult is idempotent and
    // fail-safe. Only a REAL today play moves the streak — `?date=` playtest days
    // save + lock but stay streak-neutral so testing a past/future day can't
    // contaminate it.
    const updated = saveDailyResult(school.id, SPORT, saved, {
      advanceStreak: dateKey === getDateKey(),
    })
    setStreak(updated)
    if (
      saved.grade === 'PERFECT' ||
      saved.grade === 'HISTORIC' ||
      saved.grade === 'ELITE'
    ) {
      confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } })
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="puck">🏀</span>
          <div>
            YourSchoolAllStars
            <small>
              {school.name} Basketball{provisional ? ' · provisional data' : ''}
            </small>
          </div>
        </div>
        <button className="btn ghost" onClick={onExit}>
          ↺ Switch school
        </button>
      </header>

      {phase === 'landing' && (
        <Landing
          school={school}
          dateKey={dateKey}
          playable={spins.length > 0}
          streak={streak}
          onStart={start}
        />
      )}
      {phase === 'playing' && (
        <Playing
          players={players}
          state={state}
          wheel={windows}
          onAdvance={advance}
        />
      )}
      {phase === 'done' && (
        <Results
          school={school}
          state={state}
          dateKey={dateKey}
          streak={streak}
          saved={result}
          returning={returning}
        />
      )}

      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function StreakChips({ streak }: { streak: Streak }) {
  if (streak.max === 0) return null // never completed a day — nothing to show
  return (
    <div className="streaks">
      <span className="streak-chip" title="Consecutive days played">
        🔥 {streak.current} day{streak.current === 1 ? '' : 's'}
      </span>
      <span className="streak-chip" title="Your longest streak">
        🏆 best {streak.max}
      </span>
    </div>
  )
}

function Landing({
  school,
  dateKey,
  playable,
  streak,
  onStart,
}: {
  school: School
  dateKey: string
  /** False when this school has no draftable wheel (no basketball data yet). */
  playable: boolean
  streak: Streak
  onStart: () => void
}) {
  return (
    <section className="hero">
      <span className="banner">🗓️ Daily Challenge · {dateKey}</span>
      <h1>Build {school.name}'s all-time five.</h1>
      <p>
        Six eras spin in a fixed order today — the same for everyone. Draft a
        starting five (PG, SG, SF, PF, C): pick a player, then choose an open
        slot. You can <strong>skip one era</strong>. How close to a perfect{' '}
        <strong>40&ndash;0</strong> can you get?
      </p>
      <StreakChips streak={streak} />
      {playable ? (
        <button className="btn primary" onClick={onStart}>
          ▶ Play Today's Challenge
        </button>
      ) : (
        <p className="muted">
          No {school.name} basketball data yet — check back soon.
        </p>
      )}
    </section>
  )
}

function RosterRail({
  slots,
  windows,
  targetable,
  onPlace,
}: {
  slots: DraftState['slots']
  /** Era each filled slot was drafted from, so its rating matches the pick. */
  windows?: Partial<Record<BballPosition, YearWindow>>
  targetable?: BballPosition[]
  onPlace?: (pos: BballPosition) => void
}) {
  const targets = new Set(targetable ?? [])
  return (
    <div className="rail">
      {BBALL_POSITIONS.map((pos) => {
        const p = slots[pos]
        const isTarget = targets.has(pos)
        return (
          <div
            key={pos}
            className={`slot ${p ? 'filled' : 'open'}${isTarget ? ' target' : ''}`}
            onClick={() => isTarget && onPlace?.(pos)}
            role={isTarget ? 'button' : undefined}
          >
            <div className="pos">{pos}</div>
            {p ? (
              <>
                <div className="pname">{p.name}</div>
                <div className="prate">{playerRating(p, windows?.[pos])}</div>
              </>
            ) : (
              <div className="pname muted">
                {isTarget ? 'tap to place' : '—'}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Playing({
  players,
  state,
  wheel,
  onAdvance,
}: {
  players: BballPlayer[]
  state: DraftState
  /** The full rolling era wheel — the reel animation flashes labels from it. */
  wheel: YearWindow[]
  onAdvance: (s: DraftState) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [reelLabel, setReelLabel] = useState('🎰')
  const intervalRef = useRef<number | undefined>(undefined)
  const timeoutRef = useRef<number | undefined>(undefined)
  const w = currentWindow(state)
  const era = playersThisEra(state, players)
  const selected = selectedId
    ? (era.find((p) => p.id === selectedId) ?? null)
    : null
  const targetSlots = selected ? eligibleOpenSlots(state, selected) : []
  const skipsLeft = safeSkipsLeft(state)

  // Group players by primary position, sorted within group by IN-WINDOW points.
  const ptsIn = (p: BballPlayer) => seasonFor(p, w ?? undefined)?.stats.pts ?? 0
  const groups = BBALL_POSITIONS.map((pos) => ({
    pos,
    filled: state.slots[pos] !== null,
    players: era
      .filter((p) => p.position === pos)
      .sort((a, b) => ptsIn(b) - ptsIn(a)),
  })).filter((g) => g.players.length > 0)

  function place(pos: BballPosition) {
    if (!selected) return
    onAdvance(draftToSlot(state, selected, pos))
    setSelectedId(null)
  }

  function selectPlayer(p: BballPlayer) {
    if (!isPickable(state, p)) return
    const slots = eligibleOpenSlots(state, p)
    if (slots.length === 1) {
      onAdvance(draftToSlot(state, p, slots[0]))
      setSelectedId(null)
    } else {
      setSelectedId(p.id) // multi-slot: let them choose in the rail
    }
  }

  // Each new era hides the pool until the player spins the reel for it. Use a
  // LAYOUT effect so the reset lands BEFORE the browser paints — otherwise the
  // next era's pool flashes for a frame (and leaks the upcoming lineup) because
  // `reveal` is still true on the first render after the cursor advances.
  useLayoutEffect(() => {
    setReveal(false)
    setSpinning(false)
    setSelectedId(null)
    setReelLabel('🎰')
    return () => {
      window.clearInterval(intervalRef.current)
      window.clearTimeout(timeoutRef.current)
    }
  }, [state.cursor])

  function spin() {
    if (!w || spinning || reveal) return
    setSpinning(true)
    intervalRef.current = window.setInterval(() => {
      // `spin()` already returned early on `!w`. `w` is null either when the era
      // sequence is exhausted (game complete → phase flips to 'done', unmounting
      // this) or when spins is empty (blocked upstream by start()). Either way
      // this body can't fire with an empty `wheel`, so no fallback is needed.
      const r = wheel[Math.floor(Math.random() * wheel.length)]
      setReelLabel(windowLabel(r))
    }, 70)
    timeoutRef.current = window.setTimeout(() => {
      window.clearInterval(intervalRef.current)
      setReelLabel(windowLabel(w))
      setSpinning(false)
      setReveal(true)
    }, 1100)
  }

  return (
    <section>
      <RosterRail
        slots={state.slots}
        windows={windowByPosition(state.picks)}
        targetable={targetSlots}
        onPlace={place}
      />

      {!reveal ? (
        <div className="spinbar">
          <div className={`reel${spinning ? ' spinning' : ''}`}>
            {reelLabel}
          </div>
          <button
            className="btn primary"
            disabled={spinning || !w}
            onClick={spin}
          >
            {spinning
              ? 'Spinning…'
              : `🎰 Spin era ${Math.min(state.cursor + 1, state.windows.length)} / ${state.windows.length}`}
          </button>
        </div>
      ) : (
        <>
          <div className="roundbar">
            <div className="era">
              {w ? windowLabel(w) : ''}
              <small>
                Era {Math.min(state.cursor + 1, state.windows.length)} /{' '}
                {state.windows.length}
              </small>
            </div>
            <button
              className="btn"
              disabled={!canSkip(state)}
              onClick={() => {
                setSelectedId(null)
                onAdvance(skip(state))
              }}
              title={
                skipsLeft > 0
                  ? 'Skip this era (advance to the next)'
                  : 'No skips left'
              }
            >
              ⏭ Skip era ({skipsLeft})
            </button>
          </div>

          {selected && (
            <div className="select-hint">
              Placing <strong>{selected.name}</strong> — tap a highlighted slot
              above.{' '}
              <button className="linkbtn" onClick={() => setSelectedId(null)}>
                cancel
              </button>
            </div>
          )}

          {groups.map((g) => (
            <div className="pos-group" key={g.pos}>
              <div className="pos-group-head">
                <span className="pos-chip">{g.pos}</span>
                {g.filled && !g.players.some((p) => isPickable(state, p)) && (
                  <span className="filled-tag">{g.pos} slot filled</span>
                )}
              </div>
              <table className="pool">
                <thead>
                  <tr>
                    <th className="name">Player</th>
                    <th>YR</th>
                    {STAT_COLS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.players.map((p) => {
                    const pickable = isPickable(state, p)
                    const alt = eligiblePositions(p).filter(
                      (x) => x !== p.position,
                    )
                    const s = seasonFor(p, w ?? undefined)
                    return (
                      <tr
                        key={p.id}
                        className={`player${pickable ? '' : ' locked'}${selectedId === p.id ? ' selected' : ''}`}
                        onClick={() => selectPlayer(p)}
                      >
                        <td className="name">
                          {p.name}
                          {alt.length > 0 && (
                            <span className="alt-pos">+{alt.join('/')}</span>
                          )}
                          {s && s.honors.length > 0 && (
                            <span className="honor" title={s.honors.join(', ')}>
                              ★
                            </span>
                          )}
                        </td>
                        <td className="yr">{fmtYear(s)}</td>
                        {STAT_COLS.map((c) => (
                          <td key={c.key}>{fmtStat(s, c.key)}</td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  )
}

function Results({
  school,
  state,
  dateKey,
  streak,
  saved,
  returning,
}: {
  school: School
  state: DraftState
  dateKey: string
  streak: Streak
  /** The persisted result for this day; its EARNED wins/grade win over a re-rate. */
  saved: SavedDaily | null
  /** Already in the books on load (a returning visit) — shows the lock banner. */
  returning: boolean
}) {
  // The live re-rate drives the per-row RTG table and team strength. But the
  // headline record + share use the EARNED wins/grade from the save when present:
  // a stats correction between play and replay must never rewrite what you scored.
  // (On a fresh finish, saved was just computed from this same state, so they match.)
  const live = evaluateRoster(state, GAMES)
  const { ratingsByPosition, windowByPosition: winByPos } = live
  const strength = Math.round(live.strength)
  const wins = saved?.wins ?? live.wins
  const grade = saved?.grade ?? live.grade

  const share = buildShareString({
    schoolName: school.short,
    dateKey,
    wins,
    games: GAMES,
    grade,
    ratingsByPosition,
  })

  const [copied, setCopied] = useState(false)
  function copyShare() {
    navigator.clipboard?.writeText(share).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => {},
    )
  }

  return (
    <section>
      {returning && (
        <div className="lock-note">
          ✓ Today's challenge is in the books. Come back tomorrow for a new one.
        </div>
      )}
      <div className="record">
        <div className="big">{recordLabel(wins, GAMES)}</div>
        <div className="grade">{grade}</div>
        <p className="muted">Team strength {strength} / 100</p>
        <StreakChips streak={streak} />
      </div>

      <RosterRail slots={state.slots} windows={winByPos} />

      <div className="card" style={{ marginTop: 16 }}>
        <table className="pool">
          <thead>
            <tr>
              <th className="name">Your starting five</th>
              <th>YR</th>
              {STAT_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>RTG</th>
            </tr>
          </thead>
          <tbody>
            {BBALL_POSITIONS.map((pos) => {
              const p = state.slots[pos]
              const s = p ? seasonFor(p, winByPos[pos]) : null
              return (
                <tr key={pos}>
                  <td className="name">
                    <span className="pos-chip">{pos}</span>
                    {p ? p.name : <span className="muted">(empty)</span>}
                  </td>
                  <td className="yr">{fmtYear(s)}</td>
                  {STAT_COLS.map((c) => (
                    <td key={c.key}>{p ? fmtStat(s, c.key) : '—'}</td>
                  ))}
                  <td>{p ? playerRating(p, winByPos[pos]) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <pre className="share-pre">{share}</pre>
      <div className="row">
        <button className="btn primary" onClick={copyShare}>
          {copied ? '✓ Copied' : '📋 Copy result'}
        </button>
      </div>
      <p className="center muted" style={{ marginTop: 14 }}>
        New challenge at midnight ET. Come back tomorrow.
      </p>
    </section>
  )
}
