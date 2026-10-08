-- Daily leaderboard storage for YourSchoolAllStars.
--
-- One row per (school, sport, mode, date, client_id): an anonymous device's best
-- daily result for a given game on a given ET calendar day. `school`, `sport`
-- and `mode` are all part of the PRIMARY KEY so boards are independent BY
-- CONSTRUCTION — a Michigan basketball Daily is never ranked against a UNC
-- football Daily IQ. (`school` includes the two cross-school sentinels the app
-- uses for its "full" modes, `full-basketball` / `full-football`.)
--
-- `client_id` is an anonymous random UUID minted in the browser's localStorage
-- (no PII). `user_id` is the reserved seam for FUTURE accounts: it is NULL today
-- and will be backfilled when a logged-in player links their device. (That
-- migration is inherently lossy — a player who cleared localStorage has no
-- client_id to link — the accepted tradeoff of an anonymous-first design.)
--
-- `score` is the projected-wins number the app already shows (0..40 basketball,
-- 0..16 football). The rank query is
-- `COUNT(*) WHERE school=? AND sport=? AND mode=? AND date=? AND score > ?`,
-- served by idx_scores_rank below.

CREATE TABLE IF NOT EXISTS scores (
  school     TEXT    NOT NULL,
  sport      TEXT    NOT NULL,            -- 'basketball' | 'football'
  mode       TEXT    NOT NULL,            -- 'daily' | 'daily-iq'
  date       TEXT    NOT NULL,            -- ET calendar day, "YYYY-MM-DD"
  client_id  TEXT    NOT NULL,            -- anonymous device UUID (no PII)
  score      INTEGER NOT NULL,            -- projected wins
  user_id    TEXT,                        -- reserved for future accounts; NULL now
  created_at INTEGER NOT NULL,            -- epoch ms, first submission
  updated_at INTEGER NOT NULL,            -- epoch ms, last (keep-max) update
  PRIMARY KEY (school, sport, mode, date, client_id)
);

-- Covers the rank count (…, date, score > ?) and the total count (…, date).
CREATE INDEX IF NOT EXISTS idx_scores_rank
  ON scores (school, sport, mode, date, score);
