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
   opens it.
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
Contents/Resources/server/      the same standalone server (+ scanner files, apply-update.sh)
Contents/Resources/python/      from D2
```

(The classic app keeps the server in `Contents/Resources/app/` and its executable is a
bash script, `Contents/MacOS/six-degrees`.)

- [x] Main process (`desktop/main.mjs`): start `server.js` on the bundled Node with the
      same settings as the old launcher (127.0.0.1, ports walked up from 6363,
      `SIX_DEGREES_INSTALL=mac-app`, telemetry off), show a "starting" page, and swap in the
      app once it answers. `--data-dir PATH` runs it against a copy of the data.
- [x] Quitting stops a running scan the way the Stop button does, so the scanner closes its
      Chrome itself, and only then the server. It asks first only if you're looking at it
      (TRAPS §38). Checked: quit mid-job with another app in front, and job, server and app
      were gone in about 2 seconds.
- [x] One copy at a time: opening it again brings the window forward (checked).
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
      `install.sh`'s logic inside the app, with a rollback `install.sh` doesn't have.
      Built on the draft branch `settings-updater` (2026-09-25); not released.
  - [x] The spec allows it: invariant 2 now permits a second, separate press
        ("Install and restart") to download and install the release. **Blake approves
        this before it merges.**
  - [x] Settings → Updates: *Install and restart* after a check finds a newer version,
        progress (download %, checking, preparing), "Restarting…", and on the next start
        how it went (nothing, once this copy has reached that version another way). When
        the app can't update itself it says why, and offers the Terminal line only where
        the line does what the page says (`lib/updater.js` `terminalFallback`): in
        Applications it replaces the app; anywhere else (the disk image, a translocated
        copy, `~/Applications` when `/Applications` isn't writable) `install.sh` installs a
        second copy and leaves this one running, so the page says to quit first and where
        the new copy will be; never for a network kept inside the app (`install.sh` deletes
        the app, and the network with it) or another user's app. Hidden in test mode. Mac
        app only: an npm or source copy runs inside its own terminal, so it can't replace
        itself.
  - [x] The work, while the old version keeps running (`lib/updater-job.js`, decisions
        in `lib/updater.js`): `releases/latest` again, and only the version the check
        offered (the server remembers it; a newer one since asks for a new check; never a
        pre-release, never a version from the page), this chip's `.dmg` by its exact name
        (the chip from `sysctl hw.optional.arm64`, TRAPS §30), `SHA256SUMS` required
        (unlike `install.sh`), free space, `hdiutil attach -nobrowse -readonly`,
        `codesign --verify --deep --strict`, bundle id, version and macOS minimum from
        `Info.plist`, the chip from the executable's Mach-O header (not `lipo`, the
        developer-tools stub), no link pointing outside the app (TRAPS §37). Then `ditto`
        into `.Six Degrees.app.incoming` beside the running app (same disk, so the swap is
        a rename; not named `.app`, so macOS doesn't see a second app), checked again.
        Refused when another user of the Mac has the app open (asked before the download
        and again before the hand-over): they can't be stopped, and it mustn't be swapped
        from under them.
  - [x] The hand-over (TRAPS §39): the helper starts detached, from a copy outside the
        app, with a clean environment and a UTF-8 locale (TRAPS §40); the server ends with
        exit code 76, which the app reads as "quit quietly". Refused while a scan runs.
  - [x] The helper, `scripts/apply-update.sh` (shipped inside the app): waits for the
        processes the server named and every process whose *executable* is inside the app,
        and stops only those, never a Terminal or editor that merely sits in its folder
        (TRAPS §40); if they won't go, nothing changes and the app reopens. Renames the old
        app aside to a name nothing has (never deletes first), renames the new one in
        (`ditto` if it can't), clears quarantine, and opens it with `--after-update` and
        `--data-dir` (always: the folder the old one used, however it was chosen). Then it
        waits for the new version to say it has started: its server writes
        `update-confirmed.json` on the first page. If the new version can't be put in
        place, won't open, or closes before saying so (it crashed, or its server couldn't
        start and the error was dismissed), it is moved out of the way, the old app put
        back and reopened, and only then is the new one removed. If it runs for 10 minutes
        without saying so, it is left running. The outcome goes to
        `~/Library/Caches/Six Degrees/last-update.json`, its log to
        `$TMPDIR/six-degrees-update.log`. Handles the classic layout too (it moves whole
        bundles). Not covered: a new version that starts and goes wrong later; the kept
        zip is the way back.
  - [x] The previous version is kept, **zipped**, in `~/Library/Caches/Six Degrees`
        (one copy, replaced by the next update), once the new version has started. Not as
        an app: a second `Six Degrees.app` there could turn up in Spotlight and be opened
        by mistake, and a Finder alias or Dock icon may follow the moved folder instead of
        the path (not seen, but deleting the old folder is what `install.sh` does and has
        always worked). Unzip it and drag it to Applications to go back.
  - [x] Leftovers of an update cut off half-way (the aside and failed folders once their
        helper has ended, a stale staged copy, half-made zips, a download folder, its
        image unmounted first) are removed at the next check or install. Only this app's
        own names, and never the previous version a failed update couldn't put back.
  - [x] Tests: the decisions (`tests/updater.test.mjs`), the helper against pretend apps
        with real processes of their own (`tests/apply-update.test.mjs`, run with the
        server's exact environment), and the whole job against a pretend release on
        127.0.0.1 with real disk images (`tests/updater-job.test.mjs`,
        `scripts/test-release-server.mjs`). `SIX_DEGREES_TEST_RELEASES` points the app at
        such a server; it is honoured only for a 127.0.0.1 address, and the app never
        sets it.
  - [ ] **Blake, on a real Mac**: the morning test below. It can't be run without quitting
        a real copy, because only one copy of the app runs at a time.
  - [ ] Before release: whether macOS's App Management asks or refuses when the app being
        replaced was first installed from a browser-downloaded, quarantined `.dmg` (then
        allowed with Open Anyway). That needs a copy installed that way, on macOS 13, 14,
        15 and 26 if possible, and a plan of its own for which copy and data to use. If it
        refuses, the update ends like step 5 below ("Nothing was changed") and the
        Terminal line still works.
  - [ ] CI (rule 6, extended): after the smoke test, install the previous release (N-1,
        once it has this button) from its `.dmg`, serve the `.dmg` just built with
        `scripts/test-release-server.mjs`, start N-1 with `SIX_DEGREES_TEST_RELEASES`
        pointing at it, `POST /api/update {action:'check-release'}` then
        `{action:'install-release'}`, wait for `last-update.json` to say `installed`, then
        check the installed app is version N, verifies with `codesign`, answers, and that
        nothing of N-1 is left running.

#### The morning test

**Quit your real Six Degrees first. Nothing below touches it or `~/.six-degrees`.** Every
copy below is a test copy in `~/Six-Degrees-Update-Test`, started, and reopened by the
updater, with `--data-dir` set to a test folder, and the "release" comes from a server on
127.0.0.1. Quitting first matters because one copy runs at a time: a test copy started
while yours runs only brings yours forward. (Like any copy of the app, the test copies
share the window settings and page storage in `~/Library/Application Support/Six Degrees`.
Your network isn't kept there, and your copy puts its own profile back when it opens.)

Three rules for the whole test:
- Open a test copy only with the commands below, **never from the Dock, Finder or
  Spotlight**: opened that way it has no `--data-dir` and would open `~/.six-degrees`.
  (The old "click the Dock icon" check is gone for that reason. It isn't needed: the old
  folder is deleted once the new version has started, so an alias can only find the app
  by its path, as after `install.sh`.)
- Click *Check for updates* and *Install and restart* only in a copy whose Updates section
  says "Test mode" at the bottom. A copy the updater reopened isn't in test mode (`open`
  passes no environment) and would ask the real GitHub.
- Never paste a Terminal line from a test copy. It would install the real release into
  Applications, over your copy. (Test mode doesn't show it.)

1. Build the old version and the new one, from this branch:
   ```
   cd /Users/blakeo/dev/sd-wt-updater
   mkdir -p ~/Six-Degrees-Update-Test/release ~/Six-Degrees-Update-Test/data
   SIX_DEGREES_HOME=~/Six-Degrees-Update-Test/data npm run build:desktop
   ditto "dist/Six Degrees.app" ~/Six-Degrees-Update-Test/old.app
   npm pkg set version=0.2.2
   SIX_DEGREES_HOME=~/Six-Degrees-Update-Test/data npm run build:desktop
   cp dist/Six-Degrees-0.2.2-*.dmg ~/Six-Degrees-Update-Test/release/
   ```
   (A build never opens a data folder; `SIX_DEGREES_HOME` there is a second lock.)
2. The pretend release, in a Terminal window of its own, left running:
   `node scripts/test-release-server.mjs --dir ~/Six-Degrees-Update-Test/release --port 3303`
3. A fresh old copy, in another Terminal window:
   ```
   cd ~/Six-Degrees-Update-Test && rm -rf "Six Degrees.app" && ditto old.app "Six Degrees.app"
   SIX_DEGREES_TEST_RELEASES=http://127.0.0.1:3303 "Six Degrees.app/Contents/MacOS/Six Degrees" --data-dir ~/Six-Degrees-Update-Test/data
   ```
   Settings → Updates says "Test mode" at the bottom, and About shows the test data folder.
4. **The update.** Check for updates → "Version 0.2.2 is available" → Install and restart.
   Expect: progress; the window closes; within a few seconds 0.2.2 opens by itself on
   Settings, saying "Updated to 0.2.2", with About showing `~/Six-Degrees-Update-Test/data`.
   Then: `cat ~/Library/Caches/Six\ Degrees/last-update.json` says `installed` and names
   `Six Degrees 0.2.1.zip` in that folder; `cat "$TMPDIR/six-degrees-update.log"` has
   "The new version has started." and ends "Outcome: installed";
   `ls -A ~/Six-Degrees-Update-Test` shows no `.Six Degrees.app.…` folder; and
   `ps -axo pid,command | grep -F Six-Degrees-Update-Test` shows only the new copy (and
   the grep). Quit it (Six Degrees → Quit).
5. **A refusal: nothing changes.** Repeat step 3, then, before clicking anything,
   `chflags uchg ~/Six-Degrees-Update-Test/"Six Degrees.app"`. Check for updates →
   Install and restart. Expect: the window closes, and the same old version reopens on
   Settings: "The update to 0.2.2 didn't finish: macOS didn't let Six Degrees move its old
   version aside (…). Nothing was changed." Quit it, then
   `chflags nouchg ~/Six-Degrees-Update-Test/"Six Degrees.app"`.
6. **A rollback** (one more build, about as long as step 1's): a new version whose server
   can't start.
   ```
   cd /Users/blakeo/dev/sd-wt-updater
   sed -i '' "s/'server.js'/'no-such-server.js'/" desktop/main.mjs
   npm pkg set version=0.2.3
   SIX_DEGREES_HOME=~/Six-Degrees-Update-Test/data npm run build:desktop
   rm ~/Six-Degrees-Update-Test/release/*.dmg && cp dist/Six-Degrees-0.2.3-*.dmg ~/Six-Degrees-Update-Test/release/
   ```
   Stop step 2's server (Ctrl-C) and start it again. Repeat step 3, then Check for updates
   → 0.2.3 → Install and restart. Expect: the window closes, 0.2.3 opens and says it
   stopped or couldn't start; click OK; within a few seconds 0.2.1 reopens on Settings:
   "The update to 0.2.3 didn't finish: the new version closed before it finished starting.
   Your previous version was put back." Quit it.
7. Clean up: stop step 2's server (Ctrl-C), then
   ```
   rm -rf ~/Six-Degrees-Update-Test "$HOME/Library/Caches/Six Degrees"
   cd /Users/blakeo/dev/sd-wt-updater && git checkout package.json desktop/main.mjs
   ```
   (`~/Library/Caches/Six Degrees` holds only the updater's files: it didn't exist before
   this, and 0.2.1 doesn't use it.) Then open your real Six Degrees from Applications, as
   usual.

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
| D4 Signing | when Blake decides to pay; one-click updates without signing are built on a draft branch, waiting on the spec approval and a real-Mac test |
| D5 Scanner in JS | optional; spec still rejects it |
