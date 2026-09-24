# Phases

| Phase | State |
|---|---|
| 0 — Foundation | ✅ Repo, OSS scaffolding, CI on Node 22 + 24, secret/PII guard, lint clean |
| 1 — Standalone | ✅ Supabase → `node:sqlite` via the `lib/db.js` adapter; 12 routes changed one import line each |
| 2 — Security | ✅ Loopback bind, header-proof gate, cross-site write refusal, XSS sinks escaped |
| 3 — Presentation | ✅ Synthetic sample network, empty state, hydration fix, README screenshots |
| 4 — Packaging | ✅ standalone output + `npm run build:app` (a bundled-Node `.app` and `.dmg`). The npm `bin` works from a tarball but **`six-degrees` has never been published to npm** — `npx six-degrees` 404s today. |
| 5 — The scraper | ✅ **Fixed and verified live 2026-09-09** — a full walk completed end to end |
| 6 — Launch | ✅ **Released: v0.1.0 on 2026-09-24**, installable with one line. v0.1.1 fixed the `.dmg` window 0.1.0 shipped without; v0.1.2 fixed the Galaxy rebuilding itself on hover. The checklist below holds what is left. |

## What "verified live" means for phase 5

A cold start from a logged-out profile: sign-in detected automatically, full walk of the
connections list, rows pushed through the API, scored, avatars captured, network rendered.
Not a unit test — the real thing, watched.

## Phase 6 — launch checklist

The one list of what stands between this repo and a public launch. Keep it current:
tick an item in the same change that finishes it.

### Done — released in 0.1.0 (merged as PR #1, 2026-09-24)

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
- [x] 0.1.2 — hovering a Galaxy dot no longer rebuilds the scene in a loop (TRAPS §29).
      Verified in the installed app: a still hover went from ~250 rebuilds in 3 s to none
- [x] 0.1.3 — the Mac app runs natively on Apple Silicon, so scanning works from it
      (TRAPS §30). Verified: launcher and server not translated, a Check for new ran clean
- [x] 0.1.4 — 2nd-degree scans read past page 1 again: a JavaScript snippet in a plain
      Python string was a syntax error (TRAPS §31). Every snippet is now parsed in CI

### Needs the maintainer

- [x] Review and merge `onboarding-install` — PR #1, merged 2026-09-24
- [x] Tag `v0.1.0` straight after merging — released 2026-09-24. The release workflow went
      green on its first run, and published both `.dmg` files and `SHA256SUMS`
- [x] Run the real one-liner on a Mac — 2026-09-24, Apple Silicon: found the release,
      SHA-256 verified, installed, opened with no Gatekeeper prompt, and its Updates panel
      reported "the newest version"
- [x] Company scans — shipped labelled **experimental** (Paths page asks before the first
      one; SCRAPING.md says so). Still never run live; 2nd-degree mapping has, since 09-09
- [ ] Optional: an npm account and an `NPM_TOKEN` repository secret, which turns on
      `npx six-degrees@latest`. The name was still free on 2026-09-23

### Not verified yet

- [x] The release workflow on GitHub's runners — it ran, and it showed the `.dmg` window
      step had been failing: 0.1.0 shipped a plain window. Fixed in 0.1.1 (TRAPS §28);
      the fix was proven with a dry run of the workflow before tagging. 0.1.1's first
      Intel build then hit an eject race ("Resource busy") and passed on a re-run; the
      build now retries the eject, proven by another dry run
- [x] The Updates panel's "Version X is available" state, and updating over a running
      copy — 2026-09-24: an installed 0.1.0 offered 0.1.1; the one-liner stopped it,
      installed 0.1.1 on the same port with no stray server, and 0.1.1 reports itself newest
- [ ] The Intel `.dmg`: built and published, never opened on an Intel Mac
- [ ] The progress bar during a real scan (seen against a stand-in scanner that prints
      the same lines)

### Later

- [ ] Port the scraper to Node `playwright-core`, which removes Python from the
      requirements
- [ ] An app icon: the app and its `.dmg` use the generic one
- [ ] A one-click update from inside the Mac app, instead of a line to paste
- [ ] Opening the sidebar resizes the Galaxy and rebuilds it once (its layout restarts).
      Re-centring the existing scene on a resize, instead of rebuilding it, would make
      that smooth too
- [ ] Next.js deprecation warnings in the build: `middleware` → `proxy`, and `viewport`
      moved out of `metadata`
- [ ] GitHub Actions warns that `checkout`, `setup-node` and the artifact actions at v4
      run on deprecated Node 20. Current majors are v7/v8 — upgrade deliberately, one at
      a time, not in passing
- [ ] A local build's "uncommitted files" warning lists untracked files only; a modified
      tracked file ships silently. Releases build from a clean checkout, so this only
      matters for a hand-made build
