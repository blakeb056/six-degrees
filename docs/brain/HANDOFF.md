# Handoff — picking this up cold

## In sixty seconds

A local-first tool that maps a professional network as a scored, tiered galaxy. Next.js
+ D3 + SQLite on the user's own machine, plus a Python/Playwright scraper. No accounts,
no keys, no server. Read [`../SIX-DEGREES-SPEC.md`](../SIX-DEGREES-SPEC.md) for what must
stay true, then [`00-START-HERE.md`](00-START-HERE.md) for the six rules.

## Get it running

```bash
npm install
npm run dev                        # terminal 1 — it IS the server; no prompt comes back
open http://localhost:3000         # enter a name to create a local profile
```

Then either import a LinkedIn `Connections.csv` at `/import`, click **Explore a sample
network** for the synthetic dataset, or open **Scan** (`/setup`) and use the buttons —
that path installs the Python side into a venv and runs the scraper for you.

Equivalent from a terminal, with the app still running in another window:

```bash
npm run setup:python               # once
python3 scripts/scrape.py --login  # once per machine, sign in by hand
python3 scripts/scrape.py --full
```

## Verify you have not broken anything

```bash
npm test        # 37 tests, node --test
npm run lint
npm run build   # must pass on Node 22 and 24
```

CI additionally fails the build if a JWT shape, a real CSV, `public/avatars/`, or a
`demo-data.json` without its `"synthetic":true` marker appears in a commit.

## The five things most likely to bite you

1. `lib/db.js` mutates and returns `this` — TRAPS §1
2. Locality comes from the bind address, never a header — TRAPS §2
3. LinkedIn class names are hashed per deploy — TRAPS §5
4. `window.scrollTo` is a no-op on the connections page — TRAPS §6
5. A swallowed exception becomes a confident "0 connections" — TRAPS §7

## What is genuinely unfinished

Bridge and company scans have never been run since the scraper fix and probably share
its old bugs. Everything else is done and verified. See [`PHASES.md`](PHASES.md).
