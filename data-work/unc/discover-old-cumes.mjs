// UNC gap years: DISCOVER the old official season-cume pages.
//
// Usage:  node data-work/unc/discover-old-cumes.mjs
//
// The pre-CSTV UNC site (tarheelblue.ocsn.com / tarheelblue.com / fansonly)
// published each season's Automated-ScoreBook cume as a DATE-NAMED page
// (`stats/071102aaa.html` = the 2001 final), not under a predictable
// `<year>/teamcume.html` path — so the pages have to be found, not guessed.
//
// This lists every archived page under those hosts' football stats/archive
// dirs, fetches each with the Wayback `id_` raw suffix (a plain /web/ fetch
// returns the interstitial, not the page), and classifies it:
//   • does it carry the "Overall Defensive Statistics" table?
//   • what SCOPE does it print ("FINAL STATS" / "as of <date>")?
//   • how many games (GP) does the leader row show?
// Then it keeps, per season, the page with the LATEST scope date — the final
// cume. Mid-season captures are the trap (the Pitt lesson), so the scope date
// is what decides, never the capture date.
//
// Output: data-work/unc/old-cume-index.json — { season: {url, snapshot, scope,
// hasDefense} }, the input for fetch-gap.mjs.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const HOSTS = [
  'tarheelblue.ocsn.com/sports/m-footbl/stats/*',
  'tarheelblue.ocsn.com/sports/m-footbl/archive/*',
  'tarheelblue.com/sports/m-footbl/stats/*',
  'www.fansonly.com/schools/unc/sports/m-footbl/stats/*',
]

async function text(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (i === tries) throw e
      await new Promise((r) => setTimeout(r, 2500 * i))
    }
  }
}

// ── 1. list candidate pages ──────────────────────────────────────────────────
const candidates = new Map() // original url -> newest timestamp
for (const host of HOSTS) {
  const cdx = await text(
    `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=text&fl=original,timestamp&filter=statuscode:200&limit=1200`,
  ).catch(() => '')
  for (const line of cdx.split('\n')) {
    const [orig, ts] = line.trim().split(/\s+/)
    if (!orig || !ts) continue
    if (!/\.html?$/i.test(orig)) continue
    // skip obvious non-cume pages (rosters, schedules, per-game recaps are
    // fetched too — the classifier decides, but rosters/scheds never match)
    const prev = candidates.get(orig)
    if (!prev || ts > prev) candidates.set(orig, ts)
  }
  await new Promise((r) => setTimeout(r, 800))
}
console.log(`candidate pages: ${candidates.size}`)

// ── 2. classify each ─────────────────────────────────────────────────────────
const strip = (h) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const found = [] // {season, url, snapshot, scope, scopeDate, hasDefense}
let n = 0
for (const [orig, ts] of candidates) {
  n++
  let html
  try {
    html = await text(`http://web.archive.org/web/${ts}id_/${orig}`, 2)
  } catch {
    continue
  }
  const t = strip(html)
  const hasDefense = /Overall Defensive Statistics/i.test(t)
  if (!hasDefense) continue
  // Scope: "(FINAL STATS)" or "(as of Nov 24, 2001)"
  const m = t.match(/\((FINAL STATS|as of ([A-Z][a-z]{2} \d{1,2}, (\d{4})))\)/i)
  const scope = m ? m[1] : 'unknown'
  // Season year: the printed date's year, minus 1 when the cume was published
  // in Jan–Jun (a bowl-inclusive final for the PREVIOUS season).
  let season = null
  if (m && m[3]) {
    const y = Number(m[3])
    const month = new Date(`${m[2]} UTC`).getUTCMonth() // 0-11
    season = month <= 5 ? y - 1 : y
  } else {
    // FINAL STATS with no date — fall back to the year in the URL/timestamp
    const um = orig.match(/teamcume-(\d{2})/)
    if (um) season = 2000 + Number(um[1])
  }
  if (season === null) continue
  found.push({
    season,
    url: orig,
    snapshot: `http://web.archive.org/web/${ts}id_/${orig}`,
    scope,
    scopeDate: m?.[2] ?? null,
  })
  console.log(`  [${n}/${candidates.size}] ${season}: ${scope} — ${orig}`)
  await new Promise((r) => setTimeout(r, 250))
}

// ── 3. keep the LATEST-scope page per season ─────────────────────────────────
const best = new Map()
for (const f of found) {
  const prev = best.get(f.season)
  const score = (x) =>
    x.scope === 'FINAL STATS'
      ? Infinity
      : x.scopeDate
        ? new Date(`${x.scopeDate} UTC`).getTime()
        : 0
  if (!prev || score(f) > score(prev)) best.set(f.season, f)
}
const index = Object.fromEntries([...best].sort((a, b) => a[0] - b[0]))
writeFileSync(
  join(HERE, 'old-cume-index.json'),
  JSON.stringify(index, null, 1),
)
console.log('\nfinal cume per season:')
for (const [s, v] of Object.entries(index))
  console.log(`  ${s}: ${v.scope} ${v.url}`)
