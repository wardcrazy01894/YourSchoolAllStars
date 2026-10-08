# Leaderboard + streaks worker (`leaderboard.mjs`)

A Cloudflare Worker backing the **anonymous daily leaderboard** and the
**server-side per-player streak** for YourSchoolAllStars. It is this game's
**own** Worker + [D1](https://developers.cloudflare.com/d1/) database
(`ysas-leaderboard`), deliberately independent of KnowYourCity's — same design,
separate resources, so retiring one never affects the other.

Why it exists: the game has no accounts, and until this worker every streak
lived only in the player's browser. When the site went down on 2026-10-07
(hosting account suspension) every live streak was about to break and there was
**no record anywhere** of who was affected or what their count was. With this
table, a repair is one SQL `UPDATE` instead of a code change + deploy.

- **Anonymous.** Identity is a random UUID in the browser's `localStorage`
  (`ysas:clientId`) — no accounts, no names, no PII. Both tables reserve a
  `user_id` column (NULL) so a login can be linked later. (That future migration
  is inherently lossy: a player who cleared localStorage has no id to link.)
- **Daily modes only.** The client submits **only** a real, current-day play of
  a daily mode (`daily`, `daily-iq`). Free-play modes and `?date=` playtests
  never submit, and the worker independently rejects unknown schools / sports /
  modes and any date outside a ±1-day window of ET "today" (it recomputes the
  date itself — see `GAME_TZ`).
- **Fails closed.** The per-IP rate limit in `wrangler.toml` is on by default,
  so a fresh deploy isn't wide-open. Scores are client-computed, so a determined
  actor can still POST a fake number — anti-cheat is a non-goal for an anonymous
  board; the rate limit bounds it. Turnstile is plumbed (set `TURNSTILE_SECRET`)
  if abuse ever appears.
- **Behind `VITE_LEADERBOARD_ENDPOINT`** — unset means the app omits the
  standing line and keeps its local streak, so the worker is **optional**.
- **Bounded storage.** A nightly Cron Trigger prunes `scores` older than 90
  days. `wrangler deploy` registers the cron automatically. **Streaks are never
  pruned.**
- **Per-player streak.** Each submit advances the `(school, sport, mode,
client_id)` row in `streaks` (migration `0002`) with **exactly** the client's
  rules (`src/lib/progress.ts` `nextStreak`, including the `OUTAGE_DAYS`
  amnesty) and returns it. The client then mirrors the server value locally.
- **Reconciles with the client.** Every submit carries `seed`, the streak the
  browser holds locally. The worker advances both its stored row and the seed
  to the submitted day and keeps the **better** one (`best` = max of both). So
  a device's first submit carries its pre-existing streak over, a run of
  failed submits (offline / 503 / 429) can never make the server reset a
  streak the player really earned, and a server-side repair (below) still
  wins over a locally-reset copy. The seed is trusted exactly as much as a
  bootstrap would be; anti-cheat is a non-goal for an anonymous board.

## Request / response

- **Submit:** `POST { school, sport, mode, date, score, clientId, seed?, turnstileToken? }`
  → `{ ok, rank, total, streak? }`, `streak` = `{ current, best, lastDate }`.
  `seed` = `{ current, max, lastDate }` (the client's local `Streak`).
- **View:** `GET ?school=&sport=&mode=&date=` → `{ ok, total, scores[] }` —
  the day's top 100 scores (desc), anonymous (no ids). Rate-limited and
  validated like the POST.

## Local-only trial (no production resources)

```bash
# 1. Create the local D1 + apply the schema (writes to worker/.wrangler, gitignored):
wrangler d1 migrations apply ysas-leaderboard --local -c worker/wrangler.toml

# 2. Run the worker locally (defaults to http://localhost:8787):
wrangler dev -c worker/wrangler.toml

# 3. In another terminal, point the app at it and run the dev server:
echo 'VITE_LEADERBOARD_ENDPOINT=http://localhost:8787' >> .env.local
npm run dev
```

`ALLOWED_ORIGIN` already includes `http://localhost:5173`. Inspect rows:

```bash
wrangler d1 execute ysas-leaderboard --local -c worker/wrangler.toml \
  --command "SELECT * FROM streaks"
```

## Deploy (one time, free tier)

```bash
# 1. Create the database, then paste the printed database_id into
#    worker/wrangler.toml ([[d1_databases]] database_id):
wrangler d1 create ysas-leaderboard

# 2. Apply the schema to the REMOTE database:
wrangler d1 migrations apply ysas-leaderboard --remote -c worker/wrangler.toml

# 3. Deploy the worker (rate limit + ALLOWED_ORIGIN are already in the toml):
wrangler deploy -c worker/wrangler.toml
```

Then set the repo **Variable** `VITE_LEADERBOARD_ENDPOINT` (Settings → Secrets
and variables → Actions → Variables) to the printed URL; `deploy.yml` bakes it
into the site build. Locally, put it in `.env.local`. **The same origin must be
in `connect-src` of the Content-Security-Policy in `index.html`** (pinned by
`src/csp.test.ts`) — without it the browser blocks every submit and the game
silently carries on with local streaks only.

Everything here is on Cloudflare's free plan: Workers (100k req/day), D1 (5M
reads / 100k writes per day, 5 GB), the rate-limit binding and Cron Triggers.
There is no card on file, so an overage can't bill — it just stops serving.

## Repairing a streak (the whole point)

```bash
# Find the row (client_id comes from the player: localStorage 'ysas:clientId'):
wrangler d1 execute ysas-leaderboard --remote -c worker/wrangler.toml \
  --command "SELECT * FROM streaks WHERE current >= 50"

# Fix it:
wrangler d1 execute ysas-leaderboard --remote -c worker/wrangler.toml \
  --command "UPDATE streaks SET current=54, best=54, last_played_date='2026-10-08'
             WHERE school='michigan' AND sport='basketball' AND mode='daily'
               AND client_id='<uuid>'"
```

The player sees the repaired value on their next submit (the client mirrors the
server streak). Always set `best` ≥ `current`. Set `last_played_date` to the last day that should COUNT — the
next real play advances from it; the reconcile rule keeps the repair over the
device's reset copy because the repaired count is higher. The flip side: a
repair can only RAISE a streak — lowering an inflated one doesn't stick, because
the device's next seed carries the higher number back (inherent to trusting the
seed; anti-cheat is a non-goal). For a site-wide outage, add the day to `OUTAGE_DAYS` in **both**
`worker/leaderboard-lib.mjs` and `src/lib/progress.ts` instead.

## Tests

- `leaderboard.test.mjs` — pure validation + streak rules.
- `leaderboard-db.test.mjs` — the real SQL against the real migrations in an
  in-memory `node:sqlite` (Node ≥ 22.5).
- `leaderboard.handler.test.mjs` — the full request path with a fake D1.

`npm run typecheck` also runs `tsc -p tsconfig.worker.json` over the worker.
