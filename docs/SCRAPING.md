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

```bash
pip3 install -r scripts/requirements.txt
python3 -m playwright install chromium   # only needed as a fallback
```

Google Chrome must be installed — the scraper prefers your real browser.

## Usage

```bash
# Sync your 1st-degree connections
python3 scripts/scrape.py

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
