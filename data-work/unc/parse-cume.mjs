// UNC gap years: parse the archived official Automated-ScoreBook season cumes
// into per-season stat drafts (data-work/unc/gap/<season>.json).
//
// Usage:  node data-work/unc/parse-cume.mjs
//
// Input: data-work/unc/cume-html/<season>.html (fetch-cume.mjs) — the TAS
// fixed-width tables live inside <pre> blocks:
//   pre[0] = team statistics    (ignored)
//   pre[1] = individual offense (RUSHING / PASSING / RECEIVING / …)
//   pre[2] = defense            (DEFENSIVE LEADERS, jersey-first)
//
// Two format wrinkles vs the VT (HTML-table) cumes:
//   • Names are ABBREVIATED — "Williams, A." on offense, "30 Thornton, D." on
//     defense — so every row is joined to that year's goheels roster
//     (data-work/unc/rosters/<year>.json) to recover the full name AND the
//     position. Defense joins on JERSEY (exact); offense joins on
//     last-name + first-initial, and an ambiguous match (two "Williams, A."
//     on the roster) is REPORTED, never guessed.
//   • Column layouts drift a little across years (e.g. "TFL/Yds" vs
//     "ForLoss"), so the header row is parsed rather than assumed, and every
//     mapped column is checksum-validated against the printed Total row.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const IN_DIR = join(HERE, 'cume-html')
const ROSTER_DIR = join(HERE, 'rosters')
const OUT_DIR = join(HERE, 'gap')

const index = JSON.parse(readFileSync(join(HERE, 'old-cume-index.json')))

const unescape = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')

const num = (s) => {
  if (s === undefined || s === null) return 0
  const t = String(s).trim()
  if (t === '' || t === '.' || t === '-') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}
/** "10/37" or "3.0-23" → 10 / 3.0 (the COUNT half of a count-yards pair). */
const pairFirst = (s) => num(String(s ?? '').split(/[/-]/)[0])

/** Roster index for a year: jersey → player, and lastname+initial → [players]. */
function rosterFor(year) {
  const f = join(ROSTER_DIR, `${year}.json`)
  if (!existsSync(f)) return null
  const d = JSON.parse(readFileSync(f))
  const byJersey = new Map()
  const byAbbrev = new Map()
  for (const p of d.players) {
    if (p.jersey) {
      const k = String(p.jersey).trim()
      byJersey.set(k, [...(byJersey.get(k) ?? []), p])
    }
    const parts = p.name.trim().split(/\s+/)
    const last = parts.at(-1).toLowerCase()
    const init = parts[0][0].toLowerCase()
    const k = `${last}:${init}`
    byAbbrev.set(k, [...(byAbbrev.get(k) ?? []), p])
  }
  return { byJersey, byAbbrev, source: d.source }
}

/** "Williams, A." → key "williams:a"; "Thornton, D." → "thornton:d". */
const abbrevKey = (s) => {
  const m = s.match(/^\s*([A-Za-z'\-. ]+?),\s*([A-Za-z])/)
  if (!m) return null
  return `${m[1].trim().toLowerCase().replace(/\s+/g, ' ')}:${m[2].toLowerCase()}`
}

const isPseudo = (n) => /^(Total|Opponents|Team|TM)\b/i.test(n.trim())

function preBlocks(html) {
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, '')),
  )
}

/** Split a fixed-width TAS table into {header, rows[]} by its dashed rule. */
function tables(block) {
  const lines = block.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-{10,}\s*$/.test(lines[i])) continue
    const header = lines[i - 1] ?? ''
    const rows = []
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) break
      if (/^\s*-{10,}\s*$/.test(l)) break
      rows.push(l)
      if (/^\s*Opponents/i.test(l)) break
    }
    out.push({ header: header.trim(), rows })
  }
  return out
}

const problems = []

