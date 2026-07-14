// UNC honors: fetch the Wikipedia wikitext that the OFFICIAL media guide can't
// supply cleanly.
//
// Usage:  node data-work/unc/fetch-honors-wiki.mjs [--force]
//
// Division of labour (see PROGRESS.md):
//   • the guide  → All-ACC selections 1994–2024 (with team level) + ACC awards
//   • Wikipedia  → (a) FIRST-TEAM All-Americans 1994–2025, because the guide's
//                      own roll is a dotted-leader list whose years get cut at
//                      the column edge, and its per-player bios wrap; the
//                      per-year All-America articles are structured AND carry
//                      the consensus/unanimous status the guide doesn't;
//                  (b) the national trophies — the guide's "National Awards"
//                      page lists notable FINISHES, not wins (its Heisman block
//                      names four Tar Heels, none of whom won it), so parsing
//                      it would fabricate awards;
//                  (c) the 2025 All-ACC team (the 2025 guide predates it).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'honors-wiki')
const FORCE = process.argv.includes('--force')

const pages = [
  'Lombardi Award',
  'Chuck Bednarik Award',
  'Bronko Nagurski Trophy',
  'Jim Thorpe Award',
  'Outland Trophy',
  'Butkus Award',
  'Maxwell Award',
  'Walter Camp Award',
  'Biletnikoff Award',
  'John Mackey Award',
  'Rimington Trophy',
  'Doak Walker Award',
  'Ted Hendricks Award',
  'Davey O’Brien Award',
  'List of Heisman Trophy winners',
  // the 2025 All-ACC team (the guide covers through 2024)
  '2025 All-ACC football team',
]
for (let y = 1994; y <= 2025; y++)
  pages.push(`${y} College Football All-America Team`)

const slug = (t) =>
  t.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-')

async function wikitext(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=${encodeURIComponent(title)}`
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'YourSchoolAllStars-data-curation (contact: repo owner)',
      },
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
    writeFileSync(
      f,
      `<!-- source: https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))} -->\n${text}`,
    )
    console.log(`saved ${title} (${text.length}b)`)
  } catch (e) {
    console.log(`FAILED ${title}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 5000))
}
