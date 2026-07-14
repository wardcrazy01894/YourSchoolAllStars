// VT football: assemble the final dataset draft from merged.json +
// positions-auto.json (+ positions-override.json from the research pass).
//
// Usage:  node data-work/vt/build-dataset.mjs [--out <path>]
//
// Steps (mirrors the documented curation recipe):
//   1. position per person: auto/override map; persons without a resolved
//      fine position, EXCLUDE'd persons, and persons whose best composite at
//      their own position is below the floor are dropped (reported).
//   2. row repairs (REPAIRS table below — each verified vs SR, cited).
//   3. season-row cleanup: drop rows with no nonzero stat (roster-only
//      artifacts), zero-strip stats EXCEPT QB rushYds/rushTD (guard requires
//      them defined; 0 is meaningful), drop games bookkeeping.
//   4. QB rushing line on every QB season.
//   5. ids: slugified name, -<firstYear> suffix on collision.
//   6. redshirtYears: interior tenure gaps (report any person needing > 2 —
//      the guard treats that as a false-merge signal).
//   7. per-window, per-side Hall's-condition coverage report over the
//      1994+ rolling wheel (the CI guard re-checks this exactly).
//
// Output: data-work/vt/vt-football.draft.json — becomes
// src/data/vt-football.json once honors are attached (attach-honors step).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const outIdx = process.argv.indexOf('--out')
const OUT =
  outIdx >= 0 ? process.argv[outIdx + 1] : join(HERE, 'vt-football.draft.json')

const merged = JSON.parse(readFileSync(join(HERE, 'merged.json'))).players
const auto = JSON.parse(readFileSync(join(HERE, 'positions-auto.json')))
const posByName = new Map(auto.map((a) => [a.name, a]))

const FLOOR = 3

// Row repairs, each verified against the SR season page cited here.
// (ours vs SR delta triage: see crossval-report.json + PROGRESS.md.)
const REPAIRS = [
  {
    name: 'Braxton Burmeister',
    year: 2021,
    fix: { recTD: 1 }, // WMT credited 2 rec TD on 1 catch — impossible; SR: 1
    source:
      'http://web.archive.org/web/2024/https://www.sports-reference.com/cfb/schools/virginia-tech/2021.html',
  },
]

const TERMS = {
  QB: [['passYds',3500,18,1],['passTD',35,16,1],['rushYds',700,5,1],['rushTD',10,3,1],['passInt',10,6,-1]],
  RB: [['rushYds',1500,20,1],['rushTD',18,12,1],['rec',35,4,1],['recYds',400,4,1],['recTD',4,2,1]],
  WR: [['rec',70,14,1],['recYds',1100,20,1],['recTD',11,10,1],['rushYds',150,1,1]],
  TE: [['rec',50,16,1],['recYds',650,18,1],['recTD',7,10,1]],
  DE: [['sacks',11,18,1],['tfl',18,12,1],['tackles',55,6,1],['ff',4,4,1],['defInt',2,2,1]],
  DT: [['sacks',7,16,1],['tfl',13,12,1],['tackles',50,10,1],['ff',3,4,1]],
  LB: [['tackles',120,16,1],['tfl',15,10,1],['sacks',6,8,1],['defInt',3,5,1],['pbu',6,3,1],['ff',3,3,1]],
  CB: [['defInt',5,16,1],['pbu',14,14,1],['tackles',55,8,1],['tfl',4,3,1],['ff',2,3,1]],
  S: [['tackles',90,14,1],['defInt',4,12,1],['pbu',9,8,1],['tfl',7,5,1],['ff',3,3,1]],
}
const composite = (pos, st) =>
  (TERMS[pos] ?? []).reduce(
    (c, [k, ref, w, sg]) => c + ((st[k] ?? 0) / ref) * w * sg,
    0,
  )

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const dropped = { noPosition: [], excluded: [], belowFloor: [], zeroRows: 0 }
const players = []

