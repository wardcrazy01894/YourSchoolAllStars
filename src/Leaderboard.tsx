/**
 * LeaderboardPanel — the day's board for one game (school · sport · mode):
 * every finisher's OVERALL out of 100 (team strength), their projected record
 * beside it, competition-ranked, with the viewer's own row flagged.
 *
 * Anonymous: the server returns numbers only (no ids, no names). Read-only and
 * best-effort: a load failure shows a friendly line, never an error that
 * blocks the screen it's embedded in. One fetch per open.
 */

import { useEffect, useState } from 'react'
import {
  fetchLeaderboard,
  buildLeaderboardRows,
  ordinal,
  type BoardEntry,
  type LeaderboardRow,
  type Standing,
} from './lib/leaderboard'
import type { GameMode } from './lib/modes'

export interface LeaderboardPanelProps {
  school: string
  schoolLabel: string
  sport: string
  mode: GameMode
  modeLabel: string
  dateKey: string
  /** Games in a season (40 basketball / 16 football) — renders the W–L. */
  games: number
  /** The viewer's own result today, to flag their row. Pass it ONLY when the
   *  play actually reached the server (i.e. a standing exists) — otherwise a
   *  stranger with the same numbers would be flagged as you. */
  yours?: BoardEntry
  /** The viewer's submit-time standing — the "You placed Xth of Y when you
   *  finished" line when their result is below the returned (capped) list.
   *  Its arrival also triggers a re-read, so a board opened before the
   *  submit landed picks up the viewer's own row. */
  standing?: Standing | null
  onClose: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'failed' }
  | { phase: 'ready'; rows: LeaderboardRow[]; total: number }

export function LeaderboardPanel({
  school,
  schoolLabel,
  sport,
  mode,
  modeLabel,
  dateKey,
  games,
  yours,
  standing,
  onClose,
}: LeaderboardPanelProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let live = true
    fetchLeaderboard(school, sport, mode, dateKey).then((board) => {
      if (!live) return
      if (!board) return setState({ phase: 'failed' })
      if (board.rows.length === 0) return setState({ phase: 'empty' })
      setState({
        phase: 'ready',
        rows: buildLeaderboardRows(board.rows, yours),
        total: board.total,
      })
    })
    return () => {
      live = false
    }
    // One fetch per open, plus one more when the viewer's own submit lands
    // (standing goes from null to a value) so their row appears. `yours` is
    // read from the same render as `standing` and never changes on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school, sport, mode, dateKey, standing?.rank])

  // When the viewer's row is on the board it's flagged in place. When it's
  // below the shown (capped) list, fall back to their submit-time standing —
  // rank AND total from that moment, worded as a snapshot, never mixed with
  // today's total.
  const youShown = state.phase === 'ready' && state.rows.some((r) => r.you)
  const yourLine =
    state.phase === 'ready' && !youShown && yours && standing
      ? `You placed ${ordinal(standing.rank)} of ${standing.total.toLocaleString(
          'en-US',
        )} when you finished`
      : null

  return (
    <section className="board card" aria-label="Today's leaderboard">
      <div className="board-head">
        <div>
          <h3>🏆 Today's leaderboard</h3>
          <p className="muted">
            {schoolLabel} · {modeLabel} · {dateKey}
            {state.phase === 'ready' && (
              <>
                {' · '}
                {state.total.toLocaleString('en-US')}{' '}
                {state.total === 1 ? 'player' : 'players'} today
              </>
            )}
          </p>
        </div>
        <button className="btn ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {state.phase === 'loading' && <p className="muted">Loading…</p>}
      {state.phase === 'empty' && (
        <p className="muted">No one has finished yet today — be the first!</p>
      )}
      {state.phase === 'failed' && (
        <p className="muted">Couldn’t load the leaderboard right now.</p>
      )}

      {state.phase === 'ready' && (
        <>
          <ol className="board-list">
            {state.rows.map((r, i) => (
              <li key={i} className={r.you ? 'board-row you' : 'board-row'}>
                <span className="board-rank">#{r.rank}</span>
                <span className="board-overall">
                  {r.strength}
                  <small> /100</small>
                </span>
                <span className="board-record">
                  {r.score}–{games - r.score}
                </span>
                {r.you && <span className="board-you">you</span>}
              </li>
            ))}
          </ol>
          {yourLine && <p className="standing">🏆 {yourLine}</p>}
        </>
      )}
    </section>
  )
}
