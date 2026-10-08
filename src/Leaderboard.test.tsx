import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LeaderboardPanel } from './Leaderboard'

const ENDPOINT = 'https://ysas-leaderboard.example.workers.dev'

function okResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => '' }
}

const PROPS = {
  school: 'michigan',
  schoolLabel: 'Michigan',
  sport: 'basketball',
  mode: 'daily' as const,
  modeLabel: 'Daily Challenge',
  dateKey: '2026-10-08',
  games: 40,
  onClose: () => {},
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  vi.stubEnv('VITE_LEADERBOARD_ENDPOINT', ENDPOINT)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('LeaderboardPanel', () => {
  it('lists the day’s finishers ranked by overall /100 with their record, flagging yours', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          total: 3,
          rows: [
            { strength: 92, score: 38 },
            { strength: 80, score: 34 },
            { strength: 70, score: 30 },
          ],
        }),
      ),
    )
    render(<LeaderboardPanel {...PROPS} yours={{ strength: 80, score: 34 }} />)
    expect(await screen.findByText(/3 players today/)).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toMatch(/#1/)
    expect(rows[0].textContent).toMatch(/92/)
    expect(rows[0].textContent).toMatch(/\/100/)
    expect(rows[0].textContent).toMatch(/38–2/)
    expect(rows[1].textContent).toMatch(/#2/)
    expect(rows[1].textContent).toMatch(/you/i)
    expect(rows[0].textContent).not.toMatch(/you/i)
    expect(rows[2].textContent).toMatch(/30–10/)
  })

  it('shows your standing when your result is below the shown list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          ok: true,
          total: 150,
          rows: [{ strength: 92, score: 38 }],
        }),
      ),
    )
    render(
      <LeaderboardPanel
        {...PROPS}
        yours={{ strength: 40, score: 20 }}
        standing={{ rank: 120, total: 150 }}
      />,
    )
    expect(await screen.findByText(/You placed 120th of 150/)).toBeTruthy()
  })

  it('shows an empty state when nobody has finished', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ ok: true, total: 0, rows: [] })),
    )
    render(<LeaderboardPanel {...PROPS} />)
    expect(await screen.findByText(/No one has finished/)).toBeTruthy()
  })

  it('says the board is unavailable when the fetch fails', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    render(<LeaderboardPanel {...PROPS} />)
    expect(await screen.findByText(/couldn’t load/i)).toBeTruthy()
    spy.mockRestore()
  })

  it('uses the football record length and calls onClose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({ ok: true, total: 1, rows: [{ strength: 75, score: 12 }] }),
      ),
    )
    const onClose = vi.fn()
    render(
      <LeaderboardPanel
        {...PROPS}
        sport="football"
        games={16}
        onClose={onClose}
      />,
    )
    expect((await screen.findAllByRole('listitem'))[0].textContent).toMatch(
      /12–4/,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
