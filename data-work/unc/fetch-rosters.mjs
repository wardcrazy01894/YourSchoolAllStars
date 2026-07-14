// UNC: fetch the goheels.com HISTORICAL rosters (1997–2025).
//
// Usage:  node data-work/unc/fetch-rosters.mjs [--start 1997] [--end 2025] [--force]
//
// Why this matters: the old official season cumes (the only source of pre-2016
// DEFENSE) print names ABBREVIATED and jersey-first — "30 Thornton, D." — so
// the rows can't be identified, let alone positioned, without a roster. Sidearm
// keeps goheels rosters back to 1997 as server-rendered HTML, each entry
// carrying jersey + full name + a spelled-out position ("Linebacker"):
//
//   Jersey Number | 30 | David Thornton | Position | Linebacker | Academic Year …
//
// That is the join key for the whole 1997–2015 gap, and the position oracle
// for the era (better than SR's coarse codes).
//
// Output: data-work/unc/rosters/<year>.json — [{jersey, name, position, class}]

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'rosters')

const args = process.argv.slice(2)
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? Number(args[i + 1]) : d
}
const START = flag('start', 1997)
const END = flag('end', 2025)
const FORCE = args.includes('--force')

const decode = (s) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (i === 3) throw e
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true })

for (let year = START; year <= END; year++) {
  const out = join(OUT_DIR, `${year}.json`)
  if (existsSync(out) && !FORCE) {
    console.log(`${year}: exists, skipping`)
    continue
  }
  const url = `https://goheels.com/sports/football/roster/${year}`
  const html = await get(url)
  // Each roster card renders a flat field sequence; pull the fields by label.
  const players = []
  // Read the flat label-run: "Jersey Number | N | Name | Position | Pos".
  const flat = html.replace(/<[^>]+>/g, '|').replace(/(\|\s*)+/g, '|')
  const parts = flat.split('|').map((s) => decode(s))
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== 'Jersey Number') continue
    const jersey = parts[i + 1]
    const name = parts[i + 2]
    if (parts[i + 3] !== 'Position') continue
    const position = parts[i + 4]
    const klass = parts[i + 5] === 'Academic Year' ? parts[i + 6] : null
    if (!name || !/^[A-Za-z]/.test(name)) continue
    players.push({ jersey, name, position, class: klass })
  }
  // de-dupe (the page renders a card + a table row for each player)
  const seen = new Set()
  const uniq = players.filter((p) => {
    const k = `${p.jersey}:${p.name}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  writeFileSync(
    out,
    JSON.stringify({ year, source: url, players: uniq }, null, 1),
  )
  console.log(`${year}: ${uniq.length} players`)
  await new Promise((r) => setTimeout(r, 400))
}