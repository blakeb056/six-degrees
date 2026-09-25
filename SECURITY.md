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
  site (`Sec-Fetch-Site`, with `Origin` as a fallback). That includes other
  ports on this same machine: a page from another local app or dev server is
  refused unless its `Origin` is exactly this app's address. Command-line callers
  such as the scanner send neither header and are unaffected.
- A website can also make its own domain point at `127.0.0.1` (DNS rebinding).
  The browser then treats the app as that site's own origin, which would let
  the page read the network and send writes. While the app is bound to
  loopback, every request to `/api` and `/avatars` must be addressed to
  `127.0.0.1`, `localhost` or `[::1]` (the `Host` header); any other name gets
  a 421.
- The Mac app's **Install and restart** (behind the `update` route's gate)
  downloads only what GitHub's `releases/latest` names for this repository:
  this Mac's `.dmg` by its exact file name, from that release's own download
  address, never a pre-release and never a version or address sent by the page.
  Nothing replaces the app unless the image matches the release's `SHA256SUMS`
  (a release without one is refused), the app inside passes
  `codesign --verify --deep --strict`, is Six Degrees (its bundle id) at exactly
  that version, runs on this macOS and chip, and has no link pointing outside
  itself. The checksums come from the same release, so they catch a corrupted,
  truncated or swapped download, not a compromised GitHub account; that is the
  same trust as the Terminal installer. The app is only signed ad hoc, so
  there is no developer signature to check. The swap is done by a script
  shipped inside the app (`scripts/apply-update.sh`), started with a clean
  environment, and it moves only the app: the data folder is never read,
  moved or written. `SIX_DEGREES_TEST_RELEASES` (for tests) is honoured only
  for a `127.0.0.1` address.
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
