// VT football honors: download the Wikipedia wikitext sources for the
// programmatic honors derivation (stage 4). Mirrors the Florida approach —
// derive award-first from wikitext, never from a research ledger.
//
// Usage:  node data-work/vt/fetch-honors-wiki.mjs [--force]
//
// Pages:
//   - List of Virginia Tech Hokies football All-Americans (bgcolor legend for
//     consensus/unanimous, same parse as Florida's list)
//   - Per-year "<YYYY> All-Big East Conference football team" (VT era 1994–2003)
//   - Per-year "<YYYY> All-ACC football team" (2004–2025)
//   - Big East / ACC individual-award + national-award pages
//
// Saved as honors-wiki/<slug>.wikitext via the MediaWiki parse API.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'honors-wiki')
const FORCE = process.argv.includes('--force')

const pages = [
  'List of Virginia Tech Hokies football All-Americans',
  'Atlantic Coast Conference Football Player of the Year',
  'Big East Conference football individual awards',
  'List of Heisman Trophy winners',
  'Lombardi Award',
  'Chuck Bednarik Award',
  'Bronko Nagurski Trophy',
  'Jim Thorpe Award',
  'Ted Hendricks Award',
  'Davey O’Brien Award',
  'Maxwell Award',
]
for (let y = 1994; y <= 2003; y++)
  pages.push(`${y} All-Big East Conference football team`)
for (let y = 2004; y <= 2025; y++) pages.push(`${y} All-ACC football team`)

const slug = (t) => t.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-')

async function wikitext(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=${encodeURIComponent(title)}`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YourSchoolAllStars-data-curation (contact: repo owner)' },
    })
    if (res.status === 429 && attempt <= 5) {
      await new Promise((r) => setTimeout(r, 15000 * attempt))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    if (j.error) throw new Error(j.error.info)
    return j.parse.wikitext['*']
  }
}

mkdirSync(OUT_DIR, { recursive: true })
for (const title of pages) {
  const f = join(OUT_DIR, `${slug(title)}.wikitext`)
  if (existsSync(f) && !FORCE) {
    console.log(`skip ${title}`)
    continue
  }
  try {
    const text = await wikitext(title)
    writeFileSync(f, `<!-- source: https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))} -->\n${text}`)
    console.log(`saved ${title} (${text.length}b)`)
  } catch (e) {
    console.log(`FAILED ${title}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 5000))
}
