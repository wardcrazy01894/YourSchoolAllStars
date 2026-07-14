// VT honors, stage 4a: parse the Wayback-archived OFFICIAL hokiesports pages
// (honors-src/) into a raw ledger. See PROGRESS.md — Wikipedia's per-year
// all-conference coverage is too spotty for VT, so the official site is the
// primary all-conference + award source for 1994–2015.
//
// Usage:  node data-work/vt/parse-honors-official.mjs
//
// Outputs honors/ledger-official.json entries:
//   { year, name, honor, source }   — honor uses the project string formats
//   (First-Team All-Big East (YYYY), All-American (YYYY), Big East Defensive
//   Player of the Year (YYYY), …). All-conference keeps the HIGHEST team per
//   player-year across selectors (ACSMA/COACHES); HM only when no team made.
//   All-Americans: FIRST-team by any selector on the official list →
//   "All-American (YYYY)" (consensus/unanimous upgraded later from the
//   per-year Wikipedia All-America pages by derive-honors.mjs).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'honors-src')
const OUT_DIR = join(HERE, 'honors')
const sources = JSON.parse(readFileSync(join(SRC, 'sources.json')))

const unescape = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&eacute;/gi, 'é')
    .replace(/&#233;/g, 'é')

const ledger = []
const add = (year, name, honor, source) =>
  ledger.push({ year, name: name.trim(), honor, source })

// ── all-conference + awards page ─────────────────────────────────────────────
{
  const file = 'awards-20160809.html'
  const src = sources[file]
  const raw = unescape(readFileSync(join(SRC, file), 'utf8'))
  // Split the page into <b>heading</b> → following-text segments.
  const parts = raw.split(/<b>/).slice(1)
  const segs = parts.map((p) => {
    const [head, ...rest] = p.split('</b>')
    return {
      head: head.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      body: rest
        .join('</b>')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }
  })

  // 1) Per-year all-conference teams. Headings look like
  //    "2004 - First Team:", "2012 (ACSMA) - Second Team:", or a bare
  //    continuation "Second Team:" / "Honorable Mention:" that inherits the
  //    year of the previous heading. Team text = "Name, pos; Name, pos; …"
  //    (runs until the next <b> heading).
  let curYear = null
  const teamOf = (label) =>
    /first/i.test(label)
      ? 1
      : /second/i.test(label)
        ? 2
        : /third/i.test(label)
          ? 3
          : /honorable/i.test(label)
            ? 'HM'
            : null
  // best (lowest) team level per `${year}:${name}`
  const best = new Map()
  for (const { head, body } of segs) {
    const m = head.match(
      /^(\d{4})(?:\s*\([A-Z]+\))?\s*-\s*(First|Second|Third)\s*[Tt]eam:|^(\d{4})(?:\s*\([A-Z]+\))?\s*-\s*Honorable Mention:/,
    )
    let team = null
    if (m) {
      curYear = Number(m[1] ?? m[3])
      team = teamOf(head)
    } else if (/^(First|Second|Third)\s*[Tt]eam:$|^Honorable Mention:$/.test(head)) {
      team = teamOf(head)
    } else {
      curYear = null
      continue
    }
    if (!curYear || curYear < 1994 || team === null) continue
    // "Name, pos; Name, pos & more; …" — split on ';'. Only the NAME is used
    // (positions come from the stats pipeline), so take the text before the
    // first comma and validate it looks like a name. This tolerates the two
    // shapes that a stricter "Name, pos$" regex silently dropped: a dual
    // position ("DeAngelo Hall, cb, pr") and the section's LAST entry, whose
    // body runs on into the next page block ("Michael Crawford, s
    // All-Southern Conference Virginia Tech was in…").
    for (const entry of body.split(';')) {
      const em = entry.match(
        /^\s*([A-ZÀ-Þ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-Za-zÀ-ÿ.'-]+){1,3}),/,
      )
      if (!em) continue
      const name = em[1].trim()
      // kickers/punters/linemen are recorded but filtered on attach
      const key = `${curYear}:${name}`
      const rank = team === 'HM' ? 9 : team
      const prev = best.get(key)
      if (!prev || rank < prev.rank) best.set(key, { rank, team })
    }
  }
  for (const [key, { team }] of best) {
    const [y, name] = [Number(key.split(':')[0]), key.split(':').slice(1).join(':')]
    const conf = y <= 2003 ? 'Big East' : 'ACC'
    const honor =
      team === 'HM'
        ? `All-${conf} Honorable Mention (${y})`
        : `${['', 'First', 'Second', 'Third'][team]}-Team All-${conf} (${y})`
    add(y, name, honor, src)
  }

  // 2) Individual awards. The page's award section is organized in
  //    <div class="fanguidehead">CONFERENCE</div> blocks ("Atlantic Coast
  //    Conference", "Big East Conference", "Southern Conference"); the
  //    identically-named all-conference TEAM blocks are prefixed "All-".
  //    Winner text = runs of "POS First Last (1999)" / "(Co-, 2000)" /
  //    "(1998, 1999)"; coach entries carry no POS prefix and don't match.
  const blocks = new Map()
  for (const part of raw.split('<div class="fanguidehead">').slice(1)) {
    const name = part.split('</div>')[0].trim()
    blocks.set(
      name,
      part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    )
  }
  const accBlock = blocks.get('Atlantic Coast Conference') ?? ''
  const beBlock = blocks.get('Big East Conference') ?? ''
  // Emitted awards; the BOUNDARY-only entries (emit: false) exist so their
  // winner runs never bleed into the preceding award's section.
  const AWARDS = [
    ['Player of the Year', true],
    ['Offensive Player of the Year', true],
    ['Defensive Player of the Year', true],
    ['Special Teams Player of the Year', true],
    ['Rookie of the Year', true],
    ['Offensive Rookie of the Year', true],
    ['Defensive Rookie of the Year', true],
    ['Outstanding Blocker (Jacobs Award)', false],
    ['Coach of the Year', false],
  ]
  const parseAwardBlock = (block, confLabel) => {
    // Winners look like: "QB Michael Vick (1999)" or "TB Lee Suggs (Co-, 2000)"
    // or "DE Corey Moore (1998, 1999)". Award name precedes its winner run.
    // Walk award headings longest-first so "Offensive Player of the Year"
    // isn't swallowed by "Player of the Year".
    const byName = new Map(AWARDS)
    const names = AWARDS.map((a) => a[0]).sort((a, b) => b.length - a.length)
    // Build index of award-heading positions.
    const marks = []
    for (const nm of names) {
      let idx = 0
      while ((idx = block.indexOf(nm, idx)) >= 0) {
        // skip if part of a longer award name already marked at same pos
        if (!marks.some((m) => idx >= m.i && idx < m.i + m.nm.length))
          marks.push({ i: idx, nm })
        idx += nm.length
      }
    }
    marks.sort((a, b) => a.i - b.i)
    for (let k = 0; k < marks.length; k++) {
      const { i, nm } = marks[k]
      if (!byName.get(nm)) continue // boundary-only heading (Jacobs, Coach)
      const end = k + 1 < marks.length ? marks[k + 1].i : block.length
      const body = block.slice(i + nm.length, end)
      for (const wm of body.matchAll(
        /\b[A-Z]{1,3}\s+([A-Za-zÀ-ÿ.'-]+(?:\s+[A-Za-zÀ-ÿ.'-]+){0,2})\s*\((Co-,\s*)?([\d,\s]+)\)/g,
      )) {
        const name = wm[1].trim()
        for (const ys of wm[3].split(',')) {
          const y = Number(ys.trim())
          if (y >= 1994 && y <= 2025)
            add(y, name, `${confLabel} ${nm} (${y})`, src)
        }
      }
    }
  }
  parseAwardBlock(accBlock, 'ACC')
  parseAwardBlock(beBlock, 'Big East')
}

// ── All-Americans page (official list, table) ────────────────────────────────
{
  const file = 'allamericans-20151210.html'
  const src = sources[file]
  const raw = unescape(readFileSync(join(SRC, file), 'utf8'))
  // Table rows: year | name (the cell's <sup> marks C = Consensus,
  // U = Unanimous — the official list's own legend) | team (1st/2nd/3rd) |
  // selectors | pos
  for (const tr of raw.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const rawCells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
      (c) => c[1],
    )
    if (rawCells.length < 5) continue
    const clean = (s) =>
      s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const year = Number(clean(rawCells[0]))
    if (!(year >= 1994 && year <= 2025)) continue
    const sup = rawCells[1].match(/<sup>\s*([CU])\s*<\/sup>/i)?.[1] ?? ''
    const name = clean(rawCells[1].replace(/<sup>[\s\S]*?<\/sup>/g, ' '))
    const team = clean(rawCells[2])
    if (/^1st/i.test(team)) {
      const label =
        sup.toUpperCase() === 'U'
          ? 'Unanimous All-American'
          : sup.toUpperCase() === 'C'
            ? 'Consensus All-American'
            : 'All-American'
      add(year, name, `${label} (${year})`, src)
    }
    // 2nd/3rd-team-only selections are intentionally NOT emitted — the
    // shipped datasets' convention reserves "All-American" for first-team.
  }
}

mkdirSync(OUT_DIR, { recursive: true })
ledger.sort((a, b) => a.year - b.year || a.name.localeCompare(b.name))
writeFileSync(
  join(OUT_DIR, 'ledger-official.json'),
  JSON.stringify(ledger, null, 1),
)
const kinds = {}
for (const e of ledger) {
  const k = e.honor.replace(/\(\d{4}\)/, '')
  kinds[k] = (kinds[k] ?? 0) + 1
}
console.log(`entries: ${ledger.length}`)
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]))
  console.log(' ', v, k)
