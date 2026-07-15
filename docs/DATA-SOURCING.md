# Data sourcing

The game lives or dies on accurate, **license-clean** player stats. This doc is
the contract for where data comes from and the schema it lands in.

## Source priority

The priority pattern is **school's official archive → Wikipedia → official
record books → ESPN → Sports-Reference**, and it applies to **every school we
add** — the Michigan-specific entries below (statsarchive, mgoblue) are just this
school's instances of "the official archive"; swap in the equivalent for each new
program. Use the highest-priority source that actually has the number; fall
through only when it doesn't:

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

### ESPN-first for recent seasons (Alex, 2026-06-27)

For **recent seasons, prefer ESPN's keyless API** — it's structured, fast, and
**not rate-limited** (unlike Sports-Reference, which bot-blocks and 429s on
bursts). Use the higher-quality official-archive sources where they're clean, but
when curating the **modern era reach for ESPN first**; fall back to **Wikipedia /
Sports-Reference only once a season is too old for ESPN to serve** (ESPN's
per-athlete season stats thin out / drop off for older years — exactly where SR
and Wikipedia season pages are strongest). This is the standing workflow for every
school, not a VT one-off. The two endpoints that worked (VT = team id `259`):

```
# Roster for a season (id + position + height per player), keyless:
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/<TEAMID>/roster?season=<YEAR>

# Per-athlete SEASON AVERAGES (the compiled per-game line we store), keyless:
https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/<YEAR>/types/2/athletes/<ATHLETEID>/statistics
#   → splits.categories[].stats[] with names: avgPoints, avgRebounds, avgAssists,
#     avgSteals, avgBlocks, gamesPlayed. `value` is the float; round to 1 dp.
#   types/2 = regular season; <YEAR> is the season-ENDING year (2025-26 → 2026).
```

Gotchas: the ESPN **web pages** (`espn.com/.../team/stats/...`) are bot-walled
(HTTP 202, empty body) and the `statistics/byathlete?team=…` endpoint **ignores**
the team filter (returns league-wide leaders) — use the **roster → per-athlete
core-API** pair above instead. ESPN's roster gives only G/F/C + height; assign
PG/SG/SF/PF/C from height + role and use honest `eligible[]` for combo players.
Cite each row's `source` as the player's ESPN page (`/player/_/id/<ATHLETEID>`).

**Honors are NOT in ESPN (Alex, 2026-06-27).** ESPN's API exposes stats only —
there is no awards/accolades endpoint or field (the athlete record carries none).
So **honors are always a separate enrichment pass, no matter where the stat line
came from**: pull All-Conference / All-American / Player-of-the-Year / conference
ROY/FOY selections from **Sports-Reference player pages** (their "Awards" block,
the most structured source) or **Wikipedia** (player-page infobox + the per-year
"YYYY–YY <Conference> men's basketball season" All-Conference team pages and the
"YYYY Consensus All-American" pages). Store them on the **season row whose `year`
they were earned in**, formatted like Michigan's rows ("First-Team All-ACC
(2013)", "ACC Player of the Year (2013)", "Consensus Second-Team All-American
(2013)"). Honors feed the rating bonus (+9–12), so an omitted All-ACC selection
silently under-rates a real star — treat a missing honor as a sourcing gap to
fill, the same as a missing stat.

### Honors gathering is AWARD-FIRST, not scorer-first (Alex, 2026-06-27)

The wrong way (and the trap the earlier passes fell into): walk the **top point
scorers** and look up _their_ honors. That silently misses every award won by a
player who wasn't a high scorer — a lockdown defender's All-Defensive / DPOY nod,
a glue-guy's All-Freshman selection, a low-usage role player's Honorable Mention.
A stats game that under-credits real honors is poisoned the same way a wrong stat
poisons it.

The right way is **award-first**: enumerate the _awards themselves_, then attach
each to whichever player won it, regardless of how many points they scored.

1. **Build the count oracle from Sports-Reference.** Each SR player page carries
   a **"bling" accolades block** listing career award **counts** ("4× All-ACC",
   "2× Consensus All-American", "ACC Rookie of the Year"). These counts are
   reliable and are the **validation oracle**: after encoding, the honors we wrote
   for a player must **sum to their bling counts** — a mismatch is a missing or
   spurious honor. (The SR per-year _awards column_ is incomplete — it's a
   convenience, not the source of truth; trust the bling counts.)
