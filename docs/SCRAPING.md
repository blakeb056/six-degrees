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

## The easy way — no terminal

Start the app, open **Scan** in the nav (or `/setup`), and use the buttons. The page
checks what is missing, installs it for you, opens LinkedIn so you can sign in, and runs
the scrape — showing the live log as it goes.

On a Mac you can start the app itself by double-clicking **`Start 6 Degrees.command`** in
the project folder. It installs dependencies on the first run and opens your browser.
Everything after that is buttons.

That page installs the scraper's Python packages into a **private virtual environment**
inside your data directory (`~/.six-degrees/venv`). It never touches the Python your
system or Homebrew installed, and it goes away when you delete that folder.

The page has four steps: install, sign in, **1st degree** (the people you know) and
**2nd degree** (the people they know — this is what fills Bridges and Outlink). The
second-degree step runs in batches of 10, 25 or 50 and has a **Stop** button; stopping
closes the browser cleanly and keeps everything found so far.

**Go easy on the 2nd-degree step.** It opens one profile per person, and LinkedIn
restricts accounts that view a lot of profiles in a short time — that happened during
development after about an hour of continuous mapping, roughly 20–25 profiles. Run a
batch, leave it a while, run another. If LinkedIn warns you about unusual activity,
press Stop and leave it for the day.

## The terminal way

Still supported, and what you want if you are scripting it. The scraper writes into the
running app, so **both have to be up at once — two terminal windows.**

Terminal 1, and leave it alone (it will not give you a prompt back):

```bash
cd six-degrees
npm run dev
```

Terminal 2 (⌘N), once per machine:

```bash
cd six-degrees
npm run setup:python
```

## Signing in

A Chrome window opens on the first run and the scraper waits — it does not
scrape anything until you are signed in, and it starts on its own the moment you
are. This is once per machine: the session is saved in a profile inside your
data directory, so every later run goes straight to work.

**Sign in with your email and password.** "Continue with Google" and "Sign in
with Apple" do not work here. Google blocks its sign-in flow inside
automation-controlled browsers on purpose — the window opens greyed out and
never completes. That is Google's anti-automation policy, not a bug in this
tool, and there is nothing to configure around it. If your LinkedIn account only
has a Google login, set a LinkedIn password first (LinkedIn → Settings →
Sign in & security → Change password).

If you would rather get the sign-in out of the way as its own step:

```bash
python3 scripts/scrape.py --login
```

That opens the window, waits for you, confirms the session was saved, and exits.
Every scrape after that starts immediately.

There is no time limit — it waits as long as the window is open. **Closing the
browser window is how you cancel.** If you close it or it gives up, whatever you
completed is still saved; just run it again.

## Usage

Everything below goes in Terminal 2, with the app still running in Terminal 1.

```bash
# First run does a full scrape; later runs only look for new people
npm run scrape

# Walk the whole connections list, top to bottom
npm run scrape:full

# Sign in only, then exit
python3 scripts/scrape.py --login

# Map one bridge's 2nd-degree circle
python3 scripts/scrape.py --bridge "Jane Doe"

# Delete and re-capture a bridge's circle from scratch
python3 scripts/scrape.py --rescrape "Jane Doe"

# Run as a local server so the app's buttons can drive it
python3 scripts/scrape.py --server
```

Second-degree mapping from the shell, with the same safety valves the page uses:

```bash
python3 scripts/scrape.py --auto-bridge --max-bridges=25   # one batch, then stop
python3 scripts/scrape.py --auto-bridge --retry-private    # try the hidden ones again
python3 scripts/scrape.py --clear-skips                    # forget every skip
```

Ctrl-C stops it cleanly: it finishes what it is doing, closes the browser, and prints
a summary rather than leaving a window open.

## Running it without a visible window

Every mode accepts `--headless`. Log in once with a window so the profile has a
session, then later runs need no window at all:

```bash
python3 scripts/scrape.py --full --headless
```

One caveat worth knowing: headless Chrome is *more* detectable than a visible
one — it is a fingerprint sites check for. Running invisibly and staying
unflagged pull in opposite directions, so prefer a visible window if you are
scraping much at once.

## Please be considerate

- **One bridge at a time.** Batching bridges in a single session is the fastest
  way to get flagged.
- Leave the pacing alone. The delays are deliberate.
- If LinkedIn shows a checkpoint or challenge, **stop** and finish it by hand.
- Never share or commit what you capture. It describes real people who did not
  opt in.
