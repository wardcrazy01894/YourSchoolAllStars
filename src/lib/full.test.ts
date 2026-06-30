import { describe, it, expect } from 'vitest'
import type { BballPlayer } from '../types'
import type { School } from '../schools'
import {
  buildFullPool,
  buildSchoolWheels,
  generateFullSpins,
  power5OfFull,
  type FullPlayer,
} from './full'

// ── Synthetic fixtures ────────────────────────────────────────────────────────
// Hand-built schools so the engine is tested in isolation from the real dataset
// (which grows over time and would make exact-count assertions brittle).

function player(id: string, firstYear: number, lastYear: number): BballPlayer {
  const seasons = []
  for (let y = firstYear; y <= lastYear; y++) {
    seasons.push({
      year: y,
      stats: { pts: 10, reb: 5, ast: 3, stl: 1, blk: 1 },
      honors: [],
      source: 'https://example.test',
    })
  }
  return {
    id,
    position: 'PG',
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
    players?: BballPlayer[]
    basketball?: boolean
  } = {},
): School {
  const {
    power5 = true,
    available = true,
    players = [player(`${id}-a`, 1994, 2000)],
    basketball = true,
  } = opts
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    short: id,
    mascot: `${id}s`,
    emoji: '🏀',
    theme: { brand: '#000', brand2: '#111', accent: '#fff', ink: '#222' },
    basketball: basketball
      ? { school: id, sport: 'basketball', provisional: false, players }
      : undefined,
    hasFootball: false,
    power5,
    available,
  }
}

describe('buildFullPool', () => {
  it('namespaces ids by school so cross-school ids never collide', () => {
    const pool = buildFullPool([
      school('alpha', { players: [player('star', 1994, 1997)] }),
      school('beta', { players: [player('star', 1994, 1997)] }),
    ])
    const ids = pool.map((p) => p.id).sort()
    expect(ids).toEqual(['alpha:star', 'beta:star'])
  })

  it('stamps each player with its own school metadata + power5 flag', () => {
    const pool = buildFullPool([
      school('alpha', { power5: true, players: [player('a', 1994, 1997)] }),
      school('vcu', { power5: false, players: [player('b', 1994, 1997)] }),
    ])
    const a = pool.find((p) => p.id === 'alpha:a')!
    const b = pool.find((p) => p.id === 'vcu:b')!
    expect(a.schoolId).toBe('alpha')
    expect(a.schoolName).toBe('Alpha')
    expect(a.emoji).toBe('🏀')
    expect(a.power5).toBe(true)
    expect(b.power5).toBe(false) // per-player, not team-wide
  })

  it('preserves the underlying BballPlayer fields (seasons, tenure)', () => {
    const p = player('a', 1994, 1998)
    const [full] = buildFullPool([school('alpha', { players: [p] })])
    expect(full.firstYear).toBe(1994)
    expect(full.lastYear).toBe(1998)
    expect(full.seasons).toEqual(p.seasons)
    expect(full.position).toBe('PG')
  })

  it('skips unavailable schools and schools with no basketball dataset', () => {
    const pool = buildFullPool([
      school('live', { players: [player('a', 1994, 1997)] }),
      school('soon', { available: false, players: [player('b', 1994, 1997)] }),
      school('nohoops', { basketball: false }),
    ])
    expect(pool.map((p) => p.schoolId).sort()).toEqual(['live'])
  })
})

describe('buildSchoolWheels', () => {
  it('builds a rolling 4-year wheel per available basketball school', () => {
    const wheels = buildSchoolWheels([
      school('alpha', { players: [player('a', 1994, 2000)] }),
    ])
    expect(wheels).toHaveLength(1)
    expect(wheels[0].schoolId).toBe('alpha')
    // 1994..2000 in 4-year blocks → starts 1994..1997 (end ≤ 2000).
    const ws = wheels[0].windows
    expect(ws[0]).toEqual({ start: 1994, end: 1997 })
    expect(ws[ws.length - 1]).toEqual({ start: 1997, end: 2000 })
  })

  it('drops schools whose wheel would be empty (no seasons / unavailable / no data)', () => {
    const wheels = buildSchoolWheels([
      school('live', { players: [player('a', 1994, 2000)] }),
      school('empty', { players: [] }),
      school('soon', { available: false }),
      school('nohoops', { basketball: false }),
    ])
    expect(wheels.map((w) => w.schoolId)).toEqual(['live'])
  })
})

describe('generateFullSpins', () => {
  const schools = [
    school('alpha', { players: [player('a', 1994, 2010)] }),
    school('beta', { players: [player('b', 1994, 2010)] }),
    school('gamma', { players: [player('c', 1994, 2010)] }),
  ]
  const wheels = buildSchoolWheels(schools)

  it('is deterministic for a fixed seed', () => {
    const a = generateFullSpins(123, 6, wheels)
    const b = generateFullSpins(123, 6, wheels)
    expect(a).toEqual(b)
    expect(a).toHaveLength(6)
  })

  it('differs across seeds (not a constant sequence)', () => {
    const a = generateFullSpins(1, 6, wheels)
    const b = generateFullSpins(2, 6, wheels)
    expect(a).not.toEqual(b)
  })

  it('every spin names a real school and one of that school’s windows', () => {
    const spins = generateFullSpins(42, 20, wheels)
    for (const s of spins) {
      const wheel = wheels.find((w) => w.schoolId === s.schoolId)
      expect(wheel).toBeDefined()
      expect(wheel!.windows).toContainEqual(s.window)
    }
  })

  it('selects teams roughly uniformly over many spins (each team equal)', () => {
    const spins = generateFullSpins(7, 900, wheels)
    const counts: Record<string, number> = {}
    for (const s of spins) counts[s.schoolId] = (counts[s.schoolId] ?? 0) + 1
    // 3 teams, 900 spins → ~300 each. Loose bounds: every team well-represented.
    for (const id of ['alpha', 'beta', 'gamma']) {
      expect(counts[id]).toBeGreaterThan(200)
      expect(counts[id]).toBeLessThan(400)
    }
  })

  it('returns an empty sequence when there are no wheels (dead-era safety net)', () => {
    expect(generateFullSpins(1, 6, [])).toEqual([])
  })

  it('ignores empty-window wheels rather than emitting holey spins', () => {
    const mixed = [
      { schoolId: 'live', windows: [{ start: 1994, end: 1997 }] },
      { schoolId: 'dead', windows: [] },
    ]
    const spins = generateFullSpins(99, 30, mixed)
    expect(spins.every((s) => s.schoolId === 'live')).toBe(true)
  })
})

describe('power5OfFull', () => {
  it('reads a FullPlayer’s own power5 flag', () => {
    const [full] = buildFullPool([
      school('vcu', { power5: false, players: [player('a', 1994, 1997)] }),
    ]) as FullPlayer[]
    expect(power5OfFull(full)).toBe(false)
  })

  it('defaults to true for a plain BballPlayer with no flag (safe fallback)', () => {
    expect(power5OfFull(player('a', 1994, 1997))).toBe(true)
  })
})
