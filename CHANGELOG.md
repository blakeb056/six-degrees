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
- Destructive API routes require an admin token and fail closed without one.
