// Dataset integrity guard. Runs against whatever is bundled, so it protects both
// the provisional seed and the curated set: a malformed player row fails CI.

import { describe, it, expect } from 'vitest'
import {
  michiganBasketball,
  virginiaTechBasketball,
  northCarolinaBasketball,
} from './index'
import type { Dataset } from './index'
import {
  BBALL_WINDOWS,
  buildRollingWindows,
  playerInWindow,
  datasetMaxYear,
} from '../lib/windows'
import { BBALL_POSITIONS, eligiblePositions, tenureGapYears } from '../types'
import type { BballStats } from '../types'

// The complete box-score line every season row must now carry (Alex, 2026-06-26):
// SR publishes per-game pts/reb/ast/stl/blk for essentially every D-I player, so
// a missing field means we didn't look hard enough, not that the data is absent.
const REQUIRED_STATS: (keyof BballStats)[] = ['pts', 'reb', 'ast', 'stl', 'blk']

// Every bundled basketball dataset runs the SAME guards — the seed and the
// curated sets alike. Adding a school = add its dataset here; a malformed row in
// any of them fails CI.
const DATASETS: Dataset[] = [
  michiganBasketball,
  virginiaTechBasketball,
  northCarolinaBasketball,
]

describe.each(DATASETS)('$school basketball dataset', ({ players }) => {
  it('has players', () => {
    expect(players.length).toBeGreaterThan(0)
  })

  it('every id is unique', () => {
    const ids = players.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every row is well-formed', () => {
    for (const p of players) {
      expect(BBALL_POSITIONS).toContain(p.position)
      // `eligible` is the COMPLETE set of slots a player may fill (it replaces
      // the [position] default, not adds to it), and it feeds the coverage
      // guards — so a typo'd entry would silently never match and quietly
      // under-cover. Every listed slot must be a real position.
      if (p.eligible) {
        for (const e of p.eligible) expect(BBALL_POSITIONS).toContain(e)
        // ...and it must INCLUDE the primary position — `eligible` REPLACES the
        // [position] default (it isn't additive), so omitting the primary would
        // silently strip the player from their own primary slot's coverage.
        expect(p.eligible).toContain(p.position)
      }
      expect(p.firstYear).toBeLessThanOrEqual(p.lastYear)
      // Always at least one season; each season is in-tenure and well-formed.
      expect(p.seasons.length).toBeGreaterThan(0)
      for (const s of p.seasons) {
        expect(s.year).toBeGreaterThanOrEqual(p.firstYear)
        expect(s.year).toBeLessThanOrEqual(p.lastYear)
        // Any present value is a number ≥ 0 (completeness is enforced separately
        // by the REQUIRED_STATS guard below).
        for (const v of Object.values(s.stats)) {
          expect(typeof v).toBe('number')
          expect(v).toBeGreaterThanOrEqual(0)
        }
        // ...and a row must carry at least one real stat. An empty {} line would
        // satisfy the per-year coverage guard below without contributing any
        // ratable number — phantom coverage. Require ≥1 field so coverage is real.
        expect(Object.keys(s.stats).length).toBeGreaterThanOrEqual(1)
        expect(s.source.length).toBeGreaterThan(0)
        expect(Array.isArray(s.honors)).toBe(true)
      }
      // Season years are unique within a player (no duplicate season rows).
      const years = p.seasons.map((s) => s.year)
      expect(new Set(years).size).toBe(years.length)
      // A declared medical-redshirt year is a tenure-INTERNAL non-playing year:
      // it must fall strictly inside (firstYear, lastYear) — a boundary "redshirt"
      // would just be a too-wide tenure — and must NOT also carry a season row
      // (the field exists precisely because there's no row that year).
      if (p.redshirtYears) {
        const yearSet = new Set(years)
        for (const ry of p.redshirtYears) {
          expect(ry).toBeGreaterThan(p.firstYear)
          expect(ry).toBeLessThan(p.lastYear)
          expect(yearSet.has(ry)).toBe(false)
        }
        expect(new Set(p.redshirtYears).size).toBe(p.redshirtYears.length)
      }
    }
  })

  it('every season row carries a complete pts/reb/ast/stl/blk line', () => {
    // Completeness mandate (Alex, 2026-06-26): no excuse for a partial statline —
    // every player-year gets the full box score, with Sports-Reference as the
    // ready fallback when official/Wikipedia/ESPN don't cover a field. A row
    // missing any of the five is a sourcing gap to fill, not an accepted partial.
    const gaps: string[] = []
    for (const p of players) {
      for (const s of p.seasons) {
        const missing = REQUIRED_STATS.filter((k) => s.stats[k] === undefined)
        if (missing.length)
          gaps.push(`${p.id}:${s.year} missing ${missing.join(',')}`)
      }
    }
    expect(gaps.sort()).toEqual([])
  })

  it('every player overlaps at least one basketball window', () => {
    for (const p of players) {
      expect(BBALL_WINDOWS.some((w) => playerInWindow(p, w))).toBe(true)
    }
  })

  it('every window × position has at least one eligible player (launch bar)', () => {
    // Defense-in-depth alongside the ROLLING-window guard below: this checks the
    // retired fixed BBALL_WINDOWS fixture (no longer the live wheel as of #16, but
    // still referenced by windows.test.ts). The rolling guard is the stricter,
    // finer-grained bar for what the game ACTUALLY spins; kept both deliberately.
    // No daily spin can strand a position with an empty pool. All gaps filled —
    // a data edit that empties any cell adds a gap here and fails CI.
    const KNOWN_GAPS: string[] = []
    const gaps: string[] = []
    for (const w of BBALL_WINDOWS) {
      for (const pos of BBALL_POSITIONS) {
        // Count alt-eligible players too — a PG/SG combo guard genuinely covers
        // SG in the engine, so coverage must use eligiblePositions, not just the
        // primary position (else the test reports a phantom gap the game lacks).
        const count = players.filter(
          (p) => eligiblePositions(p).includes(pos) && playerInWindow(p, w),
        ).length
        if (count === 0) gaps.push(`${w.start}-${w.end}/${pos}`)
      }
    }
    // A data edit that empties a covered cell adds a NEW gap and fails CI;
    // filling a known gap without updating KNOWN_GAPS also fails. Trends to [].
    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort())
  })

  it('every ROLLING window × position has an eligible player (the live wheel)', () => {
    // #16 flips the daily wheel from the 8 fixed BBALL_WINDOWS to the data-driven
    // ROLLING wheel the app now spins: buildRollingWindows(1994, datasetMaxYear, 4)
    // — ~30 overlapping 4-year eras. The soft-lock-freedom guarantee in game.ts
    // (canSkip) rests on "every spun window × position has ≥1 eligible player," so
    // the invariant must hold for the wheel the app ACTUALLY uses, not just the old
    // fixed one. (It follows from per-year coverage, but lock it explicitly: a data
    // edit that strands a rolling era would soft-lock a real daily.)
    const maxYear = datasetMaxYear(players) ?? 1994
    const wheel = buildRollingWindows(1994, maxYear, 4)
    expect(wheel.length).toBeGreaterThan(0)
    const KNOWN_GAPS: string[] = []
    const gaps: string[] = []
    for (const w of wheel) {
      for (const pos of BBALL_POSITIONS) {
        const count = players.filter(
          (p) => eligiblePositions(p).includes(pos) && playerInWindow(p, w),
        ).length
        if (count === 0) gaps.push(`${w.start}-${w.end}/${pos}`)
      }
    }
    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort())
  })

  it('every YEAR × position has an actual season row (per-year coverage)', () => {
    // The launch bar above is per-WINDOW (tenure-overlap), which a player can
    // satisfy without having PLAYED that exact year. The real bar for the
    // per-season model is stricter: for every year in the live range, each
    // position must have a player who is eligible there AND has a real stat ROW
    // that year — otherwise "best season in the spun window" can land on a year
    // with nobody at a position. Coverage starts at 1994 (the first window year;
    // earlier tenure artifacts fall in no window) and runs to the latest season.
    const minYear = 1994
    const maxYear = datasetMaxYear(players) ?? minYear
    const KNOWN_GAPS: string[] = []
    const gaps: string[] = []
    for (let y = minYear; y <= maxYear; y++) {
      const active = players.filter((p) => p.firstYear <= y && p.lastYear >= y)
      for (const pos of BBALL_POSITIONS) {
        const covered = active.some(
          (p) =>
            eligiblePositions(p).includes(pos) &&
            p.seasons.some((s) => s.year === y),
        )
        if (!covered) gaps.push(`${y}/${pos}`)
      }
    }
    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort())
  })

  it('every player has a season row for every year in their tenure (per-player coverage)', () => {
    // The standard (Alex): a player carries stats for EVERY season they were on
    // the roster. The per-YEAR guard above only checks that SOMEONE covers each
    // year×position — a single player can have a tenure-INTERNAL hole (e.g. Tim
    // Hardaway Jr. listed 2011–2013 with only a 2013 row) and still pass it, then
    // surface an out-of-window "career-best season" fallback in an era he never
    // played. The bar here is per-player: every year in [firstYear, lastYear] must
    // have a real season row.
    //
    // Genuine non-playing years come in two flavors. A medical (or other)
    // redshirt year — on the roster but didn't play — is DECLARED in
    // `redshirtYears`: we keep every real season on both sides of it and let the
    // declared year be a covered hole (Alex, 2026-06-27: "the guard shouldn't
    // forbid a medical redshirt year — keep all those years"). Anything else — a
    // year inside [firstYear, lastYear] with neither a season row nor a redshirt
    // declaration — is an UNsourced hole and a real gap. `tenureGapYears` encodes
    // exactly that: a non-empty result is a sourcing gap and fails CI.
    const gaps: string[] = []
    for (const p of players) {
      for (const y of tenureGapYears(p)) gaps.push(`${p.id}:${y}`)
    }
    expect(gaps.sort()).toEqual([])
  })
})
