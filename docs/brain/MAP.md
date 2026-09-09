# Map — what lives where

## Application

| Path | Role |
|---|---|
| `app/page.js` | The main view. Owns view switching, tier filters, data-source selection, and the empty state. |
| `app/components/ForceGraph.js` | The D3 galaxy (~950 lines). Force simulation, rings, cluster expansion, hover cards. |
| `app/components/ChainView.js` | The rotary-dial bridge view. |
| `app/paths` `app/queue` `app/profile` `app/import` `app/setup` `app/launch` | Secondary screens. |
| `app/api/*` | 15 routes. See [`ENDPOINTS.md`](ENDPOINTS.md). |
| `app/api/scraper/route.js` | Spawns the scraper on the app's behalf, so no second terminal or second server is needed. |
| `app/setup/page.js` | The Scan page: preflight checks that fix themselves, then one button. |
| `middleware.js` | Refuses cross-site writes on all of `/api`, then applies the destructive-route gate. |

## Library

| Path | Role |
|---|---|
| `lib/db.js` | **The keystone.** A Supabase-shaped query builder over `node:sqlite`. |
| `lib/gate.js` | Pure, testable auth decisions — `isCrossSiteWrite()`, `gateDecision()`. |
| `lib/rpc.js` | The scoring model at runtime. Mirror of the reference SQL. |
| `lib/network.js` | Shapes rows into the graph the views consume. |
| `lib/csv.js` | Parses LinkedIn's `Connections.csv` in the browser. Never persisted. |
| `lib/user.js` | Identity/context provider. |
| `lib/demo.js` | The static demo-mode short circuit, inherited from v1. |

## Data + scripts

| Path | Role |
|---|---|
| `db/schema.js` | The schema, **as a JS module** — not a `.sql` file. See TRAPS §4. |
| `scripts/scrape.py` | The scraper. The only implementation that has ever actually scraped. |
| `scripts/image_store.py` | Downloads and re-encodes avatars to permanent local WebP. |
| `scripts/gen-synthetic.mjs` | The seeded sample network. Every person invented. |
| `scripts/score_new_connections.sql` | **Reference** scoring model. |
| `scripts/prepare-standalone.mjs` | Copies static assets into `.next/standalone`. See TRAPS §8. |
| `bin/six-degrees.mjs` | The `npx` launcher: Node guard, data dir, port probe from 6363. |
| `tests/*.test.mjs` | 37 tests on `node --test`. No test framework dependency. |

## Data directory

`SIX_DEGREES_HOME`, default `~/.six-degrees`:

```
six-degrees.sqlite        the database (WAL mode)
avatars/                  permanent WebP copies of profile photos
chrome-profile/           the scraper's browser profile — holds a live session
```

**`chrome-profile/` grants access to the user's LinkedIn account.** Treat it like a
password. It is the one artifact here worth protecting.
