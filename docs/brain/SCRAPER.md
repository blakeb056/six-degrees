# The scraper

> The scanner now ships only as plugins (`auto-scan`, `manual-scan`, built by `scripts/build-plugin.mjs`); no download carries `scrape.py` or `image_store.py` (`lib/scanner-files.js` SCANNER_CODE). The source and its tests stay here.

`scripts/scrape.py`, the scanner: Python + Playwright, driving the user's **real
installed Chrome** through a persistent profile. It is the only implementation that has
ever actually scanned, so treat it as load-bearing, not as a candidate for a rewrite. See
the rejected-by-design table in the spec. The desktop app keeps it as it is and ships
Python *inside* the app instead ([`DESKTOP.md`](DESKTOP.md) D2). A port is D5 there,
optional and gated. (User-facing text says "scanner"; the file names are legacy.)

**Read [`TRAPS.md`](TRAPS.md) §5–7 and §12–13 before changing anything here.**

## Modes

| Command | Does |
|---|---|
| `--full` | Walks the whole connections list top to bottom. ~90s for 750 people. |
| `--refresh` | Stops after 20 people already on file. Seconds. |
| *(bare)* | `--full` on an empty database, `--refresh` otherwise. |
| `--login` | Signs in, confirms the session saved, exits. |
| `--search` | Legacy: collects via the people-search pages instead. |
| `--your-connections` | Your connections through LinkedIn's people search (`network=["F"]`, where *Search with filters* on the connections page leads), read like a circle: by itself, or by hand in manual mode. Adds where each person is and the mutuals you share. See *Your connections through the search* below. |
| `--bridge "Name"` / `--rescrape "Name"` | 2nd-degree circle behind one person. |
| `--bridge-url URL` | The same, for the person with that profile URL: two connections can share a name, and by name the first one saved is read. Carries on where their last read stopped (Resume); with `--from-start`, from page 1 (every Scan button in the app). |
| `--company "Name"` | Everyone visible at one company. |
| `--connect URL` | **Auto**: one connection request, without a note, to the person at that profile URL (`--connect-name` gives their name; otherwise it's looked up in the app). Prints `Connect result: <name>` last. See *Auto* below. |
| `--auto-bridge` | Map every bridge in turn, highest tier first. Hidden profiles are recorded and skipped on later runs. |
| `--retry-private` | With `--auto-bridge`: try the people previously found to be hidden. |
| `--clear-skips` | Forget every hidden-profile skip. |
| `--save-photos` | Saves the photos older versions kept as links (`GET /api/update-images`), once each: the file's path if it saved, and a definite no (expired, not LinkedIn's, not a picture, someone else's) forgets the link. No connection, a timeout, a 429 or 5xx keeps it (`TryLater`); three in a row, or nothing but those, end the run with the reason and exit 1. No browser, no search. Every scan that finishes does the same at its end (`save_waiting_photos`); the Scan page's *Save photos* runs this. |
| `--server` | **Legacy.** A standalone HTTP server on port 5555. The app no longer uses it — `/api/scraper` spawns the scraper directly. Kept for anyone driving it from outside. |
| `--show-window` | A normal Chrome window in front, to watch it work (the Scan page's *Show the scanner's Chrome window*). Without it the window stays out of sight; see *The window* below. |
| `--read-profiles=N` | **Read profiles**: up to N (at most 25) of your connections' profiles, highest power first, for their roles. See *Read profiles* below. |
| `--headless` | Command line only: works on every mode once signed in, but headless Chrome is **more** detectable, not less, and a check LinkedIn asks for can't be seen. |

## Your connections through the search (2026-10-15)

> "our actual connection list doesn't supply locations in the regular view … if I click in the
> top right that says search with filters it will show all my connections like if I was scanning
> someone's profile and gives more data like location" (Blake, 2026-10-15)

`--your-connections` (`scan_your_connections`; the Scan page's *Add locations and mutuals*,
action `your-connections`) reads `YOUR_SEARCH_URL`, the people search filtered to your 1st
degree, with the circle scan's own reader: `_scrape_one_bridge(..., own=True)`, so it gets
`BRIDGE_RESULTS_JS` (place, followers, mutual count), the page-1/Previous fix, a search
charged per page, push-back, the 250-page Dev ceiling and the daily limit, saving every
`SAVE_EVERY_PAGES` pages, and Stop. `own` only skips the profile (there is none to open:
straight to the search), drops the bridge-slug filter, and says "your" where a circle says
"their" ("Opening your connections...", "About N results in your list"). By hand it is
`_read_by_hand` with `_your_search` in place of `_their_search` (the window must be on a
`network=["F"]` search with no `connectionOf`), the same chimes and scan light lines, worded
"your list" (`lib/scan-light.js` reads both).

- **Progress** is noted in `bridge-progress.json` under `YOUR_LIST` (`"your-connections"`), a
  key no profile URL can be, so `pausedList` and the rings never see it. `your_list_start`:
  no note, page 1; pages left, the first of them; all read (or page 100 reached), the note is
  forgotten and it reads again from page 1, so a second pass can stop and carry on too.
- **Saved** as degree 1 (`push_connections(..., degree=1)`): the ingest route fills in
  `location`, `followers` and `mutual_count` on the rows it has (by profile URL, never
  clearing one already read) and adds anyone not there yet, as the connections walk would.
  1st-degree rows keep a mutual count since this; nothing scores on it (`lib/rarity.js` only
  ranks the 2nd degree).
- **The 100-page cap.** LinkedIn's search shows 100 pages (1,000 people). A network larger
  than that is read that far and the log says so; the rest can come from Dig deeper later.
  No filter-slicing.
- **Plugins.** It ships in the scanner plugins 1.0.4. The route refuses it for an older plugin
  (`pluginTooOld`, `lib/scanner-capabilities.js PLUGIN_SINCE`), which would not know the flag.
  Either plugin runs it, Automatic or By hand as circle scans do.

## The window, and no pop-ups (rule changed 2026-10-04)

**The rule changed.** Until 2026-10-04 the scanner was "openly automated": a Chrome window
in front of you that you watched work. Blake retired that for what's on screen:

> "anything that utilizes chrome playwright within the actual app need to have no pop ups or
> security warning, double check" (Blake, 2026-10-04)
>
> "we are changing the rule that was during testing we are now polishing and dont want to
> hinder the user with clicking ok for pop ups … we want seamlessness … not to have any
> disruption through pop ups or windows" (Blake, 2026-10-04)

**What did not change:** the pacing (fixed waits; gentle pacing since 2026-10-05 only adds to them, *Pacing* below),
the budgets, the caps, the profile-view gap and the cooldowns, exactly as they were. Only
what reaches the screen changed.

**One launch helper.** Every Chrome the scanner starts goes through `launch_chrome()`
(`tests/chrome-launch.test.mjs` fails on any other `launch_persistent_context`):

- `CHROME_ARGS`: `--disable-blink-features=AutomationControlled` (kept) and `--test-type`.
  Playwright 1.63 passes no `--enable-automation`, so there is no "controlled by automated
  test software" bar. The yellow bar people saw was Chromium's "You are using an unsupported
  command-line flag … Stability and security will suffer", for Playwright's `--no-sandbox`
  and for our blink flag, each on its own. Chrome skips its startup bars under `--test-type`
  (`infobar_utils.cc`: the `kTestType` return comes before `ShowBadFlagsPrompt`).
- On a Mac, `chromium_sandbox=True`: Chrome's own sandbox runs (renderers start with
  `--seatbelt-client`), headful and headless. Windows and Linux keep Playwright's default
  until someone tries them; `--test-type` hides the bar there too.
