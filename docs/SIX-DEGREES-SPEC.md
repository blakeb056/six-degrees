# Sixgree — Specification

The brain describes how things *are*. This says how they **must be**. When they
disagree, the brain is stale.

## What this is

One claim, made playable: **within six professional hops you can reach almost anyone.**

Import or scrape your connections → score each person 0–10 on career leverage →
render the network as a force-directed galaxy → rank into S/A/B/C/D tiers, surface
**bridges** (people whose own circle opens doors), and track who you have reached out to.

## Invariants

These are load-bearing. Breaking one is a breaking change, not a refactor.

1. **Local-first, permanently.** The database is a SQLite file on the user's own
   machine. No account, no API key, no hosted service that can bill them, rate-limit
   them, or disappear. A build that requires a network call to function is wrong.
2. **No telemetry. No analytics. No automatic update check. Ever.** Not opt-out —
   absent. This tool reads a person's professional network; it must never be able to
   report on it, and it must never make a request nobody asked for.
   The one permitted exception is narrow and worth stating precisely: a **button the
   user presses** may ask whether something newer exists (`/api/update`). For a git
   checkout that is `git fetch` / `git pull` against the remote it already has; for an
   installed copy (the Mac app or the npm package) it is one GET for the newest GitHub
   release's version number. In the Mac app, a **second, separate press** ("Install and
   restart", offered only after that answer) may then download that release's disk image
   and its `SHA256SUMS` from the same GitHub release, and replace the app with it once
   both check out. That is always `releases/latest`, and only the version that answer
   named: if a newer one has come out since, nothing is installed and a new check is
   asked for. Never a pre-release, never a version the page names, never the data folder,
   and nothing is downloaded before the press.
   Otherwise the user runs the update themselves. Either way it sends nothing about them
   beyond the requests, runs only on a click, and is what they would do by hand. Anything
   that checks, downloads or installs on a timer, on launch, or in the background is the
   forbidden thing. *(The second press was added on 2026-09-25, for the Mac app only.)*
3. **Never commit real network data.** Not a CSV, not an avatar, not a snapshot. CI
   fails the build if any appears. The sample network is generated and every person in
   it is invented.
4. **The server binds to `127.0.0.1`.** Locality is proven by the bind address, never
   by a request header — every header a client sends can be forged. See TRAPS §2.
5. **The user's credentials are never seen, asked for, or stored.** Sign-in happens by
   hand in a real browser window; the scraper only ever inherits the resulting session.
6. **Scoring ranks reachability, not people.** The README says so and it stays said. A
   tier is a statement about network position, not human worth.

## Safety: what always applies

Scanning runs the user's own LinkedIn account, so some protections are not settings.
**Blake, 2026-10-05:** *"we need to simplify this and allow more usage as it's constrained
too much. Just a simple default limit for the day and a button to lift restrictions for
this session."* So there is **one limit**, searches a day (50 by default, profile views
counted against the same number), and **Lift limits for this session**, which turns the
daily limit and the cooldown off until the app restarts. It lives in the server's memory,
never in a file, and LinkedIn pushing back again puts the limits back by itself. The
monthly budget, the separate profile-view cap and Auto scan's own day and week caps are
gone.

These hold **always, lifted or not**, because they protect the account and cost the user
nothing:

1. **The pace.** The fixed waits before every page and search (the chosen speed), Auto
   scan's hours and rests, and at least a minute between any two profile views. Never
   shortened. *(Blake, 2026-10-05: gentle pacing, on by default, adds a random,
   skewed extra after each of those waits, reading time, a scroll through each
   page and now and then a break: only ever more waiting, never less, and off it
   is the old fixed waits exactly. Read profiles keeps the minute between views.)*
2. **Stopping when LinkedIn asks.** A sign-in wall, a security check, a restriction or
   LinkedIn's own limit ends the scan, keeps the page as evidence and writes the pause
   (TRAPS §35). Never help anyone get past one (TRAPS §16).
3. **One scan at a time**, and the queue, with every check run again at each item's turn.
4. **The honest risk note before the first scan** (the one-time *I understand*).
5. **Auto's caps on connection requests** (15 a day, 80 a week): a request is the one
   thing Sixgree sends.

Lifting is one click with the line that says what it does, never a pop-up; a lift that
outlived a restart, or one that removed any of the five above, is a breaking change.

## What "done" means for a change

- `npm test` passes (37 tests, `node --test`, no test framework dependency).
- `npm run lint` is clean.
- `npm run build` succeeds on Node 22 and 24.
- CI's secret/PII guard passes — it greps for JWT shapes, real CSVs, `public/avatars/`,
  and a `demo-data.json` missing its `"synthetic":true` marker.
- Anything a user would notice has a CHANGELOG entry **in the same commit**.

## Rejected by design

Written down so the same idea does not arrive every few months looking fresh.

| Idea | Why not |
|---|---|
| Hosted/multi-tenant version | Invariant 1. The moment there is a server, there is a breach surface holding other people's networks. |
| Telemetry, even anonymous | Invariant 2. There is no version of "just crash reports" that is safe for this data. |
| `better-sqlite3` | A native module whose prebuild fails silently on some machines, turning a first run into a compiler error. `node:sqlite` ships with Node ≥22.13 and cannot fail that way. |
| TypeScript rewrite | Tried as v2, abandoned. The rewrite cost the features that make the tool interesting (outreach queue, XP, the deep Paths explorer) and its scraper was never run against live LinkedIn once. |
| Porting the scraper to Node | 381 of `scrape.py`'s lines are in-page JavaScript, and the Python one is the only implementation that has ever actually scraped. A port would be a rewrite of the one component with no test coverage and a live dependency. **Re-examined 2026-09-24 and still rejected:** the goal it would serve (no Python to install) is met by shipping Python inside the app (`brain/DESKTOP.md` D2). That note lists the gates a port would have to pass (D5). |
| LinkedIn's official API | It cannot return a connection list. Not a restriction to negotiate — the capability does not exist. |
| Voyager (LinkedIn's internal HTTP API) | Requires forging an authenticated internal client. More fragile than the DOM and unambiguously adversarial. |
| Defeating Google's OAuth block | Google blocks its sign-in flow inside automation-controlled browsers deliberately. Working around an anti-automation control is out of scope; the tool tells the user to use email and password instead. |
| A login gate on the local app | It runs on `127.0.0.1`. A password on a loopback service is theatre that costs real usability. |
| Auto-updating, or checking for or downloading updates on launch | Invariant 2. A request nobody asked for is a request that can be counted. Checking is a press; in the Mac app, installing is a second press. Neither ever happens by itself, and nothing is downloaded ahead of time. |
| A monthly budget, per-speed caps, or a lift that survives a restart | Blake, 2026-10-05: one daily limit and a lift for the session. More limits were what made it "constrained too much"; a lift kept on disk would outlive the session it was asked for. |
| Discarding a user's local changes to force an update | The update refuses on a dirty tree and says which files. The single exception is `package-lock.json`, which npm regenerates and nobody edits on purpose. |
