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

Working: CSV import (parsed in-browser, never persisted), galaxy, tiers,
Pyramid, List, Paths, sidebar rankings, the Bridges empty state. CI green on
Node 20 + 22 with a secret/PII guard. 0 lint errors.

**Not yet standalone.** `lib/supabase.js` and `lib/supabase-admin.js` still
exist and all 12 API routes import them. A stranger cloning this today gets a
working CSV path and nothing else — saving, scraping, queue and XP all need a
Supabase project they don't have.

## ⭐ THE NEXT TASK — make it genuinely standalone

Replace Supabase with local SQLite so the app runs with no account, no keys,
and no third-party service. This is the single change that makes the README's
claim true. ~2.5 days; it is the critical path to shipping.

**1. `lib/db.js` — a Supabase-shaped adapter over `node:sqlite`.**
Use `node:sqlite` (built in), NOT `better-sqlite3` — native modules fail
silently on prebuild misses and would reintroduce a toolchain dependency.
Implement exactly these chain methods: `.from .select .eq .in .ilike .order
.limit .single .insert .update .upsert .delete`.

Five contract points a naive adapter gets wrong — pin each with a test:
  1. Resolve to `{data, error}`. Never reject.
  2. Expose a real `.then` **and** `.catch` — six call sites await the builder
     directly.
  3. The builder must be **mutable and return `this`**. `app/api/notifications/route.js`
     calls `q.eq(...)` without reassigning; that works today only because
     supabase-js mutates in place. An immutable builder changes behavior
     silently, with no error and no failing test.
  4. `.single()` returns `{data: null, error}` on zero rows.
  5. snake_case column names throughout.

**2. Swap the 12 routes** — one import line each, no body edits. Replace the
four `.rpc()` sites directly: `score_new_connections` ×2 → port the CASE
ladders from `scripts/score_new_connections.sql` (that file is the canonical
model — every other scorer is diffed against it); `increment_xp` → `UPDATE
user_stats SET xp = xp + ?`; **delete `exec_sql` outright** — runtime DDL has
no place in a local app.

**3. Get the client pages off the browser-side database.** Four pages issue
nine near-identical queries. Add one `/api/network` returning
`{degree1, degree2, degree3}`. Shortcut: `lib/demo.js`'s `loadDemoNetwork()`
already returns that exact shape and all four pages already branch on
`IS_DEMO` — wire the non-demo branch to the same shape. Then delete
`lib/supabase.js`.

**4. Data lives outside the repo** — `~/.six-degrees/` (SQLite + avatars), so
an installed copy never writes into its own package directory.

Then: the scraper stays Python and is **not** shipped in 0.1.0 (see below);
packaging as `npx six-degrees` follows.

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
