import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { BballPlayer, FbPlayer } from './types'
import { initDraft } from './lib/game'
import { initFbDraft } from './lib/football-game'
import { getMode } from './lib/modes'
import { getSchool, DEFAULT_SCHOOL_ID } from './schools'
import { Playing, RosterRail, Results, FbPlaying } from './App'

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

  it('hides award badges entirely in Hoops IQ (they hint who is decorated)', () => {
    renderPlaying(true)
    // The fixture players carry an All-American honor, but Hoops IQ must not
    // surface ANY badge — the goal is to draft on names alone, and a badge is
    // a strong "this one is good" tell (and its tooltip would leak the year).
    expect(screen.queryAllByText('🌟')).toHaveLength(0)
    expect(screen.queryAllByText('★')).toHaveLength(0)
  })

  it('shows a per-award badge (with a tooltip) when stats are visible', () => {
    renderPlaying(false)
    // Both fixture players carry an All-American honor ⇒ one 🌟 badge each,
    // not the old generic ★. Filter to tooltip-bearing badges: the badge key
    // at the foot of the pool also shows a 🌟, but without a title.
    const badges = screen
      .getAllByText('🌟')
      .filter((el) => el.getAttribute('title'))
    expect(badges).toHaveLength(PLAYERS.length)
    // The tooltip names the honor when nothing is hidden.
    expect(badges[0].getAttribute('title')).toContain('All-American')
  })

  it('offers a collapsible badge key when stats are visible (mobile has no hover)', () => {
    renderPlaying(false)
    expect(screen.getByText(/what do the badges mean/i)).toBeTruthy()
    // Expanding it lists every badge with its meaning.
    fireEvent.click(screen.getByText(/what do the badges mean/i))
    expect(screen.getByText('National Player of the Year')).toBeTruthy()
    expect(screen.getByText('First-Team All-Conference')).toBeTruthy()
  })

  it('places the badge key above the pool tables where it gets seen', () => {
    renderPlaying(false)
    const summary = screen.getByText(/what do the badges mean/i)
    const firstTable = document.querySelector('table.pool')
    expect(firstTable).toBeTruthy()
    // The key precedes the first pool table in document order.
    expect(
      summary.compareDocumentPosition(firstTable!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hides the badge key in Hoops IQ (no badges ⇒ nothing to explain)', () => {
    renderPlaying(true)
    expect(screen.queryByText(/what do the badges mean/i)).toBeNull()
  })
})

describe('Results — award badges on the final roster', () => {
  function renderResults() {
    const state = initDraft(WHEEL)
    state.slots.PG = PLAYERS[0]
    state.picks = [{ player: PLAYERS[0], position: 'PG', window: WHEEL[0] }]
    render(
      <Results
        school={getSchool(DEFAULT_SCHOOL_ID)!}
        mode={getMode('daily')}
        state={state}
        dateKey="2026-07-10"
        streak={{ current: 1, max: 1, lastDate: null }}
        saved={null}
        returning={false}
        onPlayAgain={() => {}}
      />,
    )
  }

  it('shows each starter’s award badges next to their name', () => {
    renderResults()
    // The PG fixture carries an All-American honor ⇒ its 🌟 badge (with the
    // explaining tooltip) appears on the final roster table too.
    const badges = screen
      .getAllByText('🌟')
      .filter((el) => el.getAttribute('title'))
    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute('title')).toContain('All-American')
  })

  it('offers the badge key so mobile players can decode the badges', () => {
    renderResults()
    expect(screen.getByText(/what do the badges mean/i)).toBeTruthy()
  })
})

describe('FbPlaying — award badges and key', () => {
  function fbPlayer(id: string, honors: string[]): FbPlayer {
    return {
      id,
      name: `${id} Player`,
      position: 'QB',
      firstYear: 2000,
      lastYear: 2003,
      bestSeason: 2001,
      stats: { passYds: 3000, passTD: 25, passInt: 6, rushYds: 200 },
      honors,
      source: 'https://example.test/fixture',
    }
  }

  function renderFbPlaying(hideStats: boolean, honors: string[]) {
    render(
      <FbPlaying
        players={[fbPlayer('alpha', honors)]}
        state={initFbDraft(WHEEL)}
        wheel={WHEEL}
        hideStats={hideStats}
        power5={true}
        onAdvance={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Spin/ }))
  }

  const HONORS = ['First-Team All-Big Ten (2001)']

  it('shows badges and the key when stats are visible', () => {
    renderFbPlaying(false, HONORS)
    const badges = screen
      .getAllByText('🥇')
      .filter((el) => el.getAttribute('title'))
    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute('title')).toContain('All-Big Ten')
    expect(screen.getByText(/what do the badges mean/i)).toBeTruthy()
  })

  it('hides badges AND the key in Gridiron IQ', () => {
    renderFbPlaying(true, HONORS)
    expect(screen.queryAllByText('🥇')).toHaveLength(0)
    expect(screen.queryByText(/what do the badges mean/i)).toBeNull()
  })

  it('hides the key while the pool carries no honors (today’s football data)', () => {
    renderFbPlaying(false, [])
    expect(screen.queryByText(/what do the badges mean/i)).toBeNull()
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
