# The scraper

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
| `--headless` | Command line only: works on every mode once signed in, but headless Chrome is **more** detectable, not less, and a check LinkedIn asks for can't be seen. |

## The window, and no pop-ups (rule changed 2026-10-04)

**The rule changed.** Until 2026-10-04 the scanner was "openly automated": a Chrome window
in front of you that you watched work. Blake retired that for what's on screen:

> "anything that utilizes chrome playwright within the actual app need to have no pop ups or
> security warning, double check" (Blake, 2026-10-04)
>
> "we are changing the rule that was during testing we are now polishing and dont want to
> hinder the user with clicking ok for pop ups … we want seamlessness … not to have any
> disruption through pop ups or windows" (Blake, 2026-10-04)

**What did not change:** the pacing (fixed waits, never randomised to look like a person),
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
that reads lists (`bridge`, `rescrape`, `resume`, `resume-all`, `company`, a manual
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

- the pace before every page and search (`PAGE_PAUSE`, `CHUNK_COOLDOWN`, the chosen speed),
  and Auto scan's hours and rests (`DRIP_HOURS`, `SESSION_PAGES`/`SESSION_REST`);
- at least `PROFILE_GAP` between any two profile opens, timed from the record;
- stopping when LinkedIn shows a sign-in wall, a security check, a restriction or its own
  limit, keeping the page (`pushback/`) and writing the pause (TRAPS §35);
- Auto's caps on connection requests (15 a day, 80 a week);
- one scan at a time, and the queue with every check at its turn;
- the one-time *I understand* before the first scan (`lib/scan-risk.js`).

## Rate limits — a measured one

A real account was temporarily restricted on 2026-09-09 after about an hour of
continuous auto-bridging — roughly 20–25 profile views at the two-minute cooldown.
Lifted the same day. See TRAPS §16. Treat that as a ceiling seen once, not a safe
budget: batch the work, keep the cooldown, and stop at the first warning.

**Profile views count against the daily number.** It is one count for everything that
opens a profile. Today that is a circle scan whose search id isn't known yet: it opens the
person's profile once, and that is a profile view. Reading someone's profile on its own
(planned) will count against the same number.

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

The Scan page's *Experimental* switch adds `--experimental` to Auto-Bridge (`EXPERIMENT` in `scripts/scrape.py`, item 44/45, Graph Study §8). **Slow on purpose:** fixed waits only, never randomised to look like a person.

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
