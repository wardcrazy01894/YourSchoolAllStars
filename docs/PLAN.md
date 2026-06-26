# YourSchoolAllStars — Plan & Architecture

## What it is

A daily, no-backend, share-friendly draft game in the family of
[20-0.com](https://www.20-0.com/) (whose **40-0** = college basketball and
**16-0** = college football), but scoped to **one school at a time**. v1 is
**Michigan basketball**; football (2005+) and **North Carolina** follow behind
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

## Architecture

```
src/
  types.ts            domain types (Sport, BballPosition, BballPlayer, YearWindow)
  lib/
    windows.ts        window config (buildWindows) + eligibility (playerInWindow, eligiblePlayers)
    daily.ts          getDateKey (ET), seeded PRNG (mulberry32), generateSpins / generateRerollSpins
    rating.ts         stat line → player rating → team strength → projected record
    game.ts           pure draft state machine (initDraft, draft, reroll, skipRound, …)
    share.ts          Wordle-style spoiler-free share string
  data/
    michigan-basketball.json   curated player dataset (currently PROVISIONAL seed)
    index.ts                   typed loader
    dataset.test.ts            integrity guard
  App.tsx             React shell: Landing → Playing → Results
```

### Daily determinism

`seedFor(dateKey, sport)` hashes the ET date → a `mulberry32` seed. `generateSpins`
draws one window per round; `generateRerollSpins` is a salted second pass giving
each round a guaranteed-different alternate for the single re-spin. Everyone who
loads the game on a given ET day sees the same spins. Stability caveat: spins are
a pure function of the window list, so changing the window config shifts past/
future puzzles — acceptable for a friends game.

### Rating model (ours; 40-0's is proprietary) — all constants in `rating.ts`

1. **Composite** = weighted stat line. Rarer stats weigh more:
   `pts×1.0 + reb×1.2 + ast×1.5 + stl×3.0 + blk×3.0`, plus an **honors bonus**
   (best tier per honor: e.g. National POY +12, Consensus AA +9, all-conf +3).
2. **Player rating** ∈ [0,100] via a diminishing-returns curve:
   `100·(1 − e^(−composite/22))` — elite seasons separate at the top, no hard cap.
3. **Team strength** blends the position-weighted mean (PG ×1.15, C ×1.1) with the
   **worst starter** (`0.6·mean + 0.4·min`) so one hole costs you ("no weak links").
4. **Projected record**: logistic win prob `1/(1+e^(−(strength−60)/8))` × 40 games.
   Strength 60 = coin-flip (20–20); ~85 ≈ 38 wins; perfection needs a strong,
   balanced five. Grades: PERFECT / HISTORIC / ELITE / SOLID / BUBBLE / LOTTERY.

These are tunable; calibrate against real spins once the full dataset lands.

### Draft flow (`game.ts`)

`DraftState` holds the per-round windows, the five position slots, picks, and the
reroll budget. `draft()` assigns a player to their (open, eligible) slot and
advances; `reroll()` swaps the current round's window once; `skipRound()` leaves a
hole if a window strands an open position (a guaranteed weak link). All pure,
all tested.

## Milestones

- **M1 — Basketball vertical slice (DONE):** engine + tested rating/draft +
  playable React UI on provisional data. Verified end-to-end (37–3 HISTORIC).
- **M2 — Full basketball dataset:** curate ~200–250 sourced Michigan players
  1994+; flip the dataset guard's coverage assertion to "every window×position
  has ≥1 player"; calibrate the rating curve.
- **M3 — Ship:** GitHub repo + CI green + branch protection + Pages deploy.
- **M4 — Daily polish:** localStorage one-shot persistence, streaks, "yesterday's
  solution", leaderboard (future), Hoops-IQ (stats-hidden) mode.
- **M5 — Football (2005+):** 12-slot roster, CFBD-sourced offense + 2005+ defense.
- **M6 — North Carolina:** second school behind the same engine (school registry).

## Open questions

Tracked in `docs/QUESTIONS-FOR-ALEX.md`.
