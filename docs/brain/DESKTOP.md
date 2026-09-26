# The desktop app

The plan for turning Six Degrees into an app people download and open. No Terminal, no
Python, no setup step before a scan. Adopted 2026-09-24. **D1 shipped: the Electron app is the
main download from 0.2.0.** Next: D2.

Tick items in the same change that finishes them, and keep the status table at the bottom
current. When this note and the spec disagree, the spec wins; fix this note.

## Why

The one-line install gets the app onto a Mac, but scanning still needs Python, and a
normal person doesn't have it. Windows has no install at all. The goal: **download, open,
scan** on a Mac, then on Windows. The one-line install stays as a second way in.

## What must not change

These rules protect the version that works today (0.1.x). A change that breaks one is
wrong, however good it looks.

1. **The scanner is not rewritten here.** `scripts/scrape.py` ships as it is: same pages,
   same pacing, same budget (50 searches a day, 250 a month), same cooldown lock, same
   stop at the first push-back, same progress and Paused files. D2 changes only *where
   Python comes from*. A JavaScript port is a separate, optional project with its own
   gates (D5), and the spec still rejects it.
2. **The shell doesn't touch the server.** Electron is only the window and the app's
   lifecycle. The app still runs `server.js` on the **same bundled Node binary** as
   today, not on Electron's own Node. So `node:sqlite`, every route, the scoring and the
   data folder behave exactly as in 0.1.x.
3. **The user's data is untouchable.** It stays in `~/.six-degrees`
   (`%USERPROFILE%\.six-degrees` on Windows). From D0 on, the first launch of a new
   version copies the database into `backups/` (keeping the last five) before anything
   opens it. The one thing that replaces it is an import the user asks for (Settings →
   Your data): checked first, applied only at the next start, and only after what was
   there is kept in `backups/before-import-*`, which nothing ever prunes. The app never
   moves the folder itself: a live SQLite database in a synced folder can tear, and
   `chrome-profile/` lives inside it.
4. **Nothing becomes "latest" until it is proven.** Each desktop phase ships first as a
   GitHub **pre-release** (`v0.2.0-beta.1`). `install.sh`, `install.ps1` and the Updates
   panel follow only `releases/latest`, which skips pre-releases, so no user gets a beta
   by accident. Blake installs one on purpose, into its own folder so the normal copy
   stays:
   `curl -fsSL …/install.sh | SIX_DEGREES_VERSION=0.2.0-beta.1 SIX_DEGREES_DEST=~/Applications/Six-Degrees-Beta bash`.
   (The settings go *after* the pipe: before it, they reach `curl`, not the installer.)
   It is tried against
   a copy of the data first (`SIX_DEGREES_HOME=<copy>`), then promoted to a full release.
5. **The current build stays buildable.** `scripts/build-app.mjs` (bash launcher + Chrome
   `--app` window) is kept until the Electron app has been the released default for one
   full release. Rolling back is re-tagging.
6. **CI proves every artifact starts.** On GitHub's machines it opens the built app,
   reaches its server, quits it, and checks that nothing is left running: no server, no
   scanner, no Chrome.
7. **LinkedIn never opens inside the app window.** Every LinkedIn link goes to the user's
   own browser, and scanning still drives the user's own Chrome. LinkedIn loaded in
   Electron's built-in Chromium would be a second, signed-out browser and one more thing
   LinkedIn can notice.
8. **Say "scanner" and "scanning"** in anything a user reads. The file names (`scrape.py`,
   `/api/scraper`) are legacy. Rename them only when that code is rewritten anyway, not as
   churn.

## Phases

### D0 — Groundwork (ships in a normal 0.1.x)

- [x] "Scraper" → "scanner" in every user-facing string: Scan page steps, errors,
      `docs/SCRAPING.md`, SECURITY.md and the README. Code names stay. Still says "scrape" in
      its own live-log lines: `scripts/scrape.py`, which rule 1 keeps unedited.
- [x] Back up the database on the first launch of each new version (rule 3). Every later
      phase depends on it. `backupOnNewVersion()` in `lib/db-client.js`: `VACUUM INTO`
      `backups/auto-before-<version>-<time>.sqlite` before the schema step, keeping the
      last five and never touching hand-made copies. Checked on a copy of real data (3,877
      people copied)
