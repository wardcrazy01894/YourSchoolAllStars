import { describe, it, expect } from 'vitest'
import { FB_SLOTS } from '../types'
import type { FbPlayer, FbPosition, FbStats, YearWindow } from '../types'
import { initFbDraft, draftToSlot } from './football-game'
import {
  fbWindowBySlot,
  fbEvaluate,
  fbSavedDailyFrom,
  fbRosterFromSaved,
} from './football-result'

const W: YearWindow = { start: 2013, end: 2016 }
const SEQ: YearWindow[] = Array.from({ length: 14 }, () => W)

const STATLINE: Record<FbPosition, FbStats> = {
  QB: { passYds: 3500, passTD: 35, passInt: 8, rushYds: 700, rushTD: 10 },
  RB: { rushYds: 1500, rushTD: 18, rec: 35, recYds: 400, recTD: 4 },
  WR: { rec: 70, recYds: 1100, recTD: 11 },
  TE: { rec: 50, recYds: 650, recTD: 7 },
  DE: { tackles: 55, tfl: 18, sacks: 11, ff: 4, defInt: 2 },
  DT: { tackles: 50, tfl: 13, sacks: 7, ff: 3 },
  LB: { tackles: 120, tfl: 15, sacks: 6, defInt: 3, pbu: 6, ff: 3 },
  CB: { tackles: 55, tfl: 4, defInt: 5, pbu: 14, ff: 2 },
  S: { tackles: 90, tfl: 7, defInt: 4, pbu: 9, ff: 3 },
}

function mk(id: string, position: FbPosition): FbPlayer {
  return {
    id,
    name: id,
    position,
    firstYear: W.start,
    lastYear: W.end,
    seasons: [
      {
        year: W.start,
        stats: STATLINE[position],
        honors: [],
        source: 'test',
      },
    ],
  }
}

const POSITIONS: FbPosition[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'DE',
  'DT',
  'LB',
  'CB',
  'S',
]
const pool: FbPlayer[] = POSITIONS.flatMap((pos) => [
  mk(`${pos}-a`, pos),
  mk(`${pos}-b`, pos),
])
const byId = (id: string) => pool.find((p) => p.id === id)!

/** A full 12-man roster drafted into every slot (offense then defense). */
function fullRoster() {
  let s = initFbDraft(SEQ)
  s = draftToSlot(s, byId('QB-a'), 'QB')
  s = draftToSlot(s, byId('RB-a'), 'RB')
  s = draftToSlot(s, byId('WR-a'), 'WR')
  s = draftToSlot(s, byId('TE-a'), 'TE')
  s = draftToSlot(s, byId('RB-b'), 'FLEX1')
  s = draftToSlot(s, byId('WR-b'), 'FLEX2')
  s = draftToSlot(s, byId('DE-a'), 'DE')
  s = draftToSlot(s, byId('DT-a'), 'DT')
  s = draftToSlot(s, byId('LB-a'), 'LB')
  s = draftToSlot(s, byId('CB-a'), 'CB')
  s = draftToSlot(s, byId('S-a'), 'S')
  s = draftToSlot(s, byId('LB-b'), 'DFLEX')
  return s
}

describe('fbWindowBySlot', () => {
  it('maps each filled slot id to the era it was drafted from', () => {
    const s = fullRoster()
    const m = fbWindowBySlot(s.picks)
    expect(m['QB']).toEqual(W)
    expect(m['DFLEX']).toEqual(W)
    expect(Object.keys(m)).toHaveLength(12)
  })
})

