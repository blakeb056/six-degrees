# Map — what lives where

## Application

| Path | Role |
|---|---|
| `app/page.js` | The main view. Owns view switching, tier filters, data-source selection, and the empty state. |
| `app/components/views.js` | **The view registry.** One row per visual: its component, which modes it belongs to, and any exception it needs. `page.js` and `FilterPanel` both read it, so the menu can never offer a view that does not exist. |
| `app/components/OrbitGraph.js` | Orbit — tier orbits with each bridge's circle fanned beside them as dots. |
| `app/components/BridgeRing.js` | Revolver — the rotary dial; spin to switch bridge, circle fans from the top slot. |
| `app/components/ForceGraph.js` | The D3 galaxy (~950 lines). Force simulation, rings, cluster expansion, hover cards. |
| `app/components/ChainView.js` | The rotary-dial bridge view. |
| `app/components/SeparationView.js` | Separation: every 2nd-degree person ranked, one row each with every way in, under a small map of the top of the list. Windowed, so it is never capped. |
| `app/components/PathsAnalyzer.js` | Paths → Map and Industries: an InMaps-style company map by inferred industry, industry cards, and the analyzer panel for a company or industry. |
| `app/components/CompanyScores.js` | Paths → Scores: every company with its score, where the score comes from, and the control to set your own. |
| `app/components/OutlinkQuest.js` | Outlink → Circles: working through each mapped circle five people at a time (rules in `lib/quest.js`). |
| `app/paths` `app/queue` `app/profile` `app/import` `app/setup` `app/launch` | Secondary screens. |
| `app/settings/page.js` | Settings: Updates (`UpdatePanel`), About this copy, and a `<Section>` per feature that adds a setting. Reached from the ⚙ button and *Six Degrees → Settings…* (⌘,). |
| `app/components/ui.js` | Shared pieces for Settings (`Section`, `Body`, `Mono`, `Status`, `Btn`). New screens use these rather than a private copy. |
| `app/components/settings/DataSection.js` | Settings → Your data: the data folder (path, *Copy*, *Show in Finder*), what it takes up, the backups, and moving the network to another computer (save a copy, import one, restart to finish). Only asks the server, on a click; the work is in `lib/data-*.js`. |
| `lib/settings.js` | What the user chose, as one JSON object in `app_meta` 'settings', so it travels with the data. Each setting declares a default and a `parse()`; undeclared keys are refused. |
| `app/api/*` | 24 routes. See [`ENDPOINTS.md`](ENDPOINTS.md). |
| `app/api/data/*` | Settings → Your data: `GET /api/data` (the folder's facts, open) and the gated `export`, `import`, `restart`, `reveal`. |
| `app/api/scraper/route.js` | Spawns the scraper on the app's behalf, so no second terminal or second server is needed. |
| `app/setup/page.js` | The Scan page: preflight checks that fix themselves, then one button. |
| `middleware.js` | Refuses requests addressed to another name, then cross-site writes, on all of `/api` and `/avatars`, then applies the destructive-route gate (`lib/gate.js requestRefusal`). Leaves out exactly `/api/data/import`, whose handlers make the same checks themselves before reading the upload (ENDPOINTS.md, "Request bodies over 10 MB"). |

## Library

| Path | Role |
|---|---|
| `lib/db.js` | **The keystone.** A Supabase-shaped query builder over `node:sqlite`. |
| `lib/db-client.js` | The one database handle (`getDb()`), the data folder, the schema step, and the backup before a new version. At the start, before it opens anything, `getDb()` finishes an import staged in `import-pending/` (`lib/data-import.js`), once per server process. |
| `lib/data-folder.js` | The data folder: what the Settings page shows about it (sizes from `lstat` only; `chrome-profile/` as there or not), the allow-list of what travels (`TRAVELLING_FILES` = `NETWORK_FILES`, replaced by an import, + `BUDGET_FILES`, merged; `AVATAR_FILE`, shared with the `/avatars` route), and opening it in Finder. Never follows a link, even one standing in for `avatars/`. |
| `lib/data-export.js` | Builds the `.sixdegrees` file: `VACUUM INTO`, then the manifest and the allow-listed files with their SHA-256 ([`SCHEMA.md`](SCHEMA.md)). Only the photos a row still points at. |
| `lib/data-import.js` | Checks an upload before reading it (`admitImport`) and the file after (untrusted: SECURITY.md), rebuilds it into this version's schema in `import-pending/`, and swaps it in at the next start, step by step (a journal on the disk), after keeping what was there in `backups/`: never while another process has the database open, and only once the kept copy is synced and checks out. `RETIRED` lists names older exports may still have. Also what the page says about restarting. |
| `lib/durable.js` | Writes that must be on the disk before the next step counts on them: sync a file, sync a folder (so a rename is), write a file whole or not at all. Node's fsync is F_FULLFSYNC on a Mac. |
| `lib/linkedin-limits.js` | The LinkedIn search budget and cooldown, read with the scanner's rules; the Scan page's two edits; and an import's budget files, checked (`budgetFileProblem`) and merged (`mergeBudgetFiles`), since they belong to the account. |
| `lib/gate.js` | Pure, testable auth decisions — `isRebound()`, `isCrossSiteWrite()`, `gateDecision()`, and `requestRefusal()`, all three in order: what `middleware.js` and the import route both call. |
| `lib/scoring.js` | **The scoring model: the only one.** Titles, companies, bonuses, bridge boost, tiers, and the `score_why` wording. See [`SCORING.md`](SCORING.md). |
| `lib/rpc.js` | The local stand-ins for hosted stored procedures. `rescoreAll()` writes `lib/scoring.js`'s results back to every row. |
| `lib/companies.js` | Companies and industries for Paths: the company index, inferred industries, company-to-company links, ways in. Reads titles and companies through `lib/scoring.js`. |
| `lib/quest.js` | Outlink's game rules: stages of five, next best moves, levels, new doors. |
| `lib/network.js` | Shapes rows into the graph the views consume. |
| `lib/separation.js` | The one merge of 2nd-degree rows into people, with routes, ranks and the summit map's layout. Separation and the Sidebar both read it. |
| `lib/csv.js` | Parses LinkedIn's `Connections.csv` in the browser. Never persisted. |
| `lib/user.js` | Identity/context provider. |
| `lib/demo.js` | The static demo-mode short circuit, inherited from v1. |
| `lib/updater.js` | The Mac app's one-click update, its decisions only (no side effects): which release asset, `SHA256SUMS`, where the running app is and whether it may replace itself, what the Terminal line would do instead, the helper's arguments, what the next start says. The exit code 76 that means "quit quietly, an update follows". |
| `lib/updater-job.js` | The update's work, as one background job the Settings page polls: download, verify, mount, check and stage the new app beside the old one while it runs, then start the helper and end the server. Also the new version's word that it has started, and removing what an interrupted update left. DESKTOP.md D4. |

## Data + scripts

| Path | Role |
|---|---|
| `db/schema.js` | The schema, **as a JS module** — not a `.sql` file. See TRAPS §4. |
| `scripts/scrape.py` | The scanner. The only implementation that has ever actually scanned. Stays Python; the desktop plan ships Python inside the app ([`DESKTOP.md`](DESKTOP.md)). |
| `scripts/image_store.py` | Downloads and re-encodes avatars to permanent local WebP. |
| `scripts/readme_buttons.py` | Draws the README's download buttons (`docs/img/download-*.png`) from HTML in Chrome, with the app icon inside. Rerun after changing `desktop/icon/icon.svg`. |
| `scripts/gen-synthetic.mjs` | The seeded sample network. Every person invented. |
| `scripts/score_new_connections.sql`, `scripts/score-connections.sql` | **Retired** hosted-era scoring, kept for history. The model is `lib/scoring.js`. |
| `scripts/prepare-standalone.mjs` | Copies static assets into `.next/standalone`. See TRAPS §8. |
| `scripts/build-app.mjs` | Builds `Six Degrees.app` and a `.dmg`, as the Electron app (`--shell=electron`) or the classic launcher (`--shell=classic`, the default for now). Both bundle the same Node runtime and server. Ad-hoc signed; unnotarised on purpose (that needs a paid Apple account). Fails if the app *inside the image* doesn't verify (TRAPS §37). |
| `scripts/apply-update.sh` | Ships inside the Mac app. After the app quits for an update, waits for the app's own processes to end (and stops only those, TRAPS §40), swaps the new version in by renames, reopens it, waits for it to say it has started, and puts the old one back if anything fails before that. Tested against pretend apps in `tests/apply-update.test.mjs`. |
| `scripts/test-release-server.mjs` | A pretend GitHub release on 127.0.0.1, for testing the update without GitHub (`SIX_DEGREES_TEST_RELEASES`). Tests, browser checks and CI only; not in the app's logic. |
| `bin/six-degrees.mjs` | The `npx` launcher: Node guard, data dir, port probe from 6363. |
| `bin/args.mjs` | Its command line, testable on its own. `--data-dir` is made absolute (and `~` expanded) here, before the launcher moves into the package's folder. |
| `.github/workflows/npm-package.yml` | Builds the npm package for a tag on Linux, installs it from the tarball and checks that it serves the app. Publishes nothing. Used for the package's **first** publish, which has to be done by hand, because npm's trusted publishing (release.yml) needs the package to exist. |
| `site/` | The download website, https://blakeb056.github.io/six-degrees/ (plain HTML, CSS and JS, no build). `.github/workflows/pages.yml` publishes it with the README's screenshots, 1200px copies of them, and the app icon. Its claims must match the README; it was reviewed against it. |
| `desktop/main.mjs` | The Electron app for the Mac (DESKTOP.md D1): the window, menu and lifecycle around the bundled server. Starts it, keeps links to LinkedIn out of the window, stops a scan cleanly on quit, and starts the server again when it exits with 75 (to finish an import). |
| `desktop/lib.mjs` | Its decisions that don't need Electron (link routing, ports, stopping a scan, `--data-dir`, what a server exit means: TRAPS §39), tested in `tests/desktop.test.mjs` and, for what the updater relies on, `tests/desktop-updater.test.mjs`. |
| `desktop/starting.html`, `desktop/icon/icon.svg` | The "starting" page, and the app icon (a placeholder until Blake picks one). Used by `build-app.mjs` (the `.icns`), `pages.yml` (the website), the README header, and `scripts/readme_buttons.py` (saved into the button pictures, so rerun it after a change). |
| `tests/*.test.mjs` | About 260 tests on `node --test`. No test framework dependency. |

## Data directory

`SIX_DEGREES_HOME`, default `~/.six-degrees`:

```
six-degrees.sqlite        the database (WAL mode)
avatars/                  permanent WebP copies of profile photos
chrome-profile/           the scraper's browser profile — holds a live session
backups/                  auto-before-<version>-*.sqlite (newest five kept) and
                          before-import-<time>.sqlite + -files/ (never pruned)
import-pending/           an import waiting for the next start (READY, data.sqlite, files/)
*.json                    the scanner's progress, skip lists, budget and cooldown
venv/ pushback/           the scanner's Python add-ons; LinkedIn page dumps
```

What an export carries is an allow-list (`lib/data-folder.js`): the database, `avatars/`
and the six scanner files. Never `chrome-profile/`, `venv/`, `backups/`, `pushback/`,
`app-version` or anything temporary.

**`chrome-profile/` grants access to the user's LinkedIn account.** Treat it like a
password. It is the one artifact here worth protecting.
