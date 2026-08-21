# 6 Degrees — working context

Auto-loaded by Claude sessions in this repo. Read before changing anything.

## What this is

v3 of a LinkedIn network visualizer. A force-directed galaxy of your network,
scored into S/A/B/C/D leverage tiers, with a rotary-dial Bridges view that fans
out a connection's 2nd-degree circle, company path intelligence, and an
outreach queue.

Lineage: this is **v1's code, copied file-for-file** (`~/six-degrees-linkedin`,
the private build that actually works), with personal data removed, browser-only
CSV import added, and lint debt cleared. A separate earlier rebuild lives at
`untitled folder 2/six-degrees-v2` (repo `blakeb056/six-degrees`) — it is
**not** the base for v3; it removed features and its scraper has never been run
against live LinkedIn.

Full shipping plan (install story, packaging, release pipeline, README
strategy, risks): `/Users/blake/six-degrees-v3-plan.md`.

## Current state

**Standalone as of 2026-08-21.** The app runs entirely locally: SQLite at
`~/.six-degrees/six-degrees.sqlite`, no account, no keys, no third-party
service. Runtime dependencies are `next`, `react`, `react-dom`, `d3` — the
database driver is Node's built-in `node:sqlite`. Node floor is 22.13.
CI green on 22 and 24 (lint + tests + build + secret/PII guard).

How the data layer fits together:
- `lib/db-client.js` — connection, schema bootstrap from `db/schema.sql`, and
  the JSON/boolean codecs that keep route code unchanged.
- `lib/db.js` — a supabase-shaped query builder. All 12 routes kept their call
  chains; only the import line changed.
- `lib/rpc.js` — `score_new_connections` and `increment_xp`, transcribed from
  `scripts/score_new_connections.sql` (still the reference model — change both
  together). `exec_sql` is deliberately gone.
- `app/api/network` — one read endpoint; the four client pages fetch it via
  `lib/network.js`. **No browser-side database access remains.**
- `tests/db.test.mjs` — 21 tests pinning the adapter contract. Run `npm test`.

Verified end to end: user creation, ingest with scoring that matches the
canonical model (CEO at a top-prestige company → 7.9, tier S, including the
30-day recency bonus), and the galaxy rendering from SQLite.

### ⭐ Next up

1. **Screenshots/GIF for the README** — the highest-impact missing item. Needs
   a synthetic network generator so nothing identifiable ships.
2. **First-run empty state** — a fresh install still shows a blank canvas.
3. **npx packaging** — `output: 'standalone'`, a `bin/` launcher, port 6363,
   then publish so `npx six-degrees` works. See the shipping plan.
4. Make the repo public.

## Decisions already made — do not relitigate

- **v3 is based on v1, not v2.** v2 cut the queue, XP, notifications and the
  deep Paths explorer.
- **0.1.0 ships CSV-only, no scraper.** `scripts/scrape.py` is the only
  implementation that has ever successfully scraped and is kept here for local
  testing, but publishing LinkedIn automation is a separate, deliberate
  decision for 0.2.0 — gated on differential verification against it.
- **If the scraper is ever ported to Node, port v1's, not v2's.** 381 of
  `scrape.py`'s 1,500 lines are JavaScript evaluated in the page — the proven
  DOM logic transfers verbatim; only the driver is rewritten.
- **Never commit real network data.** No exported CSVs, no `public/avatars/`,
  no `demo-data.json` from a real account. CI fails the build if they appear.

## Known gaps

- README has no screenshot or demo GIF — the highest-impact missing element.
  Needs a synthetic network generator so marketing shots contain no real people.
- No empty state on first run: a fresh install shows a blank canvas.
- `/paths` "connected vs locked" reads oddly for CSV imports (nothing is locked
  when you know everyone in the file).
- Repo is private. `six-degrees` on npm is available and unclaimed.

## Environment

```bash
nvm use            # Node 20 (.nvmrc)
npm install
npm run dev        # port 3210 via the six-degrees-v3 launch config
npm run lint && npm run build
```
