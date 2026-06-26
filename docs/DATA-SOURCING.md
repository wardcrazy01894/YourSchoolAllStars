# Data sourcing

The game lives or dies on accurate, **license-clean** player stats. This doc is
the contract for where data comes from and the schema it lands in.

## Source priority

Use the highest-priority source that actually has the number; fall through only
when it doesn't:

1. **UMich statsarchive** (`statsarchive.ath.umich.edu/VS-Basketball-M/`) — the
   official Michigan athletics game-by-game archive, per player by `pkey`. The
   richest, cleanest Michigan basketball source: it has season totals and game
   logs back through the 1990s. **Note:** its STL/BLK (and other counting stats)
   are **season totals** — divide by games played `G` for per-game. This is the
   **primary basketball source** wherever a player has a `pkey`.
2. **Wikipedia** ("YYYY–YY Michigan Wolverines men's basketball team" season pages
   and player pages) — per-game stat tables, **CC-BY-SA** (reusable with
   attribution). Primary for players/years statsarchive doesn't cover cleanly.
3. **mgoblue.com** (official Michigan athletics record books & media guides) —
   cross-checking and gap-fill. Public record-book PDFs.
4. **ESPN** (`espn.com/.../player/stats/_/id/<id>/<slug>`) — for current/recent
   players. **Cite the stable per-player URL, never the team-stats page** — the
   team page (`/team/stats/_/id/130/...`) re-points to the newest season each
   year and rots the provenance of older rows.

### Sports-Reference — what we may and may not do

`sports-reference.com` (/cbb, /cfb) has clean per-player lines back to 1994. Its
**Terms of Use forbid bulk-extracting its compiled database or building a product
on it**, and it rate-limits/bot-blocks scraping. But individual **stat numbers
are facts** (per _Feist v. Rural_, facts aren't copyrightable — what SR protects
is its _compilation_ and its _site_, not the number itself). So the policy is:

- ✅ **Verification / cross-check oracle** — read SR freely to confirm a number,
  catch an error, or check which seasons exist. Lean on it harder than we have.
- ✅ **Cited `source` for a long-tail player** — when statsarchive, Wikipedia, and
  mgoblue genuinely lack a clean per-game line, an SR **individual player page**
  is an acceptable `source` URL. **Do not omit a player just because only SR has
  the number** — a single factual stat line, attributed to the exact player page,
  is not "redistributing the database."
- ❌ **No bulk scraping / no mirroring** — never pull SR's tables wholesale or
  recreate its database into our JSON. Hand-pick the numbers you actually need.

This loosens the earlier verify-only stance (Alex's call, 2026-06-26): accuracy
**and** completeness — stop dropping real players over a sourcing technicality.

(Football sources — Wikipedia, the CollegeFootballData API — are covered in the
**Football** section below.)

## Schema (`src/data/michigan-basketball.json`)

```jsonc
{
  "school": "Michigan",
  "sport": "basketball",
  "_provisional": true, // remove/false once curated set lands
  "players": [
    {
      "id": "trey-burke", // kebab-case, unique
      "name": "Trey Burke",
      "position": "PG", // PG | SG | SF | PF | C (single primary slot)
      "firstYear": 2012, // year their FIRST Michigan season ended
      "lastYear": 2013, // year their LAST Michigan season ended
      "bestSeason": 2013, // year the stats below are from
      "stats": { "pts": 18.6, "reb": 3.2, "ast": 6.7, "stl": 1.6, "blk": 0.2 },
      "honors": [
        "National Player of the Year (2013)",
        "Consensus All-American (2013)",
      ],
      "source": "https://en.wikipedia.org/wiki/...", // REQUIRED, real URL
    },
  ],
}
```

Rules (enforced by `src/data/dataset.test.ts`):

- `id` unique; `position` valid; `firstYear ≤ bestSeason ≤ lastYear`; stats
  numeric ≥ 0; `source` non-empty; every player overlaps ≥1 window.
- **Eligibility into a window** = tenure `[firstYear,lastYear]` overlaps the
  window, using the player's best-season stats.
- A player is stored **once** (their best season), not once per season played.

## Status

- **Curated dataset complete: 53 unique players, `_provisional: false`,
  zero coverage gaps.** Built from two Wikipedia passes (1994–2008 and 2009–2025)
  plus a targeted gap-fill pass for the 5 thin-era cells, deduped to each
  player's best season, every row carrying a real `source` URL.
- **Launch bar met:** every window × position now has ≥ 1 eligible player, so no
  daily spin can strand a slot. `dataset.test.ts` asserts this (no gaps); a data
  edit that empties any cell fails CI.
- The gap-fill players (Robbie Reid, Josh Asselin, Graham Brown, Courtney Sims,
  Isaiah Livers→PF) were sourced from Wikipedia season pages + official
  `mgoblue.com` stat archives; Isaiah Livers (listed PF/SF) was classified PF to
  fill the 2018-21/PF cell.

## Launch bar for the dataset — met

`dataset.test.ts` asserts **every (window × position) has ≥1 eligible player**, so
no daily era can strand an open slot. (If a future data edit empties a cell, CI
fails.) The player's one `skip` is a strategic choice, not a coverage crutch.

## Football (2005+) — in progress

Target: `src/data/michigan-football.json`, schema = `FbPlayer`/`FbStats`
(`src/types.ts`). Best single season per unique player; positions QB/RB/WR/TE
(offense) and DE/DT/LB/CB/S (defense).

- **Primary source = Wikipedia** (keyless, CC-BY-SA): player pages + "YYYY
  Michigan Wolverines football team" season pages (statistical leaders). Two
  curation passes are running — **offense** (pass/rush/rec) and **defense**
  (tackles/TFL/sacks/INT/PBU/FF).
- **Sports-Reference** only to verify a number (its data isn't redistributed).
- **CFBD API** (collegefootballdata.com) is an optional future enrichment for
  fuller per-season completeness — it needs a free API key (email signup), so
  it's not a launch dependency; Wikipedia carries the marquee players.
- **2005 floor** is a hard data limit: defensive box-score stats (tackles/sacks)
  aren't reliable before then anywhere. Football windows therefore start at 2005.
