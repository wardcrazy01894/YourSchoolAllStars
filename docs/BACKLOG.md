# Backlog

Roughly priority-ordered. Pull items into PRs; keep each PR small.

## Now (to launch Michigan basketball)

- [ ] **Curate the full basketball dataset** (1994+), sourced. Replace the
      provisional seed; set `_provisional: false`. (`docs/DATA-SOURCING.md`)
- [ ] **Flip the dataset coverage guard** to require ≥1 player per
      window×position; fix any gaps the curation surfaces.
- [ ] **Calibrate the rating curve** against real spins (Q1 in QUESTIONS).
- [ ] **Create the GitHub repo**, get CI green, apply branch protection, deploy
      to Pages.

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

## Multi-school (M6)

- [ ] **School registry** (`schools.json`: id, name, colors, sports, datasets) so
      the engine is school-agnostic; landing becomes a school picker.
- [ ] **North Carolina** basketball dataset.
- [ ] Per-school theming (UNC Carolina blue).

## Engine / quality

- [ ] Multi-position eligibility (combo guards) if Alex wants it (Q2).
- [ ] Bug-report flow (reuse KnowYourCity's worker pattern) for stat corrections —
      crucial for a stats game.
- [ ] Provenance viewer: click a player to see their `source`.