- `quiet_chrome_profile()` writes `QUIET_PREFS` into `<profile>/Default/Preferences` before
  every launch, read-modify-write (everything else kept; a file that isn't a JSON object is
  left alone): `profile.exit_type` "Normal" and `profile.exited_cleanly` (no "Restore
  pages?" after a stop had to kill Chrome, a crash or a shutdown), `credentials_enable_service`
  and `profile.password_manager_enabled` false (no "Save password?"), `translate.enabled`
  false, `profile.default_content_setting_values.notifications` 2 (LinkedIn asks).

**Where the window goes** (`chrome_window_mode`):

| Mode | When | What |
|---|---|---|
| `background` | the default | A real window kept out of sight. On a Mac, `MacChrome` hides it (as ⌘H does) from the moment it appears and **for as long as it's meant to be out of sight**, through AppKit's `NSRunningApplication` (ctypes, nothing to install); it opens on the main display, centred. Elsewhere it's moved off every display once it's up (`off_screen_bounds`: Chrome moves a launch position onto the nearest display). If AppKit won't load on a Mac, it's minimised over CDP. |
| `front` | `--login`, and `--show-window` (Scan page → Fine-tune → *Show the scanner's Chrome window*, off by default) | A normal window in front, centred on the main display. |

**Every display, not just the main one** (TRAPS §48). `screen_layout()` asks for the displays
at each placement (CoreGraphics on a Mac, `EnumDisplayMonitors` on Windows; none on Linux, which
falls back to -32000 and 40,40): off-screen means off all of them (up and to the left of their
union, never nearer than -32000), in front means centred on the main one, and the profile's saved
`browser.window_placement` is rewritten to the main display before every launch, so Chrome can't
open where the last window was on a second display. A display to the left or above has negative
coordinates; a Mac's are in points, so Retina and ordinary displays mix without scaling.

**Kept hidden, not just at launch.** Chrome unhides itself whenever it opens a window or a tab
(a new page, a pop-up), and the Dock or ⌘-Tab bring it out too. The watcher looks every 0.05 s
for 20 s, then every 0.1 s, until `bring_forward`, and again after `back_out_of_the_way`; a new
window shows for about 0.1 s. It stops when Chrome's process has gone (a lookup that finds
nothing isn't enough: it happens to a running Chrome), and at the next launch.
| `headless` | `--headless`, command line only | No window. Not offered in the app any more: more detectable, and a check LinkedIn asks for can't be seen. |

**Forward only when LinkedIn needs you.** `ensure_logged_in` calls `bring_forward()` just
before it waits for a sign-in or a security check (moved to the main display's centre while
still hidden, then unhidden, activated, in front),
prints `LinkedIn needs you: …` (`NEEDS_YOU`; the app's `needsYou()` in
`lib/scan-progress.js` reads it, and the notch and the Scan page show it in gold), and
`back_out_of_the_way()` once you're through. A mid-scan pushback with `stop_on_checkpoint`
still ends the run; it doesn't wait for you.

**Measured on this Mac, 2026-10-04, scratch profiles, a local page (never LinkedIn):**

- The "unsupported flag" bar is 56 px: Chrome's own UI above the page was 143 px with
  `--no-sandbox` alone, with the blink flag alone, and with both (1.0.0), and 87 px with
  `--test-type` (sandbox on or off) or with neither flag.
- `Startup.CrashBubbleShown` (chrome://histograms) after Chrome was killed: 1 without the
  prefs, 0 with them.
- Chrome started by Playwright makes itself the active app about a second in, whatever the
  window's position (every variant tried: plain, off-screen flag, minimised after, moved
  after), and keeps the focus. macOS puts a window placed at -32000 back at (0, 30); moved
  off-screen afterwards, 40 px of it stays on screen. Hidden from the moment it appears, the
  focus went back to the app you were in after about 0.2 s, and stayed there.
- A hidden (or minimised) window's page keeps drawing and loading: requestAnimationFrame at
  60 fps, `visibilityState` "visible", an IntersectionObserver firing on scroll (Playwright's
  `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`), so
  LinkedIn's lists still load as the scanner scrolls.
- `bring_forward` made it the active app, on screen; `back_out_of_the_way` hid it and the
  focus went back.
- Not tried: Windows and Linux (off-screen there, no hiding), and a live LinkedIn scan in the
  new window. Watch the first one.

**Measured again, 2026-10-05** (Blake's two-display Mac mini showed the window on the second
display; TRAPS §48), one display here, a local page:

- The launch position is Chrome's hint, not where it goes: -32000,-32000 opened at the main
  display's corner, 40000,40000 at its right edge. With two displays the nearest one wins.
- `context.new_page()` and a page's pop-up unhid the hidden Chrome and made it active, for
  good under the old watcher (gone 1.5 s after the launch). With the watcher kept on, a new
  tab 25 s in showed for about 0.1 s and was hidden again; two launches in a row (as Auto
  does) each stayed hidden; the page drew at 60 fps throughout.
- The sign-in window and `bring_forward` came up centred on the main display; the saved
  placement afterwards was there too.

## Sixgree's own browser (2026-10-15)

In the desktop app, with a scanner plugin installed, the scanner drives a panel inside
Sixgree's window instead of starting Chrome (docs/brain/DESKTOP.md, *Sixgree's own
browser*). The app names it in two variables, `SIX_DEGREES_PANEL_CDP`
(`http://127.0.0.1:<port>`, Chromium's debugging port) and `SIX_DEGREES_PANEL_TARGET` (the
panel page's DevTools target id); `panel_settings` takes nothing else.

- **One place**: `launch_chrome` attaches (`attach_panel`, Playwright's
  `connect_over_cdp`) and returns a `PanelContext`, which behaves like the persistent
  context the callers expect. Every mode gets its browser there, so nothing else changed.
- **Only the panel's page.** Playwright puts every page of Electron in one context, the
  app's own page among them. `_panel_page` asks the browser's `/json/list` where the target
  is, then asks only pages there for their target id (all pages when the list can't be read
  or doesn't match). `.pages` is that page alone; `new_page()` returns it again (Electron's
  pages aren't the scanner's to make).
- **Cookies are the panel's.** Playwright's `context.cookies()` reads Electron's default
  session, the app's, not the panel's partition, so `PanelContext.cookies` asks the page
  (`Network.getCookies`), and the page's `.context` is the `PanelContext` (`PanelPage`).
  `ensure_logged_in`, `_has_session_cookie` and `signed-in.json` work unchanged on it.
- **Closing only disconnects** (`browser.close()` on a CDP connection). The panel page's
  own `close()` does nothing. The panel, the window and the app carry on.
- **No window to move.** `_set_window`, `MacChrome`, off-screen placement and the profile's
  quiet settings are all skipped. Where a Chrome window would come forward (`bring_forward`,
  a launch in front: signing in, a manual read, *Show the scanner's Chrome window*) the
  scanner prints `Sixgree's browser: in front`, and `Sixgree's browser: out of sight` where
  it would go back; the app moves the panel (`lib/linkedin-panel.js panelWanted`). The
  `LinkedIn needs you:` lines say "in Sixgree's own browser".
- **Fallback**: a panel that can't be reached, or no page with that id, is said in one line
  ("Sixgree's own browser couldn't be reached (…), so this uses a Chrome window instead") and
  Chrome starts as before. With neither variable, nothing at all changes.
- **Outlink** (`--outlink URL --outlink-name NAME`, `open_outlink`): only in the panel.
  It checks the cooldown and the day's profile views, then `ensure_logged_in` (a security
  check there is pushback, as for Auto), waits out the gap and takes one profile view
  (`_wait_for_profile_view`, so `linkedin-activity.json` counts it), opens the profile,
  clicks nothing, prints `Outlink result: opened` and lets go. The app no longer starts it
  (after 2.5.0): every profile link opens the panel itself, at once, and the server counts
  the view (DESKTOP.md, *Every profile link*). The flag stays in the scanner.
- Tests: `tests/scanner-panel.test.mjs` (stand-in Electron), `tests/linkedin-panel.test.mjs`.
  The real check against a local page is in DESKTOP.md.

## Sign-in

Once per machine. The persistent profile at `SIX_DEGREES_HOME/chrome-profile` keeps the
session; later runs go straight to work.

Detection is the **`li_at` cookie**, read from the browser context. Not the DOM: an
earlier check waited for `nav.global-nav`, which no longer exists anywhere on LinkedIn,
so it never matched. Not the URL either — the signed-out landing page is often just
`linkedin.com/`, which slips past a `login`/`authwall` check.

Once the cookie is confirmed past any sign-in wall, `ensure_logged_in` writes
`signed-in.json` (`{ signedIn, at }`) in the data folder, and `signedIn: false` before it
waits for you to sign in. The Scan page's step 2 goes by that note
(`lib/scanner-setup.js` `signedInFrom`). It used to go by Chrome's cookie file, which Chrome
makes as soon as the window first opens, so closing it without signing in ticked the step. A
folder from before the note keeps the cookie-file check until the next scan writes one. A
pushback mid-scan (TRAPS §35) leaves the note as it was.

The window comes forward for it (`bring_forward`, above) and goes back once you're signed in.

The wait has **no meaningful deadline**. Closing the browser window is the cancel signal.
Any timer is a guess about how long a 2FA round-trip takes, and losing that race used to
close the window mid-login and discard the attempt.

## What the connections page actually looks like

Verified live 2026-09-09. Expect all of this to rot; re-probe rather than trust it.

- URL: `https://www.linkedin.com/mynetwork/invite-connect/connections/`
- A header line reads `"754 connections"` — parse it as a target and warn when the
  collected count falls far short on a full walk.
- **Ten people render initially**; more load on scroll via an intersection observer.
- **There is no "Load more" button** any more. The button-click path is kept as a
  fallback for older layouts, but infinite scroll is the live behaviour.
- **The window does not scroll.** `<main>` is the scroll container. TRAPS §6.
- Every person renders **two `<a>` tags at the same href** — one wrapping the photo, one
  wrapping name + headline.
- Class names are hashed per deploy. Never select on them. TRAPS §5.
- The photo's `img.alt` reads `"Jane Doe's profile picture"` — usable only as a
  fallback, and the suffix must be stripped.

## How extraction works

`CONNECTIONS_EXTRACT_JS` groups anchors by href and merges them:

- The **text anchor is authoritative** for the name; `img.alt` fills in only if absent.
- Line 2 of the anchor text is the headline unless it starts with `Connected on`.
- Anchors inside `nav`, `header`, `footer` are skipped — the "Me" menu links to the
  user's own profile and would otherwise be collected as a connection.
- A `licdn.com` image that is not a ghost avatar becomes `imageUrl`.

This survives redesigns because it depends on one thing: that a link to a profile points
at `/in/`. The previous approach — matching a name to a URL by comparing the first five
letters of the name against the URL slug, over only those links containing a photo —
skipped everyone without a profile picture and mismatched custom slugs.

**Where they are and their followers (2026-10-14).** Every list reader keeps each card's
location and follower count when the card shows them, and the app keeps them on the row
(`location`, `followers`; SCHEMA.md): `BRIDGE_RESULTS_JS` (a circle's list, auto and manual),
`CONNECTIONS_EXTRACT_JS` (your connections; its cards have shown neither so far, so it
usually finds none), and `SEARCH_RESULTS_JS` (company scans and `--search`, which used to
carry two copies of it inline). LinkedIn's own search data fills a blank the page text left
(`voyager_people`: `secondarySubtitle` is the place). The rules, so nothing else is taken
for a place:

- The place is the line straight after the headline, before any button or mutual line, and
  only if `placeOf` reads it as one: letters, spaces and `. , ' - ( )`, each word capitalized
  but for joining words ("Rio de Janeiro"), at most four parts. A headline, a mutual line,
  "3,766 followers", "Connected on …" and the buttons never are. In a circle's list the first
  line after the name must be the headline read for that card, or no place is taken.
- A follower count is its own line ("· 3,766 followers", "3K followers", "1.2M followers"),
  given to the card above it, as the mutual count is. A name two results share takes none.
- The helpers are one block (`// card lines: begin` … `end`) copied into each reader, since
  a snippet can't import; `scrape.py place_text` and `followers_text` read the same for
  LinkedIn's own data. `tests/scanner-location.test.mjs` keeps the copies identical.

**The JS lives in a raw Python string (`r"""`).** In a normal string, `'\n'` inside
`.split('\n')` becomes a real newline at import time, producing a JavaScript string
literal broken across two lines: valid on disk, a `SyntaxError` by the time Playwright
sees it. TRAPS §7.

## Writing back

The scraper writes **through the app's HTTP API**, never into SQLite directly — one
writer, one set of scoring rules, no second connection to the database. So the app must
be running. From the Scan page that is automatic — the app spawns the scraper as a child
process through `/api/scraper`, which is why there is no longer a second server or a
second terminal. From a shell you have to start the app yourself first.

`_assert_local_target()` refuses to push to a non-loopback `APP_URL` unless
`ALLOW_REMOTE_PUSH=1`, because a misconfigured `APP_URL` would upload a private network
to a third party.

## Bridges

A single bridge scrape (`--bridge "Name"`) is **verified working** — Blake ran one
end to end on 2026-09-09.

`--auto-bridge` walks every unbridged person, highest tier first. What it must survive
is the common case, not the happy one: **most people's connections are hidden.** Those
return `[], "private"`, are written to `bridge-skips.json`, and are not tried again
unless asked. See TRAPS §15 for why recording the attempt is the whole fix. The note is
made in `scrape_bridge` itself, so a one-person scan from page 1 (`--bridge-url
--from-start`, `--bridge`, `--rescrape`: a card's Scan or Rescan, the Scan page's Scan one
circle) makes it too; until 0.4.0 only the batch did.

**Company scans are still unverified** and share the old patterns TRAPS §5 and §6
describe. Watch one live before trusting it.

## Limits: one daily number, and a lift for the session (rule changed 2026-10-05)

> "we need to simplify this and allow more usage as it's constrained too much. Just a
> simple default limit for the day and a button to lift restrictions for this session."
> (Blake, 2026-10-05)

**What went.** The monthly search budget (and its 250 default), the separate profile-view
choice (10/25/50/100), Auto scan's own 40 a day and 200 a week (`AUTO_DAY_CAP`,
`AUTO_WEEK_CAP`, `_auto_ceiling_wait`), the budget picker's "ask first" past 100, and the
cooldown banner's own *Lift it early* (the `lift-cooldown` action). A saved
`scan-limits.json` keeps its `daily` number; its `monthly` and `profiles` are ignored and
dropped at the next save. An old `daily: 0` ("no limit") reads as 50.

**The one limit.** *Searches a day*, a rolling 24 hours: `scan-limits.json`
`{"daily": N, "pace": …}`, N a whole number from 1 to 1000 (`DAILY_RANGE`; `DAILY_MAX`
here), 50 by default (it was already 50). Profile views count against the same N, on their
own count. Auto scan (*Auto scan: sittings the app runs* below) plans every sitting
against the same N (`autoPlan`: a sitting is at most what's left, and at none Auto scan
ends with `limit`, which the notch turns into the lift offer); lifted, `leftToday` is null,
so only its pace's sitting size, its rests and its hours hold. A number control sets N in
Scan → LinkedIn usage, Scan → Scanner settings (where it replaced the three budget pickers),
the notch's line while a scan runs, and the onboarding's *Set your pace* step (the default
already in it).

**Where it's enforced.** The scanner, before every search and profile view, as before
(`searches_left`, `profiles_left`, `take_profile_view`). The route also refuses a press
that reads lists (`bridge`, `rescrape`, `resume`, `resume-all`, `company`, `your-connections`, a manual
Auto-Bridge round) with 409 `limitReached` before anything starts, and remembers it
(`state.limitHit`; also when a scan ends on the scanner's *Today's limit of N … is used*
line, `DAILY_LIMIT_USED`). `GET ?job=1` carries `limits: { lifted, reached, searches, daily }`
(`limitsNow`, which reads files only while lifted or just after a hold), and the notch
shows *Daily limit reached* with the lift, opened once by itself.

**Lift limits for this session** (`lift-limits`, back with `put-limits-back`). One click,
no pop-up, with the line *"Until you quit Sixgree, the daily limit and the cooldown are
off. Scans still keep their human pace and stop if LinkedIn asks you to check in."*
(`LIFT_LINE`). Held in the server's memory only (`lib/limits-lift.js`, on `globalThis`):
never a file, so a restart puts the limits back (tested in a fresh process,
`tests/simple-limits.test.mjs`). While lifted, `linkedinState` gives no `leftToday`, no
`profilesLeftToday` and no `cooldown` (the pause on file is `heldCooldown`, untouched). The
scanner is told by `SIX_DEGREES_LIMITS_LIFTED=1` at spawn, and a scan already running by a
line on its stdin (`limits: lifted` / `limits: on`, read by `_listen_for_limits`); then
`searches_left`, `profiles_left` and `read_cooldown` stop holding it back, and
`set_cooldown` still writes a new pause (`_cooldown_on_file`). **LinkedIn pushing back after
the lift puts the limits back by itself** (`sessionLift`: a pause set after the lift time),
since carrying on after a check is what turns it into a restriction; the usage section
says so, and lifting again is one click.

**What always applies, lifted or not** (they protect the account and cost nothing):

- the pace before every page and search (`PAGE_PAUSE`, `CHUNK_COOLDOWN`, the chosen speed,
  and gentle pacing's extras on top), and Auto scan's hours and rests (`DRIP_HOURS`,
  `SESSION_PAGES`/`SESSION_REST`);
- at least `PROFILE_GAP` between any two profile opens, timed from the record;
- stopping when LinkedIn shows a sign-in wall, a security check, a restriction or its own
  limit, keeping the page (`pushback/`) and writing the pause (TRAPS §35);
- Auto's caps on connection requests (15 a day, 80 a week);
- one scan at a time, and the queue with every check at its turn;
- the one-time *I understand* before the first scan (`lib/scan-risk.js`).

## Dev mode and manual mode (2026-10-12)

Two switches in Scanner settings, saved in `scan-limits.json` beside the daily number and
read by both sides (`lib/linkedin-limits.js` `readLimits`/`writeLimits`; `scrape.py`
`_scan_settings`). Both are read from the file each time they're asked, so a scan under way
follows a change. Both belong to the scanner, and leave with it if it becomes a program of
its own.

- **Dev mode** (`"dev": true`, `"devSince"` in epoch seconds). `scrape.py` `dev_mode()` feeds
  `limits_lifted()`, so everything the lift takes off goes too, and also: Auto's invite caps
  (`invites_left`, `take_invite`, which still writes the invite down), Auto scan's hours
  (`_sitting_over`, `_drip_before_search`) and, app-side, the queue's length
  (`DEV_QUEUE_CAP`) and Auto scan's hours (`autoPlan` `anyHour`). The speed is never touched:
  `apply_pace` still sets `PAGE_PAUSE`, `CHUNK_COOLDOWN`, `PROFILE_GAP` and the breaks, and
  Auto scan's sitting and rest are its pace. **Off on pushback, twice over:** `set_cooldown`
  calls `turn_dev_mode_off` before anything else (even when an older, longer pause means it
  writes no new one), and `devMode()` in the app turns it off on seeing a pause whose
  `set_at` is after `devSince`. Never put it in `SIX_DEGREES_LIMITS_LIFTED`: that is read once
  at the start, so a pushback mid-run couldn't take it back.
- **Manual mode** (`"manual": true`). `scrape_bridge` decides it (`manual_reads()`, never in a
  `--sitting`, never headless), sets `CHROME_WINDOW["show"]` so the window is in front, and
  passes `manual=True` to `_scrape_one_bridge`, which does everything it always did up to and
  including opening page `start_page` and checking it (in manual mode a window already on
  another page carries on from there instead of stopping), then hands over to `_read_by_hand`. That
  polls the window every second and never scrolls or clicks: the page number is
  `CURRENT_PAGE_JS` (the page bar), the address only without one, because LinkedIn's Next
  left the address on the old page (2026-10-12: page 10 read as 9, skipped forever); a page
  counts once `AT_FOOT_JS` sees the pagination bar (or the last person) in view and its
  `RESULT_LINKS_JS` differ from the last page read's; it is read with `BRIDGE_RESULTS_JS`; a
  wait on one thing for `MANUAL_SAY` seconds is said once in the log; and
  `reach["last"]` only advances through pages read one after another (TRAPS §34). A page is
  charged as a search the first time it's seen. It prints the same `Page N... X found (total:
  Y)` lines the route counts, and `LinkedIn needs you:` lines for the notch, ended by `Manual
  read done` (`lib/scan-progress.js` `THROUGH`). Closing the window returns `success` with
  `more` set, without the global stop, so `auto_bridge_all` moves on; `MANUAL_IDLE` with
  nothing read sets the global stop. Auto scan refuses to start and stops while it's on
  (`autoRefusal`, `autoPlan` `manual`, `MANUAL_STOPS_AUTO`).

Mutual counts read "A, B & 8 other mutual connections" since 2026-10-12: both readers took
only "and", so every stored count was 1 (`mutual_count_text` and the page reader's
`mutualCount`, kept in step by `tests/scraper-mutuals.test.mjs`).

Chimes (`_chime`, `lib/chimes.js`, `lib/chime-files.js`): `_read_by_hand` plays `read-N` for
the Nth page in a row (to `MANUAL_STREAK_TOP`), `done` when the list ends, and `next` once a
click (`MANUAL_TAP_GAP`): from a `page.on("request")` listener for a voyager search request
(only after the first page is read, so the scanner's own load never taps) or, failing that,
when the page bar moves. Events only arrive while Playwright runs, so the loop waits with
`page.wait_for_timeout` (`_manual_wait`), never `time.sleep`, which would hold the tap until
the next look. `_chime` never waits for the sound and never raises.

**Breaks by hand (2026-10-15).** Blake read 70 pages of his own connections by hand in 9.5
minutes (a median of 3.3 s between pages) and LinkedIn warned him about going through a lot
of data; 10/12 had 305 pages a median of 4 s apart and a restriction; 10/3 had 288 pages about
50 s apart and nothing. His ask: "make them wait every 10 pages … 20 seconds with a ticking
sound". `_read_by_hand` counts pages read since the last break (`since_break`, this run's
reads, not pages read before or hidden pages); once it reaches `manual_break()`'s `every`, and
the list isn't over, it prints a status line ("10 pages read: a 10-second break before page
11. …"), a `LinkedIn needs you: page 10 is read (10 people). Break: wait 10 seconds, then go
on to page 11. …` line, and runs `_manual_break`, then the usual "Click Next" line.
`manual_break()` reads `breakEvery` (1 to 25, default `BREAK_EVERY` 10) and the scan speed
(`pace`) from `scan-limits.json` at each break, so a change reaches a scan under way. How long
follows the speed (`BREAK_PACE_SECONDS`): 30 s Slow, 10 s Medium, 5 s Fast, and Medium's 10 s
for a missing or unknown speed. `breakSeconds` (10 to 300, default `BREAK_SECONDS` 20) is kept,
saved and checked, for an adjuster to come that sets the length over the speed's; its slider is
hidden and nothing reads it for a break yet (`lib/manual-breaks.js` says the same numbers;
Scanner settings → *Breaks by hand*, `app/components/ManualBreaksSetting.js`).

The break is enforced, not asked for, two ways, each working without the other, both through
the Playwright page object only (so the same in Chrome and in the panel: `PanelPage` hands
`evaluate`, `route` and `unroute` to the panel's real page):
- **The layer** (`BREAK_SHOW_JS`): a clear, full-window element at the top z-index that
  swallows clicks, pointer and touch events and Enter/Space (arrow keys still scroll), with
  "Break: 14 s, then page 21" on it. Written again each second, so a redraw gets it back; it
  removes itself `BREAK_STALE_MS` (5 s) after its last update, so a scanner that dies
  mid-break never leaves it on the panel (which outlives the scanner). `BREAK_HIDE_JS` takes it
  off at the end. It needs no LinkedIn selector, so a new layout can't slip past it.
- **The hold** (`_BreakHold`): `page.route(_search_load, …)` for LinkedIn's search pages and
  its voyager search API (the same requests the Next tap listens for), answering none until
  the break ends; then `unroute` and `continue_()` each held request ("The page asked for
  during the break loads now."). Catches what the layer can't: the address bar, a key it
  missed. Playwright supports a handler that answers later; the held requests are answered
  before the `unroute`, so no handler is in flight when the route comes off. Routing is on
  only during the break (it turns off the HTTP cache while on). A page that can't route still
  gets the layer. **Trap:** Playwright's `evaluate` waits for a navigation to commit, so with a
  whole page held (`_BreakHold.navigating`, a document or navigation request) nothing may
  evaluate on the page or the break never ends: the layer is no longer written, and the new
  page replaces it. Checked in a real Chrome (Playwright 1.60) against a local page: a mouse
  click and Enter/Space on Next did nothing, a fetch and an address-bar load were held and went
  through as the break ended, and the layer took itself away 5 s after its last update.

Once a second it prints `  (break after page 10: 14 s, then page 11)` and plays
`_chime("tick")` (`lib/chimes.js` `tick`, `CHIME_VERSION` 2, so the data folder's sounds are
written again; chimes off or volume 0: silent). The app keeps only the newest of those lines
(`route.js` `BREAK_TICK` in `push`), so a five-minute break doesn't push the log out; the
scan light reads it as yellow "Break: 14 s, then page 11" (`lib/scan-light.js` `manualNote`,
and `manualNeed` for the opening line). The Next tap is off during a break. Stop and a closed
window end it within a second, with everything taken off. Auto mode never breaks this way.

**The "found" count** (same day): each card's mutual line links its names to your own
connections, so `BRIDGE_RESULTS_JS` returned them as people too ("Page 3... 24 found" on a
page of 10). The reader now notes which records start a card of their own in its line walk
(`nameIn`; a name two share marks all of them) and marks the rest `mutualOnly`, unless it made
out no card at all (then nothing is marked, the count as before). `_listed()` counts the
unmarked and strips the mark; both readers (by hand and automatic) print that count and add it
to `reach["found"]`. The mutual names are still saved, as before.

In panel mode, the opening manual line says "in the LinkedIn panel" (`PANEL["on"]`), not "in
the Chrome window". Tests: `tests/manual-breaks.test.mjs`.

Tests: `tests/dev-manual-mode.test.mjs` drives `_read_by_hand` with a stand-in window and
clock: a person scrolling and clicking Next. `tests/chimes.test.mjs` checks the sounds, the
files, the settings, the player and when each chime plays.

## Pacing: gentle, on top of the old waits (2026-10-05)

> "polish the pacing, with extra intervals" · "add scroll intervals as well" · "random scrolls
> do" · "build on top of the old system, never replace it" (Blake, 2026-10-05)

**The rule: only ever more.** The old read runs exactly as before, every time: the same
waits (10 s for a list, 3 s on each page, `PAGE_PAUSE` before the next, `CHUNK_COOLDOWN`
after every 10, `BRIDGE_COOLDOWN` between people, `PROFILE_GAP` between profiles), the same
checks, the same reader (`_read_results_page`, `BRIDGE_RESULTS_JS`), in the same order.
Gentle pacing adds layers around it and can't shorten or skip any of it. Scanner settings →
**Gentle pacing and scrolling (new)**, on by default (`scan-limits.json` `"gentle"`, read by
`apply_pace` at the start of every run). **Off, a read is the old one exactly**: the same
sleeps in the same order (`tests/pacing.test.mjs` pins the list).

| Layer | What it adds | Where |
|---|---|---|
| A paced extra | after each old wait: `paced_interval(floor) - floor`, the floor plus a half-normal extra (sigma 0.125 × floor), capped at 3 × the floor. Mean about 1.1 × the floor. Python's `random`, `PACE_RNG` | `gentle_extra`, before the 10 s and the 3 s, after the page pause and the cooldown between people |
| Reading time | 0.4 s for each person a results page showed, paced | `_gentle_after_page` |
| A random scroll | before the old reader: 3 to 8 wheel steps of 180 to 720 px, 0.15 to 0.6 s after each, a small scroll back up on about a quarter of pages (two on a fifth of those), an idle 0.8 to 2 s on about one in eight, always ending at the foot | `scroll_plan`, `settle_list` |
| A scroll while waiting | on about a third of page pauses, one or two small wheel turns (40 to 220 px, up or down) | `wait_scrolls`, inside `rest` |
| A short break | after about one page in a hundred, a few minutes (Fast 1 to 2.5 min, Medium 1.5 to 4, Slow 2 to 6): "Short break, back at 14:32." | `break_after_page` |
| A longer rest | every 60 pages: Fast 3 min, Medium 5, Slow 8, paced. Not in Auto scan's sittings, which rest on their own | `break_after_page` |

Every new wait goes through `rest()`, a second at a time, so Stop ends it within one; a wait
of minutes says when it ends and a line a minute. The old waits keep their old steps.

**The scroll can only add.** `_read_page_gently` reads the page first as the old reader
would (`BRIDGE_RESULTS_JS`), then scrolls (`settle_list`), then runs the old reader as
always, and keeps the old reader's people plus anyone the first look saw that it didn't.
`settle_list`, by structure only (TRAPS §5): the profile links in `<main>` (not in nav,
header, footer or aside), the list holding the last of them (`role=list`, `ul`, `ol`), its
height, and the list's own scroll container scrolled to its end as well as the window (TRAPS
§6). Rounds of: the random scroll, a visibility wait on the last profile link
(`locator(...).wait_for(state="visible")`), two counts 0.4 to 0.7 s apart; done when the count
and the height stop growing, at most 6 rounds or 8 s. If it errors, times out or finds no
list, it's ignored, with one line a run (*New list check didn't find the list, used the
standard read.*), and the old reader's answer stands. Tested both ways: a page that loads 3
more as it scrolls is read in full (39, where the old read had 30), and a page where every
new layer fails gives exactly the old result.

**The speeds shown are worked out from the same numbers** (`lib/scan-pace.js` `PACING`,
checked equal to `scrape.py` `PACING`): `pageSeconds`, `paceSeconds`, `searchesPerHour`,
`firstCircleSeconds`, `profilesPerHour`, `paceLine`, each with gentle pacing or without.

| Speed | Searches an hour, gentle (old) | A list of 100 pages, gentle (old) | First circle, gentle (old) | Profiles an hour at most |
|---|---|---|---|---|
| Fast | about 77 (113) | about 76 min (55) | about 7 min (5) | 54 (60) |
| Medium | about 40 (52) | about 147 min (115) | about 14 min (12) | 36 (40) |
| Slow | about 23 (29) | about 256 min (210) | about 25 min (21) | 27 (30) |

About a quarter slower at Fast, a fifth at Slow: reading time and the scroll are the most of it. The Scan
page's speed line, the Speed buttons, LinkedIn usage's "about N searches an hour", the Scan
one circle box and the onboarding all read these.

## Retries: 2, 4, 8 and 16 seconds (2026-10-05)

One way, `read_with_backoff(page, look, what, reload)`, and only around what the old read
already took for a failure: their list not loading after the old 10 s and six looks (it used
to end as *a search that would not open*), a results page the old reader found empty, Read
profiles' profile and its Experience section. `look(page)` returns None while the page isn't
ready. Retries after `BACKOFF` = (2, 4, 8, 16) s exactly, plus up to 0.5 s of jitter
(`backoff_wait`). The first two look again in place; the last two reload (`_counted_reload`),
and each reload is a search, or a profile view that also waits out the minute between views,
counted against the day like any other; with none left it looks in place instead. Logged
calmly: *Their list slow to load, trying again in 2 s (attempt 1 of 4).* After the fourth it's
"unread", said so, never taken for zero (TRAPS §7), and the caller does what it did before.

**Never retried:** LinkedIn pushing back (`PUSHBACK_JS`: a security check, a sign-in wall, a
restriction, the unusual-activity warning), HTTP 429 or 999 on the page opened (`_NAV`), and
its short "too many requests" page (`TOO_MANY_JS`). Those end the read at once, as always.
Off (gentle pacing off) there are no retries: the old read exactly.

## Exit codes (2026-10-05)

The scanner says how a run ended in its exit code; the plain line on stderr stays. The app
goes by the code (`lib/scan-exit.js exitOutcome`, `route.js finish`); for a scanner from before
the table, the daily limit is still found by its words. Both tables are one
(`tests/scan-exit.test.mjs`).

| Code | Kind | Raised by | The app |
|---|---|---|---|
| 0 | ok | finished, or stopped by you | *Finished.* |
| 1 | error | anything unexpected (traceback on stderr) | a stop with its reason |
| 2 | usage | argparse, a bad command line | a stop with its reason |
| 10 | pushback | `LinkedInPushedBack`, Auto's `pushback`, a batch that ended on it | *Stopped: LinkedIn pushed back.* and the reason |
| 11 | limit | `BudgetReached` | calm (`exitCode` 0), the notch's lift |
| 12 | cooldown | `CoolingDown`, the two-unclear breaker | calm (`exitCode` 0) |
| 13 | signed-out | `NotSignedIn`, Auto's `not-signed-in` | a stop with its reason |
| 14 | save-failed | `SaveFailed` | a stop with its reason |
| 15 | unread | `PageUnreadable` (Read profiles: 3 in a row) | a stop with its reason |
| 16 | search-limit | `SearchLimitReached` | a stop with its reason |
| 17 | try-later | `TryLater` (Save photos) | a stop with its reason |

`exitCode` in `GET ?job=1` stays what the app always read (0 for a calm end); `exitKind` says
which. An Auto-Bridge batch that ended early exits with why (`BATCH_END`, after saving its
photos). Install's pip codes are pip's own: read as plain errors.

## Dig deeper and the top card (2026-10-12)

Blake: "when people auto scan or manual will have the option to dig deeper", built on Read
profiles, which it replaces in the app ("repurpose or remove" the old switch). Scanner
settings → *Dig deeper: read their profile* (`"digDeeper": true` in `scan-limits.json`;
`scrape.py dig_deeper`).

- **The top card, on every profile visit:** `TOP_CARD_JS` / `read_top_card`. It reads followers
  and the connection count ("500+ connections" is `{connections: 500, connectionsPlus: true}`)
  from the section holding their name, the `connectionOf` link, and the Activity heading.
  - It never reads the rest of the page: Interests shows companies' followers.
  - Where they are (2026-10-14, `read_top_card_all`): only the line their *Contact info* link
    sits on or under. The top card also names their company and school, which read like
    places, so without that anchor nothing is taken. It goes with whatever is sent to their
    row (`location`), or alone (`{status: "card"}` with no card) when the card showed no
    numbers.
  - The count goes to `_LIST_CARDS` and from there into bridge progress (`connections`,
    `connectionsPlus`; kept when a later read has none), for the ring round their dot
    (`lib/reach.js`).
- **With Dig deeper:** `_dig_into_profile` reads their experience on the same visit.
  - In auto mode it uses `read_experience`, which scrolls and reads LinkedIn's own data from
    a response listener registered before the `goto`. In manual mode it uses
    `_read_experience_by_hand`, which never scrolls: the notch asks you to scroll to
    Experience, it reads as it shows, waits up to `MANUAL_DIG_WAIT` and notes nothing if you
    don't reach it.
  - It sends the result to their row with the card (`push_experience`;
    `lib/experience.js cleanCard`, the stored experience's `card`). Scoring reads followers
    as recognition (`lib/scoring.js`).
  - Only for someone without experience on file (`_experience_on_file`). With their search id
    known, their profile is opened once just for this (one profile view), and not at all
    when today's profile views are used.
- **The first live reads (2026-10-12):**
  - **No company line:** LinkedIn's Experience entries are now title, dates and description,
    with the company only as the entry's logo or company link. `EXPERIENCE_JS` `companyOf`
    reads it into `logo`, and `roles_from_items` uses it when no company line is found.
    Andre's four roles all read with no company until then.
  - **The card is saved on every visit:** as `{status: "card"}` when the experience isn't
    read. `app/api/ingest` adds it to a read already on file, never replacing it, and the
    ring falls back to it (`lib/reach.js scanFill`). A stop before the list used to lose
    the card.
  - **Manual mode stops waiting early:** it moves on with a reason after `MANUAL_DIG_STUCK`
    seconds of an Experience section it can't read, or `MANUAL_SAY` seconds at the foot of
    a profile with none. Anything it can't make out is kept in `debug/experience-<time>.json`
    in the data folder (`_keep_experience_evidence`, local only), so the reader can be fixed
    against the real page.
  - **A company link with no name on it:** each entry had one link to its company page,
    with no logo text and no label. `slugOf` takes the page address (`/company/aerotek/`)
    and `company_from_slug` turns it into a name. A numeric address names nothing. The kept
    evidence now records each link's address, text, label and image alts.
  - **Manual mode's foot rule:** a still-loading profile is short, so it read as "at the
    foot" before Blake had moved, and concluded there was no Experience. The foot now only
    counts after `MANUAL_DIG_SCROLLED` px of scrolling, with the page height unchanged for
    `MANUAL_SAY` seconds. Not scrolling at all moves on to their list after
    `MANUAL_DIG_WAIT` (45 s), as the notch says.
  - **Stop while a profile is open** never goes on to their list (a stop check after
    `_dig_into_profile`).
  - **Done for good:** `_experience_on_file` is true only with roles read, a company on at
    least one, and the card. Anything less is dug again.
  - **Companies named only by their number:** Andre's entries link to `/company/2889/` and
    carry no name, no logo text and no label. They're named three ways, at no extra
    request:
    - from a description that opens with the company (`company_from_description`);
    - from any top card that named that number as someone's current company
      (`TOP_CARD_JS` companies, `remember_company`);
    - from the number's remembered name in `company-names.json` in the data folder. A top
      card's name wins over a description's.
  - **Logos:** each role keeps `companyId`, and its logo is saved once per company beside the
    photos (`_company_logos` → `store_avatar(src, "company:<id>")`, shown on the person's
    card). The page's logo link never reaches the app.
  - **Manual mode reads while you scroll:** once Experience is found, it keeps reading while
    you scroll through it. It moves on when the section's bottom is past the top of the
    window, at the foot of the page, after `MANUAL_DIG_SETTLE` s with the whole section in
    view and nothing new, or after `MANUAL_DIG_READ_MAX`. Blake: "the second it finds the
    experience the app captures and moves on but doesn't let the user scroll all the way".
  - **No list total:** a live look found no "About N results" on today's people search,
    nor in its data. For anyone over 500 the only count is the profile's "500+", so their
    ring keeps its dashed band until the list ends.
- **The old round:** the app no longer offers Read profiles' batch round. `--read-profiles` and
  its route action remain for the command line. Its queue still reads the highest power first.

## Read profiles: optional, off by default (2026-10-05)

> Blake: "Read full profiles (experience)", off by default, its own action.

Scanner settings → **Read full profiles (experience)** (`scan-limits.json` `"profileReads"`),
with the line *"Opens each person's profile, which is a profile view: the action LinkedIn is
strictest about. Counts against your searches a day, at most one a minute."* On, a round of 5,
10 or 25 (`read-profiles`, `--read-profiles=N`, `read_profiles`). The route refuses it while
off, and with no profile view left today; one scan at a time, like every action (not queued).

- **Who:** your 1st-degree connections with a profile and no experience on file, highest power
  first (`profile_read_targets`, the same order as `lib/experience.js readProfileQueue`). The
  people you can actually ask, whose score most moves Paths, in small bounded rounds. People
  in circles aren't read: there are many more of them, and profile views over time are what
  restricted an account (TRAPS §16). A profile that couldn't be read goes to the back after
  14 days (TRAPS §15), never at the front forever; one read is never read again.
- **Each one:** the paced extra, then `_wait_for_profile_view` (one of the day's views, at
  least `PROFILE_GAP` after the last; lifted, no daily cap, the gap stays), open, settle, then
  `read_with_backoff` until their name shows (`PROFILE_SHOWN_JS`; the later retries reload,
  each a counted view), reading time, a random scroll down the profile until it stops
  growing (its sections load as it scrolls), then the read on the curve, in place.
- **What it reads, never a CSS class:** first LinkedIn's own data, the `/voyager/api/`
  responses the page loads anyway and the JSON in its `<code>` blocks (`voyager_positions`:
  position entities with `title`, `companyName` or `company.name`, `dateRange`/`timePeriod`;
  and profile components with `titleV2`, `subtitle` "Company · Full-time", `caption`
  "Jan 2020 - Present · 4 yrs", in a card marked EXPERIENCE, a company's group carrying its
  roles inside); else the page, `EXPERIENCE_JS`: the section whose heading's words are
  "Experience" (or the `#experience` anchor), its list items' lines of text in reading order,
  a role nested in a company's item as its own sub (`roles_from_items`). Only LinkedIn's first
  few roles on the profile; "Show all N experiences" is logged, not opened.
- **Said in the log, for a report:** *Experience: 4 roles (1 current), from the page.
  LinkedIn's own data had 0; the page's Experience section, found by its heading, had 4
  (LinkedIn says 6 in all; only the profile's first ones are read).*
- **Couldn't read (TRAPS §7):** no role found is sent as `{"status": "unreadable", "why"}`,
  never an empty list, and `lib/experience.js cleanExperience` turns any "read" with no role
  into that too. Three in a row end the round (`PageUnreadable`, exit 15): the page has
  probably changed. A profile that never rendered records nothing; two in a row pause six
  hours, like Auto-Bridge's breaker. A security check or a sign-in wall ends it at once
  (exit 10, a day's pause).
- **Stored:** `linkedin_connections.experience`, JSON text (`ADDED_COLUMNS`, `db/schema.js`),
  through `POST /api/ingest` `{type: 'experience', people}`, one person a post, then everyone is
  rescored. `lib/scoring.js rolesWithCompanies` adds the roles read after the headline's: a
  current one like a headline role, a past one as former (70%); one the headline names isn't
  counted twice, so a read never lowers a score. Never written from Python.
- **Unverified:** written and tested against invented fixtures only
  (`tests/fixtures/linkedin/`, `tests/experience.test.mjs`, and in a real Chrome
  `tests/scanner-browser.test.mjs` when `SIX_DEGREES_PLAYWRIGHT_PYTHON` names a Python with
  Playwright). Never run against LinkedIn. Run one round of 5 and report the *Experience:*
  lines.

## Rate limits — a measured one

A real account was temporarily restricted on 2026-09-09 after about an hour of
continuous auto-bridging — roughly 20–25 profile views at the two-minute cooldown.
Lifted the same day. See TRAPS §16. Treat that as a ceiling seen once, not a safe
budget: batch the work, keep the cooldown, and stop at the first warning.

**Profile views count against the daily number.** It is one count for everything that
opens a profile: a circle scan whose search id isn't known yet (it opens the person's
profile once), Auto, and each profile Read profiles opens (*Read profiles* above).

- **The cap:** the daily number (`scan-limits.json` `daily`, 50 by default), counted on its
  own: N searches and N profile views in any 24 hours. Lifting the limits for the session
  takes it off; nothing else does.
- **The gap:** at least 60 seconds between any two opens (`PROFILE_GAP`). It is timed from
  the last view in `linkedin-activity.json`, not from the last run, so scans started back
  to back can't open profiles back to back. The job prints a countdown while it waits,
  and Stop ends the wait.
- **Where it's checked:** `take_profile_view()` checks the cap and the gap and writes the
  view down in one step, under the record's lock, just before `_scrape_one_bridge` opens
  the profile. With none left, the read returns `"budget"` with the reason `"profiles"`
  and opens nothing. `scrape_bridge` raises `BudgetReached(0, "profiles")`, which ends
  Auto-Bridge like the search budget does. Nothing about that person is recorded (no
  progress, skip or unclear note), so the next run tries them again.
- **Earlier checks:** `scrape_bridge` and `rescrape_bridge` check `profiles_left()` first,
  so no browser opens and no circle is deleted when none are left.
- **Not a profile view:** a read that carries on with a known search id doesn't open the
  profile, so the cap doesn't stop it.
- **A damaged record** counts the day's profile views as used, like its searches.

`tests/profile-views.test.mjs` runs this code with a stand-in page and clock. It shows
no `page.goto` happens once the cap is reached, and that the gap holds.

## Posture

Automating LinkedIn may violate its User Agreement and accounts have been restricted for
it. This runs locally, against the user's own account, at their own risk, and the README
and `docs/SCRAPING.md` both say so plainly. LinkedIn's official CSV export is the
supported path and needs none of this.

## Auto: one connection request (`--connect`)

Blake, 2026-10-03: *"auto add and basically adds the person for them in the card or
wherever its available … if [LinkedIn asks for] a email from their work or to send a
personal note if they have premium … have it close out of that in the scanner for adding
but it should be seamless."* It reverses the standing "no automated LinkedIn actions" rule
for this one action only: **one press, one person**, never a batch, never on a timer.

**Never run against LinkedIn while building it.** `connect_person` has only ever run against
the stand-in page in `tests/auto-connect.test.mjs`. The labels below are what LinkedIn is
known to use, not what this code has seen. Watch the first real one, and expect the labels
to rot like everything else here.

**How it's started.** Auto (`app/components/AutoConnect.js`, next to every Connect on a
person's card and in Outlink) posts `{action: 'connect', id}`. The route looks the person
up by id (`connectTarget`): anyone in your network with a profile URL who has no copy at
degree 1 and no request out. The URL and name on the command line come from the database,
never the request. It refuses, in this order, with a plain sentence:

| Refusal | Status |
|---|---|
| unknown id | 400 *That person could not be found.* |
| already a connection (any copy at degree 1, or accepted) | 409 |
| a request already out (any copy sent or pending) | 409 |
| no profile URL on file, or one that isn't a plain `linkedin.com/in/` | 400 |
| Auto's one-time question not answered (`autoConnectAccepted`, `needsAutoAcceptance`) | 409 |
| the scan's own "I understand" not given (`needsRiskAcceptance`) | 409 |
| no Google Chrome (`CHROME_REFUSAL`, `needsChrome`) | 409 |
| an import waiting to finish | 409 |
| a cooldown after LinkedIn pushed back | 409 |
| Auto's caps: 15 in any 24 hours, 80 in any 7 days (`inviteRefusal`, says when one frees) | 409 |
| no profile view left today | 409 |
| anything running: **queued instead** (*The queue* below); 409 only once the queue is full | 200 `queued` |

**What the scanner does.** It checks the cooldown, Auto's caps and the profile views again
before a browser opens (so none of those ever opens anything), takes a profile view like a
circle scan does (the cap and the minute's gap), opens their profile, and waits for it to
render (their first name in the heading or title, `PROFILE_SHOWN_JS`). Then, by role and
accessible name, never a CSS class (TRAPS §5):

- **Pending already** (a button or link whose name starts "Pending" and names them):
  `already-pending`, nothing pressed.
- **Their Connect**: a button, link or menu item named `Invite <their name> to connect`.
  The name must be theirs, first and last word: "People also viewed" has Connect buttons
  for other people on the same page. Not on the front: open **More** (`More` / `More
  actions`) and look again. A nameless "Connect" is taken only from that menu, and only when
  opening it is what brought one on screen; on the page itself a nameless Connect could be
  anyone's. None: `no-connect`.
- **LinkedIn's window** (role `dialog` or `alertdialog`), answered without a note:
  *Send without a note* if it's there, else the only enabled *Send* / *Send now*. Never
  *Add a note*, never Premium. Their email asked for (an email box, or the words): closed,
  `email-needed`. Its invitation limit: closed, `linkedin-limit`. Anything else (no way to
  send without a note): closed, `not-sent`. Closing is its *Dismiss* (or Close, Cancel, Got
  it), else Escape.
- **Confirmed** only when their profile then shows it Pending (naming them, or a new
  nameless "Pending" on their profile), or LinkedIn's notice says the invitation *to them*
  was sent. Otherwise `unclear`: the app doesn't mark it (TRAPS §7).
- **Push-back** (`PUSHBACK_JS`, a security check or sign-in wall, before or after): the page
  is kept in `pushback/`, everything pauses a day (`set_cooldown`), `pushback`, exit 1.

**Counting.** `linkedin-activity.json` has a third list, `invites`: written under the lock
(`take_invite`) just before Send is pressed, and also when Connect alone may have sent it
(no window came up). An email or limit window counts nothing. A damaged record counts the
day as used. The app reads the same list (`lib/linkedin-limits.js`: `invitesToday`,
`invitesWeek`, `invitesFreeAt`), merges it on an import, and shows it in Settings → LinkedIn
usage. The caps are `INVITE_DAY_CAP` / `INVITE_WEEK_CAP` here and `INVITE_CAPS` in
`lib/auto-connect.js`; a test keeps them equal, and the result names too
(`CONNECT_RESULTS` / `OUTCOMES`).

**Afterwards.** The route reads the `Connect result:` line as it arrives. On `sent` or
`already-pending` it marks the request through the same store as Connect
(`lib/requests.js markSentRows`: every copy of them, through the circle they were found in,
XP once) before the job is seen to end, and the job's `recent` entry carries `outcome`.
The button says how it went in `OUTCOMES`' words.

## The queue: one job at a time, the next one waiting (2026-10-05)

> "if someone auto connects but theres one already being added i want a queue thing to
> basically let the next person they want to add or bridge be queued in the scanner and have
> it shown in the notch." (Blake, 2026-10-05)

The scanner still runs **one job at a time**. What changed is the second press. Auto
(`connect`) and a scan of one person's circle **picked by id** (`bridge`, `rescrape`,
`resume`: Bridge Chains, Unscanned's *Build their circle*, the card's Scan and Resume, the
Ready-to-scan lists) pressed while something runs go into a queue instead of a 409. Anything
else (`full`, `refresh`, `auto-bridge`, `company`, a scan by name only, setup) is refused as
before. No pop-up: the button says its place, *Queued · 2nd* (`queuedFor`, `queuedLabel` in
`lib/scraper-client.js`).

| Where | What |
|---|---|
| `lib/scan-queue.js` | Pure: `enqueue` (dedupe, cap), `nextUp`, `skipItem`, `removeItem`, `clearQueue`, `queueView`, `placeOf`, `ordinal`. Shared with the browser, so no `fs`. |
| `lib/scan-queue-store.js` | `scan-queue.json` in the data folder, written durably after every change. Read once, the first time the route needs it. |
| `app/api/scraper/route.js` | `startJob` is the old POST body; `queueUp`, `runNext`, `scheduleNext`. `GET ?job=1` carries `queue`. |
| `app/components/ScanStatusBar.js` | The notch: `+2 queued` beside what runs; opened, the list (name, *Add* or *Build circle*, × each), *Clear*, and *Resume queue* while paused. |

**Every check, twice.** A press runs every check in the table above *before* it is queued
(so Auto's one-time question is still asked on the page, and a cap already reached says so at
once), and the queue starts each item through the same `startJob` at its own turn, so every
check runs **again then**: budget, Auto's caps (15 in 24 h, 80 in 7 days), the profile view,
the cooldown, Auto's one-time yes, the scan's "I understand", Chrome, a pending import, and
one-at-a-time itself. A refusal marks that item `skipped` with the refusal's sentence (the
notch shows it) and the queue moves on to the next. What is kept is only what a press would
send again: action, the person's id and name, the Chrome-window setting. **Never the
profile URL**: it is looked up again at the start, like every press.

**Rules.**

- **Dedupe.** The same person for the same kind (Add, or their circle: a Scan and a Resume of
  one circle are the same request) is ignored, whether waiting or running now. A new press for
  a skipped one replaces it.
- **Cap.** `QUEUE_CAP` = 10 waiting. The eleventh is a 409 `queueFull`.
- **Run next.** `finish()` calls `scheduleNext()`: the next item starts after a 4 s breath
  (`SIX_DEGREES_QUEUE_GAP_MS`, 0 in the tests). The scanner's own gaps and caps still apply
  inside each job; the queue adds nothing faster.
- **Stop pauses.** `cancel` (the notch's Stop, the Scan page's Stop) stops the job and sets
  `paused: 'stopped'`; a stopped job never starts the next. *Resume queue* (`queue-resume`)
  carries on: at once if nothing runs, else after the running job. *Clear* (`queue-clear`)
  empties it; × is `queue-remove`.
- **Restart.** A queue read back from the file with anything waiting is `paused:
  'restarted'`. Nothing starts because the app opened; *Resume queue* in the notch carries on.
- **The port.** A job the queue starts has no request to read the port from, so `POST`
  remembers the last `host` it was asked on (`state.port`) for `APP_URL`.

Tests: `tests/scan-queue.test.mjs` (a stand-in scanner that sleeps and writes down its
arguments): enqueue, dedupe, cap, run-next on finish, a refusal at its turn skips, Stop pauses,
the file and the restart.

## Experimental Auto-Bridge (`--experimental`)

The Scan page's *Experimental* switch adds `--experimental` to Auto-Bridge (`EXPERIMENT` in `scripts/scrape.py`, item 44/45, Graph Study §8). **Slow on purpose:** its rests are fixed; gentle pacing's extras (*Pacing* below) only add to each page's own wait.

- `_drip_before_search()` runs before every circle search:
  - a sitting of `SESSION_PAGES` (8), then `SESSION_REST` (an hour);
  - searches only inside `DRIP_HOURS` (09–18, local time);
  - at the daily limit (the same searches a day as every scan; its own 40 a day and 200 a
    week went on 2026-10-05) it waits until the oldest search in the last 24 h ages out
    (`_seconds_until_search_frees`). Lifted for the session, it doesn't wait for it.

  Every wait prints "… Carrying on at HH:MM" and a line a minute, which the status bar shows. A cooldown still stops the run (unless lifted).
- Each page is saved as it's read, and the 60 s after every 10 pages gives way to the sitting rest.
- **LinkedIn's own data:** `_wire_tap` keeps `/voyager/api/` search responses, and `_wire_merge` reads them after each page:
  - `voyager_people` takes anything with a title and a `/in/` link; `voyager_total` reads `totalResultCount`;
  - it fills blanks (headline, photo, mutual count) for people the page text found, and records the total;
  - people only LinkedIn's data shows are logged, not added;
  - it keeps up to `WIRE_SAMPLES` raw responses per run in `wire-samples/`.

  Bodies are read in the main flow after each page, not inside the event handler.

## Auto scan: sittings the app runs (2026-10-05)

> "it doesn't even work, and when I hover over it there's no animation of it flowing to
> extend, and it doesn't let them pick the tier they want to scan. We can have it there as
> experimental but it needs a slow / med / fast and the colour dots to pick which tiers."
> (Blake, 1.2.0)

Why it didn't work, and the rule since: TRAPS §49. In short, the waiting used to live inside
one long scanner run; now **the app runs short sittings and keeps the rests itself.**

| Where | What |
|---|---|
| `lib/auto-scan.js` | Pure, shared with the page: `AUTO_PACES`, `autoPlan` (go / hours / rest / stop), `paceLine`, `autoStatus`, `cleanTiers`, `tierList`, `clockText`. |
| `app/api/scraper/route.js` | `auto-start` (pace, tiers), `auto-stop`, `auto-settings`; `autoTick` every 20 s while it's on (`SIX_DEGREES_AUTO_TICK_MS`); `autoSittingEnded` after each sitting; `autoView` in `GET ?job=1` as `auto`. |
| `scripts/scrape.py` | `--sitting=N` with `--experimental`: `_sitting_over` ends the run (never waits) after N searches, outside `DRIP_HOURS`, or at the daily limit (not while lifted); checked before each person in `auto_bridge_all`, so no browser opens, and before every search. |
| `app/components/AutoScanButton.js` | The header button (Beta mark, a pill that slides out on hover or focus) and its panel, a portal anchored under it. `lib/experimental-client.js` keeps the pace and tiers in this browser (`six-degrees-auto-scan`) beside the switch. |

**A sitting** is one ordinary job: `--auto-bridge --tiers=<picked> --order=score --experimental
--sitting=N --max-pages=100 --deeper`. Highest tier and power first within the picked tiers;
a list read partway carries on from its page next sitting (its search id is kept, so no new
profile view). No "Scan done" notification per sitting.

**Paces** change only a sitting's size and the rest after it:

| Pace | Searches a sitting | Rest | About (estimate, 9 people a search) |
|---|---|---|---|
| Slow | 4 | 90 min | 20 people an hour |
| Medium | 8 (`SESSION_PAGES`) | 60 min (`SESSION_REST`) | 70 people an hour |
| Fast | 12 | 30 min | 180 people an hour |

A sitting is never more than what's left of searches a day (the one limit since 2026-10-05;
the monthly budget is gone), so Fast only gets to the limit sooner. It adds no limit of its
own. Lifted for the session, a sitting is the pace's full size, and the rests and hours stay.

**When it stops, calmly, with why** (`ended` in the view): the daily limit reached
(`limit`; the notch then offers *Lift limits for this session*), a cooldown after LinkedIn pushed back or a failed sitting (`stopped`), Stop, or
`Nothing left to bridge.` in the sitting's log (`done`: nothing left in the picked tiers).
Outside 9:00 to 18:00 it waits (`hours`), and between sittings it rests (`rest`); the scanner
is free meanwhile.

**Order with the queue** (*The queue* above): one job at a time, always.

1. What you queue goes first. A sitting starts only when nothing runs and nothing waits in
   the queue; a paused queue holds Auto scan too, and the panel says so.
2. A press during a sitting queues as usual (Auto, one person's circle) and runs when the
   sitting ends; a sitting is at most 12 searches. Other scans are refused as before.
3. During a rest or outside the hours the scanner is free: anything you start runs at once,
   and the next sitting waits for it.
4. Stop on a sitting (the notch's or the panel's) ends Auto scan; it doesn't come back after a
   rest.

**The switch** that shows the button is one setting (`six-degrees-experimental-auto`,
`lib/experimental-client.js setAllDay`), written in three places that stay in sync: Scan →
Scanner settings → *Auto scan* (first, never greyed out; Blake on 1.2.0 couldn't find it at
the foot of Extras, greyed while scanning), the panel's *Turn off Auto scan*, and the guided
setup's pace step. Off also stops Auto scan.

**Only while the app is open, and never by itself after a restart**: Auto scan's state is in
the server's memory, so quitting ends it, like the queue's restart rule.

**A scan you start yourself never keeps Auto scan's hours or rests**: only `autoTick` adds
`--experimental`; a request asking for it gets an ordinary run.

Tests: `tests/auto-scan.test.mjs` (the rules, then the route with a stand-in scanner and a
set clock: 20:00 waits for 9:00, the sitting's arguments, Fast inside the limit, nothing left,
the queue first, Stop), and the sitting cases at the end of `tests/profile-views.test.mjs`.
