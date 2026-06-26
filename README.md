# YourSchoolAllStars 🏀

A daily draft game for one school's all-time greats. Each day spins a sequence of
**4-year windows** from your school's history; you draft a starting five — **PG,
SG, SF, PF, C** — one player per round, each slot locking once filled. You get
**one re-spin**. The better and more balanced your five, the closer to a perfect
**40–0** season. First school up: **Michigan**.

It's the [40-0.com](https://www.20-0.com/40-0/) idea (and its football sibling
[16-0](https://www.20-0.com/16-0/daily)), narrowed to a single university — so
it's _your_ school's all-time team you're building.

> Independent fan project. Not affiliated with or endorsed by the University of
> Michigan. Player data is curated from public, license-clean sources.

## Status

**Playable.** A **university picker** themes the whole UI to your school
(Michigan maize/blue now; UNC Carolina blue queued). Michigan basketball runs on
**49 sourced players** (1994–2025); 5 thin-era roster cells are still being
filled (see
[`docs/DATA-SOURCING.md`](docs/DATA-SOURCING.md)). Football (2005+) and North
Carolina are staged behind the same engine.

## How to play

1. `npm install`
2. `npm run dev` → open `http://localhost:5173/YourSchoolAllStars/`
3. Hit **Play Today's Challenge**, draft a player each round, use your re-spin
   wisely, and see your projected record.

Add `?date=YYYY-MM-DD` to play any day's deterministic puzzle.

## How it works

No backend. The day (in **ET**) seeds a PRNG that picks the same windows for
everyone. A player's stat line + honors become a 0–100 rating; the five ratings
(PG and C weighted up) combine — with a **"no weak links"** penalty on your worst
starter — into a projected record out of 40. Full model and tunable constants in
[`docs/PLAN.md`](docs/PLAN.md) §Rating model.

## Develop

```bash
npm run dev          # local dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run (test-first — see CLAUDE.md)
npm run format       # prettier --write
npm run build        # what CI runs
```

Run `npm run typecheck && npm run lint && npm run format:check && npm test && npm
run build` before opening a PR. Contribution rules (TDD, **no fabricated stats**,
PR workflow) are in [`CLAUDE.md`](CLAUDE.md).

## Layout

- `src/lib/` — pure, tested engine: `windows`, `daily`, `rating`, `game`, `share`.
- `src/data/` — curated datasets + integrity guard.
- `src/App.tsx` — the React shell (Landing → Playing → Results).
- `docs/` — `PLAN.md`, `DATA-SOURCING.md`, `BACKLOG.md`, `QUESTIONS-FOR-ALEX.md`.

## Tech

React + TypeScript + Vite, static-hosted on GitHub Pages. CI gates on build /
typecheck / lint / test / secret-scan. Mirrors the KnowYourCity working agreement.
