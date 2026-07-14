# UNC football dataset — work-in-progress checkpoint

**Goal:** `src/data/unc-football.json` — real, per-season sourced stats for
North Carolina football 1994–2025, following `docs/DATA-SOURCING.md` §Football
and the **VT pipeline as the model** (`data-work/vt/` — scripts, staging, and
the honors + verify pattern all generalize; read that first). UNC is the LAST
live school without football data; once it ships it auto-joins Full Football
(the pool builder picks up any school with a real dataset — no other wiring).

**This directory is the session-restart point.** Update this file at every
checkpoint; commit + push to `data/unc-football` after each stage.

## How to resume in a fresh session

1. `git checkout data/unc-football && git pull`
2. Read this file top to bottom; **Next actions** says what's next.
3. Memory note `unc-football-progress` points here.

## Source-floor findings (probed 2026-07-14)

Unlike VT (WMT), **UNC's goheels.com IS Sidearm** — the existing
`scripts/fetch-football-mgoblue.mjs` works against it unchanged:

```bash
node scripts/fetch-football-mgoblue.mjs --site https://goheels.com \
  --start 2016 --end 2025 --out data-work/unc/sidearm-2016-2025.json
```

- **2016–2025: full per-player offense AND defense** from the Sidearm payload
  (`goheels.com/sports/football/stats/<year>`, `__NUXT_DATA__`). Already
  fetched → `data-work/unc/sidearm-2016-2025.json` (**277 players, 548 season
  rows**). Verified: Maye 2022 = 4321/38/7 ✓, Howell 2021 ✓, Hampton 2024 =
  1660/15 ✓.
- **2015 and earlier: the Sidearm stats pages carry NO defensive block**
  (probed 1997/2002/2006/2010/2013/2014/2015 — all zero
  `individualDefensiveStats`). **2016 is the hard Sidearm floor.**
- **2003–2011: the old OCSN/CSTV site has full official cumes** — the same
  Automated-ScoreBook fixed-width pages Pitt used:
  `tarheelblue.cstv.com/sports/m-footbl/stats/<yyyy>-<yyyy>/teamcume.html`
  (also on `tarheelblue.com` for 2002-2003). Verified the 2008 capture carries
  the **full defensive table** (Solo/Ast/Total, TFL-Yds, Sacks No-Yds,
  Int-Yds, BU, PD, QBH, Rcv, FF) and is a FINAL cume ("as of Dec 28, 2008").
  **Fetch with the `id_` raw-capture suffix** — a plain
  `/web/<year>/<url>` fetch returns the Wayback interstitial, not the page:
  `http://web.archive.org/web/<TIMESTAMP>id_/<original-url>`
- **1994–2002: NOT yet found.** No archived `teamcume.html` before 2002-2003.
  Candidates, in priority order: (a) other page names on the pre-2002
  `tarheelblue.com`/`tarheelblue.ocsn.com` hosts (the CDX shows per-GAME pages
  like `112998aaa.html` — look for a season/cume variant); (b) digitized UNC
  media guides (Internet Archive — the Florida route; guides carry the PRIOR
  season's full stats); (c) **Sports-Reference** (offense complete every year;
  full defense only 2005+, pre-2005 is INT-only — a documented floor, same as
  Michigan's pre-1997).

## Known issues to resolve during curation (already spotted)

- **Chazz Surratt (2017–2020) is a QB→LB convert** — exactly the class of bug
  that hid Divine Deablo on VT (he was first-team All-ACC as a LINEBACKER
  after starting at QB). The VT fix (an offensive code must never settle a
  defender's position, gated on real defensive production) MUST be carried
  over into whatever merge/resolve step this school uses.
- **Javonte Williams' 2020 row carries 21 tackles / 3 TFL** — implausible for
  a running back; smells like the Sidearm **bio-mislink** class from Florida.
  SR cross-validation will confirm/repair.
- Several 2016–2025 players come back with **no position** (roster join miss);
  the fetcher lists them. Resolve via SR fine codes + cited research, never a
  guess (VT's `resolve-positions.mjs` + `positions-override.json` pattern).

## Pipeline stages & status

- [x] **Stage 0 — scaffold**: branch `data/unc-football`, this doc, platform
      probe (Sidearm, floor 2016), gap-source map.
- [x] **Stage 1 — Sidearm fetch (2016–2025)**: 277 players / 548 rows.
- [ ] **Stage 2 — gap years**: 2003–2011 from the archived OCSN `teamcume.html`
      pages (write a fetch+parse pair modelled on `data-work/vt/fetch-gap.mjs`
      + `parse-gap.mjs`, incl. the **printed-Total checksum** on every parsed
      column); then find/decide the 1994–2002 source (see candidates above).
- [ ] **Stage 3 — merge + curate**: person merge with the year-adjacency guard;
      **carry the VT offense-code-on-defenders fix**; SR cross-validation sweep
      (phantoms/holes/deltas); cited position research for the unresolved;
      composite-floor trim; QB rushing lines; ids; redshirtYears.
- [ ] **Stage 4 — honors**: award-first derivation. UNC's official site
      (goheels.com) + the archived tarheelblue honors pages are primary; the
      per-year All-ACC Wikipedia articles (VT's `parse-honors-wiki.mjs` reader
      handles them) fill the rest. Attach + **verify-honors-style re-derive
      diff** + an independent fact-check sample.
- [ ] **Stage 5 — ship**: build `src/data/unc-football.json`, wire
      `src/data/index.ts` + `src/schools.ts`, guard tests green, docs, browser
      verify (UNC single-school + auto-join of Full Football), PR + adversarial
      review.

## Next actions

1. Write `data-work/unc/fetch-gap.mjs` — for each season 2003–2011, resolve the
   newest CDX capture of `.../<yyyy>-<yyyy>/teamcume.html` and download it with
   the **`id_` raw suffix**; store the snapshot URL per year for row citation.
2. Write `parse-gap.mjs` for the Automated-ScoreBook fixed-width tables
   (Pitt/VT precedent), validating every mapped column against the printed
   Total row.
3. Probe the 1994–2002 gap (candidates above) and record the decision here.

## Decisions log

- 2026-07-14: Target span 1994–2025 (matches the other schools; engine floor is
  `FB_FIRST_YEAR = 1994`). If 1994–2002 defense proves unsourceable, the
  documented fallback is SR offense + INT-only defense for those years (the
  Michigan pre-1997 precedent) — the era wheel is data-driven, so a later floor
  is also acceptable; do NOT fabricate.
