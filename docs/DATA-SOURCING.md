# Data sourcing

The game lives or dies on accurate, **license-clean** player stats. This doc is
the contract for where data comes from and the schema it lands in.

## The constraint

- **Sports-Reference** (sports-reference.com/cbb, /cfb) is the only place with
  clean per-player college stats back to 1994 — but its **Terms of Use forbid
  building a website/game on its data or recreating its database**, and it rate-
  limits/bot-blocks scraping. So we **do not redistribute SR data**. We may read
  an SR page to _verify a single number_, but it is not our source of record.
- **Wikipedia** ("YYYY–YY Michigan Wolverines men's basketball team" season pages
  and player pages) carries per-game stat tables and is **CC-BY-SA** — reusable
  with attribution. This is our **primary basketball source**.
- **mgoblue.com** (official Michigan athletics record books & media guides) — for
  cross-checking and filling gaps. Public record-book PDFs.
- **CollegeFootballData.com (CFBD) API** — free (1k calls/mo, free key), has
  player-season stats incl. defense; designed for API access. **Primary football
  source for offense.** Defensive stats only reliably exist from ~2005 — hence
  football starts in 2005.

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

- **Curated dataset landed: 49 unique players, `_provisional: false`.** Built
  from two Wikipedia passes (1994–2008 and 2009–2025), deduped to each player's
  best season, every row carrying a real `source` URL. Replaced the provisional
  seed.
- **5 known coverage gaps remain** (windows × positions with no sourced player),
  locked into `dataset.test.ts` as `KNOWN_GAPS` so no new gap can sneak in:
  `1998-2001/PG`, `1998-2001/PF`, `2002-2005/PF`, `2002-2005/C`, `2018-2021/PF`.
  These are the thin late-90s/early-00s rotation players whose full 5-category
  per-game lines aren't on Wikipedia; a targeted gap-fill pass (allowed to read
  Sports-Reference to verify a missing steals/blocks number) is filling them. The
  UI's reroll/skip covers a stranded cell until then.
- Coverage by window (PG/SG/SF/PF/C counts) is regenerable; the launch bar is
  every cell ≥ 1 (i.e. `KNOWN_GAPS` empties to `[]`).

## Launch bar for the dataset

Flip `dataset.test.ts`'s coverage check from "tracks gaps" to
`expect(gaps).toEqual([])`: **every (window × position) must have ≥1 eligible
player** so no daily spin can strand an open slot. Until then, `skipRound` is the
safety valve (leaves a hole) and the UI surfaces "no eligible players".

## Football (later)

`src/data/michigan-football.json` (2005+). Offense from CFBD player-season stats
(QB pass yds/TD/INT; RB rush; WR/TE rec). Defense (DE/DT/LB/CB/S) tackles/sacks/
INT from CFBD 2005+. Same provenance discipline. Window list starts at 2005.
