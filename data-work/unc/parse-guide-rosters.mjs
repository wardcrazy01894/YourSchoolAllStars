// UNC: parse the ROSTER out of each media guide (1994-2000).
//
// Usage:  node data-work/unc/parse-guide-rosters.mjs
// Output: data-work/unc/guide-rosters/<year>.json  (same shape as goheels rosters)
//
// The guides' pre-1997 defensive tables print surnames only, so they need a roster
// to become real players. Two other sources were tried and are not good enough:
//   * Sports-Reference's 1994-96 roster pages are badly incomplete — the 1994 one
//     lists 40 players and omits Brian Simmons, a freshman who made 23 tackles.
//   * goheels' historical rosters start at 1997 AND have holes: the 1999 one has 53
//     players and no Julius Peppers.
// The guide for season N carries season N's own full roster — jersey, full name,
// position — and it is the very document the statistics came from. These are
// therefore parsed for every guide year and UNIONED with the goheels rosters, so a
// hole in either is covered by the other.
//
// Same geometry as parse-guides.mjs: cluster the page's words into rows, then read
// each row as [jersey] [name…] [POSITION] [height] [weight] [class]. The POSITION
// token is the anchor — it is drawn from a closed set, so it marks exactly where
// the name ends, which a purely positional read cannot do when a name is one, two
// or three words long.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'guide-rosters')
mkdirSync(OUT, { recursive: true })

// The 1990s guides use the era's split-linebacker codes (SLB/WLB strong- and
// weak-side, ROV rover) and flanker/split-end names alongside the modern ones.
// Missing them cost real players: Mike Morton, the 1994 team's leading tackler, is
// listed "58 Mike Morton WLB" and was skipped entirely.
const POSITIONS = new Set([
  'QB', 'RB', 'TB', 'FB', 'HB', 'WR', 'FL', 'SE', 'TE', 'OL', 'OT', 'OG', 'C', 'OC', 'G', 'T',
  'DL', 'DE', 'DT', 'NG', 'NT', 'LB', 'OLB', 'ILB', 'MLB', 'SLB', 'WLB', 'ROV',
  'DB', 'CB', 'S', 'SS', 'FS', 'K', 'PK', 'P', 'LS', 'SN', 'DS', 'ATH', 'H',
])

function wordsOf(page) {
  const out = []
  for (const m of page.matchAll(
    /<WORD coords="([\d,\- ]+)"[^>]*>([^<]*)<\/WORD>/g,
  )) {
    const c = m[1].split(',').map(Number)
    const text = m[2]
      .replace(/&amp;/g, '&')
      .replace(/&apos;|&#0?39;/g, "'")
      .trim()
    if (!text) continue
    out.push({
      x1: c[0],
      x2: c[2],
      cy: (c[1] + c[3]) / 2,
      h: Math.abs(c[3] - c[1]),
      text,
    })
  }
  return out
}

function rowsOf(words) {
  if (!words.length) return []
  const hs = words.map((w) => w.h).sort((a, b) => a - b)
  const tol = Math.max(6, (hs[hs.length >> 1] || 20) * 0.7)
  const sorted = [...words].sort((a, b) => a.cy - b.cy)
  const rows = []
  let cur = [sorted[0]]
  for (const w of sorted.slice(1)) {
    if (Math.abs(w.cy - cur[0].cy) <= tol) cur.push(w)
    else {
      rows.push(cur)
      cur = [w]
    }
  }
  rows.push(cur)
  return rows.map((r) => r.sort((a, b) => a.x1 - b.x1))
}

for (const year of [1994, 1995, 1996, 1997, 1998, 1999, 2000]) {
  const xml = readFileSync(
    join(HERE, 'guide-xml', `carolinafootball${year}unse.xml`),
    'utf8',
  )
  const byName = new Map()
  for (const page of xml.split(/(?=<OBJECT )/)) {
    const flat = page.replace(/<[^>]+>/g, ' ')
    if (!/roster/i.test(flat)) continue
    for (const row of rowsOf(wordsOf(page))) {
      const toks = row.map((w) => w.text)
      // The row must contain a position token from the closed set; that token is
      // where the name ends.
      const pi = toks.findIndex((t) =>
        POSITIONS.has(t.replace(/[^A-Za-z]/g, '').toUpperCase()),
      )
      if (pi < 1) continue
      const pos = toks[pi].replace(/[^A-Za-z]/g, '').toUpperCase()
      // A height ("6-2") right after the position confirms this is a roster row and
      // not prose that happens to contain a two-letter word. The 1994 guide sets
      // its roster with leader dots ("SS .6-2."), so strip those first.
      const after = toks
        .slice(pi + 1)
        .join(' ')
        .replace(/[.•…]/g, ' ')
        .trim()
      if (!/^\d-\d{1,2}\b/.test(after)) continue

      const nameToks = toks
        .slice(0, pi)
        .filter((t) => /^[A-Za-z'.-]+$/.test(t) && t.length > 1)
      if (nameToks.length < 2) continue
      const name = nameToks
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\.$/, '')
        .trim()
      if (!/^[A-Z]/.test(name)) continue
      const jersey = toks.slice(0, pi).find((t) => /^\d{1,2}$/.test(t)) ?? null
      if (!byName.has(name)) byName.set(name, { name, position: pos, jersey })
    }
  }
  const players = [...byName.values()]
  writeFileSync(
    join(OUT, `${year}.json`),
    JSON.stringify(
      {
        year,
        source: `https://archive.org/details/carolinafootball${year}unse`,
        sourceNote: `${year} Carolina Football media guide roster (UNC Athletics), scanned by UNC Libraries.`,
        players,
      },
      null,
      1,
    ),
  )
  console.log(`${year}: ${players.length} players`)
}
