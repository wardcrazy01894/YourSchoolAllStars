import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import confetti from 'canvas-confetti'
import {
  BBALL_POSITIONS,
  windowLabel,
  eligiblePositions,
  FB_SLOTS,
  FB_OFF_POSITIONS,
  FB_DEF_POSITIONS,
} from './types'
import type {
  BballPlayer,
  BballPosition,
  BballSeason,
  BballStats,
  YearWindow,
  FbPlayer,
  FbPosition,
  FbStats,
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
  teamStatTotals,
  windowByPosition,
} from './lib/result'
import {
  loadDaily,
  loadStreak,
  saveDailyResult,
  type Streak,
  type SavedDaily,
} from './lib/progress'
import { buildShareString, buildFbShareString } from './lib/share'
import { buildReelPlan } from './lib/reel'
import {
  initFbDraft,
  draftToSlot as fbDraftToSlot,
  currentSide as fbCurrentSide,
  currentFbWindow,
  isFbComplete,
  isPickable as fbIsPickable,
  eligibleOpenSlots as fbEligibleOpenSlots,
  playersThisEra as fbPlayersThisEra,
  canRespin as fbCanRespin,
  respin as fbRespin,
  type FbDraftState,
} from './lib/football-game'
import { FB_DRAFT_ROUNDS, FB_RESPINS_PER_SIDE } from './lib/football'
import { fbPlayerRating, FB_GAMES } from './lib/football-rating'
import {
  fbEvaluate,
  fbSavedDailyFrom,
  fbRosterFromSaved,
} from './lib/football-result'
import { setupAutoUpdate } from './lib/version'
import {
  getMode,
  isGameMode,
  modesForSport,
  randomSeed,
  type GameMode,
  type ModeConfig,
} from './lib/modes'
import {
  getSport,
  isSportId,
  sportsForSchool,
  type SportConfig,
} from './lib/sports'

const GAMES = 40

/** Spin duration (ms). Kept in sync with the wheel's CSS deceleration. */
const SPIN_MS = 2600

/** Read the user's reduced-motion preference once (stable for the component's life). */
function usePrefersReducedMotion(): boolean {
  // useRef, not useState: this is a read-once value that never re-renders the
  // component, so the discarded setState setter would only mislead.
  return useRef(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  ).current
}

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

function initialModeId(): GameMode | null {
  const q = param('mode')
  return isGameMode(q) ? q : null
}

function initialSportId(): string | null {
  const q = param('sport')
  return isSportId(q) ? q : null
}

export default function App() {
  const [schoolId, setSchoolId] = useState<string | null>(initialSchoolId)
  const [sportId, setSportId] = useState<string | null>(initialSportId)
  const [modeId, setModeId] = useState<GameMode | null>(initialModeId)
  const school = getSchool(schoolId ?? DEFAULT_SCHOOL_ID)!

  useEffect(() => {
    applyTheme(school.theme)
  }, [school])

  useEffect(() => setupAutoUpdate(), [])

  function chooseSchool(id: string) {
    localStorage.setItem(SCHOOL_STORAGE_KEY, id)
    setSchoolId(id)
  }

  // Each step back clears the steps below it so the flow can't keep a stale
  // deeper selection (e.g. switching school must drop the chosen sport + mode).
  function backToSports() {
    setModeId(null)
    setSportId(null)
  }
  function switchSchool() {
    setModeId(null)
    setSportId(null)
    setSchoolId(null)
  }

  // Flow: school → sport → mode → game. A sport that isn't `available` yet routes
  // to a "coming soon" screen rather than a half-built draft; both basketball and
  // football are live, so today that screen only shows for a future sport.
  if (!schoolId) return <Picker onPick={chooseSchool} />
  if (!sportId)
    return (
      <SportMenu
        school={school}
        onPick={setSportId}
        onSwitchSchool={switchSchool}
      />
    )
  const sport = getSport(sportId)
  if (!sport.available)
    return (
      <SportComingSoon
        school={school}
        sport={sport}
        onBack={backToSports}
        onSwitchSchool={switchSchool}
      />
    )
  if (!modeId)
    return (
      <ModeMenu
        school={school}
        sport={sport}
        onPick={setModeId}
        onBackToSports={backToSports}
        onSwitchSchool={switchSchool}
      />
    )
  // key=school:sport:mode makes the remount explicit: Game's useState
  // initializers (seed/phase/state/streak) all derive from the chosen sport +
  // mode + loaded save, so any of those changing must start a fresh Game.
  // Football has its own parallel game component (12-man, two-phase draft, record
  // out of 16) so the live basketball flow stays untouched.
  const gameKey = `${school.id}:${sport.id}:${modeId}`
  if (sport.id === 'football')
    return (
      <FbGame
        key={gameKey}
        school={school}
        sport={sport}
        mode={getMode(modeId)}
        onExitToModes={() => setModeId(null)}
        onSwitchSchool={switchSchool}
      />
    )
  return (
    <Game
      key={gameKey}
      school={school}
      sport={sport}
      mode={getMode(modeId)}
      onExitToModes={() => setModeId(null)}
      onSwitchSchool={switchSchool}
    />
  )
}

function Picker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">🏀</span>
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

