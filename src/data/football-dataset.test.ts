// Football dataset integrity guard. Runs against whatever is bundled, so it
// protects both the current MOCK seed and the eventual curated set: a malformed
// row, a coverage gap that could soft-lock the draft, or a real source sneaking
// in under the provisional flag all fail CI.

import { describe, it, expect } from 'vitest'
import { michiganFootball } from './index'
import { FB_WINDOWS, playerInWindow } from '../lib/football'
import {
  FB_OFF_POSITIONS,
  FB_DEF_POSITIONS,
  FB_SLOTS,
  windowLabel,
} from '../types'
import type { FbPosition } from '../types'

const { players, provisional } = michiganFootball
const ALL_POSITIONS: FbPosition[] = [...FB_OFF_POSITIONS, ...FB_DEF_POSITIONS]

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
      // Every present stat is a number ≥ 0, and a row carries at least one.
      const entries = Object.values(p.stats)
      expect(entries.length).toBeGreaterThanOrEqual(1)
      for (const v of entries) {
        expect(typeof v).toBe('number')
        expect(v).toBeGreaterThanOrEqual(0)
      }
      expect(p.source.length).toBeGreaterThan(0)
      expect(Array.isArray(p.honors)).toBe(true)
    }
  })

  it('every player overlaps at least one football window', () => {
    for (const p of players) {
      expect(FB_WINDOWS.some((w) => playerInWindow(p, w))).toBe(true)
    }
  })

  it('every window × position has at least one eligible player (no soft-lock)', () => {
    // The draft spins a window per round and asks for a player who fits an open
    // slot. If any (window × single position) is empty, a spin could strand a
    // required slot. Every cell must be covered — a data edit that empties one
    // adds a gap here and fails CI.
    const gaps: string[] = []
    for (const w of FB_WINDOWS) {
      for (const pos of ALL_POSITIONS) {
        const n = players.filter(
          (p) => p.position === pos && playerInWindow(p, w),
        ).length
        if (n < 1) gaps.push(`${windowLabel(w)} × ${pos}`)
      }
    }
    expect(gaps.sort()).toEqual([])
  })

  it('every FLEX slot has at least one eligible filler per window', () => {
    // FLEX slots accept several positions; confirm each window can fill them too,
    // independent of the single-position guard above.
    const flexSlots = FB_SLOTS.filter((s) => s.accepts.length > 1)
    const gaps: string[] = []
    for (const w of FB_WINDOWS) {
      for (const slot of flexSlots) {
        const n = players.filter(
          (p) => slot.accepts.includes(p.position) && playerInWindow(p, w),
        ).length
        if (n < 1) gaps.push(`${windowLabel(w)} × ${slot.id}`)
      }
    }
    expect(gaps.sort()).toEqual([])
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
