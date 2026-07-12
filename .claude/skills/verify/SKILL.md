---
name: verify
description: Build, launch, and drive YourSchoolAllStars in a real browser to verify a change end-to-end (screenshots as evidence).
---

# Verifying YourSchoolAllStars

Vite React SPA; the surface is the browser.

## Launch

```bash
npm run dev          # http://localhost:5173/YourSchoolAllStars/ (background it)
```

Append `?date=YYYY-MM-DD` for a deterministic daily puzzle.

## Drive (no Playwright dep in the repo — use a scratchpad install)

```bash
mkdir -p "$SCRATCHPAD/drive" && cd "$SCRATCHPAD/drive" && npm i playwright --no-save
```

Launch Chromium via the installed Chrome (avoids the browser download):

```js
import { chromium } from 'playwright'
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
```

## Flows worth driving

- School picker → `getByText('Michigan').click()` → sport card → mode card
  ("Daily Challenge" etc.) → a `Play…` button may appear before the game.
- Draft loop (both sports): click `button /Spin era|Spin/` → **wait ~2.6s**
  (spin animation) → click `tr.player:not(.locked)` → if `.slot.target`
  elements appear (FLEX choice), click one → repeat until the results screen
  (`getByText(/Team strength/)`).
- Results screen shows record, per-slot ratings, per-player stat lines, and
  the share block.

## Gotchas

- Pool tables render only after the spin reveal; don't screenshot too early.
- A completed daily locks; reloading mid-draft returns to the sport picker
  (mid-draft state is not persisted — by design).
- Use a fresh browser context to reset the "already played today" lock
  (persistence is localStorage).
