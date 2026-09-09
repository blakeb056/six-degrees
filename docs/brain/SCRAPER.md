# The scraper

`scripts/scrape.py` — Python + Playwright, driving the user's **real installed Chrome**
through a persistent profile. It is the only implementation that has ever actually
scraped; treat it as load-bearing legacy, not as a candidate for a rewrite. See the
rejected-by-design table in the spec.

**Read [`TRAPS.md`](TRAPS.md) §5–7 and §12–13 before changing anything here.**

## Modes

| Command | Does |
|---|---|
| `--full` | Walks the whole connections list top to bottom. ~90s for 750 people. |
| `--refresh` | Stops after 20 people already on file. Seconds. |
| *(bare)* | `--full` on an empty database, `--refresh` otherwise. |
| `--login` | Signs in, confirms the session saved, exits. |
| `--search` | Legacy: collects via the people-search pages instead. |
| `--bridge "Name"` / `--rescrape "Name"` | 2nd-degree circle behind one person. |
| `--server` | Local HTTP server so the app's Setup buttons can drive it. |
| `--headless` | Works on every mode once signed in — but headless Chrome is **more** detectable, not less. |

## Sign-in

Once per machine. The persistent profile at `SIX_DEGREES_HOME/chrome-profile` keeps the
session; later runs go straight to work.

Detection is the **`li_at` cookie**, read from the browser context. Not the DOM: an
earlier check waited for `nav.global-nav`, which no longer exists anywhere on LinkedIn,
so it never matched. Not the URL either — the signed-out landing page is often just
`linkedin.com/`, which slips past a `login`/`authwall` check.

The wait has **no meaningful deadline**. Closing the browser window is the cancel signal.
Any timer is a guess about how long a 2FA round-trip takes, and losing that race used to
close the window mid-login and discard the attempt.

## What the connections page actually looks like

Verified live 2026-09-09. Expect all of this to rot; re-probe rather than trust it.

- URL: `https://www.linkedin.com/mynetwork/invite-connect/connections/`
- A header line reads `"754 connections"` — parse it as a target and warn when the
  collected count falls far short on a full walk.
- **Ten people render initially**; more load on scroll via an intersection observer.
- **There is no "Load more" button** any more. The button-click path is kept as a
  fallback for older layouts, but infinite scroll is the live behaviour.
- **The window does not scroll.** `<main>` is the scroll container. TRAPS §6.
- Every person renders **two `<a>` tags at the same href** — one wrapping the photo, one
  wrapping name + headline.
- Class names are hashed per deploy. Never select on them. TRAPS §5.
- The photo's `img.alt` reads `"Jane Doe's profile picture"` — usable only as a
  fallback, and the suffix must be stripped.

## How extraction works

`CONNECTIONS_EXTRACT_JS` groups anchors by href and merges them:

- The **text anchor is authoritative** for the name; `img.alt` fills in only if absent.
- Line 2 of the anchor text is the headline unless it starts with `Connected on`.
- Anchors inside `nav`, `header`, `footer` are skipped — the "Me" menu links to the
  user's own profile and would otherwise be collected as a connection.
- A `licdn.com` image that is not a ghost avatar becomes `imageUrl`.

This survives redesigns because it depends on one thing: that a link to a profile points
at `/in/`. The previous approach — matching a name to a URL by comparing the first five
letters of the name against the URL slug, over only those links containing a photo —
skipped everyone without a profile picture and mismatched custom slugs.

**The JS lives in a raw Python string (`r"""`).** In a normal string, `'\n'` inside
`.split('\n')` becomes a real newline at import time, producing a JavaScript string
literal broken across two lines: valid on disk, a `SyntaxError` by the time Playwright
sees it. TRAPS §7.

## Writing back

The scraper writes **through the app's HTTP API**, never into SQLite directly — one
writer, one set of scoring rules, no second connection to the database. So the app must
be running; that is why setup is two terminals.

`_assert_local_target()` refuses to push to a non-loopback `APP_URL` unless
`ALLOW_REMOTE_PUSH=1`, because a misconfigured `APP_URL` would upload a private network
to a third party.

## Unverified

**Bridge and company scans carry their own copies of the old `window.scrollTo` pattern
and the old name-matching heuristic.** They are very likely broken in exactly the ways
TRAPS §5 and §6 describe and have not been run since the fix.

They were left alone deliberately: a bridge scrape reads a *stranger's* connection list
and is the highest-ToS-risk operation in this project. Watch one live before trusting it.

## Posture

Automating LinkedIn may violate its User Agreement and accounts have been restricted for
it. This runs locally, against the user's own account, at their own risk, and the README
and `docs/SCRAPING.md` both say so plainly. LinkedIn's official CSV export is the
supported path and needs none of this.