2. **Resolve each award's year and team level from the per-year award pages.**
   SR's bling gives the count, not always the year/level. Pull those from the
   per-year **"YYYY–YY <Conference> men's basketball season"** Wikipedia pages
   (which list that season's First/Second/Third All-Conference teams + conference
   POY/DPOY/ROY/All-Freshman) and the **"YYYY NCAA … Consensus All-Americans"**
   pages. This assigns each All-Conference selection its correct **season-ending
   year** and **team level**.
3. **Validate, then fill the gaps.** Encode honors on the season row of the year
   earned, then check each player's encoded counts against their bling counts.
   Only re-fetch Wikipedia where they disagree — the oracle tells you exactly
   which players still have an unresolved selection, so you cover _all_ the awards
   without blindly fetching every page.

This is the standing method for **every school**. The rating side was extended to
match (`honorTier`, 2026-06-27): sub-first-team honors that the scorer-first pass
never surfaced now actually score — **Second-Team** (3), **Third-Team** (2),
**Honorable Mention** (1), **All-Freshman / All-Defensive team** (2 / 3),
**Rookie/Freshman of the Year** and **Sixth Man of the Year** (3), conference
**Defensive Player of the Year** (6), and the **Final Four / NCAA Tournament Most
Outstanding Player** (5, vs a lesser **regional** MOP at 3) — so completeness in
the ledger translates into the rating instead of silently scoring 0. `honorTier`
is **format-agnostic**: it normalizes word order and digit ordinals, so the same
award scores identically however a source wrote it (`First-Team All-Big Ten` =
`All-Big Ten 1st Team`). The **McDonald's All-American** high-school recruiting
award is deliberately excluded — it is not a college-season honor.

### Sports-Reference — what we may and may not do

`sports-reference.com` (/cbb, /cfb) has clean per-player lines back through the
early 1990s (the Fab Five era and earlier) — we cite it as the source for King's
and Jackson's 1992–93 rows. Two distinct constraints apply, and it's worth
keeping them separate:

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
  inside the Terms. SR's per-player page is also the **authority for a player's
  full span at their school** — which season-ending years they actually appeared
  in — so use it to set `firstYear`/`lastYear` honestly (see **Completeness**).
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

