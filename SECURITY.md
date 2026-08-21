# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/blakeb056/six-degrees-app/security/advisories/new)
rather than opening a public issue. Expect an initial response within a week.

## Threat model

This app is designed to run **on your own machine, against your own network**.

- The web UI binds to localhost. It is not hardened for exposure to the
  internet, and it has no multi-user authentication or per-user authorization.
- Four API routes (`admin-delete`, `admin-update`, `delete-cluster`,
  `setup-profile`) can irreversibly destroy or rewrite data. They require an
  `ADMIN_TOKEN` bearer and fail closed when it is unset.
- A localhost-bound service is still reachable by any web page you visit if it
  is unauthenticated. Do not bind this app to `0.0.0.0` or expose it through a
  tunnel.

## Your data

Everything stays local:

- A CSV import is parsed in the browser and held for that tab only. It is never
  uploaded and never written to a database.
- Scraped data and cached avatars are written to your machine and are gitignored.
- There is no telemetry, no analytics, and no crash reporting.

Never commit `public/avatars/`, `public/demo-data.json`, or any exported CSV —
they contain real people. CI fails the build if they appear.
