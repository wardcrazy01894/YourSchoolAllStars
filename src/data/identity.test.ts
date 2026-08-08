// Player-identity guard: one human must be ONE player row.
//
// Every school pipeline keys person identity on the source's spelling of the
// name, so a source that misspells a player in some of his seasons forks him
// into two half-players — each with a truncated career, each rated on part of
// his production, and BOTH spinnable onto the same draft board (UNC's
// "Dominique Green" / "Dominquie Green" safeties, spotted in play). That is
// invisible to the shape/coverage guards: both halves are well-formed.
//
// The signature of a fork is a near-identical name whose two tenures butt up
// against each other and together still fit one career. Real look-alikes
// (brothers, twins, same-name teammates) are common in this data, so they get
// an explicit, cited allowlist rather than a looser threshold.

import { describe, it, expect } from 'vitest'
import {
  michiganBasketball,
  virginiaTechBasketball,
  northCarolinaBasketball,
  floridaBasketball,
  vcuBasketball,
  pittsburghBasketball,
  michiganFootball,
  pittsburghFootball,
  floridaFootball,
  virginiaTechFootball,
  northCarolinaFootball,
} from './index'

interface Person {
  id: string
  name: string
  position: string
  firstYear: number
  lastYear: number
}

const DATASETS: { school: string; sport: string; players: Person[] }[] = [
  michiganBasketball,
  virginiaTechBasketball,
  northCarolinaBasketball,
  floridaBasketball,
  vcuBasketball,
  pittsburghBasketball,
  michiganFootball,
  pittsburghFootball,
  floridaFootball,
  virginiaTechFootball,
  northCarolinaFootball,
].map((d) => ({ school: d.school, sport: d.sport, players: d.players }))

/** Verified-distinct look-alikes: two real humans, not one forked person. */
const KNOWN_DISTINCT = new Set([
  // Twin brothers, both Hokies, both on the roster in 2022-23 — Jorden a
  // defensive lineman, Jayden a linebacker (hokiesports.com rosters).
  'Virginia Tech|football|jayden-mcdonald|jorden-mcdonald',
  // Two different Hokies named Jimmy Williams in 2002: the DL (ESPN titles his
  // page "Jimmy E. Williams - Virginia Tech Hokies Defensive Lineman") and the
  // DB drafted by Atlanta. See data-work/vt/positions-override.json.
  'Virginia Tech|football|jimmy-e-williams|jimmy-williams',
])

/** Lowercase letters only: accents, punctuation and generational suffixes out. */
function normalize(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '')
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = cur
  }
  return prev[b.length]
}

/** 1 = identical, 0 = nothing in common. */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max
}

// A one- or two-character spelling slip over a typical name length. Loose
// enough for "Dominique"/"Dominquie" (edit distance 2 in 14 characters).
const SIMILAR = 0.85
// Longest plausible single career: 4 years of eligibility + a redshirt + a
// medical/COVID year. Wider than this and two same-name players are two people.
const MAX_CAREER = 6
// Biggest hole one career can have between the two halves. This deliberately
// matches merge.mjs's own same-person adjacency tolerance: a fork's halves are
// separated by however many statless years (redshirt, injury) sit between them,
// and 32 UNC players alone have a real interior gap of 2-3 years. A tighter
// bound here would let exactly the fork this guard exists to catch slip past.
const MAX_GAP = 3

describe.each(DATASETS)(
  '$school $sport player identity',
  ({ school, sport, players }) => {
    it('no player is forked into two near-identical names', () => {
      const forks: string[] = []
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i]
          const b = players[j]
          // Cheap structural filters first — the edit distance is the expensive part.
          const [lo, hi] = a.firstYear <= b.firstYear ? [a, b] : [b, a]
          if (hi.firstYear - lo.lastYear > MAX_GAP) continue // too far apart to be one career
          const span =
            Math.max(a.lastYear, b.lastYear) -
            Math.min(a.firstYear, b.firstYear) +
            1
          if (span > MAX_CAREER) continue
          const na = normalize(a.name)
          const nb = normalize(b.name)
          if (na === nb) continue // exact same-name teammates are handled elsewhere
          // dist >= |len difference|, so this can't clear SIMILAR.
          const max = Math.max(na.length, nb.length)
          if (Math.abs(na.length - nb.length) > (1 - SIMILAR) * max) continue
          if (similarity(na, nb) < SIMILAR) continue
          const key = [a.id, b.id].sort().join('|')
          if (KNOWN_DISTINCT.has(`${school}|${sport}|${key}`)) continue
          forks.push(
            `${a.name} (${a.firstYear}-${a.lastYear}, ${a.position}) <> ` +
              `${b.name} (${b.firstYear}-${b.lastYear}, ${b.position})`,
          )
        }
      }
      expect(forks).toEqual([])
    })
  },
)
