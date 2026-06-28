# YourSchoolAllStars — Plan & Architecture

## What it is

A daily, no-backend, share-friendly draft game in the family of
[20-0.com](https://www.20-0.com/) (whose **40-0** = college basketball and
**16-0** = college football), but scoped to **one school at a time**. Six
basketball schools are live (Michigan — the default — plus North Carolina,
Florida, Virginia Tech, Pittsburgh, and VCU); **football (2005+)** is playable on
a MOCK/provisional Michigan dataset behind a per-school sport picker. All run on
the same engine contracts.

Because the school is fixed, the "spin" is a **4-year year-window** rather than a
team+era spin.

## The reference games (captured by playing them)

**40-0 (college basketball) — the basketball template:**

- 5 rounds. Each round spins a window; draft ONE player into a starting five:
  **PG, SG, SF, PF, C**. Pick a player, tap a highlighted slot; the slot locks.
- **One re-roll** per game (`Reroll (1)`).
- Sort the pool by **PTS / REB / AST / STL / BLK**.
- Player rating "bakes in the entire season — every stat plus All-American
  honors." Premium positions weigh more: **PG ×1.15, C ×1.1**, wings ×1.0.
- "No weak links — your record comes from all five starters; one weak spot costs
  games." Rating → projected record; perfect = **40-0**. "Only 4% go undefeated."
- Modes: **Classic** (stats shown), **Hoops IQ** (hidden), **Daily** (same spins
  for everyone, one shot, new at midnight ET).

**16-0 (college football):** "build your best **12-player roster**." Maps to
Alex's spec: 4 offense (QB/RB/WR/TE) + 2 flex, 5 defense (DE/DT/LB/CB/S) + 1 flex.

## Locked decisions (ratified by Alex — do not relitigate)

- **Windows: 4-year, non-overlapping**, from 1994. Basketball → 1994–97, 1998–01,
  … 2022–25 (8 windows). "One window ≈ one college career."
- **Football starts 2005** (defensive stats — tackles/sacks — don't reliably
  exist before ~2005 at any source). Basketball is 1994+.
- **Best single season** represents each player (matches 40-0).
- **Full basketball rosters at launch**: each season's starters + key rotation
  (~7/season), ~200–250 unique player-records, all **sourced, not fabricated**.
- Stack mirrors KnowYourCity: **React + TS + Vite**, static **GitHub Pages**,
  deterministic daily seed (no backend), CI (build/typecheck/lint/test/secret),
  branch protection, TDD. Repo `wardcrazy01894/YourSchoolAllStars`.
- **Difficulty (revised 2026-06-26, Alex): a more forgiving curve.** The original
  "~4% perfect" target is retired — the win curve was intentionally eased so a
  strong, balanced five is rewarded with a 40-0 (undefeated cutoff at a displayed
  85; pivot 57) — and a winless floor (a sub-30 overall goes 0-40). Tuning lives in
  `rating.ts`. A conference-strength penalty (power-5 vs not) pulls non-power-5
  schools back down via a flat haircut on every player rating (`School.power5`).
- **Modes at launch: Daily + Classic + Hoops IQ.** Daily = one-shot per ET day
  with streaks; Classic = free-play, replayable random spins (own seed); Hoops IQ
  = stats hidden.
- **Adjacent-position eligibility.** A player may fill their primary slot or an
  adjacent one (PG↔SG, SG↔SF, SF↔PF, PF↔C) — drafting is "pick a player, then tap
  a highlighted open slot." (Also softens thin-window coverage.)
- **University picker + per-school theming.** Landing is a school picker; the UI
  re-themes to the chosen school (Michigan maize/blue, UNC Carolina blue). Schools
  live in a registry (`src/schools.ts`); adding one = one entry + its dataset.

## Architecture

