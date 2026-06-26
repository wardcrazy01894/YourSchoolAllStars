<!-- Keep PRs small and focused. CI must be green before merge. -->

## What & why

<!-- One or two sentences. Link the issue / backlog item if any. -->

## How it was tested

<!-- Which tests you added (test-first!) and any manual verification. -->

## Checklist

- [ ] **Test-first**: a `*.test.ts` captures the behavior and failed before the impl (TDD).
- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` all pass locally.
- [ ] Docs updated in **this** PR if behavior changed (`docs/PLAN.md`, `docs/DATA-SOURCING.md`, `README.md`, `docs/QUESTIONS-FOR-ALEX.md`).
- [ ] No secrets committed. No player stats fabricated — every new player row has a verifiable source.
- [ ] **Adversarial review run** on the diff (`adversarial-reviewer` agent or `/code-review`); findings posted on the PR and resolved/fixed. (Trivial docs/config PRs: note "review: trivial".)
