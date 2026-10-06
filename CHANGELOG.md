# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **App Management is required in the guided setup on macOS 13 and later.** The Get ready step
  now asks macOS whether Sixgree may manage apps (rechecked every 2 seconds and whenever the
  window comes back), and Continue stays off until it is really on. "I've allowed it" no longer
  counts while macOS says it is off. Turning it on makes macOS quit and reopen Sixgree, so the
  setup keeps its step with your settings and reopens on that same step, ticked. Where macOS
  can't be asked, the setup says so, logs why, and goes on once you say you've allowed it.

### Fixed
- **A page of hidden people pauses that list instead of finishing it.** Over LinkedIn's monthly
  search limit (no Premium), results show as "LinkedIn Member" with no name, the same as people
  out of your network deep in a list. Such a page now keeps the person's list at that page for
  later and moves on to the next person, so a capped month never marks lists as done.

## [1.2.5] - 2026-10-06

### Changed
- **LinkedIn's monthly-limit banner no longer stops a scan by itself.** When the banner shows
  but the page still has people on it, the scanner reads them and carries on; it stops for the
  monthly limit only when the page has the banner and nobody on it. LinkedIn's "approaching
  the commercial use limit" notice is a heads-up now, not a stop.

## [1.2.4] - 2026-10-06

### Fixed
- **A page of hidden people is no longer taken for LinkedIn pushing back.** Deep in a circle,
  LinkedIn shows people outside your network only as "LinkedIn Member", with no name or link.
  The scanner waited for links that never come, retried, then called it push-back and stopped,
  and every run went back to the same page (page 35 in Blake's case) and stopped again. Now a
  page of hidden members ends that person's list as read ("the rest is hidden by LinkedIn"),
  with no wait, no retries, no cooldown.

## [1.2.3] - 2026-10-06

### Added
- **Strategy engine (experimental, off by default).** Settings → Experimental. It ranks your connections
  by where they stand in your network, not by title and company: who you reach only through them, how often
  they sit between two others (betweenness), and how many industries and companies their circle spans,
  blended into a Leverage score from 0 to 100 that tier plays no part in. Separation gets a Gatekeepers
  list and a Leverage badge on each way in; a card gets a line such as "Low tier, but the only bridge to 38
  people at 6 companies". Someone whose circle isn't scanned shows "not enough data", never a low score.
  Built from what scans already read, the ties between your connections included: no extra LinkedIn
  traffic. Power, tiers, rings and dot sizes are unchanged. About a second for 15,000 people, worked out
  once per scan or rescore and kept.

## [1.2.2] - 2026-10-06

### Added
- **Read full profiles (experience), off by default.** A switch in Scan → Scanner settings,
  with the line it needs: each read opens a person's profile, which is a profile view, the
  action LinkedIn is strictest about, counted against your searches a day, at most one a
  minute. On, a round of 5, 10 or 25 of your own connections, highest power first, reads the
  current and past roles on their profiles (title, company, dates) so their score counts every
  role, not just the headline's. Nobody is read twice; a profile it can't read is marked as
  that, never as having no experience, and three in a row stop the round. It stops at any
  check from LinkedIn like every scan, and lifting the limits for the session never lifts the
  minute between profiles. Not yet tried on LinkedIn itself: the first round's log says what
  it found where.

### Changed
- **Gentle pacing and scrolling (new), on by default.** The scanner's waits run as they always
  did, then a little longer at random; each page gets reading time for the people it showed
  and a scroll down in uneven steps (now and then a small scroll back up, or a pause) before
  it's read, so a list that loads as you scroll is read in full; about once in a hundred pages
  there's a short break ("Short break, back at 14:32"), and every 60 pages a longer rest. It
  never shortens a wait or skips a check, and Stop still stops within a second. The speeds the
  Scan page shows count all of it: Fast is now about 77 searches an hour (113 without), a whole
  list about 76 minutes. Turn it off in Scanner settings for the old fixed waits exactly.
- **A page that's slow to load is tried again.** After 2, 4, 8 and 16 seconds (the last two
  reload it, each counted like any search or profile view), then it says it couldn't be read.
  Never when LinkedIn asks you to sign in or check in, or says there are too many requests:
  those stop the scan at once, as before.
- **A scan that stops says why more precisely.** "Stopped: LinkedIn pushed back.", "Stopped at
  today's limit." and the like, from the scanner's exit code, instead of "Stopped (exit 1)."

### Fixed
- **The opened notch is a rounded rectangle again.** With frosted buttons it took the tab bar's fully
  round ends, so opened (the queue, Details, the daily limit) it became an oval and squeezed its rows.

## [1.2.1] - 2026-10-05

### Added
- **Tier lines, in Network Circle's Filters.** Lines: All, S, A, B, C, D or None draws only the lines that touch the tiers you pick (with S alone, you to your S-tier connections and each of them out to their circle); the dots all stay, a selected person's own lines always show, and it is remembered and put back by Reset.

### Changed
- **Auto scan (experimental) has a panel: pace, tiers, Start and Stop.** Hover or click Auto scan
  beside Scan and a small panel drops from it, in the notch's glass: Slow, Medium or Fast (Slow
  is 4 searches then 90 minutes' rest, about 20 people an hour; Medium 8 then an hour, about 70;
  Fast 12 then 30 minutes, about 180), the tier dots S to D (S and A to start with), Start or
  Stop, and what it's doing in words: running, resting until 14:05, outside hours, limit
  reached, nothing left. A pace never adds searches: Fast stops at your daily limit sooner,
  never past it. Your pace and tiers are remembered. The button has a Beta mark, and hovering it
  slides out how it's set. Anything you queue runs before Auto scan's next sitting.
- **Auto scan's switch is first in Scan → Scanner settings, and never greyed out.** It was at the
  foot of the page under Extras, and greyed out while anything was scanning, so it seemed to exist
  only in the guided setup. The panel also has *Turn off Auto scan*; both, and the guided setup,
  are the same setting, and turning it off stops Auto scan if it's running.
- **One limit, and a button to lift it for the session.** The scanner had a daily and a
  monthly search budget, its own cap on profile views, and Auto scan's own 40 a day and 200 a
  week. Now there is one number, **searches a day** (50 by default, any whole number from 1 to
  1000), set in Scan → LinkedIn usage, in the notch while a scan runs, or in the setup's pace
  step; profile views count against the same number. A saved daily number is kept; the rest is
  dropped. **Lift limits for this session** (Scan → LinkedIn usage, and the notch when the limit
  holds a scan back) is one click, no pop-up: until you quit Sixgree, the daily limit and the
  cooldown are off. The notch and the Scan page show *Limits lifted* with *Put limits back*, and
  LinkedIn pushing back again puts them back by itself. Whatever the limit, scans keep their
  pace, keep profile views a minute apart, stop if LinkedIn asks you to check in, run one at a
  time, and Auto's caps on connection requests stay. The usage section is one meter now.

### Fixed
- **Auto scan works.** It was one long scan that did its own waiting: pressed in the evening it
  opened Chrome and a profile, then sat until 9:00 the next morning with the browser open;
  pressed after a day's scanning it ended at once; and it stopped for good after ten people,
  newest first, whatever tier. It now runs as short sittings with rests between them, kept by
  the app with no browser open, from 9:00 to 18:00 while Sixgree is open, through the circles of
  the tiers you picked, highest power first, and stops calmly when nothing is left in them or
  your daily limit is reached.
- **Map 2nd degree on the Scan page starts now, whatever the time.** With the experimental
  "Auto scan, all day" switch on, the round you start yourself took Auto scan's hours and rests,
  so after 18:00 it read one profile and then waited until 09:00 ("Resting overnight"). Only Auto
  scan keeps to its hours now; a round you press runs straight away, inside the usual limits.
- **The guided setup no longer sits on "fetching photos" after the first scan has ended.** It now goes to *Your galaxy is ready* within a second or two of the end, whether the window was in the background, the scan was stopped or failed while saving photos (a calm line says some may be missing), or another scan starts straight after.
- **The scanner's Chrome stays out of sight on every display.** With a second display it could
  come up there mid-scan and stay: Chrome moved its off-screen window onto the nearest display,
  and on a Mac nothing hid it again once Chrome showed itself (it does whenever it opens a window
  or tab). It's kept hidden for the whole scan now, off every display on Windows and Linux, and
  when LinkedIn needs you it comes up centred on your main display.

## [1.2.0] - 2026-10-05

### Added
- **Tuck the notch away.** A faint ⌃ at the notch's right end slides it up out of the way,
  leaving a thin pill under the tabs; click the pill, or press ⌘. (Ctrl+.), to bring it back.
  It stays tucked across reloads and restarts, the pill keeps the notch's dot (green while a
  scan runs, gold when LinkedIn needs you), and LinkedIn needing you brings the notch back
  down by itself, once.
- **Physics on or off, in Network Circle's Filters.** Off, the map holds still and uses almost no
  power: no settling, orbit, easing or pulsing ring, and nothing is redrawn until you do something.
  Every option still works; a layout, slider, filter or Find jumps straight to where it settles.
  Remembered in this browser, and off to start with Reduce Motion on.
- **A queue for the scanner.** Press Auto, or scan someone's circle (Bridge Chains, Build their
  circle, a card's Scan or Resume), while another scan is running and it waits its turn instead
  of being refused: the button says *Queued · 2nd*, and it starts by itself when the scans
  before it finish. Each one still goes through every safeguard when its turn comes (your
  budget, the daily caps, a rest after LinkedIn pushed back, Auto's own caps and its one-time
  question); one that can't start is marked skipped, with why, and the queue moves on. The
  notch shows *+2 queued* beside the running scan; open it for who is waiting and for what
  (Add or Build circle), with × to take one out and Clear. Stop stops the running scan and
  holds the queue until you press Resume queue. The same request twice is ignored, and at most
  10 wait at once. The queue is kept in your data folder, so a restart keeps it, waiting for
  you: nothing starts just because the app opened.

### Changed
- **Frosted glass is every look's buttons, and the looks are six.** Buttons are frosted glass
  by default on every look, with clear picked, hover, pressed, disabled and focus states; Soft is
  the only other choice. Analyst and Synthwave are gone: a saved Analyst becomes Daylight and
  Synthwave becomes Standard, your own colours (tier colours too) and choices kept. The tabs are
  calm on every look: no gradients or colour per tab, the one you're on a solid pill, Scan no
  longer greyed out, a running Auto scan a small dot.
- **Daylight is macOS glass.** White frosted panels, notch, tab bar and tooltips (blurred and
  saturated, a hairline and a soft shadow), Apple's label colours for the words, every step
  WCAG AA on white (primary 16.8:1, secondary 7.5:1), and the map's gold names and tier labels
  deepened so they read on white.