(Football sources — the mgoblue.com pipeline + SR backfill — are covered in the
**Football** section below.)

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
      "firstYear": 2012, // year their FIRST season at the school ended
      "lastYear": 2013, // year their LAST season at the school ended
      "seasons": [
        // oldest first; one row per year played; per-game; COMPLETE 5-stat line
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
  stat numeric ≥ 0; a **complete `pts/reb/ast/stl/blk` line** (see
  **Completeness**); `source` non-empty; `honors` an array.
- **Eligibility into a window** = tenure `[firstYear,lastYear]` overlaps the
  window; the player is then rated by their **best in-window season**.
- Two coverage guards: every (window × position) and every (year × position) has
  ≥1 eligible player — a data edit that empties any cell fails CI.

## Completeness — two axes, both enforced

The standard (Alex, 2026-06-26): **a complete statline for every player, for
every year they played — no excuses.** SR publishes per-game pts/reb/ast/stl/blk
and a full season list for essentially every D-I player, so a gap means we didn't
look hard enough, not that the data is absent. Two distinct guards in
`dataset.test.ts`:

1. **Complete line per row** — every season row carries all five of
   `pts/reb/ast/stl/blk`. A missing field is a sourcing gap to fill (reach for SR
   readily), not an accepted partial. (`every season row carries a complete
pts/reb/ast/stl/blk line`.)
2. **A row for every year of tenure** — every year in `[firstYear,lastYear]` has
   a real season row (`every player has a season row for every year in their
tenure (per-player coverage)`). The corollary the tooling can't check for you: **`firstYear`/
   `lastYear` must be the player's _true_ span at the school.** A too-narrow
   tenure passes this guard while silently dropping real seasons — e.g. a player
   listed for one year who actually played four. **When adding or editing a
   player, verify their full span against SR** and add every season they appeared
   in at that school (including years before the window range, for consistency —
   they're harmless to the in-window ratings). For a genuine non-playing year
   that splits an otherwise-continuous career (a **medical/other redshirt** —
   e.g. Kerry Blackshear, on the VT roster 2016–2019 but redshirt-injured in
   2016–17), **declare the year in `redshirtYears`** and keep every real season on
   both sides — do _not_ truncate to a shorter contiguous span and do _not_
   fabricate a row (Alex, 2026-06-27: "the guard shouldn't forbid a medical
   redshirt year — keep all those years, it's OK he doesn't have the redshirt
   one"). The guard treats a declared redshirt year as covered (`tenureGapYears`);
   an _undeclared_ hole is still a sourcing gap and fails CI. Use a redshirt
   declaration only when the surrounding years genuinely belong to one career; if
   the missing year is just where the public record is thin, trim the span instead
   of asserting a redshirt you can't source.

## Status

- **Per-season dataset complete: 95 unique players, 259 season rows, spanning
  1992–2026 (incl. the 2026 title team).** Restructured from single career-best
  rows to one row per season actually played, every row carrying a real `source`
  URL and a complete 5-stat line. Every player's full Michigan span was audited
  against SR, so tenures reflect the years they actually played.
- **Full coverage, two ways:** every (window × position) AND every
  (year × position) cell has ≥1 eligible player, so no daily spin — fixed or
  rolling — can strand a slot. `dataset.test.ts` asserts both (no gaps) plus the
  complete-line and per-player tenure-coverage guards (see **Completeness**), so
  neither an empty line nor a too-narrow tenure can fake coverage; any data edit
  that empties a cell fails CI.
- Sourced primarily from the **UMich statsarchive** (game logs / season totals)
  and **Wikipedia** season pages, with **mgoblue.com** and per-player **ESPN**
  pages for recent players. Multi-position `eligible[]` lists cover adjacency
  honestly (e.g. a center who genuinely played some PF).
- **Virginia Tech basketball is live (`src/data/vt-basketball.json`):** 106 players
  spanning **1994–2026**. Older seasons (1994–2024) are sourced from
  **Sports-Reference** per-game averages, cited to each player's **individual SR
  player page** (`/cbb/players/<slug>.html`) — the per-row provenance the policy
  wants. Recent players (2023–2026) come from **ESPN's keyless API** (site.api
  roster + sports.core.api per-athlete season averages), cited to the ESPN player
  page. Same guards run over it as Michigan (`dataset.test.ts` iterates both).
  Declared medical redshirts in `redshirtYears`: **Kerry Blackshear Jr. (2017),
  Ahmed Hill (2016), Ty Outlaw (2018)**. **Honors** (All-ACC 1st/2nd/3rd + HM,
  All-American, ACC POY, ACC All-Freshman, and pre-2005 All-Big East / Atlantic 10 /
  Metro) were back-filled from **Wikipedia**, **hokiesports.com ACC-era awards**,
  and official ACC releases — never fabricated, mapped to the season-ending year
  earned. **Known follow-up:** 8 rows for 3 low-usage bench players (Jon Smith
  2000–02, Johnny Hamilton 2016–17, Ginika Ojiako 2020–22) still cite the SR
  season page rather than an individual player page — they were below the cache
  cutoff and SR was rate-limited (429) during this pass; convert them to
  `/cbb/players/` URLs next time SR access is available.
- **Four more basketball schools are live**, each running the same `dataset.test.ts`
  guards (shape, uniqueness, complete 5-stat line, per-player tenure coverage,
  window/year position coverage) with `_provisional: false` and zero gaps:
  - **North Carolina** (`unc-basketball.json`) — 106 players / 283 rows, 1994–2026.
  - **Florida** (`florida-basketball.json`) — 191 players / 438 rows, 1994–2026.
  - **Pittsburgh** (`pitt-basketball.json`) — 197 players / 442 rows, 1994–2026.
  - **VCU** (`vcu-basketball.json`) — 198 players / 420 rows, 1994–2026. The lone
    **non-power-5** school (Atlantic 10; `School.power5 = false`) and fields no
    football. Conferences over the span: Metro (through 1995) → CAA (1996–2012) →
    Atlantic 10 (2013+) — so the 1994/1995 season-ending rows are Metro-era.
    Stats follow the same priority (official/Wikipedia → SR per-player page → ESPN
    keyless API for recent players). **Honors** for these were re-derived award-first
    from Sports-Reference's own per-conference award pages — see **Honors: the
    SR-award-page route** below.

### Honors: the SR-award-page route (and its gotchas)

The most reliable way to populate `honors` is to re-derive them from
**Sports-Reference's per-conference award pages**, then verify any All-American
against the player's own SR page. A prior human/LLM "research pass" is unreliable
in BOTH directions — in one session it both **omitted ~13 real honored VCU
players** and **fabricated 4 Pitt All-Americans** (only DeJuan Blair's consensus
AA was real). Operational details that bit us:

- **URLs moved to `/cbb/awards/men/<slug>.html`** — the old `/cbb/awards/<slug>`
  now 301-redirects, so fetch with `curl -L` and the `/men/` path.
- **All-conference page:** table `id="all-conf"`; the team level (1st/2nd/3rd)
  lives in separator rows `<tr class='thead'><td colspan=20>1st Team</td>`. **SR
  has NO Honorable Mention section** — HM can't be SR-verified (use Wikipedia /
  official conference releases for HM).
- **Single-award page ids:** `conf-poy`, `conf-dpoy`, `conf-roy`,
  `conf-sixth-man`, `conf-all-defense`, `conf-all-frosh`.
- **Slug quirks:** the CAA is `coastal` on SR.
- **Co-/tied winners** are marked `"(T)"` in the season cell (e.g.
  `"2001-02 (T)"`) — an exact-string year filter MISSES these. (Brandin Knight's
  2002 Big East POY is a real shared award, not a fabrication.)
- **Name suffixes:** SR omits generational suffixes (Jr./Sr./II/III/IV), so a
  name-normalizer must strip them to match roster names — and check for collisions
  after stripping.

## Football (1994+) — LIVE on the official-site pipeline

Football is **live** with real, per-season sourced data:
`src/data/michigan-football.json` (`_provisional: false`) is built from
**mgoblue.com** (the official athletics site — the top-priority source class)
via a reusable pipeline plus a scripted curation pass, with **Sports-Reference**
backfilling 1994–96 and repairing a handful of broken official rows. Schema =
`FbPlayer`/`FbSeason` (`src/types.ts`): **one row per season** a player is
represented by (totals), exactly like basketball, so the engine credits a player
by their best season **within the spun window** — never an out-of-era line.
Positions are QB/RB/WR/TE (offense) and DE/DT/LB/CB/S (defense).

The dataset guard (`src/data/football-dataset.test.ts`) enforces per-season
shape (sorted, unique, inside tenure), position-relevant stats, a **rushing
line on every QB season** (`rushYds`+`rushTD`; net can be negative — the NCAA
counts sacks against rushing), tenure coverage (every year has a row or a
declared `redshirtYears` entry), per-window Hall's-condition coverage over the
live 1994+ wheel, and a real `http(s)` `source` on every season row.

### Why mgoblue.com, and the 1997 defensive floor

- **mgoblue.com** publishes official per-player cumulative season stats —
  passing/rushing/receiving AND the full defensive box score (tackles, TFL,
  sacks, INT, PBU, FF) — for **1997 onward**. The pages are server-rendered
  Nuxt/Sidearm pages with a parseable `__NUXT_DATA__` payload; no API key.
  This beats the previous CFBD pipeline, whose defensive box scores only start
  in 2016 (that pipeline, `scripts/fetch-football.mjs`, is retained for schools
  without a Sidearm stats archive).
- **1994–96**: Sports-Reference season pages carry complete offense tables
  (passing / rushing & receiving, all players) — used as the cited source for
  those seasons. **Per-player defense (tackles/TFL/sacks) before 1997 is not
  published by any citable source** (SR has INT-only; Bentley/Wikipedia are
  sparse), so pre-1997 defenders carry INT-only lines where SR has them. This
  is a documented data floor, not a sourcing slip.
- **Eligibility is season-ROW-based** (`playerInWindow` checks rows, not tenure
  overlap), so the 1994–96 windows still fill every defensive slot from the
  1997 season rows they contain, and a window can never show stats from outside
  its own years.
- **Rolling 4-year windows** from **1994** (same floor as basketball) to the
  dataset's max year — eras 1994–97 … 2021–24.

### Step 1 — pull the official draft (`scripts/fetch-football-mgoblue.mjs`)

```bash
node scripts/fetch-football-mgoblue.mjs --site https://mgoblue.com \
  --start 1997 --end 2024 --out scratchpad/mich-fb.json
```

Per year it parses the stats page (`/sports/football/stats/<year>`) and roster
(`/sports/football/roster/<year>`), joins them on Sidearm's stable person id
(season bio ids change year to year; truncated "Last, F" rows are expanded
against the roster), maps categories into `FbStats` keys, merges players across
years, and emits per-season rows (each `source` = that year's stats URL) plus a
per-window coverage report. The composite table **mirrors
`src/lib/football-rating.ts`** — keep the two TERMS tables in sync.

### Step 2 — curate (scripted, with a hand-verified override map)

The curation pass (scratchpad script; its inputs/decisions are recorded in the
dataset `_note` and this doc) does, in order:

- **Repair mgoblue mislinks.** The official payload occasionally attaches a
  stat line to the wrong player's bio (e.g. Frank Clark's 2014 line under a
  center's name; Marquise Walker's 1999–2000 receiving under a nonexistent
  "Tommy Jones"). Every repair was verified against SR's table for that year;
  repaired/reassigned rows carry the **SR page as `source`** so numbers always
  match their citation.
- **Merge SR 1994–96** rows (offense + INT-only defense) by name.
- **Resolve positions**: hand override map (agent-verified with citations) >
  the previous hand-verified dataset > roster `positionShort` votes > SR `pos`
  column. Coarse codes (`DB`/`DL`) are never defaulted — unresolved players
  above the composite floor were individually verified; low-confidence
  marginal players are **dropped** (better to omit than ship a wrong position).
- **Cross-validate vs SR**: every overlapping player-season is compared; a
  defender whose tackles diverge wildly is repaired from SR. (Small deltas are
  bowl-game scope — SR excludes bowls before 2002; mgoblue's inclusion varies
  by vintage. Each row matches its own cited page.)
- **Offensive players keep only offensive keys** for 2005+ unless SR
  corroborates their defensive stats (kills mislinked phantom lines while
  keeping real two-way seasons).
- **QB rushing**: every QB season carries `rushYds`/`rushTD` (0 when the
  rushing table has no row — the tables are exhaustive, so absence = none).
- Trim below a small composite floor, de-collide same-name ids with a
  `-<firstYear>` suffix (two different Will Johnsons exist), auto-declare
  interior tenure gaps as `redshirtYears`, and verify Hall's-condition
  coverage per rolling window before writing.
- **`redshirtYears` semantics are broad by design**: an auto-declared gap
  year means "no ratable season row" — an actual redshirt, an injury year,
  a position-switch year with no line at the listed position, or a season
  the source's tables simply don't credit. They are NOT individually
  verified redshirt designations; treat them as coverage bookkeeping, not
  biography. (The tenure guard accepts them so a real gap in sourcing still
  fails CI loudly.)

### For a new school

1. Check whether the school's athletics site is Sidearm with a stats archive
   (`<site>/sports/football/stats/<year>`) and find its floor year; run
   `fetch-football-mgoblue.mjs --site <url>`. Otherwise fall back to the CFBD
   pipeline (`fetch-football.mjs`, needs `CFBD_API_KEY`, defense 2016+ only) —
   it emits the same per-season `FbSeason[]` draft shape.
2. Backfill pre-floor years from SR season pages (offense is complete there).
3. Build the position override map for coarse/ambiguous defenders from citable
   sources; drop what can't be verified.
4. Set `_provisional: false` once the guard test is green.

### Sources & honors

- **`source` per season row** = the exact page the numbers came from: the
  year's mgoblue stats URL, or the SR season page for 1994–96 rows and
  SR-repaired rows. SR remains fine to verify or fill long-tail lines per the
  SR policy above — no bulk mirroring of their database.
- **Honors are per-season and award-first**: derived from Wikipedia's per-year
  "YYYY All-Big Ten Conference football team" and "YYYY College Football
  All-America Team" articles plus the Big Ten individual-award and Silver
  Football pages, formatted to the same strings basketball uses
  ("First-Team All-Big Ten (YYYY)", "Consensus All-American (YYYY)", …).
  Extraction is agent-assisted but **verified by a programmatic wikitext
  re-derivation** over every year — the verification diff caught 13 agent
  omissions (incl. Hutchinson's and Ojabo's 2021 first-team nods) and zero
  fabrications; never trust a research ledger unverified (see the honors
  memory note). All-conference honors keep the HIGHEST team level across the
  coaches/media selectors. OL/specialist selections are recorded in the
  ledger but have no dataset row to land on (not draftable positions).

### Florida (1994–2025) — third live football school

`src/data/florida-football.json` (493 players) follows the same pipeline +
curation recipe; full provenance lives in the dataset `_note`. Source map:

- **2006–2025**: floridagators.com Sidearm stats/roster payloads
  (`fetch-football-mgoblue.mjs --site https://floridagators.com`, floor 2006),
  then **cross-validated player-by-player against SR season tables** — the
  audit exposed the payload's Sidearm bio-mislinks (Hargreaves' 2013 freshman
  line under a kicker's bio, Trey Burton's 11-TD 2010 under a walk-on, Will
  Grier's 2015 passing under a DB, a near-fully mislinked 2021 payload). The
  repair: 31 mislinked rows deleted, 42 diverging rows replaced with the SR
  line, 45 missing owner-seasons installed from SR — 83 season rows across 70
  players cite the SR page they were verified against. SR has no PBU before
  2013, so official PBU stands there.
- **1996–2005**: Wayback-archived **official** gatorzone.com sources — per-year
  history pages (1996 offense, 1998), `stats/team.pdf` + `defe.pdf` (1999),
  `history/<year>/team.pdf`/`stats.pdf` packages (2000–2005), and
  `notes/final/2002.pdf` for the 2002 defense. Every parsed table validated
  against its printed totals row. The archived 1997 pages are mid-season
  ("After 10 Games") and deliberately unused — 1997 comes from the 1998 media
  guide instead.
- **1994–1995** (+ final 12-game 1996 defense, 1997): transcribed from the
  digitized official **media guides** (Internet Archive item
  `01-florida-gators`) at full page-scan resolution, validated by the guides'
  own per-row BP checksum (BP = TTFL+FH+FF+FR+BLK+PD+INT), exact column
  totals, and the printed AVG columns; the pure-defense 1996 rows cite the
  guide (the archived gatorzone `defe1996` capture is 11-game and unused).
  UF credited fractional sacks in halves AND thirds — Kevin Carter's
  11.8 (= 11⅚) 1994 sacks are confirmed by the archived UF record book.
- **Honors** were derived **programmatically from Wikipedia wikitext** (the
  Florida All-Americans list with its consensus/unanimous color legend,
  per-year All-SEC articles 1994–2025 keeping the highest AP/Coaches level,
  national-award winner tables, SEC individual awards). The Davey O'Brien
  Award (Wuerffel ×2, Tebow) was new to the honor systems and is now scored
  (`fbHonorTier`) and badged (`honors.ts`) with tests.

### Virginia Tech (1994–2025) — fourth live football school

`src/data/vt-football.json` (398 players). VT's platform is **wmt.games (WMT
Digital), not Sidearm** — the mgoblue fetcher doesn't apply; the pipeline
lives in `data-work/vt/` (scripts + parsed checkpoints + `PROGRESS.md`, all
committed so the work is session-restartable). Source map:

