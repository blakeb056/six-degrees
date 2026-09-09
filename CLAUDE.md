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
`untitled folder 2/six-degrees-v2` (repo `blakeb056/six-degrees-static`) — it
is **not** the base for v3; it removed features and its scraper has never been
run against live LinkedIn.

## Naming and surfaces (settled 2026-08-30)

This repo, its directory and the npm package all share one name: **`six-degrees`**
(`github.com/blakeb056/six-degrees`, `~/dev/six-degrees`). v2 was renamed
`six-degrees-static` to free it; GitHub redirects the old `six-degrees-app` links.

**v1 stays public but stops being linked.** `six-degrees-linkedin.vercel.app`
still serves Blake's real network by his standing decision — do not gate it —
but it is no longer the thing anyone is pointed at. The README, promo and any
post point here instead. v1 is the cockpit; v3 is the shopfront.

**What 0.1.0 actually delivers on the documented path.** The CSV import cannot
fill Bridges or Outlink — no official LinkedIn export contains 2nd-degree data.
The README leads with Galaxy for that reason and marks both views as
scraper-gated. Do not quietly re-promote Bridges to the hero slot.

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

## The scraper: fixed and verified live (2026-09-09)

**A full live scrape completed end to end for the first time: 752 of 755
connections collected, pushed, scored, and rendered, with 744 avatars captured
permanently.** This was the one blocker to publishing.

Five separate defects had to be cleared. Each one alone produced the same
symptom — "it opens a window, finds nothing, and closes" — which is why it
looked like a single unfixable problem for weeks.

### 1. The page scrolls, the window does not

`scrape_connections()` paged the list with:

```python
page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
```

On the connections page the list lives inside `<main>`, which is its own scroll
container with `overflow-y: auto`. The window never scrolls: `window.scrollY`
stays `0` and `document.body.scrollHeight` equals `window.innerHeight`. That
call was a **no-op**. LinkedIn renders ten people at a time and loads more on an
intersection observer, so nothing further ever loaded and every run ended with
the first ten. This is the "it only went on the first page and stopped" bug.

Fixed by `SCROLL_CONTAINER_JS`, which finds the real scrolling element and sets
its `scrollTop`, plus a genuine `page.mouse.wheel()` so the observer fires.

### 2. Names were guessed from the URL

The old extractor built a map of profile URLs that contained a `media.licdn.com`
image, then matched a name to a URL by comparing **the first five letters** of
the name against the URL slug. Two consequences: anyone without a profile photo
had no entry at all and was skipped, and anyone whose slug did not begin with
their name (custom slugs, initials, non-Latin names) was dropped or matched to
the wrong person.

Fixed by anchoring on the profile link. Each person renders two `<a>` tags
pointing at the same profile — one wrapping the photo, one wrapping the name and
headline. `CONNECTIONS_EXTRACT_JS` groups anchors by href and merges them. No
class names are used anywhere: LinkedIn's are hashed per deploy
(`_8e33b2ac`, `c313cecd`), so anything keyed off them breaks silently.

### 3. The login check looked for an element that no longer exists

`_looks_logged_out()` treated `nav.global-nav` as proof of a signed-in session.
That element is gone from every LinkedIn page in 2026, so the check never
matched and fell through to a URL guess.

Fixed with `_has_session_cookie()`, which reads the `li_at` cookie from the
browser context. It is set only by a real sign-in, and unlike the DOM it does
not change shape when the site is redesigned.

### 4. The login timer closed the window mid-login

The wait was five minutes, and on timeout it called `browser.close()`. A first
sign-in means email, password, and often a 2FA code from another device — this
regularly ran out, and the punishment was the window disappearing and the whole
attempt being thrown away.

Now it waits as long as the window is open. **Closing the browser is the cancel
signal**; there is no timer to lose a race against. `SIX_DEGREES_LOGIN_WAIT`
overrides the 30-minute backstop. The profile is persistent, so this is a
once-per-machine step.

### 5. A bare `except` reported a broken scraper as an empty network

The extract call was wrapped in `except Exception: rows = []`. When the injected
JavaScript failed, every round returned zero rows and the run reported "0
collected" — indistinguishable from having no connections. It hid a real bug:
the JS lived in a **non-raw** Python string, so `.split('\n')` became a literal
newline inside a JavaScript string literal at import time. The file on disk was
valid; what reached the browser was not.

Fixed the string (`r"""`), and the failure is now loud: it prints the error and
aborts after three consecutive failures rather than reporting a confident zero.

### 6. Scraped rows had no owner, so the UI ignored them

Not a scraper bug, but it looked like one. The CLI pushed rows with
`user_id = NULL`; every view filters by user id. 752 rows landed in the database
and the app still showed the empty state. `resolve_active_user()` now asks the
app which profile it has and adopts it, failing with an explanation if there is
no profile or more than one (`SIX_DEGREES_USER` picks between them).

### Signing in — email and password only

Google and Apple SSO **cannot** work here. Google blocks its OAuth flow inside
automation-controlled browsers by policy: the window opens greyed out and never
completes. There is no flag or user-agent trick worth building around it, and
attempting one would be working to defeat an anti-automation control. The
scraper says this on screen before the user has a chance to try it.

`--login` (`npm run scrape:login`) does the sign-in as its own step and exits, so
a first-time user is never debugging a login and a scrape at the same time.

The wait is page-agnostic on purpose: it polls the browser **context** for the
`li_at` cookie rather than watching one Page object, because signing in can open
a second window or replace the tab, and a page-bound check then waits forever on
something the user already navigated away from.

### Modes

| Command | What it does |
|---|---|
| `python3 scripts/scrape.py --full` | Walks the whole connections list. ~90s for 750 people. |
| `python3 scripts/scrape.py --refresh` | Stops after 20 already on file. Seconds. |
| `python3 scripts/scrape.py` | Picks `--full` on an empty database, `--refresh` otherwise. |
| `python3 scripts/scrape.py --search` | Legacy people-search route, kept as a fallback. |
| `--headless` | Works on every mode once signed in. More detectable than headful. |
| `python3 scripts/scrape.py --login` | Sign in and save the session, then exit. |

Two terminals: the app (`npm run dev`) in one, the scraper in the other. The app
must be running — the scraper writes through its API, not to SQLite directly.

### Still not verified

Bridge (2nd-degree) and company scans use their own extractors with the same
`window.scrollTo` pattern and the same fuzzy name matching that defects 1 and 2
describe. **They are very likely broken in the same two ways and have not been
run since.** They were not touched here because a bridge scrape hits a stranger's
connection list and is the highest-ToS-risk operation in the project; it should
be watched live the way this scrape was.

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
