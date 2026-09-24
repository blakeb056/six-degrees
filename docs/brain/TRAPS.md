# Traps

Everything here cost real debugging time at least once. Read before changing the area
it describes. Ordered roughly by how expensive the lesson was.

---

## 1. `lib/db.js` mutates and returns `this`

The query builder is **not** immutable. `app/api/notifications/route.js` calls
`q.eq(...)` without reassigning the result and depends on the filter applying anyway.

Refactoring to an immutable builder is the kind of change that looks like an
unambiguous improvement and passes every test — while silently dropping that filter.
No error, no failing test, wrong data.

If you ever do make it immutable, you must fix the call sites in the same commit and
add a test that would catch the regression. One exists already:
*"filters applied without reassignment still take effect."*

---

## 2. No request header can prove where a request came from

Found by attack, not by review. The destructive-route gate originally trusted the `Host`
header. From another machine on the same WiFi, with `Host: localhost` set by hand,
`/api/delete-cluster` **reached its handler**.

`X-Forwarded-For` is no better — Next passes through whatever the caller sends.

The fix is not a smarter header check. There isn't one. Locality is proven by the
server's **own bind address** (`SIX_DEGREES_BIND`), which the client cannot influence.

Regression test: *"REGRESSION: request headers cannot buy access on an exposed server."*

---

## 3. LinkedIn avatar URLs expire in about three weeks

`media.licdn.com` URLs are **signed and time-limited**. Store one and the photo becomes
a broken image roughly three weeks later — this was the "question marks over the dots"
bug, and it looked like a rendering fault for weeks.

`scripts/image_store.py` downloads and re-encodes each avatar to a permanent 96px WebP
in the data directory while its URL is still fresh, and the database stores that local
path. Capture happens **at push time**, not lazily, because a lazy fetch is a fetch
against an already-expired URL.

---

## 4. `readFileSync(process.cwd() + ...)` breaks in an installed package

The schema used to live in `db/schema.sql`, read relative to `process.cwd()`. That
resolves against whatever directory the *user* ran the command from — fine in a
checkout, broken the moment the package is installed and launched via `npx`.

It is now `db/schema.js`, a module exporting a string. Imports resolve relative to the
module, not the caller. The same reasoning applies to any asset the runtime needs: if it
must exist at runtime, import it, do not read it by path.

---

## 5. Never key on a LinkedIn CSS class

They are hashed per deploy: `_8e33b2ac`, `c313cecd`, `_952d2cfe`. A selector built on
one works until LinkedIn ships, then fails silently and looks like an empty network.

Anchor on the **profile link** (`a[href*="/in/"]`) — the one thing that cannot change
without breaking LinkedIn's own product. See [`SCRAPER.md`](SCRAPER.md).

---

## 6. `window.scrollTo()` does nothing on the connections page

The connections list lives inside `<main>`, which is its own scroll container
(`overflow-y: auto`). The window never scrolls: `window.scrollY` stays `0` and
`document.body.scrollHeight` equals `window.innerHeight`.

The scraper called `window.scrollTo(0, document.body.scrollHeight)` to paginate. It was
a **no-op**. LinkedIn renders ten people at a time and loads more on an intersection
observer, so every run ended with the first ten — and reported it as success.

Find the real scrolling element and set its `scrollTop`, **and** send a genuine
`page.mouse.wheel()` so the observer fires. Both, not either.

---

## 7. A swallowed error becomes a confident wrong answer

The extract call was wrapped in `except Exception: rows = []`. When the injected
JavaScript failed, every round returned zero rows and the run printed "0 collected" —
identical to genuinely having no connections.

It hid a real bug for months, because "found nothing" reads as a LinkedIn problem rather
than a code problem. **A scraper that cannot read its page must say so.** It now prints
the error and aborts after three consecutive failures.

Generalise this: any `except`/`catch` that turns a failure into an empty result is a
place where a bug can hide indefinitely.

---

## 8. `prepack` re-runs the build and wipes the standalone output

`prepack: npm run build` runs *after* the static-copy step, deleting `.next/standalone`'s
copied assets. The packaged app then served 404s for every CSS and JS file while looking
completely fine locally.

`scripts/prepare-standalone.mjs` is the **last step of `build` itself**, not a separate
lifecycle hook. Verify packaging by installing the tarball, never by reading the config.

---

## 9. A row with a NULL `user_id` is invisible forever

Every view filters by user. The CLI scraper wrote rows with no owner: 752 connections
landed in the database and the app still showed its empty state — which looks exactly
like a scraper that did nothing.

`resolve_active_user()` adopts the app's answer to "which profile is you" —
`SIX_DEGREES_USER_ID` when the app runs it, otherwise `GET /api/users?me=1`. Any new
write path must do the same. See §25 for why it no longer refuses on more than one.

---

