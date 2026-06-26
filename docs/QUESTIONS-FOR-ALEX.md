# Questions for Alex

Strike through as they're answered.

## Answered

- ~~Year-window width?~~ → **4-year, non-overlapping** ("college is 4 years").
- ~~Football's pre-2005 defensive-stat gap?~~ → **Football starts 2005**;
  basketball 1994+.
- ~~Stat line per player?~~ → **Best single season.**
- ~~How much data at launch?~~ → **Full basketball rosters** (starters + key
  rotation), sourced not fabricated.
- ~~How hard should a perfect 40-0 be?~~ → **Rare, like the original (~4%)** —
  tune the rating curve to make perfection a real chase. (Calibrate once the
  dataset is complete.)
- ~~Daily format?~~ → **One-shot + streaks**, AND a separate **free-play** mode
  ("play as much as you want").
- ~~Which modes at launch?~~ → **Daily + Classic (free-play) + Hoops IQ**
  (stats-hidden).
- ~~Multi-position eligibility?~~ → **Allow adjacent positions** (combo guards
  slot into PG/SG, forwards into SF/PF, etc.).
- ~~University picker + theming?~~ → **Yes** — landing is a school picker; the
  whole UI re-themes to the chosen school's colors (Michigan maize/blue → UNC
  Carolina blue). Built (see `src/schools.ts`).

## Open

1. **North Carolina timing.** Add UNC right after Michigan basketball launches,
   or after Michigan football too?
2. **Domain / hosting.** Keep it on
   `wardcrazy01894.github.io/YourSchoolAllStars/`, or set up a custom domain
   (changes the Vite `base`)?
3. **Honors weighting.** All-American / conference-POY honors currently add a lot
   (+9–12 to the composite). Keep that, or let raw box-score stats dominate more?
   (Folds into the difficulty calibration.)
4. **Go public + deploy.** Plan is to flip the repo public once the dataset's 5
   coverage gaps are filled, which enables branch protection + the Pages deploy.
   Good to do that automatically when gaps hit zero, or wait for your sign-off?