```
src/
  types.ts            domain types (Sport, BballPosition, BballPlayer, YearWindow)
  lib/
    windows.ts        window config (buildWindows) + eligibility (tenureOverlaps, playerInWindow)
    daily.ts          getDateKey (ET), seeded PRNG (mulberry32), generateSpins (fixed era sequence)
    rating.ts         stat line → player rating → team strength → projected record
    game.ts           pure draft state machine (initDraft, draftToSlot, skip, isPickable, …)
    share.ts          Wordle-style spoiler-free share string
  data/
    michigan-basketball.json   curated player dataset (95 players / 259 rows, sourced)
    {unc,florida,vt,pitt,vcu}-basketball.json   the other five live schools
    michigan-football.json     MOCK/provisional football seed (curated data pending)
    index.ts                   typed loader (one Dataset per school)
    dataset.test.ts            integrity guard (shape, coverage, completeness, tenure)
  schools.ts          school registry + per-school theme tokens + applyTheme()
  App.tsx             React shell: Picker → Landing → Playing → Results
```

### Daily determinism

`seedFor(dateKey, sport)` hashes the ET date → a `mulberry32` seed.
`generateSpins(seed, count, windows)` draws the day's FIXED era sequence —
`count = DAILY_BBALL_ERAS = 6` (5 starters + 1 skip). Everyone on a given ET day
gets the same six eras in the same order. Stability caveat: spins are a pure
function of the window list, so changing the window config shifts past/future
puzzles — acceptable for a friends game.

### Rating model (ours; 40-0's is proprietary) — all constants in `rating.ts`

1. **Composite** = weighted stat line. Rarer stats weigh more:
   `pts×1.0 + reb×1.2 + ast×1.5 + stl×3.0 + blk×3.0`, plus an **honors bonus**
   (best tier per honor: e.g. National POY +12, Consensus AA +9, all-conf +3).
2. **Player rating** ∈ [0,100] via a diminishing-returns curve:
   `100·(1 − e^(−composite/22))` — elite seasons separate at the top, no hard cap.
   2b. **Conference strength (power-5 penalty).** A non-power-5 school's production is
   discounted — 17 ppg in the Big Ten is worth more than 17 ppg in the Atlantic 10.
   It's a binary per school (`School.power5`): non-power-5 schools take a flat
   `×0.95` haircut on every FINAL player rating (`NON_POWER5_RATING_FACTOR`), applied
   at the player level so per-position RTG, team strength, and record all reflect it.
   VCU (Atlantic 10) is the lone non-power-5 school today; a VCU 40-0 is hard by
   design (a five of 85-rated players drops to an 81-rated team after the haircut,
   just under the 85 team-strength undefeated cutoff). (Alex, 2026-06-26.)
