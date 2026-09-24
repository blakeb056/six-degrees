# Phases

| Phase | State |
|---|---|
| 0 — Foundation | ✅ Repo, OSS scaffolding, CI on Node 22 + 24, secret/PII guard, lint clean |
| 1 — Standalone | ✅ Supabase → `node:sqlite` via the `lib/db.js` adapter; 12 routes changed one import line each |
| 2 — Security | ✅ Loopback bind, header-proof gate, cross-site write refusal, XSS sinks escaped |
| 3 — Presentation | ✅ Synthetic sample network, empty state, hydration fix, README screenshots |
| 4 — Packaging | ✅ standalone output + `npm run build:app` (a bundled-Node `.app` and `.dmg`). The npm `bin` works from a tarball but **`six-degrees` has never been published to npm** — `npx six-degrees` 404s today. |
| 5 — The scraper | ✅ **Fixed and verified live 2026-09-09** — a full walk completed end to end |
| 6 — Launch | 🟨 The install path is built and verified locally (branch `onboarding-install`); nothing is released yet. **The checklist below is the list.** |

## What "verified live" means for phase 5

A cold start from a logged-out profile: sign-in detected automatically, full walk of the
connections list, rows pushed through the API, scored, avatars captured, network rendered.
Not a unit test — the real thing, watched.

## Phase 6 — launch checklist

The one list of what stands between this repo and a public launch. Keep it current:
tick an item in the same change that finishes it.

### Built and verified locally (branch `onboarding-install`, not merged)

- [x] One-line Mac install, `install.sh`: newest release for the Mac's chip, SHA-256
      checked, installed and opened; running it again updates, stopping a running copy
      first (TRAPS §26)
- [x] Release workflow: a `v*` tag builds the arm64 and x64 `.dmg`s on GitHub's Macs
      and publishes them with `SHA256SUMS`; npm publish runs once `NPM_TOKEN` exists
- [x] Welcome screen (scan, CSV, sample) and no name prompt — the server picks the
      profile that owns the network (TRAPS §25)
- [x] Scan page: steps tick themselves off, a progress bar, counts by degree, and a
      failed run shows its reason
- [x] Updates panel for installed copies: a click-only check of the newest release
      (spec invariant 2)
- [x] The `.dmg` window: drag-to-install picture, the one-time Open Anyway step, and an
      Applications drop target that shows its icon (TRAPS §28)
- [x] README leads with installing; running from source is in CONTRIBUTING;
      `Start 6 Degrees.command` removed
- [x] Packaging: no `.git` or logs traced into the bundle, and a local build lists any
      uncommitted files it is about to ship (TRAPS §27)
- [x] `npm pack` run through `npx` from the tarball: starts, every route answers,
      the scraper's files are found from npm's cache

### Needs the maintainer

- [ ] Review and merge `onboarding-install`
- [ ] Tag `v0.1.0` straight after merging. The README's install line points at a release,
      so it fails for visitors until the first one exists. This is also the first run of
      the release workflow — watch it
- [ ] Run the real one-liner on a Mac once the release is up
- [ ] Decide on company scans: ship as they are, or label them experimental. They have
      never been run live. (2nd-degree mapping has, since 2026-09-09.)
- [ ] Optional: an npm account and an `NPM_TOKEN` repository secret, which turns on
      `npx six-degrees@latest`. The name was still free on 2026-09-23

### Not verified yet

- [ ] The release workflow on GitHub's runners, including the Finder step that lays out
      the `.dmg` window (it has only ever run on a desktop Mac)
- [ ] The Updates panel's "Version X is available" state, which needs a second release
- [ ] The progress bar during a real scan (seen against a stand-in scanner that prints
      the same lines)

### Later

- [ ] Port the scraper to Node `playwright-core`, which removes Python from the
      requirements
- [ ] An app icon: the app and its `.dmg` use the generic one
- [ ] A one-click update from inside the Mac app, instead of a line to paste
- [ ] Next.js deprecation warnings in the build: `middleware` → `proxy`, and `viewport`
      moved out of `metadata`