for (const per of merged) {
  const call = posByName.get(per.name)
  if (!call) {
    dropped.noPosition.push(per.name)
    continue
  }
  if (call.position === 'EXCLUDE') {
    dropped.excluded.push(per.name)
    continue
  }
  if (!call.position) {
    dropped.noPosition.push(per.name)
    continue
  }
  const position = call.position

  const seasons = []
  for (const s of per.seasons) {
    const stats = {}
    // Zero-strip; drop NEGATIVE values except a QB's net rushYds (the only
    // negative the guard allows — a CB's -7-yard end-around or a QB's -9
    // receiving yards are real lines, but omission beats fabricating a 0).
    for (const [k, v] of Object.entries(s.stats))
      if (v !== 0 && (v > 0 || (position === 'QB' && k === 'rushYds')))
        stats[k] = v
    const rep = REPAIRS.find((r) => r.name === per.name && r.year === s.year)
    let source = s.source
    if (rep) {
      Object.assign(stats, rep.fix)
      source = rep.source
    }
    if (position === 'QB') {
      stats.rushYds ??= 0
      stats.rushTD ??= 0
    }
    if (Object.keys(stats).length === 0) {
      dropped.zeroRows++
      continue
    }
    seasons.push({ year: s.year, stats, honors: [], source })
  }
  if (seasons.length === 0) {
    dropped.belowFloor.push(`${per.name} (no nonzero rows)`)
    continue
  }
  const best = Math.max(...seasons.map((s) => composite(position, s.stats)))
  if (best < FLOOR) {
    dropped.belowFloor.push(`${per.name} (${position} ${best.toFixed(1)})`)
    continue
  }
  const firstYear = seasons[0].year
  const lastYear = seasons.at(-1).year
  const present = new Set(seasons.map((s) => s.year))
  const redshirtYears = []
  for (let y = firstYear + 1; y < lastYear; y++)
    if (!present.has(y)) redshirtYears.push(y)
  const p = {
    id: slugify(per.name),
    name: per.name,
    position,
    firstYear,
    lastYear,
    seasons,
  }
  if (redshirtYears.length) p.redshirtYears = redshirtYears
  // Position citations live in positions-override.json (committed with the
  // pipeline), not in the shipped dataset.
  players.push(p)
}

// id de-collision
const byId = new Map()
for (const p of players) byId.set(p.id, (byId.get(p.id) ?? 0) + 1)
for (const p of players)
  if (byId.get(p.id) > 1) p.id = `${p.id}-${p.firstYear}`

players.sort((a, b) => a.firstYear - b.firstYear || a.id.localeCompare(b.id))

// reports
const over = players.filter((p) => (p.redshirtYears ?? []).length > 2)
const span = players.filter((p) => p.lastYear - p.firstYear > 5)

// per-window coverage (counts per position; the CI guard does full Hall's)
const maxYear = Math.max(...players.map((p) => p.lastYear))
const problems = []
for (let start = 1994; start + 3 <= maxYear; start++) {
  const w = { start, end: start + 3 }
  const counts = {}
  for (const p of players)
    if (p.seasons.some((s) => s.year >= w.start && s.year <= w.end))
      counts[p.position] = (counts[p.position] ?? 0) + 1
  for (const pos of Object.keys(TERMS))
    if (!counts[pos]) problems.push(`${w.start}-${w.end}: no ${pos}`)
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      school: 'Virginia Tech',
      sport: 'football',
      _provisional: false,
      _note:
        'Real per-season data, 1994-2025. 1994-2012 from the Wayback-archived official hokiesports.com per-year season cumes (full offense AND defense every year, incl. pre-1997 tackles/TFL/sacks; each row cites its snapshot; every parsed column validated against the printed Total row); 2013-2025 from the WMT Digital API behind hokiesports.com (official NCAA-fed season totals; rows cite the hokiesports stats page). Cross-validated player-by-player against Sports-Reference season pages; repaired rows cite SR. Positions from WMT rosters/stats (2002+), SR fine position codes, or per-player cited research (citations in data-work/vt/positions-override.json); a handful of above-floor players whose exact position no citable source pins down were dropped rather than guessed. OL/K/P/LS are out of scope. QB rushYds is the NCAA net (sacks count against rushing). redshirtYears marks tenure years with no ratable season row. honors[] is per-season and derived programmatically (data-work/vt/parse-honors-*.mjs): all-conference + conference individual awards + first-team All-Americans (with the official list\'s own Consensus/Unanimous markers) from the Wayback-archived OFFICIAL hokiesports awards.html / allamericans.html for 1994-2015, Wikipedia per-year All-ACC for 2016-2025 and the national hardware (Corey Moore\'s Lombardi + Nagurski); all-conference keeps the HIGHEST team level across selectors, and only FIRST-team All-America selections are recorded (the same convention as the other schools). verify-honors.mjs re-derives the shipped strings from the source ledgers: zero phantoms, zero omissions.',
      players,
    },
    null,
    1,
  ),
)
console.log(
  `players: ${players.length} | dropped: ${dropped.noPosition.length} no-position, ${dropped.excluded.length} excluded, ${dropped.belowFloor.length} below-floor, ${dropped.zeroRows} zero rows`,
)
if (over.length)
  console.log('REDSHIRT>2 (false-merge check):', over.map((p) => p.id).join(', '))
if (span.length)
  console.log('SPAN>5 (false-merge check):', span.map((p) => p.id).join(', '))
if (problems.length) {
  console.log('WINDOW COVERAGE GAPS:')
  for (const g of problems) console.log('  ' + g)
}
console.log(
  'unresolved above-floor still pending research:',
  dropped.noPosition.length ? '(see list)' : 0,
)