- **Separation goes past the 2nd degree.** The Filters grid's 3rd-degree dots (and 4th–6th,
  when there is anyone there) can be picked in Separation now. Each person counts once, at the
  nearest degree a real chain of scanned circles reaches them, with every shortest route drawn
  as you → your connection → the people between → them; on the map, the people between are
  stops along the line. Company scans' finds have no route on file (nobody links you to them),
  so they are listed under the ranking as "3rd degree · not ranked", with a note saying why
  and which company scan found them, instead of being hidden. Today's scanner reads only your
  own connections' circles, so a ranked 3rd degree needs circle rows from elsewhere; people met
  through a chain in Bridge Chains are 2nd degree to you (you're connected to the person whose
  circle they're in) and stay ranked there. (`lib/separation.js separationPeople`, `separationCounts`.)
- **A new Sixgree icon.** A gold S drawn as one tapered curve, with a round gold dot (you) in
  its lower bowl so it also reads as a 6, and a degree ring: six degrees. The app icon (Mac,
  Windows and Linux) carries faint tier rings and a glow behind the dot; the favicon and the
  website's small icon are the same mark without them, since they vanish at tab sizes. The
  guided setup now draws the icon from the same file the builds use.
- **The wordmark's dots run level to the right and end in a degree.** The gold dot still sits
  over the i; the tiers follow it in a straight line to the end of the word, each a little
  smaller (A purple, B blue, C green, D grey), and the row ends in a gold degree ring the same
  size and height as the i's dot: Sixgree°. The taper and fade are gentle, so every dot still
  reads at the website header's size and on a dark look. On a light look and
  on the website the word itself is ink, so the colour lives in the dots; on a dark look it stays
  gold. In the app and on the website.
- **Tier C is green.** The tiers now read like a game's rarity ladder: S gold, A purple,
  B blue, C green, D grey (C was a grey close to D's). On every look except Analyst, which keeps
  its colour-blind-safe set.

### Fixed
- **Opening or closing Filters or Details no longer moves the Galaxy.** The map used to jump a
  panel's width with its far edge cut off, then slide back half of it, so everything ended up
  somewhere new. Now every dot stays exactly where it was on screen, at the same zoom, in every
  frame: the panel covers or uncovers the map's edge and nothing else changes. Resizing the
  window still keeps whatever was in the middle in the middle. The layout and your pan and zoom
  were never rebuilt; it was the view being re-centred, late and as a slide.

## [1.1.0] - 2026-10-04

### Added
- **Unscanned, a new Degrees view: build a circle where you see it.** Right after Bridge Chains,
  it rings your connections whose circles aren't scanned yet round you the way Bridge Chains
  rings your bridges: S nearest, strongest first, names, hover, zoom and drag, and the Filters
  tiers. Lists the scanner already read (hidden, or nobody new) are left out and counted. Click
  someone and their empty circle opens with a *Build their circle* button in the middle (what it
  costs on hover); one press starts the scan right there, and a refusal is a short line under it.
  From then on dots join the circle one after another on a clock kept to the scanner's speed:
  hollow "on its way" dots, never more than a page ahead of what it has read, and as it saves
  people they take those places in their tier colours. The words above it always say what was
  really found and saved. When it ends the hollow dots go, the circle settles into tier bands,
  and a link opens them in Bridge Chains. Everything is worked out from when the scan started
  and what it has read, so leaving the view, the tab or the page and coming back shows the same
  progress; Stop in the notch leaves the people saved so far. Until you have a scanned circle,
  Degrees opens on Unscanned; once you have one, it opens on Bridge Chains as before.

### Changed
- **The Scan page leads with scanning.** The scanner comes first: what's mapped, what's
  running with Stop, Your connections (Check for new, Scan it all again), Their circles with
  the radar, In progress, and the log. Beside it, Setup is one box of green lights: a done
  step is one line with a tick, a step that needs you is red and open, and each has a chevron;
  "All set" once they're all green. Below: Scanner settings (budget, how much of each list,
  finishing stopped lists, retrying hidden ones), Extras as switches with a line each (Auto
  scan, Show the scanner's Chrome window, the daily messages sync), and LinkedIn usage last.
  Two columns on a wide window, one on a narrow one. Nothing was removed.
- **LinkedIn usage moved from Settings to the Scan page** (`/setup#usage`). The notch's budget
  and the budget box go there; `/settings#usage` forwards, and Settings keeps a line to it.
- **Six Degrees is now Sixgree** (sixgree.com). The menu bar, Dock, Finder, window, About box,
  installers, Start Menu and Desktop shortcuts, website and npm package (`npx sixgree`) all
  say Sixgree now. What stays the same for you: your network and settings (still in
  `~/.six-degrees`, still `SIX_DEGREES_HOME`), your backups (`.sixdegrees` files open as
  before), the app's settings folder, the in-app updater (1.0.0 updates itself to Sixgree like
  any other version), the Windows install it updates in place, and the GitHub repository.
  `six-degrees` still works as a command name for the npm package.
- **The Filters and Details buttons at the map's edges are lit glass, and they dock.** Each is a
  frosted round puck with a lit rim and a glow in its colour (the look's accent for Filters, its
  gold for Details), porcelain on Daylight, a flat hairline on Analyst, and drawn in every other
  look's own style. Hovering lifts it, shows its name, and builds a little cluster of gold, purple
  and blue dots round it, clockwise, the way Check for new's ↻ does. Opening a panel streams the
  dots along its edge, lights the edge, and docks the button there, chevron turned, as the panel's
  close control; closing plays it back. So the panels' separate *Close* rows are gone, Esc still
  closes a panel from inside it, the buttons are 44 pt to tap on a phone, and with Reduce Motion
  the panel simply fades. Neither button shows a count. Paths' Filters button is the same one.
- **A guided setup for someone new.** With no network yet, the app opens on one card at a time
  instead of the old welcome screen: *Welcome* (scan, import a CSV, or try the sample), *Get your
  Mac ready* (Chrome and the scanner tick themselves; App Management, on macOS 13 and later, with
  *Open System Settings*, *I've allowed it* and *Skip*, saved as before; and the "I understand"
  about scanning risks as a checkbox right there), *Connect your LinkedIn* (opens the sign-in
  window and turns to *Connected* by itself), *Set your pace* (speed, searches a day with the same
  gold warning above 100, never a pop-up, and the Auto scan switch), and *Map your people* (the
  first scan's progress, with the optional "What field are you in?" asked while it reads), then
  *Your galaxy is ready* and the map. Someone who leaves halfway comes back to the step they were
  on; someone with a network never sees it. The Scan page and the setup share one source for the
  scanner's status and what each button does, so they can't disagree.
- **No pop-ups when you scan: one click starts it, and Chrome stays out of your way.** Check for
  new in the header used to raise up to three boxes before and after it started; now one click
  starts it, the cluster spins on the button and the notch shows it running, and what it does and
  costs is the button's tooltip. Anything that can't start (the scanner not set up, a cooldown,
  one scan at a time) says why in a short line under the button that fades by itself. The same
  goes for every other way to start a scan: a click on someone ready to scan in Bridge Chains,
  *Scan their circle* in an empty circle, the Degrees panel's Ready to scan, the people panel's
  Scan rows and the card's Insights all start it right there instead of sending you to the Scan
  page to confirm it (a scan that stopped partway carries on with Resume, never reads the list
  again from page 1). The Paths company scan no longer asks
  first (its EXPERIMENTAL badge says what it asked), raising the budget past the safe limits is a
  question in the budget box instead of a box over the page, and Auto scan says why when it can't
  start. The Scan page's own buttons now grey out the header and the notch at once instead of a
  few seconds later. The two one-time questions stay (the "I understand" before the first scan,
  and Auto's before its first request), and so does every question before deleting something.
- **The scanner's Chrome works in the background.** After you've signed in, its window stays out
  of sight (hidden, on a Mac) and doesn't keep the focus or cover the app; it comes forward only
  when LinkedIn needs you, to sign in again or finish a security check, and the notch says
  *LinkedIn needs you* in gold until you're through. Chrome no longer shows the yellow
  "unsupported command-line flag … Stability and security will suffer" bar, and the scanner's
  profile is set so Chrome never asks to restore pages after a stopped scan, to save a password, to
  translate, or to show LinkedIn's notifications. On a Mac, Chrome's own sandbox is on. Fine-tune
  → *Show the scanner's Chrome window* keeps it in front for anyone who wants to watch. It replaces
  *Hide the Chrome window while scanning*, which ran Chrome with no window at all: more
  detectable, and blind to LinkedIn's checks. Pacing, budgets, caps and cooldowns are exactly as
  they were.
- **Insights is in your Profile, not a tab of its own.** The level button at the top right opens
  your Profile, and ✦ Insights beside Profile in the notch shows its boards after a thin line:
  People, Kingmakers, Gatekeepers, Companies, Industries, Report, and Health, the network health
  that Profile → Insights showed before. Every number and the rule under them are the same. Old
  links to Insights land on the same board, and the level button no longer reloads the whole app
  on the way there.

### Removed
- **The Paper look.** Eight looks are left, light or dark, and your own colours on top of any of
  them. A look saved or shared as Paper opens as Daylight, the other light one, with your own
  changes kept.

### Fixed
- **Every page has its notch, hanging from the tabs.** Network Circle and Separation had none
  unless a scan put its status there, because the notch only showed for a page with two or more
  views. A page with one view shows it now, lit: Network Circle's notch holds the Galaxy's layouts,
  Rings, Clusters and Orbit (picking one does what the Physics panel's Layout row does), and Scan
  and Separation have their own. Settings, Profile and Import have the same header as every other
  page, with the tabs, notifications, Check for new and your level, and a notch of their own:
  Settings' sections, which follow you as you scroll. The notch changes with the page: in the
  built app, the Scan page showed the page before's tabs for a moment. On a page that scrolls, the
  notch follows the header up and waits at the top of the window; it used to stay over the page,
  then vanish off the top the moment anything on the page changed. And while a scan ran, its green
  edge grew a line across the top, where it hangs from the tabs; it doesn't now.

## [1.0.0] - 2026-10-04

### Added
- **On a Mac, the Scan page offers App Management once, so macOS stops asking while you scan.**
  When the scanner starts Google Chrome, Chrome's own updater may try to update Chrome, and macOS
  asks whether Six Degrees can manage apps. A new item under step 1 says what that is and opens
  System Settings → Privacy & Security → App Management with one button (the right pane for macOS
  13 and 14 too); Done or Skip puts it away for good. It's optional and never holds the step up:
  scanning works either way, and Chrome updates itself the next time you open it. Now that the app
  is signed, allowing it once lasts across updates. The docs page's questions and the README say
  the same.

### Changed
- **The Mac app is signed by Blake Burford and notarized by Apple: no more Open Anyway.**
  Download it, drag it to Applications and open it like any Mac app; macOS only asks once
  whether to open an app from the internet. Every program inside it (the app, the server, the
  scanner's Python and its parts) carries the signature, and Apple has checked the app and the
  disk image. Updating from inside the app works the same from an unsigned copy (0.8.0 and
  earlier) to a signed one, and from one signed version to the next. The website, the README,
  the release notes and the picture in the disk image's window say so now. From 1.0.0 on, a
  Mac release can't go out unsigned. The Windows app isn't signed yet: SmartScreen still asks
  the first time.

## [0.8.0] - 2026-10-03

### Added
- **Insights: your network ranked by power.** A new tab between Paths and Outlink. The Power
  Index ranks everyone within two steps of you, each person once, with shared ranks for ties and
  a line saying why a big tie shares its score; filter by degree, tier and rarity, search by name,
  company or who knows them, and from any row open their circle, scan it, or ask (their LinkedIn
  profile opens and the request is marked sent, as on their card). Beside it: Untapped (S and A
  in your 2nd degree with no request out), Kingmakers (the connections with the most S and A
  behind them), Gatekeepers (who your S and A reach hangs on), Hidden giants (S-tier with one way
  in), Company power, How sure (how much of the ranking rests on a guess), and Richest?, which
  says plainly that the app never sees money. Kingmakers, Gatekeepers, Companies, Industries and
  a scrolling Report are views of their own in the notch. Every number says where it came from;
  a CSV import gets the boards that need no circles, and says so for the rest. On your own network every 2nd-degree row offers Auto beside Ask.
- **Auto: one press sends someone a connection request for you.** Next to every Connect (a person's
  card, and Outlink's lists and next best moves) there's now an Auto button, the bright one. Press it
  and the scanner's Chrome opens their profile, presses Connect and sends the request without a note,
  then shows "Request sent" and marks it pending everywhere in the app. Connect still opens their
  profile for you to do it yourself. One press is one person: never a batch, never on a timer, and it
  waits while a scan runs. It asks once before the first one. When LinkedIn wants their email address
  first, Auto closes that and sends nothing ("Use Connect to add them yourself"); when LinkedIn offers
  a personal note (Premium), it sends without one. It only calls a request sent once their profile
  shows it pending, and says so plainly when it can't tell. It stops at 15 requests in any 24 hours and
  80 in any 7 days (LinkedIn doesn't publish its limit; about 100 a week is commonly reported), opens
  their profile once like a scan does, holds during a pause after LinkedIn pushed back, and shows in
  Settings → LinkedIn usage as Connection requests (Auto).

### Changed
- **A scan that stopped partway says so, on the person's card and on the Scan page.** Open someone
  whose circle scan didn't finish and a line by their name says which page it stopped after, with
  Resume right there; their scan box now reads Scan in progress, with Resume from page N as its main
  button, instead of Cluster active. The card's Insights offer Resume for them too, not a scan that
  reads the list again from page 1, and an empty circle in Bridge Chains whose scan stopped partway
  says so, with Resume from page N, instead of saying their list has been read. On the Scan page, everyone stopped partway is in a new In progress
  card right after step 4, with Resume for each person and Resume all, and each name opens their circle
  on the map. It used to be folded away under Fine-tune the scanner.
- **The tabs sit on the header's line, and the notch hangs from them.** On a computer the row of
  tabs rests on the line under the header, so a page's own buttons in the notch below join onto
  it. The header is the same height on every tab: the Pending count that added a row on Degrees
  and Separation is gone (sent requests are still under Outlink → Pending).
- **Separation starts with its slider.** The line counting people two steps away and the tier
  strip under it are gone; the search box stays at the top.
- **The notch comes with the page.** Switching tabs, it waits for the next page to appear instead
  of hanging over a blank screen while it loads.

### Fixed
- **A company called "Foods" or "Beverages" is in Retail, Consumer & Hospitality.** The word list
  had "food" and "beverage" but not the plurals, so a company like Northwind Foods took its
  industry from its people's headlines instead (tech, on a test network). Scores are worked out
  again once after the update, since a company's industry can change its estimate and your sector.
- **Scan dots are whole on Paths.** The dots along the header's line while a scan runs were cut in
  half above Paths' left panel; they also stop short of the tabs now that the tabs sit on the line.
- **The 3rd-degree dot in Degrees and Separation says why it can't be tapped.** It said "No one at
  3rd degree yet" even with people found by company scans; it now says those are drawn on Network
  Circle.
- **The ring round a scanned connection's dot shows how much of their list was read.** It showed 2
  of 5 bars, "partly read", for everyone scanned, even when their whole list was in, and the card's
  Insights offered to finish lists that were finished. The app now takes in how far each list was
  read, which the scanner had been noting all along.

## [0.7.0] - 2026-10-03

### Added
- **Download for Mac shows how to open it the first time.** On sixgree.com, clicking Download
  for Mac now shows the three steps right under the button: drag it into Applications, close
  macOS's warning, and allow it once in System Settings → Privacy & Security. They used to be only
  on the Download page.
- **Watch a circle fill in while it's scanned.** While the scanner reads who your connections know,
  step 4 on the Scan page has a Watch it fill in link to that person's circle in Bridge Chains,
  which fills in as the scanner saves every 10 pages, during a whole round too, not only a scan of
  one person.
- **An "I understand" before the first scan**: the Scan page says once, plainly, that scanning runs
  your own LinkedIn account automatically, that LinkedIn may restrict accounts that do this (the safe
  limits of 50 searches a day and 250 a month stay on), and that nothing leaves your computer. Nothing
  opens LinkedIn until you click I understand, whichever button asks, and the CSV import is one click
  away instead. It's asked once and kept with your settings; anyone who has scanned before isn't asked.
  The welcome screen's Scan card says the risk too, and the README and website say Six Degrees is not
  affiliated with or endorsed by LinkedIn.
- **Light looks, and every look its own all the way through** (Settings → Appearance). Daylight and
  Paper are light, designed for it: ink words, white cards and panels, deeper dots that read on
  white. Pick any light background in the editor and the words and borders turn dark with it. Each
  look now changes more than its colours: its buttons (soft, flat, square, glass, neon or bold), its
  words (Obsidian's greys, a data terminal's for Analyst, brighter ones on Glass), its cards,
  pickers, tooltips and notch, the sliders, and how the map draws its dots (glass droplets, flat
  like Obsidian, or glowing). Both are yours to pick in the editor too.
- **Analyst is an analysis tool's look**: a bare white canvas and flat grey panels, plain outlined
  dots in colour-blind-safe colours with black labels, thin grey lines, flat blue for what's picked,
  no gradients, glows or shadows, and every number in even columns. Less on screen, more about the
  numbers.
- **A look's dots and panels everywhere, not just on the map.** Glass droplets, glowing dots, plain
  outlined dots or flat ones now follow a look into Degrees (bridges, clusters, the hover preview),
  Separation, Paths' bubbles, the Scan cluster, circle previews, the header's scan dots, legends,
  tier dots and avatars. Each look also has its own side panels, tab bar, notch and map tooltips:
  graphite with fine borders (Obsidian), neon edges (Synthwave), a cool rim (Space), hard outlines
  (High contrast), soft shadows (Daylight), ruled and warm (Paper), grey hairlines (Analyst), glass
  (Glass).
- **Glass is Apple's Liquid Glass.** Panels of dark glass that keep their words readable, with a lit
  rim and a bright top edge, and edges that bend what's behind them the way Apple's glass does. The
  tabs sit in one glass capsule; buttons are glass capsules that spring when pressed. With Reduce
  Transparency on, the panels go solid.
- **Bridge Chains: hovering a bridge grows its circle.** Their people shoot out of the bridge to
  their places, then anyone among them whose own circle is scanned sprouts it (3rd degree), then
  theirs (4th), in under half a second.
- **↻ Check for new forms a cluster.** Hover it and a ring of dots builds round it clockwise, the
  way a connection's circle forms on the map; while it checks, the ring keeps building, round and
  round, in the look's colours, and the button stays lit. The same on the Scan page.
- **Scan: the radar is a cluster that grows with every page.** While a scan runs, the people each
  page finds gather round the Scan button as dots, ring by ring, each page's batch in the next of
  the theme's colours (the same as the header's dots), the newest glowing.
- **Backups that look after themselves, photos and all.** Six Degrees now backs up your whole
  network once a day while it's open (when it starts, and after a scan, if the last one is a day
  old), before a new version first opens it, and whenever you click **Back up now** in Settings →
  Your data. Each backup holds your connections, their profile photos, your settings and the
  scanner's progress, and is checked as it's made, the same way a restore would check it. Settings
  says "Last backup: <time>, verified", or plainly what's wrong if a backup ever fails its check.
  It keeps the last 7 daily backups, 3 from before new versions and 3 from before an import or a
  restore (each of those for at least 30 days); ones you make yourself stay until you delete them.
  The Social tab's messages and notes are never in a backup, so deleting them there deletes them
  everywhere.
- **Restore any backup, from Settings.** Each backup has **Restore** and **Show in Finder**.
  Restore checks it, then puts it back when Six Degrees restarts (**Restart now** in the Mac app),
  keeping what was there first so you can go back again. Undoing an import is now one click on
  the backup it kept, instead of moving files by hand.
- **Your look and your saved Galaxy layouts travel with your network**: they're kept with your
  settings, so a backup, a restore or a move to another computer brings them along.
- **Settings → LinkedIn usage: how close your account is to the line, at a glance.** A status pill
  (well within, above the default, risky, too close, or paused) and four bars: searches in the last
  24 hours, marked at 50 (the default), 100 (risky) and 373 (where a real account was restricted),
  with when the next one frees and when you're all clear; searches this month, with when LinkedIn's
  month resets (midnight Pacific on the 1st) and the 250 to 350 people report for a free account
  shaded as a guide, not a fact; the last 7 days against Auto scan's 200; and profile views. Below
  them: your speed and searches in the last hour, about how many people you can still map, the last
  time LinkedIn pushed back (its time and reason, even after you lift the pause), Auto scan's own
  rules, and a plain warning with *Back to 50 a day, 250 a month* when it matters. Every number is
  counted from what Six Degrees wrote down on this computer, and says so. The notch's budget and the
  Scan page's budget box link to it.

### Changed
- **A LinkedIn CSV import is kept until you remove it.** Close the window or restart the app and
  your imported network is still there; it used to be gone with the window. It's kept on this
  computer, in your data folder (`csv-network.json`), apart from any network you scan, and only
  what the map needs (names, positions, companies, profile links, when you connected; never email
  addresses). Click × beside *Your CSV* to remove it; it asks first, and your `Connections.csv`
  isn't touched. *Save a copy of my network* carries it to another computer and an import brings
  it back. If the kept file can't be read, the welcome screen says so instead of acting as if
  there were none. The welcome screen's CSV card says where it's kept. Once you've scanned your own
  connections, every page shows your scan instead; the CSV stays kept, and the import page says so
  with a button to remove it.
- **Google Chrome is part of getting ready.** Step 1 on the Scan page isn't done until Chrome is on
  your computer, and offers Install Google Chrome, then come back; it ticks by itself once Chrome is
  there. Open LinkedIn waits for it, nothing that opens LinkedIn starts without it (every button
  gets the same one-sentence reason), and the welcome screen's Scan card says it needs Chrome.
- **Honest about how long scanning takes.** The Scan page says your galaxy takes three steps and who
  they know fills in over days. Step 4 says the first circle shows up in about 5 minutes (longer at
  Medium or Slow) and why the rest takes days: every page is a LinkedIn search, and your budget caps
  a day's.
- **Your field is asked after your connections are in**, under "Your galaxy is ready", instead of
  before the first scan, and picking one rescores everyone straight away. Anyone with only their own
  connections mapped who never answered is asked once; skipping counts as an answer.
- **Sign in to LinkedIn with Google or Apple?** Step 2 now says what to do: set a LinkedIn password
  first (Forgot password on LinkedIn's sign-in page emails you a link to make one), since Google and
  Apple sign-in can't work in the scanner's window.
- **A saved Galaxy picture or video credits sixgree.com** in its corner, instead of the app's
  name, so anyone it's shared with knows where to get it.
- **Bridge Chains: the inner ring holds the circles with the most going on**: notifications about
  them (new ones count double), people in them ready to scan, and clusters formed from them since.
  A circle's tooltip says how many notifications are about it.
- **Separation fits the whole map in the window, and keeps fitting**: whatever the map shows, as the
  slider moves or you aim at someone else, it fits again and glides there, list and all. − Fit +
  at the right of its caption zooms in or out (as far as 15%) until the view changes.
- **Bridge Chains' legends are just dots**, no box: they fit whatever font a look uses.
- **Bridge Chains: the badge at a bridge's top right counts their circle's news**: new notifications
  about it (gold) and people in it ready to scan (green), as asked for on 10/2; it counted only the
  people ready before.
- **Settings → Your data says Export backup file… and Restore from a file…** instead of "Save a
  copy of my network" and "Choose a file… / Import". They do the same: one file to carry your
  network to another computer, and putting one back.

### Fixed
- **Auto scan rests two days after any check from LinkedIn, as the Scan page says.** A pushback
  partway through reading someone's list used to rest it one day, like a scan you start yourself;
  only a check at the start of a run got the two days.
- **"Signed in" means signed in.** Step 2 used to tick as soon as the scanner's Chrome window had
  opened once, even if you closed it without signing in. Now it ticks once the scanner has seen you
  signed in. Anyone already signed in before this stays signed in.
- **Degrees says the right thing before who they know is mapped.** With no 2nd degree yet, it told
  everyone LinkedIn's CSV can't have circles, scanner users included. Now someone who scanned is
  pointed to step 4 on the Scan page; a CSV import gets the CSV reason, as before.
- **Words on screen read plainly**: no em dashes anywhere the app shows text (pages, notices,
  notifications, error messages), and a test keeps it that way. The Scan page's old "Checking for
  updates has moved" note is gone. Two messages written for developers now say what anyone can do: a
  copy missing its scanner says to download it again, and a page that can't reach the app says to
  quit and reopen it. The download size reads "about 210 MB" everywhere (the Mac downloads are 204
  and 212 MB).
- **The Social tab says truly where its messages and notes go**: never into Six Degrees' own
  backups, and into an exported backup file only with its Social tab box ticked. It used to say
  they were never in a copy, which wasn't so when that box was ticked.
- **Copies kept before an import no longer pile up forever**: the newest 3 stay, and none goes
  before it's 30 days old.
- **The budget says "the last 24 hours", because that's what it counts.** The notch said "searches
  today" and the Scan page "searches left today" (and "profile views today"), but the budget has
  always counted a rolling 24 hours, not since midnight. They now say so.

## [0.6.0] - 2026-10-03

### Added
- **Themes** (Settings → Appearance). Seven looks: Standard, High contrast, Obsidian, Glass,
  Analyst, Space and Synthwave, each with a small preview of the map in its colours. Then make it
  yours: the background and a second colour, a backdrop behind everything (stars, a grid, a glow,
  a sunset horizon), the accent, each tier's dot and your own, the map's lines (in the colour of
  the person they lead to, or one colour), how see-through the side panels are, and the font.
  Everything changes as you go, on every page, and stays in this browser. Copy a theme code to
  share a look; pasting one only ever sets colours and choices.
- **Clusters, the way Obsidian draws a graph** (Network Circle → Filters → Layout → Clusters). Your
  network as one round disc: each connection with a scanned circle is a big hub with their circle
  around them, and everyone is sized by their lines. Someone in several circles is linked to each
  of them, so they sit between those hubs and tie them together. The forces have Obsidian's names,
  Center force, Repel force, Link force and Link distance, each saying what it does to your
  network. Names fade as you zoom out, all but the hubs'. Picking a layout fits everyone on screen,
  and so does ⤢ Fit.
- **Orbit** (Filters → Forces): sets the whole map turning round you, every circle with it, so
  nothing loses its shape. Still under Reduce Motion.
- **Dots along the header's line while a scan runs**: one for each page the scanner reads,
  collecting from the left, on every tab. A click opens the Scan page.

### Changed
- **The same header on every tab.** The tabs sit in the exact middle of the window, and Settings,
  notifications, ↻ Check for new and your level are on Paths, Outlink and Scan too. A notification
  picked on another tab opens on the map.
- **Separation fits a laptop's window.** The header is slimmer: the search sits in the title's row,
  the tier line stays without the sentence under it (it's the title's tooltip now), Only show sits
  beside the tiers, the pill saying where the slider is sits over its middle, and the long
  explanations moved into tooltips. The cards are packed a little closer, so the whole map, ten
  people and every way in, shows at once in the app's normal window wherever the slider is.
- **The Scan page shows every step at once**, down a line: Get ready, Sign in, Who you know, Who
  they know, each with its label, what it does and its one button, marked Done, Now or Next. The
  line turns green as each is done, so it's plain what's finished and what's left; no more tapping
  dots to see a step.
- **↻ Check for new**, in words, in the map's header (it was a bare ↻): the same name as the Scan
  page's button, for checking your LinkedIn for new connections in one click.

### Fixed
- **Separation's tiers choose who's ranked, not who leads to them.** Hiding a tier in Filters also
  hid your connections of that tier (the purple A-tier lines), so the people they lead to lost a
  way in. In Separation every connection now stays a way in, whatever its tier.
- The level in the round button at the top right matches the Profile page's: it left out C and D
  tiers and catalysts, so it read lower.

## [0.5.1-beta.1] - 2026-10-02 (beta: a pre-release, never installed automatically)

### Added
- **Six Degrees for Windows and Linux (beta).** The same app as on the Mac, with the scanner's
  own Python inside, so nothing needs installing before a scan. **Windows:**
  *Six-Degrees-Windows-Setup.exe* installs it for you with one click (no admin rights), with Start
  Menu and Desktop shortcuts, and opens it; running a newer one over it updates it. It isn't
  signed yet, so SmartScreen may ask the first time (*More info → Run anyway*). **Linux:** a
  `.deb` (`sudo apt install ./Six-Degrees-Linux-x64.deb`) or a `.tar.gz`. Scanning needs Google
  Chrome on both. Your network stays in your home folder's `.six-degrees`, as on the Mac;
  uninstalling never touches it. Settings → Updates points to the new installer there.

### Fixed
- On Windows the scanner would have stopped after its first batch: its progress lines
  ("→") can't be written in Windows' default text encoding. Its Python now always writes UTF-8.

## [0.5.0] - 2026-10-02

### Added
- **Rank titles your way** (Settings → Scores → Titles). Set how much each kind of title counts, out
  of 10, or start from a preset: Founders first, Investors, or A role I'm looking for. Add the roles
  you're after ("account executive", "head of growth", "recruiter") with their own points, and
  everyone whose title has those words rises, whatever their level: for outbound to one role, or
  hiring for it. Saving rescores everyone and says how many people changed tier, and a card's score
  says "your ranking" where it moved a title. Nothing set scores exactly as before.

### Changed
- **The Scan page is a launch, not a manual.** It opens with what the scanner is and what it never does
  (never posts or messages anyone, never sees your password, nothing leaves this Mac, stops when you
  say), then the four steps on a rail: Get ready, Sign in, Who you know, Who they know. The one
  you're on pulses, with one big button that does it and how long it takes; any other opens with a
  tap. While it runs, "Your scanner is working" and Stop sit right under the step. How many people
  this round and who first are beside the radar; the daily budget, how much of each list, the hidden
  window, retrying hidden lists and paused lists are in Fine-tune, closed until you want them. The
  log is one tap away, and opens by itself when a run stops badly. Scan has the same header as every
  page now.
- **Paths reads like Network Circle.** Its notch is now Map and Companies: companies count for more
  than industries, and an industry opens from a company's card (its industry is a link there). Whether
  the map's bubbles are companies or your connections (what was the People tab) is a switch at the
  top of the Filters panel. Filters use the same tiers × degrees grid as Network Circle. Colour is by
  sector or by **Heat**: for companies, how strong your people there are (the average power of the
  five strongest); for people, how strong their cluster is, person for person; size still says how
  many. And **Physics**: switch it to Live to drag bubbles (the ones joined to them follow) and change
  Spread, Pull to their group and Pull along lines. Still, as before, is the default. Old links to
  the People or Industries tab still land on the map.
- **Heat: power as a thermal map.** A new Colour by in Network Circle's Physics: every dot coloured
  from cold violet through red and orange to white hot by where their power score ranks among the
  people showing, with a soft glow behind the hotter ones that pools where powerful people cluster,
  like a thermal camera. Works with every layout, the replay and the filter grid.
- **Separation all the way right counts every mutual, scanned or not.** It aims at whoever you share
  the most mutual connections with, even when most of them are in circles you haven't scanned: an
  unscanned mutual is still a likely introduction, so it no longer holds someone back. The ones the
  app can draw are lines as before; the rest are grey dots, each with a faint line in, with "+37 more
  mutuals, in circles not scanned yet". The person glows less the less of it is scanned. The Next
  names are in the same order and say their mutual counts. Narrow the tiers (S only, say) first to
  aim at the strongest.
- **The right panel follows the circle you're in.** Open someone's circle in Bridge Chains and the
  panel is about them: how many people are in their circle, tier chips to see just one tier, a
  search inside it, the people you added from it (with Scan… for the ones ready), then everyone
  else in it, strongest first. Click anyone for their card.
- **Orbit is a layout of the Galaxy now**, in Physics next to Rings and Clusters, not a separate
  view: every tier held on its own orbit, S nearest you, and each connection's circle tucked in
  behind them. It's still the Galaxy, so you can drag dots and move every slider on it.
- **Light up a branch on hover starts off.** It dimmed and relit thousands of dots on every hover,
  which flickered; it's still in Physics if you want it, and moving from one dot to the next no
  longer flashes the whole Galaxy in between.
- **Social is part of Outlink.** Outlink has the same header as every page, and its views sit in
  the notch: Circles, To add, Pending, and Messages & follow-ups, which is the whole Social tab (your
  LinkedIn export, the live messages sync, the CRM with its inbox, follow-ups, pipeline, sent and
  received). Adding people and keeping track of them are now one place. The Social tab is gone from
  the header, and old links to it land on Messages & follow-ups.
- **Notifications open.** Click one and it takes over the right panel with the detail: who it is
  about, their tier and score, who you met them through, and, for an S or A, that they're a
  valuable person to know; with buttons to open their card, their circle in Bridge Chains, or
  them in Separation. A notification naming several people lists them all.
- **New notifications:** someone you met through a bridge added you back ("Ana added you back,
  through Yuki"); a circle scan found people at top companies (a company score of 8 or more), named
  in one notification; and a scan finished ("Scan done: Yuki's circle", "Check for new: done").
  Accepted requests and high-value new connections now say who they are about, and older ones are
  matched by the name in their title.
- **Paths has the same header as the map.** The app's tabs stay at the top, with Paths lit, and Map,
  People, Industries and Companies sit in the notch under them, as the map page's views do; a tab
  for Network Circle, Degrees or Separation takes you straight to it. Paths' filters moved into a
  Filters panel on the left, like the map page's, with new ways to read the map: what a bubble's
  size means (your people there, the S and A among them, or the ones you already know; on People,
  cluster value, size or S tier) and which names show (the biggest, all, or none).
- **All the way to easy, Separation aims at whoever the most of your connections lead to**, with
  every one of those lines drawn, the strongest first among equals; the "Next" names are the
  runners-up by the same measure. It used to aim at the top of the list, which could be someone
  with many mutual connections by LinkedIn's count but only one the app could draw.
- **The Scan page has a radar, and a speed: Slow, Medium or Fast.** Mapping the 2nd degree starts
  from a round Scan button in the middle of a radar: its sweep turns while a scan runs, and the
  ring round it fills with today's searches against your budget. Beside it, three speeds. Fast is
  how the scanner has always run, and nothing is faster; Medium waits 45 seconds before each page
  of results and 3 minutes after every 10, Slow 90 seconds and 5 minutes, and both keep profiles
  further apart (90 and 120 seconds). Each says about how many searches an hour it makes and how
  long the rest of today's budget would take. The daily budget stays the cap at every speed:
  slower spreads it out, it doesn't shrink it. The speed is saved with the budget and the scanner
  says which it is using at the start of every run; the Scan page's time estimates follow it.
- **Scores moved into Settings.** Your field, how tiers are graded and every company's score are a
  Scores section in Settings (the gear), and the Scores tab is gone from the header. Old links to
  the Scores tab land in the same place in Settings.
- **Profile has Insights.** An Insights button beside Profile shows network health: how much of
  your 2nd degree you reach two or more ways, the effective reach of your connections, and the
  connections who reach the most people no one else does. It was at the top of the Scores tab.
- **Paths → People.** A new view beside the company map, drawn the same way but with your
  connections as the bubbles: each is sized by the value of the cluster behind them (S tier counts
  3, A tier 2, everyone else 1; or by cluster size, or by S tier inside), coloured by their sector
  and grouped like the companies. A white centre is the share of their cluster you can only reach
  through them, a gold ring means S-tier people inside, and a line joins two connections whose
  clusters share people. Point at someone for their numbers and how their cluster compares to the
  rest you've scanned; click to open it in Bridge Chains. Shows the connections you've scanned,
  or all of them, with the ones not scanned yet as small grey dots.
- **Separation's map draws connections as pills and people as cards** on a computer (a phone keeps
  the dots). Each connection shows their initials, tier and what they are to the people on the
  map: the only door to someone, the best way in for some, or only another way in; the ones with
  a solid line are lit. Each person is a card with rank, role, score and how many ways in. With
  the slider all the way to easy, the one person becomes a large card with LinkedIn's mutual
  count and how many of those are drawn. Everything still glides as the slider moves.
- **Separation's list is a ledger.** A title bar says how many are shown and that the order
  follows the slider. The way in shows the connection's face with "only way in" or how many more
  ways there are under it, a new column shows how rare the way in is as a bar (full and cyan for
  one door, short and orange for the warmest), and the power score sits beside its bar.
- **Separation is a tab of its own**, beside Degrees in the header, instead of a view inside
  Degrees. It uses the same Filters grid as Degrees. Degrees keeps Bridge Chains, Pyramid and List.
- **Separation has a slider.** One slider reorders everyone as you drag it: the rarest ways in
  at one end (strong people only one of your connections knows), the easiest at the other
  (strong people you share the most mutual connections with), and each person's own score alone
  in the middle, as the list has always been. A line under it says in words what it is
  surfacing. It only reorders: scores, tiers and ranks stay as they are, and it claims no odds.
  Double-click the slider, or tap 50, to go back to the middle. It replaces the Power / Ways in
  switch. The tier chips and the rarity chips ("Only show") sit in the same card.
- **Separation's map follows the slider, and glides.** From the rare end to the middle it fans out
  to ten people, each with the one or two doors that lead to them. Towards the easy end it
  closes in on fewer people, and at the end on one: the person you're aiming at, with rings
  round them and every connection of yours who leads to them drawn in, the top-scored one solid.
  As the slider moves, people, connections and lines slide to their new places and newcomers
  fade in (still, with Reduce Motion on). Pick anyone in the list, or one of the "Next" names
  under the map, to aim at them instead. Beside each name it says how many mutual connections
  lead to them: "only way in", "3 ways in", or, where LinkedIn's own count is higher than the
  connections the app can draw, "37 mutuals · 6 mapped".
- **Path, in Separation.** A Path button beside the tier chips narrows everyone to one sector or
  one company. The picker opens under the button with the sectors (inferred, as in Paths), the
  biggest companies and a box to type in, and goes away once you've picked; the button then
  shows your pick with a × to clear it.
- **Separation's heading no longer sits under the notch.**
- **One filter for tiers and degrees, the same in Network Circle and in Degrees.** The Filters
  panel shows the five tiers as bigger rows, each with six dots, one for each degree. Tap a tier
  to hide or show it, as before. Tap a dot to show or hide that degree for that tier alone:
  S tier at 2nd degree without everyone else's, say. Tap a number at the top to switch a degree
  for every tier at once. A dot with nobody behind it is faint and can't be tapped, each row
  says how many people it is showing, and the last people on screen can't be switched off.
  Network Circle starts with your own connections; Degrees starts with everything. In Degrees
  the rows used to pick one bridge tier at a time; now 1st degree is your bridges and 2nd is
  the people in their circles, each by their own tier.
- **The Galaxy's physics is the main thing in Network Circle's Filters panel.** The sliders,
  layouts, colours, find and replay sit straight in the panel under the tiers, always on, with
  no switch to turn on first and no "experimental" box. With no slider moved the Galaxy is laid
  out as before; pointing at a dot now lights up its branch unless you turn that off.
- **Pyramid and List left Network Circle.** Its views are the Galaxy and Orbit. Pyramid and List
  stay in Degrees.
- **An opened circle shows the chains that lead on from it.** Anyone you added from that circle
  and then scanned keeps their dot in the circle, and the cluster their scan formed sits outside
  it, joined to that dot by a line, so you can see where each path came from. Inside a cluster,
  anyone you added and scanned in turn has their own dot marked and a line on to their cluster,
  for as far as your scans reach. Every dot in a cluster is joined to its middle by a faint line.
  Each cluster says whose circle it is, how many are in it and which degree that is. Point at
  one and the way back to the middle lights up; click and it opens with the whole trail. The
  people you added sit together on the side the chains lead off to, their names taking turns
  above and below so they don't overlap, and the view zooms to fit when it opens.
- **Bridge Chains shows the bridges you connected with yourself.** Someone you met through a
  bridge's circle is a link in that bridge's chain, not a bridge of their own: they're inside its
  circle.
- **A bridge's ring now counts the people you added through it.** The ring sits tight on the
  dot, with one bar for each person: orange once they've been scanned and have a cluster of
  their own, green while they're ready for a scan. A small green number at the top right says
  how many are ready, in place of the "ready" label. How much of a bridge's own list is scanned
  is in its tooltip.
- **A crowded Bridge Chains is easier to read.** When your bridges need more than one ring, the
  rings sit further apart, each with its own guide line, and the counts under each name wait
  until you point at the bridge.
- **Orbit moved to Network Circle.** It shows the size of every circle at once, which is a
  picture of the network, not a way to follow a chain. The corner switch in Degrees is gone.
- **Views are in the notch, under the tabs.** Galaxy, Orbit, Pyramid and List in Network Circle,
  and Bridge Chains, Separation, Pyramid and List in Degrees, switch from the notch that hangs
  under the top tabs, instead of a list at the top of the Filters panel. A scan's progress
  shows in the same notch, beside them. The Filters panel now only filters.

### Fixed
- The scanner's log, shown on the Scan page, says "scanning" throughout; a few lines still said the
  old word.
- The "Scanning…" dot in the right panel pulses again; the animation it named was never defined.
- **Separation's map lines now meet every box.** Each connection sits level with the people it
  leads to, so a connection with one person is on that person's row and the line between them runs
  straight; lines start and end exactly on the pill and the card, with a small dot where they plug in.
- **"Hide the Chrome window while scanning" did nothing for scans started on the Scan page.**
  Its own buttons (Scan, Check for new, Auto scan and the rest) sent their request without the
  setting, so Chrome opened anyway; only scans started from a person's card or Resume were hidden.
  Every scan start now goes through one place that adds it.
- **"Only way in" could show beside someone with two ways in drawn.** Rarity trusted the mutual
  count a scan saved even when the app had since found them through more of your connections
  than that. It now takes whichever is larger.

## [0.4.11] - 2026-09-29

### Added
- **The Social tab is a personal CRM.** Everyone you've been in touch with on LinkedIn is one contact,
  connection or not: a list on the left with views and a search box, the person on the right (stacked
  on a phone). The views:
  - **Inbox:** they wrote last, or there's something unread. Unread first.
  - **Awaiting reply:** you wrote last and nothing came back for 7 days or more (you can change the 7).
  - **Follow-ups due:** a follow-up date of today or before.
  - **Pipeline:** a board of the people you've given a stage.
  - **Sent:** connection requests you sent (from your export's Invitations.csv, with the date, and the
    note you wrote if Keep my messages is on), requests the app tracked (*Mark sent*), each accepted
    once they're a connection and pending until then, and messages awaiting a reply.
  - **Received:** requests to you from people who aren't connections yet.
  - **All:** everyone and every group conversation, newest first.

  Each person's panel shows their tier, company and how you're connected (and who can introduce you,
  for 2nd degree), their conversations (the messages themselves if you keep them), requests both ways,
  and **your own stage** (New, Contacted, Replied, Meeting, Won/Partner, Not now; it suggests one),
  **tags**, **notes** and **next follow-up date**. Those are yours, so they're always kept, in a file of
  their own per profile in the app's data folder, and never sent anywhere. Search covers names,
  companies, tags and notes, and what was said while the messages are kept; in All it finds anyone in
  your network, so you can add a note before you've written to them. **Export CSV** saves the table
  (name, company, profile, connection, stage, tags, last contact, who wrote last, next follow-up,
  notes) as a spreadsheet file. The list shows 100 at a time, so thousands of conversations stay quick.
- **Every conversation in your export, not just your connections'.** People who aren't connections
  are listed by the name the export gives them, marked *Not a connection*, with their profile link when
  it has one. Past (archived), current and ones only you wrote in are all there, from every folder;
  group conversations are listed and marked; Sponsored Messages and InMails are marked, and adverts are
  kept out of the Inbox. Unsent drafts are left out and said so.
- **Read my whole history**, beside *Sync messages now*: the live messages sync keeps scrolling your
  messages list until no new conversations load (at most 60 scrolls, about 1,000 conversations), at the
  same slow, fixed pace, with no random waits. The daily sync still reads just the top. The sync now
  also brings in people who aren't your connections (with their name) and group conversations (without
  any words), and each sync adds to what earlier ones found instead of replacing it.
- **Delete my CRM notes**, and *Forget it* asks, separately, whether to delete them too, so notes
  aren't lost by accident.

### Changed
- **"Save a copy of my network" carries the Social tab too.** A new box, ticked by default,
  adds its findings, your CRM stages, tags, notes and follow-ups, and any messages you keep,
  so moving to a new computer brings everything. Importing the copy puts them in place and
  keeps this computer's beside the old network. Untick it to leave them behind.
- **Waiting on you has become the CRM's Inbox**, and Conversations is part of the CRM.
- **The Social tab keeps the names of people who aren't your connections**, from your export and the
  sync, since nothing else in the app says who they are. A connection's name still isn't copied: the
  app has it already.

## [0.4.10] - 2026-09-29

### Changed
- **The scan status bar is now a notch.** A small pill hangs from the bottom of the header,
  centred, on every page. It shows nothing while nothing runs, only a tiny dimmed *Auto scan*
  while the all-day mode waits, and while a scan runs, what it's doing with a thin progress
  line. Hover or click to open it: who, today's searches, the latest line, *Details* and
  *Stop*. Other long jobs show there too, starting with recording the Galaxy's replay.

## [0.4.9] - 2026-09-29

### Added
- **Conversations, in the Social tab.** Every conversation with one of your connections, from your
  export and the live messages sync: who it's with (name and tier), when it was last active, who
  wrote last, unread, how many messages, and *Open on LinkedIn* (the thread when the sync found
  its link, else their profile). Waiting on you comes first, then S and A tier, then the most
  recent. Group conversations are shown and marked, and aren't counted in warmth. A search box
  finds people by name.
- **Keep my messages on this computer**, a switch that's off unless you turn it on. When it's on,
  the messages themselves, what other people wrote to you included, are kept in the app's data
  folder (a file of their own beside the Social tab's), and a conversation opens as a thread,
  newest at the bottom, a page at a time so a thread of thousands opens as fast as a short one.
  The search box then finds what was said, too. They're never sent anywhere, and "Save a copy of
  my network" doesn't carry them (Settings says so). Switching it off asks first, then deletes
  them; *Forget it* deletes them with everything else.
- **The live messages sync reads a little more of the list.** Each conversation's link, whether
  it's a group, and its newest message: who wrote last, which now feeds warmth and Waiting on you
  where your export is missing or older, and its words, which go to the app only while Keep my
  messages is on. It still opens no conversation, and its saved samples still keep no words.

### Changed
- **Auto scan is slower and has its own ceilings.** Sittings of 8 pages, then an hour's rest;
  searches only from 9:00 to 18:00; never more than 40 searches in 24 hours or 200 in 7 days,
  however high the daily budget is set (the account restricted on 28 September did 373 in a
  day with the budget at 500); and two days with no searches after any check from LinkedIn.
- **The scan status bar sits under the buttons.** On each page it now sits in its own row
  under the header, pushing the page down instead of covering it. On Network Circle it floats
  just under the header, measured, so a header that wraps to two rows no longer hides it.

### Fixed
- **The live messages sync keeps what it finds.** It read your conversations but matched none of
  them: the pattern for a profile link never matched, and LinkedIn's messaging gives a member
  link your connections list doesn't have. It now matches each person to your connections by
  link, or by a name only one connection has (the name isn't kept), and scrolls the list's own
  panel so more than the first 20 conversations load.
- **Messaging samples keep no words.** The sync's saved samples of LinkedIn's data (for tuning
  the reader) now drop every piece of writing and every name before they're saved.

## [0.4.8] - 2026-09-29

### Changed
- **A new icon.** A 6 drawn in one gold line around you, a glowing core, ending in a degree
  ring, with your tier rings fading behind it. It's the app's icon, the favicon and the
  website's.
- **The website is a proper site now, and the README matches.** The home page tells one story,
  feature by feature, each with a real screenshot of the invented sample network: see your
  network, find your way in, know your network, watch it grow, and scan carefully, then privacy,
  a fair comparison with LinkedIn's own search, spreadsheets and CRMs, and SocNetV and Gephi,
  and a strip of true, checkable numbers. It has one download button, for your computer: the Mac
  download on a Mac, and on Linux and Windows a dimmed *Coming soon* button, never a link, with
  `npx six-degrees` offered on Linux. New pages: **/download/** (every platform, install steps,
  checksums, requirements, troubleshooting), **/docs/** (getting started, your data, privacy,
  questions), **/releases/** (every version in this changelog), **/blog/** with four posts on how
  it works, **/roadmap/** and **/about/**, with Atom feeds for the blog and releases and every
  page in the sitemap. `scripts/build-site.mjs` builds it all from `site/`, and the website's
  deploy runs it, so the news and numbers never go stale (`site/README.md` says how to add a
  post or a page). The README has badges, a download table for all three platforms, features,
  latest news and why Six Degrees.

### Fixed
- **Paths opens about 9× faster on a large network** (Map 19.8 s → 2.2 s, Industries 25.8 s →
  1.7 s, at 1,500 connections and 25,000 people in their circles). Each headline and company
  name is now read once, not once per pass: Paths read everyone's headline five or more times,
  and each read tries the whole company list. The same fix makes Scores open in under a
  second (was 11 s), and setting a company's score rescores everyone in a third of a second
  (was 6 s). Scores themselves are unchanged.
- **Opening a company's path to the top in Paths no longer hangs.** Every row compared itself
  with everyone at the company each time the page drew: at a company of 1,900 people that took
  minutes. It now opens in a fifth of a second, and a row works out what adding them would do
  only when you open it.

## [0.4.7] - 2026-09-29

### Added
- **Hide the Chrome window while scanning** (Scan page). Scans run with no window popping up;
  the status bar and Stop work as before, and signing in always opens the window. The Scan page
  says the risks: a hidden Chrome is easier for LinkedIn to tell from a person, and a check
  LinkedIn asks for (a code, a puzzle, signing in again) can't be seen, so the scan stops instead
  of waiting. Off by default.

## [0.4.6] - 2026-09-29

### Changed
- **The window's frame matches the app.** The title bar, menus and dialogs are dark by default,
  even when your Mac is set to Light, so the frame no longer shows as a pale bar above the dark
  app.

## [0.4.5] - 2026-09-29

### Added
- **Physics lab for the Galaxy (experimental, in Filters).** Sliders for the forces that lay the
  Galaxy out, in the spirit of Obsidian's graph: *Gravity* (a pull in towards you), *Rings* (how
  hard each tier holds its ring; at 0 the Galaxy finds its own shape), *Push*, *Pull* (how hard
  each person pulls the people who came through them) and *Distance*, plus dot size, line
  thickness, names, and dots sized by power score or by how many hang off them. *Clusters* sets
  it up so each connection bunches their circle round them. Hovering a dot lights up its branch,
  everyone behind it and the chain back to you. **Replay** plays your network growing by the
  date you connected, with a time slider; each circle arrives with its connection. Everything
  moves the Galaxy in place, and *Reset* puts today's layout back. The replay needs "connected
  on" dates, so the sample network has nothing to replay.
- **More in the physics lab.** *Colour by* tier, degree, company (the eight most common) or
  warmth (from the Social tab), with a legend to match. *Find* lights up everyone whose name,
  company or role matches and dims the rest; Enter flies to the best one and opens their card.
  The replay has a length (5 s to 1 min), *Loop*, your job starts and posts from the Social tab
  marked on its timeline, and the job you were at in its date. *Saved layouts* keep slider
  settings under a name. *Save a picture* makes a PNG of the Galaxy at twice the size, and
  *Record the replay* saves it as a video.
- **Names on or off** for the Galaxy, in Filters.

## [0.4.4] - 2026-09-29

### Added
- **Social (experimental): a tab for your relationships.** It works from your own LinkedIn data:
  - **Your export:** the folder LinkedIn emails you from *Settings → Data privacy → Get a copy
    of your data*, read in the app window with no traffic to LinkedIn.
  - **A live messages sync:** reads your messages list once in your own Chrome, by hand or once
    a day in the daytime, using no search budget.

  It shows:
  - how many of your connections are warm, cool, dormant or never messaged;
  - who's waiting on a reply (S and A tier first), or has unread messages;
  - your career chapters, with the connections made in each and how many you're still in
    touch with;
  - whether posting works (new connections the week after a post against a usual week);
  - how many connection requests came to you and how many you sent.

  Only dates, who wrote last and counts are kept, one file per profile in the data folder, and
  *Forget it* removes it. Message text is never kept. Email addresses are kept only if you tick
  the box. The live sync hasn't been tried on a live account yet.
- **Auto scan.** With the Scan page's experimental all-day box ticked, an *Auto scan* button sits
  beside Scan and starts the all-day Auto-Bridge with your Scan page choices. The status bar sits
  under the tabs, dimmed while it's ready, and lights up once it runs.
- **Insights on a connection's card.** A collapsible panel with their circle's size (*Explore →*
  opens it in Bridge Chains), how many only they reach, whose circle overlaps theirs most
  (*Open →*), the tier mix of their circle, where most of it works, how much is scanned (*Scan →*
  or *Finish →*), when you connected and how many requests you have out through them, and their
  rank by who only they reach. *Show them →* opens Separation filtered to the people only they
  reach, and *S only →* to the S-tier people in their circle. All from what the app already
  keeps. It replaces the *Only through …* box.
- **Network health on the Scores tab.** How much of your 2nd degree you reach two or more ways,
  the effective reach of your own network (Burt's effective size, from the ties between your
  connections that circle scans keep), and your five connections who reach the most people no
  one else does, each with *Explore →*. With fewer than five circles scanned it says it's an
  early estimate. Only your own numbers: never a percentile against other people.

## [0.4.3] - 2026-09-29

### Added
- **Experimental Auto-Bridge (a switch on the Scan page).** All-day pacing that stays openly
  slow: up to 10 pages in a sitting, then a 45-minute rest; searches only from 09:00 to 19:00 on
  this computer's clock; at the daily budget it waits for it to free up instead of stopping;
  and every page is saved as it's read. It also reads the data LinkedIn already sends for each
  page of results (no extra requests) beside the page text. That fills in headlines, photos and
  mutual counts the page text missed, and gives each list's real length for the scan bars. Each
  page logs how the two compare, and a few raw responses are kept in the data folder
  (`wire-samples/`) to tune it. People only LinkedIn's data shows are logged, not added. The
  timing is never randomised to look like a person. Not yet tried on a live account.
- **A status bar while a scan runs, on every page.** It shows what's running and for whom, how
  far it's got, today's LinkedIn searches against your daily budget (green, then amber past 60%,
  red past 90%), what the scanner is doing right now (for example the wait before the next
  profile), a link to the Scan page and Stop. Stop saves what was read, and Resume carries on
  from the same page. It sits just under the header's tabs, on every page, the Scan page too.

### Changed
- **Network Circle's tiers switch on and off.** In the Filter panel, click a tier to hide it or
  show it again, so C and D can go while S, A and B stay. *All* shows everyone. Degrees still
  picks one bridge tier at a time.
- **Orbit: the circles behind added people sit behind their bridge.** They're centred on the
  bridge's slice, side by side, with a line back to whoever they came through, wherever that
  person sits. Before, each was centred on that person and could spill into the next bridge's
  space.

## [0.4.2] - 2026-09-29

### Added
- **Orbit goes past 2nd degree.** Someone you added through a circle, whose own circle is
  scanned, now sits in the fan of the circle they came from, green-ringed, and their people fan
  out behind them a band further out, fainter, with a faint line to each. Their added people's
  circles go further out again, to 6th degree. Before, they sat on the ring as one more bridge,
  and Orbit showed only 2nd degree.
- **A ring round each connection's dot.** Five thin bars show how much of their circle is
  scanned: all five once their list is read to the end, and part-way the pages read against
  LinkedIn's own count of the list, which scans now keep (no extra traffic). Lists read before
  scans kept a count show two. A small badge counts the people in their circle ready to scan,
  and a catalyst is the green outline on the dot. It's on the Galaxy and on Bridge Chains'
  bridges.

### Changed
- **The Galaxy in bands when more than your connections are drawn.** With 2nd (or 3rd) degree
  on, your connections sit on a tighter inner ring, their circles in a band outside it, and past
  someone you added through a circle, their people further out again. Each band is sorted by
  tier, S nearest, and has a faint label. Lines follow the chain: from you to your connections,
  from each connection to their circle, and from someone you added to theirs. Your connections
  alone keep the roomier tier rings.

### Removed
- **The "N only here" line under each bridge in Bridge Chains.** Their card still says who is
  reached only through them.

## [0.4.1] - 2026-09-29

### Added
- **Which connections open the same doors.** A card says whose circle overlaps theirs most, when
  it's real (15% or more, and at least 3 people): "Opens the same doors as Tom: 62% of the
  people either reaches, both do". Bridge Chains' Degrees box adds how much of your 2nd degree
  you reach two or more ways.
- **Circle scans keep who among your connections knows whom.** Your own connections turn up in
  other people's lists, and were set aside there and forgotten. Each is now kept as a tie
  between the two, in a new table, with no extra LinkedIn traffic, since the scan read them
  anyway. Nothing shows them yet: they're what clusters and communities will be built from.
  Deleting someone deletes their ties too.
- **Who only one connection reaches.** In Bridge Chains, each connection with a scanned circle
  shows how many of its people none of your other connections reach ("746 only here"), and
  their card says it in a line: those people are reached through them alone. It's their
  exclusive reach, counted across every circle you've scanned (`lib/brokerage.js`).
- **Network Circle's Filter picks degrees.** *1st*, *2nd* and *3rd* chips choose who the
  Galaxy draws: your connections, anyone in a scanned circle, and anyone only a company scan
  found. Any mix works, and 2nd without 1st shows who's valuable outside your own
  connections. Each person counts once, at the nearest degree. Further out is drawn a little
  smaller and fainter, gathered near the connection whose circle they're in, and the tier
  counts follow what's drawn. It opens on your connections alone, as before.

### Changed
- **The Galaxy marks its tier bands.** A faint dashed ring, labelled S to D, sits where each
  tier's dots settle, so the bands read at a glance, most of all with a filter on. Not on a
  phone, whose layout has no rings.
- **Degrees opens on Bridge Chains,** then Separation, then Orbit, in the menu too. Orbit
  used to come first.
- **Orbit is in Degrees only.** Network Circle's Orbit was slow on a big network and showed
  nothing the Galaxy doesn't; a Network Circle left on it opens the Galaxy.
- **A new app icon: Orbits.** Your tier rings round you, with one bridge reaching out through
  them. It's the Mac app's icon, the website's tab icon and its home-screen icon.
- **The Scan page asks before a risky search budget.** Picking more than 100 searches a
  day, or no monthly cap, now asks first, because a real account was restricted after 373
  searches in 24 hours, run back to back (it had opened only 7 profiles that day). While
  the budget stays that high, a note under it says so, with a button back to 50 a day and
  250 a month. Lowering a budget, or anything up to 100 a day, is never asked about.

### Fixed
- **A card's circle map never draws a degree as a solid line.** A big circle, or the people
  behind someone you added packed into their slice, used to run together into one line or
  band. When a slice holds more than fit, its dots now take a few rows, neighbours
  alternating between them, each still behind whoever they hang off, and the dots are sized
  for the most crowded slice.
- **Bridge Chains: a hover preview no longer draws over the bridges.** With many bridges the
  overview grows extra rings, and a bridge's circle, previewed on hover, landed on top of
  them. It now starts beyond the outermost ring of bridges.
- **Stop during a re-map's wait keeps the circle.** Re-mapping someone deleted their circle
  first and then waited out the minute between profile views, so a Stop in that minute left
  it deleted and unread. It now waits first and deletes only once the read can start.
- **A profile-view cap typed into `scan-limits.json` by hand stays within the choices.** It
  counts as the largest offered choice under it (10, 25, 50 or 100), in the scanner and on
  the Scan page alike; before, 1,000 was honoured and the picker showed a different number.
- **The Filter menu highlights the view that's showing.** After *View Bridge →* from the
  Galaxy, Orbit showed but no view was highlighted.
- **No *Scan Full Company* on the sample or a CSV import.** Paths offered it there, and it
  searched LinkedIn for a network that isn't saved. A line says scanning needs your own network.

## [0.4.0] - 2026-09-28

### Added
- **A cap on profile views.** A circle scan opens the person's profile once, and profile
  views are what LinkedIn restricted an account for. They now have a cap of their own: 50
  in any 24 hours by default. The Scan page offers 10, 25, 50 or 100, and there is no "no
  limit".
  - **A minute apart:** at least 60 seconds pass between any two profile opens. It's timed
    from the last one written down, so scans started back to back can't open profiles back
    to back. The log counts down while it waits, and Stop ends the wait.
  - **Checked before the profile opens:** at the cap, a scan opens nothing and records
    nothing about that person. Auto-Bridge stops, as it does at the search budget, and the
    next run starts with the same person.
  - **On the Scan page:** "3 of 50 profile views today", with a bar and the picker.
  - **Re-mapping someone** checks it before deleting their circle. A damaged record counts
    the day's views as used. An import brings the other computer's setting only when this
    one has none, like the search budget.
- **The Scan page asks what field you're in, before your first scan.** One optional step,
  with the same picks as *Scores → Your sector*: tech, government and defense, dental, and
  the rest. Companies in your field count for more, so your first scores already use it.
  *Skip for now* carries on without one. Both stay at the bottom of the window while you
  look through the list. It's asked once, and never if you already have a network or picked
  a sector. Change it anytime on the Scores tab.
- **Bridge Chains opens any circle, as far as your scans reach.** Click someone in a
  bridge's circle and their own circle opens in place: the people found in it once you
  connected and scanned it (3rd degree, counted along the chain), and on from there. A
  trail at the top, and Esc, go back. An empty circle says why and what gets it: connect,
  then scan their circle. While one is being scanned, it fills in as the scan saves.
  Someone ready for a scan goes to the Scan page with them picked instead, since their
  circle is empty until then.
- **A soft glow on people ready for a scan.** In Bridge Chains, someone you added through
  a circle whose own circle isn't scanned yet has a soft breathing halo, and their bridge
  says how many are "ready". A hidden list is greyed with a lock instead. The halo stays
  still with Reduce Motion on. The old rainbow glow is gone: it looked for them inside the
  circle they came from, which accepting takes them out of, so it never showed.
- **Ready to scan (N), in the Degrees panel.** It replaces *Auto-Bridge Next*, which
  started a scan in one click, by name, with no cost shown, and offered hidden lists again
  and again. The list is everyone you added through a circle whose circle can be scanned,
  strongest first, with the circle you found them in and what a scan costs. Hidden lists
  stay in view, greyed with a lock.
- **Scan one circle, on the Scan page.** A ready person, from the list or Bridge Chains,
  opens the Scan page with them picked: the cost (a profile view, then a search a page, up
  to 100), what's left of the day's budget, how deep to read, and a button. Nothing starts
  until it's pressed.
- **A release checks the website's version lines.** Before building anything, the release
  workflow runs `scripts/check-site-version.mjs`: the site's `softwareVersion` and
  `llms.txt` must name the version, and its `dateModified` and sitemap `lastmod` can't be
  older than the release's date in the changelog. A stale site stops the release with a
  line for each thing to change. A pre-release skips it. Anyone can run it before tagging.

### Changed
- **A big circle spreads out.** A bridge's circle used to sit on one ring, so a few hundred
  people were almost a solid line. It now fills rings from the inside out, as many as it
  needs, with the highest tiers nearest the middle; drag to move, scroll or +/− to zoom.
  Lots of bridges spread the same way, and so does the preview on hover.
- **The map picks up a finished scan by itself.** No refresh needed.
- **One rule for "ready".** Bridge Chains, the Degrees panel, Outlink's new doors and the
  profile page's mapping bar now agree on who can be scanned next, and all leave hidden
  lists out.
- **Photos stay on your Mac.** The app shows a profile photo only from the copy saved on
  your computer, so looking at your network never contacts LinkedIn. It used to load a
  photo from LinkedIn until a scan had saved it, and a rescan could put LinkedIn's link
  back in place of a saved photo. Every page now also tells the browser to load pictures
  from the app alone, and the scanner fetches photos from LinkedIn's image servers only.
- **Photos an older version kept as links are saved once.** Until then those people show
  initials. The next scan saves them at its end, or *Save photos* on the Scan page does it
  now, without opening a browser. A link more than a few weeks old has expired: that
  person's photo comes back when they're next scanned. Offline, or with LinkedIn's image
  server busy, nothing is forgotten, and *Save photos* stops and says why.
- **Government and military titles are read.** A senator, a governor, a mayor and a cabinet
  secretary score like a C-suite; their deputies, state legislators, commissioners,
  ambassadors and judges like a VP; a city councilmember or a sheriff like a director.
  Officers by rank: a 3–4 star general or admiral 10, a 1–2 star 9, a colonel 7.5, a
  lieutenant colonel 6.5, a major 5, and a commander by their unit. "(Ret.)" and
  "Retired" make a role former. They count only where a title is written, and only where
  their own organization is a government's or a service's: a staffer in an Office of the
  Secretary, a veteran's civilian job, a city manager at Uber, a Rotary district governor,
  a team captain or a Kentucky colonel isn't one. A title that doesn't say whose it is
  ("Mayor", "Police Chief", "Ambassador") needs its government named, or stays "Title
  unclear": a missed official is a neutral 4, a realtor read as a mayor would be an A.
  Until now all of them were "Title unclear" (a U.S. senator scored 2.9, C).
- **One name: Six Degrees.** The header, the welcome screen, the loading and launch pages,
  the side panel and the Terminal installer said "6 Degrees". They now say Six Degrees, as
  the window title and the app in Applications already did.
- **Contributor docs and `.gitignore`.** CONTRIBUTING says npm releases go out through
  trusted publishing, with no token to set, and that `npm run build:desktop` builds the app
  releases ship (`build:app` is the old launcher). `.gitignore` keeps a LinkedIn export, a
  database, a saved copy of a network and the scanner's signed-in browser profile out of a
  commit, wherever they sit in the tree. A local build keeps them out of the app too, and
  its list of uncommitted files inside the app now names ignored ones as well.
- **0.4.0-beta.1, promoted: this is now the Mac app and npm package everyone gets.** It adds:
  - **Their circle, on every card,** with rarity beside the tier and LinkedIn's own mutual count.
  - **One scan at a time,** and *Resume* beside *Rescan*.
  - **Tiers on your own network's curve,** with unknown companies at a neutral 5.
  - **631 public organizations** the built-in list leaves off, and **scoring 6.**
  - **Scores, a tab of its own.**

  The details are under 0.4.0-beta.1 below.
- **The download page** says what's new in 0.4.0.
- **Degrees' corner toggle says Orbit, which is what it shows.** It said "Galaxy", but
  the Galaxy is a Network Circle view, so Degrees fell back to Orbit. It switches
  between Orbit and Bridge Chains, and it's on whenever Orbit is showing.

### Removed
- **About 630 lines of Galaxy code that never ran:** a Degrees drawing from before Orbit
  and Bridge Chains. Nothing could open it. The Galaxy draws Network Circle only.

### Fixed
- **A one-person scan notes a hidden list.** A card's Scan or Rescan that found someone's
  list hidden said so and noted nothing, so they stayed "not scanned yet" and were offered
  again forever. Only a batch noted it. Now every read from page 1 does.
- **A scan reads the list of the person you picked.** A card's Scan and Rescan went by
  name, so with two connections of the same name the scanner could read the other one's
  list. Every Scan button now goes by that person's profile, as Resume already did.
- **A company's name after "at" is no longer read as a title.** "Server at President Hotel"
  scored as a C-suite (7.3, A), and so did an IT specialist in an "Office of the Chief
  Information Officer". "Executive Assistant to the General Manager" scored as a VP.
- **↻ asks before it scans.** The round button in the header started *Check for new* the
  moment it was clicked. It now says what it will do (open Chrome on your connections list
  and read it until it reaches people already saved) and what it costs (no search budget,
  but it is LinkedIn traffic from your account), and waits for OK.
- **No Scan buttons on the sample or a CSV import.** Every card there offered a scan of
  that person's circle, and Degrees offered *Auto-Bridge Next*, but both networks live
  only in the window, so the scan could only fail ("Bridge '…' not found in database").
  In their place a line says scanning needs your own network.
- **A CSV import's dates are the day LinkedIn says.** Anywhere east of London, each "Connected
  On" date landed a day early (28 Sep 2026 became 27 Sep). The import now reads it as the
  calendar date it is, the way a scan already did, and a date it can't read is left blank
  rather than guessed.
- **Opening a panel no longer rebuilds the Galaxy.** Opening or closing the side panel or
  the Filter panel used to draw the Galaxy again from scratch: the layout started over,
  the selection ring vanished, and a big network stalled the page. Now the view slides
  over at the same zoom, so what was in the middle stays in the middle.
- **The selection ring stays on the person you picked.** It is tied to their dot, and it
  comes back after a tier filter that still shows them. It used to follow the first dot
  it found near its old spot, which could be someone else, even You. *Back to list*
  clears it.
- **The selection ring pulses gently, as it was always meant to.** Its animation had only
  ever been written in code that never ran. With Reduce Motion on, it holds still.
- **Hovering a dot eases it up to 1.5 times its size,** instead of jumping. With Reduce
  Motion on, it still changes at once.
- **The Galaxy draws faster on a big network.** Colouring its lines searched every person
  for every line: about 1.4 s at 30,000 people, on every draw. It now takes under a
  millisecond.
- **The main screen no longer stalls when nothing is selected on a big network.** The
  side panel's Power Rankings counted every tier again for each person in the list, even
  with the panel closed. At 30,000 people that took about 20 s each time the screen
  redrew, opening the Filter panel included.
- **On a laptop, the Galaxy keeps its usual layout with a panel open.** Its fixed phone
  layout used to switch on whenever the graph was under 768 pixels wide, which a tier
  filter picked with a panel open could do. It now follows the window, as the page does.

## [0.4.0-beta.1] - 2026-09-28 (beta: a pre-release, never installed automatically)

### Added
- **Their circle, on every card.** Open one of your connections and the top of their card
  is a small map of their circle. Their scanned connections sit round them (D2). Anyone
  you connected with from it gets a green ring, and their own circle fans out behind
  them (D3), on out to D6. A request you've sent and they haven't accepted is a dotted
  dot. Tap the map for the large one, where any dot opens that person. It's built from
  what the app already keeps (whose circle someone was found in, and who introduced
  you), so it needs no extra scanning. Not scanned yet? It says so, and points at the
  scan below.
- **Rarity, beside the tier.** How many mutual connections lead to someone, in five
  bands: *Only way in* (1), *Rare* (2–3), *Uncommon* (4–10), *Common* (11–30) and
  *Warm* (31+). It's a distinction, never a score: tiers and power are untouched.
  Rarity and the tier filter together, in the circle and in Separation, so "S" and
  "Only way in" is exactly the rare finds, and "S" and "Warm" the easy wins. Until a
  scan saves LinkedIn's own count, it's counted from the circles you've scanned, which
  can only go up as you scan more, and everywhere it shows says so.
- **Resume beside Rescan on a profile card.** When someone's list was only partly read (a
  page limit, a stop, LinkedIn pushing back), their card offers *Resume from page N* next
  to *Rescan from the start*: the same carry-on as the Scan page's Paused list, for that
  one person. LinkedIn lists other people's connections in its own order, with no dates,
  so anyone new can be on any page: Rescan reads the whole list again from page 1, and
  Resume picks up where the last read stopped. A list read to the end says so instead.
- **LinkedIn's own mutual count, from circle scans.** Everyone a circle scan finds now
  carries LinkedIn's count of the mutual connections you share with them, read from the
  line under their result card ("Maya Chen and 23 other mutual connections" is 24).
  - **No extra page views:** the line was already on the pages the scanner reads.
  - **One count per person:** every copy of the person, one per bridge that knows them,
    keeps the newest count read. A scan that doesn't see the line leaves the count alone.
  - **Used by rarity** in place of the count from your scans, which could only be a floor.
  - **Not yet tried against live LinkedIn,** and it reads English wording only. The first
    real circle scan is the check. Any other wording reads as no count, never a wrong one.
- **A public company dataset: 631 organizations the built-in list leaves off,** scored 6
  to 8 from public facts on one published scale, each with its source beside it (an exchange
  listing, a reported valuation, a U.S. News rank, a federal department's size).
  - **The Fortune 500 (2025):** 376 companies, and the brands their staff write as their
    employer (KeyBank, Alaska Airlines, VMware, The Wall Street Journal…).
  - **The U.S. federal government:** 114 entries. The departments and military branches
    are 8; agencies and national labs 7. Each is matched only by forms that say which one
    it is: "US Army", never "Army" alone.
  - **Universities ranked 21–100 by U.S. News:** 77 of them.
  - **64 more, researched one by one,** among them Anduril, CoreWeave, MLB, WWE, UF and UCF.

  Someone there is scored from those facts, not as an unknown company, and the Scores tab
  labels the score *public data*. The list is built from public sources only, never from
  anyone's scan, and grows each release. The built-in list itself is unchanged: household
  names only, 7 and up.
- **A card says when a score is a guess, and what would firm it up.** When someone's headline
  gives the app no title to read, or no company it knows, the top of their card says so
  ("Their score is a guess. The app couldn't find where they work.") and offers *Scan their
  circle*, which brings the scan button into view. Who you can reach through them is what the
  score can read instead, and a strong circle adds up to +2.

### Fixed
- **A request you send shows everywhere, at once.**
  - **Before:** *Connect to Unlock Path* marked one bridge's copy of the person and told
    nothing else on the page.
    - The card kept offering the link.
    - Separation, Orbit and the circle never showed it, even after a reload.
    - Every click awarded XP again.
    - Undo took back only half of it.
  - **Now:** a request belongs to the person, in one list every view reads, so the
    card, Separation, Orbit, the new circle, the Outlink queue and the Pending badge
    all change the moment you click.
  - **The details:**
    - The bridge whose circle you found them in is kept, so once they accept, their
      card and circle say who introduced you.
    - XP comes once per person.
    - *Didn't send it? Undo* on the card takes all of it back, the XP too.
- **One scan at a time, and every Scan button knows it.** A scan started on one profile
  card left the Scan button on every other card clickable, and *Auto-Bridge Next*, the ↻
  refresh and Paths' company scan too. Pressing one was refused, and the card then said
  *"Scan failed — connections may be private"* about a scan that had never started. Now
  they all grey out while anything runs and say what does ("Ada Park's circle is being
  scanned. One scan at a time…"), even a scan started on the Scan page or in another
  window. Close a card mid-scan and open it again and its progress is still there; when it
  ends, the card says so. The page asks the scanner once for all of them
  (`/api/scraper?job=1`, which reads only memory), not once per button.
- **Company names written in styled letters or with a logo are read.** "𝗠𝗶𝗰𝗿𝗼𝘀𝗼𝗳𝘁",
  "Apple " (with Apple's logo) and "Snapchat｜ex-L'Oréal" (a full-width bar) used to read
  as unknown companies. So did "Meta Superintelligence Labs" and "Snapchat MENA Region",
  and a class year ("UCF ’26") hid the school.
- **"President's Club" is a sales award, not a president.** A title's possessive read as
  the title, so "Account Executive at Oracle | 3x President's Club" scored 7.3 (A) as a
  C-suite, and so did "Chairman's Award" and "Chief of Staff, CEO's Office". It's the
  title's own: 3.6 (C), and a chief of staff is a director again (5.4, B).

### Changed
- **Tiers are graded on your own network's curve** (new: *Scores → Tiers*, and the default).
  Your top 3% of connections are S, the next 12% A, the next 25% B and the next 30% C, so
  the first scan of any network has a top, not only a network full of companies the app
  knows. The curve only lifts: nobody drops a tier because their network is strong, and
  nobody under 4 is lifted into S or A. People tied at a line all come in or all stay out.
  Choose *On the fixed scale* for the lines as they were (S ≥ 7.5, A ≥ 5.5, B ≥ 4, C ≥ 2.5).
  A LinkedIn CSV import opened in the app is always graded on its own curve.
- **A company the app doesn't know is neutral.** It counts as 5, the middle of the scale
  (it was 4, and 3 when no company was found), so the people the built-in list doesn't
  know aren't pushed down a tier for it. A founder at an unknown company scores 7.3 (was
  6.7), a director 5.4 (was 5.0). Claims in their headlines still count half. Your network
  is rescored once, the first time the map loads after updating.
- **The power score reads more of who someone is.** A review of the score found kinds of
  people it ranked too low:
  - A title's company written without "at" counts: "Global Category President | The
    Coca-Cola Company" scores 9.5 (S), not 7.3 (A), and so does "Corporate VP, Samsung".
    Only a company the app knows, and not after a founder's, an owner's or a CEO's title,
    not a program or a degree ("AWS Community Builder", "Harvard MBA"), and not a school
    after a title that isn't an academic's.
  - "MD @ J.P. Morgan", "MD, Investment Banking", "Head of Country" and "Country Head" are
    senior, like a managing director; "MD, MBA" and "Physician, MD" aren't.
  - Universities have their own ladder: an assistant professor 5, an associate professor
    6.5, a professor 7.5 (was 4, an entry-level job), a dean 9, a provost or a chancellor 10.
  - An audience of their own counts like a title: 100K+ followers like a manager's, 1M+ a
    director's, 10M+ a VP's. A creator with 2.5M followers scores 5.8 (A), not 3.3 (C).
  - A title the app can't read counts as an individual contributor's (4, was 3), so a
    founder whose headline names no title or company isn't put below every job.
  - A strong circle counts by how many strong people are in it, not only by their share:
    +1 for every 25 at A or S, up to +2 (was up to +1). A vague title at a big company with
    72 of them in a circle of 600 scores 5.6 (A), not 3.6 (C).

  Your network is rescored once, the first time the map loads after updating. The sample
  network's tiers don't change.
- **Scores has a tab of its own.** How a power score is worked out and the three things you
  can change about it are in one place: your field (*Your sector*), how tiers are graded
  (*Tiers*) and every company's score. Company scores used to be a tab inside Paths, and the
  other two were in Settings. Old links (*Paths → Scores*, *Settings → Your sector*,
  *Settings → Tiers*) forward there, and Settings says where they went.
- **Separation's map is "who to ask next".** It skips anyone you've already asked or
  already know. Send requests to its ten and the next ten come up. The list below
  still shows everyone, marked *Request sent* or *Connected*, with their rarity.

### Removed
- **The Revolver view.** Degrees keeps Separation, Orbit, Bridge Chains, Pyramid and List.

## [0.3.0] - 2026-09-26

### Changed
- **0.3.0-beta.1, promoted: this is now the Mac app and npm package everyone gets.** It adds:
  - **Settings**, with **Updates** there too. The Mac app now updates itself: *Install and restart*, with no Terminal.
  - **Your sector**, a directory of 49 sectors suggested from your own network. Everyone starts from the same neutral company scores.
  - **Your data:** see where your network lives, save a copy, and move it to another computer.
  - **The scanner's Python inside the Mac app,** so scanning needs nothing installed.
  - **Two security fixes.**

  The details are under 0.3.0-beta.1 below.
- **The download page** says the scanner's Python comes with the Mac app, offers *Set up the scanner* for `npx`, and gives the new size (about 195–210 MB).
- **Updating from 0.2.1 or older:** use the Terminal line or the download page one last time. From 0.3.0 on, it's *Install and restart* in Settings.

## [0.3.0-beta.1] - 2026-09-26 (beta: a pre-release, never installed automatically)

### Added
- **The Mac app scans with nothing to install.** It carries its own Python (3.12) with the
  scanner's packages already inside it, so the Scan page's first step is ticked from the
  start: nothing to install, nothing to click, and setting up needs no internet. Scanning
  still needs Google Chrome. The download grows by about 22 MB, to about 220 MB.
  Playwright's own copy of Node isn't duplicated: it runs on the one the app already has.
  The Python inside is signed like the rest of the app, uses only its own packages (your
  own Python settings, such as `PYTHONPATH`, don't reach it), and never writes into the
  app; nor does a scan on another Python. If macOS ever won't run it, the Scan page says
  so and offers the other way to set the scanner up, and the app doesn't try it again
  until you restart it, so a warning from macOS about it doesn't keep coming back.
- **Set up the scanner** (`npx six-degrees`, or from source). On a computer with no Python
  the scanner can use (none at all, one older than 3.10, or Ubuntu's without
  `python3-venv`), the Scan page no longer ends at "install it from python.org". One
  button downloads a private copy of Python 3.12 from GitHub (python-build-standalone,
  24 to 33 MB) into your data folder, checks it against a checksum built into Six Degrees
  before unpacking anything, and installs the scanner's packages into it, with the
  download's progress on the page. Only when you click it, and Stop stops it. Nothing
  outside your data folder changes, and neither the Python nor the packages ever go into
  a copy of your network. A stopped setup carries on from the Python already downloaded.
  With Python 3.10 to 3.14 installed, Install works as before.
- **Settings.** A new page, from the ⚙ button beside the bell or *Six Degrees → Settings…*
  (⌘,). It's the new home for **Updates**, and it shows which version this is and where
  your network is kept. What you choose there is saved with your network, so it travels
  with your data. *Check for Updates…* in the menu opens it and runs the check; the Scan
  page links to it.
- **Your sector (Settings).** Pick up to three sectors you work in and how much to lean
  toward them. A pick is one of twelve broad industries or one of 49 narrower sectors from a
  built-in directory (Dental, Real Estate, Software & SaaS, Insurance, K-12 Education,
  Beauty & Personal Care, Agriculture & Farming, Veterinary & Animal Care, Social Work &
  Human Services, Security Services…): open an industry to see its sectors, search by a job,
  a kind of business or a company ("dentist", "bakery", "Stripe"), or take a sector
  suggested from your own network ("Dental: 42 people at 17 companies"). An industry
  includes its sectors: it counts any company in one of its sectors, so Healthcare & Biotech
  takes in a practice only the directory calls dental, and a company whose one industry the
  built-in list or the company's own name gives. Not one known only from its people's job
  titles: "Recruiter at Acme Widgets" doesn't make Acme a consulting firm, nor "Software
  Engineer at Pinecrest Foods" a tech company (Paths still colours them by what their people
  say). A directory sector goes by a fixed list of words, as whole words, in the company's
  name or in the headlines of at least half of the people you know there; for a one-person
  company, that person decides. Ten sectors are work every kind of company has (HR &
  Recruiting, Marketing & Advertising, PR & Communications, Accounting & Tax, Legal,
  Management Consulting, Software & SaaS, AI & Data, Cybersecurity, Security Services): for
  those a job title in a headline doesn't count, so "Recruiter at Acme Widgets" doesn't make
  Acme a recruiting firm and "Software Engineer at Chase" doesn't make a bank a software
  company; the company's name ("Acme Staffing", "Smith CPA") or a kind of firm ("staffing
  agency", "law firm", "SaaS") does. Nor do the industry words beside such a job ("University
  Recruiter", "Insurance Defense Attorney", "Dental Marketing Manager"). The lists name only
  companies known across the country, and schools by their names, not their short names
  (UCF, NYU): a regional company or a school is placed by the words in its name and its
  people's headlines, like everything else. There's no AI and nothing is sent anywhere: the
  same words give the same answer on every computer, and anyone can add to the list. Companies in your sectors get +1 ("lean") or +2 ("strong") on their score,
  once however many of your picks they're in, never above 10 and never on a score you set on
  Paths → Scores, so the people there rank higher; the working names the sector ("4 + 1 your
  sector: Dental"). It lifts companies, not what people claim: a reach bonus at an unknown
  company stays halved. Before you save, it shows how many companies and people would move,
  with examples; saving rescores everyone and reports the same count, and turning it off
  gives back exactly the scores from before. When an update changes the directory's words,
  scores that use it are redone on the next load. It applies to networks you've scanned: a
  CSV import and the sample network aren't re-weighted or counted in the suggestions, and
  the page says so when one is open. Tiers still rank how reachable someone is, not people.
  The profile's *Your Sectors* now shows what you picked (it was always empty), and Paths →
  Scores marks the companies your sector lifted. `/paths?tab=scores` opens Paths on its
  Scores tab.
- **Settings → Your data.** Where your network is kept, with *Copy the path* and *Show in
  Finder*; what it takes up (your network, profile photos, backups); every backup with its
  date and why it was made; and whether a LinkedIn sign-in is kept here. The folder can't be
  moved from the app, and the page says why.
- **Move your network to another computer.** *Save a copy of my network* makes one
  `.sixdegrees` file: your network, your settings, the scanner's progress, skip lists and
  LinkedIn budget, and the profile photos of the people in it unless you untick them. Your
  LinkedIn sign-in is never in it; you sign in again on the new computer. There, *Import*
  checks the file first and changes nothing if it isn't whole and undamaged, from this
  version or an older one. It replaces the network there (the two are never merged, and a
  network that has people asks you to confirm how many it replaces) the next time Six
  Degrees starts, after keeping a copy of what was there in `backups/`; the README says how
  to put it back. The LinkedIn search budget belongs to the account, so that computer keeps
  its own: searches made on either computer still count, and a pause on scanning stays. The
  Mac app finishes with *Restart now*; with `npx six-degrees`, stop it and start it again.
  Refused while a scan, or setting up the scanner, runs (it says which), scans wait until
  the import is finished, and the import waits while another copy of Six Degrees has the
  same folder open.
- **Install and restart, in the Mac app: updating without Terminal.** When *Check for
  Updates…* finds a newer version, one more click installs it. The app downloads that
  release from GitHub (about 220 MB), checks it against the release's published checksums
  and checks that the app's code signature is intact, and gets it ready while you keep
  working. Then it closes, puts the new version in its place and opens it on Settings,
  which says how it went ("Updated to 0.2.2"). Your network isn't touched, and the new
  version backs it up before it opens it.
  - Nothing is downloaded until you click Install, and it never happens by itself. It
    installs the version the check showed you; if a newer one came out in between, it asks
    you to check again.
  - If the new version can't be put in place, won't open, or closes before its first page
    appears, your previous version is put back and reopened, and Settings says why. Once
    the new version has started, the previous one is kept, zipped, in
    `~/Library/Caches/Six Degrees` until the next update: the way back if the new one
    misbehaves later.
  - While it swaps the app, it stops only the app's own programs. A Terminal or an editor
    open in the app's folder is left alone.
  - When the app can't replace itself (it's running from the disk image, from a folder your
    user can't change, another user installed it or has it open, or your network is kept
    inside the app), it says why and what to do. Where the Terminal line helps, it gives
    you the line and says what it will do; where the line would delete your network, it
    doesn't offer it. The npm and source copies keep their Terminal lines.
  - Copies of 0.2.1 and older don't have the button: update them with the Terminal line
    once more.

### Changed
- The Scan page's first step is now **Set up the scanner**. When it can't use this
  computer's Python, it says which one it found and why. Install no longer updates pip
  first: everything it downloads is a pinned file. It leaves out pip settings that would
  put the packages somewhere else (`PIP_TARGET`, `PIP_PREFIX`, `PIP_ROOT`, `PIP_USER`;
  your index, proxy and certificate settings still apply), and it checks that the scanner
  can load them before it says it has finished.
- **The scanner's Python packages are pinned**: exact versions (Playwright 1.63.0, requests
  2.34.2, Pillow 12.3.0 and everything they need) and the checksum of every file pip may
  install. Only ready-built files (wheels), so nothing is built from source on your
  computer, and pip refuses any file that isn't the one pinned. They need Python 3.10 to
  3.14 (the newest Playwright needs 3.10, and 3.14 is the newest the pinned files are built
  for); a Python that already has the scanner's packages keeps working as it is.
- **The Queue and the person panel go by company scores, not a list of names.** Both kept
  their own list of one person's favourite companies (Snap, Polymarket, Whatnot…), matched
  anywhere in a headline: "Metadata Analyst" counted as Meta, "Snapdragon" as Snap, and an
  ex-Googler as someone at Google. Now the Queue adds its +1 when the company someone's
  score is built on scores 8 or more, once, and the panel's "top-tier company" and "former"
  notes name a company that scores 8 or more, with its score: the one the score was built
  on, when someone has two roles alike. That's the curated list's major companies and up, or
  any company you score that high on Paths → Scores or lift there with *Your sector*.
- **Built-in company scores are the same for everyone.** The built-in list of well-known
  companies, which every network's scores start from, held some personal and regional
  picks: Snap at 9 as "home turf", UCF at 5 as a "local institution", and a group of 6s
  from one network and one region. One written rule now decides who is on it: companies most US
  professionals would recognise (household names, Fortune 500-sized companies, top
  investment, consulting, law and accounting firms, frontier AI labs, top national
  universities), scored on one scale from 7 to 10. Snap goes from 9 to 8, like Pinterest,
  Reddit and X, and MrBeast from 8 to 7. 32 companies leave the list, among them UCF, the
  University of Florida, AdventHealth, Polymarket, Kalshi and Anduril; they're estimated from
  your network like any other company, and you can score any of them on Paths → Scores. If
  your scanned network had people at a company whose score changed, Paths → Scores offers
  once to keep the old scores as your own: keep all, choose, or no thanks. It offers each old
  score only for its own company's names (a Snap-on person isn't counted under Snap), and
  closes on its own when your network has nothing to offer. Not for a new database, a CSV
  import or the sample. The words that guess a company's industry lose the same kind of
  picks: "UCF" (education), "Snap", "Lens" and "AR" (media; "AR Specialist" is accounts
  receivable), Polymarket, Anduril, Sandia and Whatnot ("whatnot" is also a word), and
  "growth", a job title: "Head of Growth at Acme Software" works at a software company, and
  "Summit Growth Equity" is an investment firm, not media ("growth marketing" is still
  marketing). Your network is rescored once, automatically, on the first load after
  updating.
- **The reach bonus counts the top award of every field.** It named four awards, from
  advertising, TV, music and the web (Cannes Lions, the Emmys, the Grammys, the Webbys), so
  a Pulitzer, an Oscar, a Nobel Prize or an Olympic medal earned nothing. Now it's the top
  honour of each field: the Nobel, the Pulitzer, the Peabody, the Emmy, the Grammy, the
  Oscar, the Tony, the Webby, the Clio and Cannes Lions, the James Beard, the Turing Award,
  the Fields Medal, the Pritzker Prize, MacArthur Fellows, Rhodes Scholars, Olympians and
  Paralympians, as well as "award-winning" and "prize-winning". A name that is also a
  company's or a person's counts only as a claim ("Oscar-winning", "Tony Award", "Emmy
  nominee"): Oscar Health, Peabody Energy and Clio get nothing, and "Emmy" or "Grammy"
  anywhere in a headline no longer counts on its own. Your network is rescored once,
  automatically, on the first load after updating; stored scores now carry a fingerprint of
  scoring's rules as well as its lists, so a later change to them rescores the same way.
- **Two industries have plainer names.** "Finance, VC & Crypto" is "Finance & Investing"
  and "Marketing, Media & Creator" is "Marketing & Media", in Settings, Paths and the
  working beside a score. Crypto and the creator economy are sectors of their own in the
  directory (Crypto & Web3, Creator Economy). What you picked stays picked.
- **The built-in company list reaches well beyond tech and finance.** 112 companies most US
  professionals would recognise join it, taken from named sources so anyone can check the
  choice: the household names of the Fortune 100 (CVS Health, Costco, Ford, UPS, State Farm,
  Verizon, ExxonMobil…); the largest household names in health care, retail, food, hotels,
  autos, airlines, telecoms, energy, shipping and news (Kaiser Permanente, Mayo Clinic,
  McDonald's, Marriott, Honda, Delta, DHL, The New York Times…); nine of the ten largest US
  law firms (Kirkland & Ellis, Latham & Watkins…); the largest private equity firms
  (Blackstone, KKR, Apollo); and the top 20 national universities (Princeton, Yale, Johns
  Hopkins…). They're scored on the same 7 to 10 scale as the companies already on it.
  Nothing already on the list changes, so there's nothing to keep; your network is rescored
  once, automatically, on the first load after updating. "Home Depot" now counts as a
  company: it used to be dropped along with phrases like "at home".
- **Each company has one industry, used everywhere.** The curated list now names each
  company's industry, so Adobe, Pfizer or MIT (no industry word in the name) no longer
  take whatever their people's headlines say. Otherwise the name decides, else what
  most of the people there say; a tie stays unclear. Paths' colours, the Scores list and
  the "not for schools" rule in the company estimate now agree, where before each person's
  own headline could put the same company in a different industry. Your network is
  rescored once, automatically, on the first load after updating.

### Removed
- **The retired SQL scorers.** `scripts/score_new_connections.sql`, the hosted-era scoring
  model retired in 0.1.10, still shipped inside the Mac app and the npm package, headed
  "CANONICAL SCORER" and holding the old list's personal picks. Nothing read it (imports
  score with `lib/scoring.js`). It and its repo-only twin, `scripts/score-connections.sql`,
  are deleted; git history keeps them.

### Fixed
- **Students and school clubs read the same at every school.** The title rules named two
  schools, UCF and UF: "President, UCF Marketing Club" counted as a student's club role and
  "CS @ UCF" as a student, while "VP, NYU Finance Society" counted as a VP and "CS @ NYU" as
  someone working at NYU. A school's short name in capitals (UCF, NYU, USC, BYU…) now counts
  for every school, and an alumni club or a parents' association is no longer taken for a
  student club. What that costs: a short name is two to four capitals that start or end with
  a U, so companies and unions that look like one are set aside by name (the curated list's
  companies, such as UPS, and UBS, UFC, UPMC, UnitedHealth's UHG and UHC, UA, UL, ULA, UTC,
  the UAW, USW, SEIU, UFCW and UFT): "Finance @ UBS" works in finance, and "President, UAW
  Local 600 Chapter" leads a union local. A school whose short name is on that list isn't read
  from it; with a short name only a club or a society counts as a school's, or an association
  named for a field of study ("USC Trojan Marketing Association"), so a chapter named only by
  one ("President, UCF Chapter of IEEE") reads as the title it says; and a company's short name
  that isn't on the list still reads as a school's in "Marketing @ …".
- **Companies that share a name with a well-known one are themselves.** The curated list's
  names matched anything that started with them: Snap-on, Snap Finance and Specs Optical
  counted as Snap, Harvard Pilgrim Health Care and Stanford Health Care as the universities,
  Kellogg Brown & Root as Kellanova, Fidelity National Financial and Fidelity Bank as
  Fidelity, Warner Music Group as Warner Bros. Discovery, J&J Snack Foods as Johnson &
  Johnson, Toyota of Orlando and Coca-Cola Consolidated as the automaker and Coca-Cola, Citi
  Trends as Citi, Merrill Gardens as Bank of America and Merck Millipore as Merck. A name
  other companies share now matches only in its own company's forms ("Snap Inc.", "Harvard
  Business School"); a dealership, a bottler, a venue or a company spun off keeps its own
  name. So does a credential, a program or gig work on a company's platform, which used to
  read as a job there when written first in a headline: "AWS Certified Solutions Architect"
  was a role at Amazon (10), and "Uber Driver", "Airbnb Superhost", "Twitch Streamer",
  "LinkedIn Top Voice" and "Google Alum" were at theirs. The sector directory reads names the
  same way. Best Buy and Best Western count as companies (they were dropped with "at best"),
  and so do Home Instead and Home Chef (dropped with "at home"). Chase Corporation and
  Merrill Corporation aren't read as the banks once "Corporation" is trimmed, and a name
  with initials is read in full: "J.P. Morgan" was cut to "J.P" and matched nothing, and
  "J. Crew", "T. Rowe Price", "U.S. Bank" and "St. Jude Children's Research Hospital" lost
  everything after the first full stop.
- **Paths groups people under the companies their scores are built on.** It merged
  company names by a list of its own, which also folded other companies in: Oxford,
  Hartford and Bradford counted as Ford, Bainbridge as Bain, and Mitsubishi UFJ, a bank, as
  "Mitsubishi Power". Paths now names each company as the score does, from the one built-in
  list, in its bubbles, its Companies list and its ways in; the score itself no longer reads
  Mitsubishi's bank, lender or landlord as Mitsubishi. The launch page no longer claims "80+
  company normalizations".
- **A refresh's notifications count who is new, and who scored high.** New connections were
  the ones missing from a lookup of the first hundred, so a refresh of known people past a
  hundred announced "10 new connections found!", and genuinely new ones were never announced.
  "High-value connection" went by famous names anywhere in the headline ("Metadata Engineer",
  "Engineer at Snap-on"). Now new means added by that refresh, and high-value means the model
  scored them S or A.
- **The launch page's formula** is the one the app scores with, `T × (0.45 + 0.055 × C) + R +
  B`, with S from 7.5. It showed the sum retired in 0.1.10.
- **The launch page shows the sample network's numbers, not one person's.** Its counters,
  degree counts and feature cards were one real network's (2,438 connections, 25 bridges,
  798 recommendations…) shown as if they were the app's, and its footer named a company. They
  are now counted from the invented sample network that comes with the app (873 connections,
  14 bridges, 748 people, 19 companies), and the page says so; the footer says the app is
  open source (MIT). Its S tier card said 7.0+; S starts at 7.5. The public demo's profile no
  longer names a company either.
- **Paths → Scores misstated the company weight.** It runs from 0.615 when no company is
  found, not 0.56, up to 1.0 for a company scored 10.
- **Schools named like a company on the curated list were scored as that company.**
  "Kellogg School of Management" counted as Kellanova (7), "Warner University" as Warner
  Bros. Discovery (8), "Campbell University" as Campbell's (7) and "Chase College of Law" as
  JPMorgan Chase (9). A name that says school, college or university now only matches a
  school on the list. Bain Capital, a private equity firm, has its own entry (finance, still
  9) instead of being read as Bain & Company (consulting).
- **A relative `--data-dir` stays where you meant it.** `npx six-degrees --data-dir
  my-network` used to keep that network inside npm's own cache (the server runs from the
  package's folder), where clearing the cache deleted it; the Mac app looked for it inside
  the app. It's now the folder from where you ran the command, the home folder when the
  Mac app is opened with `open`, and `--data-dir=~/copy` means your home folder too.
- **No "Six Degrees stopped" error when something else closes the app.** When the
  installer (or logging out) stops a running copy, the app's server ends with code 143
  rather than by the signal, and the Mac app took any exit code for a crash. It now quits
  quietly; a real crash is still reported.

### Security
- **Pages on other local ports can no longer send the app commands.** The check that refuses
  writes from other websites trusted the browser's "same-site" label. A site ignores the
  port, so a page served by any other app or dev server on `127.0.0.1` counted as the same
  site and could POST to `/api/update` and `/api/scraper`. A same-site write must now carry
  an `Origin` that is exactly this app's host and port. The app's own pages are unaffected.
- **Websites can no longer read or change the network through DNS rebinding.** A site can
  make its own domain point at `127.0.0.1`; the browser then treats the app as that site's
  own origin, so the page could read `/api/network` and the photos, and send writes. While
  the app is bound to loopback, requests to `/api` and `/avatars` must now be addressed to
  `127.0.0.1`, `localhost` or `[::1]`; any other name gets a 421.
- The four new actions in Settings → Your data (save a copy, import, restart, show the
  folder) are gated like the routes that delete data or start processes: never reachable
  from another machine. An imported file is treated as untrusted and checked in full before
  anything changes ([SECURITY.md](https://github.com/blakeb056/six-degrees/blob/main/SECURITY.md)).

## [0.2.1] - 2026-09-25

### Added
- **Tutorial videos on the download website:** installing on a Mac, running it on Linux, and
  how scanning works. They're short and silent, with the steps as captions.
- **`npx six-degrees` on Linux.** The npm package is published (0.2.0 was the first). The
  README, the website and the installer's message now point Linux users to it, with how to
  update it and where it keeps your data.

### Fixed
- **Check for updates says what it found.** An up-to-date copy showed only a faint line, so
  the button seemed to do nothing. The answer is now a clear status ("You're up to date: 0.2.1
  is the newest version", with the time). The Mac app's **Check for Updates…** menu item opens
  the Updates panel and runs the check, instead of just opening the top of the Scan page.
- **The profile page no longer starts scans.** Its "Set Up Account — Full Scan" and "Auto-Bridge
  All Connections" cards are gone. The second mapped every connection in one go, with none of
  the batch size, budget or warnings of the Scan page, where scanning lives.
- The window title is **Six Degrees** (it was "6 Degrees of Separation — LinkedIn Network
  Research"), and the page description no longer claims to be a research project.
- The import page's "close the tab" note is true in the Mac app too.
- **Big LinkedIn exports import.** An export over about 9,000 connections was refused ("too large to hold in this browser tab"). The tab now keeps only what the export says about each person and scores it again on load, so exports up to LinkedIn's 30,000 maximum fit. Checked in a browser: 10,000 connections import and draw in about 4 seconds, 30,000 in about 25. It still never touches the database.
- **`npx six-degrees` downloads about 22 MB instead of about 235 MB.** The package already
  carries its built server; Next, React and d3 are now build-time only.
- On Windows, npm now refuses the package with a clear "not supported" message instead of
  installing it and crashing at start.
- On Linux without a desktop, `npx six-degrees` prints the address to open instead of a
  crash when there's no browser to launch.
- The Scan page checks for Google Chrome on Linux too (where Playwright looks for it).
- Updating an npx copy says to stop it first, and keeps `--data-dir` if it was started
  with one, so the new version finds your network.

### Changed
- The app says **scanner** and **scan** everywhere you read it (the Scan page, the side
  panel, the profile page, the import page); the code names are unchanged.
- Releases publish to npm through npm's trusted publishing: GitHub vouches for the release
  workflow, so no npm token is stored anywhere. Each release builds the package on Linux,
  installs it, checks it serves the app, and publishes that exact file.
- The README: macOS 15's second button is **Open Anyway**; the LinkedIn warning's link no
  longer shows a file name; the release notes link the changelog.
- SECURITY.md lists all six gated routes (it said four).

## [0.2.0] - 2026-09-24

### Changed
- **Six Degrees is now a Mac app (Electron) for everyone**: the 0.2.0-beta.1 app, promoted.
  It has its own window, Dock icon and menu, and the same server, data and scanner inside as
  0.1.11. Needs **macOS 13.5 or later**.
- **The README starts with the Mac app**: two download buttons (Apple Silicon, Intel), the
  exact first-open steps, and the Terminal install as the alternative. Each release now
  carries `Six-Degrees-Mac-Apple-Silicon.dmg` and `Six-Degrees-Mac-Intel.dmg`, whose names
  never change, so the buttons always fetch the newest version.
- The sample network is scored with the app's real model; it was still using the retired
  formula. It's regenerated, and so are the screenshots, from the new app.

### Fixed
- The README, installer and release notes no longer point Windows and Linux users at
  `npx six-degrees`, which was never published and so failed. Linux gets real from-source
  steps; Windows is honestly "not yet".
- The installer refuses a Mac older than macOS 13.5 with a plain message. Every version
  bundles Node 24, which needs 13.5; on an older Mac the app used to install fine and then
  fail with a generic alert. Both apps now declare the true minimum, so macOS says so too.
- The README's scoring section, view names (Degrees, not Bridges), feature list, privacy
  list (PyPI, update checks) and data-folder layout match the app again. The LinkedIn risk
  warning comes before the first scan, with both incidents.
- Paths → Map: an industry label near the bottom no longer lands on the legend.

## [0.2.0-beta.1] - 2026-09-24 (beta: a pre-release, never installed automatically)

### Added
- **Six Degrees as a real Mac app (Electron).** Its own window, Dock icon and menu, instead
  of a Chrome window. Inside, it runs the same server as before, so every screen, your data
  and the scanner behave exactly as they do in 0.1.11.
  - **Quitting cleans up.** A running scan is stopped the way the Stop button stops it, so
    its Chrome window closes, and then the server. If you're looking at the app when you
    quit during a scan, it asks first.
  - **LinkedIn opens in your own browser**, never inside the app.
  - Opening it again brings the window forward. Closing the window leaves it running,
    like any Mac app, so a scan carries on; Quit ends it.
  - `--data-dir PATH` runs it against a copy of your data:
    `open "Six Degrees.app" --args --data-dir ~/six-degrees-copy`.
  - A placeholder icon (you at the centre, your circles in the tier colours) until a real
    one is chosen.
- **Needs macOS 13 (Ventura) or later**, where the classic app ran on macOS 11.
- The download is about 175 MB (the classic app is about 55 MB). Full releases stay the
  classic app until this one is promoted (`docs/brain/DESKTOP.md`).

## [0.1.11] - 2026-09-24

### Security
- **Next.js 16.2.9 → 16.3.6.** It fixes two critical remote-code-execution advisories
  (GHSA-2xp9-vwfh-vxw4 in image optimization, GHSA-p293-qw3h-jr36 on Windows), a middleware
  bypass under Turbopack (GHSA-6gpp-xcg3-4w24; this app's cross-site guard *is* middleware),
  and several denial-of-service, request-forgery and cache issues. Listening only on this
  computer doesn't make these safe: any website you visit can make your browser send
  requests to `127.0.0.1`, and the cross-site guard blocks writes, not reads. `npm audit`
  now reports 0.

### Added
- **A copy of your data before every new version touches it.** The first time a new version
  opens your database, it copies it into `~/.six-degrees/backups/` first (the newest five
  are kept; copies you made yourself are left alone). If the copy fails, for instance on a
  full disk, it tries again at the next start.
- Tags like `v0.2.0-beta.1` publish as **pre-releases**. The one-line install and the
  Updates panel never pick them up, so a beta only reaches someone who asks for it.

### Fixed
- The installer's documented options go *after* the pipe
  (`curl … | SIX_DEGREES_VERSION=… bash`). Before it, they reach `curl`, not the installer.

## [0.1.10] - 2026-09-24

### Changed
- **Power scores rebuilt from an audit against your own network.** One model now scores
  everyone (lib/scoring.js), where there were three that disagreed:
  - **Seniority × company, not seniority + company.** power = title × company weight + bonus.
    A title is worth more at a bigger company, so a VP at Google (9.0) outranks a founder of an
    unknown startup (6.7), and an intern at Google (2.0) no longer scores like a director.
  - **Titles are read properly.** The current role counts, former roles at 70%, and a person
    scores as their strongest role. Fixed: "Vice President" read as President (73 people),
    "Product Owner" as an owner, "International" as intern, club and fraternity chairs as
    chairmen, and "CFO" missed entirely. Current students are capped.
  - **Companies are found and named consistently.** Meta, Snap, Amazon/AWS and UCF variants
    merge; plain "Meta" was missed before. Headline phrases like "at scale" are no longer
    companies. About 130 well-known companies are scored, up from about 80.
  - **Bonuses need whole words and real signals.** "psYChology", "comMITted" and "adVENTURE"
    no longer earn +2. Self-reported claims from someone at an unknown company count half.
  - **The circle boost is capped at +1 and recomputed each time.** It used to add up to +3 and
    only ever go up, and 23 of 33 S-tier 1st-degree people were S only because of it.
  - The recency bonus is gone: connecting recently doesn't make someone more powerful.
  - Checked against mapped circles: a person's title now tracks how senior their own circle is
    (correlation 0.30, up from 0.10).
- Everyone is rescored after every import, and once automatically on the first load after updating.

### Added
- **Paths → Scores:** every company in your network with its score, where the score comes from
  (known list, estimated from how many of your people work there, or yours) and a control to
  set your own. Setting one rescores everyone. The company panel on the map has the same control.
- **Why this score:** the person panel explains the number, e.g.
  "VP / Partner / GM (9) · Snap (9/10) · +0.7 strong circle".

## [0.1.9] - 2026-09-24

### Added
- **Paths is a company and industry analyzer**, in the spirit of LinkedIn's InMaps
  (2011–2014), the network map LinkedIn used to give people and then retired.
  - **Map:** every company is a bubble, coloured by industry and sized by your people there,
    with the share you already know as a white centre and a gold ring when an S-tier person
    is inside. A line joins two companies when one of your connections at the first knows
    people at the second.
  - **Industries:** a card per industry with who you know, who you can reach, director-level
    people, the top companies and the best way in.
  - **Filters:** degree, level (director+, C-suite), tier, industry, and search.
  - **Analyzer panel:** click a company or an industry for the breakdown by level, the ways in
    (people who work there first, then connections who know the most people there), the
    most powerful people, and connected companies. "Path to the top" still opens the
    level-by-level view.
  - Industry is inferred from company names and headlines and says so; unclear stays unclear.
- **Outlink is a game: Circles.** Each mapped connection's circle offers its best people five
  at a time. Mark an invite sent and the ring fills; clear a stage and the next five appear.
  **Next best moves** picks the three people most worth an invite, nudged toward circles
  you've started. Level and points come only from invites sent and people who joined your
  network. People you added whose circle isn't mapped yet show as **new doors**, the next
  degree to map. The list and Pending are still there.
- **Orbit in Degrees.** The Network Circle's Orbit, for your mapped circles: each person
  you've mapped on one ring, with everyone they know fanned out behind them, the most
  powerful closest, and more room for bigger circles.

## [0.1.8] - 2026-09-24

### Added
- **A search budget.** Every people search and profile view is written down
  (`~/.six-degrees/linkedin-activity.json`), and scans stop at a daily budget (the last 24
  hours, 50 by default) and a monthly one (LinkedIn's month, which starts at midnight
  Pacific on the 1st; 250 by default), both set on the Scan page. A read that reaches either
  saves what it read and stops, never marking a list finished, and carries on from the
  same page next time. The budget belongs to the LinkedIn account, not to a profile in the
  app, and a damaged record counts as the day used up. It applies to company scans too.
- **A cooldown lock.** When LinkedIn pushes back, nothing that searches runs for a day (until
  LinkedIn's month turns, for its monthly limit; six hours after two unclear reads in a
  row). The Scan page shows it in red with the time it lifts, the scan buttons wait, and
  **Lift it early** is there for when search works normally again.
- **A Paused list with Resume.** The Scan page lists everyone whose list was only partly
  read, with the page each one carries on from, newest connections first. **Resume** carries
  on with one person (found by their profile URL, so two people with the same name can't be
  mixed up) and **Resume all** with every paused list and nobody new, always to the end of
  the list. The list and the scanner's queue follow the same rules (`lib/paused.js`, tested
  against the scanner).

- **Scan my whole network** and **Check for new** also wait out a cooldown. They aren't
  searches, so they don't count against the budget, but they still open LinkedIn with
  automation.

### Fixed
- Re-mapping someone deleted their circle before checking anything; it now checks the
  cooldown and the budget first.
- Windows: the scanner uses no Unix-only file lock or date format, and installs `tzdata`
  so it knows when LinkedIn's month starts.

## [0.1.7] - 2026-09-24

A stopgap after 0.1.6 read 27 pages of results in about three and a half minutes and
LinkedIn blocked the account's search, plus the Separation view. Budgets and an easy resume
come next. TRAPS §35.

### Added
- **Separation**, a new Degrees view and the one the Degrees tab now opens on. Everyone you
  can reach in two steps is ranked on one list, one row per person, however many of your
  connections know them. Each row shows every way in. A small map above the list draws
  You → each connection → the top ten, with every route. Search also matches who knows
  someone, so typing a connection's name shows their circle.
- The Sidebar's **Path to this person** box lists every route to a 2nd-degree person, not
  just the one on the row you clicked. A route whose connection can't be found is still
  shown, as unnamed. It used to make the box disappear.

### Changed
- **Slower reading.** 20 seconds before each page of results and another minute after
  every 10. A whole list now takes about 55 minutes, not 10.
- The pause after someone who came back with nothing is the full two minutes. It was 15
  seconds, so the scan went faster exactly when LinkedIn was pushing back.
- The **Bridges** tab is now called **Degrees**. The Filters panel's tier chips there read
  "Filter by bridge tier", so they aren't confused with a person's own tier.

### Fixed
- **A scan stops at the first sign of LinkedIn pushing back** instead of carrying on to
  the next person. That covers a page of results that won't open, a search that won't open
  for someone whose connections are visible, LinkedIn's own warnings ("unusual activity
  from your account", profile viewing restricted, the account restricted, the monthly
  search limit coming up or reached), and a security check or sign-in wall appearing while
  you were signed in. What the page showed is kept in `~/.six-degrees/pushback/` so the
  wording can be recognised, and the message says what to do for that case.
- **Someone is only marked hidden when LinkedIn clearly showed their profile** (their name
  in the page heading or title, as a whole word) with no connections link, or said the
  profile is unavailable. A profile that didn't render is "unclear": nothing is recorded,
  two unclear people in a row stop the batch, and someone unclear twice moves to the back
  of the queue so they can't hold it up. A block used to mark everyone after it as hidden,
  for good. LinkedIn's own "No results found" is taken as a real answer.
- **A security check no longer counts as signed in.** The session cookie survives one,
  so a scan used to carry on past it. It now stops, and **Open LinkedIn** on the Scan page
  (shown even when signed in now) opens a window to finish it by hand. Signing in from
  scratch still waits through LinkedIn's own two-factor steps.
- Closing the browser window during a read stops it, and never marks the list finished.
- **Carrying on into a blank page no longer marks a list finished.** Only LinkedIn's "No
  results found" does. A search it is limiting can come back blank, and a wrong
  "finished" dropped the rest of that list for good.
- The Scan page's note on how long a whole list takes read "15 minutesa person".
- **A full scan could cut a mapped circle loose.** If one of your connections had also
  been saved inside someone else's circle (before 0.1.5 kept your own connections out),
  a full scan "promoted" that copy and deleted their real row. Everyone in their own
  circle was then left pointing at a row that no longer existed, and they vanished from
  every Degrees view. The same step gave long-standing connections a "you met them
  through…" they never had. Their own row is now kept, with no origin added. TRAPS §36.

## [0.1.6] - 2026-09-24

### Changed
- **2nd-degree scans read each person's whole list.** Every read used to stop at page 10
  (about 100 people) unless you changed a setting, and nothing in the log said so, so a
  list of 50 pages looked finished at 10. The default is now every page. It keeps
  clicking Next until the list ends, and looks for another page three times, scrolling
  down and waiting longer each time, before deciding a list is over. LinkedIn's own
  search stops at page 100 (about 1,000 people). The log always states the page limit,
  and says so when it stops at one with more to read.
- The log no longer calls the search of someone's connections a "3rd+ filter". It never
  was one: it covers everyone they know, and the app drops your own connections when it
  saves.

### Added
- **Carrying on where a read stopped.** How far each person's list has been read is noted
  in `~/.six-degrees/bridge-progress.json`. With **Also finish people already mapped**
  (on by default; `--deeper` from a terminal), a scan picks up everyone read only partly,
  including everyone mapped before this version at 10 pages, from the next page. Their
  profile isn't opened again once the id their connections are searched by is known.
- **Long reads save as they go**, every 10 pages. Stopping a scan, a crash, or LinkedIn's
  monthly search limit for free accounts now costs at most the last few pages, and the
  next run carries on from the same page.
- **LinkedIn's monthly search limit is recognised.** The scan saves what it read, stops
  the batch, and says why, instead of reading empty pages.

### Fixed
- A click on Next that didn't move to the next page used to end that person's read as if
  their list had ended. It is now retried three times, and if the page still won't move,
  the person is left for the next run to finish.
- Release builds could still fail at the eject: "Resource busy" sometimes arrives after
  the volume has already unmounted, when only ejecting the disk device failed, and the
  retry kept aiming at a mount point that no longer existed. It now finishes on the
  device and stops as soon as nothing is left attached. Build process only.

## [0.1.5] - 2026-09-24

### Fixed
- **A 2nd-degree scan could read someone's connections and save none of them**:
  "UNIQUE constraint failed", then "Done! 0 new". A person's results can name the same
  profile twice — the same result on two pages, or the same mutual connection under many
  results — and the database refused the whole batch. The scanner and the app now each
  keep every profile once.
- Your own connections were saved into other people's circles. They arrive as the
  "mutual connections" links under each result; they are not people you have not met,
  and they inflated every circle. They are now left out (and counted in the log).
- A failed save printed one line and carried on to the next person, spending LinkedIn
  views on people who could not be saved either. It now stops the batch and says why.
- After a push the log said "N processed", counting everything sent. It now says how
  many were new, and how many were already on file or already your connections.
- Company scans saved their rows without your profile, so nothing they found could
  appear. (Company scans are still experimental.)

- **LinkedIn's "Connected on" date is captured again.** The 1st-degree reader rewritten on
  2026-09-09 stopped saving it, so the app had no idea when you connected with anyone —
  and the scoring bonus for connections made in the last 30 days never applied. It is read
  from each person's card again, and a full scan fills it in for everyone already saved.
- A full scan's summary said "814 new" and then "Sent 814 → 0 new". It no longer claims
  a count it cannot know; the app's line says what was new.

### Added
- **Start with your newest connections.** The 2nd-degree step now works through the people
  you connected with most recently, by LinkedIn's "Connected on" date and across every
  tier; "highest tier first", with the tier choice, is still there.
- The progress bar says "Saving to your network and fetching photos" once reading is done,
  instead of sitting at 99% looking stuck.
- The Scan page remembers the order and depth you last chose.
- **How deep to read each person:** 10 pages (the default, about 100 people), 25, 50 or
  100, LinkedIn's limit. Deeper reads take longer and use your account's search allowance.

## [0.1.4] - 2026-09-24

### Fixed
- **2nd-degree scans failed on the first page of every person** with "Page.evaluate:
  SyntaxError: Invalid or unexpected token", then moved on to the next — so no
  connections were ever read and no pagination happened. The JavaScript that reads each
  results page sat in a plain Python string, which turns the `\n` in `split('\n')` into a
  real line break before the browser sees it. It is now a raw string, and a new test
  parses every snippet the scraper injects on every pull request. Broken since 2026-09-09.
- That same page reader, run against a mock results page for the first time, saved
  LinkedIn's screen-reader line ("View … profile") as everyone's headline. It now takes
  the first real line after the name.
- After a scan, "N of them were 2nd-degree contacts you have now connected with" read as
  N people added. It now says what happened: N were already in a bridge's circle and have
  been merged into your connections, keeping who introduced you.

## [0.1.3] - 2026-09-24

### Fixed
- **Scanning failed in the Mac app on Apple Silicon** with an `ImportError` from Pillow
  ("incompatible architecture (have 'arm64', need 'x86_64')"). The app's launcher is a
  script, so macOS could not tell which chips it supports and ran it under Rosetta; the
  Python it started came up Intel and could not load the Apple Silicon packages. The app
  now declares its chip (`LSArchitecturePriority`), so it runs natively — and it no
  longer needs Rosetta installed just to open.
- The Scan page's "installed" check imported only package names, which succeed even
  when the compiled parts are for the wrong chip. It now loads Pillow's image module
  and Playwright's sync API, so a mismatch shows as "not installed" before a scan.
- The one-line installer picks the Apple Silicon build even from a Terminal running
  under Rosetta, which reports `x86_64` on an Apple Silicon Mac.

## [0.1.2] - 2026-09-24

### Fixed
- **Hovering a dot in the Galaxy made it rebuild itself hundreds of times a second** —
  the rings collapsed and re-formed for as long as the mouse stayed on a dot. The hover
  tooltips sat invisibly at the bottom of the page, making it 18px taller than the
  window; on a Mac that shows scrollbars (a mouse, an external display) that meant a
  scrollbar, and moving the tooltip on hover removed it again. Each flip of the
  scrollbar resized the graph, and each resize rebuilt it. Tooltips now float above the
  page, and a resize waits to settle before it rebuilds anything.
- Clicking a dot, or anything else that re-rendered the page, also reset the Galaxy's
  layout: the page handed it a new, empty list and a new click handler every time. Both
  are now stable, so the scene only rebuilds when what it shows actually changes.
- A release build could fail at the very end with "Resource busy": right after Finder
  lays out the disk image's window, Finder or Spotlight can still hold the volume. The
  build now retries the eject, and says when it had to. Nothing changes in the app.

## [0.1.1] - 2026-09-24

### Fixed
- The `.dmg` window opened as a plain list in 0.1.0, with no picture and no Open Anyway
  step. A code comment had slipped inside the AppleScript that lays the window out,
  which made it a syntax error, and the build only warned. The script is now compiled
  before it runs, and a release build fails rather than publish a plain window.

### Added
- The release workflow can be dry-run: `gh workflow run release.yml --ref <branch> -f
  dry_run=true` builds both `.dmg` files on GitHub's Macs and publishes nothing.

## [0.1.0] - 2026-09-24

The first release: a Mac app on GitHub Releases, installed with one line. npm
publishing is wired up and waits only for a token.

### Added
- **One-line install on a Mac**: `curl -fsSL …/install.sh | bash` fetches the newest
  release for your chip, verifies its SHA-256, puts the app in Applications and opens
  it — with no Gatekeeper prompt, because curl does not mark the file as downloaded.
  Running it again updates. `SIX_DEGREES_DMG` installs a local `.dmg` for testing.
- A release workflow: pushing a `v*` tag builds the app on Apple Silicon and Intel,
  publishes both `.dmg`s and a `SHA256SUMS` on a GitHub Release, and publishes to npm
  when an `NPM_TOKEN` secret exists.
- A welcome screen for a first run: **Scan my LinkedIn** (recommended), **Import my
  LinkedIn CSV**, or **Explore a sample network**.
- The Scan page ticks off the scan step once you have connections, offers **See your
  network →**, and when a run stops early it shows the reason in a box rather than
  only "Stopped (exit 1)" at the bottom of the log.
- A progress bar while scanning: "350 of 817 connections · 43%" for a full walk,
  "Person 3 of 10" for a 2nd-degree batch. **Check for new** gets words instead of a
  bar, since it stops as soon as it meets people already saved.
- The Mac app and the npm package get a working **Updates** panel. **Check for updates**
  asks GitHub for the newest release's version number — on a click, never by itself —
  and shows the exact line to run, with a Copy button.
- The `.dmg` window says what to do: drag the app across, then the one-time **Open
  Anyway** step for an unsigned app. It replaces the READ ME text file the image used
  to carry, and the Applications drop target now shows its folder icon.

### Changed
- **No more name prompt.** The app works out which profile is yours — the one that
  owns your network — and creates one on a fresh install. The prompt minted a new,
  empty profile for every name that did not match exactly, and with more than one
  profile the network disappeared from view and the scraper refused to run.
- The README leads with installing, not cloning; running from source moved to
  CONTRIBUTING.md, with the commands chained so a failed clone cannot fall through to
  an older copy.
- The Scan page counts by degree — "814 connections, plus 2,734 people in their
  circles" — instead of one total that read as connections and was not.
- `Start 6 Degrees.command` is gone. It started the development server; install the
  app instead.
- **Company scans are marked experimental.** They ship without ever having been run
  against live LinkedIn; the Paths page labels the button and asks once before the
  first scan.

### Fixed
- A scan that failed printed only "Stopped (exit 1)". Its reason was on stderr, which
  the Scan page filtered to lines mentioning "error"; failures now always show their
  last lines, and the red box shows the whole reason rather than its final line.
- Updating a Mac app that was running left its old server behind, still serving the old
  version, with the new copy opening on the next port. Next renames its process, so the
  installer never found it by path; it now finds it by folder, and the app's launcher
  stops its server whenever the launcher stops.
- The build copied the repository's `.git` folder and build logs into the app. Inside
  the Mac app, the `.git` made the installed copy look like a checkout, so its Updates
  panel would have offered `git pull` against the app itself.
- The Scan page's status was cached for four seconds, the live log included, so a
  running scan looked stalled between updates.

### Added
- `npm run update` — discards the regenerated lockfile, pulls, installs, and tells you to
  restart. Plain `git pull` refuses whenever npm has rewritten `package-lock.json`, which
  is most of the time on a second machine, and it says so in one line that is easy to
  miss.
- A downloadable macOS app. `npm run build:app` produces `Six Degrees.app` and a ~70 MB
  `.dmg` with a Node runtime inside, so importing a CSV needs nothing else installed —
  no Node, no clone, no terminal. macOS asks for one approval on first launch because
  the app is not signed with a paid developer certificate.
- Clicking a bridge on the Revolver dial now opens that person, instead of only spinning
  them to the top. The dial also says when it is showing part of something — "12 of 14
  bridges", "showing 24 of 59" — and shift with the arrow keys pages through the rest.
- The profile page shows how much of your network has actually been mapped: a bar for
  the connections whose circle you have opened, how many keep their connections private,
  and how many are left — with the remainder given in batches rather than as one long
  run.
- An **Updates** section on the Scan page. Press **Check for updates** to see what has
  changed since your copy, then install it — no terminal, no `git pull` to remember.
  Nothing is ever checked automatically and nothing about you is sent; it runs the same
  two git commands you would type. If you have your own edits, it refuses and tells you
  which files rather than throwing them away.
- LinkedIn `Connections.csv` import, parsed entirely in the browser and never persisted.
- A synthetic sample network (150 invented 1st-degree, 598 2nd-degree, 14 bridges) that
  seeds deterministically, so every view can be explored before importing anything real.
- An empty state offering the three ways in, replacing a blank first run.
- `npx six-degrees` — a single-command launcher on port 6363 with its own data directory.
- Reference scoring model (`scripts/score_new_connections.sql`), transcribed to `lib/rpc.js`.

### Added
- A **Scan** page that runs the scraper for you. It checks what is missing, installs it,
  opens LinkedIn so you can sign in, and runs the scan — with the live log on screen.
  No second terminal, no server to start, nothing to copy and paste.
- Scanning a company or auto-bridging can now be run from the command line too
  (`--company "Acme"`, `--auto-bridge`); they used to exist only behind the old server.

### Added
- The Scan page now covers 2nd-degree mapping as its own step, in batches of 10, 25 or
  50 people, with a **Stop** button. Stopping closes the browser cleanly and keeps
  everything found so far.
- `--max-bridges` caps how many people one run will visit.

### Added
- Choose which tiers the 2nd-degree scan works through. It always resumes where it left
  off — anyone still without a mapped circle, highest tier first, including people you
  have connected with since the last run — so there is nothing to remember and nothing
  to reset.

### Fixed
- The packaged Mac app could ship without part of Next's server runtime, leaving every
  page working and every API call failing. The rule that keeps build artefacts out of the
  bundle was matching Next's own `dist` folder too.
- Leaving the Bridges view no longer throws. A resize callback could run once after the
  view had gone and read something that was no longer there.
- Scan, Profile, Import and Outlink scroll again. A rule that exists so the map can fill
  the window was applied to the whole app, so on every other page anything below the
  fold was rendered but unreachable.
- `npm run dev` now says when another copy is already serving on one of its ports,
  instead of silently starting on a different one while your browser shows the old.
- Resuming a scan no longer re-scrapes people you had already done. Past 2,000
  second-degree records the check for "who is already mapped" was silently returning a
  partial answer, so finished bridges looked unfinished.

### Changed
- Orbit now draws the shape of your network rather than every person at once. The people
  whose circle you have opened are large and named, their circle gathers tightly around
  them, and everyone else is a small dot until you hover or select them. On a 750-person
  network that is a third fewer things on screen and no photographs to load for anyone
  but the hubs — so it is quicker, and there is something to look at.

### Changed
- The 2nd-degree scan now defaults to 10 people at a time instead of 25, and says why:
  during development a real account was temporarily restricted after about 19 in one
  sitting. Shipping a default above the only number we have measured is a default that
  can hurt whoever trusts it.

### Fixed
- A photo is only ever saved for one person now. If the same picture comes back for
  somebody else — which is what happens with LinkedIn's placeholder silhouette, and with
  anyone the scraper mismatched — it is skipped and they show their initials instead.
- Second-degree people no longer end up wearing someone else's profile photo. The bridge
  scraper matched people by the text of their link, and everyone LinkedIn shows as
  "LinkedIn Member" shares that text — so they all inherited the first one's picture and
  profile. `npm run audit:avatars` reports any already saved that way, and `--fix` clears
  them back to initials without re-scraping anything.
- Connecting with someone you met through a bridge now registers. They used to stay a
  2nd-degree contact forever — the import saw they were already on file and skipped
  them — so the outreach you actually completed never showed up in your network.
- Their card now says who introduced them, and keeps saying it after they become a
  direct connection.
- The Revolver dial shows every bridge it can fit rather than a fixed twelve — around
  forty on a normal window — shrinking them as the ring fills and naming only the
  selected one once names would overlap. It still pages when there are genuinely too
  many, and says so. It held the twelve with the largest circles and said nothing about
  the others, so lower tiers looked as though they did not exist — while the filter
  beside it was counting them.
- Stopping a run no longer leaves a browser window open behind it. The scraper is
  started in its own process group and asked to stop rather than killed, so it closes
  the browser and reports what it managed to do.
- Auto-bridge no longer stalls on people whose connections are hidden. It notes them,
  moves on, and does not try them again — they used to reappear at the top of the list
  on every run, so the same few profiles were retried forever and the feature looked
  stuck. `--retry-private` gives them another go; `--clear-skips` forgets all of them.
- The wait after a hidden profile is now seconds rather than two minutes. The long pause
  is for runs that actually walked LinkedIn; a hidden profile was a single page view.
- A hidden or unavailable profile is recognised in seconds instead of costing the full
  page-load budget twice over.
- Auto-bridge prints a countdown while it waits, so a pause cannot be mistaken for a hang.
- The scraper now collects your whole connections list. It was reading only the first ten
  people: the list sits in its own scroll container, so the page-down it performed never
  scrolled anything and no further connections ever loaded.
- Everyone is collected, not just people with a profile photo. Names now come from the
  profile link rather than being guessed by comparing the start of a name against the URL.
- Signing in waits for you instead of against you. There is no countdown; close the browser
  window to cancel. It also detects the sign-in wherever you finish it, including in a
  second window.
- `--login` signs in and exits, so a first run is not a sign-in and a scrape at once.
- A scrape that cannot read the page now says so and stops, instead of reporting that you
  have no connections.
- Every scan button in the app works again. The buttons on the map, the profile page and
  the paths page all quietly pointed at a separate server on port 5555 that no longer
  exists, and told you to double-click a file that no longer exists either. They all run
  through the app now.
- Filtering connections by scanned company was silently ignored and returned everything,
  because that field was missing from the query allowlist.
- The scraper's packages install into their own environment, so an install can no longer
  succeed against one Python while the scraper runs on a different one that lacks them.
- Scraped people are attached to your profile, so a finished scrape can no longer leave the
  app showing an empty network.

### Changed
- The data layer is now local SQLite via Node's built-in `node:sqlite`. The hosted Postgres
  dependency is gone: no account, no keys, no service. Runtime dependencies are `next`,
  `react`, `react-dom` and `d3`.
- All database reads go through the server; no browser-side database access remains.
- Avatars and the scraper's Chrome profile live in `~/.six-degrees`, never the package directory.

### Security
- Destructive API routes are open on loopback, require `ADMIN_TOKEN` as a bearer from any
  other host, and fail closed when exposed with no token set. The gate keys off the server's
  own bind address rather than the `Host` header, which a caller can forge.
- Cross-site writes are refused on every API route, so a page on another site cannot drive
  this app through your browser.
- Values from the database are escaped before rendering; graph tooltips no longer build
  markup from stored strings.
- CI fails the build if a credential, an exported CSV, real avatars, or a non-synthetic
  network snapshot is ever committed.
