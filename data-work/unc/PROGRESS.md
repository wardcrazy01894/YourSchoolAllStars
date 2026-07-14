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
- **2010–2011: the only captures are MID-SEASON** (Nov 10 / Sep 26) — unusable
  (the Pitt lesson: scope date decides, never capture date). 2012–2015 have no
  cume at all. **SR covers 2005+ with FULL defense**, so 2010–2015 comes from
  SR (verified: 2010 = 47 defensive rows with tackles; 2013 = 49; 2015 = 46).
- **1994–2002 official cumes**: the pre-CSTV site published each season's cume
  as a **DATE-NAMED page** (`stats/071102aaa.html` = the 2001 final, "as of
  Dec 01, 2001", full defense ✓), NOT under a predictable path — plus a
  one-off `archive/teamcume-02.html` for 2002 (FINAL STATS ✓). These have to
  be **discovered** (`discover-old-cumes.mjs` crawls the archived stats/archive
  dirs, fetches each page, and keeps the LATEST-SCOPE cume per season).
- **1994–1996** (if no cume exists that far back): SR offense + INT-only
  defense — the documented Michigan pre-1997 precedent. Windows starting
  1994–96 still fill their defensive slots from the 1997 rows they contain, so
  the wheel stays playable from 1994.

### Dead ends (do not re-try)

- **Internet Archive UNC media guides**: the `north-carolina-football-<year>-media-guide`
  items are **cover images only** — no PDFs (unlike Florida's guides).
- **goheels record book / media guide PDFs**: they carry only career/season
  TOP-10 lists and single-leader-per-year tables — not per-season rosters.
  (The real PDF lives on the Sidearm S3 host, not the `goheels.com/documents/…`
  path, which returns the SPA shell.)

### The roster join (the key that unlocks the cume era)

The TAS cumes print names **abbreviated** — `Williams, A.` on offense,
`30 Thornton, D.` on defense — so rows can't be identified from the cume
alone. **goheels.com keeps historical ROSTERS back to 1997**
(`/sports/football/roster/<year>`, server-rendered), each entry carrying
jersey + full name + a spelled-out position:

    Jersey Number | 30 | David Thornton | Position | Linebacker | Academic Year | Sr.

`fetch-rosters.mjs` pulls 1997–2025 (29 files, `rosters/<year>.json`). This is
BOTH the name-expansion key (defense joins on jersey, offense on
last-name + first-initial) AND the position oracle for the whole pre-Sidearm
era — better than SR's coarse codes. Ambiguous joins are reported, never
guessed.

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

## THE 1994 FLOOR — a hard, sourced limit (decide before shipping)

**UNC's dataset starts at 1997, not 1994.** This is not a sourcing shortcut; it
is forced by the data:

- UNC's earliest citable **per-player defensive** stats are **2000** (the
  archived official cumes). A 176-page scan of every archived page on every old
  UNC host (`tarheelblue.ocsn.com`, `tarheelblue.com`, `fansonly`) found season
  cumes for 2000, 2001 and 2002 and NOTHING earlier. Sports-Reference has no
  tackle table before 2005. The IA "media guides" are cover images. The official
  record book has only top-10 lists.
- The engine's era wheel is rolling 4-year windows, and each window must be able
  to fill a 6-slot defensive roster (Hall's condition, enforced by
  `football-dataset.test.ts`). The windows 1994-97, 1995-98 and 1996-99 contain
  NO year with defensive stats, so they are unfillable — including 1994-1996
  would fail CI, not just look thin.
- **1997–2000 is the earliest viable window** (it reaches 2000's defense), so
  1997 is the floor. Seasons 1997–1999 carry SR offense + INT-only defense —
  exactly the documented Michigan pre-1997 pattern, where the early windows fill
  their defensive slots from the first year that has them.

Cost of the floor: three seasons (1994–96), and the pre-1997 seasons of players
who span it (e.g. Dre' Bly's 1996). Everything from 1997 on is complete.

## Pipeline stages & status — ALL DONE (PR open, not merged)

- [x] Stage 0 scaffold · [x] Stage 1 Sidearm 2016-25 · [x] Stage 2 gap years
      (official cumes 2000-09 + SR) · [x] Stage 3 merge + curate (cited research
      for 56 positions) · [x] Stage 4 honors (100, verified) · [x] Stage 5 ship
      (365 players, 458 tests green, browser-verified, PR open).

**Open question for Alex: the 1997 floor** (see the section above). Everything
from 1997 on is complete; 1994-96 is not sourceable without failing CI.

## Decisions log

- 2026-07-14: Target span 1994–2025 (matches the other schools; engine floor is
  `FB_FIRST_YEAR = 1994`). If 1994–2002 defense proves unsourceable, the
  documented fallback is SR offense + INT-only defense for those years (the
  Michigan pre-1997 precedent) — the era wheel is data-driven, so a later floor
  is also acceptable; do NOT fabricate.
