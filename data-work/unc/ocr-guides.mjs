// UNC: re-OCR each media guide's defensive-statistics PAGE with macOS Vision.
//
// Usage:  node data-work/unc/ocr-guides.mjs      (after a first parse-guides run)
// Output: data-work/unc/guide-ocr/<season>.tsv   (word-level geometry; gitignored)
//
// The Internet Archive scans ship ABBYY OCR of very uneven quality. On the 1996
// table it failed outright over the bottom half of the page: the numeric cells for
// 18 players — and the "UNC Totals" row that lets the table verify itself — were
// never recognised, so nothing downstream could recover them. A second, better OCR
// of the same page is the honest fix (the alternative is guessing at numbers that
// were never read).
//
// This does NOT replace the archive's OCR: parse-guides.mjs treats Vision as
// another candidate reading and keeps whichever one the checks favour — the same
// team-total reconciliation and Sports-Reference cross-check apply to both.
//
// Page images come from IA's own page endpoint. The leaf number is the djvu page
// index minus one (the scan's cover leaf is not a djvu page), which parse-guides
// records for each season.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const IMG = join(HERE, 'guide-img')
const OCR = join(HERE, 'guide-ocr')
mkdirSync(IMG, { recursive: true })
mkdirSync(OCR, { recursive: true })

const GUIDES = {
  1995: 1994,
  1996: 1995,
  1997: 1996,
  1998: 1997,
  1999: 1998,
  2000: 1999,
  2001: 2000,
}

for (const [guideYear, season] of Object.entries(GUIDES)) {
  const meta = join(HERE, 'guide', `${season}.json`)
  if (!existsSync(meta)) {
    console.log(`${season}: no parse yet — run parse-guides.mjs first`)
    continue
  }
  const { page } = JSON.parse(readFileSync(meta, 'utf8'))
  const leaf = page - 1
  const id = `carolinafootball${guideYear}unse`
  const jpg = join(IMG, `${season}.jpg`)

  if (!existsSync(jpg) || statSync(jpg).size < 50_000) {
    const url = `https://archive.org/download/${id}/page/n${leaf}_w1800.jpg`
    const res = await fetch(url)
    if (!res.ok) {
      console.log(`${season}: image fetch failed (${res.status})`)
      continue
    }
    writeFileSync(jpg, Buffer.from(await res.arrayBuffer()))
  }

  const tsv = join(OCR, `${season}.tsv`)
  const out = execFileSync('swift', [join(HERE, 'ocr-page.swift'), jpg], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString()
  writeFileSync(tsv, out)
  console.log(`${season}: leaf n${leaf} → ${out.trim().split('\n').length} words`)
}
