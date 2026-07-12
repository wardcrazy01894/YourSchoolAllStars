#!/usr/bin/env node
// Football data pipeline — pulls a school's per-player season stats from the
// CFBD API (collegefootballdata.com) and emits a DRAFT `FbPlayer[]` dataset
// (best season per player) plus a coverage report, ready for human curation.
//
// This is step 1 of the documented football pipeline (see
// docs/DATA-SOURCING.md §Football). It is REUSABLE for any school: change
// --team. It never writes the API key anywhere — the key is read from the
// CFBD_API_KEY environment variable only.
//
//   CFBD_API_KEY=… node scripts/fetch-football.mjs \
//     --team "Michigan" --start 2005 --end 2024 \
//     --out /tmp/michigan-football.draft.json
//
// Output is a DRAFT, not the final dataset: it has CFBD-cited sources and empty
// honors[]. A human curates it (trims to a coverage-satisfying pool, resolves
// ambiguous positions, adds honors, upgrades sources) before it lands in
// src/data and `_provisional` flips to false. The schema mirrors `FbPlayer`
// (src/types.ts); the best-season picker mirrors fbStatComposite
// (src/lib/football-rating.ts) — keep the REF/WEIGHT table below in sync.

const API = 'https://api.collegefootballdata.com'

// ── args ─────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const TEAM = arg('team', 'Michigan')
const START = Number(arg('start', '2005'))
const END = Number(arg('end', '2024'))
const OUT = arg('out', '')

const KEY = process.env.CFBD_API_KEY
if (!KEY) {
  console.error(
    'ERROR: CFBD_API_KEY is not set. Get a free key at ' +
      'https://collegefootballdata.com/key and export it (never commit it):\n' +
      "  export CFBD_API_KEY='…'   # or source a file outside the repo",
  )
  process.exit(1)
}

// ── CFBD (category, statType) → FbStats key ──────────────────────────────────
// CFBD season player stats are long-form rows: {player, category, statType,
// stat}. Map the ones we model; everything else (kicking, returns, attempts…)
// is ignored. PD = passes defended ≈ our pbu; interceptions.INT = our defInt.
const STAT_MAP = {
  'passing/YDS': 'passYds',
  'passing/TD': 'passTD',
  'passing/INT': 'passInt',
  'rushing/YDS': 'rushYds',
  'rushing/TD': 'rushTD',
  'receiving/REC': 'rec',
  'receiving/YDS': 'recYds',
  'receiving/TD': 'recTD',
  'defensive/TOT': 'tackles',
  'defensive/TFL': 'tfl',
  'defensive/SACKS': 'sacks',
  'defensive/PD': 'pbu',
  'defensive/FF': 'ff',
  'fumbles/FF': 'ff',
  'interceptions/INT': 'defInt',
}

// ── CFBD roster position → our FbPosition ────────────────────────────────────
// Single mapping; ambiguous codes (DL, DB) get a best-effort default and are
// surfaced in the report so a human can confirm/split them during curation.
const OFF = new Set(['QB', 'RB', 'WR', 'TE'])
const DEF = new Set(['DE', 'DT', 'LB', 'CB', 'S'])
const AMBIGUOUS = new Set([
  'DL',
  'DB',
  'EDGE',
  'NT',
  'OLB',
  'ILB',
  'MLB',
  'ATH',
])
function mapPosition(raw) {
  if (!raw) return { pos: null, ambiguous: false }
  const p = raw.toUpperCase().trim()
  if (OFF.has(p) || DEF.has(p)) return { pos: p, ambiguous: false }
  const alias = {
    FB: 'RB',
    HB: 'RB',
    TB: 'RB',
    FL: 'WR',
    SE: 'WR',
    WO: 'WR',
    EDGE: 'DE',
    NT: 'DT',
    DL: 'DT', // interior default; could be DE — flagged ambiguous
    OLB: 'LB',
    ILB: 'LB',
    MLB: 'LB',
    WLB: 'LB',
    SLB: 'LB',
    DB: 'CB', // generic DB → CB default; could be S — flagged ambiguous
    FS: 'S',
    SS: 'S',
    SAF: 'S',
    ATH: null,
  }
  if (p in alias) return { pos: alias[p], ambiguous: AMBIGUOUS.has(p) }
  return { pos: null, ambiguous: true }
}

