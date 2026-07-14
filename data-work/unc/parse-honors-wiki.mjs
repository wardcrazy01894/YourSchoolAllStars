// UNC honors: parse the Wikipedia wikitext for what the official guide can't
// give cleanly — first-team All-Americans (with consensus/unanimous status),
// the national trophies, and the 2025 All-ACC team.
//
// Usage:  node data-work/unc/parse-honors-wiki.mjs
// Output: data-work/unc/honors/ledger-wiki.json
//
// SCHOOL-MATCH TRAP: "North Carolina" is a prefix of "North Carolina State".
// Every match here is anchored on the Tar Heels link forms
// ([[YYYY North Carolina Tar Heels football team|North Carolina]] or a bare
// "North Carolina" NOT followed by "State"), so an NC State winner can never be
// credited to UNC.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WIKI = join(HERE, 'honors-wiki')
const OUT_DIR = join(HERE, 'honors')

const ledger = []
const add = (year, name, honor, source) =>
  ledger.push({ year, name: name.trim(), honor, source })

const srcOf = (file) =>
  readFileSync(join(WIKI, file), 'utf8').match(/<!-- source: (\S+) -->/)?.[1] ??
  `https://en.wikipedia.org/wiki/${file.replace('.wikitext', '')}`

/** True iff this line credits UNC (never NC State). */
const isUNC = (line) =>
  /North Carolina Tar Heels/.test(line) ||
  /\bNorth Carolina\b(?!\s+State)/.test(line.replace(/<ref[\s\S]*?<\/ref>/g, ''))

/** Pull a player name out of a wiki line: [[Link|Name]], [[Name]], {{sortname|A|B}}. */
const nameOf = (cell) => {
  const sn = cell.match(/\{\{sortname\|([^|}]+)\|([^|}]+)/)
  if (sn) return `${sn[1]} ${sn[2]}`
  const wl = cell.match(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/)
  if (wl) return wl[1]
  const plain = cell.match(/^\s*'*([A-Z][A-Za-zÀ-ÿ'’.\- ]+?)'*\s*$/)
  return plain?.[1] ?? null
}

// ── national trophies ────────────────────────────────────────────────────────
for (const [file, honor] of [
  ['lombardi-award.wikitext', 'Lombardi Award'],
  ['chuck-bednarik-award.wikitext', 'Chuck Bednarik Award'],
  ['bronko-nagurski-trophy.wikitext', 'Bronko Nagurski Trophy'],
  ['jim-thorpe-award.wikitext', 'Jim Thorpe Award'],
  ['outland-trophy.wikitext', 'Outland Trophy'],
  ['butkus-award.wikitext', 'Butkus Award'],
  ['maxwell-award.wikitext', 'Maxwell Award'],
  ['walter-camp-award.wikitext', 'Walter Camp Award'],
  ['biletnikoff-award.wikitext', 'Biletnikoff Award'],
  ['john-mackey-award.wikitext', 'John Mackey Award'],
  ['rimington-trophy.wikitext', 'Rimington Trophy'],
  ['doak-walker-award.wikitext', 'Doak Walker Award'],
  ['ted-hendricks-award.wikitext', 'Ted Hendricks Award'],
  ['davey-obrien-award.wikitext', "Davey O'Brien Award"],
  ['list-of-heisman-trophy-winners.wikitext', 'Heisman Trophy'],
]) {
  if (!existsSync(join(WIKI, file))) continue
  const src = srcOf(file)
  for (const line of readFileSync(join(WIKI, file), 'utf8').split('\n')) {
    if (!isUNC(line)) continue
    const ym = line.match(/\|\s*(19\d\d|20\d\d)\s*\|\|/) ?? line.match(/\b(19\d\d|20\d\d)\b/)
    if (!ym) continue
    const year = Number(ym[1])
    if (year < 1997 || year > 2025) continue
    // the winner cell is the one right after the year
    const cells = line.split('||')
    const name = cells.length > 1 ? nameOf(cells[1]) : null
    if (!name) continue
    add(year, name, `${honor} (${year})`, src)
  }
}

// ── first-team All-Americans (+ consensus / unanimous) ───────────────────────
for (let y = 1997; y <= 2025; y++) {
  const file = `${y}-college-football-all-america-team.wikitext`
  if (!existsSync(join(WIKI, file))) continue
  const src = srcOf(file)
  const text = readFileSync(join(WIKI, file), 'utf8')
  // The consensus/unanimous roll is a section; the per-position lists carry the
  // selector sets. A player is FIRST-team if a selector names them without a
  // "-2"/"-3" suffix (AP-1 / AFCA / FWAA / Walter Camp / TSN …).
  for (const line of text.split('\n')) {
    if (!line.startsWith('*')) continue
    if (!isUNC(line)) continue
    const name = nameOf(line)
    if (!name) continue
    const sel = line.match(/<small>\(([^)]*)\)<\/small>/)?.[1] ?? ''
    const selectors = sel.split(',').map((s) => s.trim()).filter(Boolean)
    const firstTeam = selectors.some((s) => !/-[23]\b/.test(s))
    if (!firstTeam) continue
    // Wikipedia bolds consensus selections; the page's own consensus roll is
    // the authority for "unanimous".
    const bold = /'''/.test(line)
    const label = bold ? 'Consensus All-American' : 'All-American'
    add(y, name, `${label} (${y})`, src)
  }
}

// ── 2025 All-ACC (the 2025 guide predates it) ────────────────────────────────
{
  const file = '2025-all-acc-football-team.wikitext'
  if (existsSync(join(WIKI, file))) {
    const src = srcOf(file)
    const text = readFileSync(join(WIKI, file), 'utf8')
    const sec = text.match(
      /===?\s*All[- ][Cc]onference [Tt]eams?\s*===?([\s\S]*?)(?:\n==[^=]|$)/,
    )?.[1]
    if (sec) {
      const cellText = (raw) =>
        raw
          .replace(/^[|!]+/, '')
          .replace(/^[^|]*\|(?![|])/, '')
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
      let level = null
      let carryTeam = null
      let carryLeft = 0
      let cur = null
      const rows = []
      for (const line of sec.split('\n')) {
        const t = line.trim()
        const tm = t.match(/'''\s*(First|Second|Third)[-\s]team\s*'''/i)
        if (tm) {
          rows.push({ marker: tm[1] })
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
      for (const r of rows) {
        if (r.marker) {
          level = r.marker[0].toUpperCase() + r.marker.slice(1).toLowerCase()
          carryLeft = 0
          continue
        }
        const cells = r.cells.filter((c) => !/colspan/.test(c))
        if (!cells.length || !level) continue
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
        if (school !== 'North Carolina' || !player) continue
        add(2025, player, `${level}-Team All-ACC (2025)`, src)
      }
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true })
ledger.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
writeFileSync(join(OUT_DIR, 'ledger-wiki.json'), JSON.stringify(ledger, null, 1))
const kinds = {}
for (const e of ledger) {
  const k = e.honor.replace(/\s*\(\d{4}\)/, '')
  kinds[k] = (kinds[k] ?? 0) + 1
}
console.log(`entries: ${ledger.length}`)
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]))
  console.log(' ', v, k)
for (const e of ledger) console.log(`   ${e.year} ${e.name} — ${e.honor}`)
