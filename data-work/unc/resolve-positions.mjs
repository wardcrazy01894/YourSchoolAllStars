// VT football: mechanical position resolution + research worklist.
//
// Usage:  node data-work/vt/resolve-positions.mjs
//
// Inputs: merged.json + crossval-report.json (+ positions-override.json once
// the research pass fills it). Emits:
//   positions-auto.json      — unambiguous mechanical calls with their basis:
//       wmt-fine  (already on the person from WMT stats/roster votes)
//       sr-def    (single fine code in SR defense-table votes)
//       sr-off    (single fine code in SR offense votes, NO defensive signal)
//   research-worklist.json   — above-floor persons still unresolved, ranked;
//       each with stat-profile hints + coarse-vote constraints for the
//       research agents. Below-floor unresolved persons are listed under
//       `dropBelowFloor` (they get trimmed at finalize, no research needed).
//
// positions-override.json (research output, human/agent-verified WITH
// citation URLs) has FINAL say; this script reports any override that
// contradicts a coarse vote (DB-voted player claimed DE, etc.).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const merged = JSON.parse(readFileSync(join(HERE, 'merged.json'))).players
const report = JSON.parse(readFileSync(join(HERE, 'crossval-report.json')))
const FLOOR = 3

const override = existsSync(join(HERE, 'positions-override.json'))
  ? JSON.parse(readFileSync(join(HERE, 'positions-override.json')))
  : {}

// Same guard as merge.mjs: an offensive code must never settle a DEFENDER's
// position — SR's defense table tags a converted player (or a special-teams
// tackler) with the offensive position they were listed at that year, so
// "single fine code in the SR defense votes" can be WR for a four-year
// safety. Offensive codes only win when the player has no defensive signal.
const OFF_FINE = new Set(['QB', 'RB', 'WR', 'TE'])
const DEF_FINE = new Set(['DE', 'DT', 'LB', 'CB', 'S'])
// "Real defender" test — a WR with one special-teams tackle is NOT a
// defender, but a safety with 55 tackles is. Thresholds keep the guard from
// pushing every gunner into the research worklist.
const isDefensiveSeason = (st) =>
  (st.tackles ?? 0) >= 10 ||
  (st.sacks ?? 0) >= 1 ||
  (st.tfl ?? 0) >= 2 ||
  (st.defInt ?? 0) >= 1 ||
  (st.pbu ?? 0) >= 2
const defProductionOf = (p) => p.seasons.some((s) => isDefensiveSeason(s.stats))

const auto = []
const worklist = []
const dropBelowFloor = []
const conflicts = []

const posByName = new Map(report.positions.map((p) => [p.name, p]))

for (const person of merged) {
  if (person.position) {
    auto.push({ name: person.name, position: person.position, basis: 'wmt-fine' })
    continue
  }
  const info = posByName.get(person.name)
  if (!info) continue
  const ov = override[person.name]
  if (ov) {
    // Coarse-vote consistency check: DB can only be CB/S, DL only DE/DT.
    const coarse = new Set([
      ...Object.keys(info.srDefVotes ?? {}),
      ...Object.keys(person.positionVotes ?? {}),
    ])
    const bad =
      (coarse.has('DB') && !['CB', 'S'].includes(ov.position)) ||
      (coarse.has('DL') && !['DE', 'DT'].includes(ov.position))
    if (bad)
      conflicts.push(`${person.name}: override ${ov.position} vs coarse votes ${[...coarse]}`)
    auto.push({
      name: person.name,
      position: ov.position,
      basis: 'override',
      source: ov.source,
    })
    continue
  }
  const dfine = Object.entries(info.srDefVotes ?? {}).filter(([c]) =>
    DEF_FINE.has(c),
  )
  const ofine = Object.entries(info.srOffVotes ?? {}).filter(([c]) =>
    OFF_FINE.has(c),
  )
  const hasDefSignal =
    defProductionOf(person) &&
    (Object.keys(info.srDefVotes ?? {}).length > 0 ||
      ['DL', 'DB'].some((c) => (person.positionVotes ?? {})[c]))
  if (dfine.length === 1) {
    auto.push({ name: person.name, position: dfine[0][0], basis: 'sr-def' })
  } else if (!hasDefSignal && ofine.length === 1) {
    auto.push({ name: person.name, position: ofine[0][0], basis: 'sr-off' })
  } else if (info.composite >= FLOOR) {
    worklist.push(info)
  } else {
    dropBelowFloor.push({ name: person.name, composite: info.composite })
  }
}

worklist.sort((a, b) => b.composite - a.composite)
writeFileSync(join(HERE, 'positions-auto.json'), JSON.stringify(auto, null, 1))
writeFileSync(
  join(HERE, 'research-worklist.json'),
  JSON.stringify({ worklist, dropBelowFloor }, null, 1),
)
console.log(
  `auto: ${auto.length} (wmt-fine ${auto.filter((a) => a.basis === 'wmt-fine').length}, sr-def ${auto.filter((a) => a.basis === 'sr-def').length}, sr-off ${auto.filter((a) => a.basis === 'sr-off').length}, override ${auto.filter((a) => a.basis === 'override').length})`,
)
console.log(`research worklist: ${worklist.length} | below-floor drops: ${dropBelowFloor.length}`)
if (conflicts.length) {
  console.log('OVERRIDE CONFLICTS:')
  for (const c of conflicts) console.log('  ' + c)
  process.exitCode = 1
}
