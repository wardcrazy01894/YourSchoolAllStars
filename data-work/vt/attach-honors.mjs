// VT honors, stage 4c: attach the derived ledgers to the dataset.
//
// Usage:  node data-work/vt/attach-honors.mjs [--write]
//
// Reads honors/ledger-official.json + honors/ledger-wiki.json, matches each
// entry to a player-season in src/data/vt-football.json (normalized name +
// exact year — football eligibility is season-row-based, so an honor only
// lands on the year it was won), and rewrites the `honors` arrays.
//
// Nothing is guessed: an entry whose name doesn't match a dataset player, or
// whose year has no season row for that player, is REPORTED and dropped (most
// are kickers/punters/OL — positions the dataset doesn't carry — or players
// trimmed below the composite floor). A NAME_MAP handles the handful of
// spelling variants between the honors pages and the stats pages.
//
// Dedup: one honor string per (player, year); when a player has both a
// team-level honor and a better one for the same year+kind, the HIGHEST team
// level wins (First > Second > Third > HM), matching the project convention.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATASET = join(HERE, '..', '..', 'src', 'data', 'vt-football.json')
const WRITE = process.argv.includes('--write')

// Honors-page spelling → dataset spelling (verified same human/season).
// Keys are POST-normalization (lowercase, no punctuation/diacritics).
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
    .replace(/[̀-ͯ]/g, '') // strip diacritics (André → Andre)
    .toLowerCase()
    .replace(/[""'’]/g, '')
    .replace(/[.]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
const key = (s) => NAME_MAP[norm(s)] ?? norm(s)

const data = JSON.parse(readFileSync(DATASET, 'utf8'))
const ledger = [
  ...JSON.parse(readFileSync(join(HERE, 'honors', 'ledger-official.json'))),
  ...JSON.parse(readFileSync(join(HERE, 'honors', 'ledger-wiki.json'))),
]

// player index: key(name) → player
const byName = new Map()
for (const p of data.players) {
  const k = key(p.name)
  if (byName.has(k)) byName.set(k, 'AMBIGUOUS')
  else byName.set(k, p)
}

const TEAM_RANK = { First: 1, Second: 2, Third: 3, HM: 4 }
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

// (player, year) → { allConf: {honor, rank}, others: Set }
const picked = new Map()
const unmatched = []
const ambiguous = []
for (const e of ledger) {
  const p = byName.get(key(e.name))
  if (!p) {
    unmatched.push(`${e.year} ${e.name} — ${e.honor} (no such player)`)
    continue
  }
  if (p === 'AMBIGUOUS') {
    ambiguous.push(`${e.year} ${e.name} — ${e.honor}`)
    continue
  }
  const season = p.seasons.find((s) => s.year === e.year)
  if (!season) {
    unmatched.push(`${e.year} ${e.name} — ${e.honor} (no season row)`)
    continue
  }
  const mk = `${p.id}:${e.year}`
  if (!picked.has(mk)) picked.set(mk, { allConf: null, others: new Set() })
  const slot = picked.get(mk)
  const team = teamOf(e.honor)
  if (team) {
    const rank = TEAM_RANK[team]
    if (!slot.allConf || rank < slot.allConf.rank)
      slot.allConf = { honor: e.honor, rank }
  } else {
    slot.others.add(e.honor)
  }
}

// write
let attached = 0
for (const p of data.players) {
  for (const s of p.seasons) {
    const slot = picked.get(`${p.id}:${s.year}`)
    const honors = slot
      ? [...(slot.allConf ? [slot.allConf.honor] : []), ...slot.others]
      : []
    // Stable order: national/awards first (they sort ahead by string anyway
    // in the UI's badge ranking), then the all-conference line.
    honors.sort()
    s.honors = honors
    attached += honors.length
  }
}

console.log(
  `ledger entries: ${ledger.length} | attached: ${attached} | unmatched: ${unmatched.length} | ambiguous: ${ambiguous.length}`,
)
if (ambiguous.length) {
  console.log('\nAMBIGUOUS (same name twice in dataset — resolve by hand):')
  for (const a of ambiguous) console.log('  ' + a)
}
console.log('\nUNMATCHED (expected: kickers/punters/OL + below-floor players):')
for (const u of unmatched) console.log('  ' + u)

if (WRITE) {
  writeFileSync(DATASET, JSON.stringify(data, null, 2) + '\n')
  console.log('\nwrote', DATASET)
} else {
  console.log('\n(dry run — pass --write to update the dataset)')
}