- **1994–2012**: Wayback captures of the old hokiesports.com per-year season
  cumes (`/football/stats/<year>/?season`, 2018 snapshots) — **full official
  offense AND defense every year, including pre-1997 tackles/TFL/sacks** that
  no citable source had for Michigan or Pitt. Every parsed column is
  validated against the page's printed Total row; each row cites its
  snapshot URL.
- **2013–2025**: the WMT API behind hokiesports.com
  (`api.wmt.games/api/statistics/teams/<id>/players`, official NCAA-fed
  season totals; team ids are keyed by ACADEMIC year = season + 1). Rows cite
  the hokiesports stats page. `pbu` maps from sPassesBrokenUp (pure
  breakups, NOT sPassesDefended = PBU + INT).
- **Cross-validation vs SR** (all 32 season pages archived in
  `data-work/vt/sr-html/`; 1997's individual tables were never archived so a
  fresh Save-Page-Now capture was minted): holes/phantoms all resolved to SR
  name variants or correctly-excluded K/P/OL players; one impossible WMT row
  repaired from SR (Burmeister 2021 rec line). Remaining deltas are
  bowl/coverage scope — each row matches its own cited page.
- **Positions**: WMT rosters/stats fine codes (2002+), SR fine codes, then a
  **per-player cited research pass** for 155 players (citations in
  `data-work/vt/positions-override.json`; VT's Rover/Whip hybrids map to S
  unless sourced as edge). Six above-floor players whose DE/DT or CB/S split
  no citable source pins down were **dropped rather than guessed** (largest:
  Ryan Smith 1997–98, confirmed DL but never split). The one-position-per-
  career schema flattens documented mid-career switches (Chancellor, Gray,
  Sorensen, D.J. Parker et al. are labelled by their settled/known role);
  the sharpest case is **Jimmy Williams (2002–05)**: labelled CB (his
  unanimous-All-American 2005 position) though his two highest-tackle
  seasons (2002–03) were at free safety — so his CB rating leans on
  safety-year tackle totals. Flagged from the adversarial review; revisit if
  per-season positions ever land in the schema.
