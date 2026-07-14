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

## Gap-year (1994–2012) source — SOLVED: archived hokiesports.com per-year cumes

The old hokiesports.com rendered EVERY historical season in one template at
`/football/stats/<year>/?season` with **full offense AND defense tables**
(Solo/Ast/Total tackles, TFL-Yds, Sacks No-Yds, Int-Yds, BU, PD, QBH, Rcv,
FF) — official numbers all the way back past 1994. Wayback has 2018-05-22
captures (final cumes) for every gap year. This beats what Michigan (no
pre-1997 defense anywhere) and Pitt (Turnstile-gated media guides) had.

- `fetch-gap.mjs` → `gap-html/<year>.html` + `.meta.json` (snapshot URL).
- `parse-gap.mjs` → `gap/<season>.json`; asserts header layouts and validates
  every mapped column against the printed Total row (TEAM pseudo-rows count
  toward totals, aren't emitted). All 19 years parse with ZERO checksum
  problems. Spot-checks vs history: Vick 1999 1840/12/5 + 585/8 ✓, Corey
  Moore 1999 17 sacks ✓, Kevin Jones 2003 1647/21 ✓, Suggs 2000 27 rushTD ✓.
- The cume tables have NO position column. Positions: WMT rosters 2002–2012
  (`rosters/<season>.json`); 1994–2001 need SR rosters / honors pages /
  media-guide cross-refs at merge time (no archived hokiesports roster pages).
- Interception/return/scoring tables are ignored by design — defInt comes
  from the defensive table (one authority).
- SR (via Wayback `web.archive.org/web/2024/<SR url>`) is the CROSS-VALIDATION
  source (stage 3), not primary — the official archive covers everything.

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
- [x] **Stage 1 — WMT fetch (2013–2025)**: `data-work/vt/fetch-wmt.mjs` →
      `data-work/vt/wmt/<season>.json`, 13 seasons, 51–65 stat rows each
      (idempotent; re-run with `--force` to refresh). Spot-checked: Evans 2016
      3552/29/8 + 846/12 rush ✓, Thomas 2013 2907/16/13 ✓. **Known suspect for
      Stage 3:** Burmeister 2021 `rec:1, recYds:3, recTD:2` (impossible line —
      WMT xml-aggregation glitch class; SR cross-validation must resolve).
      pbu = sPassesBrokenUp (pure breakups, matches shipped datasets);
      QB rushYds is NCAA net.
- [x] **Stage 2 — gap years (1994–2012)**: archived hokiesports cumes,
      fetched + parsed into `data-work/vt/gap/<season>.json` (48–62 rows/yr,
      checksums green; see the SOLVED section above). Rosters for positions
      2002–2012 in `rosters/`; 1994–2001 positions resolved at merge.
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

1. **Stage 3 merge**: write `data-work/vt/merge.mjs` — merge gap/ + wmt/ rows
   into persons across 1994–2025. The overlap year is none (gap ends 2012,
   wmt starts 2013) but PEOPLE span the boundary (e.g. Logan Thomas
   2011–2013) — merge by normalized name with the tenure-span (≤5yr) and
   name-twin guards from the Pitt lessons. Positions: WMT position_code
   (2013+ stats rows and 2002–2012 rosters, joined by personId where
   possible, else name); 1994–2001 from SR rosters/honors research with
   citations, low-confidence marginal players dropped.
2. SR cross-validation sweep (esp. the WMT era; known suspect: Burmeister
   2021 rec line) + composite-floor trim + id de-collision + redshirtYears.
3. Honors (stage 4), then ship (stage 5).

## Decisions log

- 2026-07-14: Dataset span target 1994–2025 (matches other schools; engine
  floor is FB_FIRST_YEAR=1994). Academic-year off-by-one handled ONCE in the
  fetch script (map key = season+1), everywhere else uses season year.
- data-work/ is committed (survives sessions) and added to .prettierignore
  (big JSON drafts shouldn't churn format:check); PROGRESS.md kept
  hand-formatted.
