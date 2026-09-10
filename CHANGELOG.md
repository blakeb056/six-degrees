# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First release, not yet published to npm.

### Added
- Clicking a bridge on the Revolver dial now opens that person, instead of only spinning
  them to the top. The dial also says when it is showing part of something — "12 of 14
  bridges", "showing 24 of 59" — and shift with the arrow keys pages through the rest.
- The profile page shows how much of your network has actually been mapped: a bar for
  the connections whose circle you have opened, how many keep their connections private,
  and how many are left — with the remainder given in batches rather than as one long
  run.
- An **Updates** section on the Scan page. Press **Check for updates** to see what has
  changed since your copy, then install it — no terminal, no `git pull` to remember.
  Nothing is ever checked automatically and nothing about you is sent; it runs the same
  two git commands you would type. If you have your own edits, it refuses and tells you
  which files rather than throwing them away.
- LinkedIn `Connections.csv` import, parsed entirely in the browser and never persisted.
- A synthetic sample network (150 invented 1st-degree, 598 2nd-degree, 14 bridges) that
  seeds deterministically, so every view can be explored before importing anything real.
- An empty state offering the three ways in, replacing a blank first run.
- `npx six-degrees` — a single-command launcher on port 6363 with its own data directory.
- Reference scoring model (`scripts/score_new_connections.sql`), transcribed to `lib/rpc.js`.

### Added
- A **Scan** page that runs the scraper for you. It checks what is missing, installs it,
  opens LinkedIn so you can sign in, and runs the scan — with the live log on screen.
  No second terminal, no server to start, nothing to copy and paste.
- `Start 6 Degrees.command` — double-click on a Mac to start the app and open it.
- Scanning a company or auto-bridging can now be run from the command line too
  (`--company "Acme"`, `--auto-bridge`); they used to exist only behind the old server.

### Added
- The Scan page now covers 2nd-degree mapping as its own step, in batches of 10, 25 or
  50 people, with a **Stop** button. Stopping closes the browser cleanly and keeps
  everything found so far.
- `--max-bridges` caps how many people one run will visit.

### Changed
- Orbit now draws the shape of your network rather than every person at once. The people
  whose circle you have opened are large and named, their circle gathers tightly around
  them, and everyone else is a small dot until you hover or select them. On a 750-person
  network that is a third fewer things on screen and no photographs to load for anyone
  but the hubs — so it is quicker, and there is something to look at.

### Changed
- The 2nd-degree scan now defaults to 10 people at a time instead of 25, and says why:
  during development a real account was temporarily restricted after about 19 in one
  sitting. Shipping a default above the only number we have measured is a default that
  can hurt whoever trusts it.

### Fixed
- A photo is only ever saved for one person now. If the same picture comes back for
  somebody else — which is what happens with LinkedIn's placeholder silhouette, and with
  anyone the scraper mismatched — it is skipped and they show their initials instead.
- Second-degree people no longer end up wearing someone else's profile photo. The bridge
  scraper matched people by the text of their link, and everyone LinkedIn shows as
  "LinkedIn Member" shares that text — so they all inherited the first one's picture and
  profile. `npm run audit:avatars` reports any already saved that way, and `--fix` clears
  them back to initials without re-scraping anything.
- Connecting with someone you met through a bridge now registers. They used to stay a
  2nd-degree contact forever — the import saw they were already on file and skipped
  them — so the outreach you actually completed never showed up in your network.
- Their card now says who introduced them, and keeps saying it after they become a
  direct connection.
- The Revolver dial shows every bridge it can fit rather than a fixed twelve — around
  forty on a normal window — shrinking them as the ring fills and naming only the
  selected one once names would overlap. It still pages when there are genuinely too
  many, and says so. It held the twelve with the largest circles and said nothing about
  the others, so lower tiers looked as though they did not exist — while the filter
  beside it was counting them.
- Stopping a run no longer leaves a browser window open behind it. The scraper is
  started in its own process group and asked to stop rather than killed, so it closes
  the browser and reports what it managed to do.
- Auto-bridge no longer stalls on people whose connections are hidden. It notes them,
  moves on, and does not try them again — they used to reappear at the top of the list
  on every run, so the same few profiles were retried forever and the feature looked
  stuck. `--retry-private` gives them another go; `--clear-skips` forgets all of them.
- The wait after a hidden profile is now seconds rather than two minutes. The long pause
  is for runs that actually walked LinkedIn; a hidden profile was a single page view.
- A hidden or unavailable profile is recognised in seconds instead of costing the full
  page-load budget twice over.
- Auto-bridge prints a countdown while it waits, so a pause cannot be mistaken for a hang.
- The scraper now collects your whole connections list. It was reading only the first ten
  people: the list sits in its own scroll container, so the page-down it performed never
  scrolled anything and no further connections ever loaded.
- Everyone is collected, not just people with a profile photo. Names now come from the
  profile link rather than being guessed by comparing the start of a name against the URL.
- Signing in waits for you instead of against you. There is no countdown; close the browser
  window to cancel. It also detects the sign-in wherever you finish it, including in a
  second window.
- `--login` signs in and exits, so a first run is not a sign-in and a scrape at once.
- A scrape that cannot read the page now says so and stops, instead of reporting that you
  have no connections.
- Every scan button in the app works again. The buttons on the map, the profile page and
  the paths page all quietly pointed at a separate server on port 5555 that no longer
  exists, and told you to double-click a file that no longer exists either. They all run
  through the app now.
- Filtering connections by scanned company was silently ignored and returned everything,
  because that field was missing from the query allowlist.
- The scraper's packages install into their own environment, so an install can no longer
  succeed against one Python while the scraper runs on a different one that lacks them.
- Scraped people are attached to your profile, so a finished scrape can no longer leave the
  app showing an empty network.

### Changed
- The data layer is now local SQLite via Node's built-in `node:sqlite`. The hosted Postgres
  dependency is gone: no account, no keys, no service. Runtime dependencies are `next`,
  `react`, `react-dom` and `d3`.
- All database reads go through the server; no browser-side database access remains.
- Avatars and the scraper's Chrome profile live in `~/.six-degrees`, never the package directory.

### Security
- Destructive API routes are open on loopback, require `ADMIN_TOKEN` as a bearer from any
  other host, and fail closed when exposed with no token set. The gate keys off the server's
  own bind address rather than the `Host` header, which a caller can forge.
- Cross-site writes are refused on every API route, so a page on another site cannot drive
  this app through your browser.
- Values from the database are escaped before rendering; graph tooltips no longer build
  markup from stored strings.
- CI fails the build if a credential, an exported CSV, real avatars, or a non-synthetic
  network snapshot is ever committed.
