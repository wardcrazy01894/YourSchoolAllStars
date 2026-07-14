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
// 2017 and 2020–2023 use the long-form article title; the rest the short form.
for (let y = 2004; y <= 2025; y++)
  pages.push(
    y === 2017 || (y >= 2020 && y <= 2023)
      ? `${y} All-Atlantic Coast Conference football team`
      : `${y} All-ACC football team`,
  )
// Per-year national All-America pages. These are EVIDENCE, not a parse input:
// the official list supplies the AAs (and its own C/U legend), but it ends at
// 2015, so these pages are what was checked to establish that VT has NO
// first-team All-American at a draftable position in 2016–2025 (the only VT
// name in any of them is Christian Darrisaw, 2020, by a single selector — and
// he's an OL, a position the game doesn't carry). Keep them committed so that
// claim stays auditable; no parser reads them.
for (const y of [1996, 1998, 1999, 2003, 2004, 2005]) // official-list 1st-team years
  pages.push(`${y} College Football All-America Team`)
for (let y = 2016; y <= 2025; y++)
  pages.push(`${y} College Football All-America Team`)

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
