import { useEffect, useMemo, useState } from 'react'
import confetti from 'canvas-confetti'
import { BBALL_POSITIONS, windowLabel } from './types'
import type { BballPlayer, BballPosition, BballStats } from './types'
import {
  SCHOOLS,
  getSchool,
  applyTheme,
  DEFAULT_SCHOOL_ID,
  type School,
} from './schools'
import { BBALL_WINDOWS } from './lib/windows'
import {
  BBALL_ROUNDS,
  getDateKey,
  isValidDateKey,
  seedFor,
  generateSpins,
  generateRerollSpins,
} from './lib/daily'
import {
  initDraft,
  draft,
  reroll,
  canReroll,
  skipRound,
  isComplete,
  currentWindow,
  currentPool,
  type DraftState,
} from './lib/game'
import {
  playerRating,
  teamStrength,
  projectedWins,
  recordLabel,
  gradeLabel,
} from './lib/rating'
import { buildShareString } from './lib/share'
import { setupAutoUpdate } from './lib/version'

const GAMES = 40

type StatKey = keyof BballStats
const STAT_COLS: { key: StatKey; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
]

const SCHOOL_STORAGE_KEY = 'ysas:school'

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

/** ?date=YYYY-MM-DD overrides the day (playtesting); else today in ET. */
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

  // Theme follows the chosen school (or the default while on the picker).
  useEffect(() => {
    applyTheme(school.theme)
  }, [school])

  // Reload to the latest build when a new version is deployed and the tab
  // regains focus — no stale tabs left open. No-op in local dev.
  useEffect(() => setupAutoUpdate(), [])

  function chooseSchool(id: string) {
    localStorage.setItem(SCHOOL_STORAGE_KEY, id)
    setSchoolId(id)
  }

  if (!schoolId) return <Picker onPick={chooseSchool} />
  return <Game school={school} onExit={() => setSchoolId(null)} />
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
  const players = school.basketball?.players ?? []
  const provisional = school.basketball?.provisional ?? false

  const dateKey = useMemo(activeDateKey, [])
  const seed = useMemo(
    () => seedFor(dateKey, `${school.id}:basketball`),
    [dateKey, school.id],
  )
  const spins = useMemo(
    () => generateSpins(seed, BBALL_ROUNDS, BBALL_WINDOWS),
    [seed],
  )
  const rerolls = useMemo(
    () => generateRerollSpins(seed, spins, BBALL_WINDOWS),
    [seed, spins],
  )

  const [phase, setPhase] = useState<'landing' | 'playing' | 'done'>('landing')
  const [state, setState] = useState<DraftState>(() =>
    initDraft(spins, rerolls),
  )

  function start() {
    setState(initDraft(spins, rerolls))
    setPhase('playing')
  }

  function pick(p: BballPlayer) {
    const next = draft(state, p)
    setState(next)
    if (isComplete(next)) finish(next)
  }

  function finish(s: DraftState) {
    setPhase('done')
    const rated = BBALL_POSITIONS.map((pos) => s.slots[pos])
      .filter((p): p is BballPlayer => p !== null)
      .map((p) => ({ position: p.position, rating: playerRating(p) }))
    const grade = gradeLabel(projectedWins(rated, GAMES), GAMES)
    if (grade === 'PERFECT' || grade === 'HISTORIC' || grade === 'ELITE') {
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
        <Landing school={school} dateKey={dateKey} onStart={start} />
      )}
      {phase === 'playing' && (
        <Playing
          school={school}
          players={players}
          state={state}
          onPick={pick}
          onState={setState}
        />
      )}
      {phase === 'done' && (
        <Results school={school} state={state} dateKey={dateKey} />
      )}

      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function Landing({
  school,
  dateKey,
  onStart,
}: {
  school: School
  dateKey: string
  onStart: () => void
}) {
  return (
    <section className="hero">
      <span className="banner">🗓️ Daily Challenge · {dateKey}</span>
      <h1>Build {school.name}'s all-time five.</h1>
      <p>
        Five rounds. Each round spins a 4-year window of {school.name}{' '}
        basketball. Draft one player into your starting five — PG, SG, SF, PF,
        C. Each slot locks once filled. You get <strong>one re-spin</strong>.
        How close to a perfect <strong>40&ndash;0</strong> can you get?
      </p>
      <button className="btn primary" onClick={onStart}>
        ▶ Play Today's Challenge
      </button>
    </section>
  )
}

