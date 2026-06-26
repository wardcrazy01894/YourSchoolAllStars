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

`sports-reference.com` (/cbb, /cfb) has clean per-player lines back to 1994. Two
distinct constraints apply, and it's worth keeping them separate:

- **Copyright:** individual **stat numbers are facts**, and facts aren't
  copyrightable (_Feist v. Rural_). SR's copyright covers its _compilation_ and
  its _site_, not the raw number. So copying one player's line is not a copyright
  problem.
- **Contract (their ToS):** SR's Terms forbid **bulk-extracting its compiled
  database or building a product on it**, and it rate-limits/bot-blocks scraping.
  Feist does **not** resolve this — whether citing a single player-page URL counts
  as "building on it" is a genuine gray area, so the policy below stays
  deliberately conservative on volume.

Given both, the policy is:

- ✅ **Verification / cross-check oracle** — consult SR without hesitation to
  confirm a number, catch an error, or check which seasons exist. This is plainly
  inside the Terms.
- ✅ **Cited `source` for a long-tail player** — when statsarchive, Wikipedia, and
  mgoblue genuinely lack a clean per-game line, an SR **individual player page**
  is an acceptable `source` URL. **Do not omit a player just because only SR has
  the number** — a single hand-picked factual line, attributed to the exact player
  page, is not a bulk re-publication of their database. (If SR's terms change,
  re-check before leaning on this routinely.)
- ❌ **No bulk scraping / no mirroring** — never pull SR's tables wholesale or
  recreate its database into our JSON. Hand-pick the few numbers you actually need.

This loosens the earlier verify-only stance (Alex's call, 2026-06-26): accuracy
**and** completeness — stop dropping real players over a sourcing technicality.

(Football sources — Wikipedia, the CFBD API — are covered in the **Football**
section below.)

## Schema (`src/data/michigan-basketball.json`)

A player carries **one row per season** they're relevant for; the engine
represents them by their best season _within the spun window_ (not a single
career-best line). `year` is the season-ending year (2012-13 → 2013).

```jsonc
{
  "school": "Michigan",
  "sport": "basketball",
  "players": [
    {
      "id": "trey-burke", // kebab-case, unique
      "name": "Trey Burke",
      "position": "PG", // PG | SG | SF | PF | C (primary slot, used for grouping)
      "eligible": ["PG", "SG"], // OPTIONAL — the COMPLETE slot list (must include
      // the primary); replaces the default of just [position], not additive
      "firstYear": 2012, // year their FIRST Michigan season ended
      "lastYear": 2013, // year their LAST Michigan season ended
      "seasons": [
        // oldest first, one per year; stats are per-game and may be PARTIAL
        {
          "year": 2012,
          "stats": {
            "pts": 14.8,
            "reb": 3.5,
            "ast": 4.6,
            "stl": 0.9,
            "blk": 0.4,
          },
          "honors": ["Big Ten Freshman of the Year"],
          "source": "https://en.wikipedia.org/wiki/...", // REQUIRED per row
        },
        {
          "year": 2013,
          "stats": {
            "pts": 18.6,
            "reb": 3.2,
            "ast": 6.7,
            "stl": 1.6,
            "blk": 0.2,
          },
          "honors": ["National Player of the Year (2013)"],
          "source": "https://statsarchive.ath.umich.edu/...",
        },
      ],
    },
  ],
}
```

Rules (enforced by `src/data/dataset.test.ts`):

- `id` unique; `position` valid; `firstYear ≤ lastYear`; `seasons` non-empty.
- Each season: `firstYear ≤ year ≤ lastYear`, unique within the player; every
  present stat numeric ≥ 0 with **at least one** stat field; `source` non-empty;
  `honors` an array.
- **Eligibility into a window** = tenure `[firstYear,lastYear]` overlaps the
  window; the player is then rated by their **best in-window season**.
- Two coverage guards: every (window × position) and every (year × position) has
  ≥1 eligible player — a data edit that empties any cell fails CI.

## Status

- **Per-season dataset complete: 95 unique players, ~199 season rows, spanning
  1994–2026 (incl. the 2026 title team).** Restructured from single career-best
  rows to one row per relevant season, every row carrying a real `source` URL.
- **Full coverage, two ways:** every (window × position) AND every
  (year × position) cell has ≥1 eligible player, so no daily spin — fixed or
  rolling — can strand a slot. `dataset.test.ts` asserts both (no gaps) plus a
  ≥1-stat-field guard so an empty line can't fake coverage; any data edit that
  empties a cell fails CI.
- Sourced primarily from the **UMich statsarchive** (game logs / season totals)
  and **Wikipedia** season pages, with **mgoblue.com** and per-player **ESPN**
  pages for recent players. Multi-position `eligible[]` lists cover adjacency
  honestly (e.g. a center who genuinely played some PF).

## Football (2005+) — in progress

Target: `src/data/michigan-football.json`, schema = `FbPlayer`/`FbStats`
(`src/types.ts`). Best single season per unique player; positions QB/RB/WR/TE
(offense) and DE/DT/LB/CB/S (defense).

- **Primary source = Wikipedia** (keyless, CC-BY-SA): player pages + "YYYY
  Michigan Wolverines football team" season pages (statistical leaders). Two
  curation passes are running — **offense** (pass/rush/rec) and **defense**
  (tackles/TFL/sacks/INT/PBU/FF).
- **Sports-Reference** (/cfb) — per the SR policy above: verify freely, and an
  individual player page is an acceptable cited `source` for a long-tail player
  when Wikipedia/mgoblue/CFBD lack a clean line. No bulk scraping or DB mirroring.
- **CFBD API** (collegefootballdata.com) is an optional future enrichment for
  fuller per-season completeness — it needs a free API key (email signup), so
  it's not a launch dependency; Wikipedia carries the marquee players.
- **2005 floor** is a hard data limit: defensive box-score stats (tackles/sacks)
  aren't reliable before then anywhere. Football windows therefore start at 2005.
