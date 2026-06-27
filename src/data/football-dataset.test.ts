// Football dataset integrity guard. Runs against whatever is bundled, so it
// protects both the current MOCK seed and the eventual curated set: a malformed
// row, a coverage gap that could soft-lock the draft, or a real source sneaking
// in under the provisional flag all fail CI.

import { describe, it, expect } from 'vitest'
import { michiganFootball } from './index'
import { FB_WINDOWS, playerInWindow } from '../lib/football'
import { fbStatComposite } from '../lib/football-rating'
import {
  FB_OFF_POSITIONS,
  FB_DEF_POSITIONS,
  FB_SLOTS,
  FB_STAT_KEYS,
  windowLabel,
} from '../types'
import type { FbPosition } from '../types'

const { players, provisional } = michiganFootball
const ALL_POSITIONS: FbPosition[] = [...FB_OFF_POSITIONS, ...FB_DEF_POSITIONS]
const STAT_KEY_SET = new Set<string>(FB_STAT_KEYS)

/** Every subset of `xs` (power set), used for the Hall's-condition coverage check. */
function subsets<T>(xs: T[]): T[][] {
  return xs.reduce<T[][]>(
    (acc, x) => acc.concat(acc.map((s) => [...s, x])),
    [[]],
  )
}

describe('michigan football dataset', () => {
  it('has players', () => {
    expect(players.length).toBeGreaterThan(0)
  })

  it('every id is unique', () => {
    const ids = players.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every row is well-formed', () => {
    for (const p of players) {
      expect(ALL_POSITIONS).toContain(p.position)
      expect(p.firstYear).toBeLessThanOrEqual(p.lastYear)
      // bestSeason sits inside the player's tenure.
      expect(p.bestSeason).toBeGreaterThanOrEqual(p.firstYear)
      expect(p.bestSeason).toBeLessThanOrEqual(p.lastYear)
      // Every present stat uses a real FbStats key and is a number ≥ 0; a row
      // carries at least one. An unknown key (a typo like `sakcs`) would be
      // silently dropped by the rating model, so reject it here.
      const keys = Object.keys(p.stats)
      expect(keys.length).toBeGreaterThanOrEqual(1)
      for (const k of keys) {
        expect(STAT_KEY_SET.has(k)).toBe(true)
        const v = (p.stats as Record<string, number>)[k]
        expect(typeof v).toBe('number')
        expect(v).toBeGreaterThanOrEqual(0)
      }
      // The row must carry stats RELEVANT to its position — a QB whose only stat
      // is `tackles` would pass the shape checks above yet rate 0. A positive
      // composite proves the line feeds the player's own rating terms.
      expect(fbStatComposite(p.position, p.stats)).toBeGreaterThan(0)
      expect(p.source.length).toBeGreaterThan(0)
      expect(Array.isArray(p.honors)).toBe(true)
    }
  })

  it('every player overlaps at least one football window', () => {
    for (const p of players) {
      expect(FB_WINDOWS.some((w) => playerInWindow(p, w))).toBe(true)
    }
  })

  it('no window can soft-lock the draft (Hall’s condition per side)', () => {
    // The real no-soft-lock property is NOT "≥1 of every position per window" —
    // that ignores FLEX contention. In the worst case all 6 of a side's rounds
    // spin the SAME window, so that window alone must be able to fill all 6 of
    // that side's slots. By Hall's marriage theorem the bipartite slot→player
    // matching is feasible iff, for every set P of positions, the slots that can
    // ONLY be filled by positions in P (accepts ⊆ P) number no more than the
    // players whose position ∈ P. We check that for every window and side — so a
    // future curated edit that trims, say, a window to a single WR (leaving the 3
    // RB/WR/TE + 2 FLEX = 5 skill slots under-supplied) fails CI here.
    const sides: { name: string; positions: FbPosition[] }[] = [
      { name: 'offense', positions: [...FB_OFF_POSITIONS] },
      { name: 'defense', positions: [...FB_DEF_POSITIONS] },
    ]
    const gaps: string[] = []
    for (const w of FB_WINDOWS) {
      const inWindow = players.filter((p) => playerInWindow(p, w))
      for (const side of sides) {
        const sideSlots = FB_SLOTS.filter((s) => s.side === side.name)
        for (const P of subsets(side.positions)) {
          const pset = new Set<FbPosition>(P)
          const constrainedSlots = sideSlots.filter((s) =>
            s.accepts.every((a) => pset.has(a)),
          ).length
          const supply = inWindow.filter((p) => pset.has(p.position)).length
          if (supply < constrainedSlots) {
            gaps.push(
              `${windowLabel(w)} ${side.name} {${P.join(',')}}: ` +
                `${supply} players < ${constrainedSlots} slots`,
            )
          }
        }
      }
    }
    expect(gaps).toEqual([])
  })

  it('while provisional, every source is the PLACEHOLDER marker', () => {
    // Guard against half-mocked data: as long as the bundle is flagged
    // provisional (mock), NO row may carry a real-looking source URL — that would
    // falsely imply it had been curated. When real data lands, `_provisional`
    // flips to false and this assertion no longer applies.
    if (!provisional) return
    for (const p of players) {
      expect(p.source).toBe('PLACEHOLDER')
    }
  })
})
