import { describe, it, expect } from 'vitest'
import {
  SPORTS,
  DEFAULT_SPORT_ID,
  getSport,
  isSportId,
  sportsForSchool,
} from './sports'
import type { School } from '../schools'

const school = (over: Partial<School>): School => ({
  id: 'x',
  name: 'X',
  short: 'X',
  mascot: 'Xs',
  emoji: '❌',
  theme: { brand: '#000', brand2: '#111', accent: '#fff', ink: '#000' },
  hasFootball: true,
  available: true,
  ...over,
})

describe('sports registry', () => {
  it('has basketball available and football scaffolded (not yet playable)', () => {
    expect(getSport('basketball').available).toBe(true)
    expect(getSport('football').available).toBe(false)
  })

  it('defaults to basketball for an unknown / missing id', () => {
    expect(getSport('curling').id).toBe(DEFAULT_SPORT_ID)
    expect(getSport(null).id).toBe('basketball')
    expect(getSport(undefined).id).toBe('basketball')
  })

  it('validates sport ids (gate untrusted ?sport= params)', () => {
    expect(isSportId('basketball')).toBe(true)
    expect(isSportId('football')).toBe(true)
    expect(isSportId('hockey')).toBe(false)
    expect(isSportId(null)).toBe(false)
  })

  it('every sport carries a non-empty name, emoji, and blurb', () => {
    for (const s of SPORTS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.emoji.length).toBeGreaterThan(0)
      expect(s.blurb.length).toBeGreaterThan(0)
    }
  })
})

describe('sportsForSchool', () => {
  it('offers basketball + football for a school that fields football', () => {
    const offered = sportsForSchool(school({ hasFootball: true })).map((s) => s.id)
    expect(offered).toEqual(['basketball', 'football'])
  })

  it('offers basketball only for a school with no football program (e.g. VCU)', () => {
    const offered = sportsForSchool(school({ hasFootball: false })).map(
      (s) => s.id,
    )
    expect(offered).toEqual(['basketball'])
  })

  it('always lists basketball first (the flagship sport)', () => {
    expect(sportsForSchool(school({}))[0].id).toBe('basketball')
  })
})
