// VT football: fetch ROSTERS (names + position codes, no stats) from the WMT
// API for the seasons where per-player statistics are absent but rosters
// exist (2002–2012). The gap-year stat parser joins its name-only stat rows
// to these to resolve positions. See data-work/vt/PROGRESS.md.
//
// Usage:  node data-work/vt/fetch-wmt-rosters.mjs [--start 2002] [--end 2012] [--force]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'rosters')
const TEAM_IDS = JSON.parse(readFileSync(join(HERE, 'wmt-team-ids.json')))

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 2002)
const END = flag('end', 2012)
const FORCE = args.includes('--force')

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const text =
        buf[0] === 0x1f && buf[1] === 0x8b
          ? gunzipSync(buf).toString('utf8')
          : buf.toString('utf8')
      return JSON.parse(text)
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true })

for (let season = START; season <= END; season++) {
  const out = join(OUT_DIR, `${season}.json`)
  if (existsSync(out) && !FORCE) {
    console.log(`${season}: exists, skipping`)
    continue
  }
  const teamId = TEAM_IDS[String(season + 1)]
  if (!teamId) {
    console.log(`${season}: no WMT team id — skipping`)
    continue
  }
  const d = await get(
    `https://api.wmt.games/api/statistics/teams/${teamId}/players?per_page=200`,
  )
  const rows = d.data
    .map((p) => ({
      personId: p.person_id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      position: p.position_code ?? null,
      class: p.class_short_descr ?? null,
      jersey: p.jersey_no ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(
    out,
    JSON.stringify(
      {
        season,
        teamId,
        api: `https://api.wmt.games/api/statistics/teams/${teamId}/players?per_page=200`,
        fetched: new Date().toISOString(),
        players: rows,
      },
      null,
      1,
    ),
  )
  console.log(`${season}: ${rows.length} roster rows`)
  await new Promise((r) => setTimeout(r, 400))
}
