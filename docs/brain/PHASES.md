# Phases

| Phase | State |
|---|---|
| 0 — Foundation | ✅ Repo, OSS scaffolding, CI on Node 22 + 24, secret/PII guard, lint clean |
| 1 — Standalone | ✅ Supabase → `node:sqlite` via the `lib/db.js` adapter; 12 routes changed one import line each |
| 2 — Security | ✅ Loopback bind, header-proof gate, cross-site write refusal, XSS sinks escaped |
| 3 — Presentation | ✅ Synthetic sample network, empty state, hydration fix, README screenshots |
| 4 — Packaging | ✅ standalone output + `npm run build:app` (a bundled-Node `.app` and `.dmg`). The npm `bin` works from a tarball but **`six-degrees` has never been published to npm** — `npx six-degrees` 404s today. |
| 5 — The scraper | ✅ **Fixed and verified live 2026-09-09** — a full walk completed end to end |
| 6 — Publish | ⬜ Repo is public; `npm publish` not yet run |

## What "verified live" means for phase 5

A cold start from a logged-out profile: sign-in detected automatically, full walk of the
connections list, rows pushed through the API, scored, avatars captured, network rendered.
Not a unit test — the real thing, watched.

## Next

**Bridge (2nd-degree) and company scans.** They still carry the two bugs that broke the
main scrape (TRAPS §5, §6) and have not been run since. Watch one live before trusting
it — a bridge scrape reads a stranger's connection list, so it earns more care than the
main path, not less.

Only after that is `npm publish` worth running. The npm name `six-degrees` was free as
of the last check.
