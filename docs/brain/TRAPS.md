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

`resolve_active_user()` asks the app which profile it has and adopts it, failing loudly
if there is no profile or more than one. Any new write path must do the same.

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
