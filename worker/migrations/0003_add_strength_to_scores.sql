-- Add team STRENGTH (0..100, the "overall" the app shows as "Team strength
-- NN / 100") to scores. The leaderboard page ranks the day's finishers by it;
-- `score` (projected wins) stays as the record shown beside it.
--
-- Nullable: rows written before this migration have no strength and rank as 0
-- (COALESCE in the queries). ALTER TABLE ADD COLUMN is safe + re-runnable
-- under D1's migration tracking.

ALTER TABLE scores ADD COLUMN strength INTEGER;

-- Board + rank now read by strength: (…, date, strength).
CREATE INDEX IF NOT EXISTS idx_scores_board
  ON scores (school, sport, mode, date, strength);
