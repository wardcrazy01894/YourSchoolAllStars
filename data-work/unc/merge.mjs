// UNC: merge the per-season rows (seasons/) into persons.
//
// Usage:  node data-work/unc/merge.mjs
// Output: data-work/unc/merged.json
//
// Carries the two guards the earlier schools' bugs bought us:
//   • YEAR-ADJACENCY person identity (Pitt): same-name rows merge only while
//     they extend a plausible tenure (span ≤ 6, gaps ≤ 2). Two humans sharing a
//     name a decade apart stay two people.
//   • An OFFENSIVE position code must never settle a DEFENDER's position (VT /
//     Divine Deablo). UNC has the same trap in Chazz Surratt — a QB who became
//     a first-team All-ACC LINEBACKER — so a player with real defensive
//     production ignores his old offensive label and goes to cited research.
//
// Positions are spelled out on the goheels rosters ("Defensive End"), which is
// a better oracle than SR's coarse DB/DL. Coarse or missing → null (never a
// guess); resolve-positions.mjs settles those from SR fine codes + research.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIRST = 1994
const LAST = 2025

const FINE = new Set(['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S'])
const COARSE = new Set(['DL', 'DB'])
const EXCLUDE = new Set(['OL', 'K', 'P', 'LS'])

/** goheels/SR position text → our code (or a coarse/exclude marker). */
function posOf(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase()
  if (/quarterback|^qb$/.test(s)) return 'QB'
  if (/tailback|running back|fullback|^rb$|^tb$|^fb$/.test(s)) return 'RB'
  if (/wide receiver|^wr$|flanker|split end/.test(s)) return 'WR'
  if (/tight end|^te$/.test(s)) return 'TE'
  if (/defensive end|^de$|edge/.test(s)) return 'DE'
  if (/defensive tackle|nose (tackle|guard)|^dt$|^nt$|^ng$/.test(s)) return 'DT'
  if (/linebacker|^lb$|^olb$|^ilb$|^mlb$/.test(s)) return 'LB'
  if (/cornerback|^cb$/.test(s)) return 'CB'
  if (/safety|^s$|^fs$|^ss$|rover/.test(s)) return 'S'
  if (/defensive back|^db$/.test(s)) return 'DB'
  if (/defensive lineman|defensive line|^dl$/.test(s)) return 'DL'
  if (/offensive|guard|tackle|center|^ol$|^og$|^ot$|^c$|^t$|^g$/.test(s))
    return 'OL'
  if (/kicker|placekicker|^pk$|^k$/.test(s)) return 'K'
  if (/punter|^p$/.test(s)) return 'P'
  if (/long snapper|^ls$/.test(s)) return 'LS'
  return null
}

// Cross-source name variants (the Sidearm payload and the SR/roster spellings
// disagree), verified same human/era. Without these the person is SPLIT in two
// and his honors can't attach to the seasons he won them in.
const RENAME = {
  'a ratliff': 'anthony ratliff-williams',
}

const normName0 = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
const normName = (s) => RENAME[normName0(s)] ?? normName0(s)

// ── load ─────────────────────────────────────────────────────────────────────
const rows = []
for (let y = FIRST; y <= LAST; y++) {
  const f = join(HERE, 'seasons', `${y}.json`)
  const d = JSON.parse(readFileSync(f))
  for (const p of d.players)
    rows.push({
      year: y,
      name: p.name,
      key: normName(p.name),
      pos: posOf(p.position),
      stats: p.stats,
      source: p.source,
      from: d.from,
    })
}

// A source can list the same person twice in one season (two table rows for
// one player), which would ship duplicate season years — the guard rejects
// that. Collapse to ONE row per (person, year), merging the stat keys.
const byPersonYear = new Map()
for (const r of rows) {
  const k = `${r.key}:${r.year}`
  const prev = byPersonYear.get(k)
  if (!prev) byPersonYear.set(k, r)
  else prev.stats = { ...prev.stats, ...r.stats }
}
rows.length = 0
rows.push(...byPersonYear.values())