function RosterRail({ slots }: { slots: DraftState['slots'] }) {
  return (
    <div className="rail">
      {BBALL_POSITIONS.map((pos) => {
        const p = slots[pos]
        return (
          <div key={pos} className={`slot ${p ? 'filled' : 'open'}`}>
            <div className="pos">{pos}</div>
            {p ? (
              <>
                <div className="pname">{p.name}</div>
                <div className="prate">{playerRating(p)}</div>
              </>
            ) : (
              <div className="pname muted">—</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Playing({
  school,
  players,
  state,
  onPick,
  onState,
}: {
  school: School
  players: BballPlayer[]
  state: DraftState
  onPick: (p: BballPlayer) => void
  onState: (s: DraftState) => void
}) {
  const [sortKey, setSortKey] = useState<StatKey>('pts')
  const w = currentWindow(state)
  const pool = useMemo(() => {
    const list = currentPool(state, players)
    return [...list].sort((a, b) => b.stats[sortKey] - a.stats[sortKey])
  }, [state, players, sortKey])

  return (
    <section>
      <RosterRail slots={state.slots} />

      <div className="roundbar">
        <div className="era">
          {w ? windowLabel(w) : ''}
          <small>
            Round {Math.min(state.round + 1, BBALL_ROUNDS)} / {BBALL_ROUNDS} ·
            spin
          </small>
        </div>
        <button
          className="btn"
          disabled={!canReroll(state)}
          onClick={() => onState(reroll(state))}
        >
          🎲 Re-spin ({state.rerollsLeft})
        </button>
      </div>

      {pool.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="pool">
            <thead>
              <tr>
                <th className="name">Player</th>
                {STAT_COLS.map((c) => (
                  <th
                    key={c.key}
                    className={sortKey === c.key ? 'active' : ''}
                    onClick={() => setSortKey(c.key)}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => (
                <tr key={p.id} className="player" onClick={() => onPick(p)}>
                  <td className="name">
                    <span className="pos-chip">{p.position}</span>
                    {p.name}
                    {p.honors.length > 0 && (
                      <span className="honor" title={p.honors.join(', ')}>
                        ★
                      </span>
                    )}
                  </td>
                  {STAT_COLS.map((c) => (
                    <td key={c.key}>{p.stats[c.key].toFixed(1)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty-pool">
          <p>
            No eligible {school.name} players for an open position in this
            window.
          </p>
          <div className="row">
            {canReroll(state) && (
              <button
                className="btn primary"
                onClick={() => onState(reroll(state))}
              >
                🎲 Use your re-spin
              </button>
            )}
            <button className="btn" onClick={() => onState(skipRound(state))}>
              Skip this round (leaves a hole)
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Results({
  school,
  state,
  dateKey,
}: {
  school: School
  state: DraftState
  dateKey: string
}) {
  const rated = BBALL_POSITIONS.map((pos) => state.slots[pos])
    .filter((p): p is BballPlayer => p !== null)
    .map((p) => ({ position: p.position, rating: playerRating(p) }))
  const strength = Math.round(teamStrength(rated))
  const wins = projectedWins(rated, GAMES)
  const grade = gradeLabel(wins, GAMES)

  const ratingsByPosition = Object.fromEntries(
    BBALL_POSITIONS.map((pos) => [
      pos,
      state.slots[pos] ? playerRating(state.slots[pos]!) : null,
    ]),
  ) as Record<BballPosition, number | null>

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
      <div className="record">
        <div className="big">{recordLabel(wins, GAMES)}</div>
        <div className="grade">{grade}</div>
        <p className="muted">Team strength {strength} / 100</p>
      </div>

      <RosterRail slots={state.slots} />

      <div className="card" style={{ marginTop: 16 }}>
        <table className="pool">
          <thead>
            <tr>
              <th className="name">Your starting five</th>
              {STAT_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>RTG</th>
            </tr>
          </thead>
          <tbody>
            {BBALL_POSITIONS.map((pos) => {
              const p = state.slots[pos]
              return (
                <tr key={pos}>
                  <td className="name">
                    <span className="pos-chip">{pos}</span>
                    {p ? p.name : <span className="muted">(empty)</span>}
                  </td>
                  {STAT_COLS.map((c) => (
                    <td key={c.key}>{p ? p.stats[c.key].toFixed(1) : '—'}</td>
                  ))}
                  <td>{p ? playerRating(p) : '—'}</td>
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
