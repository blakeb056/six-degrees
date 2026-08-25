# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- LinkedIn `Connections.csv` import, parsed entirely in the browser.
- Reference scoring model (`scripts/score_new_connections.sql`).

### Changed
- Data layer is being migrated from hosted Postgres to local SQLite so the app
  runs with no cloud account and no third-party service.

### Security
- Destructive API routes are open on loopback, require `ADMIN_TOKEN` as a bearer
  from any other host, and fail closed when exposed with no token set.
- Cross-site writes are refused on every API route, so a page on another site
  cannot drive this app through your browser.
- Values from the database are escaped before rendering; the graph tooltips no
  longer build markup from stored strings.
