import { describe, it, expect } from 'vitest'
import {
  SPORTS,
  DEFAULT_SPORT_ID,
  getSport,
  isSportId,
  sportsForSchool,
  sportPlayableForSchool,
} from './sports'
import type { School } from '../schools'
import type { Dataset, FootballDataset } from '../data'

const bballDataset = { players: [] } as unknown as Dataset
const fbDataset = { players: [] } as unknown as FootballDataset

const school = (over: Partial<School>): School => ({
  id: 'x',
  name: 'X',
  short: 'X',
  mascot: 'Xs',
  emoji: '❌',
  theme: { brand: '#000', brand2: '#111', accent: '#fff', ink: '#000' },
  hasFootball: true,
  power5: true,
  available: true,
  ...over,
})

describe('sports registry', () => {
  it('has both basketball and football playable', () => {
    expect(getSport('basketball').available).toBe(true)
    expect(getSport('football').available).toBe(true)
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
    const offered = sportsForSchool(school({ hasFootball: true })).map(
      (s) => s.id,
    )
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

describe('sportPlayableForSchool', () => {
  it('basketball is playable when the school carries a basketball dataset', () => {
    expect(
      sportPlayableForSchool(
        school({ basketball: bballDataset }),
        'basketball',
      ),
    ).toBe(true)
  })

  it('football is playable only when the school carries a football dataset', () => {
    expect(
      sportPlayableForSchool(
        school({ hasFootball: true, football: fbDataset }),
        'football',
      ),
    ).toBe(true)
  })

  it('football is NOT playable (coming soon) for a school with no football dataset', () => {
    // Every non-Michigan school fields football but has no curated dataset yet —
    // the card shows as "coming soon", not a playable draft.
    expect(
      sportPlayableForSchool(
        school({ hasFootball: true, football: undefined }),
        'football',
      ),
    ).toBe(false)
  })
})
