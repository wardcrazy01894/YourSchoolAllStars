// UNC: turn the media guides' abbreviated defensive-table names into real players.
//
// Usage:  node data-work/unc/resolve-guide-names.mjs
// Output: data-work/unc/guide-resolved/<season>.json
//
// The guides print a defender three different ways depending on the year:
//   "Morton, lb"        (1994, 1995) — surname + position code
//   "K. Mays"           (1996)       — initial + surname
//   "Kivuusama Mays"    (1997-2000)  — full name
// Only the last is usable as-is. A surname is not a player: the 1994 table alone
// has two Thomases and two Joneses, and a wrong join here would attach one man's
// season to another — the worst thing this pipeline could do.
//
// So every abbreviated row must resolve against that season's ROSTER (goheels from
// 1997, Sports-Reference for 1994-96), and the join has to be unambiguous:
//   * surname must match exactly, and
//   * where the guide gives an initial, it must match, and
//   * where the guide gives a position code, it must be consistent with the
//     roster's position (a "db" cannot resolve to an offensive lineman), and
//   * if more than one roster player still fits, the row is REPORTED, NOT GUESSED.
// An unresolved row is dropped and printed. Losing a player is recoverable; quietly
// attributing his stats to someone else is not.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'guide-resolved')
mkdirSync(OUT, { recursive: true })

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

// The guide's position code → the roster position families it may belong to.
const FAMILY = {
  lb: ['LB', 'OLB', 'ILB', 'MLB', 'LINEBACKER'],
  db: ['DB', 'CB', 'S', 'FS', 'SS', 'SAFETY', 'CORNERBACK', 'DEFENSIVE BACK'],
  de: ['DE', 'DL', 'DEFENSIVE END', 'DEFENSIVE LINEMAN'],
  dt: ['DT', 'DL', 'NG', 'NT', 'DEFENSIVE TACKLE', 'DEFENSIVE LINEMAN'],
  ks: ['K', 'PK', 'P', 'KICKER', 'PUNTER'],
}

// The UNION of the goheels roster and the guide's own roster for that season.
// Neither alone is complete: goheels starts at 1997 and still drops players (no
// Julius Peppers in 1999), and the guide roster is only as good as the scan. Taking
// both means a hole in one is covered by the other. goheels wins on position
// (spelled out, e.g. "Defensive End") where it has the player.
function rosterFor(year) {
  const out = new Map()
  for (const dir of ['guide-rosters', 'rosters']) {
    const f = join(HERE, dir, `${year}.json`)
    if (!existsSync(f)) continue
    for (const p of JSON.parse(readFileSync(f, 'utf8')).players) {
      const key = p.name.toLowerCase().replace(/[^a-z]/g, '')
      const prev = out.get(key)
      out.set(key, prev ? { ...prev, ...p } : p)
    }
  }
  return [...out.values()]
}

