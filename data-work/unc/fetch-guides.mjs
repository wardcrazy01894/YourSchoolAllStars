// UNC: download the OFFICIAL football media guides (Internet Archive, scanned by
// UNC Libraries, collection `ncunc`) as layout-preserving OCR XML.
//
// Usage:  node data-work/unc/fetch-guides.mjs
// Output: data-work/unc/guide-xml/carolinafootball<YEAR>unse.xml   (gitignored)
//
// WHY THIS EXISTS — the 1994-99 defense problem
// ---------------------------------------------
// No structured database publishes UNC's per-player DEFENSE before 2000: SR's
// tackle table starts 2005, cfbstats 2005, CFBD ~2002, and the archived official
// site has no cume page before 2000. The root cause is that the NCAA did not
// centrally compile individual defensive statistics until ~2000 — tackles/sacks
// were kept by each school's SID and published in ONE place: the school's own
// printed media guide.
//
// Those guides ARE digitized. NOTE there are TWO different IA item runs and only
// one of them is real:
//   * `north-carolina-football-<year>-media-guide`  → COVER IMAGE ONLY (a decoy —
//     0-7 files, no PDF; this is the run that made pre-2000 defense look
//     unobtainable)
//   * `carolinafootball<year>unse`                  → the ACTUAL full scan (PDF +
//     OCR), collection `ncunc`, open access. THIS is the one.
//
// A guide published in year N contains the FINAL DEFENSIVE STATISTICS for season
// N-1 (and the roster for season N). So guides 1995…2000 cover seasons 1994…1999
// — exactly the gap. The 2001 guide (season 2000) is fetched too: 2000 is a season
// we ALREADY have from the official TAS cume, so it is the validation control that
// proves the parser and the column mapping against an independent source
// (validate-guides.mjs). The 1994 guide is fetched for its roster (season 1994's
// stat table prints surnames only).
//
// We take `_djvu.xml`, NOT `_djvu.txt`: the flowed text is COLUMN-MAJOR and RAGGED
// (OCR silently drops cells), so aligning a name list against a number list by
// position would attribute real stats to the WRONG player — a fabrication. The XML
// carries per-word bounding boxes, so rows and columns can be rebuilt
// geometrically and every row can be checksummed. See parse-guides.mjs.

import { existsSync, mkdirSync, statSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'guide-xml')

// guide year → the season whose final stats it prints (guide N ⇒ season N-1).
// 1994: roster only. 2001: the validation control (season 2000).
const GUIDES = [1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001]

mkdirSync(OUT, { recursive: true })

for (const g of GUIDES) {
  const id = `carolinafootball${g}unse`
  const dest = join(OUT, `${id}.xml`)
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`${g}: cached (${(statSync(dest).size / 1e6).toFixed(1)} MB)`)
    continue
  }
  const url = `https://archive.org/download/${id}/${id}_djvu.xml`
  process.stdout.write(`${g}: downloading… `)
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`FAILED ${res.status}`)
    continue
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`)
}
