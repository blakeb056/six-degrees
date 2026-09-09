# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First release, not yet published to npm.

### Added
- LinkedIn `Connections.csv` import, parsed entirely in the browser and never persisted.
- A synthetic sample network (150 invented 1st-degree, 598 2nd-degree, 14 bridges) that
  seeds deterministically, so every view can be explored before importing anything real.
- An empty state offering the three ways in, replacing a blank first run.
- `npx six-degrees` — a single-command launcher on port 6363 with its own data directory.
- Reference scoring model (`scripts/score_new_connections.sql`), transcribed to `lib/rpc.js`.

### Fixed
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
