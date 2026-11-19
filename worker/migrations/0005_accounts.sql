-- Optional accounts for YourSchoolAllStars: a username, a password and a
-- display name. No email, on purpose (a forgotten password is reset by the
-- owner: scripts/reset-password.mjs).
--
-- An account's scores and streaks live in the SAME `scores` / `streaks` tables
-- as an anonymous device's, under the player key `acct:<id>` in `client_id`.
-- A browser-minted device id can never contain ':' (isValidClientId), so the
-- key cannot be forged, and every existing query (one competitor per
-- client_id, keep-max, the streak row) works for accounts unchanged. The
-- `user_id` columns reserved in 0001/0002 stay unused.

CREATE TABLE IF NOT EXISTS accounts (
  -- AUTOINCREMENT: an id is never reused, so `acct:<id>` rows can never be
  -- inherited by a later account.
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,   -- lowercased login
  name       TEXT    NOT NULL,          -- display name, shown on the board
  pass_salt  TEXT    NOT NULL,          -- hex, per account
  pass_hash  TEXT    NOT NULL,          -- hex, PBKDF2 of the client-derived key
  created_at INTEGER NOT NULL           -- epoch ms
);

-- One row per signed-in device. Only the SHA-256 of the bearer token is
-- stored, so a database leak does not hand out sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL           -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- The draft behind a score: JSON `{ playerIds, windows?, grade }` (the
-- client's SavedDaily minus the numbers already in their own columns), always
-- describing the stored (strength, score) pair. It is what lets a second
-- signed-in device show the finished day LOCKED, with its roster, instead of
-- offering the puzzle again. NULL for rows written before this.
ALTER TABLE scores ADD COLUMN detail TEXT;

-- The account routes read every row of one player (`WHERE client_id = ?`),
-- which neither primary key leads with.
CREATE INDEX IF NOT EXISTS idx_scores_client ON scores (client_id);
CREATE INDEX IF NOT EXISTS idx_streaks_client ON streaks (client_id);
