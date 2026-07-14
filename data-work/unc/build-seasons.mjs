// UNC: normalize every source into ONE per-season shape.
//
// Usage:  node data-work/unc/build-seasons.mjs
// Output: data-work/unc/seasons/<year>.json — [{ name, position, stats, source }]
//
// SOURCE MAP (why each year comes from where — see PROGRESS.md):
//   1997–1999  SR   offense complete; defense is INT-ONLY (SR has no tackle
//                   table before 2005) — the documented Michigan-style floor.
//   2000–2007  official archived cumes (full offense AND defense)
//   2008       SR   (the 2008 capture is an HTML-table redesign; SR has full
//                   defense from 2005, so it's the cleaner source for that year)
//   2009       official archived cume
//   2010–2015  SR   (2010/2011 cumes exist only as MID-SEASON captures — the
//                   Pitt trap — and 2012–2015 have none; SR is complete here)
//   2016–2025  Sidearm (goheels), via scripts/fetch-football-mgoblue.mjs
//
// Positions come from the goheels roster for the year (spelled-out, e.g.
// "Defensive End") wherever the row can be joined to it; SR's coarse code is
// the fallback. Nothing is guessed — an unresolved position stays null and is
// settled later by cited research (resolve-positions).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'seasons')

const SR_YEARS = new Set([
  1997, 1998, 1999, 2008, 2010, 2011, 2012, 2013, 2014, 2015,
])
const CUME_YEARS = new Set([
  2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2009,
])

// SR data-stat → FbStats
const SR_MAP = {
  pass_yds: 'passYds',
  pass_td: 'passTD',
  pass_int: 'passInt',
  rush_yds: 'rushYds',
  rush_td: 'rushTD',
  rec: 'rec',
  rec_yds: 'recYds',
  rec_td: 'recTD',
  tackles_loss: 'tfl',
  sacks: 'sacks',
  def_int: 'defInt',
  fumbles_forced: 'ff',
  pass_defended: 'pbu',
}

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

function rosterFor(year) {
  const f = join(HERE, 'rosters', `${year}.json`)
  if (!existsSync(f)) return new Map()
  const d = JSON.parse(readFileSync(f))
  return new Map(d.players.map((p) => [norm(p.name), p]))
}

mkdirSync(OUT_DIR, { recursive: true })
const report = []

// ── SR years ─────────────────────────────────────────────────────────────────
for (const year of [...SR_YEARS].sort()) {
  const f = join(HERE, 'sr', `${year}.json`)
  if (!existsSync(f)) {
    report.push(`${year}: NO SR FILE`)
    continue
  }
  const d = JSON.parse(readFileSync(f))
  const roster = rosterFor(year)
  const byName = new Map()
  for (const r of d.rows) {
    // Table ids differ by SR vintage: modern (`*_standard`, `defense_standard`)
    // vs pre-redesign (`passing`, `rushing_and_receiving`, `defense_and_fumbles`).
    if (!/^(passing|rushing|defense)/.test(r.table)) continue
    const key = norm(r.name)
    if (!byName.has(key))
      byName.set(key, { name: r.name, srPos: r.pos, stats: {} })
    const e = byName.get(key)
    if (r.pos && !e.srPos) e.srPos = r.pos
    for (const [sk, ok] of Object.entries(SR_MAP)) {
      const v = r.stats[sk]
      if (typeof v === 'number' && v !== 0) e.stats[ok] = v
    }
    if (r.table.startsWith('defense')) {
      const solo = r.stats.tackles_solo ?? 0
      const ast = r.stats.tackles_assists ?? 0
      if (solo + ast > 0) e.stats.tackles = solo + ast
    }
  }
  const players = []
  for (const [key, e] of byName) {
    if (Object.keys(e.stats).length === 0) continue
    const ros = roster.get(key)
    players.push({
      name: ros?.name ?? e.name,
      position: ros?.position ?? e.srPos ?? null,
      stats: e.stats,
      source: d.source,
    })
  }
  writeFileSync(
    join(OUT_DIR, `${year}.json`),
    JSON.stringify({ year, from: 'sports-reference', players }, null, 1),
  )
  report.push(`${year}: ${players.length} rows (SR)`)
}

