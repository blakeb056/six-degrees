# Endpoints

All under `app/api/`. Every one runs through `middleware.js`, which refuses cross-site
writes before anything else.

## Gated — require `ADMIN_TOKEN` as a bearer, or a loopback bind

Irreversibly destructive. The UI never calls them; the scraper sends the token.

| Route | Does |
|---|---|
| `POST /api/admin-delete` | Deletes connections. |
| `POST /api/admin-update` | Bulk field updates. |
| `POST /api/delete-cluster` | Deletes an entire bridge cluster. |
| `POST /api/setup-profile` | Overwrites the profile. |
| `GET/POST /api/update` | Updates a git checkout. `GET` reads local state only (no network). `POST {action:'check'}` runs `git fetch`; `POST {action:'pull'}` fast-forwards. **Gated: it changes the code that runs next.** Refuses on a dirty tree, naming the files; `package-lock.json` alone is discarded because npm regenerates it. On an **installed** copy (Mac app, npm package) `GET` returns `{installed, kind, version, command}` and the only action is `POST {action:'check-release'}`: one GET to GitHub for the newest release's version, click-only (spec invariant 2). |
| `GET/POST /api/scraper` | Runs the scraper. `GET` reports preflight status, the network by degree (`network: {first, second, third}`), a running scan's `progress` read from its output (`lib/scan-progress.js`) and, after a failed run, `failure` — the end of its stderr. `POST` takes a fixed action enum (`install`/`login`/`full`/`refresh`/`cancel`). **Gated because it spawns processes** — more power than any of the four above. No part of a command line ever comes from the request; the profile it writes into is passed as `SIX_DEGREES_USER_ID`. |

`lib/gate.js` `gateDecision()`: a valid token allows; a loopback bind allows; **no token
set on an exposed server fails closed with 503**, not open. That last case is the one
that matters — a misconfigured deployment must not become a wipe vector.

## Open

| Route | Does |
|---|---|
| `GET/POST /api/connections` | Read connections. The scraper's read path. |
| `POST /api/ingest` | The write path. Parses headlines and upserts, then rescores everyone (`lib/scoring.js`, via `rpc('score_new_connections')`). |
| `GET/POST /api/settings` | `GET` returns `{settings, about}`: the saved settings with defaults (`lib/settings.js`), and `about` = `{version, kind, dataDir, customDataDir}`. Local only, no network. `POST {settings: {…}}` saves a partial change: only the keys sent are rewritten, and everything else stored stays as it was (including settings a newer version saved). An undeclared key or a bad value is a 400 with a message fit to show, and nothing is written. A saved change can set work in motion (`lib/settings-effects.js`): a new `sectorFocus` rescores everyone and the answer carries `effects: {sectorFocus: {scored, moved, up, down}}` (people whose tier changed, each counted once). If that work fails, the save has still landed: a 500 with the saved `settings` and an `error` saying so. |
| `POST /api/settings/sector-preview` | Settings → Your sector, before saving. `{sectorFocus: {sectors, strength}}` → what saving it would change against the saved one: `{scored, companies, companiesUp, companiesDown, companyExamples, up, down, examples}`, where `examples` are the first few people who'd change tier (`{name, degree, company, from, to}`). Scores the network twice in memory with rescoreAll's inputs; **writes nothing**. A bad focus is a 400. A POST only because it takes a body. |
| `GET/POST /api/company-scores` | Every company in the network with its score, where it comes from (yours, known list, estimate), its one industry (the one scoring uses) and `sectorBonus` (what *Your sector* adds, else 0). `POST {name, score}` sets a score (1–10), and `score: null` returns it to automatic. Either way, everyone is rescored. |
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
