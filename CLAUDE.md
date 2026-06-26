# YourSchoolAllStars — working agreement

A daily draft game: spin a 4-year window of one school's history, draft an
all-time starting five (basketball) or 12-man roster (football), and see how
good a team you can build. First school: **Michigan**. See `docs/PLAN.md` for
architecture and `docs/DATA-SOURCING.md` for the data pipeline. This file is the
contract for how changes get made — it mirrors the KnowYourCity setup.

## Branch & PR workflow

- **All changes land via a Pull Request — never push directly to `main`.**
- Every PR runs these CI checks (must be green before merge):
  - **build / typecheck / lint** — `npm ci`, `tsc --noEmit`, `eslint`,
    `prettier --check`, `vite build`.
  - **test** — `vitest run`.
  - **secret scan** — gitleaks over the branch history.
- Branches **delete automatically on merge**. Use short-lived feature branches:
  `feat/…`, `fix/…`, `chore/…`, `docs/…`, `data/…`.
- Prefer **squash merge** to keep `main` linear.
- Branch protection (`bash scripts/protect-main.sh`): required + strict checks,
  conversation-resolution required, applies to admins, no force-push/deletion.
  Required approvals are **0** in GitHub (solo repo — you can't approve your own
  PR), so CI is the hard gate. The review below is the quality gate.

## Every PR gets reviewed before merge

CI green is necessary but **not sufficient**. Before merging any PR, run an
**adversarial review of the diff** and address what it finds:

- Use the **`adversarial-reviewer`** agent (or the **`/code-review`** skill) on
  the PR's diff — it actively hunts bugs, regressions, and unexamined
  assumptions, not just style.
- **Post the findings on the PR** (a comment or inline) so there's a record, and
  **resolve or fix** each one. Substantive fixes go in the same branch before
  merge; conversation-resolution is required by branch protection.
- Scale effort to the change: a docs/config one-liner gets a light pass; anything
  touching engine logic, the rating model, the draft state machine, or data
  integrity gets a full review. Trivial typo PRs can note "review: trivial".
- This is non-negotiable going forward (Alex's call) — no self-merging unreviewed
  code, even though GitHub lets a solo owner do it.

## How we write code — TDD is mandatory

Every behavior change is **test-first**: red → green → refactor. Keep game logic
in **pure functions** under `src/lib` (`windows`, `daily`, `rating`, `game`,
`share`) so it's unit-testable without the DOM; keep the React shell thin and
verify it manually / with Playwright. New logic without a failing-first test is
incomplete.

## Data integrity — NO fabricated stats

This is a stats game; wrong numbers poison it. **Every player row must carry a
real `source`** (a URL it was taken/verified from). If a stat can't be found,
omit the player — accuracy over completeness. The dataset guard test
(`src/data/dataset.test.ts`) enforces shape, uniqueness, and window coverage.
Prefer license-clean sources (Wikipedia CC-BY-SA, official `mgoblue.com` record
books). Sports-Reference's ToS forbids building a game on their data — read it to
verify a number, don't redistribute their database. See `docs/DATA-SOURCING.md`.

## Local commands

```bash
npm install          # first time
npm run dev          # local dev server (http://localhost:5173/YourSchoolAllStars/)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run (write the test first!)
npm run format       # prettier --write (format:check in CI)
npm run build        # typecheck + vite build (what CI runs)
```

Run `npm run typecheck && npm run lint && npm run format:check && npm test &&
npm run build` before opening a PR — exactly what CI gates on. A PostToolUse hook
auto-formats/lints `.ts/.tsx` on edit; after editing Markdown/JSON/`.mjs`, run
`npm run format` yourself (`format:check` covers them).

Playtesting: append `?date=YYYY-MM-DD` to play any day's deterministic puzzle.

## Git identity

Commits Claude makes are authored as `wardcrazy01894 <alanc3939@gmail.com>` via
inline `-c` overrides; pushes use the `github-wardcrazy` SSH remote alias.
