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

## Current state (2026-08-25)

**Everything except the scraper is done.** Phases 0-4 complete: standalone on
local SQLite, security hardened, synthetic sample + empty state, packaged for
`npx`. 37 tests, CI green on Node 22 and 24, verified from a fresh clone and
from an installed tarball.

- `lib/db-client.js` connection + schema (schema is `db/schema.js`, a module —
  it used to be read from disk relative to cwd, which broke in a package)
- `lib/db.js` supabase-shaped adapter; all 12 routes changed only an import
- `lib/rpc.js` scorer, transcribed from `scripts/score_new_connections.sql`
  (still the reference model — change both together)
- `lib/gate.js` + `middleware.js` — cross-site write refusal on all of `/api`,
  plus the destructive-route gate keyed off the server's own bind address
- `app/api/network` — one read endpoint; no browser-side DB access anywhere
- `scripts/gen-synthetic.mjs` — the sample network, deterministic
- `bin/six-degrees.mjs` — the npx launcher, port 6363

## ⚠️ THE OPEN PROBLEM: the scraper

Everything else works. The scraper is where the remaining risk and work is, and
it is the only thing standing between this and a publish.

**Three bugs found by running it on a second machine, all fixed but none
re-verified against live LinkedIn:**

1. **It did not wait for login.** The check was `"login" in page.url or
   "authwall" in page.url`; LinkedIn's signed-out landing page is often just
   `linkedin.com/` with a splash, so it sailed past, scraped an empty page and
   exited. `ensure_logged_in()` now detects signed-out from the URL *and* the
   missing global nav, then polls up to five minutes. No blocking `input()`
   calls remain (they could never work under `--server` anyway).
2. **The full scrape was unreachable.** `scrape_full()` — the one that walks the
   search pages and captures photos, the one that produced the original 2,647
   rows — had no CLI flag and could only be triggered from the local server's
   buttons. Every command-line run fell through to the incremental refresh,
   which on an empty database returns almost nothing and looks broken. Now
   `--full` / `--refresh`, and a bare run picks based on whether anything has
   been collected.
3. **Docs never said the app and scraper run at the same time**, in two
   terminals, and that `npm run dev` never returns a prompt because it *is* the
   server. That confusion cost the most time.

**Still not done — this is the next task:**

- **One live scrape, watched end to end.** The scraping logic is byte-identical
  to v1 (verified by diff — same selectors, scrolling, Load-more, pagination).
  But the plumbing around it is all new and has never completed a real run:
  reads go through `/api/connections`, writes default to localhost behind
  `_assert_local_target()`, and the Chrome profile moved into the data dir.
- Until that passes, do not publish. A broken scraper with Blake's name on npm
  is worse than a late release.

**Making it run in the background (discussed, not built):**

- `--headless` **already works** on every scrape function and is undocumented.
  Log in once visibly; the profile persists and later runs need no window.
  Caveat worth keeping in mind: headless is *more* detectable than headful, so
  invisibility and staying unflagged pull against each other.
- **`--attach` mode is the recommended next feature**: connect to the user's
  already-running Chrome over CDP (`connect_over_cdp`, needs Chrome started
  with `--remote-debugging-port=9222`) instead of launching a browser. No second
  window, no separate profile, no login step, and it looks like ordinary
  browsing. Contained change, replaces `launch_persistent_context` at 4 sites.
- Rejected: direct Voyager HTTP with the session cookie (fastest and fully
  background, but undocumented, breaks constantly, and exactly the pattern
  anti-abuse targets — not something to publish under a real name). LinkedIn's
  official API does not expose the connection list at all, only a count.

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
