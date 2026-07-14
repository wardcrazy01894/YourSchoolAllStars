// VT football gap years: parse the archived hokiesports.com season-cume pages
// (downloaded by fetch-gap.mjs into gap-html/) into per-season stat drafts at
// data-work/vt/gap/<season>.json — same row shape as wmt/<season>.json.
//
// Usage:  node data-work/vt/parse-gap.mjs [--start 1994] [--end 2012]
//
// The 2012-era site rendered every historical year in ONE template
// ("Overall Individual Stats" + "Overall Defensive Stats" tables, class
// tablehead, gamehead header rows). Header layouts are asserted, every
// numeric column is validated against the printed Total row (TEAM pseudo-rows
// count toward totals but are not emitted), and any mismatch is REPORTED so a
// template drift in some year fails loudly instead of shipping bad rows.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const IN_DIR = join(HERE, 'gap-html')
const OUT_DIR = join(HERE, 'gap')

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const START = flag('start', 1994)
const END = flag('end', 2012)

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()

/** All <table class="tablehead"> blocks, each as {headers[][], rows[][]}. */
function tables(html) {
  const out = []
  const re = /<table[^>]*class="tablehead"[^>]*>([\s\S]*?)<\/table>/g
  for (const m of html.matchAll(re)) {
    const headers = []
    const rows = []
    for (const tr of m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const ths = [...tr[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((c) =>
        strip(c[1]),
      )
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
        strip(c[1]),
      )
      if (ths.length) headers.push(ths)
      else if (tds.length) rows.push(tds)
    }
    out.push({ headers, rows })
  }
  return out
}

const num = (s) => {
  if (s === undefined || s === '' || s === '-') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
/** "5.0-9" (count-yards pairs) → 5.0; "-" → 0. */
const pairFirst = (s) => num(String(s ?? '').split('-')[0])

const isPseudo = (name) => /^(TEAM|Total|Opponents)$/i.test(name)

function parseYear(year) {
  const html = readFileSync(join(IN_DIR, `${year}.html`), 'utf8')
  const meta = JSON.parse(
    readFileSync(join(IN_DIR, `${year}.meta.json`), 'utf8'),
  )
  const problems = []
  // name → { name, games, stats }
  const players = new Map()
  const touch = (name) => {
    if (!players.has(name)) players.set(name, { name, games: null, stats: {} })
    return players.get(name)
  }
  const gpOf = (cell) => num(String(cell).split('-')[0]) || null

  // Column checksum: Σ player col + Σ TEAM col must equal the Total row.
  function checksum(label, rows, idx, value, totalRow) {
    if (!totalRow) return
    const want = value(totalRow)
    const got = rows.reduce((a, r) => a + value(r), 0)
    if (Math.abs(want - got) > 0.101) {
      problems.push(`${year} ${label}[${idx}]: Σplayers ${got} != Total ${want}`)
    }
  }

  for (const t of tables(html)) {
    const flatHead = t.headers.flat()
    const first = t.headers.at(-1)?.[0] ?? ''
    const dataRows = t.rows.filter((r) => !isPseudo(r[0]))
    const totalRow = t.rows.find((r) => /^Total$/i.test(r[0]))
    const sumRows = t.rows.filter((r) => !/^(Total|Opponents)$/i.test(r[0]))

    if (first === 'Rushing' && flatHead.includes('Net')) {
      // name|GP-GS|Att|Gain|Loss|Net|Avg|TD|Long|Avg/G
      for (const r of dataRows) {
        const p = touch(r[0])
        p.games ??= gpOf(r[1])
        p.stats.rushYds = (p.stats.rushYds ?? 0) + num(r[5])
        p.stats.rushTD = (p.stats.rushTD ?? 0) + num(r[7])
      }
      checksum('rush net', sumRows, 5, (r) => num(r[5]), totalRow)
      checksum('rush TD', sumRows, 7, (r) => num(r[7]), totalRow)
    } else if (first === 'Passing' && flatHead.includes('Effic')) {
      // name|GP-GS|Effic|Cmp-Att-Int|Pct|Yards|TD|Long|Avg/G
      for (const r of dataRows) {
        const p = touch(r[0])
        p.games ??= gpOf(r[1])
        const cai = String(r[3]).split('-')
        p.stats.passYds = (p.stats.passYds ?? 0) + num(r[5])
        p.stats.passTD = (p.stats.passTD ?? 0) + num(r[6])
        p.stats.passInt = (p.stats.passInt ?? 0) + num(cai[2])
      }
      checksum('pass yds', sumRows, 5, (r) => num(r[5]), totalRow)
      checksum('pass TD', sumRows, 6, (r) => num(r[6]), totalRow)
      checksum(
        'pass int',
        sumRows,
        3,
        (r) => num(String(r[3]).split('-')[2]),
        totalRow,
      )
    } else if (first === 'Receiving' && flatHead.includes('No.')) {
      // name|GP-GS|No.|Yards|Avg|TD|Long|Avg/G
      for (const r of dataRows) {
        const p = touch(r[0])
        p.games ??= gpOf(r[1])
        p.stats.rec = (p.stats.rec ?? 0) + num(r[2])
        p.stats.recYds = (p.stats.recYds ?? 0) + num(r[3])
        p.stats.recTD = (p.stats.recTD ?? 0) + num(r[5])
      }
      checksum('rec no', sumRows, 2, (r) => num(r[2]), totalRow)
      checksum('rec yds', sumRows, 3, (r) => num(r[3]), totalRow)
    } else if (first === 'Defensive Leaders') {
      // name|GP-GS|Solo|Ast|Total|TFL-Yds|No-Yds|Int-Yds|BU|PD|QBH|Rcv-Yds|FF|Kick|Safety
      const h = t.headers.at(-1)
      const expect = ['Defensive Leaders', 'GP-GS', 'Solo', 'Ast', 'Total']
      if (!expect.every((x, i) => h[i] === x)) {
        problems.push(`${year} defense: unexpected header ${h.join('|')}`)
        continue
      }
      for (const r of dataRows) {
        const p = touch(r[0])
        p.games ??= gpOf(r[1])
        const s = p.stats
        const set = (k, v) => {
          if (v !== 0) s[k] = (s[k] ?? 0) + v
        }
        set('tackles', num(r[4]))
        set('tfl', pairFirst(r[5]))
        set('sacks', pairFirst(r[6]))
        set('defInt', pairFirst(r[7]))
        set('pbu', num(r[8]))
        set('ff', num(r[12]))
      }
      checksum('tackles', sumRows, 4, (r) => num(r[4]), totalRow)
      checksum('sacks', sumRows, 6, (r) => pairFirst(r[6]), totalRow)
      checksum('int', sumRows, 7, (r) => pairFirst(r[7]), totalRow)
    }
    // Interceptions/returns/scoring tables are intentionally ignored: INTs
    // come from the defensive table (same numbers, one authority).
  }

  // Drop rows with zero meaningful stats after cleanup.
  const out = [...players.values()]
    .map((p) => {
      const stats = Object.fromEntries(
        Object.entries(p.stats).filter(([, v]) => v !== 0),
      )
      return { ...p, stats }
    })
    .filter((p) => Object.keys(p.stats).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { meta, players: out, problems }
}

mkdirSync(OUT_DIR, { recursive: true })
let allProblems = []
for (let year = START; year <= END; year++) {
  if (!existsSync(join(IN_DIR, `${year}.html`))) {
    console.log(`${year}: no gap-html download — run fetch-gap.mjs first`)
    continue
  }
  const { meta, players, problems } = parseYear(year)
  allProblems = allProblems.concat(problems)
  writeFileSync(
    join(OUT_DIR, `${year}.json`),
    JSON.stringify(
      { season: year, source: meta.snapshot, players },
      null,
      1,
    ),
  )
  console.log(
    `${year}: ${players.length} stat rows${problems.length ? ` — ${problems.length} CHECKSUM PROBLEMS` : ''}`,
  )
}
if (allProblems.length) {
  console.log('\nPROBLEMS:')
  for (const p of allProblems) console.log('  ' + p)
  process.exitCode = 1
}
