#!/usr/bin/env node
// Football data pipeline #2 — pulls a school's OFFICIAL per-player cumulative
// season statistics from a Sidearm Sports athletics site (mgoblue.com for
// Michigan) and emits a DRAFT per-season `FbPlayer[]` dataset plus a coverage
// report, ready for curation.
//
// Why this exists alongside fetch-football.mjs (CFBD): the official site
// carries the FULL defensive box score (tackles/TFL/sacks/PBU/INT/FF) back to
// 1997 for Michigan — CFBD only has it from 2016 — and it is the top-priority
// source in docs/DATA-SOURCING.md (school site > SR). No API key needed: the
// stats pages are server-rendered Nuxt pages with a devalue-encoded payload.
//
//   node scripts/fetch-football-mgoblue.mjs \
//     --site https://mgoblue.com --start 1997 --end 2024 \
//     --out /tmp/michigan-football.mgoblue.json
//
// Output is a DRAFT, not the final dataset: real per-season sourced rows, but
// positions still need the curation pass (roster `positionShort` is missing or
// coarse for some years/players — flagged in the report), honors are [] by
// policy (separate award pass), and the pool isn't trimmed. The schema mirrors
// `FbPlayer`/`FbSeason` (src/types.ts); the composite mirrors fbStatComposite
// (src/lib/football-rating.ts) — keep the TERMS table below in sync.

// ── args ─────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const SITE = arg('site', 'https://mgoblue.com').replace(/\/$/, '')
const SCHOOL = arg('school', 'Michigan')
const START = Number(arg('start', '1997'))
const END = Number(arg('end', '2024'))
const OUT = arg('out', '')

// ── devalue payload access ───────────────────────────────────────────────────
// Sidearm's Nuxt pages embed state as a flat array where object values are
// INDICES into the same array (devalue). A negative index (-1) means "absent".
function deref(data, x) {
  return typeof x === 'number' && x >= 0 && x < data.length ? data[x] : null
}

/** Resolve one payload dict shallowly: every value dereferenced once. */
function row(data, dict) {
  const out = {}
  for (const [k, v] of Object.entries(dict)) out[k] = deref(data, v)
  return out
}

async function nuxtData(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (data pipeline; YourSchoolAllStars)',
    },
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)<\/script>/s)
  if (!m) throw new Error(`${url} → no __NUXT_DATA__ payload`)
  return JSON.parse(m[1])
}

// ── stat extraction ──────────────────────────────────────────────────────────
const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}
/** Keep a stat only when present and non-zero (a 0 adds noise, not signal). */
const put = (
  stats,
  key,
  v,
  { allowNegative = false, keepZero = false } = {},
) => {
  const n = num(v)
  if (n === undefined) return
  if (n < 0 && !allowNegative) return
  if (n === 0 && !keepZero) return
  stats[key] = n
}

/**
 * One year's per-player category rows → { bioId → partial FbStats + name }.
 * Categories live at individualStats.individual{Passing,Rushing,…}Stats; the
 * key union is shared across categories with -1 for N/A, so each category
 * contributes only its own fields. Footer rows (Total/Opponents) are skipped.
 */
function extractYear(data) {
  // The container is the (unique) dict holding the individualStats key.
  const holder = data.find(
    (v) =>
      v && typeof v === 'object' && !Array.isArray(v) && 'individualStats' in v,
  )
  if (!holder) throw new Error('no individualStats container in payload')
  const cats = deref(data, holder.individualStats)
  const players = new Map()
  const get = (r) => {
    // Some rows carry bioId 0 (usually with a truncated "Last, F" name) —
    // key those by name so they don't all collapse onto one bogus player;
    // the main loop expands the name against that year's roster.
    let bioId = String(r.playerRosterBioId ?? '')
    if (bioId === '0') bioId = ''
    const key = bioId || `name:${r.nameFromStats ?? r.playerName}`
    if (!r.playerName) return null
    if (!players.has(key)) players.set(key, { name: r.playerName, stats: {} })
    return players.get(key)
  }
  const rowsOf = (key) =>
    (deref(data, cats[key]) ?? [])
      .map((ri) => row(data, deref(data, ri)))
      .filter(
        (r) =>
          !r.isAFooterStat &&
          r.playerName !== 'Total' &&
          r.playerName !== 'Opponents' &&
          r.playerName !== 'Team', // the "Team" pseudo-row (team fumbles etc.)
      )

  for (const r of rowsOf('individualPassingStats')) {
    const p = get(r)
    if (!p) continue
    put(p.stats, 'passYds', r.yards)
    put(p.stats, 'passTD', r.touchdowns)
    put(p.stats, 'passInt', r.interceptions, { keepZero: true })
  }
  for (const r of rowsOf('individualRushingStats')) {
    const p = get(r)
    if (!p) continue
    // NET rushing (the NCAA counts sack yardage against rushing) — negative is
    // real for pocket QBs and kept; curation drops negatives on non-QBs.
    put(p.stats, 'rushYds', r.net, { allowNegative: true, keepZero: true })
    put(p.stats, 'rushTD', r.touchdowns, { keepZero: true })
  }
  for (const r of rowsOf('individualReceivingStats')) {
    const p = get(r)
    if (!p) continue
    put(p.stats, 'rec', r.number)
    put(p.stats, 'recYds', r.yards)
    put(p.stats, 'recTD', r.touchdowns)
  }
  for (const r of rowsOf('individualDefensiveStats')) {
    const p = get(r)
    if (!p) continue
    put(p.stats, 'tackles', r.totalTackles)
    put(p.stats, 'tfl', r.totalTacklesForLoss)
    put(p.stats, 'sacks', r.totalSacks)
    put(p.stats, 'defInt', r.passesIntercepted)
    put(p.stats, 'pbu', r.passBreakups)
    put(p.stats, 'ff', r.fumblesForces)
  }
  return players
}

