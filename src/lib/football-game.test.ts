import { describe, it, expect } from 'vitest'
import {
  initFbDraft,
  currentSide,
  currentFbWindow,
  isFbComplete,
  allFbSlotsFilled,
  openFbSlots,
  eligibleOpenSlots,
  alreadyDrafted,
  isPickable,
  playersThisEra,
  draftToSlot,
  canRespin,
  respin,
  ratedStarters,
  fbDraftResult,
} from './football-game'
import { FB_DRAFT_ROUNDS } from './football'
import { FB_SLOTS } from '../types'
import type { FbPlayer, FbPosition, FbStats, YearWindow } from '../types'

const W: YearWindow = { start: 2013, end: 2016 }
// A long fixed sequence (more than enough rounds) all on the same window.
const SEQ: YearWindow[] = Array.from({ length: 14 }, () => W)

// Elite-ish stat line per position so ratings are non-trivial.
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

function mk(
  id: string,
  position: FbPosition,
  first = W.start,
  last = W.end,
): FbPlayer {
  return {
    id,
    name: id,
    position,
    firstYear: first,
    lastYear: last,
    bestSeason: first,
    stats: STATLINE[position],
    honors: [],
    source: 'test',
  }
}

// Two players per position so a FLEX can pull a second of a position.
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

/** Draft every offensive slot in order, returning the resulting state. */
function fillOffense(s0: ReturnType<typeof initFbDraft>) {
  let s = s0
  s = draftToSlot(s, byId('QB-a'), 'QB')
  s = draftToSlot(s, byId('RB-a'), 'RB')
  s = draftToSlot(s, byId('WR-a'), 'WR')
  s = draftToSlot(s, byId('TE-a'), 'TE')
  s = draftToSlot(s, byId('RB-b'), 'FLEX1')
  s = draftToSlot(s, byId('WR-b'), 'FLEX2')
  return s
}

function fillDefense(s0: ReturnType<typeof initFbDraft>) {
  let s = s0
  s = draftToSlot(s, byId('DE-a'), 'DE')
  s = draftToSlot(s, byId('DT-a'), 'DT')
  s = draftToSlot(s, byId('LB-a'), 'LB')
  s = draftToSlot(s, byId('CB-a'), 'CB')
  s = draftToSlot(s, byId('S-a'), 'S')
  s = draftToSlot(s, byId('LB-b'), 'DFLEX')
  return s
}

describe('initFbDraft', () => {
  it('starts at round 0 with 12 open slots, offense side, no respins used', () => {
    const s = initFbDraft(SEQ)
    expect(s.cursor).toBe(0)
    expect(openFbSlots(s).length).toBe(12)
    expect(currentSide(s)).toBe('offense')
    expect(s.respinsUsed).toEqual({ offense: 0, defense: 0 })
    expect(isFbComplete(s)).toBe(false)
    expect(currentFbWindow(s)).toEqual(W)
  })
})

describe('side gating (offense first)', () => {
  it('a defensive player is NOT pickable while offensive slots remain open', () => {
    const s = initFbDraft(SEQ)
    expect(currentSide(s)).toBe('offense')
    expect(isPickable(s, byId('DE-a'))).toBe(false)
    expect(eligibleOpenSlots(s, byId('DE-a'))).toEqual([])
  })

  it('an offensive player IS pickable during the offense phase', () => {
    const s = initFbDraft(SEQ)
    expect(isPickable(s, byId('QB-a'))).toBe(true)
    expect(eligibleOpenSlots(s, byId('QB-a')).map((sl) => sl.id)).toContain(
      'QB',
    )
  })

  it('flips to defense once every offensive slot is filled', () => {
    const s = fillOffense(initFbDraft(SEQ))
    expect(currentSide(s)).toBe('defense')
    expect(isPickable(s, byId('DE-a'))).toBe(true)
    // Offensive players are no longer pickable (their slots are full anyway).
    expect(isPickable(s, byId('QB-b'))).toBe(false)
  })
})

