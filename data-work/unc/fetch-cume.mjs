// UNC gap years: download the archived official season cumes found by
// discover-old-cumes.mjs (old-cume-index.json) plus the CSTV-era
// `<yyyy>-<yyyy>/teamcume.html` pages, into data-work/unc/cume-html/<season>.html.
//
// Usage:  node data-work/unc/fetch-cume.mjs [--force]
//
// Wayback gotcha (cost an hour on this school): a plain
// `/web/<ts>/<url>` fetch returns the Wayback INTERSTITIAL page, not the
// archived document. The `id_` suffix (`/web/<ts>id_/<url>`) returns the raw
// original bytes — always use it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'cume-html')
const FORCE = process.argv.includes('--force')

const index = JSON.parse(readFileSync(join(HERE, 'old-cume-index.json')))

// The CSTV-era seasons (2003–2009) live at a predictable path; 2010/2011's only
// captures are MID-SEASON (Nov 10 / Sep 26) and are deliberately NOT used —
// SR covers 2010+ with full defense instead.
const CSTV = {}
for (let y = 2003; y <= 2009; y++)
  CSTV[y] =
    `http://tarheelblue.cstv.com/sports/m-footbl/stats/${y}-${y + 1}/teamcume.html`

async function text(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (i === tries) throw e
      await new Promise((r) => setTimeout(r, 2500 * i))
    }
  }
}

async function newestCapture(url) {
  const cdx = await text(
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=text&fl=timestamp&filter=statuscode:200&limit=30`,
  )
  const ts = cdx.trim().split('\n').filter(Boolean)
  return ts.length ? ts[ts.length - 1].trim() : null
}

mkdirSync(OUT_DIR, { recursive: true })

// 1) the discovered date-named cumes (pre-CSTV era)
for (const [season, v] of Object.entries(index)) {
  const out = join(OUT_DIR, `${season}.html`)
  if (existsSync(out) && !FORCE) {
    console.log(`${season}: exists`)
    continue
  }
  const html = await text(v.snapshot)
  writeFileSync(out, html)
  console.log(`${season}: saved ${html.length}b (${v.scope}) ${v.url}`)
  await new Promise((r) => setTimeout(r, 600))
}

// 2) the CSTV-era teamcume pages
for (const [season, url] of Object.entries(CSTV)) {
  const out = join(OUT_DIR, `${season}.html`)
  if (existsSync(out) && !FORCE) {
    console.log(`${season}: exists`)
    continue
  }
  const ts = await newestCapture(url)
  if (!ts) {
    console.log(`${season}: NO CAPTURE (${url})`)
    continue
  }
  const html = await text(`http://web.archive.org/web/${ts}id_/${url}`)
  const scope =
    html.match(/\((FINAL STATS|as of [A-Z][a-z]{2} \d{1,2}, \d{4})\)/i)?.[1] ??
    'unknown'
  writeFileSync(out, html)
  // Record it in the index so the parser cites the right snapshot.
  index[season] = {
    season: Number(season),
    url,
    snapshot: `http://web.archive.org/web/${ts}id_/${url}`,
    scope,
  }
  console.log(`${season}: saved ${html.length}b (${scope})`)
  await new Promise((r) => setTimeout(r, 800))
}

writeFileSync(join(HERE, 'old-cume-index.json'), JSON.stringify(index, null, 1))
console.log('\nindex seasons:', Object.keys(index).sort().join(', '))
