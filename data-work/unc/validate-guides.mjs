// UNC: prove the media-guide pipeline against a source it never touched.
//
// Usage:  node data-work/unc/validate-guides.mjs
//
// The 1994-1999 defensive numbers come from ONE source (the guides), so the usual
// cross-validation — compare two independent sources and investigate the deltas —
// has nothing to compare against. That is exactly the situation in which a subtly
// wrong parser ships: every internal check it runs is a check it defined itself.
//
// So the pipeline is run over a season it does NOT need: 2000. That season we
// already hold from the official archived TAS cume, fetched years apart from a
// different system and parsed by different code. The 2001 media guide prints the
// same season's final defensive statistics. Reading it with the guide pipeline and
// diffing the two is a genuine end-to-end test of the scan → OCR → geometry →
// column-mapping → name-resolution chain: if any link is broken, the numbers will
// not match a source that link never saw.
//
// A clean run here is the reason to trust 1994-1999, where no such check exists.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

const guide = JSON.parse(
  readFileSync(join(HERE, 'guide-resolved', '2000.json'), 'utf8'),
)
const cumeFile = join(HERE, 'gap', '2000.json')
if (!existsSync(cumeFile)) {
  console.error('no gap/2000.json — run the cume pipeline first')
  process.exit(1)
}
const cume = JSON.parse(readFileSync(cumeFile, 'utf8'))

const cumeBy = new Map()
for (const p of cume.players) cumeBy.set(norm(p.name), p)

const KEYS = ['tackles', 'tfl', 'sacks', 'defInt', 'pbu']
let compared = 0
let agree = 0
const diffs = []
const missing = []

for (const g of guide.players) {
  const c = cumeBy.get(norm(g.name))
  if (!c) {
    missing.push(g.name)
    continue
  }
  for (const k of KEYS) {
    const a = g.stats[k]
    const b = c.stats[k]
    if (a === null || a === undefined || b === undefined) continue
    compared++
    if (Math.abs(a - b) < 0.01) agree++
    else diffs.push(`${g.name} ${k}: guide ${a} vs cume ${b}`)
  }
}

console.log('VALIDATION — 2000 season: media guide vs official archived cume')
console.log(`  guide players: ${guide.players.length}`)
console.log(`  matched to cume: ${guide.players.length - missing.length}`)
console.log(`  stat values compared: ${compared}`)
console.log(
  `  agree: ${agree}  disagree: ${diffs.length}  (${compared ? Math.round((agree / compared) * 100) : 0}%)`,
)
if (missing.length)
  console.log(`  not found in cume (${missing.length}): ${missing.join(', ')}`)
for (const d of diffs) console.log(`  ✗ ${d}`)
if (!diffs.length && compared > 0)
  console.log(
    '\n  ✓ Every stat the guide pipeline produced matches the independent cume.',
  )
process.exit(diffs.length ? 1 : 0)
