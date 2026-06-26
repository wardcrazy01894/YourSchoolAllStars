import { useMemo, useState } from 'react'
import confetti from 'canvas-confetti'
import { michiganBasketball } from './data'
import { BBALL_POSITIONS, windowLabel } from './types'
import type { BballPlayer, BballPosition, BballStats } from './types'
import { BBALL_WINDOWS } from './lib/windows'
import {
  BBALL_ROUNDS,
  getDateKey,
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

const GAMES = 40
const SCHOOL = michiganBasketball.school

type StatKey = keyof BballStats
const STAT_COLS: { key: StatKey; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
]

/** ?date=YYYY-MM-DD overrides the day (playtesting); else today in ET. */
function activeDateKey(): string {
  const q = new URLSearchParams(window.location.search).get('date')
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q
  return getDateKey()
}

export default function App() {
  const dateKey = useMemo(activeDateKey, [])
  const seed = useMemo(() => seedFor(dateKey, 'basketball'), [dateKey])
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
    const starters = BBALL_POSITIONS.map((pos) => s.slots[pos])
      .filter((p): p is BballPlayer => p !== null)
      .map((p) => ({ position: p.position, rating: playerRating(p) }))
    const wins = projectedWins(starters, GAMES)
    const grade = gradeLabel(wins, GAMES)
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
              {SCHOOL} Basketball
              {michiganBasketball.provisional ? ' · provisional data' : ''}
            </small>
          </div>
        </div>
        {phase !== 'landing' && (
          <button className="btn ghost" onClick={() => setPhase('landing')}>
            ↺ New
          </button>
        )}
      </header>

      {phase === 'landing' && <Landing dateKey={dateKey} onStart={start} />}
      {phase === 'playing' && (
        <Playing state={state} onPick={pick} onState={setState} />
      )}
      {phase === 'done' && <Results state={state} dateKey={dateKey} />}

      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by the
        University of Michigan. Player data curated from public sources.
      </footer>
    </div>
  )
}

function Landing({
  dateKey,
  onStart,
}: {
  dateKey: string
  onStart: () => void
}) {
  return (
    <section className="hero">
      <span className="banner">🗓️ Daily Challenge · {dateKey}</span>
      <h1>Build {SCHOOL}'s all-time five.</h1>
      <p>
        Five rounds. Each round spins a 4-year window of {SCHOOL} basketball.
        Draft one player into your starting five — PG, SG, SF, PF, C. Each slot
        locks once filled. You get <strong>one re-spin</strong>. How close to a
        perfect <strong>40&ndash;0</strong> can you get?
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
  state,
  onPick,
  onState,
}: {
  state: DraftState
  onPick: (p: BballPlayer) => void
  onState: (s: DraftState) => void
}) {
  const [sortKey, setSortKey] = useState<StatKey>('pts')
  const w = currentWindow(state)
  const pool = useMemo(() => {
    const list = currentPool(state, michiganBasketball.players)
    return [...list].sort((a, b) => b.stats[sortKey] - a.stats[sortKey])
  }, [state, sortKey])

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
            No eligible {SCHOOL} players for an open position in this window.
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

function Results({ state, dateKey }: { state: DraftState; dateKey: string }) {
  const starters = BBALL_POSITIONS.map((pos) => state.slots[pos])
  const rated = starters
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
    schoolName: SCHOOL,
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
