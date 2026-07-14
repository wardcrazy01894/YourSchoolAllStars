// VT football: fetch per-player season totals from the WMT Digital API
// (api.wmt.games) that powers hokiesports.com. See data-work/vt/PROGRESS.md.
//
// Usage:  node data-work/vt/fetch-wmt.mjs [--start 2013] [--end 2025] [--force]
//
// Writes one draft file per season to data-work/vt/wmt/<season>.json and skips
// seasons whose file already exists (unless --force) — safe to re-run after an
// interrupted session. Each row keeps the WMT person id (stable across years),
// the roster position code, games, and the FbStats-mapped season totals.
//
// Key semantics verified against known 2024 lines (PROGRESS.md):
//   sRushingYards is NET (gained - lost, NCAA convention); pbu is PURE
//   breakups (sPassesBrokenUp), matching the shipped datasets (Woodson 1997
//   pbu=9 style), NOT sPassesDefended (= PBU + INT).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'wmt')
const TEAM_IDS = JSON.parse(readFileSync(join(HERE, 'wmt-team-ids.json')))

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 2013)
const END = flag('end', 2025)
const FORCE = args.includes('--force')

// FbStats key <- WMT season-statistic key. sTotalTacklesForLoss can be
// fractional (half TFL) — kept as-is, like Pitt/Florida fractional sacks.
const STAT_MAP = {
  passYds: 'sPassYards',
  passTD: 'sPassTDs',
  passInt: 'sPassInterceptions',
  rushYds: 'sRushingYards',
  rushTD: 'sRushTDs',
  rec: 'sReceptions',
  recYds: 'sReceivingYards',
  recTD: 'sRecTDs',
  tackles: 'sTotalTackles',
  tfl: 'sTotalTacklesForLoss',
  sacks: 'sSacks',
  defInt: 'sInterceptions',
  pbu: 'sPassesBrokenUp',
  ff: 'sForcedFumbles',
}

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
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
  const teamId = TEAM_IDS[String(season + 1)] // map key = ACADEMIC year
  if (!teamId) {
    console.log(`${season}: no WMT team id — skipping`)
    continue
  }
  const d = await get(
    `https://api.wmt.games/api/statistics/teams/${teamId}/players?per_page=200`,
  )
  const rows = []
  let noStats = 0
  for (const p of d.data) {
    const season_ = p.statistic?.data?.season
    const st = season_?.columns?.[0]?.statistic
    if (!st) {
      noStats++
      continue
    }
    const stats = {}
    for (const [ours, theirs] of Object.entries(STAT_MAP)) {
      const v = st[theirs]
      if (typeof v === 'number' && v !== 0) stats[ours] = v
    }
    // QBs always carry a rushing line (NCAA net; 0 = genuinely none) — the
    // dataset guard requires it and absence in these tables means zero.
    if (p.position_code === 'QB') {
      stats.rushYds ??= 0
      stats.rushTD ??= 0
    }
    if (Object.keys(stats).length === 0) continue // participated, no counting stats
    rows.push({
      personId: p.person_id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      position: p.position_code ?? null,
      class: p.class_short_descr ?? null,
      games: season_.gamesPlayed ?? null,
      gamesStarted: season_.gamesStarted ?? null,
      stats,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(
    out,
    JSON.stringify(
      {
        season,
        teamId,
        source: `https://hokiesports.com/sports/football/stats/season/${season}`,
        api: `https://api.wmt.games/api/statistics/teams/${teamId}/players?per_page=200`,
        fetched: new Date().toISOString(),
        rosterCount: d.data.length,
        noStatBlock: noStats,
        players: rows,
      },
      null,
      1,
    ),
  )
  console.log(
    `${season}: ${rows.length} stat rows (${d.data.length} roster, ${noStats} without stats)`,
  )
  await new Promise((r) => setTimeout(r, 400))
}
