import { describe, it, expect } from 'vitest'
import type { FbPlayer } from '../types'
import type { School } from '../schools'
import {
  buildFullFbPool,
  buildFbSchoolWheels,
  power5OfFullFb,
  type FullFbPlayer,
} from './full-football'
import { generateFullSpins } from './full'

// ── Synthetic fixtures ────────────────────────────────────────────────────────
// Hand-built schools so the engine is tested in isolation from the real datasets
// (which grow over time and would make exact-count assertions brittle).

function fbPlayer(id: string, firstYear: number, lastYear: number): FbPlayer {
  const seasons = []
  for (let y = firstYear; y <= lastYear; y++) {
    seasons.push({
      year: y,
      stats: { rushYds: 900, rushTD: 8 },
      honors: [],
      source: 'https://example.test',
    })
  }
  return {
    id,
    position: 'RB',
    name: id.toUpperCase(),
    firstYear,
    lastYear,
    seasons,
  }
}

function school(
  id: string,
  opts: {
    power5?: boolean
    available?: boolean
    players?: FbPlayer[]
    football?: boolean
    provisional?: boolean
  } = {},
): School {
  const {
    power5 = true,
    available = true,
    players = [fbPlayer(`${id}-a`, 1994, 1998)],
    football = true,
    provisional = false,
  } = opts
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    short: id,
    mascot: `${id}s`,
    emoji: '🏈',
    theme: { brand: '#000', brand2: '#111', accent: '#fff', ink: '#222' },
    basketball: {
      school: id,
      sport: 'basketball',
      provisional: false,
      players: [],
    },
    football: football
      ? { school: id, sport: 'football', provisional, players }
      : undefined,
    hasFootball: football,
    power5,
    available,
  }
}

describe('buildFullFbPool', () => {
  it('pools every available school WITH a real football dataset, namespacing ids', () => {
    const pool = buildFullFbPool([school('michigan'), school('florida')])
    expect(pool.map((p) => p.id).sort()).toEqual([
      'florida:florida-a',
      'michigan:michigan-a',
    ])
    const fla = pool.find((p) => p.schoolId === 'florida')!
    expect(fla.schoolName).toBe('Florida')
    expect(fla.emoji).toBe('🏈')
    expect(fla.power5).toBe(true)
  })

  it('auto-includes a school the moment it carries a football dataset (UNC/VT later)', () => {
    // Today's UNC: fields football but ships no dataset — excluded. The SAME
    // school object with a dataset attached joins with no other change.
    const uncToday = school('unc', { football: false })
    expect(buildFullFbPool([uncToday])).toEqual([])
    const uncLater = school('unc') // dataset landed
    expect(buildFullFbPool([uncLater]).map((p) => p.id)).toEqual(['unc:unc-a'])
  })

  it('excludes provisional (mock) football datasets until real data lands', () => {
    // A provisional dataset is playable single-school (flagged "mock data") but
    // must never mix placeholder stats into the real cross-school pool.
    expect(buildFullFbPool([school('vt', { provisional: true })])).toEqual([])
  })

  it('excludes unavailable schools', () => {
    expect(buildFullFbPool([school('x', { available: false })])).toEqual([])
  })

  it('stamps per-player power5 from the school (haircut stays player-scoped)', () => {
    const pool = buildFullFbPool([school('mid', { power5: false })])
    expect(pool[0].power5).toBe(false)
  })
})

describe('buildFbSchoolWheels', () => {
  it("derives each school's wheel from its OWN data (data-driven floor)", () => {
    const wheels = buildFbSchoolWheels([
      school('early', { players: [fbPlayer('e', 1994, 1998)] }),
      school('late', { players: [fbPlayer('l', 2016, 2020)] }),
    ])
    const early = wheels.find((w) => w.schoolId === 'early')!
    const late = wheels.find((w) => w.schoolId === 'late')!
    expect(early.windows[0]).toEqual({ start: 1994, end: 1997 })
    expect(early.windows[early.windows.length - 1]).toEqual({
      start: 1995,
      end: 1998,
    })
    // a school whose sourced coverage begins later never offers an era its
    // data can't fill
    expect(late.windows[0]).toEqual({ start: 2016, end: 2019 })
    expect(late.windows[late.windows.length - 1]).toEqual({
      start: 2017,
      end: 2020,
    })
  })

  it('never starts a wheel before the 1994 football floor', () => {
    const wheels = buildFbSchoolWheels([
      school('old', { players: [fbPlayer('o', 1990, 1998)] }),
    ])
    expect(wheels[0].windows[0].start).toBe(1994)
  })

  it('drops schools whose wheel would be empty (no data / no windows)', () => {
    const wheels = buildFbSchoolWheels([
      school('empty', { players: [] }),
      school('provisional', { provisional: true }),
      school('nofb', { football: false }),
      school('live'),
    ])
    expect(wheels.map((w) => w.schoolId)).toEqual(['live'])
  })

  it('feeds generateFullSpins so spins only land on live football schools', () => {
    const wheels = buildFbSchoolWheels([
      school('a'),
      school('b', { football: false }),
      school('c', { provisional: true }),
    ])
    const spins = generateFullSpins(7, 14, wheels)
    expect(spins).toHaveLength(14)
    expect(new Set(spins.map((s) => s.schoolId))).toEqual(new Set(['a']))
  })
})

describe('power5OfFullFb', () => {
  it('reads the pooled player flag; a plain FbPlayer defaults to power-5', () => {
    const pooled = buildFullFbPool([school('mid', { power5: false })])[0]
    expect(power5OfFullFb(pooled)).toBe(false)
    const pooledP5: FullFbPlayer = buildFullFbPool([school('p5')])[0]
    expect(power5OfFullFb(pooledP5)).toBe(true)
    expect(power5OfFullFb(fbPlayer('plain', 1994, 1995))).toBe(true)
  })
})