- [ ] A real app icon: 1024px artwork → `.icns` for the Mac and `.ico` for Windows. Today
      there is none on the Mac, and the favicon is **Next.js's default Vercel triangle**
      (Vercel's mark, not ours). The Electron build uses a placeholder
      (`desktop/icon/icon.svg`: you at the centre, your circles in the tier colours) until
      Blake picks one. The icon is used in four places: the Mac app (`build-app.mjs`), the
      website (`pages.yml`), the README's header, and saved inside the README's download
      buttons. For that last one, run `python3 scripts/readme_buttons.py` and commit
      `docs/img/download-*.png`.
- [x] Mark tags with a hyphen (`v0.2.0-beta.1`) as pre-releases in `release.yml`, with
      install-to-a-separate-folder notes; npm gets them under `next`, never `latest`

### D1 — Electron app for the Mac (Blake's priority: he uses a Mac)

The layout inside `Six Degrees.app`:

```
Contents/MacOS/Six Degrees      Electron: the window, the menu, the lifecycle
Contents/Resources/node         the same Node binary 0.1.x bundles
Contents/Resources/app/         the same standalone server (+ scanner files)
Contents/Resources/python/      from D2
```

- [x] Main process (`desktop/main.mjs`): start `server.js` on the bundled Node with the
      same settings as the old launcher (127.0.0.1, ports walked up from 6363,
      `SIX_DEGREES_INSTALL=mac-app`, telemetry off), show a "starting" page, and swap in the
      app once it answers. `--data-dir PATH` runs it against a copy of the data.
- [x] Quitting stops a running scan the way the Stop button does, so the scanner closes its
      Chrome itself, and only then the server. It asks first only if you're looking at it
      (TRAPS §38). Checked: quit mid-job with another app in front, and job, server and app
      were gone in about 2 seconds.
- [x] One copy at a time: opening it again brings the window forward (checked).
- [x] `--data-dir` is made absolute where it is parsed (`dataDirArg`): against the folder
      the app was started in, or the home folder when that is `/` (as with `open` and the
      Finder), with `~` expanded. Handed over as typed, a relative path named a folder
      inside the app, where the server runs, and so a new, empty network.
- [ ] Restart to finish an import (Settings → Your data): the server exits with 75
      (`SIX_DEGREES_RESTART_CODE`, which only this shell sets; Next's own exit on SIGTERM
      is 143, so a signal can't pass for it). The shell shows the starting page, starts the
      server again on the same port if it's free, and returns to Settings → Your data. A
      server that asks to be restarted before it has ever answered is reported as a crash
      (it can't stay up); one that answered is restarted however soon after the last, so
      clicking Restart now again after an import that stopped is never "Six Degrees
      stopped". 76 (the in-app updater's hand-off), 143 and 130 (Next stopped from outside)
      and a signal quit quietly; any other code is a crash. The decision is
      `serverExitAction` (tested, every code); the server's side was checked with the
      standalone build. **Tick once it has been clicked through in the real app**, then
      check the Save dialog for *Save a copy* (there is no `will-download` handler, so
      Electron asks where to save).
- [x] Links: anything not on the app's own address opens in the default browser (rule 7);
      the app's own pop-ups get a window under the same rules. `routeFor()` is tested.
- [x] Safe defaults: context isolation on, Node integration off, sandbox on, no webviews,
      and only clipboard-write and full-screen permissions.
- [x] A native menu: About, Check for Updates… (opens Settings → Updates and runs the check), Settings… (⌘,), Edit,
      View, Window, and Help (GitHub, what changed, the data folder, the log).
- [x] Packaging: `@electron/packager` (Electron 44.4.5) per chip, then the existing `.dmg`
      step, filled with `ditto` (TRAPS §37), with the app inside the image checked on every
      build. Same app name and bundle id. **Needs macOS 13 or later** (Electron 44), where
      the classic app ran on 11.
- [x] `install.sh` stops a running Electron copy and replaces it (checked: nothing left
      running, and the installed copy's signature verifies).
- [x] CI (rule 6): installs from the image, opens, reaches every page, refuses a second
      copy, quits mid-job, and checks nothing is left. It uploads a picture of the window.
- [x] Shipped as `v0.2.0-beta.1`, then **promoted in 0.2.0** at Blake's call ("the Electron
      app at the top of the README"). He hadn't clicked through the beta himself yet;
      CI and the checks above had. The classic launcher stays buildable
      (`release.yml` input `shell: classic`) through the next full release (rule 5). **To promote:** Blake has used it on his real data for a
      few days, and a scan (once LinkedIn allows) started and stopped from it leaves no
      Chrome behind.

What it changes for people: a real app with its own Dock icon, window and Quit. It no
longer needs Chrome or Edge just to show a window. TRAPS §30 (Rosetta) goes away, because
the app's executable is a real arm64/x64 binary instead of a script. The download grows
from about 54 MB to about 180 MB.

### D2 — Python inside the app (removes the install step)

- [ ] At build time, per chip: a standalone CPython 3.12 (`python-build-standalone`)
      with `scripts/requirements.txt` already installed (Playwright with its own driver,
      Pillow, requests). No `playwright install` is needed, because the scanner uses
      the installed Chrome (`channel="chrome"`).
- [ ] `/api/scraper` uses the bundled Python first, pointed to by an environment variable
      the shell sets. The "Installing the scanner's packages" step is then skipped. The
      private-environment path stays as the fallback for npm and command-line installs.
- [ ] `scrape.py` is not edited. Its pure functions are run under the bundled Python in
      CI, the same checks that run today (`tests/linkedin-limits.test.mjs`).
- [ ] Every binary inside (Python, its libraries, Playwright's driver) gets the same ad-hoc
      signature as the rest of the app, and real signing in D4.

Scanning still needs **Google Chrome**. That's deliberate: the scanner drives the user's
real browser, and the Scan page already checks for it. The download grows by about 70 MB,
to about 250 MB.

### D3 — Windows

- [ ] Electron's Windows build: a one-click `Setup.exe` that installs for the current
      user, adds Start Menu and Desktop shortcuts, and opens the app. Plus Python for
      Windows (with `tzdata`: Windows Python has no time zone database). This replaces the
      PowerShell installer parked on branch `windows` (below).
- [ ] Merge the app-level Windows fixes from that branch: the `py` launcher found first,
      a real Chrome check, Stop closing the scanner's Chrome via `taskkill /T`, no console
      windows, `scripts/next.mjs` in place of shell-only `VAR=x` scripts, and tests that
      pass on Windows.
- [ ] Windows CI: install silently, start, reach, update over a running copy, stop. The
      same checks the parked branch runs.
- [ ] One test on a real Windows PC before release.
- [ ] Decide: when Chrome is missing on Windows, fall back to Edge for scanning (always
      installed there)? That's a small behaviour change, so it needs a watched run first.

### D4 — Signing (when Blake decides to pay)

- [ ] Apple Developer ID ($99/year): sign and notarize every binary. The `.dmg` then opens
      with no warning, the standard Electron updater works, and Homebrew's official
      catalog becomes possible.
- [ ] Windows: Microsoft's Trusted Signing (about $10/month), so there is no SmartScreen
      warning.
- [ ] Until then, **one-click updates without signing:** the app downloads the new build,
      checks its SHA-256 against `SHA256SUMS`, swaps itself and relaunches. This is
      `install.sh`'s logic inside the app. It works unsigned because files an app
      downloads itself are not quarantined.

### D5 — Optional: the scanner in JavaScript

**Not needed for any goal above:** D2 already removes the Python install. What it would
still buy: about 60 MB less download and one language instead of two. The spec keeps
rejecting it, for reasons that still hold. If it is ever attempted, it must answer each
reason first:

- [ ] **"No test coverage."** Characterisation tests for the Python scanner, run on saved
      LinkedIn pages. Real captures stay on the machine and are never committed (spec
      invariant: no real network data in the repo). The repo gets synthetic pages.
- [ ] **"The only implementation that has ever actually scanned."** Port piece by piece
      behind `SIX_DEGREES_SCANNER=js`, with Python the default. Both must give identical
      output on the same pages. The in-page JavaScript (381 lines) moves verbatim.
- [ ] **"A rewrite drops fields silently"** (TRAPS §33) **and v2 lost features.** Every
      mode in `SCRAPER.md`'s table is a checkbox. None may be missing at the switch.
- [ ] **Shared state:** the same budget, cooldown, progress and skip files. Never separate
      counters: switching scanners must not reset LinkedIn limits.
- [ ] **"A live dependency."** The first live run is small, watched, and never during a
      cooldown. Python stays switchable for one release after the default flips.

## Considered and set aside

| Idea | Why not (for now) |
|---|---|
| Tauri instead of Electron | About 10 MB instead of about 125 MB, but on a Mac it renders with Safari's engine. The UI is built and tested in Chrome's engine, which Electron keeps. |
| Homebrew cask / winget | Good *second* channels, after D4. Homebrew's main catalog needs signed apps. A personal tap works, but brew quarantines what it downloads, which brings the first-launch warning back. |
| apt and Linux packages | Linux runs from source today (README). `npx six-degrees` would cover it once the npm package is published: the name is unclaimed, so claim it first. |
| A cloud version | The scanner has to be the user's own browser on the user's own connection. Hosting everyone's network also makes the operator responsible for other people's data. |
| PowerShell one-liner for Windows | Built, and passing CI on branch `windows` (2026-09-24). Parked, not released: D3 replaces it unless Windows is wanted before Electron. |

## Status

| Phase | State |
|---|---|
| D0 Groundwork | backups ✅ pre-releases ✅ "scanner" wording ✅; the icon still to do |
| D1 Electron, Mac | ✅ **shipped in 0.2.0** (beta first, promoted the same day) |
| D2 Python inside | after D1 (recommended over D5; Blake to confirm) |
| D3 Windows | after D2; the PowerShell installer is parked on branch `windows` |
| D4 Signing | when Blake decides to pay |
| D5 Scanner in JS | optional; spec still rejects it |
