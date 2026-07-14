// VT football: parse the archived SR season pages (sr-html/) into
// sr/<year>.json for the stage-3 sweep. Generic per-table extraction keyed by
// SR's data-stat attributes; crossval.mjs does the mapping/compare.
//
// Usage:  node data-work/vt/parse-sr.mjs [--start 1994] [--end 2025]
//
// Per row we keep: table id, player name, pos, and every numeric data-stat
// cell. Position semantics (Pitt lesson): the DEFENSE table's pos is
// authoritative for defenders; offense-table pos must never vote on a player
// who has defensive production. crossval.mjs enforces that — this parser
// just records which table each pos came from.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const IN_DIR = join(HERE, 'sr-html')
const OUT_DIR = join(HERE, 'sr')

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 1994)
const END = flag('end', 2025)

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .trim()

function parseYear(year) {
  const html = readFileSync(join(IN_DIR, `${year}.html`), 'utf8')
  const meta = JSON.parse(
    readFileSync(join(IN_DIR, `${year}.meta.json`), 'utf8'),
  )
  const out = []
  // Every stats table with an id; SR sometimes ships tables inside HTML
  // comments (lazy-render) — strip comment markers first so those parse too.
  const uncommented = html.replaceAll('<!--', '').replaceAll('-->', '')
  const tre =
    /<table[^>]*id="([a-z_]+)"[^>]*>([\s\S]*?)<\/table>/g
  for (const tm of uncommented.matchAll(tre)) {
    const [, tableId, tbl] = tm
    if (!/passing|rushing|receiving|defense|scoring|returns?/.test(tableId))
      continue
    const bodyM = tbl.match(/<tbody>([\s\S]*?)<\/tbody>/)
    if (!bodyM) continue
    for (const tr of bodyM[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = {}
      for (const c of tr[1].matchAll(
        /<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g,
      )) {
        cells[c[1]] = strip(c[2])
      }
      const name = cells.name_display ?? cells.player
      if (!name || /League|Overall|Team Total/i.test(name)) continue
      const row = { table: tableId, name, pos: cells.pos || null, stats: {} }
      for (const [k, v] of Object.entries(cells)) {
        if (['ranker', 'name_display', 'player', 'pos', 'awards'].includes(k))
          continue
        const n = Number(v)
        if (v !== '' && Number.isFinite(n)) row.stats[k] = n
      }
      out.push(row)
    }
  }
  return { meta, rows: out }
}

mkdirSync(OUT_DIR, { recursive: true })
for (let year = START; year <= END; year++) {
  if (!existsSync(join(IN_DIR, `${year}.html`))) {
    console.log(`${year}: no sr-html download`)
    continue
  }
  const { meta, rows } = parseYear(year)
  const tables = [...new Set(rows.map((r) => r.table))]
  writeFileSync(
    join(OUT_DIR, `${year}.json`),
    JSON.stringify({ season: year, source: meta.snapshot, rows }, null, 1),
  )
  console.log(`${year}: ${rows.length} rows from [${tables.join(', ')}]`)
}
