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
| `GET/POST /api/settings` | `GET` returns `{settings, about}`: the saved settings with defaults (`lib/settings.js`), and `about` = `{version, kind, dataDir, customDataDir}`. Local only, no network. `POST {settings: {…}}` saves a partial change: only the keys sent are rewritten, and everything else stored stays as it was (including settings a newer version saved). An undeclared key or a bad value is a 400 with a message fit to show, and nothing is written. `sectorFocus.sectors` takes up to three keys: the twelve broad industries' and the sector directory's (`lib/sector-directory.js`). A saved change can set work in motion (`lib/settings-effects.js`): a new `sectorFocus` (a different fingerprint; a strength with no sectors doesn't count) rescores everyone and the answer carries `effects: {sectorFocus: {scored, people, moved, up, down}}`: `scored` rows, `people` people (a person can be several rows), and people whose tier changed, counted by the preview's own function, so they match what the preview said. Each changed setting's work runs even if another's fails. If any fails, the save has still landed: a 500 with the saved `settings`, the `effects` that did finish, and an `error` naming each failure. |
| `POST /api/settings/sector-preview` | Settings → Your sector, before saving. `{sectorFocus: {sectors, strength}}` → what saving it would change against the saved one: `{scored, people, companies, companiesUp, companiesDown, companyExamples, up, down, examples}`. `companies` counts every company whose score moves, a former employer included, and `companyExamples` are `{name, from, to, sector}`, `sector` being the pick that leans it; `examples` are the first few people who'd change tier (`{name, degree, company, from, to}`). Reads the network once (`readForScoring()`: industries and the sector directory's matches, as a save does) and scores it twice in memory with rescoreAll's inputs; **writes nothing**. A bad focus is a 400. A POST only because it takes a body. |
| `GET /api/settings/sector-suggestions` | Settings → Your sector, "Suggested from your network": `{scored, suggestions: [{key, label, group, people, companies}]}`, the five sector-directory sectors with the most scanned people (each once) working now at a company that matches, and how many such companies (`lib/sector-directory.js` `suggestSectors`). Read-only and local; it reads every row through `readForScoring()`, as rescoring does. It is its own route rather than a field of `GET /api/settings`, because the profile page loads that one too and shouldn't pay for reading the whole network. A CSV import or the sample network isn't in the database, so it isn't counted. |
| `GET/POST /api/company-scores` | Every company in the network with its score, where it comes from (yours, known list, estimate), its one industry (the one scoring uses) and `sectorBonus` (what *Your sector* adds, else 0; a pick from the sector directory counts by the directory's matches, as rescoring does). `POST {name, score}` sets a score (1–10), and `score: null` returns it to automatic. Either way, everyone is rescored. |
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
