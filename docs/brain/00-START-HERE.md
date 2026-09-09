# Start here

The router for anyone — human or agent — changing this codebase.

## The non-negotiables

Six rules, each learned expensively. If a change violates one, the change is wrong.

1. **Locality is proven by the bind address, never by a header.** `Host`,
   `X-Forwarded-For`, `Origin` — a client sets all of them. This was found by attack,
   not review: from another machine on the LAN with a spoofed `Host`, a destructive
   route reached its handler. TRAPS §2.
2. **`lib/db.js` mutates and returns `this`.** Call sites depend on it. An "obvious"
   refactor to an immutable builder silently drops filters with no error and no failing
   test. TRAPS §1.
3. **Never key on a LinkedIn CSS class.** They are hashed per deploy (`_8e33b2ac`,
   `c313cecd`). Anchor on the profile link. TRAPS §5.
4. **A scraper that cannot read its page must say so, never report zero.** A swallowed
   error that becomes "0 connections" is indistinguishable from an empty network and
   hides real bugs for months. TRAPS §7.
5. **The scoring model exists twice** — `scripts/score_new_connections.sql` (reference)
   and `lib/rpc.js` (runtime). Change both in the same commit or the tiers drift.
6. **Never commit real network data.** CI enforces it; do not route around the guard.

## Where to go next

- Changing the UI or a route → [`MAP.md`](MAP.md), then [`ENDPOINTS.md`](ENDPOINTS.md)
- Changing how data is stored → [`SCHEMA.md`](SCHEMA.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Changing scoring or tiers → [`SCORING.md`](SCORING.md)
- Touching the scraper → [`SCRAPER.md`](SCRAPER.md), and **read [`TRAPS.md`](TRAPS.md) first**
- Deciding whether something is allowed at all → [`../SIX-DEGREES-SPEC.md`](../SIX-DEGREES-SPEC.md)
- Picking this up cold → [`HANDOFF.md`](HANDOFF.md)

## Running it

Two terminals. The scraper writes **through the app's HTTP API**, not into SQLite
directly, so the app must be up.

```bash
npm run dev                      # terminal 1 — never returns a prompt; it is the server
python3 scripts/scrape.py --full # terminal 2
```