- **Honors** (218 per-season strings) are derived **programmatically from the
  sources**, never a hand ledger:
  - **1994–2015 — the OFFICIAL site** (Wayback): `awards.html` gives the
    per-year all-conference teams (Big East through 2003, ACC from 2004;
    where two selectors are listed — ACSMA/media and coaches — the **highest
    team level wins**) plus the conference individual awards (POY / Offensive
    / Defensive / Special Teams / Rookie). `allamericans.html` gives the
    All-Americans, and its own **C/U legend** supplies Consensus /
    Unanimous. Only **first-team** All-America selections are recorded (the
    same convention the other schools use), and its academic-AA table is
    excluded.
  - **2016–2025 — Wikipedia**: per-year All-ACC articles (2017 and 2020–23
    live under the long-form "All-Atlantic Coast Conference" title), parsed
    with a **rowspan-aware wikitable reader** — the naive "cell before the
    school" read grabs a class column ("So."/"Sr.") in the years that have
    one. Plus the national hardware (Corey Moore's 1999 Lombardi + Nagurski).
    Wikipedia lists no honorable mentions, so HM exists only through 2015.
    The official All-America list also ends at 2015 — the per-year national
    All-America articles (kept in `honors-wiki/`) are the audit trail for the
    gap: VT has **no first-team All-American at a draftable position in
    2016–2025** (the lone VT name is Christian Darrisaw, 2020, one selector,
    an OL).
  - **Verified two ways.** `verify-honors.mjs` re-derives every shipped string
    from the ledgers and diffs the dataset (**0 phantoms, 0 omissions**) — but
    that only proves the attach step is faithful to the ledgers, since it
    shares their name-matching and team-level rules. Source-level correctness
    is a _separate_ check: the parsers assert their source layouts (a markup
    change throws rather than silently mis-parsing), and a sampled independent
    fact-check of 14 marquee honors against the public record came back
    **14/14 confirmed**.
    Unmatched ledger entries are all kickers/punters/OL (positions the game
    doesn't carry) or players trimmed below the composite floor.

### North Carolina (1994–2025) — fifth live football school

`src/data/unc-football.json` (421 players, 139 honors). The pipeline is
committed at `data-work/unc/` (scripts + parsed checkpoints + `PROGRESS.md`).

**The 1994–99 defense problem, and how it was actually solved.** No structured
database publishes UNC's per-player defense before 2000: Sports-Reference's
tackle table starts in **2005**, cfbstats in 2005, CFBD around 2002, and the
archived official site has no cume page before 2000. That is not a quirk of any
one site — **the NCAA did not centrally compile individual defensive statistics
until ~2000**. Tackles, TFL and sacks were kept by each school's sports
information department and published in exactly one place: **the school's own
printed media guide**.

Those guides are digitized, and this is the trap that made them look
unavailable — there are **two** Internet Archive item runs:

| item id                                      | what it actually is                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `north-carolina-football-<year>-media-guide` | **cover image only** (0–7 files, no PDF) — a decoy                                            |
| `carolinafootball<year>unse`                 | the **real full scan** (PDF + OCR), collection `ncunc`, scanned by UNC Libraries, open access |

A guide published in year _N_ prints the **final defensive statistics for season
N−1** (and the roster for season _N_), so guides 1995–2000 cover seasons
1994–1999 — exactly the gap. This is where the whole 1994–99 defensive box score
comes from: tackles, TFL, sacks, PBU for every player on the team.

**Read the geometry, not the text.** The `_djvu.txt` rendering of these pages is
column-major and _ragged_ — OCR silently drops individual cells, so the Nth
number in a column does not belong to the Nth player, and zipping those lists
would move a real player's stats onto someone else. The parser instead works
from `_djvu.xml` (a bounding box per word) and rebuilds each table
geometrically. Each of the seven books is broken in its own way (one page is
**rotated**; another's baseline **drifts 30px** across the page, which splits its
header row; the mid-90s tables **centre** numbers under wide headers while the
later ones are left-aligned), so `parse-guides.mjs` tries each plausible reading
and **scores it against evidence**, keeping the one the data confirms:

- every row must satisfy **T + A = Hit** (a row with no printed total is dropped,
  never reconstructed — that fallback once turned a misread "1 12" into 13
  tackles for a man who made 2);
- the rows must reconcile with the guide's own **printed team-total row**;
- the interception column must agree with **Sports-Reference**, which is
  independent and complete for these years;
- **TFL and sacks are printed as count–yards pairs** ("2-8", "12.5-56") while the
  neighbouring pressures column is a bare integer — so a bare number in the TFL
  column is provably a column shift. This is the only check that tests those
  columns on 1994–96, whose tables print no team total, and it is what caught the
  1994 table being read one column off.

**Verification.** The 1994–99 numbers come from a single source, so the pipeline
is proved on a season it does not need: **2000**, which we independently hold
from the official archived cume. `validate-guides.mjs` runs the guide chain over
the 2001 guide and diffs it against that cume — **all 67 stat values across 19
players match**. Interceptions are still taken from SR (complete for these years;
the guides' INT column has OCR holes). Forced fumbles are **deliberately not
taken**: the 1997/98 printings carry both a `CF` and an `FF` column with
different team totals and nothing says which is "forced fumbles", so the stat is
left absent rather than guessed. A missing stat is a hole; a guessed stat is a
lie.

This retired the old `record-book-supplement.json`, which could only scrape a
handful of leaderboard lines for the six stars in the all-time top tens. Worth
noting: every one of its ten hand-transcribed values is reproduced exactly by the
guides (Greg Ellis's 12.5 sacks in 1996, Ebenezer Ekuban's 23 TFL in 1998,
Brandon Spoon's 138 tackles) — it was simply far too thin.

Source map:

- **2016–2025** — goheels.com **is Sidearm**, so
  `fetch-football-mgoblue.mjs --site https://goheels.com` works unchanged (its
  stats pages carry no defensive block before 2016 — that's the Sidearm floor).
  The payload **mislinks defensive lines onto offensive players** (the Florida
  class: it credited WR Dyami Brown with 2 sacks and 4 TFL), so a defensive key
  from these years survives only if SR corroborates it — **451 fabricated keys
  were stripped**.
- **2005–2015** — Sports-Reference (full defense from 2005).
- **2000–2004** — the Wayback-archived **official** Automated-ScoreBook season
  cumes from the old site. Pre-2003 they're **date-named**
  (`stats/071102aaa.html` is the 2001 final), so they had to be _discovered_, not
  guessed: `classify-cumes.py` fetches every archived page and classifies it by
  its **printed scope** ("FINAL STATS" / "as of Dec 01, 2001") — never the
  capture date, since 2010/2011 survive only as mid-season captures (the Pitt
  trap) and are deliberately unused. Every parsed column is checksum-validated
  against the printed Total row.
- **1994–1999** — Sports-Reference for offense and interceptions, **official
  media guides** for the full defensive box (above).
- **The roster join is what unlocks the abbreviated eras.** The cumes print names
  abbreviated (`30 Thornton, D.`) and the mid-90s guide tables print only a
  surname and a position code (`Morton, lb`) — a surname is not a player (the
  1994 table alone has two Thomases and two Joneses). goheels keeps historical
  rosters back to 1997, **but they have holes** (its 1999 roster has 53 players
  and no Julius Peppers), and SR's 1994–96 roster pages are worse (the 1994 one
  omits Brian Simmons). So `parse-guide-rosters.mjs` reads each guide's **own**
  roster and the two are **unioned**. A row resolves only if the match is unique
  and position-consistent; anything ambiguous is reported, never guessed.
