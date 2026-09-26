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
| `GET/POST /api/update` | Updates a git checkout. `GET` reads local state only (no network). `POST {action:'check'}` runs `git fetch`; `POST {action:'pull'}` fast-forwards. **Gated: it changes the code that runs next.** Refuses on a dirty tree, naming the files; `package-lock.json` alone is discarded because npm regenerates it. On an **installed** copy (Mac app, npm package) `GET` returns `{installed, kind, version, command}`, plus for the Mac app `lastUpdate` (how the last in-app update went, from `~/Library/Caches/Six Degrees/last-update.json`, for a week; nothing once this copy has reached that version another way) and `job` (one under way). Local only: every page calls it. Its one write: while an in-app update to exactly this version is waiting on it, the first `GET` writes `~/Library/Caches/Six Degrees/update-confirmed.json`, which tells the helper this version has started (`lib/updater-job.js` `confirmStarted`). Actions, a fixed enum; nothing but the action is read from the body (spec invariant 2): `check-release`, one GET to GitHub's `releases/latest` for the newest version, and for the Mac app `install: {possible, size}` or `{possible: false, reason, code}` and `fallback`, what the Terminal line would do for this copy (`{mode:'replace'}`, `{mode:'elsewhere', installsTo}`, or `null` where it must not be offered: `lib/updater.js` `terminalFallback`); the server remembers the version it offered, and tidies up what an interrupted update left (`cleanLeftovers`); `install-release` (Mac app, the second click) starts the background job in `lib/updater-job.js` for exactly that version (202, or 409 with the reason and `fallback`: running from the disk image, a translocated or unwritable folder, another user's app, a network kept inside the app, a database kept elsewhere (`SIX_DEGREES_DB`), a scan or the scanner's setup running (the reason names which: `lib/scan-state.js busyRefusal`), or no check on this server yet); `update-status`, that job (local); `cancel-install`, stops it until it restarts. The job re-reads `releases/latest` itself and stops (`code: 'stale-check'`) if that no longer names the version offered, refuses while another user of the Mac has the app open, downloads this chip's `.dmg` and `SHA256SUMS`, verifies, stages beside the app, starts `scripts/apply-update.sh` and ends the server with exit code 76 (TRAPS §39). `SIX_DEGREES_TEST_RELEASES=http://127.0.0.1:<port>` points the check and the download at a pretend release (`scripts/test-release-server.mjs`); honoured only for a 127.0.0.1 address, never set by the app, and shown on the page when set. |
| `GET/POST /api/scraper` | Runs the scraper. `GET` reports preflight status, the network by degree (`network: {first, second, third}`), a running scan's `progress` read from its output (`lib/scan-progress.js`; for `setup`, the Python download's) and, after a failed run, `failure` — the end of its stderr. Its `checks` say which Python the scanner runs on (`lib/scanner-python.js choosePython`: the Mac app's own, named in `SIX_DEGREES_PYTHON`; then `venv/`; then a Python that already has the packages): `pythonSource` (`bundled`, `custom`, `venv`, `system`), `pythonPath`, `pythonVersion`, `dependencies`; when none does, `installFrom` (`{source: 'system'|'downloaded', version}`, what Install builds from), or `download` (`{version, size, from: 'github.com'}`, what Set up the scanner fetches), `systemPython` (a Python here that won't do: `{version, venv}`) and `ownPython` (`{source, problem}`, when the named one failed). A look starts Pythons, so it is cached for 4 s, shared by callers that arrive meanwhile, and the app's own is asked once. `POST` takes a fixed action enum (`install`/`setup`/`login`/`full`/`refresh`/…/`cancel`). `install` builds `venv/`, installs `scripts/requirements.txt` into it (every file pinned by SHA-256, wheels only; with the user's pip settings except `PIP_TARGET`, `PIP_PREFIX`, `PIP_ROOT` and `PIP_USER`, which would put them elsewhere), then checks that they load there, so a misdirected install fails with a reason (`lib/scanner-python.js installSteps`); 409 when the scanner is already set up, or when there is nothing to build from but a download. `setup` first downloads the python-build-standalone file pinned for this OS and chip into `python/` (GitHub's release download; size and SHA-256 checked before anything is unpacked, `lib/scanner-python.js downloadVerified`), then does what `install` does; 409 when a Python 3.10–3.14 is here already (use `install`) or there is no build for this computer. `cancel` also stops a download in progress; its folder goes. **Gated because it spawns processes** — more power than any of the four above. No part of a command line ever comes from the request; the profile it writes into is passed as `SIX_DEGREES_USER_ID`. While an import waits to finish (below), every action but `install`, `setup`, `login`, `cancel` and the two settings is refused with 409: anything scanned then would land in the network about to be set aside. |
| `POST /api/data/export` | Settings → Your data → *Save a copy*. Body `{photos: false}` leaves the photos out (default: in). Answers with one `.sixdegrees` file as an attachment (`Content-Disposition`), plus `X-Six-Degrees-People` / `-Photos`; the page turns it into a download. It is a SQLite database: `VACUUM INTO` of the live one, plus `sd_export_manifest` and `sd_export_files` ([`SCHEMA.md`](SCHEMA.md)). Built from an allow-list (`lib/data-folder.js`), in a private folder inside the data folder that is gone before the first byte is sent. **Gated: it hands over the whole network.** |
| `POST /api/data/import` | The body is the `.sixdegrees` file itself, with `X-Six-Degrees-Size` (its size: the bytes that arrive must match, so a body cut short can't pass for a whole one) and, when this copy already has people, `X-Six-Degrees-Replace: <how many>`, the count the user agreed to replace (a different count is a 409 with `needsConfirm`, and the page asks again). 409 while a scan, Install, Set up the scanner or the sign-in window runs (the reason names which) or another import waits; 413 over 256 MB (`MAX_IMPORT_BYTES`). All of that is decided before a byte of the body is read (`admitImport`), and the body is written to disk as it arrives. Checks everything (`lib/data-import.js validateImport`), rebuilds the network into this version's schema in `import-pending/`, and answers `{ok, pending}`. **Nothing in the data folder changes until the next start**, when `getDb()` swaps it in: not while another process has the database open, and only after the copy kept of it checks out. The network's own files are replaced; the LinkedIn budget files are merged with this computer's (`lib/linkedin-limits.js mergeBudgetFiles`). `DELETE` throws away an import that hasn't started. **Gated: it replaces the network. Left out of `middleware.js`, so it runs the same checks itself.** |
| `POST /api/data/restart` | Finishes a waiting import by restarting: the server exits with `SIX_DEGREES_RESTART_CODE` (75), which only the Mac app's shell sets and treats as "start the server again" (`desktop/lib.mjs serverExitAction`). 409 when this copy can't restart itself (npx, source: the page says to press Ctrl-C and start it again), when no import waits, or while the Scan page runs something (a scan, Install, Set up the scanner, the sign-in window; the reason names which). **Gated: it stops the server.** |
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
| `GET/POST /api/settings` | `GET` returns `{settings, about}`: the saved settings with defaults (`lib/settings.js`), and `about` = `{version, kind, dataDir, customDataDir}`. Local only, no network. `POST {settings: {…}}` saves a partial change: only the keys sent are rewritten, and everything else stored stays as it was (including settings a newer version saved). An undeclared key or a bad value is a 400 with a message fit to show, and nothing is written. `sectorFocus.sectors` takes up to three keys: the twelve broad industries' and the sector directory's (`lib/sector-directory.js`). A saved change can set work in motion (`lib/settings-effects.js`): a new `sectorFocus` (a different fingerprint; a strength with no sectors doesn't count) rescores everyone and the answer carries `effects: {sectorFocus: {scored, people, moved, up, down}}`: `scored` rows, `people` people (a person can be several rows), and people whose tier changed, counted by the preview's own function, so they match what the preview said. Each changed setting's work runs even if another's fails. If any fails, the save has still landed: a 500 with the saved `settings`, the `effects` that did finish, and an `error` naming each failure. |
| `POST /api/settings/sector-preview` | Settings → Your sector, before saving. `{sectorFocus: {sectors, strength}}` → what saving it would change against the saved one: `{scored, people, companies, companiesUp, companiesDown, companyExamples, up, down, examples}`. `companies` counts every company whose score moves, a former employer included, and `companyExamples` are `{name, from, to, sector}`, `sector` being the pick that leans it; `examples` are the first few people who'd change tier (`{name, degree, company, from, to}`). Reads the network once (`readForScoring()`: industries and the sector directory's matches, as a save does) and scores it twice in memory with rescoreAll's inputs; **writes nothing**. A bad focus is a 400. A POST only because it takes a body. |
| `GET /api/settings/sector-suggestions` | Settings → Your sector, "Suggested from your network": `{scored, suggestions: [{key, label, group, people, companies}]}`, the five sector-directory sectors with the most scanned people (each once) working now at a company that matches, and how many such companies (`lib/sector-directory.js` `suggestSectors`). Read-only and local; it reads every row through `readForScoring()`, as rescoring does. It is its own route rather than a field of `GET /api/settings`, because the profile page loads that one too and shouldn't pay for reading the whole network. A CSV import or the sample network isn't in the database, so it isn't counted. |
| `GET/POST /api/company-scores` | Every company in the network with its score, where it comes from (yours, known list, estimate), its one industry (the one scoring uses) and `sectorBonus` (what *Your sector* adds, else 0). Each company is read with `readForScoring()`, as rescoring reads it: a pick from the sector directory counts by the directory's matches, and an industry includes its sectors. `POST {name, score}` sets a score (1–10), and `score: null` returns it to automatic. Either way, everyone is rescored. |
| `GET/POST /api/company-scores/legacy` | Paths → Scores' one-time offer to keep the curated list's old scores as your own (`lib/legacy-offer.js`, SCORING.md). `GET` → `{offer: null}`, or `{offer: {companies: [{name, was, now, estimated, people, names}]}}`: each old entry that someone in the network works at now, whose built-in score changed, and that you haven't scored yourself. `POST {keep: [names]}` answers it: the named entries' old scores are written to `company_scores` under every name in their `names`, as `POST /api/company-scores` writes one, then everyone is rescored once → `{success, kept, scored}`. `{keep: []}` is No thanks. Either answer closes the offer for good; a second answer changes nothing. Only names come from the page, and a name not on offer is ignored: the scores are the old list's own. Not a list of names is a 400. If the rescore fails, the answer is still saved: a 500 with `kept` and an `error` saying the next map load will rescore. The POST is a write, so the cross-site guard in `middleware.js` covers it. |
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
