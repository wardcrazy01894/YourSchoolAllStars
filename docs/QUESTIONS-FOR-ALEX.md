# Questions for Alex

Strike through as they're answered.

## Answered

- ~~Year-window width?~~ → **4-year, non-overlapping** ("college is 4 years").
- ~~How to handle football's pre-2005 defensive-stat gap?~~ → **Football starts
  2005**; basketball stays 1994+.
- ~~What stat line represents a player?~~ → **Best single season.**
- ~~How much data at launch?~~ → **Full basketball rosters** (starters + key
  rotation, ~7/season) at launch, sourced not fabricated.

## Open

1. **Rating calibration.** The projected-record model (see `docs/PLAN.md`
   §Rating model) is a reasonable first cut. Once the full dataset lands, do you
   want me to tune it so a perfect 40-0 is roughly as rare as 40-0.com's "~4% go
   undefeated", or leave it more forgiving for a friends game?
2. **Multi-position eligibility.** Right now each player fills exactly one slot
   (so "lock the PG" is literal). 40-0 lets some players slot into adjacent
   positions (a combo guard at PG or SG). Want positional flexibility later, or
   keep strict 1-position?
3. **Modes.** Ship just the Daily Challenge first, or also the free-play
   "Classic" (random spins, replayable) and "Hoops IQ" (stats hidden) modes?
4. **Daily persistence.** Make the daily a true one-shot (your result is saved;
   you can't replay until tomorrow), with streaks — or keep it replayable for
   now? (Currently replayable.)
5. **North Carolina timing.** Add UNC right after the Michigan basketball launch,
   or after Michigan football too?
6. **Domain / hosting.** Keep it on `wardcrazy01894.github.io/YourSchoolAllStars/`,
   or do you want a custom domain (changes the Vite `base`)?
7. **Honors weighting.** Should All-American / conference POY honors move the
   needle as much as they do now (+9–12 to the composite), or should raw box-
   score stats dominate?