describe('FLEX placement', () => {
  it('a RB/WR/TE can be placed in an offensive FLEX slot', () => {
    let s = initFbDraft(SEQ)
    s = draftToSlot(s, byId('WR-a'), 'FLEX1')
    expect(s.slots['FLEX1']?.id).toBe('WR-a')
    // QB cannot go in a FLEX (FLEX accepts RB/WR/TE only).
    expect(eligibleOpenSlots(s, byId('QB-a')).map((x) => x.id)).not.toContain(
      'FLEX2',
    )
  })

  it('a QB cannot be placed in a FLEX slot', () => {
    let s = initFbDraft(SEQ)
    const before = s
    s = draftToSlot(s, byId('QB-a'), 'FLEX1')
    // Rejected — state unchanged.
    expect(s).toBe(before)
  })

  it('the defensive FLEX accepts any defensive position', () => {
    let s = fillOffense(initFbDraft(SEQ))
    s = draftToSlot(s, byId('CB-b'), 'DFLEX')
    expect(s.slots['DFLEX']?.id).toBe('CB-b')
  })
})

describe('draftToSlot guards', () => {
  it('rejects drafting the same player twice', () => {
    let s = initFbDraft(SEQ)
    s = draftToSlot(s, byId('RB-a'), 'RB')
    const before = s
    s = draftToSlot(s, byId('RB-a'), 'FLEX1')
    expect(s).toBe(before)
    expect(alreadyDrafted(s, byId('RB-a'))).toBe(true)
  })

  it('rejects a slot the player position does not fit', () => {
    let s = initFbDraft(SEQ)
    const before = s
    s = draftToSlot(s, byId('RB-a'), 'QB')
    expect(s).toBe(before)
  })

  it('rejects a slot that is already filled', () => {
    let s = initFbDraft(SEQ)
    s = draftToSlot(s, byId('RB-a'), 'RB')
    const before = s
    s = draftToSlot(s, byId('RB-b'), 'RB')
    expect(s).toBe(before)
  })

  it('advances the cursor by one on a successful pick', () => {
    let s = initFbDraft(SEQ)
    s = draftToSlot(s, byId('QB-a'), 'QB')
    expect(s.cursor).toBe(1)
    expect(s.picks).toHaveLength(1)
    expect(s.picks[0]).toMatchObject({ slotId: 'QB', window: W })
  })
})

describe('respins (per side)', () => {
  it('allows one respin on offense and advances the cursor', () => {
    const s0 = initFbDraft(SEQ)
    expect(canRespin(s0)).toBe(true)
    const s1 = respin(s0)
    expect(s1.cursor).toBe(1)
    expect(s1.respinsUsed.offense).toBe(1)
    expect(s1.picks).toHaveLength(0)
  })

  it('blocks a second offensive respin', () => {
    const s = respin(initFbDraft(SEQ))
    expect(canRespin(s)).toBe(false)
    expect(respin(s)).toBe(s)
  })

  it('gives a fresh respin on defense even if offense used its respin', () => {
    let s = respin(initFbDraft(SEQ)) // burn offense respin
    s = fillOffense(s)
    expect(currentSide(s)).toBe('defense')
    expect(s.respinsUsed.defense).toBe(0)
    expect(canRespin(s)).toBe(true)
    s = respin(s)
    expect(s.respinsUsed.defense).toBe(1)
    expect(canRespin(s)).toBe(false)
  })

  it('does not carry an unused offensive respin into defense', () => {
    // Offense uses 0 respins; defense still gets exactly one.
    let s = fillOffense(initFbDraft(SEQ))
    expect(s.respinsUsed.offense).toBe(0)
    s = respin(s)
    expect(s.respinsUsed.defense).toBe(1)
    expect(canRespin(s)).toBe(false)
  })
})

describe('canRespin no-strand guard', () => {
  it('refuses a respin that would strand a slot even when the side cap is unused', () => {
    // 7 windows; draft one offensive slot → 11 slots still open, only 5 windows
    // would remain after a respin advanced the cursor. Not enough to fill them,
    // so canRespin is false — and crucially the offensive respin is still UNUSED,
    // so this is the no-strand guard talking, not the per-side cap.
    let s = initFbDraft(Array.from({ length: 7 }, () => W))
    s = draftToSlot(s, byId('QB-a'), 'QB')
    expect(s.respinsUsed.offense).toBe(0)
    expect(openFbSlots(s).length).toBe(11)
    expect(canRespin(s)).toBe(false)
    expect(respin(s)).toBe(s) // no-op, same reference
  })

  it('is exact at the boundary (off-by-one pin)', () => {
    // From the start 12 slots are open; a respin advances one window, so it needs
    // 12 windows to REMAIN after it → a 13-window sequence just allows the first
    // respin, a 12-window one strands a slot. Pins canRespin's `>=` against an
    // off-by-one regression.
    expect(canRespin(initFbDraft(Array.from({ length: 13 }, () => W)))).toBe(
      true,
    )
    expect(canRespin(initFbDraft(Array.from({ length: 12 }, () => W)))).toBe(
      false,
    )
  })
})

