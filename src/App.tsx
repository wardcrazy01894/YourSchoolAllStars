import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import { BBALL_POSITIONS, windowLabel, eligiblePositions } from './types'
import type { BballPlayer, BballPosition, BballStats } from './types'
import {
  getSchool,
  applyTheme,
  DEFAULT_SCHOOL_ID,
  SCHOOLS,
  type School,
} from './schools'
import { BBALL_WINDOWS } from './lib/windows'
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
    () => generateSpins(seed, DAILY_BBALL_ERAS, BBALL_WINDOWS),
    [seed],
  )

  const [phase, setPhase] = useState<'landing' | 'playing' | 'done'>('landing')
  const [state, setState] = useState<DraftState>(() => initDraft(spins))

  function start() {
    setState(initDraft(spins))
    setPhase('playing')
  }

  function advance(next: DraftState) {
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
        <Playing players={players} state={state} onAdvance={advance} />
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
        Six eras spin in a fixed order today — the same for everyone. Draft a
        starting five (PG, SG, SF, PF, C): pick a player, then choose an open
        slot. You can <strong>skip one era</strong>. How close to a perfect{' '}
        <strong>40&ndash;0</strong> can you get?
      </p>
      <button className="btn primary" onClick={onStart}>
        ▶ Play Today's Challenge
      </button>
    </section>
  )
}

function RosterRail({
  slots,
  targetable,
  onPlace,
}: {
  slots: DraftState['slots']
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
                <div className="prate">{playerRating(p)}</div>
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
  onAdvance,
}: {
  players: BballPlayer[]
  state: DraftState
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

  // Group players by primary position, sorted within group by points.
  const groups = BBALL_POSITIONS.map((pos) => ({
    pos,
    filled: state.slots[pos] !== null,
    players: era
      .filter((p) => p.position === pos)
      .sort((a, b) => b.stats.pts - a.stats.pts),
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
      const r = BBALL_WINDOWS[Math.floor(Math.random() * BBALL_WINDOWS.length)]
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
                          {p.honors.length > 0 && (
                            <span className="honor" title={p.honors.join(', ')}>
                              ★
                            </span>
                          )}
                        </td>
                        <td className="yr">'{String(p.bestSeason).slice(2)}</td>
                        {STAT_COLS.map((c) => (
                          <td key={c.key}>{p.stats[c.key].toFixed(1)}</td>
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
              return (
                <tr key={pos}>
                  <td className="name">
                    <span className="pos-chip">{pos}</span>
                    {p ? p.name : <span className="muted">(empty)</span>}
                  </td>
                  <td className="yr">
                    {p ? `'${String(p.bestSeason).slice(2)}` : '—'}
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
