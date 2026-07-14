// VT football: download Sports-Reference season pages 1994–2025 via the
// Wayback Machine (direct SR 403s scripted fetches) for the stage-3 SR sweep
// (position resolution + phantom/hole/delta cross-validation).
//
// Usage:  node data-work/vt/fetch-sr.mjs [--start 1994] [--end 2025] [--force]
//
// `web.archive.org/web/2024/<url>` redirects to the newest ≤2024 capture,
// which uses SR's MODERN table layout (div_passing_standard,
// div_rushing_standard, div_defense_standard, data-stat attrs) for every
// season — the pre-redesign table-id headaches from the Pitt work only apply
// to old snapshots, which this route avoids. 2025's season page needs a 2025+
// capture (falls back to /web/2026/). Saved to sr-html/<year>.html with the
// resolved snapshot URL in <year>.meta.json (cite THAT URL on repaired rows).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'sr-html')

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 1994)
const END = flag('end', 2025)
const FORCE = args.includes('--force')

async function fetchVia(waybackYear, year) {
  const url = `http://web.archive.org/web/${waybackYear}/https://www.sports-reference.com/cfb/schools/virginia-tech/${year}.html`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  return { html, snapshot: res.url }
}

mkdirSync(OUT_DIR, { recursive: true })

for (let year = START; year <= END; year++) {
  const htmlPath = join(OUT_DIR, `${year}.html`)
  if (existsSync(htmlPath) && !FORCE) {
    console.log(`${year}: exists, skipping`)
    continue
  }
  let got = null
  for (const wb of year >= 2025 ? ['2026'] : ['2024', '2026']) {
    for (let attempt = 1; attempt <= 3 && !got; attempt++) {
      try {
        got = await fetchVia(wb, year)
      } catch (e) {
        if (attempt === 3) console.log(`${year}: via ${wb} failed (${e})`)
        else await new Promise((r) => setTimeout(r, 3000 * attempt))
      }
    }
    if (got) break
  }
  if (!got) {
    console.log(`${year}: FAILED`)
    continue
  }
  // A capture must contain the season tables, not an SR error/consent page.
  if (!/div_(rushing|passing)_standard|div_rushing_and_receiving/.test(got.html)) {
    console.log(`${year}: capture lacks stat tables — NOT saved (${got.snapshot})`)
    continue
  }
  writeFileSync(htmlPath, got.html)
  writeFileSync(
    join(OUT_DIR, `${year}.meta.json`),
    JSON.stringify(
      { year, snapshot: got.snapshot, bytes: got.html.length },
      null,
      1,
    ),
  )
  console.log(`${year}: saved ${got.html.length}b (${got.snapshot})`)
  await new Promise((r) => setTimeout(r, 1500))
}
