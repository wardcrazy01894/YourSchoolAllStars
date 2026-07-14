// VT football gap years (1994–2012): download the Wayback-archived
// hokiesports.com per-year season-cume pages. See data-work/vt/PROGRESS.md.
//
// Usage:  node data-work/vt/fetch-gap.mjs [--start 1994] [--end 2012] [--force]
//
// The 2012-era hokiesports.com rendered EVERY historical year in one template
// at /football/stats/<year>/?season (full offense AND defense tables). Per
// year this script asks the CDX API for the newest 200 capture, downloads it,
// and stores the raw HTML at data-work/vt/gap-html/<year>.html plus the exact
// snapshot URL in <year>.meta.json (the parse step cites that URL as each
// row's `source`). Idempotent: existing files are skipped without --force.
//
// Capture-date rule (Pitt lesson): the page must be a FINAL cume. Any capture
// dated AFTER the following March is safely post-season for that year; the
// newest capture (2012+ for old years) always is. The parser still validates
// against the printed Total row.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'gap-html')

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 1994)
const END = flag('end', 2012)
const FORCE = args.includes('--force')

async function getText(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (attempt === 4) throw e
      await new Promise((r) => setTimeout(r, 2500 * attempt))
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true })

for (let year = START; year <= END; year++) {
  const htmlPath = join(OUT_DIR, `${year}.html`)
  const metaPath = join(OUT_DIR, `${year}.meta.json`)
  if (existsSync(htmlPath) && !FORCE) {
    console.log(`${year}: exists, skipping`)
    continue
  }
  const cdx = await getText(
    `http://web.archive.org/cdx/search/cdx?url=hokiesports.com%2Ffootball%2Fstats%2F${year}%2F%3Fseason&output=json&filter=statuscode:200`,
  )
  const rows = JSON.parse(cdx)
  const caps = rows.slice(1) // [urlkey, timestamp, original, mimetype, statuscode, digest, length]
  if (caps.length === 0) {
    console.log(`${year}: NO CAPTURES`)
    continue
  }
  // Newest capture = final cume (site rendered historical years long after).
  const cap = caps[caps.length - 1]
  const [, ts, original] = cap
  const snapshot = `http://web.archive.org/web/${ts}/${original}`
  const html = await getText(snapshot)
  writeFileSync(htmlPath, html)
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        year,
        snapshot,
        timestamp: ts,
        original,
        captures: caps.length,
        bytes: html.length,
      },
      null,
      1,
    ),
  )
  console.log(`${year}: saved ${html.length}b from ${ts}`)
  await new Promise((r) => setTimeout(r, 1200))
}
