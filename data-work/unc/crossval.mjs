// VT football stage 3: cross-validate merged.json against the parsed SR
// season pages, and produce the position-resolution worklist.
//
// Usage:  node data-work/vt/crossval.mjs
//
// Outputs data-work/vt/crossval-report.json with:
//   deltas    — (person, year, stat) where our value != SR's (tolerance 0;
//               every diff listed, big ones flagged). pbu is NOT compared
//               (SR pass_defended = PBU+INT, ours is pure breakups); tfl is
//               compared only where SR has it.
//   phantoms  — our season rows with NO matching SR row (possible mislinks)
//   holes     — SR rows ≥ small floor with NO row of ours (possible misses)
//   positions — per unresolved-position person: SR pos votes (defense-table
//               pos only counts for rows with defensive production — the
//               Pitt "never let offense-table pos vote on defenders" rule),
//               best composite over candidate positions, ranked worklist.
//
// SR defense pre-2005 is INT-only with ~6 rows/yr — absence there is NOT a
// phantom for defenders; phantom checks for defense start 2005.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const merged = JSON.parse(readFileSync(join(HERE, "merged.json"))).players

const normName = (s) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

// SR name variant → OUR merged key (cume/WMT name space). Verified pairs —
// same human, same seasons; SR spells/splits differently.
const SR_RENAME = {
  'jeron gouveia-winslow': 'j gouveia-winslow',
  'derek dinardo': 'derek di nardo',
  'antwuan powell': 'antwaun powell-ryland', // added -Ryland mid-career
  'emmanual belmar': 'emmanuel belmar', // SR misspelling
  'drake deiuliis': 'drake de iuliis',
  'samuel denmark': 'sam denmark',
  'ron moody': 'ronald moody',
  '_ goff': 'lance goff', // SR data glitch drops the first name
}
const srKey = (s) => SR_RENAME[normName(s)] ?? normName(s)

// SR table → FbStats mapping
const SR_OFF = {
  pass_yds: 'passYds',
  pass_td: 'passTD',
  pass_int: 'passInt',
  rush_yds: 'rushYds',
  rush_td: 'rushTD',
  rec: 'rec',
  rec_yds: 'recYds',
  rec_td: 'recTD',
}
const SR_DEF = {
  tackles_loss: 'tfl',
  sacks: 'sacks',
  def_int: 'defInt',
  fumbles_forced: 'ff',
}

// Load SR rows: srBy[key][year] = {stats, offPos, defPos, hasDef}
const srBy = new Map()
for (let y = 1994; y <= 2025; y++) {
  const f = join(HERE, 'sr', `${y}.json`)
  if (!existsSync(f)) continue
  const d = JSON.parse(readFileSync(f))
  for (const r of d.rows) {
    const key = srKey(r.name)
    if (!srBy.has(key)) srBy.set(key, new Map())
    if (!srBy.get(key).has(y))
      srBy.get(key).set(y, { stats: {}, offPos: [], defPos: [], src: d.source })
    const e = srBy.get(key).get(y)
    if (r.table === 'passing_standard' || r.table === 'rushing_standard') {
      for (const [sk, ok] of Object.entries(SR_OFF))
        if (r.stats[sk] !== undefined) e.stats[ok] = r.stats[sk]
      if (r.pos) e.offPos.push(r.pos)
    } else if (r.table === 'defense_standard') {
      const solo = r.stats.tackles_solo ?? 0
      const ast = r.stats.tackles_assists ?? 0
      if (solo + ast > 0) e.stats.tackles = solo + ast
      for (const [sk, ok] of Object.entries(SR_DEF))
        if (r.stats[sk] !== undefined) e.stats[ok] = r.stats[sk]
      if (r.pos) e.defPos.push(r.pos)
    }
  }
}

const TERMS = {
  QB: [['passYds',3500,18,1],['passTD',35,16,1],['rushYds',700,5,1],['rushTD',10,3,1],['passInt',10,6,-1]],
  RB: [['rushYds',1500,20,1],['rushTD',18,12,1],['rec',35,4,1],['recYds',400,4,1],['recTD',4,2,1]],
  WR: [['rec',70,14,1],['recYds',1100,20,1],['recTD',11,10,1],['rushYds',150,1,1]],
  TE: [['rec',50,16,1],['recYds',650,18,1],['recTD',7,10,1]],
  DE: [['sacks',11,18,1],['tfl',18,12,1],['tackles',55,6,1],['ff',4,4,1],['defInt',2,2,1]],
  DT: [['sacks',7,16,1],['tfl',13,12,1],['tackles',50,10,1],['ff',3,4,1]],
  LB: [['tackles',120,16,1],['tfl',15,10,1],['sacks',6,8,1],['defInt',3,5,1],['pbu',6,3,1],['ff',3,3,1]],
  CB: [['defInt',5,16,1],['pbu',14,14,1],['tackles',55,8,1],['tfl',4,3,1],['ff',2,3,1]],
  S: [['tackles',90,14,1],['defInt',4,12,1],['pbu',9,8,1],['tfl',7,5,1],['ff',3,3,1]],
}
const composite = (pos, stats) =>
  (TERMS[pos] ?? []).reduce((c, [st, ref, w, sg]) => {
    const v = stats[st]
    return typeof v === 'number' ? c + (v / ref) * w * sg : c
  }, 0)