// ── persons (year-adjacency) ─────────────────────────────────────────────────
rows.sort((a, b) => a.key.localeCompare(b.key) || a.year - b.year)
const persons = []
let cur = null
for (const r of rows) {
  const fits =
    cur &&
    cur.key === r.key &&
    r.year - cur.rows.at(-1).year <= 3 &&
    r.year - cur.rows[0].year <= 5
  if (fits) cur.rows.push(r)
  else {
    cur = { key: r.key, rows: [r] }
    persons.push(cur)
  }
}

// ── positions ────────────────────────────────────────────────────────────────
const OFF_FINE = new Set(['QB', 'RB', 'WR', 'TE'])
const DEF_FINE = new Set(['DE', 'DT', 'LB', 'CB', 'S'])
// A real defender, not a receiver with one special-teams tackle.
const isDefensiveSeason = (st) =>
  (st.tackles ?? 0) >= 10 ||
  (st.sacks ?? 0) >= 1 ||
  (st.tfl ?? 0) >= 2 ||
  (st.defInt ?? 0) >= 1 ||
  (st.pbu ?? 0) >= 2

const out = []
const report = { excluded: 0, unresolved: 0, twins: [] }
for (const per of persons) {
  const votes = {}
  for (const r of per.rows) if (r.pos) votes[r.pos] = (votes[r.pos] ?? 0) + 1
  const fine = Object.entries(votes).filter(([c]) => FINE.has(c))
  const coarse = Object.entries(votes).filter(([c]) => COARSE.has(c))
  const excl = Object.entries(votes).filter(([c]) => EXCLUDE.has(c))
  if (!fine.length && !coarse.length && excl.length) {
    report.excluded++
    continue
  }
  const defFine = fine.filter(([c]) => DEF_FINE.has(c))
  const offFine = fine.filter(([c]) => OFF_FINE.has(c))
  const defProduction = per.rows.some((r) => isDefensiveSeason(r.stats))
  let position = null
  if (defFine.length) {
    position = defFine.sort((a, b) => b[1] - a[1])[0][0]
  } else if (defProduction) {
    // Real defensive production but NO defensive fine code — the convert case.
    // Chazz Surratt's roster line says "Quarterback" for all four years even
    // though he moved to linebacker and made first-team All-ACC there (91
    // tackles in 2019); trusting the offensive label would rate him as a QB on
    // a backup's passing line and trim him. This must NOT depend on a coarse
    // DL/DB vote existing (VT's version did, and that's the hole Surratt falls
    // through). Send it to cited research instead.
    position = null
  } else if (offFine.length) {
    position = offFine.sort((a, b) => b[1] - a[1])[0][0]
  }
  if (!position) report.unresolved++
  out.push({
    name: per.rows.at(-1).name,
    key: per.key,
    position,
    positionVotes: votes,
    firstYear: per.rows[0].year,
    lastYear: per.rows.at(-1).year,
    seasons: per.rows.map((r) => ({
      year: r.year,
      stats: r.stats,
      source: r.source,
      from: r.from,
    })),
  })
}

const byKey = new Map()
for (const p of out) byKey.set(p.key, (byKey.get(p.key) ?? 0) + 1)
for (const [k, n] of byKey)
  if (n > 1)
    report.twins.push(
      `${k}: ${out
        .filter((p) => p.key === k)
        .map((p) => `${p.firstYear}-${p.lastYear}`)
        .join(' vs ')}`,
    )

out.sort((a, b) => a.firstYear - b.firstYear || a.key.localeCompare(b.key))
writeFileSync(join(HERE, 'merged.json'), JSON.stringify({ players: out }, null, 1))
console.log(
  `persons: ${out.length} | OL/K/P/LS-only excluded: ${report.excluded} | position-unresolved: ${report.unresolved}`,
)
console.log('adjacency-split same-name persons (verify humans, not errors):')
for (const t of report.twins) console.log('  ' + t)
