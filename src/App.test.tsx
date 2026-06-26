import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { BballPlayer } from './types'
import { initDraft } from './lib/game'
import { Playing, RosterRail } from './App'

// Force prefers-reduced-motion so spin() reveals the pool synchronously (no
// rAF/timeout to await) — we want to assert on the revealed table, not animate.
beforeEach(() => {
  cleanup()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

const WHEEL = [{ start: 2000, end: 2003 }]

function player(
  id: string,
  position: BballPlayer['position'],
  pts: number,
): BballPlayer {
  return {
    id,
    position,
    name: `${id} Player`,
    firstYear: 2000,
    lastYear: 2003,
    seasons: [
      {
        year: 2001,
        stats: { pts, reb: 5, ast: 4, stl: 2, blk: 1 },
        honors: ['Consensus All-American (2001)'],
        source: 'https://example.test/fixture',
      },
    ],
  }
}

const PLAYERS = [player('alpha', 'PG', 22.5), player('bravo', 'SG', 18.3)]

function renderPlaying(hideStats: boolean) {
  const state = initDraft(WHEEL)
  render(
    <Playing
      players={PLAYERS}
      state={state}
      wheel={WHEEL}
      hideStats={hideStats}
      onAdvance={() => {}}
    />,
  )
  // The pool is hidden behind the spin; click to reveal it (reduced-motion =
  // instant reveal).
  fireEvent.click(screen.getByRole('button', { name: /Spin/ }))
}

describe('Playing — Hoops IQ stat hiding', () => {
  it('shows the box-score columns and values when hideStats is false', () => {
    renderPlaying(false)
    // One table per position group (PG, SG), so headers appear more than once.
    expect(screen.getAllByText('PTS').length).toBeGreaterThan(0)
    expect(screen.getAllByText('YR').length).toBeGreaterThan(0)
    expect(screen.getByText('22.5')).toBeTruthy() // unique to the PG fixture
  })

  it('hides every box-score number while drafting when hideStats is true', () => {
    renderPlaying(true)
    // Headers gone…
    expect(screen.queryByText('PTS')).toBeNull()
    expect(screen.queryByText('REB')).toBeNull()
    expect(screen.queryByText('YR')).toBeNull()
    // …and no stat value leaks anywhere in the DOM.
    expect(screen.queryByText('22.5')).toBeNull()
    expect(screen.queryByText('18.3')).toBeNull()
    // The player is still draftable (name shown), just numbers-free.
    expect(screen.getByText('alpha Player')).toBeTruthy()
  })

  it('hides the award ★ entirely in Hoops IQ (it hints who is decorated)', () => {
    renderPlaying(true)
    // The fixture players carry an All-American honor, but Hoops IQ must not
    // surface ANY star — the goal is to draft on names alone, and a star is a
    // strong "this one is good" tell (and its tooltip would leak the year).
    expect(screen.queryAllByText('★')).toHaveLength(0)
  })

  it('shows the award ★ (with a tooltip) when stats are visible', () => {
    renderPlaying(false)
    // Both fixture players are decorated ⇒ one star each.
    const stars = screen.getAllByText('★')
    expect(stars).toHaveLength(PLAYERS.length)
    // The tooltip lists the honor when nothing is hidden.
    expect(stars[0].getAttribute('title')).toContain('All-American')
  })
})

describe('RosterRail — hideRating', () => {
  const slots = {
    PG: PLAYERS[0],
    SG: null,
    SF: null,
    PF: null,
    C: null,
  }

  it('shows the numeric rating by default', () => {
    const { container } = render(<RosterRail slots={slots} />)
    expect(container.querySelector('.prate')).not.toBeNull()
  })

  it('suppresses the rating when hideRating is true', () => {
    const { container } = render(<RosterRail slots={slots} hideRating />)
    expect(container.querySelector('.prate')).toBeNull()
    // The drafted name still shows — only the number is hidden.
    expect(screen.getByText('alpha Player')).toBeTruthy()
  })
})