const bestComposite = (p) => {
  const cands = p.position
    ? [p.position]
    : { DB: ['CB', 'S'], DL: ['DE', 'DT'] }[
        Object.keys(p.positionVotes ?? {}).find((c) => c === 'DB' || c === 'DL')
      ] ?? Object.keys(TERMS)
  let best = 0
  for (const pos of cands)
    for (const s of p.seasons) best = Math.max(best, composite(pos, s.stats))
  return Math.round(best * 10) / 10
}

const CMP = ['passYds','passTD','passInt','rushYds','rushTD','rec','recYds','recTD','tackles','sacks','defInt','ff']
const deltas = [], phantoms = [], holes = []

const ourBy = new Map()
for (const p of merged) {
  for (const s of p.seasons) {
    ourBy.set(`${p.key}:${s.year}`, true)
    const sr = srBy.get(p.key)?.get(s.year)
    if (!sr) {
      const offOnly = Object.keys(s.stats).every((k) =>
        ['passYds','passTD','passInt','rushYds','rushTD','rec','recYds','recTD'].includes(k),
      )
      // Pre-2005 SR defense is INT-only: a defender absent there is expected.
      if (offOnly || s.year >= 2005)
        phantoms.push({ name: p.name, year: s.year, stats: s.stats })
      continue
    }
    for (const k of CMP) {
      const ours = s.stats[k]
      const theirs = sr.stats[k]
      if (ours === undefined && theirs === undefined) continue
      // Defensive keys pre-2005: SR only has def_int (+ff sometimes) — skip
      // tackle/sack comparison there.
      if (s.year < 2005 && ['tackles','sacks'].includes(k)) continue
      const a = ours ?? 0
      const b = theirs ?? 0
      if (Math.abs(a - b) > 0.101)
        deltas.push({ name: p.name, year: s.year, stat: k, ours: a, sr: b, big: Math.abs(a - b) >= 30 || (b !== 0 && Math.abs(a - b) / Math.max(1, Math.abs(b)) > 0.5) })
    }
  }
}
// holes: SR rows with real production and no row of ours
for (const [key, years] of srBy) {
  for (const [y, e] of years) {
    if (ourBy.has(`${key}:${y}`)) continue
    const size = Object.values(e.stats).reduce((a, v) => a + Math.abs(v), 0)
    if (size >= 30)
      holes.push({ srName: key, year: y, stats: e.stats })
  }
}

// position worklist for unresolved persons
const positions = []
for (const p of merged.filter((x) => !x.position)) {
  const votes = { def: {}, off: {} }
  for (const s of p.seasons) {
    const sr = srBy.get(p.key)?.get(s.year)
    if (!sr) continue
    const hasDef = ['tackles','sacks','defInt','tfl'].some((k) => s.stats[k])
    for (const c of sr.defPos) votes.def[c] = (votes.def[c] ?? 0) + 1
    if (!hasDef) for (const c of sr.offPos) votes.off[c] = (votes.off[c] ?? 0) + 1
  }
  positions.push({
    name: p.name,
    span: `${p.firstYear}-${p.lastYear}`,
    composite: bestComposite(p),
    wmtVotes: p.positionVotes,
    srDefVotes: votes.def,
    srOffVotes: votes.off,
  })
}
positions.sort((a, b) => b.composite - a.composite)

writeFileSync(
  join(HERE, 'crossval-report.json'),
  JSON.stringify({ deltas, phantoms, holes, positions }, null, 1),
)
console.log(
  `deltas: ${deltas.length} (${deltas.filter((d) => d.big).length} big) | phantoms: ${phantoms.length} | holes: ${holes.length} | unresolved positions: ${positions.length}`,
)
console.log('top position worklist (composite ≥ 8):')
for (const p of positions.filter((x) => x.composite >= 8).slice(0, 25))
  console.log(
    `  ${p.name} ${p.span} comp=${p.composite} wmt=${JSON.stringify(p.wmtVotes)} srDef=${JSON.stringify(p.srDefVotes)} srOff=${JSON.stringify(p.srOffVotes)}`,
  )