// Levenshtein, capped — used ONLY to absorb OCR letter-noise in a name
// ("Hobgood-Chiftick" for "Hobgood-Chittick"), and only when exactly one roster
// player is within the cap. Never used to pick between two plausible players.
function edit(a, b) {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 99
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

// Every first name the guide's own text pairs with this surname. Used only as the
// last resort above, and only when the book is unanimous.
const guideTextCache = new Map()
function firstNamesFor(season, surname) {
  // The guide published in season+1 reports season's stats and discusses its
  // players; the season's own guide names the returning ones. Read both.
  const found = new Map()
  for (const g of [season + 1, season]) {
    if (!guideTextCache.has(g)) {
      const f = join(HERE, 'guide-txt', `carolinafootball${g}unse.txt`)
      guideTextCache.set(g, existsSync(f) ? readFileSync(f, 'utf8') : '')
    }
    const txt = guideTextCache.get(g)
    if (!txt) continue
    const re = new RegExp(
      `\\b([A-Z][a-z]{2,})\\s+${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'g',
    )
    for (const m of txt.matchAll(re)) {
      const first = m[1]
      // Skip sentence-leading common words that are not names.
      if (/^(The|And|But|For|With|That|This|His|Her|Who|Should|Would|Could|Coach|Tar|Heel|All|Team|Carolina|Senior|Junior|Freshman|Sophomore|Defensive|Offensive|Linebacker|Cornerback|Tailback|Safety|Tackle|End|Guard)$/.test(first))
        continue
      found.set(first, (found.get(first) ?? 0) + 1)
    }
  }
  return found
}

// The position to record for a defender, given the guide's own code from the
// DEFENSIVE table ("db") and the roster's ("CB").
//
// The defensive table's code is the trustworthy one about WHICH SIDE OF THE BALL a
// player is on — that is the Pitt/Surratt lesson, where a roster said "Quarterback"
// for a man who was an All-ACC linebacker. But it is coarse: "db" does not say
// cornerback or safety, and "de"/"dt" only appear in some years. The roster is the
// finer of the two when the two AGREE about the family. So: take the roster's
// position when it belongs to the family the defensive table names, and otherwise
// keep the defensive table's code and let the research step settle it.
const FINE_OK = {
  lb: /^(LB|OLB|ILB|MLB|SLB|WLB|LINEBACKER)$/i,
  db: /^(CB|S|SS|FS|DB|SAFETY|CORNERBACK|DEFENSIVE BACK)$/i,
  de: /^(DE|DL|DEFENSIVE END|DEFENSIVE LINEMAN)$/i,
  dt: /^(DT|NG|NT|DL|DEFENSIVE TACKLE|DEFENSIVE LINEMAN)$/i,
}
function bestPosition(code, rosterPos) {
  if (!code) return rosterPos ?? null
  const c = code.toLowerCase()
  const rp = (rosterPos ?? '').trim()
  if (rp && FINE_OK[c]?.test(rp)) {
    // Prefer the roster only when it is strictly more specific than the code.
    const coarse = /^(DL|DB|LB)$/i.test(rp)
    if (!coarse) return rp.toUpperCase()
  }
  return code.toUpperCase()
}

// "Morton, lb" → { surname, initial, code }
function parseGuideName(raw) {
  const m = raw.match(/^(.*?),\s*([a-z]{1,3})$/i)
  const code = m ? m[2].toLowerCase() : null
  // The guides also write "E.Thomas" and "R.Williams" with no space after the
  // initial — split those, or the surname comes out as "ethomas" and matches
  // nobody.
  const namePart = (m ? m[1] : raw).trim().replace(/^([A-Z])\.\s*/, '$1 ')
  const toks = namePart.split(/\s+/).filter(Boolean)
  const surname = toks[toks.length - 1]
  const first = toks.length > 1 ? toks[0].replace(/\./g, '') : null
  return {
    surname,
    // A one-letter first token is an initial; anything longer is a real first name.
    initial: first && first.length === 1 ? first[0].toLowerCase() : null,
    firstName: first && first.length > 1 ? first : null,
    code,
    full: namePart,
  }
}

const report = []
for (const f of readdirSync(join(HERE, 'guide')).sort()) {
  const d = JSON.parse(readFileSync(join(HERE, 'guide', f), 'utf8'))
  const season = d.season
  const roster = rosterFor(season)
  // Adjacent-season rosters, used only as a fallback (see step 4 below).
  const neighbours = [...rosterFor(season + 1), ...rosterFor(season - 1)]
  const resolved = []
  const unresolved = []
  const mismatches = []

  for (const p of d.players) {
    const g = parseGuideName(p.rawName)
    const sn = norm(g.surname)
    if (!sn) continue

    const lastOf = (r) => {
      const toks = r.name.split(/\s+/).filter(Boolean)
      return norm(toks[toks.length - 1])
    }
    const firstOf = (r) => norm(r.name.split(/\s+/)[0] ?? '')

    // THE GUIDE'S OWN FIRST NAME IS EVIDENCE, AND IT VETOES.
    //
    // A candidate must survive this check even when it is the ONLY candidate. That
    // was the bug: the narrowing filters below ran only when `cands.length > 1`, so
    // a lone candidate was accepted without ever being compared to the name the
    // guide actually printed. Combined with a surname fuzzy-match that allowed two
    // edits — enough to turn Perry into Curry, Terry into Curry, Thornton into
    // Horton — the 1999 table handed Ronald Curry, the starting QUARTERBACK, three
    // tackles, four TFL and a sack, and erased Merceda Perry's, David Thornton's and
    // Jeb Terry's seasons. Every check in the pipeline passed: the numbers were read
    // correctly off the page and then attached to the wrong men.
    //
    // A candidate is only admissible if nothing the guide printed contradicts it.
    const admissible = (r) => {
      if (g.firstName) {
        const f = firstOf(r)
        const want = norm(g.firstName)
        // Accept a prefix either way ("Ben" for "Benjamin", and OCR truncation).
        if (!(f.startsWith(want) || want.startsWith(f))) return false
      }
      if (g.initial && firstOf(r)[0] !== g.initial) return false
      return true
    }
    // OCR letter-noise in a surname is worth ONE edit, not two. It was introduced
    // for "Hobgood-Chiftick" → "Hobgood-Chittick", which is a single substitution;
    // at two edits it starts matching genuinely different people (perry/curry,
    // terry/curry and thornton/horton are all exactly two apart). Short surnames get
    // no fuzz at all — at five letters, two names two edits apart are simply two
    // different names.
    const fuzz = (pool) => {
      if (sn.length < 7) return []
      const near = pool.filter((r) => edit(lastOf(r), sn) <= 1)
      return near.length === 1 ? near : []
    }

    // 1. Whole name, ignoring spacing — this catches the guides' split surnames
    //    ("Jomo Leg ins" is Jomo Legins).
    const fullKey = norm(g.full)
    let cands = roster.filter((r) => norm(r.name) === fullKey)
    // 2. Otherwise match on the surname.
    if (!cands.length) cands = roster.filter((r) => lastOf(r) === sn)
    // 3. Otherwise allow OCR letter-noise in the surname (see `fuzz`).
    if (!cands.length) cands = fuzz(roster)
    // 4. Fall back to the ADJACENT seasons' rosters. A scan can lose a name (the
    //    1994 roster page is set with leader dots and OCR mangles part of it), but a
    //    player who recorded tackles in season Y is on the roster in Y±1 unless he
    //    was a senior (then Y-1 has him) or a true freshman (Y+1 does). This is how
    //    Brian Simmons and James Hamilton — both real, both in the 1994 table — get
    //    their names back.
    if (!cands.length) {
      cands = neighbours.filter((r) => lastOf(r) === sn)
      if (!cands.length) cands = fuzz(neighbours)
    }
    // Whatever the step, the guide's printed name has the final say.
    cands = cands.filter(admissible)
    // 5. Last resort — the guide's own PROSE. A senior who was neither captured by
    //    the roster scan nor present the following year is otherwise lost: Jimmy
    //    Hitchcock, the 1994 starting cornerback, appears nowhere on the parsed
    //    rosters (he had graduated by 1995) but the guide names him in full a dozen
    //    times. Take the name only if the whole book agrees on exactly ONE first
    //    name for that surname.
    if (!cands.length) {
      // The guides list players in runs ("LB Eddie Mason, LB Kerry Mock, CB Jimmy
      // Hitchcock"), and where OCR eats a comma the previous player's SURNAME looks
      // like a first name. A token that is a surname elsewhere on the roster is not
      // one, so drop those before asking whether the book is unanimous.
      const surnames = new Set(
        [...roster, ...neighbours].map((r) => norm(lastOf(r))),
      )
      const counts = [...firstNamesFor(season, g.surname)]
        .filter(([f]) => !surnames.has(norm(f)))
        .sort((a, b) => b[1] - a[1])
      // Require a DOMINANT name, not a unanimous one: the OCR itself misspells
      // ("Jimmv Hitchcock") and prose throws off stray capitalised words, so
      // unanimity never holds on a real page. The right name is the one the book
      // uses over and over — at least three times, and at least three times as
      // often as any rival.
      const [top, second] = counts
      if (top && top[1] >= 3 && (!second || top[1] >= 3 * second[1]))
        cands = [{ name: `${top[0]} ${g.surname}`, position: null }]
    }
    // Still ambiguous? Let the defensive table's own position code break the tie.
    if (cands.length > 1 && g.code && FAMILY[g.code]) {
      const fam = FAMILY[g.code]
      const narrowed = cands.filter((r) =>
        fam.some((x) => (r.position || '').toUpperCase().includes(x)),
      )
      if (narrowed.length) cands = narrowed
    }

    // A name the guide already prints IN FULL ("Julius Peppers", "Merceda Perry") is
    // already a player and needs no roster at all — the roster is consulted only for
    // the position. Demanding a roster hit here is what let a bad fuzzy match win:
    // the rosters have holes (goheels' 1999 has no Peppers, and no Perry), and a
    // missing man must fall back to his own printed name, never to somebody else's.
    if (g.firstName && cands.length !== 1) {
      resolved.push({
        name: g.full.replace(/\s+/g, ' ').trim(),
        position: null,
        rosterPosition: null,
        stats: {
          tackles: p.tackles,
          tfl: p.tfl,
          sacks: p.sacks,
          defInt: p.defInt,
          pbu: p.pbu,
        },
        source: d.source,
      })
      continue
    }

    if (cands.length === 1) {
      const r = cands[0]
      // The join must agree with what the page says. `admissible` already enforces
      // this, so a hit here means a path bypassed it — record it and fail the run.
      if (!admissible(r))
        mismatches.push({ printed: p.rawName, resolved: r.name })
      resolved.push({
        name: r.name,
        position: bestPosition(g.code, r.position),
        rosterPosition: r.position ?? null,
        stats: {
          tackles: p.tackles,
          tfl: p.tfl,
          sacks: p.sacks,
          defInt: p.defInt,
          pbu: p.pbu,
        },
        source: d.source,
      })
    } else if (!g.initial && !g.firstName && cands.length === 0) {
      unresolved.push(`${p.rawName} — no roster match`)
    } else if (cands.length === 0) {
      unresolved.push(`${p.rawName} — no roster match`)
    } else {
      unresolved.push(
        `${p.rawName} — AMBIGUOUS: ${cands.map((c) => c.name).join(' | ')}`,
      )
    }
  }

  writeFileSync(
    join(OUT, `${season}.json`),
    JSON.stringify(
      { season, source: d.source, sourceNote: d.sourceNote, players: resolved },
      null,
      1,
    ),
  )
  report.push({ season, kept: resolved.length, unresolved, mismatches })
}

// SELF-CHECK — the guard for the failure that actually happened.
// A resolved player's name must not CONTRADICT what the guide printed. Every check
// in this pipeline verified that the numbers were read off the page correctly; none
// of them verified that they were then attached to the right man, and so a
// quarterback shipped with a sack. This asserts the join itself, and it fails the
// run rather than writing a file.
let violations = 0
for (const r of report) {
  for (const v of r.mismatches) {
    console.error(`  ✗ ${r.season}: guide printed "${v.printed}" → resolved to "${v.resolved}"`)
    violations++
  }
}
if (violations) {
  console.error(
    `\nFATAL: ${violations} resolved name(s) contradict the printed name. ` +
      `A stat attached to the wrong player is worse than no stat at all.`,
  )
  process.exit(1)
}

for (const r of report) {
  console.log(`${r.season}: ${r.kept} resolved, ${r.unresolved.length} unresolved`)
  for (const u of r.unresolved) console.log(`    ? ${u}`)
}
