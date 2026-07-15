// UNC honors: parse the OFFICIAL media-guide sections (honors-src/, produced by
// extract-honors-guide.py) into honors/ledger-guide.json.
//
// Usage:  node data-work/unc/parse-honors-guide.mjs
//
// all-conference.txt — a year line, then one line per selection:
//     1996            (pre-2013 form: a single consolidated team)
//     Greg Ellis, defensive end (1st)
//     2015            (2013+ form: media AND coaches teams, separately)
//     Ryan Switzer, specialist (2nd media, 1st coaches)
//     Landon Turner, OG (1st media, 1st, coaches)
//   → the HIGHEST level across selectors wins (Switzer ⇒ First-Team), matching
//     the project convention used for every other school.
//   Award lines appear inside a year's block too:
//     Defensive Player of the Year – Marcus Jones
//     Rookie of the Year – Leon Johnson
//
// all-america.txt / national-awards.txt — the All-America selections and the
// national trophies. Only FIRST-team All-America is emitted (project-wide
// convention); the guide's own "Consensus"/"Unanimous" wording upgrades it.
//
// Output entries: { year, name, honor, source } — the same shape VT used, so
// attach-honors/verify-honors carry over unchanged.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'honors-src')
const OUT_DIR = join(HERE, 'honors')
const sources = JSON.parse(readFileSync(join(SRC, 'sources.json')))
const SOURCE = sources['2025-media-guide.pdf']

const ledger = []
const add = (year, name, honor) =>
  ledger.push({ year, name: name.trim(), honor, source: SOURCE })

const lines = (f) =>
  readFileSync(join(SRC, f), 'utf8')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())

// ── all-conference + conference awards ───────────────────────────────────────
{
  const RANK = { '1st': 1, '2nd': 2, '3rd': 3 }
  const LABEL = ['', 'First', 'Second', 'Third']
  // best level per (year, name)
  const best = new Map()
  let year = null
  for (const l of lines('all-conference.txt')) {
    const ym = l.match(/^(19|20)\d\d$/)
    if (ym) {
      year = Number(l)
      continue
    }
    if (!year || year < 1994) continue
    // Award line: "Defensive Player of the Year – Marcus Jones"
    const am = l.match(
      /^(Co-)?((?:Offensive |Defensive |Rookie |Freshman |Coach |Player)[A-Za-z ]*?(?:of the Year))\s*[–-]\s*(.+)$/i,
    )
    if (am) {
      const award = am[2].trim()
      if (/coach/i.test(award)) continue // not a player honor
      for (const who of am[3].split(/\s*(?:,| and )\s*/)) {
        if (!who || !/[a-z]/.test(who)) continue
        add(year, who, `ACC ${award} (${year})`)
      }
      continue
    }
    // Selection line: "Name, position (1st media, 2nd coaches)" / "(1st)"
    const sm = l.match(/^([^,(]+),\s*[^(]*\(([^)]*)\)\s*$/)
    if (!sm) continue
    const name = sm[1].trim()
    const levels = [...sm[2].matchAll(/(1st|2nd|3rd)/g)].map((m) => RANK[m[1]])
    if (levels.length === 0) continue
    const rank = Math.min(...levels)
    const key = `${year}:${name}`
    const prev = best.get(key)
    if (!prev || rank < prev) best.set(key, rank)
  }
  for (const [key, rank] of best) {
    const [y, name] = [Number(key.split(':')[0]), key.split(':').slice(1).join(':')]
    add(y, name, `${LABEL[rank]}-Team All-ACC (${y})`)
  }
}

// NOTE: neither the All-America section nor the National Awards page is parsed
// here — both are handled by parse-honors-wiki.mjs, and for good reasons:
//   • The guide's first-team AA roll is a dotted-leader list whose YEARS are
//     cut at the column edge ("Jonathan Cooper, Guard......" with no year), and
//     its per-player bio headings wrap across lines. Wikipedia's per-year
//     All-America articles are structured AND carry the consensus/unanimous
//     status the guide's roll doesn't.
//   • The guide's "National Awards" page lists a school's notable FINISHES,
//     not wins — its Heisman block names Justice, McCauley, Voight and Peppers,
//     none of whom won it — so parsing it would FABRICATE awards.
// The guide's AA roll is still used, as an independent CROSS-CHECK of the
// Wikipedia-derived list (see verify-honors.mjs).

mkdirSync(OUT_DIR, { recursive: true })
ledger.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
writeFileSync(
  join(OUT_DIR, 'ledger-guide.json'),
  JSON.stringify(ledger, null, 1),
)
const kinds = {}
for (const e of ledger) {
  const k = e.honor.replace(/\s*\(\d{4}\)/, '')
  kinds[k] = (kinds[k] ?? 0) + 1
}
console.log(`entries: ${ledger.length}`)
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]))
  console.log(' ', v, k)