## 10. Hydration errors have two causes, and fixing one is not enough

`/launch` threw a hydration mismatch. The first fix — replacing nondeterminism with a
seeded hash — was necessary and insufficient.

The real remaining cause was **float precision**: the server rendered
`2.570325822001905s` and the browser rounded it to `2.57033s` on parse. Values written
into style attributes must be rounded **at the write point**, not trusted to match.

---

## 11. Stored XSS through d3's `.html()`

`.html()` is `innerHTML`. Six data sinks in `ForceGraph.js` passed scraped strings —
names and headlines from LinkedIn, i.e. attacker-controllable — straight into it.

Chained with a cross-site write, this was a working end-to-end exploit; it was
reproduced before being fixed. All six sinks are escaped via `esc()`, and images are
built with `.append('img').attr('src', src)` through `safeImageUrl()`, which allows only
a local `/avatars/` path or an `https:` URL — never string concatenation.

Treat every scraped field as hostile input. It came from a web page.

---

## 12. Google and Apple SSO cannot work in an automated browser

Google blocks its OAuth flow inside automation-controlled browsers by policy. The sign-in
window opens **greyed out** and never completes, which reads to a user as a crash.

There is no flag or user-agent trick worth building, and building one would mean
defeating an anti-automation control. The scraper says so on screen *before* the user
tries it. If an account only has a Google login, the user must set a LinkedIn password.

---

## 13. Do not bind a login wait to one `Page` object

Signing in can open a second window or replace the tab. A poller holding one `Page` then
watches something the user has already navigated away from — waiting forever while the
session it wants sits in the cookie jar.

Poll the browser **context** for the `li_at` cookie. Treat "every window closed" as
cancel, not "this page closed" — signing in legitimately opens and closes tabs.

---

## 14. `python3` is usually the wrong Python, and pip will refuse it

Two traps that compound, and together they are why a careful hand-install could look
like it worked and still leave nothing working:

1. **`python3` on `PATH` is often Homebrew's**, while the interpreter that actually has
   Playwright is `/usr/bin/python3`. Install into one, run the other, and the result is
   indistinguishable from a broken install. Verified on this machine: `python3 -c "import
   playwright"` fails while `/usr/bin/python3 -c "import playwright"` succeeds.
2. **Homebrew and system Pythons are externally managed (PEP 668)** and refuse
   `pip install` outright. The error mentions `externally-managed-environment`, which
   most people read as a dead end rather than as "use a venv".

So never resolve the interpreter by name. `app/api/scraper/route.js` probes candidates
for `import playwright, requests, PIL` and picks one that **actually works**, and its
install path builds a virtualenv in the data directory rather than touching the
machine's Python. A venv is immune to both traps and is deleted with the data folder.

---

## 15. A queue defined by absence retries its failures forever

Auto-bridge picked its work with "every 1st-degree person who has no 2nd-degree
rows". Someone who hides their connections can never *have* 2nd-degree rows — so
they came back in the list on every run, and because the list is sorted by tier and
score, the same person was retried in the same position every time. Each attempt
cost the full profile-load budget plus a two-minute cooldown, so a few hidden people
near the top made the whole feature look hung rather than slow.

Two fixes, and the first is the one that matters:

