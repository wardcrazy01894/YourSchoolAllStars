// VT football: merge the per-season drafts (gap/ 1994–2012 + wmt/ 2013–2025)
// into one person-centric draft at data-work/vt/merged.json.
//
// Usage:  node data-work/vt/merge.mjs
//
// Person identity: normalized name + YEAR-ADJACENCY. Same-name rows merge only
// while they extend a plausible tenure (span ≤ 6 with gaps ≤ 2); otherwise a
// NEW person starts (two humans sharing a name decades apart — the Pitt
// false-merge class). Ids are de-collided with a -<firstYear> suffix. Names
// are keyed case-folded with punctuation/suffix (Jr., III) stripped; a small
// RENAME map handles cross-source first-name variants (Josh/Joshua class).
//
// Positions: WMT stats rows (2013+) and WMT rosters (2002–2012, joined by
// normalized name+year) vote per person; fine codes (QB…S) win over coarse
// (DL/DB). FB counts as RB. Unresolved/coarse positions stay in the draft
// with `position: null` + `positionVotes` for the SR sweep to settle —
// nothing is guessed here. OL/K/P/LS-only players are excluded (not
// draftable) and counted in the report.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Cross-source name variants (roster name -> cume name space), verified by
// jersey/position/era context during curation. Extend as the join reports.
const RENAME = {
  'joshua morgan': 'josh morgan',
}

const normName = (s) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
const keyOf = (s) => RENAME[normName(s)] ?? normName(s)

const FINE = new Set(['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S'])
const COARSE = new Set(['DL', 'DB'])
const EXCLUDE = new Set(['OL', 'K', 'P', 'LS'])
const posOf = (raw) => {
  if (!raw) return null
  const c = raw.toUpperCase()
  if (c === 'FB') return 'RB'
  return FINE.has(c) || COARSE.has(c) || EXCLUDE.has(c) ? c : null
}

// ── load all season rows ──────────────────────────────────────────────────────
const seasons = [] // {year, name, key, pos, games, stats, source}
for (let y = 1994; y <= 2012; y++) {
  const d = JSON.parse(readFileSync(join(HERE, 'gap', `${y}.json`)))
  for (const p of d.players)
    seasons.push({
      year: y,
      name: p.name,
      key: keyOf(p.name),
      pos: null, // gap cumes carry no position
      games: p.games,
      stats: p.stats,
      source: d.source,
    })
}
for (let y = 2013; y <= 2025; y++) {
  const d = JSON.parse(readFileSync(join(HERE, 'wmt', `${y}.json`)))
  for (const p of d.players)
    seasons.push({
      year: y,
      name: p.name,
      key: keyOf(p.name),
      pos: posOf(p.position),
      games: p.games,
      stats: p.stats,
      source: d.source,
    })
}

// Roster position votes (2002–2012), by key+year.
const rosterPos = new Map() // `${key}:${year}` -> code
for (let y = 2002; y <= 2012; y++) {
  const f = join(HERE, 'rosters', `${y}.json`)
  if (!existsSync(f)) continue
  const d = JSON.parse(readFileSync(f))
  for (const p of d.players)
    if (p.position) rosterPos.set(`${keyOf(p.name)}:${y}`, posOf(p.position))
}

// ── person assembly with year-adjacency guard ────────────────────────────────
seasons.sort((a, b) => a.key.localeCompare(b.key) || a.year - b.year)
const persons = []
let cur = null
for (const s of seasons) {
  const fits =
    cur &&
    cur.key === s.key &&
    s.year - cur.rows.at(-1).year <= 3 && // gap ≤ 2 seasons between rows
    s.year - cur.rows[0].year <= 5 // span ≤ 6 years total
  if (fits) cur.rows.push(s)
  else {
    cur = { key: s.key, rows: [s] }
    persons.push(cur)
  }
}

// ── position resolution per person ───────────────────────────────────────────
const OFF_FINE = new Set(['QB', 'RB', 'WR', 'TE'])
const DEF_FINE = new Set(['DE', 'DT', 'LB', 'CB', 'S'])
// "Real defender" test — a WR with one special-teams tackle is NOT a
// defender, but a safety with 55 tackles is. Thresholds keep the guard from
// pushing every gunner into the research worklist.
const isDefensiveSeason = (st) =>
  (st.tackles ?? 0) >= 10 ||
  (st.sacks ?? 0) >= 1 ||
  (st.tfl ?? 0) >= 2 ||
  (st.defInt ?? 0) >= 1 ||
  (st.pbu ?? 0) >= 2
const report = { excluded: [], twins: [], unresolved: 0, renamesUsed: 0 }
const out = []
for (const per of persons) {
  const votes = {}
  for (const r of per.rows) {
    const fromStats = r.pos
    const fromRoster = rosterPos.get(`${per.key}:${r.year}`)
    for (const v of [fromStats, fromRoster])
      if (v) votes[v] = (votes[v] ?? 0) + 1
  }
  // Fine codes beat coarse; coarse retained as hint for the SR sweep.
  const fine = Object.entries(votes).filter(([c]) => FINE.has(c))
  const coarse = Object.entries(votes).filter(([c]) => COARSE.has(c))
  const excl = Object.entries(votes).filter(([c]) => EXCLUDE.has(c))
  // A DEFENDER's position must never be settled by an offensive code (the
  // Pitt lesson). Converts (Divine Deablo: listed WR as a freshman, then four
  // years at DB) otherwise take their old offensive label, get rated on a
  // one-catch line, and fall below the floor — silently dropping a
  // first-team All-ACC safety. Real defensive production + a coarse DL/DB
  // vote ⇒ the offensive votes are ignored; a lone offensive fine code no
  // longer wins, and the player goes to the cited-research worklist.
  const defProduction = per.rows.some((r) => isDefensiveSeason(r.stats))
  const defFine = fine.filter(([c]) => DEF_FINE.has(c))
  const offFine = fine.filter(([c]) => OFF_FINE.has(c))
  const coarseDefensive = coarse.length > 0
  let position = null
  if (defFine.length) {
    position = defFine.sort((a, b) => b[1] - a[1])[0][0]
  } else if (defProduction && coarseDefensive) {
    position = null // resolve from cited research, not the offensive label
  } else if (offFine.length) {
    position = offFine.sort((a, b) => b[1] - a[1])[0][0]
  }
  const onlyExcluded =
    !fine.length && !coarse.length && excl.length > 0
  if (onlyExcluded) {
    report.excluded.push(per.rows[0].name)
    continue
  }
  if (!position) report.unresolved++
  const name = per.rows.at(-1).name // latest spelling wins for display
  out.push({
    name,
    key: per.key,
    position,
    positionVotes: votes,
    firstYear: per.rows[0].year,
    lastYear: per.rows.at(-1).year,
    seasons: per.rows.map((r) => ({
      year: r.year,
      games: r.games,
      stats: r.stats,
      source: r.source,
    })),
  })
}

// Same-key persons (split by the adjacency guard) — the twin report.
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
writeFileSync(
  join(HERE, 'merged.json'),
  JSON.stringify({ generated: new Date().toISOString(), players: out }, null, 1),
)
console.log(
  `persons: ${out.length} (excluded OL/K/P/LS-only: ${report.excluded.length}, position-unresolved: ${report.unresolved})`,
)
console.log('adjacency-split same-name persons (verify humans, not errors):')
for (const t of report.twins) console.log('  ' + t)
