import { describe, it, expect } from 'vitest'
import { ratingSquare, buildShareString } from './share'

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
})
