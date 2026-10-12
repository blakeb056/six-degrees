# The local scanner

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

The one thing it ever sends: **a connection request, only when you press Auto** on a
person (their card, or Outlink), one person per press, never a batch and never on a timer.
It opens their profile once (a profile view), presses their Connect, and sends without a
note. If LinkedIn asks for their email address, or for anything else it can't answer
without a note, it closes that and sends nothing. It counts the request as sent only when
their profile shows it pending. At most 15 in any 24 hours and 80 in any 7 days (LinkedIn
doesn't publish its invitation limit; about 100 a week is commonly reported), recorded with
the searches and profile views and shown in Scan → LinkedIn usage. A pause after
LinkedIn pushed back holds it too. `python3 scripts/scrape.py --connect <profile URL>` does
the same from a terminal.

## The easy way — no terminal

Start the app, open **Scan** in the nav (or `/setup`), and use the buttons. The page
checks what is missing, installs it for you, opens LinkedIn so you can sign in, and runs
the scan — showing the live log as it goes.

On a Mac, the app itself installs with one line — see **Install it** in the README — and
opens from Applications like any other. Everything after that is buttons.

**In the Mac app there is nothing to install:** it carries its own Python with the
scanner's packages inside it, so the first step is already ticked.

Otherwise (`npx sixgree`, or from source) that page installs the scanner's Python
packages into a **private virtual environment** inside your data directory
(`~/.six-degrees/venv`), from the Python 3.10–3.14 on your computer. If there isn't one,
**Set up the scanner** first downloads a private copy of Python into `~/.six-degrees/python`
(from GitHub, checked against a checksum built into Sixgree before it's unpacked). It
never touches the Python your system or Homebrew installed, and it goes away when you
delete that folder. Every package file is checked against a checksum too
(`scripts/requirements.txt`). Your own pip settings for which index, proxy or certificates
to use still apply (on a company network they are often what makes pip work at all);
settings that would install the packages somewhere else are ignored, and the last step
checks that the scanner can load them before it says it has finished.

The page has four steps: set up the scanner, sign in, **1st degree** (the people you know) and
**2nd degree** (the people they know — this is what fills Degrees and Outlink). The
second-degree step runs in batches of 5, 10 or 25 and has a **Stop** button; stopping
closes the browser cleanly and keeps everything found so far.

**Who comes first.** Your newest connections first by default — by LinkedIn's "Connected
on" date, across every tier — or highest tier first, where the tier chips decide who is
included. The date is read during the 1st-degree scan, so run **Check for new** first
(and one **Scan my whole network** to date everyone saved before 0.1.5). **How deep.** For each person it
opens their profile, then a search of everyone they are connected to, and reads the
results a page at a time until their list ends — every page by default, or up to 10, 25
or 50 if you choose. LinkedIn's search itself stops at page 100 (about 1,000 people).
Before calling a list finished it looks for a Next button three times, scrolling to the
foot of the page and waiting longer each time, and a click that doesn't move to the next
page is tried three times. A long read saves every 10 pages, and
`~/.six-degrees/bridge-progress.json` notes the last page read for each person and
whether LinkedIn had more. **Also finish people already mapped** (on by default;
`--deeper` in a terminal) carries on from that page, so a read that was stopped, cut
short by a page limit, or done before 0.1.6 at 10 pages is finished rather than started
again. Once the id their connections are searched by is known, their profile isn't
opened again. Every page is a search on your account, and free accounts have a monthly
search limit that whole lists use up quickly (LinkedIn publishes no number; reports put it
around 250–350 searches a month, resetting on the 1st). So it reads slowly: at least 20 seconds
before each page and another minute after every 10, about 55 minutes for a whole list; with
gentle pacing (on by default: a little longer at random, reading time, a scroll through each
page and the odd break) about 76.
**It stops at the first sign of LinkedIn pushing back**: a page that won't open, a warning
about unusual activity or restricted viewing, the search limit, a security check, or a
sign-in wall. It saves what it read, ends the batch, and keeps what the page showed in
`~/.six-degrees/pushback/`. Someone is marked hidden only when LinkedIn clearly showed their
profile with no connections link (or said it is unavailable); a profile that didn't render
is left unmarked, two of those in a row end the batch, and anyone unclear twice waits at the
back of the queue (`~/.six-degrees/bridge-unclear.json`). After any of these, leave it at least a day. A security
check needs a person: **Open LinkedIn** on the Scan page opens a window to finish it.

**One daily limit, and the cooldown.** Every search and profile view is written down, and
the Scan page (LinkedIn usage, and the notch while a scan runs) shows how many searches were
made in the last 24 hours against one number you set there: **searches a day**, 50 by
default, any whole number from 1 to 1000. Profile views count against the same number, on
their own count. At the limit a read saves, stops, and carries on from the same page next
time. When LinkedIn pushes back, a cooldown stops anything that searches for a day (until
the 1st, when LinkedIn says its own monthly limit is reached); the Scan page shows when it
ends.

**Lift limits for this session.** One button on the Scan page (and in the notch when the
limit holds a scan back): until you quit Sixgree, the daily limit and the cooldown are off.
It is kept in the app's memory only, so a restart puts them back, and LinkedIn pushing back
again puts them back by itself. **What never lifts:** the pace between pages and searches
(your speed), the minute between any two profile opens, stopping when LinkedIn shows a
sign-in, a security check or a restriction, Auto's own caps on connection requests, and one
scan at a time.

**Dev mode.** A switch in Scanner settings, *Dev mode: no limits*, saved with the daily
limit (`scan-limits.json`: `"dev": true` and `"devSince"`, when it was turned on). Until you
turn it off, every limit Sixgree sets is off: the daily limit and the cooldown (what the lift
does), Auto's caps on connection requests, Auto scan's hours (9:00 to 18:00) and the queue's
length (500 instead of 10). **What it never touches:** the speed you pick (Slow, Medium or
Fast) and everything it sets, which is the pause before each page, the gap between profile
views and Auto scan's sittings and rests; one scan at a time; and the stop when LinkedIn shows
a sign-in, a security check or a restriction. LinkedIn pushing back turns Dev mode off
(`set_cooldown` writes it off; the app also turns it off on seeing a pause set after
`devSince`), and it stays off until you turn it on again. Everything is still counted, so
LinkedIn usage stays true. The scanner reads the switch from the file each time it asks, so
turning it off reaches a scan under way.

**Manual mode.** A switch in Scanner settings, *Manual mode for circle scans*
(`"manual": true`). A circle scan (one person, Resume, or a round of several) still opens the
person's profile and the first page of their list, but in a Chrome window in front of you,
and from there nothing on the page moves unless you move it. A page is read once you've
scrolled to its foot (the Next or Previous button, or the last person on it, is in view), and
only once; then you click **Next** yourself. The notch says what to do next, in gold. Which
page you're on comes from LinkedIn's page bar (the highlighted number), because Next doesn't
always change the page's address; a page that still shows the last page's people waits until
they change; and if you click on before the notch says it's your turn, it carries on from the
page you're on. When it has waited on one thing for a few seconds, the log says what.
**Chimes:** a short tap the moment you click Next (the scanner hears LinkedIn ask for the next
page, off the network, so nothing is added to the page), a bell when each page is read and
it's your turn again, one step higher for every page in a row (up 8 steps of a pentatonic
ladder), and a flourish when a list is finished. Settings → Sound turns them off, sets the
volume and plays each one. They're synthesised by the app (`lib/chimes.js`), written into
`sounds/` in the data folder before a scan starts, and played by the scanner on this
computer's speakers (`afplay` on a Mac, `winsound` on Windows, `paplay` or `aplay` on Linux). Each
page LinkedIn opens is still a search on your account, counted the first time it's seen and
held to the daily limit (not in Dev mode); LinkedIn pushing back stops it as ever. A page you
skip to is read, but the pages between are never noted as read. It ends when their list
does, at the scan's page limit, on **Stop**, or when you close the window, which in a round
means "done with this person": the next one opens in a new window. Ten minutes with no new
page ends that person's read, and with nothing read at all the whole scan stops, so no window
waits for nobody. Auto scan stays off while manual mode is on, because it scans while you're
away; your own connections, company scans and profile reads still run by themselves. The
window can't sit inside Sixgree's: Chrome is a program of its own.

**Dig deeper.** A switch in Scanner settings, *Dig deeper: read their profile*, in place of the
old *Read full profiles* round:
- **What it reads:** while a circle scan has the person's profile open, it also reads their
  current and past roles. Their score then counts what they actually do, not only their
  headline.
- **Followers** count as recognition, and only ever add.
- **Manual mode:** you scroll to their Experience and it's read as it shows.
- **Cost:** it reads someone once (anyone whose experience is on file is skipped). A first
  scan opens their profile anyway, so it costs nothing extra. Carrying on with someone never
  read opens their profile once, a profile view, and not when today's profile views are used.
- **Without it:** every profile a scan opens still has its top card read (followers and
  "500+ connections"). Their connection count fills the ring round their dot, showing how much
  of their circle is read.

**Profile views.** A circle scan opens the person's profile once, and that is a profile
view. Profile views are what got an account restricted, so at least a minute passes between
any two profile opens, even across scans started one after another, lifted or not; the log
counts down while it waits, and Stop ends the wait. When the day's limit is reached, a scan
stops before opening the next profile. Nothing about that person is recorded, so the next
run starts with them. Carrying on with someone whose search id is already known doesn't
open their profile, so it doesn't count.

**Paused lists.** Everyone whose list was only partly read is listed on the Scan page under
**In progress**, right after step 4, with the page they carry on from, and their card says so by
their name. **Resume** carries on with one of them; **Resume all** with
every paused list, and nobody new. For every result it keeps the profile link, name, photo and headline;
"LinkedIn Member" (people outside your network) each keep their own link, and the
screen-reader line LinkedIn puts after each name ("View … profile") is skipped rather
than saved as the headline. People who are already your own connections — they appear
as the "mutual connections" under each result — are not saved into anyone's circle.
(Before 0.1.4 this step failed on the first page of every person — see TRAPS §31; before
0.1.5 a person whose results named anyone twice was read and not saved — §32.)

**Go easy on the 2nd-degree step.** It opens one profile per person, and LinkedIn
restricts accounts that view a lot of profiles in a short time — that happened during
development after about an hour of continuous mapping, roughly 20–25 profiles. The cap
on profile views keeps a day to 50 by default. Run a batch, leave it a while, run
another. If LinkedIn warns you about unusual activity, press Stop and leave it for the day.

## The terminal way

Still supported, and what you want if you are scripting it. The scanner writes into the
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

## Which profile it saves into

The scanner files everything under the app's profile — the one that owns your
network (a fresh install has exactly one). When the app runs it, it passes that
profile along; from the command line it asks the running app. To force a
particular profile by name: `SIX_DEGREES_USER='Your Name' npm run scrape`.

## Signing in

A Chrome window opens on the first run and the scanner waits — it does not
scan anything until you are signed in, and it starts on its own the moment you
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
Every scan after that starts immediately.

There is no time limit — it waits as long as the window is open. **Closing the
browser window is how you cancel.** If you close it or it gives up, whatever you
completed is still saved; just run it again.

## Usage

Everything below goes in Terminal 2, with the app still running in Terminal 1.

```bash
# First run does a full scan; later runs only look for new people
npm run scrape

# Walk the whole connections list, top to bottom
npm run scrape:full

# Sign in only, then exit
python3 scripts/scrape.py --login

# Map one bridge's 2nd-degree circle
python3 scripts/scrape.py --bridge "Jane Doe"

# Delete and re-capture a bridge's circle from scratch
python3 scripts/scrape.py --rescrape "Jane Doe"

# Everyone visible at one company. EXPERIMENTAL: shipped in 0.1.0 without ever
# having been run against live LinkedIn; the Paths page marks it so
python3 scripts/scrape.py --company "Acme"

# Run as a local server so the app's buttons can drive it
python3 scripts/scrape.py --server
```

Second-degree mapping from the shell, with the same safety valves the page uses:

```bash
python3 scripts/scrape.py --auto-bridge --max-bridges=25   # one batch, then stop
python3 scripts/scrape.py --auto-bridge --deeper           # ...and finish partly read lists
python3 scripts/scrape.py --bridge "Jane Doe" --deeper     # carry on with one person
python3 scripts/scrape.py --auto-bridge --max-pages=10     # stop each read at page 10
python3 scripts/scrape.py --auto-bridge --retry-private    # try the hidden ones again
python3 scripts/scrape.py --clear-skips                    # forget every skip
```

Ctrl-C stops it cleanly: it finishes what it is doing, closes the browser, and prints
a summary rather than leaving a window open.

## The window

The scanner drives a real Chrome window, kept out of your way: on a Mac it is
hidden as soon as it starts (as ⌘H hides an app), elsewhere it opens off the
edge of the screen. It never covers the app or keeps your typing, and its
profile is set so Chrome doesn't stop it with a bubble (saving passwords,
translating, notifications, "Restore pages?") or a warning bar. It comes
forward only when LinkedIn needs you, to sign in or to finish a security
check, and goes back once you're through. `--login` is always in front.

```bash
python3 scripts/scrape.py --full --show-window   # a normal window in front, to watch it work
python3 scripts/scrape.py --full --headless      # no window at all
```

`--show-window` is the Scan page's *Show the scanner's Chrome window* (in
Fine-tune). Manual mode (above) puts circle scans in front too, whatever this says. `--headless` is for the command line only: headless Chrome is
*more* detectable than a real window, a fingerprint sites check for, and a
check LinkedIn asks for can't be seen or finished in it, so the scan stops
instead. Log in once with a window first, so the profile has a session.

## Please be considerate

- **One bridge at a time.** Batching bridges in a single session is the fastest
  way to get flagged.
- Leave the pacing alone. The delays are deliberate.
- If LinkedIn shows a checkpoint or challenge, **stop** and finish it by hand.
- Never share or commit what you capture. It describes real people who did not
  opt in.
