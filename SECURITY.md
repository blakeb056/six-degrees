# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/blakeb056/six-degrees/security/advisories/new)
rather than opening a public issue. Expect an initial response within a week.

## Threat model

This app is designed to run **on your own machine, against your own network**.

- The web UI binds to localhost. It is not hardened for exposure to the
  internet, and it has no multi-user authentication or per-user authorization.
- Ten API routes are gated (`admin-delete`, `admin-update`, `delete-cluster`,
  `setup-profile`, `scraper`, `update`, and Settings → Your data's
  `data/export`, `data/import`, `data/restart`, `data/reveal`). The first four
  can irreversibly destroy or rewrite data, `scraper` starts processes, and
  `update` changes the code that runs next. `data/export` hands over the whole
  network in one file, `data/import` replaces it, `data/restart` stops the
  server, and `data/reveal` starts a process (Finder, or the Linux file
  browser, on the data folder's own path). While the server is bound to
  127.0.0.1 they need no token — anyone who can reach it can already open the
  database file directly, so a token there adds friction rather than safety. If
  it is bound to any other address, every caller must send `ADMIN_TOKEN` as a
  bearer, including this machine and the app's own buttons, and the routes
  refuse to run when it is unset. Reading the data folder's facts
  (`GET /api/data`: its path and sizes) changes nothing and stays open, like
  every other read.
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

### Moving your data (Settings → Your data)

- **An export** is one `.sixdegrees` file the user saves and carries. It is
  built from an allow-list (the database, `avatars/`, and the scanner's six
  progress and budget files), never from the folder minus a few things, so
  `chrome-profile/`, `venv/`, `backups/` and `pushback/` never travel, and
  links are never followed out of the folder. The app never uploads it. It
  holds other people's names, headlines and photos, and the page says so.
- **An import is untrusted input**: the file came from somewhere else. Before
  anything in the data folder changes, it must pass SQLite's own integrity
  check (read with `trusted_schema` off), hold only the app's own ordinary
  tables and indexes (no views, triggers, virtual tables or extra columns),
  come from this version or an older one, match its own manifest, and carry
  only allow-listed files whose names can't leave the data folder, each
  matching its SHA-256. The network is then rebuilt into this version's own
  schema, so only rows travel, never table definitions. It is refused while a
  scan runs, and replacing a network that has people needs a confirmation that
  names how many.
- **It is applied at the next start**, never under the open database: what was
  there is kept first in `backups/before-import-<time>.sqlite` (and its photos
  and files beside it), and those copies are never deleted automatically.

Never commit `public/avatars/` or any exported CSV — they contain real people.
`public/demo-data.json` is committed, but only ever as the generated synthetic
sample; CI fails the build if it appears without its `"synthetic":true` marker,
or if avatars or a raw export show up.