function SportMenu({
  school,
  onPick,
  onSwitchSchool,
}: {
  school: School
  onPick: (id: string) => void
  onSwitchSchool: () => void
}) {
  // Only the sports this school actually fields (football is hidden where
  // `hasFootball` is false). A not-yet-`available` sport still shows — it's a
  // real card that routes to a "coming soon" screen, not a hidden one.
  const sports = sportsForSchool(school)
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">{school.emoji}</span>
          <div>
            YourSchoolAllStars
            <small>{school.name}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onSwitchSchool}>
            ↺ School
          </button>
        </div>
      </header>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1>{school.name}</h1>
        <p>Pick a sport.</p>
      </section>
      <div className="mode-menu">
        {sports.map((s) => (
          <button
            key={s.id}
            className={`mode-card${s.available ? '' : ' soon'}`}
            onClick={() => onPick(s.id)}
          >
            {!s.available && <span className="soon-chip">Coming soon</span>}
            <span className="mode-emoji">{s.emoji}</span>
            <span className="mode-name">{s.name}</span>
            <span className="mode-blurb">{s.blurb}</span>
          </button>
        ))}
      </div>
      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function SportComingSoon({
  school,
  sport,
  onBack,
  onSwitchSchool,
}: {
  school: School
  sport: SportConfig
  onBack: () => void
  onSwitchSchool: () => void
}) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">{sport.emoji}</span>
          <div>
            YourSchoolAllStars
            <small>
              {school.name} {sport.name}
            </small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onBack}>
            ← Sports
          </button>
          <button className="btn ghost" onClick={onSwitchSchool}>
            ↺ School
          </button>
        </div>
      </header>
      <section className="hero">
        <span className="banner">
          {sport.emoji} {school.name} {sport.name}
        </span>
        <h1>{sport.name} is coming soon.</h1>
        <p>
          We're building the {school.name} {sport.name.toLowerCase()} draft — a
          per-season roster across the eras, sourced the same careful way as
          basketball. It isn't playable yet, and we won't ship fabricated stats
          to fake it.
        </p>
        <p className="muted">
          In the meantime, the {school.name} basketball game is live.
        </p>
        <button className="btn primary" onClick={onBack}>
          ← Back to sports
        </button>
      </section>
      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function ModeMenu({
  school,
  sport,
  onPick,
  onBackToSports,
  onSwitchSchool,
}: {
  school: School
  sport: SportConfig
  onPick: (id: GameMode) => void
  onBackToSports: () => void
  onSwitchSchool: () => void
}) {
  // The daily streak lives per school+sport; surface it here so returning players
  // see it before they pick a mode (only the daily can advance it).
  const [dailyStreak] = useState(() => loadStreak(school.id, sport.id))
  // Daily + Classic are universal; the stats-hidden IQ mode is sport-flavoured —
  // basketball shows Hoops IQ, football shows Gridiron IQ (never the other's).
  const modes = modesForSport(sport.id)
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">{sport.emoji}</span>
          <div>
            YourSchoolAllStars
            <small>
              {school.name} {sport.name}
            </small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onBackToSports}>
            ← Sports
          </button>
          <button className="btn ghost" onClick={onSwitchSchool}>
            ↺ School
          </button>
        </div>
      </header>
      <section className="hero" style={{ paddingBottom: 8 }}>
        <h1>
          {school.name} {sport.name}
        </h1>
        <p>Choose how you want to play.</p>
        <StreakChips streak={dailyStreak} />
      </section>
      <div className="mode-menu">
        {modes.map((m) => (
          <button key={m.id} className="mode-card" onClick={() => onPick(m.id)}>
            <span className="mode-emoji">{m.emoji}</span>
            <span className="mode-name">{m.name}</span>
            <span className="mode-blurb">{m.blurb}</span>
          </button>
        ))}
      </div>
      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function Game({
  school,
  sport,
  mode,
  onExitToModes,
  onSwitchSchool,
}: {
  school: School
  sport: SportConfig
  mode: ModeConfig
  onExitToModes: () => void
  onSwitchSchool: () => void
}) {
  // Memoized so its reference is stable across renders — it feeds the `windows`
  // useMemo below, which would otherwise recompute every render on a fresh `[]`.
  const players = useMemo(
    () => school.basketball?.players ?? [],
    [school.basketball],
  )
  const provisional = school.basketball?.provisional ?? false

  const dateKey = useMemo(activeDateKey, [])
  // Daily mode shares ONE deterministic seed (same eras for everyone today);
  // Classic/Hoops IQ get a fresh random seed per game — and a new one on "play
  // again". State, not memo: playAgain mutates it to reshuffle the wheel.
  const [gameSeed, setGameSeed] = useState<number>(() =>
    mode.daily ? seedFor(dateKey, `${school.id}:${sport.id}`) : randomSeed(),
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
    () => generateSpins(gameSeed, DAILY_BBALL_ERAS, windows),
    [gameSeed, windows],
  )

  // The daily is a ONE-SHOT: if today's result is already saved, open straight to
  // the locked Results (reconstructed from the save) instead of letting them
  // replay. `?date=` playtest days hydrate the same way, per day. Read ONCE via a
  // useState initializer — it's a side-effectful localStorage read, not a derived
  // value, so it must not live in a useMemo (which React may recompute).
  // Only the DAILY is a one-shot with a persisted lock: load today's save so a
  // returning player opens straight to locked Results. Free-play modes never load
  // or save, so they always start fresh at the landing.
  const [savedToday] = useState(() =>
    mode.daily ? loadDaily(school.id, sport.id, dateKey) : null,
  )

  const [phase, setPhase] = useState<'landing' | 'playing' | 'done'>(
    savedToday ? 'done' : 'landing',
  )
  const [state, setState] = useState<DraftState>(() =>
    savedToday ? rosterFromSaved(savedToday, players) : initDraft(spins),
  )
  const [streak, setStreak] = useState<Streak>(() =>
    loadStreak(school.id, sport.id),
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
    const saved = savedDailyFrom(s, dateKey, GAMES, school.power5)
    setResult(saved)
    // Only the DAILY persists + advances the per-device streak. Free-play modes
    // (Classic / Hoops IQ) are replayable, so they neither save nor touch the
    // streak. saveDailyResult is idempotent and fail-safe; only a REAL today play
    // moves the streak — `?date=` playtest days save + lock but stay neutral.
    if (mode.daily) {
      const updated = saveDailyResult(school.id, sport.id, saved, {
        advanceStreak: dateKey === getDateKey(),
      })
      setStreak(updated)
    }
    // Celebration is mode-agnostic on purpose: a great roster earns confetti in
    // Classic / Hoops IQ too, even though those don't save or touch the streak.
    if (
      saved.grade === 'PERFECT' ||
      saved.grade === 'HISTORIC' ||
      saved.grade === 'ELITE'
    ) {
      confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } })
    }
  }

  // Free-play replay: reshuffle to a fresh random wheel and start a new draft.
  // (Not offered for the daily — that's a one-shot; guard so a future refactor
  // that mis-wires the button can't silently bypass the daily lock.)
  function playAgain() {
    if (mode.daily) return
    const next = randomSeed()
    setGameSeed(next)
    setResult(null)
    setState(initDraft(generateSpins(next, DAILY_BBALL_ERAS, windows)))
    setPhase('playing')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">{sport.emoji}</span>
          <div>
            YourSchoolAllStars
            <small>
              {school.name} {sport.name} · {mode.name}
              {provisional ? ' · provisional data' : ''}
            </small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onExitToModes}>
            ← Modes
          </button>
          <button className="btn ghost" onClick={onSwitchSchool}>
            ↺ School
          </button>
        </div>
      </header>

      {phase === 'landing' && (
        <Landing
          school={school}
          mode={mode}
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
          hideStats={mode.hideStats}
          power5={school.power5}
          onAdvance={advance}
        />
      )}
      {phase === 'done' && (
        <Results
          school={school}
          mode={mode}
          state={state}
          dateKey={dateKey}
          streak={streak}
          saved={result}
          returning={returning}
          onPlayAgain={playAgain}
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
  mode,
  dateKey,
  playable,
  streak,
  onStart,
}: {
  school: School
  mode: ModeConfig
  dateKey: string
  /** False when this school has no draftable wheel (no basketball data yet). */
  playable: boolean
  streak: Streak
  onStart: () => void
}) {
  return (
    <section className="hero">
      <span className="banner">
        {mode.daily
          ? `🗓️ Daily Challenge · ${dateKey}`
          : `${mode.emoji} ${mode.name}`}
      </span>
      <h1>Build {school.name}'s all-time five.</h1>
      <p>
        {mode.daily
          ? 'Six eras spin in a fixed order today — the same for everyone. '
          : 'Six random eras spin, fresh every game. '}
        Draft a starting five (PG, SG, SF, PF, C): pick a player, then choose an
        open slot. You can <strong>skip one era</strong>. How close to a perfect{' '}
        <strong>40&ndash;0</strong> can you get?
      </p>
      {mode.hideStats && (
        <p className="muted">
          🧠 Hoops IQ: stats, ratings, and award stars stay hidden while you
          draft — go on names alone. Stats and ratings reveal at the end.
        </p>
      )}
      {mode.daily && <StreakChips streak={streak} />}
      {playable ? (
        <button className="btn primary" onClick={onStart}>
          {mode.daily ? "▶ Play Today's Challenge" : `▶ Play ${mode.name}`}
        </button>
      ) : (
        <p className="muted">
          No {school.name} basketball data yet — check back soon.
        </p>
      )}
    </section>
  )
}