// ── official cume years ──────────────────────────────────────────────────────
for (const year of [...CUME_YEARS].sort()) {
  const f = join(HERE, 'gap', `${year}.json`)
  if (!existsSync(f)) {
    report.push(`${year}: NO CUME FILE`)
    continue
  }
  const d = JSON.parse(readFileSync(f))
  const players = d.players.map((p) => ({
    name: p.name,
    position: p.position ?? null,
    stats: p.stats,
    source: d.source,
  }))
  writeFileSync(
    join(OUT_DIR, `${year}.json`),
    JSON.stringify({ year, from: 'official-cume', players }, null, 1),
  )
  report.push(`${year}: ${players.length} rows (official cume)`)
}

// ── Sidearm years ────────────────────────────────────────────────────────────
{
  const d = JSON.parse(readFileSync(join(HERE, 'sidearm-2016-2025.json')))
  const all = d.players ?? d

  // The Sidearm payload MISLINKS defensive lines onto offensive players (the
  // Florida bio-mislink class): it credits Dyami Brown — a wide receiver —
  // with 2 sacks and 4 TFL in 2020, and Antoine Green with 2.5 sacks. Left in,
  // these fake lines also trip the convert-guard and push real receivers into
  // the research worklist. SR has FULL defense for every Sidearm year, so a
  // defensive key survives only if SR corroborates it for that player-season.
  const DEF_KEYS = ['tackles', 'tfl', 'sacks', 'defInt', 'pbu', 'ff']
  const srDef = new Map() // `${key}:${year}` → Set(stat keys SR credits)
  for (let y = 2016; y <= 2025; y++) {
    const f = join(HERE, 'sr', `${y}.json`)
    if (!existsSync(f)) continue
    const srd = JSON.parse(readFileSync(f))
    for (const r of srd.rows) {
      if (!r.table.startsWith('defense')) continue
      const has = new Set()
      const solo = (r.stats.tackles_solo ?? 0) + (r.stats.tackles_assists ?? 0)
      if (solo > 0) has.add('tackles')
      if (r.stats.tackles_loss) has.add('tfl')
      if (r.stats.sacks) has.add('sacks')
      if (r.stats.def_int) has.add('defInt')
      if (r.stats.pass_defended) has.add('pbu')
      if (r.stats.fumbles_forced) has.add('ff')
      srDef.set(`${norm(r.name)}:${y}`, has)
    }
  }
  let stripped = 0
  for (const p of all) {
    for (const s of p.seasons) {
      const has = srDef.get(`${norm(p.name)}:${s.year}`) ?? new Set()
      for (const k of DEF_KEYS) {
        if (s.stats[k] !== undefined && !has.has(k)) {
          delete s.stats[k]
          stripped++
        }
      }
    }
  }
  report.push(`sidearm: stripped ${stripped} SR-uncorroborated defensive keys`)
  const byYear = new Map()
  const rosterCache = new Map()
  for (const p of all) {
    for (const s of p.seasons) {
      if (!byYear.has(s.year)) byYear.set(s.year, [])
      if (!rosterCache.has(s.year)) rosterCache.set(s.year, rosterFor(s.year))
      // The Sidearm payload's own roster join misses some players (Javonte
      // Williams comes back with no position at all), so fall back to the
      // goheels roster for that year — the same oracle the older seasons use.
      const ros = rosterCache.get(s.year).get(norm(p.name))
      byYear.get(s.year).push({
        name: p.name,
        position: p.position ?? ros?.position ?? null,
        stats: s.stats,
        source: s.source,
      })
    }
  }
  for (const [year, players] of [...byYear].sort((a, b) => a[0] - b[0])) {
    writeFileSync(
      join(OUT_DIR, `${year}.json`),
      JSON.stringify({ year, from: 'sidearm', players }, null, 1),
    )
    report.push(`${year}: ${players.length} rows (Sidearm)`)
  }
}

for (const r of report) console.log(r)