/**
 * One year's roster page → { seasonBioId → { personId, pos } }.
 *
 * Sidearm keys the SAME human three ways: a stable `playerId` (the person),
 * a per-season `rosterPlayerId`, and a `latestRosterPlayerId`. The stats
 * payload's `playerRosterBioId` matches one of the latter two (it varies by
 * year), so we index BOTH aliases; the stable `playerId` is what players are
 * merged on across years.
 */
function extractRoster(data) {
  const out = new Map()
  const people = []
  for (const v of data) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    if (!('positionShort' in v) || !('lastName' in v)) continue
    const r = row(data, v)
    const personId = String(r.playerId ?? '')
    const pos = typeof r.positionShort === 'string' ? r.positionShort : null
    if (!personId || personId === '0') continue
    if (!people.some((p) => p.personId === personId))
      people.push({
        personId,
        pos,
        first: String(r.firstName ?? ''),
        last: String(r.lastName ?? ''),
      })
    for (const alias of [r.rosterPlayerId, r.latestRosterPlayerId]) {
      const key = String(alias ?? '')
      if (key && key !== '0' && !out.has(key)) out.set(key, { personId, pos })
    }
  }
  return { aliases: out, people }
}

/**
 * Expand a truncated stats name ("Stribling, C" / "STRIBLING,C") to the unique
 * roster person with that last name + first initial. Null when not unique.
 */
function expandName(name, people) {
  const m = /^([^,]+),\s*([A-Za-z])\.?$/.exec(name ?? '')
  if (!m) return null
  const last = m[1].trim().toLowerCase()
  const initial = m[2].toLowerCase()
  const hits = people.filter(
    (p) =>
      p.last.toLowerCase() === last &&
      p.first.toLowerCase().startsWith(initial),
  )
  return hits.length === 1 ? hits[0] : null
}

// ── roster position → our FbPosition ─────────────────────────────────────────
const KNOWN = new Set(['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S'])
const ALIAS = {
  FB: 'RB',
  HB: 'RB',
  TB: 'RB',
  SB: 'RB',
  FL: 'WR',
  SE: 'WR',
  EDGE: 'DE',
  RUSH: 'DE',
  NT: 'DT',
  NG: 'DT',
  OLB: 'LB',
  ILB: 'LB',
  MLB: 'LB',
  RLB: 'LB',
  WLB: 'LB',
  SLB: 'LB',
  FS: 'S',
  SS: 'S',
  SAF: 'S',
}
// Coarse codes that need a human/curation decision, not a default.
const AMBIGUOUS = new Set(['DB', 'DL', 'ATH', 'LB/DB', 'DE/DT', 'WR/DB'])
function mapPosition(raw) {
  if (!raw) return { pos: null, ambiguous: false }
  const p = raw.toUpperCase().trim()
  if (KNOWN.has(p)) return { pos: p, ambiguous: false }
  if (p in ALIAS) return { pos: ALIAS[p], ambiguous: false }
  if (AMBIGUOUS.has(p)) return { pos: null, ambiguous: true }
  return { pos: null, ambiguous: false } // OL/K/P/LS — not draftable positions
}

/** Position fallback from a player's aggregate stat shape (offense only). */
function inferFromStats(seasons) {
  const agg = {}
  for (const s of seasons.values())
    for (const [k, v] of Object.entries(s)) agg[k] = (agg[k] ?? 0) + v
  if (agg.passYds && agg.passYds > 100) return 'QB'
  if (agg.rushYds && agg.rushYds > (agg.recYds ?? 0) && !agg.tackles)
    return 'RB'
  if (agg.recYds && !agg.tackles) return (agg.rec ?? 0) >= 30 ? 'WR' : 'TE'
  return null // defender or unknown — roster/curation must decide
}

// ── best-season composite — MIRROR of src/lib/football-rating.ts ─────────────
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

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** "Last, First" → "First Last" (Sidearm lists names comma-inverted). */
function properName(name) {
  const m = /^([^,]+),\s*(.+)$/.exec(name ?? '')
  return m ? `${m[2]} ${m[1]}` : (name ?? '')
}

// ── main ─────────────────────────────────────────────────────────────────────
// Keyed by the STABLE person id from the roster (fallback: name slug when the
// stats row matches no roster alias) — season bio ids change year to year.
const byPerson = new Map() // personKey → { name, posVotes:Map, ambiguous, seasons:Map<year, stats> }