export function RosterRail({
  slots,
  windows,
  targetable,
  onPlace,
  hideRating,
  power5,
}: {
  slots: DraftState['slots']
  /** Era each filled slot was drafted from, so its rating matches the pick. */
  windows?: Partial<Record<BballPosition, YearWindow>>
  targetable?: BballPosition[]
  onPlace?: (pos: BballPosition) => void
  /** Hoops IQ: suppress the numeric rating while drafting (revealed at the end). */
  hideRating?: boolean
  /**
   * School's conference strength — false applies the non-power-5 rating haircut.
   * REQUIRED (no default): an omitted prop would silently rate a non-power-5
   * school at full power-5 value. Every call site must pass `school.power5`.
   */
  power5: boolean
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
                {!hideRating && (
                  <div className="prate">
                    {playerRating(p, windows?.[pos], power5)}
                  </div>
                )}
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

export function Playing({
  players,
  state,
  wheel,
  hideStats,
  power5,
  onAdvance,
}: {
  players: BballPlayer[]
  state: DraftState
  /** The full rolling era wheel — the reel animation flashes labels from it. */
  wheel: YearWindow[]
  /** Hoops IQ: hide box-score numbers (year + stats + rating) while drafting. */
  hideStats: boolean
  /** School's conference strength — false applies the non-power-5 rating haircut. */
  power5: boolean
  onAdvance: (s: DraftState) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [spinning, setSpinning] = useState(false)
  // `rolling` toggles the wheel's CSS transition on. Flipping it false→true AFTER
  // the reset frame is committed is what triggers the decelerating scroll (set it
  // true on mount and the column would jump to the target with no animation).
  const [rolling, setRolling] = useState(false)
  const timeoutRef = useRef<number | undefined>(undefined)
  const rafRef = useRef<number | undefined>(undefined)
  const reduced = usePrefersReducedMotion()
  const w = currentWindow(state)
  const era = playersThisEra(state, players)
  const selected = selectedId
    ? (era.find((p) => p.id === selectedId) ?? null)
    : null
  const targetSlots = selected ? eligibleOpenSlots(state, selected) : []
  const skipsLeft = safeSkipsLeft(state)

  // Geometry for this era's spin: a chronological wheel of era start years that
  // lands on w.start. Memoized on the target year so it stays stable across the
  // spin's re-renders (a fresh plan mid-spin would restart the scroll).
  const targetYear = w?.start ?? null
  const plan = useMemo(
    () => (targetYear === null ? null : buildReelPlan(wheel, targetYear)),
    [wheel, targetYear],
  )

  // Group players by primary position. Normally sort within group by IN-WINDOW
  // points, but in Hoops IQ that would leak the hidden stat ranking — sort by name
  // instead so the order reveals nothing.
  const ptsIn = (p: BballPlayer) => seasonFor(p, w ?? undefined)?.stats.pts ?? 0
  const groups = BBALL_POSITIONS.map((pos) => ({
    pos,
    filled: state.slots[pos] !== null,
    players: era
      .filter((p) => p.position === pos)
      .sort((a, b) =>
        hideStats ? a.name.localeCompare(b.name) : ptsIn(b) - ptsIn(a),
      ),
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
    setRolling(false)
    setSelectedId(null)
    return () => {
      window.clearTimeout(timeoutRef.current)
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [state.cursor])

  function spin() {
    if (!w || spinning || reveal || !plan) return
    if (import.meta.env.DEV && !plan.found) {
      console.warn(`spin: target year ${targetYear} not on the wheel`)
    }
    // Honour prefers-reduced-motion: skip the scroll entirely and reveal at once.
    if (reduced) {
      setReveal(true)
      return
    }
    setSpinning(true)
    setRolling(false) // pin the column at the top with the transition OFF…
    // …then enable the transition on the next committed frame so the browser
    // animates from the reset position instead of snapping to the target.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setRolling(true))
    })
    timeoutRef.current = window.setTimeout(() => {
      setSpinning(false)
      setReveal(true)
    }, SPIN_MS)
  }

  return (
    <section>
      <RosterRail
        slots={state.slots}
        windows={windowByPosition(state.picks)}
        targetable={targetSlots}
        onPlace={place}
        hideRating={hideStats}
        power5={power5}
      />

      {!reveal ? (
        <div className="spinbar">
          <div className="wheel" aria-hidden="true">
            {/* Highlight the landing slot only once the wheel is moving, so no
                pre-spin year sits under the band looking pre-selected. */}
            {rolling && <div className="wheel-band" />}
            <div
              className="wheel-col"
              style={{
                transform: `translateY(calc(var(--reel-cell) * ${
                  rolling && plan ? -plan.offset : 0
                }))`,
                transition: rolling
                  ? `transform ${SPIN_MS - 80}ms cubic-bezier(0.1, 0.62, 0.22, 1)`
                  : 'none',
              }}
            >
              {(plan?.cells ?? []).map((y, i) => (
                <div className="wheel-cell" key={i}>
                  {y}
                </div>
              ))}
            </div>
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
                    {/* Hoops IQ hides the box-score columns while drafting. */}
                    {!hideStats && <th>YR</th>}
                    {!hideStats &&
                      STAT_COLS.map((c) => <th key={c.key}>{c.label}</th>)}
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
                          {!hideStats && s && s.honors.length > 0 && (
                            // Hoops IQ hides the ★ entirely: it's a strong "this
                            // player is good" tell, and the honor strings embed
                            // the year (e.g. "All-American (2003)") which would
                            // leak the hidden season via the tooltip.
                            <span className="honor" title={s.honors.join(', ')}>
                              ★
                            </span>
                          )}
                        </td>
                        {!hideStats && <td className="yr">{fmtYear(s)}</td>}
                        {!hideStats &&
                          STAT_COLS.map((c) => (
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
  mode,
  state,
  dateKey,
  streak,
  saved,
  returning,
  onPlayAgain,
}: {
  school: School
  mode: ModeConfig
  state: DraftState
  dateKey: string
  streak: Streak
  /** The persisted result for this day; its EARNED wins/grade win over a re-rate. */
  saved: SavedDaily | null
  /** Already in the books on load (a returning visit) — shows the lock banner. */
  returning: boolean
  /** Free-play replay; only surfaced for non-daily modes. */
  onPlayAgain: () => void
}) {
  // The live re-rate drives the per-row RTG table and team strength. But the
  // headline record + share use the EARNED wins/grade from the save when present:
  // a stats correction between play and replay must never rewrite what you scored.
  // (On a fresh finish, saved was just computed from this same state, so they match.)
  const live = evaluateRoster(state, GAMES, school.power5)
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
    daily: mode.daily,
    modeLabel: mode.name,
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

  // Team totals across the starting five, per stat (pure + unit-tested in
  // result.ts so the "same season as the box score" invariant has regression
  // coverage). A missing value counts as 0; empty slots contribute nothing.
  const totals = teamStatTotals(
    state.slots,
    winByPos,
    STAT_COLS.map((c) => c.key),
  )

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
        {mode.daily && <StreakChips streak={streak} />}
      </div>

      <RosterRail
        slots={state.slots}
        windows={winByPos}
        power5={school.power5}
      />

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
                  <td>
                    {p ? playerRating(p, winByPos[pos], school.power5) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="totals">
              <td className="name">Team totals</td>
              <td className="yr"></td>
              {STAT_COLS.map((c) => (
                <td key={c.key}>{totals[c.key].toFixed(1)}</td>
              ))}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <pre className="share-pre">{share}</pre>
      <div className="row">
        <button className="btn primary" onClick={copyShare}>
          {copied ? '✓ Copied' : '📋 Copy result'}
        </button>
        {!mode.daily && (
          <button className="btn" onClick={onPlayAgain}>
            🔄 Play again
          </button>
        )}
      </div>
      <p className="center muted" style={{ marginTop: 14 }}>
        {mode.daily
          ? 'New challenge at midnight ET. Come back tomorrow.'
          : `Free play — spin up another ${mode.name} team any time.`}
      </p>
    </section>
  )
}

// ── Football ─────────────────────────────────────────────────────────────────
// A parallel game flow for the 12-man, two-phase football draft. It mirrors the
// basketball Game/Playing/Results trio but on FbDraftState (offense first, then
// defense; one re-spin per side; record out of 16). Kept separate so the live
// basketball path is untouched — the engine pieces it shares (rolling windows,
// daily spins, reel plan, streak/daily persistence) are already sport-agnostic.

type FbStatKey = keyof FbStats
/**
 * Per-position stat columns. Football's box score is heterogeneous (a QB's
 * passing yards and a corner's interceptions are different scales), so each
 * position shows only its relevant columns — and since the pool is grouped by
 * position, every row in a group shares them. All values are SEASON TOTALS.
 */
const FB_STAT_COLS: Record<FbPosition, { key: FbStatKey; label: string }[]> = {
  QB: [
    { key: 'passYds', label: 'PYDS' },
    { key: 'passTD', label: 'PTD' },
    { key: 'passInt', label: 'INT' },
    { key: 'rushYds', label: 'RYDS' },
  ],
  RB: [
    { key: 'rushYds', label: 'RYDS' },
    { key: 'rushTD', label: 'RTD' },
    { key: 'rec', label: 'REC' },
    { key: 'recYds', label: 'RcYD' },
  ],
  WR: [
    { key: 'rec', label: 'REC' },
    { key: 'recYds', label: 'YDS' },
    { key: 'recTD', label: 'TD' },
  ],
  TE: [
    { key: 'rec', label: 'REC' },
    { key: 'recYds', label: 'YDS' },
    { key: 'recTD', label: 'TD' },
  ],
  DE: [
    { key: 'sacks', label: 'SK' },
    { key: 'tfl', label: 'TFL' },
    { key: 'tackles', label: 'TKL' },
    { key: 'ff', label: 'FF' },
  ],
  DT: [
    { key: 'sacks', label: 'SK' },
    { key: 'tfl', label: 'TFL' },
    { key: 'tackles', label: 'TKL' },
  ],
  LB: [
    { key: 'tackles', label: 'TKL' },
    { key: 'tfl', label: 'TFL' },
    { key: 'sacks', label: 'SK' },
    { key: 'defInt', label: 'INT' },
  ],
  CB: [
    { key: 'defInt', label: 'INT' },
    { key: 'pbu', label: 'PBU' },
    { key: 'tackles', label: 'TKL' },
  ],
  S: [
    { key: 'tackles', label: 'TKL' },
    { key: 'defInt', label: 'INT' },
    { key: 'pbu', label: 'PBU' },
  ],
}

/** Football stat cell: a missing total shows as an em dash, not 0. */
function fmtFbStat(stats: FbStats, key: FbStatKey): string {
  const v = stats[key]
  return v === undefined ? '—' : String(v)
}

/** Season chip from a football player's best season, e.g. "'18". */
function fmtFbYear(p: FbPlayer): string {
  return `'${String(p.bestSeason).slice(2)}`
}

function FbGame({
  school,
  sport,
  mode,
  onExitToModes,
  onSwitchSchool,
}: {
  school: School
  sport: SportConfig
  mode: ModeConfig
  onExitToModes: () => void
  onSwitchSchool: () => void
}) {
  const players = useMemo(
    () => school.football?.players ?? [],
    [school.football],
  )
  // For football, `provisional` means the bundled stats are MOCK placeholders —
  // good enough to test every screen + mode before real sourced data lands.
  const provisional = school.football?.provisional ?? false

  const dateKey = useMemo(activeDateKey, [])
  const [gameSeed, setGameSeed] = useState<number>(() =>
    mode.daily ? seedFor(dateKey, `${school.id}:${sport.id}`) : randomSeed(),
  )
  // Football's rolling wheel starts at 2005 (defensive box scores aren't reliable
  // before then — see docs/DATA-SOURCING.md), 4-year eras up to the dataset's max.
  const windows = useMemo(() => {
    const maxYear = datasetMaxYear(players)
    return maxYear === null ? [] : buildRollingWindows(2005, maxYear, 4)
  }, [players])
  // FB_DRAFT_ROUNDS windows: one per slot + the two per-side re-spins, so the
  // sequence can never run dry even if both re-spins are used.
  const spins = useMemo(
    () => generateSpins(gameSeed, FB_DRAFT_ROUNDS, windows),
    [gameSeed, windows],
  )

  const [savedToday] = useState(() =>
    mode.daily ? loadDaily(school.id, sport.id, dateKey) : null,
  )

  const [phase, setPhase] = useState<'landing' | 'playing' | 'done'>(
    savedToday ? 'done' : 'landing',
  )
  const [state, setState] = useState<FbDraftState>(() =>
    savedToday ? fbRosterFromSaved(savedToday, players) : initFbDraft(spins),
  )
  const [streak, setStreak] = useState<Streak>(() =>
    loadStreak(school.id, sport.id),
  )
  const [result, setResult] = useState<SavedDaily | null>(savedToday)
  const returning = savedToday !== null

  function start() {
    if (spins.length === 0) return
    setState(initFbDraft(spins))
    setPhase('playing')
  }

  function advance(next: FbDraftState) {
    setState(next)
    if (isFbComplete(next)) finish(next)
  }

  function finish(s: FbDraftState) {
    setPhase('done')
    const saved = fbSavedDailyFrom(s, dateKey, school.power5)
    setResult(saved)
    if (mode.daily) {
      const updated = saveDailyResult(school.id, sport.id, saved, {
        advanceStreak: dateKey === getDateKey(),
      })
      setStreak(updated)
    }
    if (
      saved.grade === 'PERFECT' ||
      saved.grade === 'HISTORIC' ||
      saved.grade === 'ELITE'
    ) {
      confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 } })
    }
  }

  function playAgain() {
    if (mode.daily) return
    const next = randomSeed()
    setGameSeed(next)
    setResult(null)
    setState(initFbDraft(generateSpins(next, FB_DRAFT_ROUNDS, windows)))
    setPhase('playing')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ball">{sport.emoji}</span>
          <div>
            YourSchoolAllStars
            <small>
              {school.name} {sport.name} · {mode.name}
              {provisional ? ' · mock data' : ''}
            </small>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onExitToModes}>
            ← Modes
          </button>
          <button className="btn ghost" onClick={onSwitchSchool}>
            ↺ School
          </button>
        </div>
      </header>

      {phase === 'landing' && (
        <FbLanding
          school={school}
          mode={mode}
          dateKey={dateKey}
          playable={spins.length > 0}
          provisional={provisional}
          streak={streak}
          onStart={start}
        />
      )}
      {phase === 'playing' && (
        <FbPlaying
          players={players}
          state={state}
          wheel={windows}
          hideStats={mode.hideStats}
          power5={school.power5}
          onAdvance={advance}
        />
      )}
      {phase === 'done' && (
        <FbResults
          school={school}
          mode={mode}
          state={state}
          dateKey={dateKey}
          streak={streak}
          saved={result}
          returning={returning}
          onPlayAgain={playAgain}
        />
      )}

      <footer className="footer">
        An independent fan project. Not affiliated with or endorsed by{' '}
        {school.name}. Player data curated from public sources.
      </footer>
    </div>
  )
}

function FbLanding({
  school,
  mode,
  dateKey,
  playable,
  provisional,
  streak,
  onStart,
}: {
  school: School
  mode: ModeConfig
  dateKey: string
  /** False when this school has no draftable football wheel (no data yet). */
  playable: boolean
  /** Mock/placeholder data — surfaced so playtesters know stats aren't real yet. */
  provisional: boolean
  streak: Streak
  onStart: () => void
}) {
  return (
    <section className="hero">
      <span className="banner">
        {mode.daily
          ? `🗓️ Daily Challenge · ${dateKey}`
          : `${mode.emoji} ${mode.name}`}
      </span>
      <h1>Build {school.name}'s all-time roster.</h1>
      <p>
        {mode.daily
          ? 'Eras spin in a fixed order today — the same for everyone. '
          : 'Eras spin fresh every game. '}
        Draft 12 starters: six on offense (QB, RB, WR, TE, two FLEX), then six
        on defense (DE, DT, LB, CB, S, FLEX). You get{' '}
        <strong>one re-spin per side</strong>. How close to a perfect{' '}
        <strong>16&ndash;0</strong> can you get?
      </p>
      {mode.hideStats && (
        <p className="muted">
          🧠 Gridiron IQ: stats, ratings, and award stars stay hidden while you
          draft — go on names alone. Everything reveals at the end.
        </p>
      )}
      {provisional && (
        <p className="muted">
          🧪 Mock data: this roster uses placeholder stats so the flow can be
          tested end to end. Real, sourced numbers land once it plays right.
        </p>
      )}
      {mode.daily && <StreakChips streak={streak} />}
      {playable ? (
        <button className="btn primary" onClick={onStart}>
          {mode.daily ? "▶ Play Today's Challenge" : `▶ Play ${mode.name}`}
        </button>
      ) : (
        <p className="muted">
          No {school.name} football data yet — check back soon.
        </p>
      )}
    </section>
  )
}

function FbRosterRail({
  slots,
  targetable,
  onPlace,
  hideRating,
  power5,
}: {
  slots: FbDraftState['slots']
  /** Slot ids the selected player can be placed into (highlighted + tappable). */
  targetable?: string[]
  onPlace?: (slotId: string) => void
  /** Gridiron IQ: suppress the numeric rating while drafting (shown at Results). */
  hideRating?: boolean
  /** Conference strength — false applies the non-power-5 rating haircut. */
  power5: boolean
}) {
  const targets = new Set(targetable ?? [])
  const sides: { side: 'offense' | 'defense'; label: string }[] = [
    { side: 'offense', label: 'Offense' },
    { side: 'defense', label: 'Defense' },
  ]
  return (
    <>
      {sides.map((grp) => (
        <div className="fb-rail-group" key={grp.side}>
          <div className="fb-rail-label">{grp.label}</div>
          <div className="rail fb">
            {FB_SLOTS.filter((slot) => slot.side === grp.side).map((slot) => {
              const p = slots[slot.id]
              const isTarget = targets.has(slot.id)
              return (
                <div
                  key={slot.id}
                  className={`slot ${p ? 'filled' : 'open'}${isTarget ? ' target' : ''}`}
                  onClick={() => isTarget && onPlace?.(slot.id)}
                  role={isTarget ? 'button' : undefined}
                >
                  <div className="pos">{slot.label}</div>
                  {p ? (
                    <>
                      <div className="pname">{p.name}</div>
                      {!hideRating && (
                        <div className="prate">{fbPlayerRating(p, power5)}</div>
                      )}
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
        </div>
      ))}
    </>
  )
}

function FbPlaying({
  players,
  state,
  wheel,
  hideStats,
  power5,
  onAdvance,
}: {
  players: FbPlayer[]
  state: FbDraftState
  /** The full rolling era wheel — the reel animation flashes labels from it. */
  wheel: YearWindow[]
  /** Gridiron IQ: hide the box-score + rating + award stars while drafting. */
  hideStats: boolean
  power5: boolean
  onAdvance: (s: FbDraftState) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [rolling, setRolling] = useState(false)
  const timeoutRef = useRef<number | undefined>(undefined)
  const rafRef = useRef<number | undefined>(undefined)
  const reduced = usePrefersReducedMotion()
  const w = currentFbWindow(state)
  const side = fbCurrentSide(state)
  const era = fbPlayersThisEra(state, players)
  const selected = selectedId
    ? (era.find((p) => p.id === selectedId) ?? null)
    : null
  const targetSlotIds = selected
    ? fbEligibleOpenSlots(state, selected).map((s) => s.id)
    : []
  const canRespin = fbCanRespin(state)
  const respinsLeft = FB_RESPINS_PER_SIDE - state.respinsUsed[side]

  const targetYear = w?.start ?? null
  const plan = useMemo(
    () => (targetYear === null ? null : buildReelPlan(wheel, targetYear)),
    [wheel, targetYear],
  )

  // The current side's positions, in roster order. `era` is already side-filtered
  // by the engine, so grouping by these covers exactly the draftable pool.
  const sidePositions = side === 'offense' ? FB_OFF_POSITIONS : FB_DEF_POSITIONS
  // A position is "covered" when no OPEN slot on this side still accepts it (its
  // dedicated slot and every eligible FLEX are filled) — drives the covered tag.
  const openAcceptsPos = (pos: FbPosition) =>
    FB_SLOTS.some(
      (slot) =>
        slot.side === side &&
        state.slots[slot.id] === null &&
        slot.accepts.includes(pos),
    )
  const groups = sidePositions
    .map((pos) => ({
      pos,
      // Rating is window-independent for football (one stat line per player), so
      // normally sort best-first by rating. In Gridiron IQ that would leak the
      // hidden ranking, so sort by name instead — the order reveals nothing.
      players: era
        .filter((p) => p.position === pos)
        .sort((a, b) =>
          hideStats
            ? a.name.localeCompare(b.name)
            : fbPlayerRating(b, power5) - fbPlayerRating(a, power5),
        ),
    }))
    .filter((g) => g.players.length > 0)

  function place(slotId: string) {
    if (!selected) return
    onAdvance(fbDraftToSlot(state, selected, slotId))
    setSelectedId(null)
  }

  function selectPlayer(p: FbPlayer) {
    if (!fbIsPickable(state, p)) return
    const slots = fbEligibleOpenSlots(state, p)
    if (slots.length === 1) {
      onAdvance(fbDraftToSlot(state, p, slots[0].id))
      setSelectedId(null)
    } else {
      setSelectedId(p.id) // multi-slot (FLEX): let them choose in the rail
    }
  }

  useLayoutEffect(() => {
    setReveal(false)
    setSpinning(false)
    setRolling(false)
    setSelectedId(null)
    return () => {
      window.clearTimeout(timeoutRef.current)
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [state.cursor])

  function spin() {
    if (!w || spinning || reveal || !plan) return
    if (import.meta.env.DEV && !plan.found) {
      console.warn(`spin: target year ${targetYear} not on the wheel`)
    }
    if (reduced) {
      setReveal(true)
      return
    }
    setSpinning(true)
    setRolling(false)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setRolling(true))
    })
    timeoutRef.current = window.setTimeout(() => {
      setSpinning(false)
      setReveal(true)
    }, SPIN_MS)
  }

  return (
    <section>
      <FbRosterRail
        slots={state.slots}
        targetable={targetSlotIds}
        onPlace={place}
        hideRating={hideStats}
        power5={power5}
      />

      {!reveal ? (
        <div className="spinbar">
          <div className="wheel" aria-hidden="true">
            {rolling && <div className="wheel-band" />}
            <div
              className="wheel-col"
              style={{
                transform: `translateY(calc(var(--reel-cell) * ${
                  rolling && plan ? -plan.offset : 0
                }))`,
                transition: rolling
                  ? `transform ${SPIN_MS - 80}ms cubic-bezier(0.1, 0.62, 0.22, 1)`
                  : 'none',
              }}
            >
              {(plan?.cells ?? []).map((y, i) => (
                <div className="wheel-cell" key={i}>
                  {y}
                </div>
              ))}
            </div>
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
                {side === 'offense' ? 'Offense' : 'Defense'} · Era{' '}
                {Math.min(state.cursor + 1, state.windows.length)} /{' '}
                {state.windows.length}
              </small>
            </div>
            <button
              className="btn"
              disabled={!canRespin}
              onClick={() => {
                setSelectedId(null)
                onAdvance(fbRespin(state))
              }}
              title={
                canRespin
                  ? 'Re-spin this era (advance to the next without drafting)'
                  : 'No re-spins left on this side'
              }
            >
              🔄 Re-spin {side === 'offense' ? 'O' : 'D'} ({respinsLeft})
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

          {groups.map((g) => {
            const cols = FB_STAT_COLS[g.pos]
            const covered = !openAcceptsPos(g.pos)
            return (
              <div className="pos-group" key={g.pos}>
                <div className="pos-group-head">
                  <span className="pos-chip">{g.pos}</span>
                  {covered && (
                    <span className="filled-tag">{g.pos} covered</span>
                  )}
                </div>
                <table className="pool">
                  <thead>
                    <tr>
                      <th className="name">Player</th>
                      {/* Gridiron IQ hides the box-score columns while drafting. */}
                      {!hideStats && <th>YR</th>}
                      {!hideStats &&
                        cols.map((c) => <th key={c.key}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {g.players.map((p) => {
                      const pickable = fbIsPickable(state, p)
                      return (
                        <tr
                          key={p.id}
                          className={`player${pickable ? '' : ' locked'}${selectedId === p.id ? ' selected' : ''}`}
                          onClick={() => selectPlayer(p)}
                        >
                          <td className="name">
                            {p.name}
                            {/* Hide the ★ in Gridiron IQ: it's a strong "good
                                player" tell, and the honor strings embed the year
                                (leaking the hidden season via the tooltip). */}
                            {!hideStats && p.honors.length > 0 && (
                              <span
                                className="honor"
                                title={p.honors.join(', ')}
                              >
                                ★
                              </span>
                            )}
                          </td>
                          {!hideStats && <td className="yr">{fmtFbYear(p)}</td>}
                          {!hideStats &&
                            cols.map((c) => (
                              <td key={c.key}>{fmtFbStat(p.stats, c.key)}</td>
                            ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function FbResults({
  school,
  mode,
  state,
  dateKey,
  streak,
  saved,
  returning,
  onPlayAgain,
}: {
  school: School
  mode: ModeConfig
  state: FbDraftState
  dateKey: string
  streak: Streak
  /** The persisted result for this day; its EARNED wins/grade win over a re-rate. */
  saved: SavedDaily | null
  returning: boolean
  onPlayAgain: () => void
}) {
  // Live re-rate drives the per-row RTG + team strength; the headline record +
  // share use the EARNED wins/grade from the save when present (a stats fix
  // between play and replay must never rewrite what you scored).
  const live = fbEvaluate(state, school.power5)
  const strength = Math.round(live.strength)
  const wins = saved?.wins ?? live.wins
  const grade = saved?.grade ?? live.grade
  const ratings = FB_SLOTS.map((slot) => live.ratingBySlot[slot.id] ?? null)

  const share = buildFbShareString({
    schoolName: school.short,
    dateKey,
    wins,
    games: FB_GAMES,
    grade,
    ratings,
    daily: mode.daily,
    modeLabel: mode.name,
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
        <div className="big">
          {wins}&ndash;{FB_GAMES - wins}
        </div>
        <div className="grade">{grade}</div>
        <p className="muted">Team strength {strength} / 100</p>
        {mode.daily && <StreakChips streak={streak} />}
      </div>

      <FbRosterRail slots={state.slots} power5={school.power5} />

      <div className="card" style={{ marginTop: 16 }}>
        <table className="pool">
          <thead>
            <tr>
              <th className="name">Your roster</th>
              <th>POS</th>
              <th>YR</th>
              <th>RTG</th>
            </tr>
          </thead>
          <tbody>
            {FB_SLOTS.map((slot) => {
              const p = state.slots[slot.id]
              return (
                <tr key={slot.id}>
                  <td className="name">
                    <span className="pos-chip">{slot.label}</span>
                    {p ? p.name : <span className="muted">(empty)</span>}
                  </td>
                  <td>{p ? p.position : '—'}</td>
                  <td className="yr">{p ? fmtFbYear(p) : '—'}</td>
                  <td>{p ? fbPlayerRating(p, school.power5) : '—'}</td>
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
        {!mode.daily && (
          <button className="btn" onClick={onPlayAgain}>
            🔄 Play again
          </button>
        )}
      </div>
      <p className="center muted" style={{ marginTop: 14 }}>
        {mode.daily
          ? 'New challenge at midnight ET. Come back tomorrow.'
          : `Free play — spin up another ${mode.name} roster any time.`}
      </p>
    </section>
  )
}
