# Backlog

Roughly priority-ordered. Pull items into PRs; keep each PR small.

## Now (to launch Michigan basketball)

- [x] **Curated basketball dataset** — 49 sourced players, `_provisional: false`.
- [ ] **Fill the 5 `KNOWN_GAPS`** (window×position cells with no player) so the
      guard empties to `[]`. Gap-fill pass running. (`docs/DATA-SOURCING.md`)
- [ ] **Calibrate the rating curve** to ~4% perfect once gaps are filled.
- [x] **GitHub repo + CI green** (private). Branch protection + Pages deploy
      deferred until the repo goes public (after gaps filled).
- [x] **University picker + per-school theming** (`src/schools.ts`).

## Daily polish

- [ ] **One-shot daily persistence** + streaks (localStorage), so the Daily is a
      single attempt and reload restores your result.
- [ ] **"Yesterday's solution"** panel (an optimal/strong five for the prior day).
- [ ] **Spin animation** (slot-reel feel) on each round, matching 40-0's spin.
- [ ] **Sound feedback** (Web Audio, no files) on draft / great result, like
      KnowYourCity's `sound.ts`.
- [ ] **Leaderboard** (future, needs a tiny worker) — same Cloudflare pattern as
      KnowYourCity.

## Modes

- [ ] **Classic free-play** (random spins, replayable) and **Hoops IQ**
      (stats-hidden) toggle.
- [ ] **"By position" draft view** (40-0 has it).

## Football (M5)

- [ ] Football types + 12-slot roster (QB/RB/WR/TE + 2 flex; DE/DT/LB/CB/S + 1
      flex), windows from 2005.
- [ ] CFBD ingestion script (offense + 2005+ defense), provenance per row.
- [ ] Football rating model (separate position weights; out of 16 games).

## Multi-school

- [x] **School registry** (`src/schools.ts`) + picker landing + per-school CSS
      theming. Engine is school-agnostic.
- [ ] **North Carolina** (Tar Heels) and **Florida** (Gators) — both in the
      registry/themed ("coming soon"); add datasets to go live. Target end state:
      **all 3 schools × both sports** (basketball + football).

## Engine / quality

- [ ] **Adjacent-position eligibility** (DECIDED): a player fills their primary
      or an adjacent slot (PG↔SG↔SF↔PF↔C); draft UX = pick player → tap an open
      highlighted slot. Engine `eligiblePlayers` + `game.draft` + UI change.
- [ ] Bug-report flow (reuse KnowYourCity's worker pattern) for stat corrections —
      crucial for a stats game.
- [ ] Provenance viewer: click a player to see their `source`.
