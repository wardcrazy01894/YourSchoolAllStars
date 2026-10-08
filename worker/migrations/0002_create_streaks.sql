-- Per-player daily streaks for YourSchoolAllStars.
--
-- One row per (school, sport, mode, client_id): an anonymous device's
-- consecutive-day streak in one game. Kept in its OWN table (not derived from
-- `scores`) so a long streak survives the 90-day retention prune that deletes
-- old daily score rows — and so an operator can repair one with a single UPDATE
-- (the whole reason this table exists; see worker/README.md).
--
-- Anonymous and accounts-ready, exactly like `scores`: `client_id` is the
-- localStorage device UUID (no PII) and `user_id` is the reserved NULL seam a
-- future login will adopt. Per (school, sport, mode) — mirroring the client's
-- localStorage namespaces — so a player keeps separate streaks for the Daily and
-- Daily IQ of each school + sport.
--
-- The worker advances this on every official daily submission (see
-- updateStreak in leaderboard-lib.mjs): same-day replay = no change,
-- previous-day = +1, a gap made only of listed site-outage days = carried and
-- credited, any other gap = reset to 1; `best` is the all-time high. The first
-- time a device is seen, the row is BOOTSTRAPPED from the streak the client
-- already held locally, so streaks earned before this table existed carry over.

CREATE TABLE IF NOT EXISTS streaks (
  school           TEXT    NOT NULL,
  sport            TEXT    NOT NULL,
  mode             TEXT    NOT NULL,
  client_id        TEXT    NOT NULL,         -- anonymous device UUID (no PII)
  user_id          TEXT,                     -- reserved for future accounts; NULL now
  current          INTEGER NOT NULL,         -- current consecutive-day streak
  best             INTEGER NOT NULL,         -- all-time best
  last_played_date TEXT    NOT NULL,         -- ET "YYYY-MM-DD" last counted
  updated_at       INTEGER NOT NULL,         -- epoch ms
  PRIMARY KEY (school, sport, mode, client_id)
);