describe('fbEvaluate', () => {
  it('rates one starter per filled slot and projects a record out of 16', () => {
    const r = fbEvaluate(fullRoster(), true)
    expect(r.rated).toHaveLength(12)
    expect(r.games).toBe(16)
    expect(r.wins).toBeGreaterThanOrEqual(0)
    expect(r.wins).toBeLessThanOrEqual(16)
    expect(r.label).toBe(`${r.wins}–${16 - r.wins}`)
    expect(typeof r.grade).toBe('string')
    expect(r.strength).toBeGreaterThan(0)
  })

  it('exposes a per-slot rating for every slot, null for empty ones', () => {
    let s = initFbDraft(SEQ)
    s = draftToSlot(s, byId('QB-a'), 'QB')
    const r = fbEvaluate(s, true)
    expect(r.ratingBySlot['QB']).toBeGreaterThan(0)
    expect(r.ratingBySlot['RB']).toBeNull()
    expect(Object.keys(r.ratingBySlot)).toHaveLength(FB_SLOTS.length)
  })

  it('applies the non-power-5 haircut: wins never rise off the penalty', () => {
    const s = fullRoster()
    expect(fbEvaluate(s, false).wins).toBeLessThanOrEqual(
      fbEvaluate(s, true).wins,
    )
  })
})

describe('per-player power-5 (Full Football)', () => {
  it('a resolver dings ONLY the flagged player, never their teammates', () => {
    const s = fullRoster()
    const allP5 = fbEvaluate(s, true)
    const onlyQbDinged = fbEvaluate(s, (p) => p.id !== 'QB-a')
    expect(onlyQbDinged.ratingBySlot['QB']).toBeLessThan(
      allP5.ratingBySlot['QB']!,
    )
    for (const slot of FB_SLOTS.map((x) => x.id).filter((id) => id !== 'QB')) {
      expect(onlyQbDinged.ratingBySlot[slot]).toBe(allP5.ratingBySlot[slot])
    }
    expect(onlyQbDinged.strength).toBeLessThan(allP5.strength)
  })

  it('a boolean spec still applies roster-wide (single-school games)', () => {
    const s = fullRoster()
    const viaBool = fbEvaluate(s, false)
    const viaResolver = fbEvaluate(s, () => false)
    expect(viaResolver.ratingBySlot).toEqual(viaBool.ratingBySlot)
    expect(viaResolver.wins).toBe(viaBool.wins)
  })

  it('fbSavedDailyFrom accepts a resolver and persists the resolved record', () => {
    const s = fullRoster()
    const saved = fbSavedDailyFrom(s, '2026-06-27', (p) => p.id !== 'QB-a')
    expect(saved.wins).toBe(fbEvaluate(s, (p) => p.id !== 'QB-a').wins)
    expect(saved.wins).toBeLessThanOrEqual(
      fbSavedDailyFrom(s, '2026-06-27', true).wins,
    )
  })
})

describe('save / restore round-trip', () => {
  it('serializes a completed draft into the persisted daily shape', () => {
    const saved = fbSavedDailyFrom(fullRoster(), '2026-06-27', true)
    expect(saved.dateKey).toBe('2026-06-27')
    expect(saved.playerIds['QB']).toBe('QB-a')
    expect(saved.playerIds['FLEX1']).toBe('RB-b')
    expect(saved.windows?.['DFLEX']).toEqual(W)
    expect(saved.wins).toBeGreaterThanOrEqual(0)
  })

  it('rebuilds the same slots + a re-rate that matches the original', () => {
    const original = fullRoster()
    const saved = fbSavedDailyFrom(original, '2026-06-27', true)
    const restored = fbRosterFromSaved(saved, pool)
    for (const slot of FB_SLOTS) {
      expect(restored.slots[slot.id]?.id).toBe(original.slots[slot.id]?.id)
    }
    expect(fbEvaluate(restored, true).wins).toBe(
      fbEvaluate(original, true).wins,
    )
  })

  it('drops a slot whose player is gone or whose window is missing (no throw)', () => {
    const saved = fbSavedDailyFrom(fullRoster(), '2026-06-27', true)
    // QB player removed from the pool → that slot is left empty on restore.
    const thinned = pool.filter((p) => p.id !== 'QB-a')
    const restored = fbRosterFromSaved(saved, thinned)
    expect(restored.slots['QB']).toBeNull()
    expect(restored.slots['RB']?.id).toBe('RB-a')
    // A save missing its windows map still restores nothing rather than throwing.
    const noWindows = { ...saved, windows: undefined }
    expect(() => fbRosterFromSaved(noWindows, pool)).not.toThrow()
    expect(fbRosterFromSaved(noWindows, pool).picks).toHaveLength(0)
  })
})
