# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/blakeb056/six-degrees/security/advisories/new)
rather than opening a public issue. Expect an initial response within a week.

## Threat model

This app is designed to run **on your own machine, against your own network**.

- The web UI binds to localhost. It is not hardened for exposure to the
  internet, and it has no multi-user authentication or per-user authorization.
- Six API routes are gated (`admin-delete`, `admin-update`, `delete-cluster`,
  `setup-profile`, `scraper`, `update`). The first four can irreversibly
  destroy or rewrite data, `scraper` starts processes, and `update` changes the
  code that runs next. While the server is bound to 127.0.0.1 they need no
  token — anyone who can reach it can already open the database file directly,
  so a token there adds friction rather than safety. If it is bound to any
  other address, every caller must send `ADMIN_TOKEN` as a bearer, including
  this machine and the app's own buttons, and the routes refuse to run when it
  is unset.
- A localhost-bound service is still reachable by any web page you visit — the
  binding keeps other machines out, not your own browser. Every mutating API
  request is therefore refused when the browser reports it came from another
  site (`Sec-Fetch-Site`, with `Origin` as a fallback). Command-line callers
  such as the scanner send neither header and are unaffected.
- Values stored in the database are treated as untrusted text and escaped
  before rendering. Do not reintroduce `innerHTML` (including d3's `.html()`)
  for anything data-bearing.
- Do not bind this app to `0.0.0.0` or expose it through a tunnel.

## Your data

Everything stays local:

- A CSV import is parsed in the browser and held for that tab only. It is never
  uploaded and never written to a database.
- Scanned data and cached avatars are written to your machine and are gitignored.
- There is no telemetry, no analytics, and no crash reporting.

If you run the scanner, `chrome-profile/` in the data directory holds a live
logged-in LinkedIn session. Never copy, sync, or commit it.

Never commit `public/avatars/` or any exported CSV — they contain real people.
`public/demo-data.json` is committed, but only ever as the generated synthetic
sample; CI fails the build if it appears without its `"synthetic":true` marker,
or if avatars or a raw export show up.
