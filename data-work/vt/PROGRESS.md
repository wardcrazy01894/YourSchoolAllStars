# VT football dataset — work-in-progress checkpoint

**Goal:** `src/data/vt-football.json` — real, per-season sourced stats for
Virginia Tech football 1994–2025, following the recipe in
`docs/DATA-SOURCING.md` §Football (same as Michigan/Pitt/Florida). Once it
ships, VT auto-joins Full Football (the pool builder picks up any school with
a real dataset — no other wiring needed).

**This directory is the session-restart point.** Everything needed to resume
lives here or is regenerable by the scripts referenced below. Update this file
at every checkpoint; commit + push to `data/vt-football` after each stage.

## How to resume in a fresh session

1. `git checkout data/vt-football && git pull`
2. Read this file top to bottom; the **Next actions** section says what's next.
3. Memory note `vt-football-progress` points here too.

## Source-floor findings (probed 2026-07-14)

VT's official platform is **wmt.games (WMT Digital), not Sidearm** — the
`fetch-football-mgoblue.mjs` script does NOT work. hokiesports.com's stats
pages are a thin shell over the WMT API:

- Year→team-id map: `data-work/vt/wmt-team-ids.json` (keyed by **academic
  year** = season + 1; e.g. the 1999 season is key `"2000"`). Built from
  `https://api.wmt.games/api/statistics/teams?school_id=742&per_page=500`
  (cursor-paginated via `meta.pagination.next_page`, passed verbatim as
  `&page=<cursor>`; responses are gzipped regardless of Accept-Encoding).
- Per-player season totals:
  `https://api.wmt.games/api/statistics/teams/<teamId>/players?per_page=200`
  → `data[i].statistic.data.season.columns[0].statistic` with `s*` keys
  (sRushingYards, sRushTDs, sReceptions, sReceivingYards, sRecTDs, sTackles?,
  sSacks, sPassesDefended, …). Validated: Tuten 2024 = 1159/15 rush ✓.
- **Floors (scanned every season 1994–2025):**
  - **2013–2025: full per-player season stats incl. defense** (78–126
    players/yr, 26–60 with tackle/sack keys). Primary source for these years.
  - **2002–2012: rosters only** (players listed, zero season statistics).
  - **1994–2001: nothing** (0 players).
- 2017 + 2021 show stats on 100% of roster rows (others ~75–85%) — rows
  without a season block are non-participants, verify during parse.

## Gap-year (1994–2012) source candidates — NOT yet probed

In priority order (docs/DATA-SOURCING.md source policy):

1. **Wayback captures of old hokiesports.com** — VT ran a custom site with a
   deep stats archive long before WMT. Probe CDX for
   `hokiesports.com/football/stats*`, `/football/archives*`, and
   OCSN/CollegeSports-era `*teamcume.html` patterns (see Pitt lessons in
   memory `football-data-mgoblue-pipeline`). Check capture dates — mid-season
   cumes are garbage.
2. **Digitized VT media guides** (Internet Archive; VT's own archives at
   spec.lib.vt.edu?) — guides carry the PRIOR season's full stats.
3. **Sports-Reference** season pages via Wayback (`web.archive.org/web/2024/
   https://www.sports-reference.com/cfb/schools/virginia-tech/<year>.html`) —
   offense complete for all years; full defense tables only 2005+ (pre-2005
   INT-only). Cite SR per row where used.

## Honors sources (stage 4, not started)

- Wikipedia "List of Virginia Tech Hokies football All-Americans" (bgcolor
  legend for consensus/unanimous — same parse as Florida's).
- Per-year "YYYY All-Big East Conference football team" (VT in Big East
  **1994–2003**) and "YYYY All-ACC football team" (**2004+**).
- National awards + SR award pages per memory `honors-rederive-from-sr-award-pages`.
- VT specifics to remember: Michael Vick (1999 Big East OPOY, 2000), Corey
  Moore (1999 Lombardi/Nagurski), Bruce Smith is pre-1994. DeAngelo Hall,
  Kevin Jones, Tyrod Taylor (2010 ACC POY), Kam Chancellor, Cody Grimm, etc.

## Pipeline stages & status

- [x] **Stage 0 — scaffold**: branch `data/vt-football`, this doc, team-id map.
- [ ] **Stage 1 — WMT fetch (2013–2025)**: `data-work/vt/fetch-wmt.mjs` →
      commit raw per-season parsed drafts to `data-work/vt/wmt/<season>.json`
      (one file per season so partial progress survives).
- [ ] **Stage 2 — gap years (1994–2012)**: probe sources (above), parse into
      `data-work/vt/gap/<season>.json` with per-row `source` URLs.
- [ ] **Stage 3 — merge + curate**: merge persons across years (beware
      name-twin classes from Pitt lessons: tenure span ≤5yr guard, no
      cross-decade merges), position resolution (defense-table pos beats
      offense-table guesses), SR cross-validation of the WMT era (Sidearm-era
      bio-mislink class may not apply to WMT, but validate anyway), QB rushing
      lines on every QB season, id de-collision, redshirtYears gap declaration.
- [ ] **Stage 4 — honors**: programmatic wikitext derivation + SR award pages;
      attach per-season; re-verify counts after any rebuild.
- [ ] **Stage 5 — ship**: build `src/data/vt-football.json`, wire
      `src/data/index.ts` (virginiaTechFootball) + `src/schools.ts`
      (`football: virginiaTechFootball`), guard tests green
      (`football-dataset.test.ts` + `dataset.test.ts`), update
      docs/DATA-SOURCING.md §VT, browser-verify (VT single-school + auto-join
      of Full Football), PR with adversarial review.

## Next actions

1. Write `data-work/vt/fetch-wmt.mjs` (WMT API → FbSeason-draft JSON per
   season, source URL = the hokiesports stats page for that season:
   `https://hokiesports.com/sports/football/stats/season/<season>`).
   Run for 2013–2025; commit per-season outputs.
2. Probe Wayback CDX for old hokiesports.com stats archive (gap years).

## Decisions log

- 2026-07-14: Dataset span target 1994–2025 (matches other schools; engine
  floor is FB_FIRST_YEAR=1994). Academic-year off-by-one handled ONCE in the
  fetch script (map key = season+1), everywhere else uses season year.
- data-work/ is committed (survives sessions) and added to .prettierignore
  (big JSON drafts shouldn't churn format:check); PROGRESS.md kept
  hand-formatted.
