# Endpoints

All under `app/api/`. Every one runs through `middleware.js`, which refuses cross-site
writes before anything else, except `POST`/`DELETE /api/data/import`: middleware.js
leaves it alone so Next doesn't copy the upload into memory first, and its handlers make
exactly the same checks themselves (`lib/gate.js requestRefusal`) before they read
anything. See [Request bodies over 10 MB](#request-bodies-over-10-mb).

## Gated — require `ADMIN_TOKEN` as a bearer, or a loopback bind

The first four are irreversibly destructive, and the UI never calls them; the scraper
sends the token. The rest sit behind the same gate because they start processes, change
the code, or hand over or replace the whole network; the app's own buttons call them
(Scan, Updates, Settings → Your data). The list is `DESTRUCTIVE_ROUTES` in `lib/gate.js`,
pinned exactly by `tests/gate.test.mjs`.

| Route | Does |
|---|---|
| `POST /api/admin-delete` | Deletes connections. |
| `POST /api/admin-update` | Bulk field updates. |
| `POST /api/delete-cluster` | Deletes an entire bridge cluster. |
| `POST /api/setup-profile` | Overwrites the profile. |
| `GET/POST /api/update` | Updates a git checkout. `GET` reads local state only (no network). `POST {action:'check'}` runs `git fetch`; `POST {action:'pull'}` fast-forwards. **Gated: it changes the code that runs next.** Refuses on a dirty tree, naming the files; `package-lock.json` alone is discarded because npm regenerates it. On an **installed** copy (Mac app, npm package) `GET` returns `{installed, kind, version, command}` and the only action is `POST {action:'check-release'}`: one GET to GitHub for the newest release's version, click-only (spec invariant 2). |
| `GET/POST /api/scraper` | Runs the scraper. `GET` reports preflight status, the network by degree (`network: {first, second, third}`), a running scan's `progress` read from its output (`lib/scan-progress.js`) and, after a failed run, `failure` — the end of its stderr. `POST` takes a fixed action enum (`install`/`login`/`full`/`refresh`/`cancel`). **Gated because it spawns processes** — more power than any of the four above. No part of a command line ever comes from the request; the profile it writes into is passed as `SIX_DEGREES_USER_ID`. While an import waits to finish (below), every action but `install`, `login`, `cancel` and the two settings is refused with 409: anything scanned then would land in the network about to be set aside. |
| `POST /api/data/export` | Settings → Your data → *Save a copy*. Body `{photos: false}` leaves the photos out (default: in). Answers with one `.sixdegrees` file as an attachment (`Content-Disposition`), plus `X-Six-Degrees-People` / `-Photos`; the page turns it into a download. It is a SQLite database: `VACUUM INTO` of the live one, plus `sd_export_manifest` and `sd_export_files` ([`SCHEMA.md`](SCHEMA.md)). Built from an allow-list (`lib/data-folder.js`), in a private folder inside the data folder that is gone before the first byte is sent. **Gated: it hands over the whole network.** |
| `POST /api/data/import` | The body is the `.sixdegrees` file itself, with `X-Six-Degrees-Size` (its size: the bytes that arrive must match, so a body cut short can't pass for a whole one) and, when this copy already has people, `X-Six-Degrees-Replace: <how many>`, the count the user agreed to replace (a different count is a 409 with `needsConfirm`, and the page asks again). 409 while a scan runs or another import waits; 413 over 256 MB (`MAX_IMPORT_BYTES`). All of that is decided before a byte of the body is read (`admitImport`), and the body is written to disk as it arrives. Checks everything (`lib/data-import.js validateImport`), rebuilds the network into this version's schema in `import-pending/`, and answers `{ok, pending}`. **Nothing in the data folder changes until the next start**, when `getDb()` swaps it in: not while another process has the database open, and only after the copy kept of it checks out. The network's own files are replaced; the LinkedIn budget files are merged with this computer's (`lib/linkedin-limits.js mergeBudgetFiles`). `DELETE` throws away an import that hasn't started. **Gated: it replaces the network. Left out of `middleware.js`, so it runs the same checks itself.** |
| `POST /api/data/restart` | Finishes a waiting import by restarting: the server exits with `SIX_DEGREES_RESTART_CODE` (75), which only the Mac app's shell sets and treats as "start the server again" (`desktop/lib.mjs serverExitAction`). 409 when this copy can't restart itself (npx, source: the page says to press Ctrl-C and start it again), when no import waits, or while a scan runs. **Gated: it stops the server.** |
| `POST /api/data/reveal` | Opens the data folder in Finder (`open`) or the Linux file browser (`xdg-open`). The path is the data folder's own; nothing is taken from the request. **Gated: it starts a process.** |

`lib/gate.js` `gateDecision()`: a valid token allows; a loopback bind allows; **no token
set on an exposed server fails closed with 503**, not open. That last case is the one
that matters — a misconfigured deployment must not become a wipe vector.

## Open

| Route | Does |
|---|---|
| `GET/POST /api/connections` | Read connections. The scraper's read path. |
| `POST /api/ingest` | The write path. Parses headlines and upserts, then rescores everyone (`lib/scoring.js`, via `rpc('score_new_connections')`). |
| `GET /api/data` | Settings → Your data: `{dataDir, dbFile, databaseBytes (with -wal/-shm), photos: {count, bytes}, photosInCopy: {count, bytes} (only those a row points at: what a copy carries), backups: [{name, bytes, modifiedAt, kind: auto/import/manual, folder}], linkedinSignIn, people, platform, kind, customDataDir, pending, lastImport, restart: {canRestart, how, command?}, maxImportBytes}`. Sizes come from `lstat` only; nothing in the folder is read, and `chrome-profile/` is only reported as there or not, never looked inside. Changes nothing, so it stays open like every other read. |
| `GET/POST /api/settings` | `GET` returns `{settings, about}`: the saved settings with defaults (`lib/settings.js`), and `about` = `{version, kind, dataDir, customDataDir}`. Local only, no network. `POST {settings: {…}}` saves a partial change; an undeclared key or a bad value is a 400 with a message fit to show, and nothing is written. |
| `GET/POST /api/company-scores` | Every company in the network with its score and where it comes from (yours, known list, estimate). `POST {name, score}` sets a score (1–10), and `score: null` returns it to automatic. Either way, everyone is rescored. |
| `POST /api/update-images` | Batch-attaches local avatar paths (100 per call). |
| `GET/POST /api/users` | List, look up, or create a local profile. `?me=1` returns the profile this machine uses, creating it on first run (`lib/profile.js`). |
| `GET /api/network` | The shaped graph the views consume. |
| `GET/POST /api/queue` | Outreach queue. |
| `GET/POST /api/notifications` | Notifications. |
| `POST /api/outreach` | Marks outreach sent. |
| `POST /api/unlock` | Unlocks a path when a bridge is mapped. |
| `POST /api/bulk-import` | CSV path. |
| `GET /api/avatars/[file]` | Serves captured avatars from the data directory. |

## The rebinding rule

`isRebound()` in `lib/gate.js`, applied first to every `/api` and `/avatars` request,
reads included: when the server is bound to loopback, a `Host` that isn't `127.0.0.1`,
`localhost`, `[::1]` or `0.0.0.0` is refused with 421. A DNS-rebinding page makes the
browser call the app by the attacker's domain; to the browser that is same-origin, so
the cross-site rule below can't see it, but the `Host` header gives it away. Bound
anywhere else, the rule stands aside and `ADMIN_TOKEN` guards the destructive routes.

## The cross-site rule

`isCrossSiteWrite()` in `lib/gate.js`, applied to every `/api` write:

1. Not a write (`GET`/`HEAD`) → allowed. Reads are never blocked.
2. `Sec-Fetch-Site` present → allow `same-origin` and `none`. `same-site` is allowed only
   when `Origin` is exactly this host and port: a site ignores the port, so a page on any
   other `127.0.0.1` port is "same-site" with the app. Anything else is refused. The
   browser sets this header and a page cannot forge it.
3. No `Sec-Fetch-Site`, but `Origin` present → compare hosts; an unparseable `Origin` is
   treated as hostile.
4. Neither header → **not a browser** (curl, the Python scraper). Allowed; the loopback
   bind is what protects it.

The reason this is enforced at the request rather than the response: a cross-origin
`POST` with `Content-Type: text/plain` is a CORS **simple request** — no preflight. By
the time a response could be refused, the handler has already run.

## Request bodies over 10 MB

For every request `middleware.js` runs on, Next copies the body into memory first, so both
middleware and the route can read it: all of it, up to `experimental.proxyClientMaxBodySize`
(10 MB by default), before middleware has decided anything, and it waits for the whole
upload even when middleware then refuses it. Past the limit it keeps the first 10 MB with a
console warning and **no error**, and the route sees a shorter body.

Raising the limit is not the fix. At 512 MB (tried for the import), a refused cross-site
300 MB `POST` to an ordinary route grew the server by about 300 MB. So the limit stays at
Next's 10 MB, and a route that takes a large body is left out of middleware instead. Today
that is one, `POST /api/data/import`: the matcher in `middleware.js` leaves out exactly that
path, and `tests/gate.test.mjs` pins it with Next's own matcher code. Such a route must:

1. make middleware's checks itself, first, before it touches the body:
   `requestRefusal()` from `lib/gate.js`, the same function `middleware.js` calls
   (`lib/data-import.js admitImport` does that, then the import's own checks);
2. read `request.body` as a stream and write it to disk as it arrives
   (`receiveUpload`), never `request.arrayBuffer()`, `.text()` or `.formData()`;
3. cap it (`MAX_IMPORT_BYTES`, 256 MB) and compare what arrived with the size the page
   declared (`X-Six-Degrees-Size`).
