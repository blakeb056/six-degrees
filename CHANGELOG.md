# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **The Mac app scans with nothing to install.** It carries its own Python (3.12) with the
  scanner's packages already inside it, so the Scan page's first step is ticked from the
  start: nothing to install, nothing to click, and setting up needs no internet. Scanning
  still needs Google Chrome. The download grows by about 22 MB, to about 220 MB.
  Playwright's own copy of Node isn't duplicated: it runs on the one the app already has.
  The Python inside is signed like the rest of the app, uses only its own packages, and
  never writes into the app.
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
  toward them. A pick is one of twelve broad industries or one of 44 narrower sectors from a
  built-in directory (Dental, Real Estate, Software & SaaS, Insurance, K-12 Education…):
  open an industry to see its sectors, search by a job, a kind of business or a company
  ("dentist", "bakery", "Stripe"), or take a sector suggested from your own network
  ("Dental: 42 people at 17 companies"). An industry includes its sectors: it counts each
  company whose one industry it is and any company in one of its sectors, so Healthcare &
  Biotech takes in a practice only the directory calls dental. A directory sector goes by a
  fixed list of words, as whole words, in the company's name or in the headlines of at least
  half of the people you know there; for a one-person company, that person decides. Nine
  sectors are work every kind of company has (HR & Recruiting, Marketing & Advertising, PR &
  Communications, Accounting & Tax, Legal, Management Consulting, Software & SaaS, AI &
  Data, Cybersecurity): for those a job title in a headline doesn't count, so "Recruiter at
  Acme Widgets" doesn't make Acme a recruiting firm and "Software Engineer at Chase" doesn't
  make a bank a software company; the company's name ("Acme Staffing", "Smith CPA") or a
  kind of firm ("staffing agency", "law firm", "SaaS") does. There's no AI and nothing is
  sent anywhere: the same words give the same answer on every computer, and anyone can add
  to the list. Companies in your sectors get +1 ("lean") or +2 ("strong") on their score,
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
  Refused while a scan runs, scans wait until the import is finished, and the import waits
  while another copy of Six Degrees has the same folder open.
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
  first: everything it downloads is a pinned file.
- **The scanner's Python packages are pinned**: exact versions (Playwright 1.63.0, requests
  2.34.2, Pillow 12.3.0 and everything they need) and the checksum of every file pip may
  install. Only ready-built files (wheels), so nothing is built from source on your
  computer, and pip refuses any file that isn't the one pinned. They need Python 3.10 or
  newer, as the newest Playwright does; a Python that already has the scanner's packages
  keeps working as it is.
- **The Queue and the person panel go by company scores, not a list of names.** Both kept
  their own list of one person's favourite companies (Snap, Polymarket, Whatnot…), matched
  anywhere in a headline: "Metadata Analyst" counted as Meta, "Snapdragon" as Snap, and an
  ex-Googler as someone at Google. Now the Queue adds its +1 when the company someone's
  score is built on scores 8 or more, once, and the panel's "top-tier company" and "former"
  notes name a company that scores 8 or more, with its score. That's the curated list's
  major companies and up, or any company you score that high on Paths → Scores or lift there
  with *Your sector*.
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
  once to keep the old scores as your own: keep all, choose, or no thanks. Not for a new
  database, a CSV import or the sample. Your network is rescored once, automatically, on the
  first load after updating.
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

### Fixed
- **Students and school clubs read the same at every school.** The title rules named two
  schools, UCF and UF: "President, UCF Marketing Club" counted as a student's club role and
  "CS @ UCF" as a student, while "VP, NYU Finance Society" counted as a VP and "CS @ NYU" as
  someone working at NYU. A school's short name in capitals (UCF, NYU, USC, BYU…) now counts
  for every school, and an alumni club or a parents' association is no longer taken for a
  student club.
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
  anything changes ([SECURITY.md](SECURITY.md)).

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
