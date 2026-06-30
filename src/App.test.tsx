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
      power5Of={() => true}
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
    const { container } = render(
      <RosterRail slots={slots} power5Of={() => true} />,
    )
    expect(container.querySelector('.prate')).not.toBeNull()
  })

  it('suppresses the rating when hideRating is true', () => {
    const { container } = render(
      <RosterRail slots={slots} hideRating power5Of={() => true} />,
    )
    expect(container.querySelector('.prate')).toBeNull()
    // The drafted name still shows — only the number is hidden.
    expect(screen.getByText('alpha Player')).toBeTruthy()
  })

  it('shows a lower RTG for a non-power-5 school (conference haircut)', () => {
    const big10 = render(<RosterRail slots={slots} power5Of={() => true} />)
    const power5Rtg = Number(
      big10.container.querySelector('.prate')!.textContent,
    )
    cleanup()
    const a10 = render(<RosterRail slots={slots} power5Of={() => false} />)
    const midMajorRtg = Number(
      a10.container.querySelector('.prate')!.textContent,
    )
    expect(midMajorRtg).toBeLessThan(power5Rtg)
  })

  it('rates each starter on its OWN power-5 flag (per-player, not team-wide)', () => {
    // A mixed rail: PG resolves power5=true, SG power5=false. The SG must be
    // dinged while the PG keeps its full power-5 rating — proving the haircut is
    // applied per player, never to the whole team.
    const mixed = { ...slots, PG: PLAYERS[0], SG: PLAYERS[1] }
    const power5Of = (p: BballPlayer) => p.position !== 'SG'
    const { container } = render(
      <RosterRail slots={mixed} power5Of={power5Of} />,
    )
    const rates = [...container.querySelectorAll('.prate')].map((n) =>
      Number(n.textContent),
    )
    // Same player flagged both ways: power-5 value beats the haircut value.
    const pgPower5 = render(
      <RosterRail slots={{ ...slots, PG: PLAYERS[1] }} power5Of={() => true} />,
    ).container.querySelector('.prate')!.textContent
    const pgHaircut = render(
      <RosterRail
        slots={{ ...slots, PG: PLAYERS[1] }}
        power5Of={() => false}
      />,
    ).container.querySelector('.prate')!.textContent
    // The SG slot in the mixed rail took the haircut value, not the power-5 one.
    expect(rates).toContain(Number(pgHaircut))
    expect(Number(pgHaircut)).toBeLessThan(Number(pgPower5))
  })

  it('renders a school-origin tag only when schoolTag is supplied (Full mode)', () => {
    const plain = render(<RosterRail slots={slots} power5Of={() => true} />)
    expect(plain.container.querySelector('.school-tag')).toBeNull()
    cleanup()
    const full = render(
      <RosterRail
        slots={slots}
        power5Of={() => true}
        schoolTag={() => ({ emoji: '〽️', name: 'Michigan' })}
      />,
    )
    const tag = full.container.querySelector('.school-tag')
    expect(tag).not.toBeNull()
    expect(tag!.textContent).toContain('Michigan')
  })
})

describe('Playing — Full Basketball era label', () => {
  it('prefixes the era bar with the spun school when eraTag is supplied', () => {
    const state = initDraft(WHEEL)
    render(
      <Playing
        players={PLAYERS}
        state={state}
        wheel={WHEEL}
        hideStats={false}
        power5Of={() => true}
        onAdvance={() => {}}
        teamReel={[{ emoji: '〽️', name: 'Michigan' }]}
        teamTarget={0}
        eraTag={{ emoji: '〽️', name: 'Michigan' }}
        schoolTag={() => ({ emoji: '〽️', name: 'Michigan' })}
      />,
    )
    // Reduced motion reveals instantly; the era bar then names the school.
    fireEvent.click(screen.getByRole('button', { name: /Spin/ }))
    expect(screen.getByText(/Michigan/)).toBeTruthy()
  })
})
