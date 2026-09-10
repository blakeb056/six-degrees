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
| `GET/POST /api/update` | Updates a git checkout. `GET` reads local state only (no network). `POST {action:'check'}` runs `git fetch`; `POST {action:'pull'}` fast-forwards. **Gated: it changes the code that runs next.** Refuses on a dirty tree, naming the files; `package-lock.json` alone is discarded because npm regenerates it. |
| `GET/POST /api/scraper` | Runs the scraper. `GET` reports preflight status; `POST` takes a fixed action enum (`install`/`login`/`full`/`refresh`/`cancel`). **Gated because it spawns processes** — more power than any of the four above. No part of a command line ever comes from the request. |

`lib/gate.js` `gateDecision()`: a valid token allows; a loopback bind allows; **no token
set on an exposed server fails closed with 503**, not open. That last case is the one
that matters — a misconfigured deployment must not become a wipe vector.

## Open

| Route | Does |
|---|---|
| `GET/POST /api/connections` | Read connections. The scraper's read path. |
| `POST /api/ingest` | The write path. Parses headlines, scores, upserts. |
| `POST /api/update-images` | Batch-attaches local avatar paths (100 per call). |
| `GET/POST /api/users` | List, look up, or create a local profile. |
| `GET /api/network` | The shaped graph the views consume. |
| `GET/POST /api/queue` | Outreach queue. |
| `GET/POST /api/notifications` | Notifications. |
| `POST /api/outreach` | Marks outreach sent. |
| `POST /api/unlock` | Unlocks a path when a bridge is mapped. |
| `POST /api/bulk-import` | CSV path. |
| `GET /api/avatars/[file]` | Serves captured avatars from the data directory. |

## The cross-site rule

`isCrossSiteWrite()` in `lib/gate.js`, applied to every `/api` write:

1. Not a write (`GET`/`HEAD`) → allowed. Reads are never blocked.
2. `Sec-Fetch-Site` present → allow only `same-origin`, `same-site`, `none`. The browser
   sets this and a page cannot forge it.
3. No `Sec-Fetch-Site`, but `Origin` present → compare hosts; an unparseable `Origin` is
   treated as hostile.
4. Neither header → **not a browser** (curl, the Python scraper). Allowed; the loopback
   bind is what protects it.

The reason this is enforced at the request rather than the response: a cross-origin
`POST` with `Content-Type: text/plain` is a CORS **simple request** — no preflight. By
the time a response could be refused, the handler has already run.