for (let year = START; year <= END; year++) {
  let stats, roster
  try {
    const [sd, rd] = await Promise.all([
      nuxtData(`${SITE}/sports/football/stats/${year}`),
      nuxtData(`${SITE}/sports/football/roster/${year}`),
    ])
    stats = extractYear(sd)
    roster = extractRoster(rd)
  } catch (e) {
    console.error(`! ${year}: ${e.message}`)
    continue
  }
  let joined = 0
  for (const [bioId, p] of stats) {
    if (Object.keys(p.stats).length === 0) continue
    let name = properName(p.name)
    let rosterHit = bioId.startsWith('name:') ? null : roster.aliases.get(bioId)
    if (!rosterHit) {
      // bio-less / unjoined row: try expanding a truncated "Last, F" name to
      // the unique roster person, else fall back to the name itself.
      const person = expandName(p.name, roster.people)
      if (person) {
        rosterHit = person
        name = `${person.first} ${person.last}`
      }
    }
    if (rosterHit) joined++
    const key = rosterHit ? `p${rosterHit.personId}` : `n${slugify(name)}`
    if (!byPerson.has(key))
      byPerson.set(key, {
        name,
        posVotes: new Map(),
        ambiguous: false,
        seasons: new Map(),
      })
    const agg = byPerson.get(key)
    // Merge (don't overwrite) — a truncated-name row and a bio row for the
    // same person can both exist in one year.
    const line = agg.seasons.get(year) ?? {}
    for (const [k, v] of Object.entries(p.stats)) if (!(k in line)) line[k] = v
    agg.seasons.set(year, line)
    const { pos, ambiguous } = mapPosition(rosterHit?.pos)
    if (pos) agg.posVotes.set(pos, (agg.posVotes.get(pos) ?? 0) + 1)
    if (ambiguous) agg.ambiguous = true
  }
  console.error(
    `${year}: ${stats.size} stat players (${joined} roster-joined), ${roster.aliases.size} roster aliases`,
  )
}

// A person keyed by name-slug fallback may duplicate a roster-keyed person
// (same human, one year's stats row missing its roster alias). Merge any
// slug-keyed person into a roster-keyed person with the same name.
for (const [key, p] of [...byPerson]) {
  if (!key.startsWith('n')) continue
  const twin = [...byPerson.entries()].find(
    ([k2, p2]) => k2.startsWith('p') && slugify(p2.name) === slugify(p.name),
  )
  if (!twin) continue
  for (const [y, s] of p.seasons)
    if (!twin[1].seasons.has(y)) twin[1].seasons.set(y, s)
  byPerson.delete(key)
}

const draft = []
const needsReview = []
for (const [, p] of byPerson) {
  let pos = null
  let top = 0
  for (const [k, n] of p.posVotes)
    if (n > top) {
      top = n
      pos = k
    }
  if (!pos) pos = inferFromStats(p.seasons)
  // Position-less players are KEPT (position: null) — curation resolves them
  // from the hand-verified override map / the existing dataset; dropping them
  // here would make e.g. every modern "DL"-coded tackle unrescuable.
  if (!pos) needsReview.push(`${p.name}: no position (roster miss/ambiguous)`)
  const years = [...p.seasons.keys()].sort((a, b) => a - b)
  let bestC = -Infinity
  if (pos)
    for (const y of years)
      bestC = Math.max(bestC, composite(pos, p.seasons.get(y)))
  draft.push({
    id: slugify(p.name),
    name: p.name,
    position: pos,
    firstYear: years[0],
    lastYear: years[years.length - 1],
    seasons: years.map((y) => ({
      year: y,
      stats: p.seasons.get(y),
      honors: [],
      source: `${SITE}/sports/football/stats/${y}`,
    })),
    _composite: pos ? Math.round(bestC * 10) / 10 : 0,
    _ambiguousPosition: p.ambiguous || undefined,
  })
  if (p.ambiguous && pos && top === 0)
    needsReview.push(`${p.name} (${pos}): ambiguous roster position`)
}

draft.sort((a, b) => a.firstYear - b.firstYear || b._composite - a._composite)

// ── coverage report against the ROLLING 4-year windows ───────────────────────
const OFF = new Set(['QB', 'RB', 'WR', 'TE'])
const WINDOWS = []
for (let s = START; s + 3 <= END; s++) WINDOWS.push([s, s + 3])
const inWin = (p, [s, e]) => p.seasons.some((x) => x.year >= s && x.year <= e)
console.log(`\n${SCHOOL} ${START}–${END}: ${draft.length} draftable players\n`)
console.log('window      QB RB WR TE | off | DE DT LB CB  S | def')
for (const w of WINDOWS) {
  const ps = draft.filter((p) => inWin(p, w))
  const c = (pos) => ps.filter((p) => p.position === pos).length
  const off = ps.filter((p) => OFF.has(p.position)).length
  const def = ps.length - off
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
  console.log(`\n${needsReview.length} rows need review:`)
  for (const r of needsReview) console.log(`  - ${r}`)
}

if (OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        school: SCHOOL,
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
