# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First release, not yet published to npm.

### Added
- **One-line install on a Mac**: `curl -fsSL …/install.sh | bash` fetches the newest
  release for your chip, verifies its SHA-256, puts the app in Applications and opens
  it — with no Gatekeeper prompt, because curl does not mark the file as downloaded.
  Running it again updates. `SIX_DEGREES_DMG` installs a local `.dmg` for testing.
- A release workflow: pushing a `v*` tag builds the app on Apple Silicon and Intel,
  publishes both `.dmg`s and a `SHA256SUMS` on a GitHub Release, and publishes to npm
  when an `NPM_TOKEN` secret exists.
- A welcome screen for a first run: **Scan my LinkedIn** (recommended), **Import my
  LinkedIn CSV**, or **Explore a sample network**.
- The Scan page ticks off the scan step once you have connections, offers **See your
  network →**, and when a run stops early it shows the reason in a box rather than
  only "Stopped (exit 1)" at the bottom of the log.
- A progress bar while scanning: "350 of 817 connections · 43%" for a full walk,
  "Person 3 of 10" for a 2nd-degree batch. **Check for new** gets words instead of a
  bar, since it stops as soon as it meets people already saved.
- The Mac app and the npm package get a working **Updates** panel. **Check for updates**
  asks GitHub for the newest release's version number — on a click, never by itself —
  and shows the exact line to run, with a Copy button.
- The `.dmg` window says what to do: drag the app across, then the one-time **Open
  Anyway** step for an unsigned app. It replaces the READ ME text file the image used
  to carry, and the Applications drop target now shows its folder icon.

### Changed
- **No more name prompt.** The app works out which profile is yours — the one that
  owns your network — and creates one on a fresh install. The prompt minted a new,
  empty profile for every name that did not match exactly, and with more than one
  profile the network disappeared from view and the scraper refused to run.
- The README leads with installing, not cloning; running from source moved to
  CONTRIBUTING.md, with the commands chained so a failed clone cannot fall through to
  an older copy.
- The Scan page counts by degree — "814 connections, plus 2,734 people in their
  circles" — instead of one total that read as connections and was not.
- `Start 6 Degrees.command` is gone. It started the development server; install the
  app instead.

### Fixed
- A scan that failed printed only "Stopped (exit 1)". Its reason was on stderr, which
  the Scan page filtered to lines mentioning "error"; failures now always show their
  last lines, and the red box shows the whole reason rather than its final line.
- Updating a Mac app that was running left its old server behind, still serving the old
  version, with the new copy opening on the next port. Next renames its process, so the
  installer never found it by path; it now finds it by folder, and the app's launcher
  stops its server whenever the launcher stops.
- The build copied the repository's `.git` folder and build logs into the app. Inside
  the Mac app, the `.git` made the installed copy look like a checkout, so its Updates
  panel would have offered `git pull` against the app itself.
- The Scan page's status was cached for four seconds, the live log included, so a
  running scan looked stalled between updates.

### Added
- `npm run update` — discards the regenerated lockfile, pulls, installs, and tells you to
  restart. Plain `git pull` refuses whenever npm has rewritten `package-lock.json`, which
  is most of the time on a second machine, and it says so in one line that is easy to
  miss.
- A downloadable macOS app. `npm run build:app` produces `Six Degrees.app` and a ~70 MB
  `.dmg` with a Node runtime inside, so importing a CSV needs nothing else installed —
  no Node, no clone, no terminal. macOS asks for one approval on first launch because
  the app is not signed with a paid developer certificate.
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
- Scanning a company or auto-bridging can now be run from the command line too
  (`--company "Acme"`, `--auto-bridge`); they used to exist only behind the old server.

### Added
- The Scan page now covers 2nd-degree mapping as its own step, in batches of 10, 25 or
  50 people, with a **Stop** button. Stopping closes the browser cleanly and keeps
  everything found so far.
- `--max-bridges` caps how many people one run will visit.

### Added
- Choose which tiers the 2nd-degree scan works through. It always resumes where it left
  off — anyone still without a mapped circle, highest tier first, including people you
  have connected with since the last run — so there is nothing to remember and nothing
  to reset.

### Fixed
- The packaged Mac app could ship without part of Next's server runtime, leaving every
  page working and every API call failing. The rule that keeps build artefacts out of the
  bundle was matching Next's own `dist` folder too.
- Leaving the Bridges view no longer throws. A resize callback could run once after the
  view had gone and read something that was no longer there.
- Scan, Profile, Import and Outlink scroll again. A rule that exists so the map can fill
  the window was applied to the whole app, so on every other page anything below the
  fold was rendered but unreachable.
- `npm run dev` now says when another copy is already serving on one of its ports,
  instead of silently starting on a different one while your browser shows the old.
- Resuming a scan no longer re-scrapes people you had already done. Past 2,000
  second-degree records the check for "who is already mapped" was silently returning a
  partial answer, so finished bridges looked unfinished.

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
