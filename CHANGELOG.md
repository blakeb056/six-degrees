# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.7] - 2026-09-24

A stopgap after 0.1.6 read 27 pages of results in about three and a half minutes and
LinkedIn blocked the account's search. Budgets and an easy resume come next. TRAPS §35.

### Changed
- **Slower reading.** 20 seconds before each page of results and another minute after
  every 10. A whole list now takes about 55 minutes, not 10.
- The pause after someone who came back with nothing is the full two minutes. It was 15
  seconds, so the scan went faster exactly when LinkedIn was pushing back.

### Fixed
- **A scan stops at the first sign of LinkedIn pushing back** instead of carrying on to
  the next person. That covers a page of results that won't open, a search that won't open
  for someone whose connections are visible, LinkedIn's own warnings ("unusual activity
  from your account", profile viewing restricted, the account restricted, the monthly
  search limit coming up or reached), and a security check or sign-in wall appearing while
  you were signed in. What the page showed is kept in `~/.six-degrees/pushback/` so the
  wording can be recognised, and the message says what to do for that case.
- **Someone is only marked hidden when LinkedIn clearly showed their profile** with no
  connections link. A profile that didn't render is "unclear": nothing is recorded, and
  two unclear people in a row stop the batch. A block used to mark everyone after it as
  hidden, for good.
- **A security check no longer counts as signed in.** The session cookie survives one,
  so a scan used to carry on past it. It now stops, and **Open LinkedIn** on the Scan page
  (shown even when signed in now) opens a window to finish it by hand. Signing in from
  scratch still waits through LinkedIn's own two-factor steps.
- Closing the browser window during a read stops it, and never marks the list finished.
- **Carrying on into a blank page no longer marks a list finished.** Only LinkedIn's "No
  results found" does. A search it is limiting can come back blank, and a wrong
  "finished" dropped the rest of that list for good.
- The Scan page's note on how long a whole list takes read "15 minutesa person".
- **A full scan could cut a mapped circle loose.** If one of your connections had also
  been saved inside someone else's circle (before 0.1.5 kept your own connections out),
  a full scan "promoted" that copy and deleted their real row. Everyone in their own
  circle was then left pointing at a row that no longer existed, and they vanished from
  every Degrees view. The same step gave long-standing connections a "you met them
  through…" they never had. Their own row is now kept, with no origin added. TRAPS §36.

## [0.1.6] - 2026-09-24

### Changed
- **2nd-degree scans read each person's whole list.** Every read used to stop at page 10
  (about 100 people) unless you changed a setting, and nothing in the log said so, so a
  list of 50 pages looked finished at 10. The default is now every page. It keeps
  clicking Next until the list ends, and looks for another page three times, scrolling
  down and waiting longer each time, before deciding a list is over. LinkedIn's own
  search stops at page 100 (about 1,000 people). The log always states the page limit,
  and says so when it stops at one with more to read.
- The log no longer calls the search of someone's connections a "3rd+ filter". It never
  was one: it covers everyone they know, and the app drops your own connections when it
  saves.

### Added
- **Carrying on where a read stopped.** How far each person's list has been read is noted
  in `~/.six-degrees/bridge-progress.json`. With **Also finish people already mapped**
  (on by default; `--deeper` from a terminal), a scan picks up everyone read only partly,
  including everyone mapped before this version at 10 pages, from the next page. Their
  profile isn't opened again once the id their connections are searched by is known.
- **Long reads save as they go**, every 10 pages. Stopping a scan, a crash, or LinkedIn's
  monthly search limit for free accounts now costs at most the last few pages, and the
  next run carries on from the same page.
- **LinkedIn's monthly search limit is recognised.** The scan saves what it read, stops
  the batch, and says why, instead of reading empty pages.

### Fixed
- A click on Next that didn't move to the next page used to end that person's read as if
  their list had ended. It is now retried three times, and if the page still won't move,
  the person is left for the next run to finish.
- Release builds could still fail at the eject: "Resource busy" sometimes arrives after
  the volume has already unmounted, when only ejecting the disk device failed, and the
  retry kept aiming at a mount point that no longer existed. It now finishes on the
  device and stops as soon as nothing is left attached. Build process only.

## [0.1.5] - 2026-09-24

### Fixed
- **A 2nd-degree scan could read someone's connections and save none of them**:
  "UNIQUE constraint failed", then "Done! 0 new". A person's results can name the same
  profile twice — the same result on two pages, or the same mutual connection under many
  results — and the database refused the whole batch. The scanner and the app now each
  keep every profile once.
- Your own connections were saved into other people's circles. They arrive as the
  "mutual connections" links under each result; they are not people you have not met,
  and they inflated every circle. They are now left out (and counted in the log).
- A failed save printed one line and carried on to the next person, spending LinkedIn
  views on people who could not be saved either. It now stops the batch and says why.
