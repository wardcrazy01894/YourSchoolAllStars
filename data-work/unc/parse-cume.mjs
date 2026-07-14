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
  const byFullName = new Map()
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
    byFullName.set(p.name.toLowerCase().replace(/[.']/g, ''), p)
  }
  return { byJersey, byAbbrev, byFullName, source: d.source }
}

/** "Williams, A." → key "williams:a"; "Thornton, D." → "thornton:d". */
const abbrevKey = (s) => {
  const m = s.match(/^\s*([A-Za-z'\-. ]+?),\s*([A-Za-z])/)
  if (!m) return null
  return `${m[1].trim().toLowerCase().replace(/\s+/g, ' ')}:${m[2].toLowerCase()}`
}
/** "Brandon Spoon" → key "spoon:b" (same key space as the abbreviated form). */
const fullNameKey = (s) => {
  const parts = s.trim().split(/\s+/)
  if (parts.length < 2) return null
  return `${parts.at(-1).toLowerCase()}:${parts[0][0].toLowerCase()}`
}

/**
 * One table row → { jersey, name, key, cells }.
 *
 * The name format changes with the page vintage — "Williams, A." (2001–03,
 * 2005–09) vs the full "Brandon Russell" (2000, 2004) — and defensive rows are
 * jersey-first in both. Handle both, and key them into the SAME space so the
 * roster join doesn't care which vintage it's looking at.
 */
function parseRow(line, { jerseyFirst = false } = {}) {
  let rest = line
  let jersey = null
  if (jerseyFirst) {
    // TAS appends a letter when two players share a number ("1A Green, L").
    const jm = rest.match(/^\s*(\d{1,2})([A-Za-z])?\s+(.*)$/)
    if (!jm) return null
    jersey = jm[1] // the letter is a TAS disambiguator, not part of the number
    rest = jm[3]
  }
  // "Last, F." / "Last, F". The stat run may START with a "." placeholder —
  // TAS prints "." for a zero (e.g. a defender with 0 solo tackles) — so the
  // cells group must accept it, or those rows vanish and the checksum breaks.
  let m = rest.match(
    /^\s*([A-Za-z'.\- ]+?,\s*[A-Za-z][A-Za-z'.]*)\s+([\d.\-].*)$/,
  )
  if (m) {
    const name = m[1].trim()
    return { jersey, name, key: abbrevKey(name), cells: m[2].trim().split(/\s+/) }
  }
  // "First Last" / "First M. Last"
  m = rest.match(
    /^\s*([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+)+)\s{2,}([\d.\-].*)$/,
  )
  if (m) {
    const name = m[1].trim()
    return {
      jersey,
      name,
      key: fullNameKey(name),
      cells: m[2].trim().split(/\s+/),
    }
  }
  return null
}

const isPseudo = (n) => /^(Total|Opponents|Team|TM)\b/i.test(n.trim())

function preBlocks(html) {
  // Line endings differ by page vintage and BOTH forms break naive parsing:
  //   • CRLF (2000–2002): JS's `.` never crosses a \r, so a row regex ending
  //     in `(.*)$` silently matches NOTHING.
  //   • CR-only, classic Mac (2003–2004): splitting on '\n' yields ONE line,
  //     so no table is found at all.
  // Normalize both to '\n' before anything else looks at the text.
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) =>
    unescape(m[1].replace(/<[^>]+>/g, '')).replace(/\r\n?/g, '\n'),
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

  // Column checksum against the printed Total row. `get` reads the same column
  // from a player row and from the Total row, so a column-index slip shows up
  // as a mismatch instead of silently shipping wrong numbers.
  const check = (label, rows, get, totalRow) => {
    if (!totalRow) return
    const want = get(totalRow)
    const got = rows.reduce((a, r) => a + get(r), 0)
    if (Math.abs(want - got) > 0.101)
      problems.push(
        `${season} ${label}: Σrows ${Math.round(got * 10) / 10} != Total ${want}`,
      )
  }

  // Some captures embed the SAME cume twice (a screen block and a print
  // block). Processing both would double every stat, so each table kind is
  // taken exactly once — the first occurrence wins.
  const seenTable = new Set()

  for (const block of blocks) {
    for (const { header, rows } of tables(block)) {
      const kind = header.split(/\s+/)[0].toUpperCase()
      if (/^(RUSHING|PASSING|RECEIVING|DEFENSIVE)$/.test(kind)) {
        if (seenTable.has(kind)) continue
        seenTable.add(kind)
      }
      const dataRows = rows.filter((r) => !isPseudo(r))
      const totalRow = rows.find((r) => /^\s*Total/i.test(r))
      // A row's NUMERIC columns, whatever its label shape — a player row
      // ("Williams, A. 11 170 …" or "Chad Scott 11 143 …"), a TEAM/TM pseudo
      // row, or the printed Total ("Total.......... 12 479 …"). Used only by
      // the checksums, which must read the same column from every row.
      const nums = (line) =>
        line
          .replace(/^\s*[^0-9-]*(?=\s-?\d)/, '')
          .trim()
          .split(/\s+/)

      // ── offense ───────────────────────────────────────────────────────────
      const joinOffense = (label, r) => {
        const row = parseRow(r)
        if (!row?.key) return null
        // When the cume prints the FULL name (2000, 2004), match it exactly —
        // the lastname+initial key alone is ambiguous on a roster with two
        // "A. Williams" (Andre and Alge), and a wrong join would silently
        // credit one player's stats to another.
        const exact = row.name.includes(',')
          ? null
          : roster?.byFullName.get(row.name.toLowerCase().replace(/[.']/g, ''))
        const hit = exact ? [exact] : (roster?.byAbbrev.get(row.key) ?? [])
        if (hit.length !== 1) {
          problems.push(
            `${season} ${label}: ${row.name} → ${hit.length} roster matches`,
          )
          return null
        }
        const key = exact ? exact.name.toLowerCase() : row.key
        return { row, p: touch(key, hit[0].name, hit[0].position, hit[0].jersey) }
      }

      if (/^RUSHING\b/i.test(header)) {
        // name G/GP Att Gain Loss Net Avg TD Long Avg/G
        for (const r of dataRows) {
          const j = joinOffense('rushing', r)
          if (!j) continue
          bump(j.p, 'rushYds', num(j.row.cells[4]))
          bump(j.p, 'rushTD', num(j.row.cells[6]))
        }
        const summable = rows.filter((r) => !/^\s*(Total|Opponents)/i.test(r))
        check('rush net', summable, (r) => num(nums(r)[4]), totalRow)
        check('rush TD', summable, (r) => num(nums(r)[6]), totalRow)
      } else if (/^PASSING\b/i.test(header)) {
        // name G/GP Effic Att-Cmp-Int Pct Yds TD Lng Avg/G
        for (const r of dataRows) {
          const j = joinOffense('passing', r)
          if (!j) continue
          const c = j.row.cells
          const aci = String(c[2]).split('-') // Att-Cmp-Int
          bump(j.p, 'passYds', num(c[4]))
          bump(j.p, 'passTD', num(c[5]))
          bump(j.p, 'passInt', num(aci[2]))
        }
        const summable = rows.filter((r) => !/^\s*(Total|Opponents)/i.test(r))
        check('pass yds', summable, (r) => num(nums(r)[4]), totalRow)
        check('pass TD', summable, (r) => num(nums(r)[5]), totalRow)
      } else if (/^RECEIVING\b/i.test(header)) {
        // name G/GP No. Yds Avg TD Long Avg/G
        for (const r of dataRows) {
          const j = joinOffense('receiving', r)
          if (!j) continue
          const c = j.row.cells
          bump(j.p, 'rec', num(c[1]))
          bump(j.p, 'recYds', num(c[2]))
          bump(j.p, 'recTD', num(c[4]))
        }
        const summable = rows.filter((r) => !/^\s*(Total|Opponents)/i.test(r))
        check('rec', summable, (r) => num(nums(r)[1]), totalRow)
        check('rec yds', summable, (r) => num(nums(r)[2]), totalRow)
      } else if (/DEFENSIVE LEADERS/i.test(header)) {
        // jersey name [GP] Solo/UT Ast/AT Total TFL Sacks Int BrUp/PD QBH Rcv FF
        // Column NAMES drift across vintages, so read them from the header
        // rather than assuming an order (2004 has no GP column at all).
        const head = header.replace(/\s+/g, ' ').trim().split(' ')
        const idxOf = (...names) => {
          for (const n of names) {
            const i = head.findIndex((h) => h.toLowerCase() === n.toLowerCase())
            if (i >= 0) return i - 2 // header starts with "DEFENSIVE LEADERS"
          }
          return -1
        }
        const iTot = idxOf('Total')
        const iTfl = idxOf('ForLoss', 'TFL-Yds', 'TFL/Yds', 'TFL')
        const iSack = idxOf('No-Yards', 'No-Yds', 'Sacks')
        const iInt = idxOf('Int-Yds')
        const iBrup = idxOf('BrUp', 'BU')
        const iPd = idxOf('PD')
        const iFf = idxOf('FF')
        if (iTot < 0) {
          problems.push(`${season} defense: unreadable header "${header}"`)
          continue
        }
        for (const r of dataRows) {
          const row = parseRow(r, { jerseyFirst: true })
          if (!row) continue
          const hits = roster?.byJersey.get(row.jersey) ?? []
          const surname = row.key?.split(':')[0]
          const hit =
            hits.find(
              (h) => h.name.split(/\s+/).at(-1).toLowerCase() === surname,
            ) ?? (hits.length === 1 ? hits[0] : null)
          if (!hit) {
            problems.push(
              `${season} defense: #${row.jersey} ${row.name} → no roster match`,
            )
            continue
          }
          const c = row.cells
          const p = touch(row.key ?? `#${row.jersey}`, hit.name, hit.position, row.jersey)
          bump(p, 'tackles', num(c[iTot]))
          if (iTfl >= 0) bump(p, 'tfl', pairFirst(c[iTfl]))
          if (iSack >= 0) bump(p, 'sacks', pairFirst(c[iSack]))
          if (iInt >= 0) bump(p, 'defInt', pairFirst(c[iInt]))
          // pbu = pure break-ups when the table splits BrUp/PD; else the single
          // PD column. NEVER sum them (PD = BrUp + INT in the split layout).
          const iPbu = iBrup >= 0 ? iBrup : iPd
          if (iPbu >= 0) bump(p, 'pbu', num(c[iPbu]))
          if (iFf >= 0) bump(p, 'ff', num(c[iFf]))
        }
        // The defense table's own total row is "Totals ..." (not "Total.....").
        // Player rows are JERSEY-first, so their columns must come from
        // parseRow (which strips the jersey) — reading them positionally would
        // count the jersey as a stat and shift every column by one.
        const defTotal = rows.find((r) => /^\s*Totals?\b/i.test(r))
        const defCol = (r) => {
          const row = parseRow(r, { jerseyFirst: true })
          return num((row ? row.cells : nums(r))[iTot])
        }
        // TEAM/TM pseudo-rows are not players (never emitted) but DO count
        // toward the printed total, so the checksum must include them.
        check(
          'tackles',
          rows.filter((r) => !/^\s*(Total|Opponents)/i.test(r)),
          defCol,
          defTotal,
        )
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