describe('completion', () => {
  it('is complete when all 12 slots are filled', () => {
    const s = fillDefense(fillOffense(initFbDraft(SEQ)))
    expect(allFbSlotsFilled(s)).toBe(true)
    expect(isFbComplete(s)).toBe(true)
  })

  it('is complete when the window sequence runs out', () => {
    const short = initFbDraft([W, W]) // only 2 rounds
    let s = draftToSlot(short, byId('QB-a'), 'QB')
    s = draftToSlot(s, byId('RB-a'), 'RB')
    expect(s.cursor).toBe(2)
    expect(isFbComplete(s)).toBe(true)
    expect(allFbSlotsFilled(s)).toBe(false)
  })

  it('drafting or respinning past the end of the sequence is a no-op', () => {
    // Exhaust a 2-window sequence, then confirm both transitions reject cleanly
    // (same reference) once there is no current window left to draft from.
    const short = initFbDraft([W, W])
    let s = draftToSlot(short, byId('QB-a'), 'QB')
    s = draftToSlot(s, byId('RB-a'), 'RB')
    expect(isFbComplete(s)).toBe(true)
    expect(currentFbWindow(s)).toBeNull()
    expect(draftToSlot(s, byId('WR-a'), 'WR')).toBe(s)
    expect(respin(s)).toBe(s)
  })
})

describe('playersThisEra', () => {
  it('returns only current-side players in the window, sorted by id', () => {
    const s = initFbDraft(SEQ)
    const ids = playersThisEra(s, pool).map((p) => p.id)
    expect(ids).toContain('QB-a')
    expect(ids).not.toContain('DE-a') // defense hidden during offense phase
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('switches to defensive players after offense is filled', () => {
    const s = fillOffense(initFbDraft(SEQ))
    const ids = playersThisEra(s, pool).map((p) => p.id)
    expect(ids).toContain('DE-a')
    expect(ids).not.toContain('QB-b')
  })
})

describe('projected record', () => {
  it('rates one starter per filled slot', () => {
    const s = fillDefense(fillOffense(initFbDraft(SEQ)))
    const rated = ratedStarters(s, true)
    expect(rated).toHaveLength(12)
    for (const r of rated) expect(r.rating).toBeGreaterThan(0)
  })

  it('produces a sane record out of 16 for a full elite roster', () => {
    const s = fillDefense(fillOffense(initFbDraft(SEQ)))
    const res = fbDraftResult(s, true)
    expect(res.games).toBe(16)
    expect(res.wins).toBeGreaterThanOrEqual(0)
    expect(res.wins).toBeLessThanOrEqual(16)
    expect(res.label).toBe(`${res.wins}–${16 - res.wins}`)
    expect(typeof res.grade).toBe('string')
  })

  it('the non-power-5 haircut never raises the projected wins', () => {
    const s = fillDefense(fillOffense(initFbDraft(SEQ)))
    const p5 = fbDraftResult(s, true).wins
    const np5 = fbDraftResult(s, false).wins
    expect(np5).toBeLessThanOrEqual(p5)
  })
})

describe('FB_SLOTS wiring sanity', () => {
  it('exposes exactly 12 slots, 6 per side', () => {
    expect(FB_SLOTS).toHaveLength(12)
    expect(FB_SLOTS.filter((x) => x.side === 'offense')).toHaveLength(6)
    expect(FB_SLOTS.filter((x) => x.side === 'defense')).toHaveLength(6)
  })
})

describe('FB_DRAFT_ROUNDS sizing', () => {
  it('a full-length daily sequence survives both per-side respins and still fills all 12 slots', () => {
    const seq = Array.from({ length: FB_DRAFT_ROUNDS }, () => W)
    let s = initFbDraft(seq)
    s = respin(s) // burn the one offensive respin
    s = fillOffense(s) // 6 offensive picks
    expect(currentSide(s)).toBe('defense')
    s = respin(s) // burn the one defensive respin
    s = fillDefense(s) // 6 defensive picks
    expect(allFbSlotsFilled(s)).toBe(true)
    expect(isFbComplete(s)).toBe(true)
    expect(s.cursor).toBe(seq.length)
  })
})
