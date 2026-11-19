# Leaderboard + streaks + accounts worker (`leaderboard.mjs`)

A Cloudflare Worker backing the **daily leaderboard**, the **server-side
per-player streak** and the **optional accounts** for YourSchoolAllStars. It is this game's
**own** Worker + [D1](https://developers.cloudflare.com/d1/) database
(`ysas-leaderboard`), deliberately independent of KnowYourCity's — same design,
separate resources, so retiring one never affects the other.

Why it exists: until this worker every streak lived only in the player's
browser. When the site went down on 2026-10-07
(hosting account suspension) every live streak was about to break and there was
**no record anywhere** of who was affected or what their count was. With this
table, a repair is one SQL `UPDATE` instead of a code change + deploy.

- **Anonymous by default.** Identity is a random UUID in the browser's
  `localStorage` (`ysas:clientId`) — no names, no PII. A player who wants
  their streaks on every device can make an **account** (below).
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
- **Bounded storage.** `scores` older than 90 days are pruned **lazily**: on a
  submit, at most once per UTC day (`pruneIfDue`, marker in the `meta` table,
  migration `0004`). No Cron Trigger — the account's Workers Free plan allows
  5 per account and they were all in use. The toml keeps `[triggers]
crons = []` on purpose: an EMPTY list is what makes `wrangler deploy` clear
  the old schedule (deleting the block leaves it registered). Confirm after
  deploying: `GET /accounts/<id>/workers/scripts/<name>/schedules` → `[]`.
  The `scheduled` handler is kept should one ever be wanted again. **Streaks
  are never pruned.**
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

## Accounts (optional)

A username, a password and a display name — **no email**, no other PII
(`accounts-lib.mjs`, migration `0005`; ported from CampusPin Showdown).

- **Same tables.** An account's scores and streaks are ordinary `scores` /
  `streaks` rows whose `client_id` is `acct:<id>`. A device id can't contain
  `:`, so the key can't be forged, and every rank / board / streak query treats
  a signed-in player on three devices as ONE competitor.
- **Streaks stay.** Signing in or registering sends the device's `clientId`:
  its score rows and streak rows — in **every** game — move to the account and
  the anonymous rows are deleted (no twin on the board). Then `/me` carries the
  device's local streaks as claims (the same `{ current, max, lastDate }` a
  submit's `seed` carries, one per game) and merges them in (`mergeStreaks`):
  the later last-played day decides, the same day keeps the **longer** one,
  consecutive days (or only outage days between) join into one run, and `best`
  only grows. The client applies the identical rule (`src/lib/sync.ts`
  `mergeStreak`; `parity.test.mjs` pins the two).
- **Cross-device days.** A submit may carry `detail` — the draft
  (`{ playerIds, windows?, grade }`), stored as JSON beside the score. `/me`
  returns the account's results still inside the submit window with their
  drafts, so a second device shows the day **locked** instead of offering it
  again. Advisory like the seed: a malformed one is dropped, never a 400.
- **Display names on the board.** `GET` rows carry `name` — the account's
  display name, `''` for an anonymous device. Never an id or a username.
- **Passwords** use a split KDF: the browser stretches the password (PBKDF2
  150k, salted with the username) and sends only that key; the worker
  stretches it again with a per-account salt. Sessions are 24-byte bearer
  tokens, stored only as SHA-256, sent only in POST bodies, newest 10 kept.
- **`LOGIN_LIMITER`** (5/min) gates `/register` (per IP), `/login` and
  `/password` (per IP + username). Those routes **fail closed** without it.
- **Sign-out** on a device syncs first, ends the session, then wipes that
  device's streaks / saved dailies back to a fresh anonymous player
  (`resetProgressForSignOut`) — they are the account's, not the device's.

Routes (last path segment): `POST /register { username, pass, name?,
clientId? }`, `/login { username, pass, clientId? }`, `/logout { token }`,
`/me { token, streaks? }` → `{ username, name, streaks[], days[] }`,
`/name { token, name }`, `/password { token, pass, newPass }`.

### A player forgot their password

There is no email, so no self-service reset — the owner sets a temporary one:

```bash
npm run account:reset-password -- <username>            # production
npm run account:reset-password -- <username> --local    # local dev D1
```

It signs the account out everywhere and prints a temporary password to send
them privately; they sign in with it and pick their own under 👤 → Change
password. Streaks, scores and display name are untouched.

### Renaming / removing an account by hand

```bash
wrangler d1 execute ysas-leaderboard --remote -c worker/wrangler.toml \
  --command "UPDATE accounts SET name='New Name' WHERE username='<username>'"
```

To repair an account's streak, use the recipe below with
`client_id='acct:<id>'` (`SELECT id FROM accounts WHERE username='…'`).

## Request / response

- **Submit:** `POST { school, sport, mode, date, score, strength, clientId, seed?, detail?, token?, turnstileToken? }`
  → `{ ok, rank, total, streak? }`, `streak` = `{ current, best, lastDate }`.
  `score` = projected wins; `strength` = the 0..100 team overall (**what the
  rank is by**; optional only for old clients, ranks as 0 when absent);
  `seed` = `{ current, max, lastDate }` (the client's local `Streak`).
  When `strength` is sent, `score` must be what the client's win curve gives
  for it (±1; exact at the 85+ undefeated and sub-30 winless overrides) —
  `400 score does not match strength` otherwise. The curve constants are
  pinned to the client by `worker/parity.test.mjs`. (A submit with no
  `strength` skips the check; it ranks as overall 0, below every real row.)
  **Deploy coupling:** the client ships on merge but the worker deploys by
  hand — a change to the win curve must be deployed to the worker in the same
  window, or every real submit 400s until it is.
- **Rejections are logged.** Every non-2xx answer logs
  `leaderboard rejected { status, error, … }` (game + date for a submit or
  view, the origin for a 403, siteverify `turnstileErrors` for a Turnstile
  failure), so `wrangler tail` shows why players' submits are failing.
- **View:** `GET ?school=&sport=&mode=&date=` → `{ ok, total, rows[] }` —
  the day's top 100 as `{ strength, score, name }`, best overall first
  (`name` = a signed-in player's display name, else `''`; never an id). Powers the leaderboard page. Rate-limited and validated like the
  POST.

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

**Shipping a change that adds a migration** (e.g. accounts, `0005`): apply the
migration to the remote database (step 2) **before** deploying the worker
(step 3), and deploy the worker before or with the site. An old worker answers
the new client's account routes with `400 unknown school`, which the app shows
as "Accounts aren’t switched on yet" — nothing else breaks.

Then set the repo **Variable** `VITE_LEADERBOARD_ENDPOINT` (Settings → Secrets
and variables → Actions → Variables) to the printed URL; `deploy.yml` bakes it
into the site build. Locally, put it in `.env.local`. **The same origin must be
in `connect-src` of the Content-Security-Policy in `index.html`** (pinned by
`src/csp.test.ts`) — without it the browser blocks every submit and the game
silently carries on with local streaks only.

Everything here is on Cloudflare's free plan: Workers (100k req/day), D1 (5M
reads / 100k writes per day, 5 GB) and the rate-limit binding.
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
- `accounts.test.mjs` — account rules + the fold/sync SQL on the real schema.
- `accounts.handler.test.mjs` — the account routes end to end (real SQLite).
- `parity.test.mjs` — worker ↔ client rules (allowlists, streak advance,
  streak merge, win curve).

`npm run typecheck` also runs `tsc -p tsconfig.worker.json` over the worker.
