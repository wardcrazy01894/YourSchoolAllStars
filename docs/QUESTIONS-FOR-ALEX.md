# Questions for Alex

Strike through as they're answered.

## Answered

- ~~Year-window width?~~ → **4-year, non-overlapping** ("college is 4 years").
- ~~Football's pre-2005 defensive-stat gap?~~ → **Football starts 2005**;
  basketball 1994+.
- ~~Stat line per player?~~ → **Best single season.**
- ~~How much data at launch?~~ → **Full basketball rosters** (starters + key
  rotation), sourced not fabricated.
- ~~How hard should a perfect 40-0 be?~~ → _(Superseded 2026-06-26.)_ Originally
  "rare, like the original (~4%)"; **revised to a more forgiving curve** — the
  ~4% target is **retired** (undefeated cutoff 85, pivot 57, winless floor 30).
  See `docs/PLAN.md` §Rating model and `src/lib/rating.ts`.
- ~~Daily format?~~ → **One-shot + streaks**, AND a separate **free-play** mode
  ("play as much as you want").
- ~~Which modes at launch?~~ → **Daily + Classic (free-play) + Hoops IQ**
  (stats-hidden).
- ~~Multi-position eligibility?~~ → **Allow adjacent positions** (combo guards
  slot into PG/SG, forwards into SF/PF, etc.).
- ~~University picker + theming?~~ → **Yes** — landing is a school picker; the
  whole UI re-themes to the chosen school's colors (Michigan maize/blue → UNC
  Carolina blue). Built (see `src/schools.ts`).

- ~~North Carolina timing?~~ → **After Michigan basketball ships.**
- ~~Domain / hosting?~~ → **Keep github.io for now**; may add a custom domain
  later.
- ~~Honors weighting?~~ → **Keep honors meaningful** (current +9–12 bonus).
- ~~Go public + deploy?~~ → **Done.** The repo was auto-flipped public once the
  coverage gaps were filled and the rating calibrated; Pages deploy + branch
  protection are live.

## Open

_None right now — see `docs/BACKLOG.md` for upcoming work. New questions land
here as they arise (e.g. football rating calibration, UNC must-include players)._