3. **Team strength** blends the position-weighted mean (PG ×1.15, C ×1.1) with the
   **worst starter** (`0.75·mean + 0.25·min`) so one hole still costs you ("no weak
   links") — eased from `0.4·min` to `0.25·min` (Alex, 2026-06-26) so a single soft
   spot dents a strong four by ~5 pts rather than ~8.
4. **Projected record**: logistic win prob `1/(1+e^(−(strength−57)/7.5))` × 40 games,
   with two overrides keyed off the **displayed (rounded) overall**: **85+ runs the
   table (40-0)**, and **below 30 goes winless (0-40)**. Strength 57 = coin-flip
   (20–20); 80 ≈ 38 wins; 85+ = undefeated; ≤29 = 0-40.
   Grades: PERFECT / HISTORIC / ELITE / SOLID / BUBBLE / LOTTERY. (Eased 2026-06-26,
   Alex — pivot 60→57, undefeated cutoff 90→85, winless floor at 30; see `rating.ts`
   for the constants.)

These are tunable; calibrate against real spins once the full dataset lands.

### Draft flow (`game.ts`)

`DraftState` holds the fixed era sequence (`windows`), a `cursor` into it, the
five position slots, and picks. At each era you **pick a player, then choose an
open slot** they're eligible for (`draftToSlot`) — a player may be eligible for
several positions (`eligible?: BballPosition[]`; a combo guard at PG or SG), so
the UI is select-player-then-tap-slot. `skip` advances the cursor without
drafting; with 6 eras for 5 slots you get one safe skip (`safeSkipsLeft`). The
pool shows EVERY player whose tenure overlaps the era — including those whose slot
is already filled (greyed, `isPickable` false) so you still see who was around.
All pure, all tested.

## Football (16-0)

Same engine shape as basketball, onto a **12-man roster** (`FB_SLOTS`):

- **Offense (6):** QB · RB · WR · TE · FLEX · FLEX. The two FLEX slots accept
  RB/WR/TE.
- **Defense (6):** DE · DT · LB · CB · S · FLEX. The defensive FLEX accepts any
  defender (DE/DT/LB/CB/S).
- **Windows: 4-year from 2005** (`FB_WINDOWS` = 2005-08 … 2021-24). Defensive
  box-score stats (tackles/sacks) aren't reliable before 2005 — hence the start.
- **12 rounds** (one per slot). Draft = pick an eligible player, drop into an open
  slot their position fits (single-position or FLEX).
- **Draft order: all 6 offense first, then all 6 defense** (`OFFENSE_SLOT_IDS`
  then `DEFENSE_SLOT_IDS`; `sideForRound`).
- **One re-spin per side** (`FB_RESPINS_PER_SIDE = 1`): a fresh re-spin for the
  offensive half and another for the defensive half; an unused offensive re-spin
  does not carry over. (Basketball stays at one re-spin for the whole game.)
- **Stats** (`FbStats`, heterogeneous, per-position columns):
  - QB: pass yds/TD/INT (+ rush yds/TD for runners like Denard).
  - RB: rush yds/TD (+ rec/yds/TD). WR/TE: rec/yds/TD.
  - Defense: tackles, TFL, sacks, INT, PBU, FF.
- **Rating (built — `football-rating.ts`):** because stats differ by position,
  each position gets its own normalized 0→100 curve off fixed anchors (e.g. a
  1,000-yd rusher, a 10-sack edge, a 4,000-yd passer all map high), then the same
  weak-link-penalized team strength → projected record **out of 16**. Premium
  slots (QB, and an edge rusher) can carry a small multiplier, TBD at calibration.

Football is **playable** end-to-end: `src/types.ts`
(FbPosition/FbStats/FbPlayer/FB_SLOTS), `src/lib/football.ts` (FB_WINDOWS, slot
eligibility incl. FLEX), `football-game.ts` (draft state machine),
`football-rating.ts` + `football-result.ts` (rating → record out of 16), the
football UI in `App.tsx`, and a MOCK/provisional `michigan-football.json` seed —
all tested. **Still to build: a curated (non-mock) football dataset.**

## Milestones

- **M1 — Basketball vertical slice (DONE):** engine + tested rating/draft +
  playable React UI. Verified end-to-end (37–3 HISTORIC under the original,
  pre-2026-06-26 curve — the eased curve would score that roster higher).
- **M1.5 — School registry + picker + theming (DONE):** `schools.ts`, picker
  landing, per-school CSS theming. Six schools live (Michigan, UNC, Florida, VT,
  Pitt, VCU).
- **M2 — Full basketball dataset (DONE):** Michigan = 95 sourced players / 259
  season rows, `_provisional: false`, **zero coverage gaps** (every window ×
  position AND year × position filled; the `dataset.test.ts` coverage guards
  assert it). Win-curve eased per Alex (2026-06-26): undefeated cutoff 85, pivot
  57 — the old ~4% target is retired.
- **M3 — Modes:** Daily (one-shot + streaks) · Classic (free-play) · Hoops IQ.
- **M4 — Adjacent positions:** eligibility + "tap an open slot" draft UX.
- **M5 — Ship (DONE):** repo public, branch protection on, Pages deploy live
  (`.github/workflows/deploy.yml`).
- **M6 — Football (2005+) (PLAYABLE ON MOCK):** 12-slot roster, engine + rating +
  UI all built and playable on a MOCK Michigan seed; a curated (CFBD/Wikipedia)
  dataset is the remaining work.
- **M7 — More schools (6 LIVE):** Michigan, North Carolina, Florida, Virginia
  Tech, Pittsburgh, and VCU all ship real basketball datasets. End state: those
  schools × both sports (curated football data still to come), added over time.

## Open questions

Tracked in `docs/QUESTIONS-FOR-ALEX.md`.
