// UNC: parse the FINAL DEFENSIVE STATISTICS table out of each official media
// guide (see fetch-guides.mjs for why these are the only source for 1994-99).
//
// Usage:  node data-work/unc/parse-guides.mjs
// Output: data-work/unc/guide/<season>.json
//
// GEOMETRY, NOT FLOWED TEXT
// -------------------------
// The `_djvu.txt` rendering of these pages is column-major and RAGGED: OCR drops
// individual cells, so the Nth number in a column does not belong to the Nth
// player. Zipping those lists would silently move a real player's stats onto
// someone else — fabrication. So we work from `_djvu.xml`, which carries a
// bounding box per word, and rebuild the table geometrically: cluster words into
// rows, read the header to learn each column's position, then assign every cell to
// the column it physically sits under. When OCR drops a cell (it does), that
// leaves a HOLE, which is correct — a positional read would instead shift every
// later value one column left.
//
// WHY IT TRIES SEVERAL INTERPRETATIONS
// ------------------------------------
// These are photographs of seven different physical books, and each scan is broken
// in its own way:
//   * the 1999 table's baseline DRIFTS 30px from the left edge to the right (a
//     bound-book curve), which splits its header row in two;
//   * the 2000 table's page is ROTATED — its columns come out as rows;
//   * the other scans are level, and "correcting" them with a fitted slope makes
//     things worse (the least-squares fit is polluted by headlines and captions).
// No single set of assumptions reads all seven. So instead of hand-tuning per
// book — which is where a parser starts quietly inventing numbers — this tries
// each plausible interpretation (rotated or not × row-grouping mode × de-skewed or
// not) and SCORES the result against the page's own arithmetic: every row must
// satisfy T + A = Hit, and the rows must sum to the printed TEAM TOTAL. The
// interpretation the data confirms is the one we keep. A table that no
// interpretation can reconcile is reported as unverified rather than used.
//
// COLUMNS WE TAKE — and the one we refuse
// ---------------------------------------
// Taken (unambiguous in every printing): Hit (total tackles, checked against
// T+A), TFL-Yds, QB-Yds/SACKS (sacks), Int., PBU.
// REFUSED: forced fumbles. The 1997/1998 printings carry BOTH a `CF` column (with
// decimals — 2.0, 5.0) AND an `FF` column, and their team totals differ (UNC 12
// vs 12, opponents 14 vs 16), so they are two different stats and nothing tells us
// which one is "forced fumbles". Same for the 1994/1995 printings' fused `DP-PBU`
// column: two numbers in one cell and no way to tell which half is PBU, so those
// two seasons carry no `pbu`.
// A missing stat is a known hole. A guessed stat is a lie. We take the hole.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'guide')

// guide year → season it reports. 2000 is the VALIDATION CONTROL: we already have
// that season from the official cume, so validate-guides.mjs diffs the two and
// proves this whole parser against an independent source.
const GUIDES = {
  1995: 1994,
  1996: 1995,
  1997: 1996,
  1998: 1997,
  1999: 1998,
  2000: 1999,
  2001: 2000,
}

const TEAM_ROWS =
  /^(north\s*carolina|carolina|unc|opponents?|totals?|opp)\b/i

// The header vocabulary is CLOSED. Every column these printings use is listed —
// the ones we take, and the ones we register ONLY so their values have somewhere
// to land and be discarded. Registering the unwanted columns is essential, not
// tidy: without a bucket for PRES, each row's pressure count landed on the nearest
// *registered* column — TFL — and was recorded as a tackle for loss.
// A header token in NEITHER list is not a column: it is the "Player" label (which
// the 1996 scan OCRs as "HI" + "ayer", so matching the literal word is not enough).
const TAKE = {
  T: 'T',
  PRI: 'T',
  A: 'A',
  AST: 'A',
  HIT: 'HIT',
  HITS: 'HIT',
  TOTAL: 'HIT',
  TFL: 'TFL',
  'TFL-YDS': 'TFL',
  SACKS: 'SACKS',
  'QB-YDS': 'SACKS',
  QB: 'SACKS',
  INT: 'INT',
  'INT-YDS': 'INT',
  PBU: 'PBU',
  // The 1994/1995 tables fuse two stats into one cell ("0-7", "9-0"). We are not
  // guessing which half is which: the page prints its own Key to Defensive Stats —
  // "DP — deflected pass behind or at the line of scrimmage; PBU — passes broken
  // up downfield" — so the cell is DP-PBU and PBU is the SECOND number. Read that
  // way, the numbers behave: cornerbacks carry the PBUs (Boyd 0-10) and linemen
  // carry the deflections (M. Jones, de 9-0).
  'DP-PBU': 'DP_PBU',
}
const DROP = new Set([
  'G',
  'GS',
  'G-GS',
  'FC',
  'FR',
  'CF',
  'FF',
  'RF',
  'RF-YDS',
  'FR-YDS',
  'PRES',
  'QBH',
  'BP',
  'BF',
  'BK',
  'BKS',
  'S',
  'NO',
])