- After a push the log said "N processed", counting everything sent. It now says how
  many were new, and how many were already on file or already your connections.
- Company scans saved their rows without your profile, so nothing they found could
  appear. (Company scans are still experimental.)

- **LinkedIn's "Connected on" date is captured again.** The 1st-degree reader rewritten on
  2026-09-09 stopped saving it, so the app had no idea when you connected with anyone —
  and the scoring bonus for connections made in the last 30 days never applied. It is read
  from each person's card again, and a full scan fills it in for everyone already saved.
- A full scan's summary said "814 new" and then "Sent 814 → 0 new". It no longer claims
  a count it cannot know; the app's line says what was new.

### Added
- **Start with your newest connections.** The 2nd-degree step now works through the people
  you connected with most recently, by LinkedIn's "Connected on" date and across every
  tier; "highest tier first", with the tier choice, is still there.
- The progress bar says "Saving to your network and fetching photos" once reading is done,
  instead of sitting at 99% looking stuck.
- The Scan page remembers the order and depth you last chose.
- **How deep to read each person:** 10 pages (the default, about 100 people), 25, 50 or
  100, LinkedIn's limit. Deeper reads take longer and use your account's search allowance.

## [0.1.4] - 2026-09-24

### Fixed
- **2nd-degree scans failed on the first page of every person** with "Page.evaluate:
  SyntaxError: Invalid or unexpected token", then moved on to the next — so no
  connections were ever read and no pagination happened. The JavaScript that reads each
  results page sat in a plain Python string, which turns the `\n` in `split('\n')` into a
  real line break before the browser sees it. It is now a raw string, and a new test
  parses every snippet the scraper injects on every pull request. Broken since 2026-09-09.
- That same page reader, run against a mock results page for the first time, saved
  LinkedIn's screen-reader line ("View … profile") as everyone's headline. It now takes
  the first real line after the name.
- After a scan, "N of them were 2nd-degree contacts you have now connected with" read as
  N people added. It now says what happened: N were already in a bridge's circle and have
  been merged into your connections, keeping who introduced you.

## [0.1.3] - 2026-09-24

### Fixed
- **Scanning failed in the Mac app on Apple Silicon** with an `ImportError` from Pillow
  ("incompatible architecture (have 'arm64', need 'x86_64')"). The app's launcher is a
  script, so macOS could not tell which chips it supports and ran it under Rosetta; the
  Python it started came up Intel and could not load the Apple Silicon packages. The app
  now declares its chip (`LSArchitecturePriority`), so it runs natively — and it no
  longer needs Rosetta installed just to open.
- The Scan page's "installed" check imported only package names, which succeed even
  when the compiled parts are for the wrong chip. It now loads Pillow's image module
  and Playwright's sync API, so a mismatch shows as "not installed" before a scan.
- The one-line installer picks the Apple Silicon build even from a Terminal running
  under Rosetta, which reports `x86_64` on an Apple Silicon Mac.

## [0.1.2] - 2026-09-24

### Fixed
- **Hovering a dot in the Galaxy made it rebuild itself hundreds of times a second** —
  the rings collapsed and re-formed for as long as the mouse stayed on a dot. The hover
  tooltips sat invisibly at the bottom of the page, making it 18px taller than the
  window; on a Mac that shows scrollbars (a mouse, an external display) that meant a
  scrollbar, and moving the tooltip on hover removed it again. Each flip of the
  scrollbar resized the graph, and each resize rebuilt it. Tooltips now float above the
  page, and a resize waits to settle before it rebuilds anything.
- Clicking a dot, or anything else that re-rendered the page, also reset the Galaxy's
  layout: the page handed it a new, empty list and a new click handler every time. Both
  are now stable, so the scene only rebuilds when what it shows actually changes.
- A release build could fail at the very end with "Resource busy": right after Finder
  lays out the disk image's window, Finder or Spotlight can still hold the volume. The
  build now retries the eject, and says when it had to. Nothing changes in the app.

## [0.1.1] - 2026-09-24

### Fixed
- The `.dmg` window opened as a plain list in 0.1.0, with no picture and no Open Anyway
  step. A code comment had slipped inside the AppleScript that lays the window out,
  which made it a syntax error, and the build only warned. The script is now compiled
  before it runs, and a release build fails rather than publish a plain window.

### Added
- The release workflow can be dry-run: `gh workflow run release.yml --ref <branch> -f
  dry_run=true` builds both `.dmg` files on GitHub's Macs and publishes nothing.

## [0.1.0] - 2026-09-24

The first release: a Mac app on GitHub Releases, installed with one line. npm
publishing is wired up and waits only for a token.

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
- **Company scans are marked experimental.** They ship without ever having been run
  against live LinkedIn; the Paths page labels the button and asks once before the
  first scan.

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
