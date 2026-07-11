// Football dataset integrity guard. Runs against whatever is bundled, so it
// protects both the current MOCK seed and the eventual curated set: a malformed
// row, a coverage gap that could soft-lock the draft, or a real source sneaking
// in under the provisional flag all fail CI.

import { describe, it, expect } from 'vitest'
import { michiganFootball } from './index'
import { fbWindows, playerInWindow } from '../lib/football'
import { fbStatComposite } from '../lib/football-rating'
import {
  FB_OFF_POSITIONS,
  FB_DEF_POSITIONS,
  FB_SLOTS,
  FB_STAT_KEYS,
  fbTenureGapYears,
  windowLabel,
} from '../types'
import type { FbPosition } from '../types'

const { players, provisional } = michiganFootball
const ALL_POSITIONS: FbPosition[] = [...FB_OFF_POSITIONS, ...FB_DEF_POSITIONS]
const STAT_KEY_SET = new Set<string>(FB_STAT_KEYS)
// The live era wheel the game actually spins (rolling 4-year eras from 2016 to
// the dataset's max). The coverage guard below iterates exactly this set.
const FB_WINDOWS = fbWindows(players)

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
      // Per-season rows: non-empty, oldest-first, unique years, all inside the
      // tenure (the era wheel credits ONLY in-window rows, so a year outside
      // [firstYear, lastYear] would be unreachable or a tenure lie).
      expect(p.seasons.length).toBeGreaterThanOrEqual(1)
      const years = p.seasons.map((s) => s.year)
      expect([...years].sort((a, b) => a - b)).toEqual(years)
      expect(new Set(years).size).toBe(years.length)
      for (const s of p.seasons) {
        expect(s.year).toBeGreaterThanOrEqual(p.firstYear)
        expect(s.year).toBeLessThanOrEqual(p.lastYear)
        // Every present stat uses a real FbStats key and is a number ≥ 0; a
        // row carries at least one. An unknown key (a typo like `sakcs`) would
        // be silently dropped by the rating model, so reject it here. ONE
        // negative is legitimate: a QB's NET rushing yards (the NCAA counts
        // sack yardage against rushing, so a pocket passer's season net is
        // often below zero) — storing the sourced net beats dropping the stat.
        const keys = Object.keys(s.stats)
        expect(keys.length).toBeGreaterThanOrEqual(1)
        for (const k of keys) {
          expect(STAT_KEY_SET.has(k)).toBe(true)
          const v = (s.stats as Record<string, number>)[k]
          expect(typeof v).toBe('number')
          if (!(p.position === 'QB' && k === 'rushYds')) {
            expect(v, `${p.id} ${s.year} ${k}`).toBeGreaterThanOrEqual(0)
          }
        }
        expect(Array.isArray(s.honors)).toBe(true)
      }
      // The player must carry stats RELEVANT to their position — a QB whose
      // only stat is `tackles` would pass the shape checks above yet rate 0.
      // A positive BEST-season composite proves the line feeds the player's
      // own rating terms. (An individual off-year row may sit at ~0 — e.g. a
      // zero-catch freshman season kept for tenure coverage — so this is a
      // per-player check, not per-season.)
      const bestComposite = Math.max(
        ...p.seasons.map((s) => fbStatComposite(p.position, s.stats)),
      )
      expect(bestComposite, `${p.id} best composite`).toBeGreaterThan(0)
    }
  })

  it('every QB season carries a rushing line (rushYds + rushTD)', () => {
    // QBs are shown (and rated) with rushing production; a QB season without
    // rushYds/rushTD reads as an em dash in the UI and silently under-rates a
    // dual-threat (Alex: "For QBs I want rushing TD stats as well"). Sources
    // publish QB rushing (incl. negative nets) for every season we cover, so
    // a missing field is a sourcing slip, not an unknown.
    if (provisional) return
    for (const p of players.filter((q) => q.position === 'QB')) {
      for (const s of p.seasons) {
        expect(s.stats.rushYds, `${p.id} ${s.year} rushYds`).toBeDefined()
        expect(s.stats.rushTD, `${p.id} ${s.year} rushTD`).toBeDefined()
      }
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

  it('while provisional, every season source is the PLACEHOLDER marker', () => {
    // Guard against half-mocked data: as long as the bundle is flagged
    // provisional (mock), NO row may carry a real-looking source URL — that would
    // falsely imply it had been curated. When real data lands, `_provisional`
    // flips to false and this assertion no longer applies.
    if (!provisional) return
    for (const p of players) {
      for (const s of p.seasons) {
        expect(s.source).toBe('PLACEHOLDER')
      }
    }
  })

  it('once real (not provisional), every season source is a real citation', () => {
    // The mirror of the provisional guard: once the curated data lands, NO row
    // may still carry the PLACEHOLDER marker (a half-migrated dataset), and every
    // season's source must be a real-looking URL — this is a stats game; an
    // uncited number is a fabricated number (see docs/DATA-SOURCING.md).
    if (provisional) return
    for (const p of players) {
      for (const s of p.seasons) {
        expect(s.source, `${p.id} ${s.year}`).not.toBe('PLACEHOLDER')
        expect(s.source, `${p.id} ${s.year}`).toMatch(/^https?:\/\//)
      }
    }
  })

  it('tenure is covered: every year has a season row or a declared redshirt', () => {
    // Mirrors the basketball tenure-coverage guard: a hole (a tenure year with
    // neither a season row nor a redshirtYears declaration) is a sourcing gap
    // that silently narrows the eras a player can be drafted from. Football
    // eligibility is season-row-based, so a hole can't corrupt stats — but it
    // still hides the player from eras they really played in, so it fails CI.
    for (const p of players) {
      expect(fbTenureGapYears(p), `${p.id} tenure gaps`).toEqual([])
    }
  })
})
