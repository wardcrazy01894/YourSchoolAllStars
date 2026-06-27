import { describe, it, expect } from 'vitest'
import { eligiblePositions, tenureGapYears } from './types'
import type { BballPlayer } from './types'

function player(p: Partial<BballPlayer>): BballPlayer {
  return {
    id: 'x',
    name: 'X',
    position: 'PF',
    firstYear: 2016,
    lastYear: 2019,
    seasons: [],
    ...p,
  }
}

function seasons(years: number[]) {
  return years.map((year) => ({
    year,
    stats: { pts: 10 },
    honors: [],
    source: 'src',
  }))
}

describe('eligiblePositions', () => {
  it('defaults to the primary position when no eligible list', () => {
    expect(eligiblePositions(player({ position: 'C' }))).toEqual(['C'])
  })
  it('uses the explicit eligible list when present', () => {
    expect(
      eligiblePositions(player({ position: 'PF', eligible: ['PF', 'C'] })),
    ).toEqual(['PF', 'C'])
  })
})

describe('tenureGapYears', () => {
  it('reports no gaps when every tenure year has a row', () => {
    const p = player({
      firstYear: 1994,
      lastYear: 1997,
      seasons: seasons([1994, 1995, 1996, 1997]),
    })
    expect(tenureGapYears(p)).toEqual([])
  })

  it('reports an undeclared internal hole as a gap', () => {
    const p = player({
      firstYear: 2016,
      lastYear: 2019,
      seasons: seasons([2016, 2018, 2019]),
    })
    expect(tenureGapYears(p)).toEqual([2017])
  })

  it('treats a declared medical-redshirt year as covered (Blackshear case)', () => {
    // On the roster 2016–2019 but redshirted 2016–17: keep the real 2016/2018/2019
    // seasons, declare 2017, and the year is no longer a gap.
    const p = player({
      firstYear: 2016,
      lastYear: 2019,
      seasons: seasons([2016, 2018, 2019]),
      redshirtYears: [2017],
    })
    expect(tenureGapYears(p)).toEqual([])
  })

  it('still flags a real hole even when another year is a declared redshirt', () => {
    const p = player({
      firstYear: 2015,
      lastYear: 2019,
      seasons: seasons([2015, 2017, 2019]),
      redshirtYears: [2016], // 2018 is still an undeclared hole
    })
    expect(tenureGapYears(p)).toEqual([2018])
  })
})