function headerKey(raw) {
  const t = raw.replace(/[.\s]/g, '').toUpperCase()
  if (TAKE[t]) return { key: TAKE[t], take: true }
  if (DROP.has(t)) return { key: `_${t}`, take: false }
  return null
}

const lead = (v) => {
  const m = String(v).match(/^(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}
// "0-7" → 7. Used only for the fused DP-PBU cell, where the page's own legend says
// the second number is the passes broken up.
const second = (v) => {
  const m = String(v).match(/^\d+(?:\.\d+)?-(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

function wordsOf(page, rotated) {
  const out = []
  const re = /<WORD coords="([\d,\- ]+)"[^>]*>([^<]*)<\/WORD>/g
  for (const m of page.matchAll(re)) {
    const c = m[1].split(',').map((n) => parseInt(n, 10))
    const text = m[2]
      .replace(/&amp;/g, '&')
      .replace(/&apos;|&#0?39;/g, "'")
      .trim()
    if (!text) continue
    // A rotated page's columns run down the image: swap the axes and it is a
    // normal table again.
    const [x1, y1, x2, y2] = rotated ? [c[1], c[0], c[3], c[2]] : c
    out.push({
      x1: Math.min(x1, x2),
      x2: Math.max(x1, x2),
      y1,
      y2,
      cy: (y1 + y2) / 2,
      h: Math.abs(y2 - y1),
      text,
    })
  }
  return out
}

// Words from a Vision re-OCR (data-work/unc/guide-ocr/<season>.tsv).
function visionWords(season, rotated) {
  const f = join(HERE, 'guide-ocr', `${season}.tsv`)
  if (!existsSync(f)) return null
  const out = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const [coords, text] = line.split('\t')
    if (!text) continue
    const c = coords.split(',').map(Number)
    const [x1, y1, x2, y2] = rotated ? [c[1], c[0], c[3], c[2]] : c
    out.push({
      x1: Math.min(x1, x2),
      x2: Math.max(x1, x2),
      y1,
      y2,
      cy: (y1 + y2) / 2,
      h: Math.abs(y2 - y1),
      text: text.trim(),
    })
  }
  return out
}

function pageSlope(words) {
  const n = words.length
  if (n < 2) return 0
  const mx = words.reduce((s, w) => s + w.x1, 0) / n
  const my = words.reduce((s, w) => s + w.cy, 0) / n
  let sxy = 0
  let sxx = 0
  for (const w of words) {
    sxy += (w.x1 - mx) * (w.cy - my)
    sxx += (w.x1 - mx) ** 2
  }
  return sxx ? sxy / sxx : 0
}

// `mode`: 'anchor' cuts a row when a word strays from the row's FIRST word (right
// for level pages); 'chain' cuts when it strays from the PREVIOUS word (follows a
// drifting baseline, but merges rows on a page whose skew exceeds the line gap).
// Neither is right for every book — the caller tries both.
function rowsOf(words, { slope, mode }) {
  if (!words.length) return []
  const heights = words.map((w) => w.h).sort((a, b) => a - b)
  const medH = heights[Math.floor(heights.length / 2)] || 20
  const tol = Math.max(6, medH * 0.7)
  const sorted = words
    .map((w) => ({ ...w, cy: w.cy - slope * w.x1 }))
    .sort((a, b) => a.cy - b.cy)
  const rows = []
  let cur = [sorted[0]]
  for (const w of sorted.slice(1)) {
    const ref = mode === 'chain' ? cur[cur.length - 1].cy : cur[0].cy
    if (Math.abs(w.cy - ref) <= tol) cur.push(w)
    else {
      rows.push(cur)
      cur = [w]
    }
  }
  rows.push(cur)
  return rows.map((r) => r.sort((a, b) => a.x1 - b.x1))
}

// Strip OCR leader dots, then re-join a printed value that OCR SPLIT in two
// ("113" → "1" + "13"; "11-25" → "1" + "1-25"). The fragments belong to the SAME
// column — that, not proximity, is the test: in several of these scans the word
// boxes are cell-width and touching, so the gap between genuinely separate cells
// is zero and a proximity rule collapses the entire row into one token.
function cleanRow(row, colKeyAt) {
  const cleaned = []
  for (const w of row) {
    const text = w.text.replace(/^[.•…]+|[.•…]+$/g, '')
    if (text) cleaned.push({ ...w, text })
  }
  cleaned.sort((a, b) => a.x1 - b.x1)
  const merged = []
  const numish = (s) => /^[\d.\-/]+$/.test(s)
  for (const w of cleaned) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      numish(prev.text) &&
      numish(w.text) &&
      colKeyAt(prev.x1) &&
      colKeyAt(prev.x1) === colKeyAt(w.x1)
    ) {
      prev.text += w.text
      prev.x2 = w.x2
      continue
    }
    merged.push({ ...w })
  }
  return merged
}

const SECTION_END =
  /^(scoring|punting|kickoffs?|returns?|offensive|passing|rushing|receiving|miscellaneous|interceptions)\b/i

// Match a guide row's name to a Sports-Reference name. The guide prints names
// three different ways across the run: "Morton, lb" (surname + position code),
// "K. Mays" (initial + surname) and "Kivuusama Mays" (full).
function surnameOf(raw) {
  const namePart = raw.split(',')[0] // drop the ", lb" position code
  const toks = namePart
    .replace(/[^A-Za-z' -]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(jr|sr|ii|iii|iv)$/i.test(t))
  if (!toks.length) return null
  return toks[toks.length - 1].toLowerCase().replace(/[^a-z]/g, '')
}
function initialOf(raw) {
  const namePart = raw.split(',')[0]
  const toks = namePart.split(/\s+/).filter(Boolean)
  return toks.length > 1 ? toks[0][0].toLowerCase() : null
}

// ALIGN a row's cells to the header columns as an ordered sequence, not one at a
// time. Cells run left to right and so do columns, so a cell can never cross one
// of its neighbours — an ordered alignment enforces that, allows a column to be
// SKIPPED where OCR dropped the cell, and makes collisions structurally
// impossible. Assigning each cell independently to its nearest column does not:
// a single misjudged cell there silently displaces a real value into the wrong
// stat (this is how the 1994 table recorded pressures as tackles for loss).
// A gapped sequence alignment (Needleman-Wunsch): a COLUMN may be skipped (OCR
// dropped that cell) and a CELL may be skipped (OCR invented a fragment or an
// artifact drifted into the row). Both happen in these scans, and forcing every
// token into a column — the stricter version of this — threw away whole rows
// whenever one stray mark appeared.
function alignCells(cells, cols, anchor, span) {
  const cx = (w) => (anchor === 'center' ? (w.x1 + w.x2) / 2 : w.x1)
  const kx = (c) => (anchor === 'center' ? c.cx : c.ax)
  const m = cells.length
  const n = cols.length
  if (!m || !n) return []
  const DROP_CELL = span * 0.75 // what it costs to leave a token unassigned
  const INF = 1e9
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(INF))
  const bk = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(''))
  dp[0][0] = 0
  for (let j = 1; j <= n; j++) {
    dp[0][j] = 0 // leading columns may simply be empty
    bk[0][j] = 'col'
  }
  for (let i = 1; i <= m; i++) {
    dp[i][0] = dp[i - 1][0] + DROP_CELL
    bk[i][0] = 'cell'
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const d = Math.abs(cx(cells[i - 1]) - kx(cols[j - 1]))
      // A token further than this from a column's anchor is not that column's.
      const match = d > span * 0.6 ? INF : dp[i - 1][j - 1] + d
      const skipCol = dp[i][j - 1]
      const skipCell = dp[i - 1][j] + DROP_CELL
      dp[i][j] = Math.min(match, skipCol, skipCell)
      bk[i][j] =
        dp[i][j] === match ? 'match' : dp[i][j] === skipCol ? 'col' : 'cell'
    }
  }
  const out = new Array(m).fill(null)
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    const b = bk[i][j]
    if (b === 'match') {
      out[i - 1] = cols[j - 1]
      i--
      j--
    } else if (b === 'col') j--
    else i--
  }
  return out
}

// One attempt at reading a page under one interpretation. `wordsFor(rotated)`
// supplies the page's words — from the archive's own OCR, or from a Vision re-OCR
// of the same page image (ocr-guides.mjs). Both are candidate readings and both
// must pass the same checks.
function attempt(wordsFor, opts, srInts) {
  const words = wordsFor(opts.rotated)
  if (!words || words.length < 40) return null
  const rows = rowsOf(words, opts)
  const hdrIdx = rows.findIndex((r) => {
    const keys = r
      .map((w) => headerKey(w.text))
      .filter(Boolean)
      .map((h) => h.key)
    return (
      keys.includes('HIT') &&
      keys.includes('TFL') &&
      (keys.includes('SACKS') || keys.includes('INT'))
    )
  })
  if (hdrIdx < 0) return null

  const cols = []
  for (const w of rows[hdrIdx]) {
    const h = headerKey(w.text)
    if (h)
      cols.push({ key: h.key, ax: w.x1, cx: (w.x1 + w.x2) / 2, take: h.take })
  }
  cols.sort((a, b) => a.ax - b.ax)
  if (cols.length < 4) return null
  const span = (cols[cols.length - 1].ax - cols[0].ax) / (cols.length - 1)
  if (span <= 0) return null

  // Where a cell sits relative to its header differs BY BOOK: the later tables are
  // left-aligned (so a cell's left edge lines up with its header's), the mid-90s
  // ones centre narrow numbers under wide headers like "TFL-YDS" (so left edges
  // drift right, into the next column). Both anchorings are tried; the scoring
  // decides. This is not cosmetic — reading the 1994 table left-anchored recorded
  // every pressure count as a tackle for loss.
  const colAt = (x) => {
    let best = null
    let bestD = Infinity
    for (const c of cols) {
      const d = Math.abs(x - (opts.anchor === 'center' ? c.cx : c.ax))
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return bestD > span * 0.6 ? null : best
  }
  const nameCutoff = cols[0].ax - span * 0.45

  const players = []
  const teamTotals = {}
  const warnings = []
  let checksumFails = 0
  let fmtViolations = 0

  for (const rawRow of rows.slice(hdrIdx + 1)) {
    const row = cleanRow(rawRow, (x) => colAt(x)?.key ?? null)
    const nameWords = row.filter((w) => w.x1 < nameCutoff)
    const cells = row.filter((w) => w.x1 >= nameCutoff)
    const label = nameWords
      .map((w) => w.text)
      .join(' ')
      .trim()
    // Other tables (SCORING, PUNTING…) print below this one with the same shape.
    if (SECTION_END.test(label)) break
    if (!nameWords.length || cells.length < 3) continue

    let rawName = label.replace(/\s+/g, ' ').replace(/^\d{1,2}\s+/, '')
    if (!/[A-Za-z]{2}/.test(rawName)) continue
    // Prose (photo captions, the legend under the table) is not a player row.
    if (rawName.split(/\s+/).length > 4) continue

    // Ordered alignment: every cell gets a column, columns may be skipped, and no
    // two cells can land on the same column.
    const mapped = alignCells(cells, cols, opts.anchor, span)
    const got = {}
    cells.forEach((c, i) => {
      const col = mapped[i]
      if (col && col.take && got[col.key] === undefined) got[col.key] = c.text
    })

    // FORMAT CHECK — the one that catches a column shift.
    // In every one of these printings, tackles-for-loss and sacks are given as a
    // COUNT-YARDS pair ("2-8", "12.5-56", "0-0"), while the neighbouring PRES
    // (quarterback pressures) column is a bare integer. So a bare non-zero integer
    // sitting in the TFL or SACKS column is not a plausible value — it is the
    // pressure count, one column over, and the whole row is misread.
    //
    // This matters because it is the ONLY check that tests those columns on the
    // 1994-1996 tables: they print no team total to reconcile against, and the
    // Sports-Reference cross-check validates the INTERCEPTION column alone. Without
    // it, a reading that shifted TFL/sacks/PBU by one column scored just as well as
    // the correct one — and the 1994 table was duly read a column off, giving Mike
    // Morton 1 tackle-for-loss (his pressure count) instead of 2.
    const dashed = (v) => v === undefined || /-/.test(v) || /^0(\.0)?$/.test(v)
    // Beyond scoring the whole reading, DISCARD the individual offending cell. Even
    // in the winning interpretation a row here and there is damaged by OCR, and a
    // bare integer in the TFL column is a value we know to be wrong. Dropping it
    // leaves a hole; keeping it would hand a defender someone else's number.
    if (!dashed(got.TFL)) {
      fmtViolations++
      delete got.TFL
    }
    if (!dashed(got.SACKS)) {
      fmtViolations++
      delete got.SACKS
    }
    if (got.DP_PBU !== undefined && !/-/.test(got.DP_PBU)) {
      fmtViolations++
      delete got.DP_PBU
    }

    const T = lead(got.T)
    const A = lead(got.A)
    const HIT = lead(got.HIT)
    const rec = {
      rawName,
      T,
      A,
      tackles: HIT,
      tfl: lead(got.TFL),
      sacks: lead(got.SACKS),
      defInt: lead(got.INT),
      pbu: got.PBU !== undefined ? lead(got.PBU) : second(got.DP_PBU),
    }

    if (TEAM_ROWS.test(rawName)) {
      teamTotals[/opp/i.test(rawName) ? 'opponents' : 'unc'] = rec
      continue
    }
    // ROW CHECKSUM — every kept row must prove itself: the printed total (Hit)
    // must equal solo + assisted. A row is kept ONLY if all three are present and
    // agree.
    //
    // The rule used to fall back to tackles = T + A when the printed Hit was
    // missing. That is exactly how a misread becomes a fabricated stat: OCR read
    // Mark Dunn's "1  1  2" as "1" and "12" and dropped the total, and the
    // fallback duly recorded 13 tackles for a player who made 2. With no printed
    // total there is nothing to check the cells against, so the row goes. What we
    // lose is a handful of scrubs with a tackle or two; what we avoid is inventing
    // numbers. Coverage below reports exactly how much was lost.
    // The PRINTED TOTAL is required — it is the number we actually store, and it
    // is the only one we will not reconstruct. The earlier rule also demanded both
    // T and A, which threw away perfectly good rows whose assist cell OCR happened
    // to drop (a third of the 1996 table). And the rule it replaced was worse: it
    // fell back to tackles = T + A when the total was missing, which is exactly how
    // a misread becomes a fabricated stat — OCR read Mark Dunn's "1 1 2" as "1" and
    // "12", and the fallback recorded 13 tackles for a player who made 2.
    // So: no printed total, no row. When solo and assisted BOTH survive, they must
    // add up to it.
    if (HIT === null) {
      warnings.push(`${rawName}: no printed tackle total — dropped`)
      continue
    }
    if (T !== null && A !== null && T + A !== HIT) {
      checksumFails++
      warnings.push(`${rawName}: T(${T}) + A(${A}) != Hit(${HIT}) — row dropped`)
      continue
    }
    players.push(rec)
  }

  // TABLE CHECKSUM → COVERAGE. Our kept rows are each individually verified, so a
  // sum BELOW the printed team total is not an error — it is the OCR-dropped rows
  // we refused to guess at, and we want it reported, not hidden. A sum ABOVE the
  // printed total, though, means double-counting: that IS an error.
  const checks = {}
  const team = teamTotals.unc
  if (team) {
    for (const k of ['tackles', 'tfl', 'sacks', 'defInt', 'pbu']) {
      const printed = team[k]
      if (printed === null || printed === undefined || printed === 0) continue
      const sum = players.reduce((n, p) => n + (p[k] ?? 0), 0)
      checks[k] = {
        printed,
        parsed: Math.round(sum * 10) / 10,
        coverage: Math.round((sum / printed) * 1000) / 1000,
        over: sum > printed + 0.5,
      }
    }
  }
  const cov = checks.tackles ? checks.tackles.coverage : 0
  const overcount = Object.values(checks).some((c) => c.over)

  // INDEPENDENT CROSS-CHECK — the interception column, against Sports-Reference.
  // Four of these seven tables print NO team-total row, so their arithmetic cannot
  // check itself and a plausible-but-wrong column mapping would pass unnoticed.
  // SR publishes interceptions (and only interceptions) for exactly these seasons,
  // from a completely separate lineage. If our INT column agrees with SR
  // player-for-player, the columns are aligned; if the mapping has slipped, the
  // INT column is really some other stat and the agreement collapses. This is the
  // signal that decides the unverifiable years.
  let srHit = 0
  let srMiss = 0
  for (const p of players) {
    const sn = surnameOf(p.rawName)
    if (!sn) continue
    const cands = srInts.get(sn)
    if (!cands || !cands.length) continue
    const ini = initialOf(p.rawName)
    const sr =
      cands.length === 1
        ? cands[0]
        : (cands.find((c) => !ini || c.initial === ini) ?? null)
    if (!sr) continue
    // A MISSING cell is unknown, not a disagreement. OCR drops INT cells wholesale
    // in some tables (the 1997 one loses a whole block), and scoring those as
    // conflicts would reject the correct reading of the table.
    if (p.defInt === null || p.defInt === undefined) continue
    if (p.defInt === sr.int) srHit++
    else srMiss++
  }

  return {
    opts,
    cols: cols.map((c) => c.key),
    players,
    teamTotals,
    checks,
    warnings,
    // The data itself decides which interpretation is right. The best read is the
    // one that recovers the most of the printed team total WITHOUT exceeding it,
    // and whose rows individually check out.
    // The `team ? 0 : -150` matters: without it, an interpretation that FAILS to
    // find the team-total row escapes the coverage test entirely and so outscores
    // an honest one that finds the row and admits a shortfall. Losing the evidence
    // must never beat being measured by it.
    srCheck: { agree: srHit, disagree: srMiss },
    fmtViolations,
    score:
      players.length +
      400 * Math.min(cov, 1) -
      (overcount ? 500 : 0) -
      5 * checksumFails +
      (team ? 0 : -150) +
      25 * srHit -
      40 * srMiss -
      30 * fmtViolations,
  }
}

// Sports-Reference's interceptions for a season, keyed by surname — the
// independent yardstick the scoring uses (see the cross-check in attempt()).
function srIntsFor(season) {
  const map = new Map()
  const f = join(HERE, 'sr', `${season}.json`)
  if (!existsSync(f)) return map
  const d = JSON.parse(readFileSync(f, 'utf8'))
  for (const r of d.rows) {
    if (!r.table.startsWith('defense')) continue
    const int = r.stats.def_int ?? 0
    const toks = r.name.split(/\s+/).filter(Boolean)
    const sn = toks[toks.length - 1].toLowerCase().replace(/[^a-z]/g, '')
    if (!sn) continue
    if (!map.has(sn)) map.set(sn, [])
    map.get(sn).push({ int, initial: toks[0][0].toLowerCase() })
  }
  return map
}

function parseGuide(guideYear, season) {
  const xml = readFileSync(
    join(HERE, 'guide-xml', `carolinafootball${guideYear}unse.xml`),
    'utf8',
  )
  const srInts = srIntsFor(season)
  let best = null
  const sources = []
  xml.split(/(?=<OBJECT )/).forEach((page, i) => {
    const flat = page.replace(/<[^>]+>/g, ' ')
    if (!/defensive\s+stat/i.test(flat)) return
    if ((flat.match(/\d/g) || []).length < 250) return
    sources.push({ page: i, ocr: 'archive', get: (rot) => wordsOf(page, rot) })
  })
  // The Vision re-OCR of the table page competes on equal terms.
  if (existsSync(join(HERE, 'guide-ocr', `${season}.tsv`))) {
    const known = JSON.parse(
      readFileSync(join(OUT, `${season}.json`), 'utf8'),
    ).page
    sources.push({
      page: known,
      ocr: 'vision',
      get: (rot) => visionWords(season, rot),
    })
  }
  sources.forEach(({ page: i, ocr, get }) => {
    for (const rotated of [false, true]) {
      const ws = get(rotated)
      if (!ws || !ws.length) continue
      // SEARCH the skew rather than guess it. The least-squares fit over a whole
      // page is dragged off by headlines and captions (on the 1999 table it lands
      // at 0.056 when the true baseline drift is ~0.012), and zero is wrong for
      // any page that curves. So sweep a range of plausible slopes and let the
      // scoring decide — the correct de-skew is the one whose rows add up to the
      // printed team total.
      const slopes = new Set([0, pageSlope(ws)])
      for (let s = -0.03; s <= 0.0301; s += 0.004) slopes.add(Math.round(s * 1e4) / 1e4)
      for (const mode of ['anchor', 'chain']) {
        for (const anchor of ['left', 'center']) {
          for (const slope of slopes) {
            const r = attempt(get, { rotated, mode, slope, anchor }, srInts)
            if (!r) continue
            if (process.env.DEBUG_ATTEMPTS)
              console.log(
                `    try ${ocr} p${i} ${rotated ? 'rot ' : ''}${mode},${anchor},slope=${slope}: ${r.players.length} rows, cov=${r.checks.tackles ? Math.round(r.checks.tackles.coverage * 100) + '%' : '-'}, sr=${r.srCheck.agree}/${r.srCheck.disagree}, score=${Math.round(r.score)}`,
              )
            if (r.players.length >= 8 && (!best || r.score > best.score))
              best = { ...r, page: i, ocr }
          }
        }
      }
    }
  })
  if (!best) throw new Error(`${guideYear}: no defensive-stats table resolved`)

  return {
    season,
    guideYear,
    page: best.page,
    ocr: best.ocr,
    srCheck: best.srCheck,
    fmtViolations: best.fmtViolations,
    source: `https://archive.org/details/carolinafootball${guideYear}unse`,
    sourceNote: `${guideYear} Carolina Football media guide (UNC Athletics), "Defensive Statistics" — final ${season} team defensive statistics. Scanned by UNC Libraries; Internet Archive item carolinafootball${guideYear}unse.`,
    read: best.opts,
    columns: best.cols,
    players: best.players,
    teamTotals: best.teamTotals,
    checks: best.checks,
    warnings: best.warnings,
  }
}

mkdirSync(OUT, { recursive: true })
for (const [g, season] of Object.entries(GUIDES)) {
  const d = parseGuide(Number(g), season)
  writeFileSync(join(OUT, `${season}.json`), JSON.stringify(d, null, 1))
  // An EMPTY check set means the printed team-total row was never found — that is
  // an UNVERIFIED table, not a passing one. Say so plainly.
  const c = d.checks
  const flag = !Object.keys(c).length
    ? 'NO TEAM-TOTAL ROW — UNVERIFIED'
    : Object.entries(c)
        .map(
          ([k, v]) =>
            `${k} ${v.parsed}/${v.printed} (${Math.round(v.coverage * 100)}%${v.over ? ' OVER!' : ''})`,
        )
        .join('  ')
  const how = `${d.ocr},${d.read.rotated ? 'rotated,' : ''}${d.read.mode},${d.read.anchor}${d.read.slope ? ',deskew' : ''}`
  const sr = `SR interceptions: ${d.srCheck.agree} agree / ${d.srCheck.disagree} disagree | format violations: ${d.fmtViolations}`
  console.log(
    `${season} (guide ${g} p${d.page}, ${how}): ${d.players.length} defenders\n    ${flag}\n    ${sr}`,
  )
}
