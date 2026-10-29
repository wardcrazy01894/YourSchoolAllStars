-- Tiny key/value table for worker bookkeeping. First use: `last_prune`, the
-- UTC date (YYYY-MM-DD) the retention prune last ran, so the prune can run
-- LAZILY from a submit at most once per day. Why: the Cloudflare account is on
-- the Workers Free plan, which allows 5 cron triggers per account, and every
-- slot was in use — new workers could not register a cron at all. All of
-- Alex's leaderboard workers now prune this way; the `scheduled` handler stays
-- in place for the day a cron is wanted again.

CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL           -- epoch ms
);