// ── best-season composite — MIRROR of src/lib/football-rating.ts ─────────────
// Keep REFs/WEIGHTs in sync with FB_RATING_TERMS. Used ONLY to pick which season
// is a player's "best" for the best-single-season rule; the game recomputes the
// real rating from the stored line.
const TERMS = {
  QB: [
    ['passYds', 3500, 18, 1],
    ['passTD', 35, 16, 1],
    ['rushYds', 700, 5, 1],
    ['rushTD', 10, 3, 1],
    ['passInt', 10, 6, -1],
  ],
  RB: [
    ['rushYds', 1500, 20, 1],
    ['rushTD', 18, 12, 1],
    ['rec', 35, 4, 1],
    ['recYds', 400, 4, 1],
    ['recTD', 4, 2, 1],
  ],
  WR: [
    ['rec', 70, 14, 1],
    ['recYds', 1100, 20, 1],
    ['recTD', 11, 10, 1],
    ['rushYds', 150, 1, 1],
  ],
  TE: [
    ['rec', 50, 16, 1],
    ['recYds', 650, 18, 1],
    ['recTD', 7, 10, 1],
  ],
  DE: [
    ['sacks', 11, 18, 1],
    ['tfl', 18, 12, 1],
    ['tackles', 55, 6, 1],
    ['ff', 4, 4, 1],
    ['defInt', 2, 2, 1],
  ],
  DT: [
    ['sacks', 7, 16, 1],
    ['tfl', 13, 12, 1],
    ['tackles', 50, 10, 1],
    ['ff', 3, 4, 1],
  ],
  LB: [
    ['tackles', 120, 16, 1],
    ['tfl', 15, 10, 1],
    ['sacks', 6, 8, 1],
    ['defInt', 3, 5, 1],
    ['pbu', 6, 3, 1],
    ['ff', 3, 3, 1],
  ],
  CB: [
    ['defInt', 5, 16, 1],
    ['pbu', 14, 14, 1],
    ['tackles', 55, 8, 1],
    ['tfl', 4, 3, 1],
    ['ff', 2, 3, 1],
  ],
  S: [
    ['tackles', 90, 14, 1],
    ['defInt', 4, 12, 1],
    ['pbu', 9, 8, 1],
    ['tfl', 7, 5, 1],
    ['ff', 3, 3, 1],
  ],
}
function composite(position, stats) {
  let c = 0
  for (const [stat, ref, weight, sign] of TERMS[position] ?? []) {
    const v = stats[stat]
    if (typeof v === 'number') c += (v / ref) * weight * sign
  }
  return c
}

// ── fetch helpers ────────────────────────────────────────────────────────────
async function cfbd(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `CFBD ${path} → HTTP ${res.status} ${res.statusText} ${body}`,
    )
  }
  return res.json()
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ── main ─────────────────────────────────────────────────────────────────────
// Per playerId we accumulate: name, a vote tally of roster positions across
// years, and a per-season FbStats map. Then pick each player's best season.
const players = new Map() // id → { name, posVotes:Map, ambiguous:bool, seasons:Map<year,stats> }

for (let year = START; year <= END; year++) {
  let roster = []
  let stats = []
  try {
    ;[roster, stats] = await Promise.all([
      cfbd(`/roster?team=${encodeURIComponent(TEAM)}&year=${year}`),
      cfbd(
        `/stats/player/season?year=${year}&team=${encodeURIComponent(TEAM)}`,
      ),
    ])
  } catch (e) {
    console.error(`! ${year}: ${e.message}`)
    continue
  }

  // playerId → mapped position (from roster)
  const rosterPos = new Map()
  for (const r of roster) {
    const id = String(r.id ?? r.athleteId ?? '')
    if (!id) continue
    const { pos, ambiguous } = mapPosition(r.position)
    rosterPos.set(id, { pos, ambiguous, raw: r.position })
  }

  for (const row of stats) {
    const id = String(row.playerId ?? row.athleteId ?? '')
    const name = row.player
    if (!id || !name) continue
    const key = `${row.category}/${row.statType}`
    const field = STAT_MAP[key]
    if (!field) continue
    const value = Number(row.stat)
    if (!Number.isFinite(value)) continue

    if (!players.has(id))
      players.set(id, {
        name,
        posVotes: new Map(),
        ambiguous: false,
        seasons: new Map(),
      })
    const p = players.get(id)
    if (!p.seasons.has(year)) p.seasons.set(year, {})
    const line = p.seasons.get(year)
    // Sum guards against duplicate rows; values are season totals.
    line[field] = (line[field] ?? 0) + value

    const rp = rosterPos.get(id)
    if (rp?.pos) {
      p.posVotes.set(rp.pos, (p.posVotes.get(rp.pos) ?? 0) + 1)
      if (rp.ambiguous) p.ambiguous = true
    }
  }
}

