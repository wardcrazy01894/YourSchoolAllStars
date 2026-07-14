// VT honors, stage 4b: parse the saved Wikipedia wikitext for the years the
// archived official pages don't cover — All-ACC selections 2016–2025 (the
// official awards.html capture ends at 2015) plus the Corey Moore national
// hardware. 2017's All-ACC article doesn't exist on Wikipedia; that year is
// filled by ledger-2017.json (built separately from the ACC's own release —
// see PROGRESS.md).
//
// Usage:  node data-work/vt/parse-honors-wiki.mjs
// Output: honors/ledger-wiki.json (same entry shape as ledger-official.json)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WIKI = join(HERE, 'honors-wiki')

const ledger = []
const add = (year, name, honor, source) =>
  ledger.push({ year, name, honor, source })

const srcOf = (file) =>
  readFileSync(join(WIKI, file), 'utf8').match(/<!-- source: (\S+) -->/)?.[1] ??
  `https://en.wikipedia.org/wiki/${file.replace('.wikitext', '')}`

// ── All-ACC 2016–2025 (minus 2017) ───────────────────────────────────────────
for (let y = 2016; y <= 2025; y++) {
  const file =
    y === 2017 || (y >= 2020 && y <= 2023)
      ? `${y}-all-atlantic-coast-conference-football-team.wikitext`
      : `${y}-all-acc-football-team.wikitext`
  if (!existsSync(join(WIKI, file))) {
    console.log(`${y}: no wikitext (fill separately)`)
    continue
  }
  const src = srcOf(file)
  const text = readFileSync(join(WIKI, file), 'utf8')
  // Scope to the postseason all-conference section; heading wording varies.
  const secM = text.match(
    /===?\s*All[- ][Cc]onference [Tt]eams?\s*===?([\s\S]*?)(?:\n==[^=]|$)/,
  )
  if (!secM) {
    console.log(`${y}: NO all-conference section found`)
    continue
  }
  const sec = secM[1]
  // These wikitables are Position | Player | Team, but with rowspans on BOTH
  // the position cell (one position, several players) and sometimes the team
  // cell (two straight picks from the same school), so a row can carry 3, 2,
  // or 1 cells. Parse row-by-row and carry a rowspanned team forward — the
  // naive "last | cell before the team cell" reading grabs a class column
  // ("So.", "Sr.") in the years that have one.
  const cellText = (raw) =>
    raw
      .replace(/^[|!]+/, '')
      .replace(/^[^|]*\|(?![|])/, '') // drop cell attributes (rowspan/style)
      .replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '')
      .replace(/\{\{sortname\|([^|}]+)\|([^|}]+)[^}]*\}\}/g, '$1 $2')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/g, '$1')
      .replace(/'''?/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
  const isPlayerish = (t) =>
    /[a-z]/.test(t) &&
    /\s/.test(t) &&
    !/^(So|Jr|Sr|Fr|Gr|RS|R-)\.?$/i.test(t) &&
    !/Team (Offense|Defense|Special)/i.test(t)

  let team = null
  let rows = []
  let cur = null
  for (const line of sec.split('\n')) {
    const t = line.trim()
    // '''First Team''' / '''First-team''' (2025) — but NOT the in-table
    // '''First Team Offense''' separators (the closing ''' pins that).
    const tm = t.match(/'''\s*(First|Second|Third)[-\s]team\s*'''/i)
    if (tm) {
      team = tm[1][0].toUpperCase() + tm[1].slice(1).toLowerCase()
      rows.push({ marker: team })
      continue
    }
    if (/^\|-/.test(t)) {
      if (cur) rows.push({ cells: cur })
      cur = []
      continue
    }
    if (/^\|}/.test(t)) {
      if (cur) rows.push({ cells: cur })
      cur = null
      continue
    }
    if (cur && /^[|!]/.test(t)) cur.push(t)
  }
  if (cur) rows.push({ cells: cur })

  let level = null
  let carryTeam = null
  let carryLeft = 0
  for (const r of rows) {
    if (r.marker) {
      level = r.marker
      carryLeft = 0
      continue
    }
    const cells = r.cells.filter((c) => !/colspan/.test(c))
    if (cells.length === 0 || !level) continue
    // The player is the LAST player-ish cell before the school — some years
    // carry a class column (Player | Class | School), so "second-to-last"
    // would read "So."/"Sr.".
    const playerBefore = (end) => {
      for (let i = end; i >= 0; i--) {
        const txt = cellText(cells[i])
        if (isPlayerish(txt)) return txt
      }
      return null
    }
    let school = null
    let player = null
    if (carryLeft > 0) {
      // School cell was rowspanned from an earlier row.
      school = carryTeam
      player = playerBefore(cells.length - 1)
      carryLeft--
    } else if (cells.length >= 2) {
      school = cellText(cells.at(-1))
      player = playerBefore(cells.length - 2)
      const rs = cells.at(-1).match(/rowspan\s*=\s*"?(\d+)/)
      carryTeam = school
      carryLeft = rs ? Number(rs[1]) - 1 : 0
    } else continue
    if (school !== 'Virginia Tech' || !player) continue
    add(y, player, `${level}-Team All-ACC (${y})`, src)
  }
}

// ── national hardware (VT 1994+ winners from the award pages) ────────────────
for (const [file, honorName] of [
  ['lombardi-award.wikitext', 'Lombardi Award'],
  ['bronko-nagurski-trophy.wikitext', 'Bronko Nagurski Trophy'],
  ['chuck-bednarik-award.wikitext', 'Chuck Bednarik Award'],
  ['jim-thorpe-award.wikitext', 'Jim Thorpe Award'],
  ['ted-hendricks-award.wikitext', 'Ted Hendricks Award'],
  ['maxwell-award.wikitext', 'Maxwell Award'],
  ['davey-obrien-award.wikitext', "Davey O'Brien Award"],
  ['list-of-heisman-trophy-winners.wikitext', 'Heisman Trophy'],
]) {
  if (!existsSync(join(WIKI, file))) continue
  const src = srcOf(file)
  const text = readFileSync(join(WIKI, file), 'utf8')
  for (const line of text.split('\n')) {
    if (!/Virginia Tech/.test(line)) continue
    const ym = line.match(/\b(19\d\d|20\d\d)\b/)
    const nm = line.match(/\{\{sortname\|([^|}]+)\|([^|}]+)/)
    if (!ym || !nm) continue
    const y = Number(ym[1])
    if (y < 1994 || y > 2025) continue
    add(y, `${nm[1]} ${nm[2]}`, `${honorName} (${y})`, src)
  }
}

ledger.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
writeFileSync(join(HERE, 'honors', 'ledger-wiki.json'), JSON.stringify(ledger, null, 1))
const byYear = {}
for (const e of ledger) byYear[e.year] = (byYear[e.year] ?? 0) + 1
console.log(`entries: ${ledger.length}`, byYear)
for (const e of ledger) console.log(` ${e.year} ${e.name} — ${e.honor}`)
