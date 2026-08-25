# The local scraper

> **Read this first.** Automating LinkedIn may violate its
> [User Agreement](https://www.linkedin.com/legal/user-agreement), and accounts
> have been restricted for it. This runs locally against your own account, at
> your own risk. LinkedIn's official CSV export is the supported path and needs
> none of this.

## What it does

`scripts/scrape.py` drives **your own installed Chrome** through Playwright
using a persistent profile directory. You log in by hand once; the session
persists between runs. The script never asks for, sees, or stores your
credentials.

It captures:

- your 1st-degree connections,
- the 2nd-degree circle behind a chosen "bridge",
- profile photos, re-encoded to permanent local WebP files (LinkedIn's CDN URLs
  are signed and expire in about three weeks).

## Setup

The scraper writes into the running app, so **both have to be up at once — two
terminal windows.**

Terminal 1, and leave it alone (it will not give you a prompt back):

```bash
cd ~/dev/six-degrees-app
npm run dev
```

Terminal 2 (⌘N), once per machine:

```bash
cd ~/dev/six-degrees-app
npm run setup:python
```

Requires Python 3.9+ and Google Chrome. The scraper drives your real Chrome, so
`playwright install chromium` is not needed.

## Signing in

A Chrome window opens on the first run. Log into LinkedIn by hand; the scraper
polls for up to five minutes and carries on by itself once you are in. The
session lives in a profile inside your data directory, so later runs skip this.

If it says it timed out, you are simply not signed in yet — run it again.

## Usage

Everything below goes in Terminal 2, with the app still running in Terminal 1.

```bash
# Sync your 1st-degree connections
npm run scrape

# Map one bridge's 2nd-degree circle
python3 scripts/scrape.py --bridge "Jane Doe"

# Delete and re-capture a bridge's circle from scratch
python3 scripts/scrape.py --rescrape "Jane Doe"

# Run as a local server so the app's buttons can drive it
python3 scripts/scrape.py --server
```

## Please be considerate

- **One bridge at a time.** Batching bridges in a single session is the fastest
  way to get flagged.
- Leave the pacing alone. The delays are deliberate.
- If LinkedIn shows a checkpoint or challenge, **stop** and finish it by hand.
- Never share or commit what you capture. It describes real people who did not
  opt in.
