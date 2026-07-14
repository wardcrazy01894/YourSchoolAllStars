# Backlog

Roughly priority-ordered. Pull items into PRs; keep each PR small.

## Now (to launch Michigan basketball) — DONE

- [x] **Curated basketball dataset** — Michigan = 95 sourced players / 259 rows,
      `_provisional: false`.
- [x] **Fill the `KNOWN_GAPS`** — every window×position AND year×position cell now
      has a player; the guard lists are empty `[]`. (`docs/DATA-SOURCING.md`)
- [x] **Rating curve calibrated** — the ~4% perfect target was **retired** (Alex,
      2026-06-26) for a more forgiving curve (undefeated cutoff 85, pivot 57,
      winless floor 30). Tuning lives in `src/lib/rating.ts`.
- [x] **GitHub repo + CI green**, repo **public**, branch protection on, Pages
      deploy live (`.github/workflows/deploy.yml`).
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

## Football (M6) — LIVE on four schools

- [x] Football types + 12-slot roster (QB/RB/WR/TE + 2 flex; DE/DT/LB/CB/S + 1
      flex), windows from 2005 (`src/types.ts`, `src/lib/football.ts`).
- [x] Football rating model + draft state machine + UI (`football-rating.ts`,
      `football-game.ts`, `football-result.ts`, `App.tsx`).
- [x] **Curated (non-mock) football datasets** — Michigan, Pittsburgh, Florida,
      and Virginia Tech all ship real per-season data (1994+, `_provisional:
false`) with a cited `source` on every row and per-season honors. See
      `docs/DATA-SOURCING.md` for each school's source map.
- [x] **UNC football dataset** — North Carolina ships real per-season data
      (1997+, see DATA-SOURCING for why the floor is 1997) and has auto-joined
      Full Football. **Every live school now ships both sports.**

## Multi-school

- [x] **School registry** (`src/schools.ts`) + picker landing + per-school CSS
      theming. Engine is school-agnostic.
- [x] **Six basketball schools live** — Michigan, North Carolina, Florida,
      Virginia Tech, Pittsburgh, VCU (VCU non-power-5, no football). Each ships a
      real, gap-free, sourced dataset.
- [x] **Full (cross-school) modes** — Full Basketball + Full Football spin a
      team AND an era each round, pooling every school with a real dataset.
- [ ] **More schools** — the six live schools now ship every sport they field
      (VCU has no football team). Adding a NEW school is the next frontier;
      `data-work/unc/` and `data-work/vt/` are the committed recipes.

## Engine / quality

- [x] **Multi-position eligibility ENGINE + UX**: players carry optional
      `eligible: BballPosition[]`; draft is pick-player-then-tap-slot
      (`draftToSlot`). Done in gameplay v2.
- [ ] **Populate `eligible` in the data**: tag combo players (e.g. a PG who also
      played SG) so the new multi-slot draft actually has choices to offer.
- [ ] Bug-report flow (reuse KnowYourCity's worker pattern) for stat corrections —
      crucial for a stats game.
- [ ] Provenance viewer: click a player to see their `source`.
