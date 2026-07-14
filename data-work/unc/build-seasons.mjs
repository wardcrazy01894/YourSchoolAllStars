// UNC: normalize every source into ONE per-season shape.
//
// Usage:  node data-work/unc/build-seasons.mjs
// Output: data-work/unc/seasons/<year>.json — [{ name, position, stats, source }]
//
// SOURCE MAP (why each year comes from where — see PROGRESS.md):
//   1994–1999  SR (offense + interceptions)
//              + OFFICIAL MEDIA GUIDE (the full defensive box: tackles, TFL,
//                sacks, PBU). No database publishes UNC's per-player defense
//                before 2000 — SR's tackle table starts in 2005, and the NCAA did
//                not centrally compile individual defensive statistics until
//                ~2000, so the numbers only ever existed in the school's own
//                printed media guide. Those guides are digitized (Internet
//                Archive, scanned by UNC Libraries) and each year's guide prints
//                the PREVIOUS season's final defensive statistics. See
//                fetch-guides.mjs → parse-guides.mjs → resolve-guide-names.mjs,
//                and validate-guides.mjs, which proves the whole chain by running
//                it over 2000 — a season we independently hold from the official
//                cume — and matching all 54 stat values.
//              Interceptions still come from SR: it is complete for these years,
//              whereas the guides' INT column has OCR holes.
//   2000–2004  official archived cumes — the ONLY source of per-player defense
//                   before SR's tackle table starts (2005)
//   2005–2015  SR   (full defense from 2005, and more complete than the cumes,
//                   whose rows depend on a roster join that some years' rosters
//                   can't satisfy; 2010/2011 cumes are mid-season captures — the
//                   Pitt trap — and 2012–2015 have none)
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

// The official cumes are needed ONLY for 2000-2004: SR has full defense from
// 2005 on, and SR is the more COMPLETE source there. The cume rows can only be
// identified by joining them to that year's goheels roster, and some of those
// rosters are incomplete — the 2005 roster is missing QB Matt Baker, so the
// cume-sourced 2005 lost its starting quarterback (and with him every passing
// TD that season). Prefer SR wherever it carries the same stats.
const SR_YEARS = new Set([
  1994, 1995, 1996, 1997, 1998, 1999, 2005, 2006, 2007, 2008, 2009, 2010, 2011,
  2012, 2013, 2014, 2015,
])
const CUME_YEARS = new Set([2000, 2001, 2002, 2003, 2004])

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
  // The two sources punctuate names differently — Sidearm's "Melkart Abou
  // Jaoude" is SR's "Melkart Abou-Jaoude". Matching on the normal key alone
  // finds no SR row, "no corroboration" then deletes the player's REAL line
  // (his 47 tackles and 10.5 sacks), and a second-team All-ACC lineman
  // disappears from the game entirely. Compare on a loose key that ignores all
  // punctuation and spacing.
  const loose = (s) => norm(s).replace(/[^a-z0-9]/g, '')
  const srDef = new Map() // `${looseKey}:${year}` → Set(stat keys SR credits)
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
      srDef.set(`${loose(r.name)}:${y}`, has)
    }
  }
  let stripped = 0
  for (const p of all) {
    for (const s of p.seasons) {
      const has = srDef.get(`${loose(p.name)}:${s.year}`) ?? new Set()
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

// ── media-guide defense (1994–1999) ──────────────────────────────────────────
// The full defensive box score for the seasons no database covers. This REPLACES
// the old record-book supplement, which could only scrape a handful of leaderboard
// lines (a sack total here, a TFL total there) for the six stars who appear in the
// all-time top tens — everyone else had no defense at all. The guides carry the
// whole team, every player, with tackles / TFL / sacks / PBU.
//
// The supplement's numbers were not wrong, and that is worth stating: every one of
// its ten hand-transcribed lines is reproduced exactly by the guides (Greg Ellis's
// 12.5 sacks in 1996, Ebenezer Ekuban's 23 TFL in 1998, Brandon Spoon's 138
// tackles). It was simply far too thin, so it is retired.
//
// Interceptions are NOT taken from here — SR is complete for these years and the
// guides' INT column has OCR holes (the 1997 table lost the whole column for one
// block of players, which would have cost Dre' Bly his interceptions). Everything
// else comes from the guide.
{
  const GUIDE_YEARS = [1994, 1995, 1996, 1997, 1998, 1999]
  const DEF_KEYS = ['tackles', 'tfl', 'sacks', 'pbu']
  let merged = 0
  let added = 0
  for (const year of GUIDE_YEARS) {
    const gf = join(HERE, 'guide-resolved', `${year}.json`)
    const sf = join(OUT_DIR, `${year}.json`)
    if (!existsSync(gf) || !existsSync(sf)) {
      report.push(`${year}: NO GUIDE DEFENSE`)
      continue
    }
    const g = JSON.parse(readFileSync(gf))
    const d = JSON.parse(readFileSync(sf))
    for (const p of g.players) {
      const stats = {}
      for (const k of DEF_KEYS)
        if (typeof p.stats[k] === 'number' && p.stats[k] !== 0)
          stats[k] = p.stats[k]
      // A guide row with no interception and no defensive production at all is a
      // player who dressed and did nothing measurable — nothing to record.
      const existing = d.players.find((x) => norm(x.name) === norm(p.name))
      if (existing) {
        // SR's interception (already on the row) wins; the guide supplies the rest.
        existing.stats = { ...existing.stats, ...stats }
        // A defender's position from the DEFENSIVE table beats an offense-table
        // guess — this is the Pitt lesson, and it is why Chazz Surratt's kind of
        // mislabelling does not happen here. It also beats a COARSE one: SR only
        // says "DL", while the guide's table says end or tackle, and leaving SR's
        // vaguer label in place sent players to the research worklist who were
        // already unambiguously identified by the source we just read.
        const coarse = (x) => !x || /^(DL|DB|LB|OL)$/i.test(x)
        if (p.position && coarse(existing.position))
          existing.position = p.position
        existing.source = `${existing.source} + ${p.source}`
        merged++
      } else {
        if (!Object.keys(stats).length && !p.stats.defInt) continue
        if (typeof p.stats.defInt === 'number' && p.stats.defInt !== 0)
          stats.defInt = p.stats.defInt
        d.players.push({
          name: p.name,
          position: p.position,
          stats,
          source: p.source,
        })
        added++
      }
    }
    writeFileSync(sf, JSON.stringify(d, null, 1))
  }
  report.push(
    `media guides: ${merged} defenders merged onto existing rows, ${added} new defenders added (1994-99)`,
  )
}

for (const r of report) console.log(r)
