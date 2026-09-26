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
- The Mac app's **Install and restart** (behind the `update` route's gate)
  downloads only what GitHub's `releases/latest` names for this repository,
  and only the version the user's check was shown (the server remembers it):
  this Mac's `.dmg` by its exact file name, from that release's own download
  address, never a pre-release and never a version or address sent by the page.
  Nothing replaces the app unless the image matches the release's `SHA256SUMS`
  (a release without one is refused), the app inside passes
  `codesign --verify --deep --strict` (its code signature is intact), is Six
  Degrees (its bundle id) at exactly that version, runs on this macOS and chip,
  and has no link pointing outside itself. The checksums come from the same
  release, so they catch a corrupted, truncated or swapped download, not a
  compromised GitHub account; that is the same trust as the Terminal
  installer. The app is only signed ad hoc, so the signature proves it is
  whole, not who made it. The swap is done by a script shipped inside the app
  (`scripts/apply-update.sh`), started with a clean environment, and it moves
  only the app: the data folder is never read, moved or written. It stops only
  the app's own processes, the ones the server names and those whose
  executable is inside the app, never a program that merely has a file or
  folder of the app open (a Terminal in its folder, an editor). It never
  replaces an app another user of the Mac has open. `SIX_DEGREES_TEST_RELEASES`
  (for tests) is honoured only for a `127.0.0.1` address.
- **The scanner's Python.** The Mac app carries its own: CPython 3.12.14 from
  python-build-standalone (release 20260814), which the build checks against a
  SHA-256 pinned in `lib/scanner-python.js` before unpacking it, with the
  scanner's packages installed from PyPI when the app is built. Those packages
  are pinned in `scripts/requirements.txt`: an exact version and the SHA-256 of
  every file pip may install, wheels only, so pip refuses any other file and
  nothing is built from source. The Python is signed ad hoc like the rest of the
  app and sealed into its signature, which `codesign --verify --deep --strict`
  checks (in CI, and before the in-app updater uses a download). It runs with
  no user site-packages, `PYTHONPATH` or `PYTHONHOME`, so nothing of the user's
  can stand in for its packages, and it writes no bytecode into the app.
- **Set up the scanner** (the Scan page, for `npx six-degrees` and source copies
  on a computer with no Python 3.10–3.14 it can use) downloads only when that
  button is pressed, and only from two places:
  - **GitHub's release download** for python-build-standalone (`github.com`,
    which hands the file over from GitHub's own download server): the one file
    pinned for this operating system and chip (`lib/scanner-python.js`: Linux
    x64 and arm64, macOS Apple Silicon and Intel). Its size and SHA-256 must
    match before it is even named, let alone unpacked; a file that doesn't is
    deleted.
  - **PyPI** (`pypi.org`, `files.pythonhosted.org`) for the scanner's packages,
    every file checked against `scripts/requirements.txt`. (pip follows your
    own pip settings for which index to ask, if you have any; the hashes still
    have to match.)

  The Python lands in the data folder's `python/`, the packages in `venv/`;
  nothing outside the data folder changes, and neither is ever exported. The
  checksums come from this repository, not from the servers, so a swapped or
  corrupted download is refused; a release that was compromised before its
  checksums were taken would not be.
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
  built from an allow-list (the database, the photos its rows still point at,
  and the scanner's six progress and budget files), never from the folder minus
  a few things, so `chrome-profile/`, `venv/`, `python/`, `backups/` and
  `pushback/` never travel, and links are never followed out of the folder (a link standing in
  for `avatars/` itself included). The app never uploads it. It holds other
  people's names, headlines and photos, and the page says so.
- **An import is untrusted input**: the file came from somewhere else. Before
  anything in the data folder changes, it must pass SQLite's own integrity
  check (read with `trusted_schema` off), hold only the app's own ordinary
  tables and indexes (no views, triggers, virtual tables or extra columns),
  come from this version or an older one, match its own manifest, and carry
  only allow-listed files whose names can't leave the data folder, each
  matching its SHA-256. The LinkedIn budget files must also follow the rules
  the app writes them by: limits only from the Scan page's own menu (the
  scanner reads a daily limit of 0 as no limit at all). The network is then
  rebuilt into this version's own schema, so only rows travel, never table
  definitions. It is refused while a scan (or the scanner's setup) runs, and
  replacing a network that has people needs a confirmation that names how many.
- **The upload never sits in memory.** Next copies the body of every request
  `middleware.js` sees into memory before middleware decides anything, so the
  import route is left out of it and makes the same checks itself
  (`lib/gate.js requestRefusal`: rebinding, cross-site, the gate) before it
  reads a byte. The body is then written to disk as it arrives, at most
  256 MB, and must match the size the page declared. Every other route keeps
  Next's 10 MB limit.
- **It is applied at the next start**, never under the open database, and never
  while another process has it open (a second copy of Six Degrees on the same
  folder). What was there is kept first in `backups/before-import-<time>.sqlite`
  (and its photos and files beside it), synced to the disk and checked (SQLite's
  quick check, and every table's row count against the original) before the
  original is replaced; those copies are never deleted automatically. The
  LinkedIn budget files are merged with this computer's, not replaced: they
  belong to the account.

Never commit `public/avatars/` or any exported CSV — they contain real people.
`public/demo-data.json` is committed, but only ever as the generated synthetic
sample; CI fails the build if it appears without its `"synthetic":true` marker,
or if avatars or a raw export show up.