- **Record the attempt, not just the result.** `bridge-skips.json` in the data
  directory remembers who was hidden; `--retry-private` (or the app's retry action)
  is the way back in. Absence of a result is not the same as absence of an attempt.
- **Price the cooldown by what actually happened.** A real scrape walks many search
  pages and earns the full pause. A hidden profile was one page view — charging it
  two minutes is what turned a run of them into an apparent hang.

Also here: the loop now catches `BaseException`, not `Exception`. A `SystemExit`
raised deep in a helper would otherwise end the whole run while looking like a
clean exit, which is the least debuggable failure of the set.

---

## 16. LinkedIn restricts accounts for sustained scraping — measured, not theorised

On 2026-09-09 a real account was temporarily restricted after roughly an hour of
continuous auto-bridging:

> *"We restricted your account because we detected that over time, it has accessed
> an unusually high volume of LinkedIn profile data."*

Twenty-four hours' notice, lifted the same evening. A warning had appeared during
the run, before the restriction landed.

At the two-minute cooldown then in force, an hour is roughly **20–25 profiles**.
That is the only real number this project has, and it is a ceiling observed once —
not a safe limit. The trigger is *profile views over time*, so the connections
scrape (one page, several hundred people) is cheap and bridge mapping (one profile
view each, plus a search walk) is what costs.

What this means for the code:

- **Batching is the default, not an option.** The Scan page offers 10 / 25 / 50 and
  `--max-bridges` caps a run. An open-ended "map everything" is how you get here.
- **The cooldown is a real feature.** Do not shorten `BRIDGE_COOLDOWN` to make
  testing faster; that number is the whole safety margin.
- **Stopping must be immediate and clean**, because the moment to stop is usually
  the moment a warning appears. SIGTERM sets a flag, the loop exits between people,
  and the browser closes itself.
- **Never help anyone evade a restriction.** If an account is restricted, the answer
  is to wait it out and scrape less — not to rotate anything.

The README and `docs/SCRAPING.md` already say accounts have been restricted for this.
This entry exists so the warning carries a number and a date instead of being generic.

---

## 17. Animation frames do not arrive in a hidden tab — so never commit state in one

Both ported views drove their transitions with `requestAnimationFrame`, which is
correct for animation and stops entirely in a background or hidden tab. The bug was
what else lived there: the rotary dial **committed the selection inside the tween's
completion callback**, and the galaxy painted its first positions on the first tick.

So in a background tab, clicking a bridge changed nothing at all, and the graph sat
stacked at the origin. Both now have a timeout behind the frame loop that lands the
final state whether or not a frame ever comes.

The general rule: rAF may own *how a change looks*, never *whether it happens*.

This also cost real debugging time in the other direction — a hidden preview pane
makes a working view look broken in exactly the same way. `document.hidden` is the
first thing to check before believing a rendering bug.

---

## 18. Adding a view used to need three files to agree

A visual meant a branch in `page.js`'s switch, a row in `FilterPanel`'s own menu list,
and a hand-picked set of props — each view took a slightly different shape, so the
wiring was the part that broke. A view offered in the menu but missing from the switch
renders nothing, and nothing tells you.

`app/components/views.js` is now the single source: component, modes, and any
exception. Both the renderer and the menu read it, and every view receives the same
props object and destructures what it needs. Adding one is a row plus a component.

The one declared exception is Orbit's `allDegree2` — it draws each bridge's circle in
both modes and narrows to visible bridges itself. It sits in the registry rather than
in a branch, because an exception you cannot see is one you break later.

---

## 19. A 2nd-degree person you connect with used to vanish

The ingest route decided what was new with a check that was **not degree-aware**: any row
with that `profile_url` counted as "already on file". It then refreshed the existing ones
with `.eq('profile_url', …).eq('degree', 1)`.

For someone whose only row was 2nd-degree, both halves missed. The insert skipped them
because a row existed; the update matched nothing because that row was degree 2. **They
stayed a 2nd-degree contact forever, no matter how many times you re-scraped**, and the
path that produced them was never recorded.

This is the failure mode the tool exists to prevent — you did the outreach, they accepted,
and the graph did not notice.

`lib/promote.js` now owns the transition and keeps the two provenance ideas apart:
`source_connection_id` (whose circle they are in — cleared) versus
`unlocked_from_bridge_id` (who introduced them — permanent). It is idempotent, and it
folds away duplicate rows for the same person rather than leaving them.

Covered by `tests/promotion.test.mjs`, including the assertion that matters: **the origin
survives a second promotion.**

---

## 20. The bridge scraper handed one person's face to everybody

Same root cause as §5, in the half of the scraper that was left alone. It built a
**name → URL map keyed by the anchor's text**, first one wins:

```js
if (!urlMap[text]) urlMap[text] = url;
```

Any two results sharing display text collapse onto one URL — and **"LinkedIn Member" is
the anchor text for every out-of-network person** in a 2nd-degree search. All of them
therefore resolved to the first one's profile URL, and wore the first one's photograph.

The connections-page rewrite fixed this pattern in one place and left it in the other,
which is exactly how a fix creates a false sense of safety. Verified by counting: the
connections-scraped database has **zero** shared photos across 746 people; the
bridge-scraped one had many.

`scripts/audit-avatars.mjs` (`npm run audit:avatars`) finds them, `--fix` clears them so
those people fall back to initials, `--prune` also deletes the duplicate files. **A wrong
face is worse than no face**, and it needs no re-scrape — which matters when the account
is rate-limited.

### Comparing URLs finds almost nothing — compare the pictures

The first version of that audit grouped by `profile_image_url` and reported four people
on a database with hundreds of wrong faces. Two reasons, and both matter:

- **LinkedIn signs every image URL** — `…?e=1789592400&v=beta&t=VOCHTeNAhBd…`. The same
  picture fetched twice comes back under two different URLs, so string comparison sees
  two unrelated images.
- **Captured avatars are named `sha1(profile_url).webp`** — after the *person*, not the
  picture. One photo handed to fifty people becomes fifty distinct files with identical
  bytes.

So the audit hashes the file contents. It also reports how many photos are still remote
rather than captured, because those genuinely cannot be compared and would otherwise
look like a clean result.

**The general lesson: when the identifier is derived from the wrong thing, comparing
identifiers proves nothing.** Compare the artefact.

### The real fix is at capture, not at repair

Cleaning up afterwards is a script you have to remember to run. `store_avatar()` now
hashes the downloaded bytes **before** re-encoding and refuses to save a picture already
claimed by somebody else in that run — so two fetches of the same image under different
signed URLs collide and only the first person keeps it.

Measured on a real database before the guard existed: **2,821 of 3,486 photographs were
shared**, across 170 distinct pictures, some by more than ninety people. Most of those
are LinkedIn's placeholder silhouette for people with no photo; the rest are genuine
mis-attributions. From inside `store_avatar` the two are indistinguishable, and **both
are wrong to save**. Initials are honest; somebody else's face is not.

---

## 21. A limit on a query is a wrong answer waiting for scale

Auto-bridge worked out who still needed a circle by pulling every 2nd-degree row and
collecting the distinct source ids — `"limit": "2000"`.

Past two thousand 2nd-degree rows, that answer is **silently wrong in the dangerous
direction**: bridges that had been mapped came back as unmapped, so a resumed run
scraped them again. On a real database with 2,738 rows, 738 were invisible — and the
cost is not a wasted loop, it is rate limit spent on work already done, against an
account that gets restricted for exactly that.

Ask the question you actually mean. `/api/bridges` returns one row per bridge — a few
dozen instead of a few thousand — and has no limit to outgrow. The 1st-degree list still
carries a bound, but a high one, and it now says so out loud when it hits it rather than
quietly returning a short list.

**Where a limit exists and truncation is possible, either the query is wrong or the
truncation has to be visible.**

---

## 22. Two ways a change can look like it never shipped

Blake pulled, restarted, and could not find two features that were on his disk, in the
right file, on the right commit. Both causes were environmental, and both are now
guarded because "remember to do X" is not a fix.

**A dev server serves what it had at launch.** Started before a `git pull`, it keeps
serving the old code — and starting a second one does not replace it, because Next
quietly takes the next free port while the browser stays pointed at the first. Three
servers were live at once on one machine during this session. `predev` now runs
`scripts/check-stale-server.mjs`, which names what is already listening and gives the
line to replace it.

**`body { overflow: hidden }` made every document page unscrollable.** It exists so the
graph canvas can fill the window, but it applied to the whole app: on Scan, Profile,
Import and Outlink, anything below the fold was rendered, mounted, *running* — and
unreachable. The tier picker and the update panel were on screen the whole time, past
the bottom edge, with `/api/update` visible in the server log proving the component was
alive.

The rule now sits on the map page itself (`body:has(> div > [data-map])`) rather than on
`body`. **A global that exists for one page will be wrong on every other one.**

The tell, in hindsight, was in the server log: `GET /api/update 200`, twice. Only that
component calls it. The code was running; the pixels were off-screen.

---

## 23. `git pull` refuses here, and says so in one line you will miss

`npm install` rewrites `package-lock.json` whenever the local npm differs from the one
that produced the committed file. Two machines with different Node versions therefore
have a permanently dirty tree, git will not pull over local changes, and it exits after
printing a single line.

Everything after that behaves normally. `cd`, `npm run dev`, the browser — all fine, all
serving the old code. Blake hit this repeatedly and reasonably concluded the update had
not worked, because from the outside it had not.

`npm run update` (`scripts/update.mjs`) discards **only** the generated lockfile, refuses
outright if anything else is dirty, pulls, installs, and says to restart the server. The
Scan page's Update button does the same through `/api/update`.

While writing it I reproduced TRAPS §20 exactly: `.trim()` on `git status --porcelain`
strips the leading space from the first line, so `slice(3)` ate a character and the
script reported `ackage.json`. **The same mistake, in the same session, in a second
place** — which is the argument for the rule being written down rather than remembered.

---

## 24. A tracing exclude of `dist/**` can delete Next's own server runtime

Reported from the second machine: `npm run build:app` produced an app whose pages
rendered and whose every API route returned 500, with "Cannot find module" in the log.

`outputFileTracingExcludes` was set to `'*': ['dist/**', ...]` to keep a previous
packaging run out of the next bundle (TRAPS context: that bloat took a 70 MB image to
361 MB). But Next matches those globs with picomatch in **contains** mode, so `dist/**`
also matches `node_modules/next/dist/**` and can strip the server runtime the API routes
need. The page still renders, because the client bundle is separate. Nothing says why.

Now scoped to the artefacts by name: `dist/*.app/**`, `dist/*.dmg`, `dist/staging/**`.

**Honesty about the evidence:** this was never reproduced on the first machine. Fresh
builds there returned 200 on every route before the change and after it. The fix went in
because the hazard is real and specific regardless of whether it currently fires, and
because a glob that can silently delete a dependency is not worth keeping for brevity.
If it reappears, the likely difference is the resolved Next version between machines.

Smoke test after any change here: build the app, launch it, and curl every API route.
A rendering page proves nothing about the routes.

---

## 25. Asking for a name made duplicate profiles, and duplicates hid everything

The first screen used to ask "what's your name?" on any browser it had not seen, and
browser storage is per-origin — the packaged app (`127.0.0.1:6363`) and a dev server
(`localhost:3000`) are strangers to each other. Every answer that did not exactly match
an existing name made a new, empty profile. With more than one profile the app would
not guess and asked again, and the scraper refused to run at all.

It ran for two weeks on the maintainer's own machine: a real network under one
profile, two empty ones typed on 2026-09-10, the data invisible in any new browser and
every scan stopping at "exit 1". The refusal *was* printed — but to stderr, and the
Scan page only surfaced stderr lines containing words like "error", which that
message did not. So a correct refusal became an unexplained failure.

Fixes, and the rules they leave:
- **The server decides who "you" are** (`lib/profile.js`): the profile owning the most
  connections, oldest on a tie; one is created on a fresh install. The browser only
  caches it. Never reintroduce a prompt that can mint a profile.
- **The app names the profile to the scraper** (`SIX_DEGREES_USER_ID`), so they cannot
  disagree.
- **A failed run always shows its last stderr lines**, filter or not
  (`app/api/scraper/route.js`, `finish`). Filtering noise is fine while running; on
  failure the reason outranks tidiness.

---

## 26. A running Next server hides its own path

Next renames its process to `next-server (v16.x)`. Anything that finds "the app's
server" with `pgrep -f "<app path>"` finds nothing — the path is gone from the process
list. `install.sh` did exactly that when updating a running Mac app: it stopped only
the launcher, the old server kept serving the old version on 6363, and the new copy
opened on 6364 beside it.

Find the server by its **working directory** instead — the standalone `server.js`
changes into its own folder, so `lsof -a -d cwd -c node` shows it inside the app. And
the Mac launcher now traps its own exit and takes its server with it, so stopping the
launcher is enough for any copy built from here on.

---

## 27. The whole project folder is traced into the bundle — `.git` included

`lib/paths.js` looks around `process.cwd()` for the scraper, so Next's file tracing
treats the project folder as a dependency and copies what sits in it into
`.next/standalone`: the docs, the build logs, a stray clone — and `.git`. Inside the
Mac app a `.git` makes `isGitCheckout()` true, so the installed copy's Updates panel
would offer `git pull` against its own signed bundle.

`next.config.mjs` names `.git/**`, `*.log` and `scripts/dmg/**` in
`outputFileTracingExcludes` (specific names only — see §24 for why a loose glob is
dangerous); `build-app.mjs` removes a `.git` that slips through anyway, and lists any
uncommitted files it is about to ship. Releases build from a clean checkout; a local
build is the one that can carry somebody's personal file out of the folder.

---

## 28. Three things about a `.dmg` window that are not obvious

- **A symlink to `/Applications` draws as a blank dashed square on macOS 26.** An alias
  works, but only if it carries the folder's icon itself — Finder will not look through
  an alias on a disk image to draw its target. `build-app.mjs` makes the alias with
  Finder and sets its icon with `NSWorkspace`, and only ever on a regular file: set
  through a symlink, it would target the real `/Applications`.
- **Icon names are black in light mode and white in dark mode, whatever the picture.**
  So the icons sit on a mid-grey tray where both read at about 4.5:1.
- **The layout script is AppleScript inside a JavaScript string.** A `//` comment there
  is a syntax error, and 0.1.0 shipped with a plain window because of exactly that: the
  build caught the failure, printed a one-line warning, and carried on. It now compiles
  the script with `osacompile` before running it, prints the real error from any Finder
  step, and on CI refuses to finish without a `.DS_Store`. Dry-run the release workflow
  (`-f dry_run=true`) after touching any of this.
- **Ejecting right after Finder has styled the window can fail with "Resource busy."**
  Finder or Spotlight holds the fresh volume for a moment. It never showed while the
  styling step was silently failing, since Finder never opened the disk, and it showed
  the first time it worked: 0.1.1's first Intel release build died on it. `detach()` in
  `build-app.mjs` retries, plainly and then with `-force` — and, since 0.1.5's first
  Intel build, aims at the disk device once the mount point is gone: "Resource busy" can
  mean the volume unmounted and only the device eject failed, after which retrying the
  mount point just says "No such file or directory" forever.
- **Headless Chrome writes a screenshot and then does not exit** on some macOS
  versions, and a fresh profile can stall on a keychain prompt. `make-dmg-background.mjs`
  uses a stand-in keychain, waits for the file, and ends Chrome itself.

---

## 29. An invisible tooltip made the Galaxy rebuild itself in a loop

Hovering any dot in the Galaxy rebuilt the whole scene hundreds of times a second — about
250 rebuilds and 200,000 replaced elements in three seconds of a still mouse. The chain:

1. The hover tooltips were `position: absolute` with no `top`/`left` until first used,
   so they sat at their static position — below everything — and made the page 18px
   taller than the window.
2. On a Mac showing scrollbars (a mouse, an external display) that is a scrollbar, and
   the graph's container was 6px narrower.
3. Hovering gave the tooltip a position, the page fit the window again, the scrollbar
   went, and the container widened.
4. The `ResizeObserver` published the new size and the scene rebuilt — creating fresh
   tooltips at the bottom of the page. Scrollbar back, container narrower, rebuild…

It needs visible scrollbars, so a trackpad-only laptop never shows it. The rules it left:

- **Anything a component appends to `<body>` is `position: fixed`**, placed with
  `clientX`/`clientY`. A fixed element cannot change the page's size.
- **A resize that rebuilds the scene is debounced** (`ForceGraph.js`, 150 ms), so no
  flicker can drive a rebuild loop again.
- **What a scene-rebuilding component receives must be stable.** `app/page.js` memoises
  the filtered lists and the click handler; an inline `[]` or arrow function is a new
  value every render, and each one was a full rebuild. `ForceGraph` reads `onSelect`
  through a ref for the same reason.

How it was found: a `MutationObserver` on the `<svg>` counting added and removed nodes
while hovering, and a second one recording its `width` attribute, which flipped
1193 ↔ 1199 in step with the rebuilds.

---

## 30. A script as the app's executable runs under Rosetta — and so does everything it starts

The Mac app's `CFBundleExecutable` is a bash script. macOS cannot read a chip list out of a
script, so on Apple Silicon it ran the script under Rosetta (`sysctl.proc_translated` = 1 in
the launcher). The bundled `node` is arm64-only and so ran natively anyway, which hid it —
but the preference for Intel carried down the tree: `/usr/bin/python3`, a universal binary,
started from that server came up **x86_64**, and the arm64 Pillow in the user's
site-packages failed to load (`have 'arm64', need 'x86_64'`). Reproduced exactly with
`arch -x86_64 /bin/bash -c '<app node> -e <spawn python3>'` → x86_64, native bash → arm64.
The same launcher would also have started Chrome under Rosetta if it was not already open,
and on a Mac without Rosetta it would have asked to install it just to open the app.

**The fix is one `Info.plist` key**: `LSArchitecturePriority`, naming the build's chip.
Tested with a throwaway probe app that writes `sysctl.proc_translated` on launch: no keys → 1;
`LSRequiresNativeExecution` alone → still 1; `LSArchitecturePriority` = [arm64] → 0.

Two smaller lessons from the same bug:

- **An import check must load the compiled parts.** `import PIL` succeeds with a C extension
  for the wrong chip; `from PIL import Image` fails. The Scan page's check said "installed"
  while every scan died on import.
- **`uname -m` is not the hardware.** A Terminal under Rosetta reports `x86_64` on Apple
  Silicon. `install.sh` asks `sysctl hw.optional.arm64` before choosing a build.

---

## 31. JavaScript in a plain Python string is rewritten before the browser sees it

`page.evaluate(""" ... .split('\n') ... """)` does not send `\n` to the browser. Python
turns it into a real line break first, the string literal in the JavaScript is left
unterminated, and the whole function fails to parse: `Page.evaluate: SyntaxError: Invalid
or unexpected token`. That is what broke every 2nd-degree scan from 2026-09-09 (the commit
that anchored results on profile links) until 0.1.4: each person failed on page 1, the
batch moved on, nothing was read, and nothing paginated.

- **Every snippet of JavaScript in `scrape.py` is a raw string, `r"""…"""`.** Escapes such
  as `\u2019` and `\/` then reach JavaScript intact, which is where they mean something.
- **`tests/scraper-js.test.mjs` enforces it.** It asks Python for each snippet exactly as it
  would be sent — every `page.evaluate`/`wait_for_function` argument and every `*_JS`
  constant used that way — and parses them with V8. It failed on the old file and passes
  on the fixed one. No browser, no LinkedIn.
- **Code that has never run is not tested code.** The rewritten page reader had never
  executed once, because of this bug. Running it against a mock results page — with
  LinkedIn's `visually-hidden` CSS, which changes what `innerText` returns — found a second
  bug straight away: the screen-reader line "View … profile" saved as everyone's headline.
  Build the mock with the real site's CSS, or the mock lies in the other direction.

---

## 32. One repeated profile made a whole bridge's batch fail — and the run carried on

A 2nd-degree run read 134 of someone's connections, then: `Push error: 500 UNIQUE
constraint failed: index 'idx_connections_unique_per_user_bridge'` — `Done! 0 new`.

- **Why duplicates.** A person's results name more than the results: each card links the
  "mutual connections" too, and the same mutual connection turns up on many pages. The
  extractor de-duplicates within a page, not across pages, and the app inserted the batch
  as one statement — so one repeat failed the lot. Pages of 10 results were coming back as
  11–18 "found"; the extras were those links.
- **They were also the wrong people.** Mutual connections are your own connections. Stored
  as 2nd-degree they inflated every circle and duplicated your network — the 190 rows a
  full rescan later merged back (and gave some "introduced by" markers they did not earn).
- **The failure did not stop anything.** `push_connections` printed the error and returned
  0; the batch recorded the person as done and spent two more minutes, and more LinkedIn
  views, on the next one.

What holds it now: `lib/ingest.js` keeps each profile once and sets aside your own
connections before a 2nd-degree or company insert (with tests); the scraper de-duplicates
across pages before pushing; a non-200 save raises `SaveFailed`, which stops a batch with
the reason; and the ingest response says what was new rather than what was sent.

---

## 33. A rewrite that drops a field fails silently — twice over

The 1st-degree reader was rewritten on 2026-09-09 (anchor on the profile link, TRAPS §5) and
the new `CONNECTIONS_EXTRACT_JS` never read the "Connected on …" line. The old reader had.
Nothing failed: `connected_date` was simply null for every row, so:

- "Newest first" could only guess from when rows were saved — and a full scan that finds
  people an earlier scan missed saves *old* connections with a *new* timestamp. The queue
  started with someone connected long ago instead of the newest person.
- The scoring bonus for connections made in the last 30 days (`recencyBonus`, lib/rpc.js)
  silently never applied.

When replacing an extractor, list the fields the old one returned and check the new one
returns every one. The date is now read by climbing from each profile link to the nearest
block holding exactly one "Connected on" line (more than one means the climb reached the
list and would take a neighbour's date), and `lib/ingest.js` `toIsoDate` parses it by hand —
`new Date(text).toISOString()` shifts the day east of Greenwich and throws on bad text.

---

## 34. Every 2nd-degree read stopped at page 10, and nothing said so

Someone's connections ran to 30 or 50 pages; every read stopped at 10, and a whole list
of those looked finished. "Read up to 10 pages" was a default on the Scan page, the log
only mentioned the limit when it was *not* 10, and the last line was `Total: 98
connections`, which looks like the end. Asking for more pages didn't help either:
people already mapped were never queued again, so there was no way back for pages
11 onwards.

- **Nothing recorded how far a read got.** The only question the queue could ask was
  "has any of their circle been saved?" A read that stopped at 10, was stopped by hand, or
  ran into LinkedIn's monthly search limit counted as done, or (if the batch's save
  failed) started again from page 1.
- **The end of a list was one glance.** `is_visible(timeout=3000)` doesn't wait:
  Playwright ignores that timeout, so a pagination bar that rendered late ended the list
  there. A click that didn't move the page was treated the same way.
- **The log misdescribed the search.** It said "3rd+ filter"; the URL asks for 1st, 2nd
  and 3rd+.

What holds it now: every page by default, up to LinkedIn's own 100. The log states the
limit on every run and says when it stopped at one with more to read. The end of a list
takes three looks for Next, and a click that doesn't move gets three tries. Saves happen
every 10 pages. `bridge-progress.json` records the last page read and whether there was
more, and "finish people already mapped" carries on from it (people mapped before 0.1.6
count as read to page 10). A shorter read never winds the record back. The search limit
stops the batch after saving. `tests/bridge-progress.test.mjs` covers the record.

---

## 35. Reading fast got search blocked, and a block looked like ordinary answers

0.1.6 read a whole list at a page every ~6 s: 27 pages in about three and a half minutes,
at the end of a night of test runs. Page 28 never opened, and LinkedIn blocked the
account's search. Nothing was lost (the read had saved as it went and stopped as
"carry on from 28"), but an audit of what would have happened next was worse:

- **A block reads as normal outcomes.** A profile that won't load is "private" (and the
  person is skip-listed for good); a search that won't load is "empty"; a blank page is
  "the end of their list" (and a list being carried on is marked finished). Only one
  English phrase was treated as LinkedIn pushing back.
- **Failures sped the loop up.** The pause after a person with nothing was 15 s, against
  120 s after a real read, so a block produced a profile view and a search every 15 s.
- **A stuck page ended only that person.** The batch went on to the next one, straight into
  the same block.
- **The session cookie survives a security check**, and the cookie was the whole test for
  "signed in".
- **The real limit is monthly.** LinkedIn's Help Center (a564226): free accounts have a
  commercial use limit on people search that resets at midnight PST on the 1st, with no
  published number and a warning that "may not display if you run through the full amount
  of searches or views too quickly". Reports put it around 250–350 searches a month.
  Every page of someone's connections is one search.

What holds it now (0.1.7, a stopgap): 20 s before each page and 60 s more after every 10;
the full cooldown after any person; LinkedIn's own warning wording, security checks and
sign-in walls (when you were signed in) checked before every verdict, ending the batch and
keeping the page text in `~/.six-degrees/pushback/`; a search that won't open for someone
whose list is visible is push-back, not "empty"; "hidden" only when their profile clearly
rendered (name in the title or heading) without a connections link, otherwise "unclear",
recorded nowhere, and two unclear in a row end the batch; "end of list" only from a live
page that showed results; a closed window is a stop. 0.1.8 added the rest: a search
budget (daily over the last 24 hours, and monthly on LinkedIn's own month), a cooldown lock
the Scan page shows, and a Paused list with Resume by profile URL.

A first version of the breaker recorded "hidden" and then un-recorded the streak when it
tripped. Review showed two genuinely hidden people side by side then stalled every batch
at the same pair, and `--retry-private` erased correct skips. Don't record what you might
have to take back: decide from evidence first. A second review of that rework found the evidence
check itself too loose (a first name matched anywhere in the tab title, and every tab
says "LinkedIn", so Li, Lin and Ed "rendered" on a blank page), and the sign-in check
sampled the cookie after LinkedIn had already expired it. Both are fixed and tested
(`tests/profile-shown.test.mjs`).

---

## 36. "Promoting" someone who was already a connection deleted their row, and their circle with it

Building the Separation view turned up 1,072 2nd-degree rows whose `source_connection_id`
pointed at no row at all: the circles of 13 mapped people, about a third of everyone two
steps away, invisible in every Degrees view. The rows had been deleted on 2026-09-24 at
06:29 UTC, during a full scan.

- **Why.** Before 0.1.5 your own connections were saved into other people's circles
  (§32), so a mapped person could also exist as a 2nd-degree copy under another bridge. A
  full scan sees them in your connections and calls `promoteToFirstDegree`. That picked
  the *deepest* row, the 2nd-degree copy, as the one to keep, and deleted the rest,
  including their real 1st-degree row, whose id their whole circle pointed at.
- **Second harm.** The kept copy was promoted with an origin, so 150 people who had been
  connections all along showed "You met them through …".
- **Why nothing noticed.** Views skip a 2nd-degree row whose bridge they cannot find, so a
  third of the data disappeared without an error.

What holds it now: when a person already has a 1st-degree row, `lib/promote.js` keeps it
(the one other rows point at), folds the copies into it, re-points anything that
referred to a folded row, and adds no origin. `tests/promotion.test.mjs` covers the case.
The local database was repaired from the 09-23 backup: the 13 ids were re-linked, the
circle stats restored, and the 150 false origins cleared, with a copy kept first in
`~/.six-degrees/backups/pre-relink-2026-09-24.sqlite`.


## 37. Node's `cpSync` rewrote the Electron app's links into paths on the build machine

The first Electron build passed every check and ran perfectly here, and would not have
opened on anyone else's Mac.

- **Why.** Electron's framework is held together by relative symlinks
  (`Electron Framework.framework/Resources → Versions/Current/Resources`). Copying the app
  into the disk image with `cpSync(…, { recursive: true })` resolves each link's target to
  an **absolute** path (Node's default, `verbatimSymlinks: false`). Installed from the image,
  the links pointed at `/Users/blakeo/dev/six-degrees-app/dist/…`. On the build machine
  that folder exists, so the app opened. Anywhere else it doesn't.
- **Why nothing noticed.** The app in `dist/` was fine; only the copy *inside the image*
  was wrong, and every check looked at `dist/`. The classic app had no symlinks, so the
  same copy had always been harmless.

What holds it now: the image is filled with `ditto`, which keeps links exactly.
`build-app.mjs` then mounts the finished image and fails the build if the app inside
doesn't pass `codesign --verify --deep --strict`, or has a link pointing outside itself.
CI installs the app **from the image** with `install.sh` and runs that copy. Test what
people get, not what you built.

## 38. In Electron, SIGTERM is an ordinary Quit, and a question nobody sees holds it forever

The first quit test (the installer's SIGTERM, with a job running) left the app running
indefinitely.

- **Why.** Chromium turns SIGTERM into a normal quit (`before-quit`), and Node's
  `process.on('SIGTERM')` never fires in Electron's main process. So the installer's
  signal took the Cmd-Q path, which asks "A scan is running. Quit anyway?", and the
  dialog waited for a click on a screen nobody was watching.
- **Second part.** When the installer stops the server, the app saw its server exit and
  could put up a "Six Degrees stopped" error on its way out.

What holds it now (`desktop/main.mjs`): it asks only when one of its windows has focus
(someone is looking at it, so it's Cmd-Q); otherwise it stops the scan and quits.
A server stopped by a *signal* means the whole app is going, so it quits quietly; only
a crash (an exit code) is reported. Checked by quitting mid-job with another app in
front: job, server and app gone in about 2 seconds. CI repeats that on every build.