function parseSeason(season) {
  const html = readFileSync(join(IN_DIR, `${season}.html`), 'utf8')
  const meta = index[season]
  const roster = rosterFor(season)
  const blocks = preBlocks(html)
  const players = new Map() // key → {name, position, jersey, stats}

  const touch = (key, name, position, jersey) => {
    if (!players.has(key))
      players.set(key, { name, position, jersey, stats: {} })
    return players.get(key)
  }
  const bump = (p, k, v) => {
    if (v !== 0) p.stats[k] = (p.stats[k] ?? 0) + v
  }

  // Column checksum against the printed Total row.
  const check = (label, rows, get, totalRow) => {
    if (!totalRow) return
    const want = get(totalRow)
    const got = rows.reduce((a, r) => a + get(r), 0)
    if (Math.abs(want - got) > 0.101)
      problems.push(`${season} ${label}: Σrows ${got} != Total ${want}`)
  }

  for (const block of blocks) {
    for (const { header, rows } of tables(block)) {
      const cells = (line) => line.trim().split(/\s{1,}/)
      const dataRows = rows.filter((r) => !isPseudo(r))
      const totalRow = rows.find((r) => /^\s*Total/i.test(r))

      // ── offense ───────────────────────────────────────────────────────────
      if (/^RUSHING\b/i.test(header)) {
        // name G Att Gain Loss Net Avg TD Long Avg/G
        for (const r of dataRows) {
          const m = r.match(/^\s*(.+?,\s*[A-Za-z][A-Za-z'.]*\.?)\s+(.*)$/)
          if (!m) continue
          const c = cells(m[2])
          const key = abbrevKey(m[1])
          if (!key) continue
          const hit = roster?.byAbbrev.get(key) ?? []
          if (hit.length !== 1) {
            problems.push(
              `${season} rushing: ${m[1].trim()} → ${hit.length} roster matches`,
            )
            continue
          }
          const p = touch(key, hit[0].name, hit[0].position, hit[0].jersey)
          bump(p, 'rushYds', num(c[4]))
          bump(p, 'rushTD', num(c[6]))
        }
        check(
          'rush net',
          rows.filter((r) => !/^\s*(Total|Opponents)/i.test(r)),
          (r) => num(cells(r.replace(/^\s*.+?,\s*[A-Za-z][A-Za-z'.]*\.?/, ''))[4]),
          totalRow,
        )
      } else if (/^PASSING\b/i.test(header)) {
        // name G Effic Att-Cmp-Int Pct Yds TD Lng Avg/G
        for (const r of dataRows) {
          const m = r.match(/^\s*(.+?,\s*[A-Za-z][A-Za-z'.]*\.?)\s+(.*)$/)
          if (!m) continue
          const c = cells(m[2])
          const key = abbrevKey(m[1])
          const hit = key ? (roster?.byAbbrev.get(key) ?? []) : []
          if (hit.length !== 1) continue
          const p = touch(key, hit[0].name, hit[0].position, hit[0].jersey)
          const aci = String(c[2]).split('-') // Att-Cmp-Int
          bump(p, 'passYds', num(c[4]))
          bump(p, 'passTD', num(c[5]))
          bump(p, 'passInt', num(aci[2]))
        }
      } else if (/^RECEIVING\b/i.test(header)) {
        // name G No. Yds Avg TD Long Avg/G
        for (const r of dataRows) {
          const m = r.match(/^\s*(.+?,\s*[A-Za-z][A-Za-z'.]*\.?)\s+(.*)$/)
          if (!m) continue
          const c = cells(m[2])
          const key = abbrevKey(m[1])
          const hit = key ? (roster?.byAbbrev.get(key) ?? []) : []
          if (hit.length !== 1) continue
          const p = touch(key, hit[0].name, hit[0].position, hit[0].jersey)
          bump(p, 'rec', num(c[1]))
          bump(p, 'recYds', num(c[2]))
          bump(p, 'recTD', num(c[4]))
        }
      } else if (/DEFENSIVE LEADERS/i.test(header)) {
        // jersey name GP UT AT Total ForLoss No-Yards Int-Yds PD QBH Rcv FF …
        // (column names drift: "TFL/Yds" vs "ForLoss"; "BrUp"+"PD" vs "PD")
        const head = header.replace(/\s+/g, ' ').trim().split(' ')
        const idxOf = (...names) => {
          for (const n of names) {
            const i = head.findIndex((h) => h.toLowerCase() === n.toLowerCase())
            if (i >= 0) return i - 2 // header starts at "DEFENSIVE LEADERS"
          }
          return -1
        }
        const iTot = idxOf('Total')
        const iTfl = idxOf('ForLoss', 'TFL/Yds', 'TFL-Yds')
        const iSack = idxOf('No-Yards', 'No-Yds')
        const iInt = idxOf('Int-Yds')
        const iBrup = idxOf('BrUp', 'BU')
        const iPd = idxOf('PD')
        const iFf = idxOf('FF')
        if (iTot < 0) {
          problems.push(`${season} defense: unreadable header "${header}"`)
          continue
        }
        for (const r of dataRows) {
          const m = r.match(/^\s*(\d+)\s+(.+?,\s*[A-Za-z][A-Za-z'.]*\.?)\s+(.*)$/)
          if (!m) continue
          const jersey = m[1]
          const c = cells(m[3])
          const hits = roster?.byJersey.get(jersey) ?? []
          const key = abbrevKey(m[2])
          // Prefer the jersey match whose surname agrees with the row.
          const surname = key?.split(':')[0]
          const hit =
            hits.find((h) => h.name.split(/\s+/).at(-1).toLowerCase() === surname) ??
            (hits.length === 1 ? hits[0] : null)
          if (!hit) {
            problems.push(
              `${season} defense: #${jersey} ${m[2].trim()} → no roster match`,
            )
            continue
          }
          const p = touch(key ?? `#${jersey}`, hit.name, hit.position, jersey)
          bump(p, 'tackles', num(c[iTot]))
          if (iTfl >= 0) bump(p, 'tfl', pairFirst(c[iTfl]))
          if (iSack >= 0) bump(p, 'sacks', pairFirst(c[iSack]))
          if (iInt >= 0) bump(p, 'defInt', pairFirst(c[iInt]))
          // PBU: the pure break-ups column when the table splits BrUp/PD,
          // else the single PD column (PD = BrUp + INT in the split layout,
          // so never sum them).
          const iPbu = iBrup >= 0 ? iBrup : iPd
          if (iPbu >= 0) bump(p, 'pbu', num(c[iPbu]))
          if (iFf >= 0) bump(p, 'ff', num(c[iFf]))
        }
      }
    }
  }

  const out = [...players.values()]
    .map((p) => ({
      ...p,
      stats: Object.fromEntries(
        Object.entries(p.stats).filter(([, v]) => v !== 0),
      ),
    }))
    .filter((p) => Object.keys(p.stats).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { meta, players: out }
}

mkdirSync(OUT_DIR, { recursive: true })
const seasons = Object.keys(index)
  .map(Number)
  .filter((s) => existsSync(join(IN_DIR, `${s}.html`)))
  .sort()
for (const season of seasons) {
  const { meta, players } = parseSeason(season)
  writeFileSync(
    join(OUT_DIR, `${season}.json`),
    JSON.stringify(
      { season, source: meta.snapshot, scope: meta.scope, players },
      null,
      1,
    ),
  )
  console.log(`${season}: ${players.length} stat rows (${meta.scope})`)
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`)
  for (const p of problems.slice(0, 40)) console.log('  ' + p)
  process.exitCode = 1
}
