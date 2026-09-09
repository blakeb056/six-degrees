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
| `--company "Name"` | Everyone visible at one company. |
| `--auto-bridge` | Map every bridge in turn, highest tier first. Hidden profiles are recorded and skipped on later runs. |
| `--retry-private` | With `--auto-bridge`: try the people previously found to be hidden. |
| `--clear-skips` | Forget every hidden-profile skip. |
| `--server` | **Legacy.** A standalone HTTP server on port 5555. The app no longer uses it — `/api/scraper` spawns the scraper directly. Kept for anyone driving it from outside. |
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
be running. From the Scan page that is automatic — the app spawns the scraper as a child
process through `/api/scraper`, which is why there is no longer a second server or a
second terminal. From a shell you have to start the app yourself first.

`_assert_local_target()` refuses to push to a non-loopback `APP_URL` unless
`ALLOW_REMOTE_PUSH=1`, because a misconfigured `APP_URL` would upload a private network
to a third party.

## Bridges

A single bridge scrape (`--bridge "Name"`) is **verified working** — Blake ran one
end to end on 2026-09-09.

`--auto-bridge` walks every unbridged person, highest tier first. What it must survive
is the common case, not the happy one: **most people's connections are hidden.** Those
return `[], "private"`, are written to `bridge-skips.json`, and are not tried again
unless asked. See TRAPS §15 for why recording the attempt is the whole fix.

**Company scans are still unverified** and share the old patterns TRAPS §5 and §6
describe. Watch one live before trusting it.

## Rate limits — a measured one

A real account was temporarily restricted on 2026-09-09 after about an hour of
continuous auto-bridging — roughly 20–25 profile views at the two-minute cooldown.
Lifted the same day. See TRAPS §16. Treat that as a ceiling seen once, not a safe
budget: batch the work, keep the cooldown, and stop at the first warning.

## Posture

Automating LinkedIn may violate its User Agreement and accounts have been restricted for
it. This runs locally, against the user's own account, at their own risk, and the README
and `docs/SCRAPING.md` both say so plainly. LinkedIn's official CSV export is the
supported path and needs none of this.
