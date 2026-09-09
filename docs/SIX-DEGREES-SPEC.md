# Six Degrees — Specification

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
2. **No telemetry. No analytics. No update check. Ever.** Not opt-out — absent. This
   tool reads a person's professional network; it must never be able to report on it.
3. **Never commit real network data.** Not a CSV, not an avatar, not a snapshot. CI
   fails the build if any appears. The sample network is generated and every person in
   it is invented.
4. **The server binds to `127.0.0.1`.** Locality is proven by the bind address, never
   by a request header — every header a client sends can be forged. See TRAPS §2.
5. **The user's credentials are never seen, asked for, or stored.** Sign-in happens by
   hand in a real browser window; the scraper only ever inherits the resulting session.
6. **Scoring ranks reachability, not people.** The README says so and it stays said. A
   tier is a statement about network position, not human worth.

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
| Porting the scraper to Node | 381 of `scrape.py`'s lines are in-page JavaScript, and the Python one is the only implementation that has ever actually scraped. A port would be a rewrite of the one component with no test coverage and a live dependency. |
| LinkedIn's official API | It cannot return a connection list. Not a restriction to negotiate — the capability does not exist. |
| Voyager (LinkedIn's internal HTTP API) | Requires forging an authenticated internal client. More fragile than the DOM and unambiguously adversarial. |
| Defeating Google's OAuth block | Google blocks its sign-in flow inside automation-controlled browsers deliberately. Working around an anti-automation control is out of scope; the tool tells the user to use email and password instead. |
| A login gate on the local app | It runs on `127.0.0.1`. A password on a loopback service is theatre that costs real usability. |