// Infer a position when the roster never gave one: fall back to the dominant
// stat category present across the player's seasons.
function inferFromStats(seasons) {
  const agg = {}
  for (const line of seasons.values())
    for (const [k, v] of Object.entries(line)) agg[k] = (agg[k] ?? 0) + v
  if (agg.passYds) return 'QB'
  if (agg.rushYds && !agg.recYds) return 'RB'
  if (agg.recYds) return agg.rec >= 30 ? 'WR' : 'TE'
  if (agg.sacks || agg.tfl || agg.tackles || agg.defInt) return null // defender, unknowable split
  return null
}

const draft = []
const needsReview = []
for (const [id, p] of players) {
  // Winning roster position (most years), else infer.
  let pos = null
  let top = 0
  for (const [k, n] of p.posVotes)
    if (n > top) {
      top = n
      pos = k
    }
  if (!pos) pos = inferFromStats(p.seasons)
  if (!pos) {
    needsReview.push(`${p.name}: no position (roster miss + unsplittable)`)
    continue
  }

  // Best season by the mirrored composite; skip players with no ratable line.
  let best = null
  let bestC = -Infinity
  for (const [year, line] of p.seasons) {
    const c = composite(pos, line)
    if (c > bestC) {
      bestC = c
      best = { year, line }
    }
  }
  if (!best || bestC <= 0) continue

  const years = [...p.seasons.keys()].sort((a, b) => a - b)
  draft.push({
    id: `${slugify(p.name)}-${id}`,
    name: p.name,
    position: pos,
    firstYear: years[0],
    lastYear: years[years.length - 1],
    // Per-season rows, matching the FbSeason schema (src/types.ts) that the
    // dataset guard now requires — the same shape fetch-football-mgoblue.mjs
    // emits, so curation is interchangeable between the two pipelines.
    seasons: years.map((y) => ({
      year: y,
      stats: p.seasons.get(y),
      honors: [],
      source: `https://collegefootballdata.com/ (stats/player/season team=${TEAM} year=${y})`,
    })),
    _composite: Math.round(bestC * 10) / 10,
    _bestSeason: best.year,
    _ambiguousPosition: p.ambiguous || undefined,
  })
  if (p.ambiguous)
    needsReview.push(`${p.name} (${pos}): ambiguous roster position — confirm`)
}

draft.sort(
  (a, b) => a._bestSeason - b._bestSeason || b._composite - a._composite,
)

// ── coverage report against the fixed 4-year windows ─────────────────────────
const WINDOWS = []
for (let s = START; s + 3 <= END; s += 4) WINDOWS.push([s, s + 3])
const inWin = (p, [s, e]) => p.firstYear <= e && p.lastYear >= s
console.log(`\n${TEAM} ${START}–${END}: ${draft.length} draftable players\n`)
console.log('window      QB RB WR TE | off | DE DT LB CB S | def')
for (const w of WINDOWS) {
  const ps = draft.filter((p) => inWin(p, w))
  const c = (pos) => ps.filter((p) => p.position === pos).length
  const off = ps.filter((p) => OFF.has(p.position)).length
  const def = ps.filter((p) => DEF.has(p.position)).length
  const cells = [c('QB'), c('RB'), c('WR'), c('TE')]
    .map((n) => String(n).padStart(2))
    .join(' ')
  const dcells = [c('DE'), c('DT'), c('LB'), c('CB'), c('S')]
    .map((n) => String(n).padStart(2))
    .join(' ')
  const flag =
    off >= 6 && def >= 6 && c('QB') && c('RB') && c('WR') && c('TE')
      ? ''
      : '  ⚠ thin'
  console.log(
    `${w[0]}-${w[1]}  ${cells} | ${String(off).padStart(3)} | ${dcells} | ${String(def).padStart(3)}${flag}`,
  )
}
if (needsReview.length) {
  console.log(`\n${needsReview.length} rows need human review:`)
  for (const r of needsReview.slice(0, 40)) console.log(`  - ${r}`)
}

if (OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        school: TEAM,
        sport: 'football',
        start: START,
        end: END,
        players: draft,
      },
      null,
      2,
    ),
  )
  console.log(`\nWrote ${draft.length} players → ${OUT}`)
}
