// VT honors, stage 4d: re-derive the shipped honors straight from the two
// ledgers and diff against src/data/vt-football.json.
//
// Usage:  node data-work/vt/verify-honors.mjs
//
// The point (per the honors memory: "never trust a research ledger
// unverified") is that the SHIPPED strings must be exactly what the sources
// say — no invented honors, no dropped ones. This recomputes the expected
// per-player-season honor set from the ledgers using the same rules as
// attach-honors.mjs, and reports:
//   PHANTOM — a shipped honor with no ledger entry behind it
//   MISSING — a ledger entry (for a player-season that EXISTS in the dataset)
//             that didn't make it into the shipped file
// Exits nonzero on any diff, so it can gate the PR.
//
// WHAT THIS DOES AND DOESN'T PROVE (don't over-trust a "0/0"): it re-derives
// from the SAME ledgers with the SAME name-matching and highest-team-level
// rules as attach-honors.mjs, so it catches a stale write, a hand-edit of the
// shipped honors, or attach's logic drifting from a fresh recompute. It does
// NOT catch a wrong {year, name, honor} triple coming out of the HTML/wikitext
// parsers, a bad NAME_MAP entry, or an identity error upstream in merge.mjs —
// both scripts would agree on the same wrong answer. Source-level correctness
// is covered separately: the parsers assert their source layouts, and the
// derivation was independently fact-checked against the public record
// (14/14 marquee honors confirmed — see PROGRESS.md).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'src', 'data', 'vt-football.json')),
)
const ledger = [
  ...JSON.parse(readFileSync(join(HERE, 'honors', 'ledger-official.json'))),
  ...JSON.parse(readFileSync(join(HERE, 'honors', 'ledger-wiki.json'))),
]

const NAME_MAP = {
  'victor macho harris': 'victor harris',
  'macho harris': 'victor harris',
  'nathaniel williams': 'nat williams',
  'antwuan powell': 'antwaun powell-ryland',
  'antwaun powell': 'antwaun powell-ryland',
  'jeron gouveia-winslow': 'j gouveia-winslow',
}
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/["'’]/g, '')
    .replace(/[.]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
const key = (s) => NAME_MAP[norm(s)] ?? norm(s)

const byName = new Map()
for (const p of data.players) {
  const k = key(p.name)
  byName.set(k, byName.has(k) ? 'AMBIGUOUS' : p)
}

const RANK = { First: 1, Second: 2, Third: 3, HM: 4 }
const teamOf = (h) =>
  /First-Team/.test(h)
    ? 'First'
    : /Second-Team/.test(h)
      ? 'Second'
      : /Third-Team/.test(h)
        ? 'Third'
        : /Honorable Mention/.test(h)
          ? 'HM'
          : null

// expected[playerId:year] = Set(honor)
const expected = new Map()
for (const e of ledger) {
  const p = byName.get(key(e.name))
  if (!p || p === 'AMBIGUOUS') continue
  if (!p.seasons.some((s) => s.year === e.year)) continue
  const k = `${p.id}:${e.year}`
  if (!expected.has(k)) expected.set(k, { allConf: null, others: new Set() })
  const slot = expected.get(k)
  const t = teamOf(e.honor)
  if (t) {
    if (!slot.allConf || RANK[t] < slot.allConf.rank)
      slot.allConf = { honor: e.honor, rank: RANK[t] }
  } else slot.others.add(e.honor)
}

const phantom = []
const missing = []
for (const p of data.players) {
  for (const s of p.seasons) {
    const slot = expected.get(`${p.id}:${s.year}`)
    const want = new Set(
      slot ? [...(slot.allConf ? [slot.allConf.honor] : []), ...slot.others] : [],
    )
    for (const h of s.honors)
      if (!want.has(h)) phantom.push(`${p.name} ${s.year}: ${h}`)
    for (const h of want)
      if (!s.honors.includes(h)) missing.push(`${p.name} ${s.year}: ${h}`)
  }
}

const total = data.players.reduce(
  (n, p) => n + p.seasons.reduce((m, s) => m + s.honors.length, 0),
  0,
)
console.log(
  `shipped honors: ${total} | ledger entries: ${ledger.length} | phantoms: ${phantom.length} | missing: ${missing.length}`,
)
for (const x of phantom) console.log('  PHANTOM', x)
for (const x of missing) console.log('  MISSING', x)
if (phantom.length || missing.length) process.exitCode = 1
else console.log('OK — every shipped honor traces to a source ledger entry.')
