import { describe, it, expect } from 'vitest'
import { ratingSquare, buildShareString, buildFbShareString } from './share'

describe('ratingSquare', () => {
  it('maps rating tiers to squares', () => {
    expect(ratingSquare(95)).toBe('🟩')
    expect(ratingSquare(80)).toBe('🟦')
    expect(ratingSquare(65)).toBe('🟨')
    expect(ratingSquare(40)).toBe('🟥')
    expect(ratingSquare(null)).toBe('⬛')
  })
})

describe('buildShareString', () => {
  it('is spoiler-free (no player names) and includes record + grade', () => {
    const out = buildShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 34,
      games: 40,
      grade: 'SOLID',
      ratingsByPosition: { PG: 95, SG: 80, SF: 65, PF: 40, C: null },
    })
    expect(out).toContain('Michigan')
    expect(out).toContain('Daily 2026-06-25')
    expect(out).toContain('34–6 · SOLID')
    expect(out).toContain('🟩🟦🟨🟥⬛')
    expect(out).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/) // no "First Last" names
  })

  it('free-play shares are labelled by mode, never "Daily"', () => {
    const out = buildShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 31,
      games: 40,
      grade: 'GREAT',
      ratingsByPosition: { PG: 95, SG: 80, SF: 65, PF: 40, C: null },
      daily: false,
      modeLabel: 'Classic',
    })
    expect(out).toContain('Classic')
    expect(out).not.toContain('Daily')
    expect(out).not.toContain('2026-06-25') // free play isn't tied to a date
  })

  it('the Daily IQ variant labels its share "Daily IQ <date>", not just "Daily"', () => {
    const out = buildShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 28,
      games: 40,
      grade: 'GOOD',
      ratingsByPosition: { PG: 95, SG: 80, SF: 65, PF: 40, C: null },
      dailyLabel: 'Daily IQ',
    })
    expect(out).toContain('Daily IQ 2026-06-25')
    // Guard against a double-subtitle regression emitting the plain label too.
    expect(out).not.toContain('\nDaily 2026-06-25')
  })
})

describe('buildFbShareString', () => {
  it('renders the 12-man roster as squares, record out of 16, no names', () => {
    const out = buildFbShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 13,
      games: 16,
      grade: 'ELITE',
      ratings: [95, 80, 65, 40, null, 95, 80, 80, 65, 65, 40, null],
    })
    expect(out).toContain('🏈')
    expect(out).toContain('Michigan')
    expect(out).toContain('Daily 2026-06-25')
    expect(out).toContain('13–3 · ELITE')
    expect(out).toContain('🟩🟦🟨🟥⬛🟩🟦🟦🟨🟨🟥⬛')
    expect(out).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/)
  })

  it('free-play football shares are labelled by mode, never "Daily"', () => {
    const out = buildFbShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 10,
      games: 16,
      grade: 'SOLID',
      ratings: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
      daily: false,
      modeLabel: 'Classic',
    })
    expect(out).toContain('Classic')
    expect(out).not.toContain('Daily')
    expect(out).not.toContain('2026-06-25')
  })

  it('the Daily IQ variant labels its football share "Daily IQ <date>"', () => {
    const out = buildFbShareString({
      schoolName: 'Michigan',
      dateKey: '2026-06-25',
      wins: 11,
      games: 16,
      grade: 'GOOD',
      ratings: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
      dailyLabel: 'Daily IQ',
    })
    expect(out).toContain('Daily IQ 2026-06-25')
    expect(out).not.toContain('\nDaily 2026-06-25')
  })
})
