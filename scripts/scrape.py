#!/usr/bin/env python3
"""
6 Degrees LinkedIn Scraper

Drives Chrome with a persistent profile. You log into LinkedIn by hand once;
the session is reused on every later run.
Scrapes your connections into the app running on your own machine.

Usage:
  pip3 install playwright requests
  playwright install chromium

  python3 scripts/scrape.py                          # First run: full scrape. Later: new only
  python3 scripts/scrape.py --full                   # Force a full re-walk of every page
  python3 scripts/scrape.py --refresh                # Only look for newly added connections
  python3 scripts/scrape.py --bridge "Jane Doe"      # Scrape one bridge's connections
  python3 scripts/scrape.py --company "Acme"         # Scan one company
  python3 scripts/scrape.py --auto-bridge            # Map every bridge in turn
  python3 scripts/scrape.py --auto-bridge --tiers=S,A --max-bridges=10
  python3 scripts/scrape.py --rescrape "Name"        # Delete + re-scrape a bridge
  python3 scripts/scrape.py --auto-bridge --deeper   # ...and finish lists read only partly

IMPORTANT: Only scrape ONE bridge at a time. Do NOT batch multiple bridges
in one session — LinkedIn detects automation and flags your account.
"""

import argparse
import json
import os
import signal
import sys
import time
import requests
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Local helper: download + compress avatars into permanent WebP files so they
# don't break every ~3 weeks when LinkedIn's signed CDN URLs expire.
from image_store import localize_images

# --- Config ---
def _load_env_local():
    """Fallback: read NEXT_PUBLIC_* values from the app's gitignored .env.local."""
    env = {}
    env_file = Path(__file__).resolve().parent.parent / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

_ENV_LOCAL = _load_env_local()

# The scraper pushes into the app running on THIS machine. It must never
# default to somebody else's deployment — that would send a user's network to
# a server they don't control.
APP_URL = os.getenv("APP_URL", "http://localhost:3000")

CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"

# Token for the deployed app's destructive API routes (see middleware.js). Sent
# as a bearer so --rescrape/delete-cluster still work against the deployment.
# Not needed for ordinary ingest, which is open.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN") or _ENV_LOCAL.get("ADMIN_TOKEN", "")


def _assert_local_target():
    """Refuse to push to a remote host unless explicitly allowed.

    A misconfigured APP_URL would upload someone's private network to a third
    party, so this fails loudly rather than silently doing it.
    """
    from urllib.parse import urlparse
    host = (urlparse(APP_URL).hostname or "").lower()
    if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return
    if os.getenv("ALLOW_REMOTE_PUSH") == "1":
        print(f"WARNING: pushing scraped data to remote host {host}")
        return
    raise SystemExit(
        f"Refusing to push scraped data to '{APP_URL}'.\n"
        "The scraper writes to the app on your own machine. Start it with "
        "`npm run dev` and leave APP_URL unset, or set ALLOW_REMOTE_PUSH=1 if "
        "you really mean to send your network to a remote server."
    )


def app_headers(json_body=True):
    """Headers for calls to the app's API routes, incl. admin-route auth."""
    headers = {"Content-Type": "application/json"} if json_body else {}
    if ADMIN_TOKEN:
        headers["Authorization"] = f"Bearer {ADMIN_TOKEN}"
    return headers


# Active user ID — set by the server when a user triggers a scrape
_active_user_id = None

# --- Scraper JS (same logic as our proven browser scripts) ---
CONNECTIONS_SCRAPER_JS = """
async () => {
  // Load all connections
  let attempts = 0;
  while (attempts < 120) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 500));
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load more'));
    if (btn) { btn.scrollIntoView(); btn.click(); attempts++; await new Promise(r => setTimeout(r, 1000)); }
    else { if (document.querySelectorAll('a[href*="/in/"]').length / 2 > 100 || attempts > 5) break; attempts++; await new Promise(r => setTimeout(r, 1000)); }
  }

  // Extract
  const connections = [];
  const seen = new Set();
  const imgMap = {};

  document.querySelectorAll('a[href*="/in/"]').forEach(link => {
    const href = link.getAttribute('href');
    const profileUrl = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
    const img = link.querySelector('img');

    if (img && img.src && img.src.includes('media.licdn.com')) {
      imgMap[profileUrl] = img.src;
      return;
    }
    if (img) return;

    const wrapper = link.children[0];
    if (!wrapper || wrapper.children.length < 2) return;
    const name = wrapper.children[0].textContent.trim();
    const headline = wrapper.children[1].textContent.trim();
    if (!name || seen.has(profileUrl)) return;
    seen.add(profileUrl);

    let connectedDate = '';
    let el = link.nextElementSibling;
    for (let i = 0; i < 5 && el; i++) {
      const t = el.textContent.trim();
      if (t.startsWith('Connected on')) { connectedDate = t.replace('Connected on ', ''); break; }
      el = el.nextElementSibling;
    }

    connections.push({ name, headline, profileUrl, connectedDate, imageUrl: imgMap[profileUrl] || '' });
  });

  // Merge image URLs
  connections.forEach(c => { if (!c.imageUrl && imgMap[c.profileUrl]) c.imageUrl = imgMap[c.profileUrl]; });

  return connections;
}
"""

SEARCH_SCRAPER_JS = """
async (maxPages) => {
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    await new Promise(r => setTimeout(r, 2000));

    const urlMap = {};
    document.querySelectorAll('a').forEach(a => {
      const h = a.getAttribute('href') || '';
      if (!h.includes('/in/')) return;
      const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
      const text = a.textContent.trim();
      if (!text || text.length > 60 || text.includes('mutual') || text.includes('Connect') || text.includes('Invite') || text.includes('•')) return;
      if (!urlMap[text]) urlMap[text] = url;
    });

    const main = document.querySelector('[role="main"], main');
    const pageText = main ? main.innerText : '';
    const lines = pageText.split('\\n').map(l => l.trim());

    let i = 0;
    while (i < lines.length) {
      if (urlMap[lines[i]]) {
        const name = lines[i];
        const url = urlMap[name];
        let headline = '';
        let j = i + 1;
        while (j < lines.length && j < i + 8) {
          const l = lines[j].trim();
          if (!l || l.match(/^\\u2022\\s*(1st|2nd|3rd)/) || l === name) { j++; continue; }
          if (l === 'Connect' || l === 'Follow' || l === 'Message' || l.includes('mutual connection') || l.match(/followers$/)) break;
          if (!headline) { headline = l; j++; continue; }
          j++;
        }
        results.push({ name, headline, profileUrl: url, imageUrl: '' });
      }
      i++;
    }

    if (page < maxPages) {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next');
      if (!nextBtn) break;
      nextBtn.click();
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  return results;
}
"""


FEED_URL = "https://www.linkedin.com/feed/"
# A first sign-in means email, password, and often a 2FA code from another
# device. Five minutes was not enough, and timing out used to CLOSE the window
# mid-login and throw the attempt away. Wait for as long as the window is open:
# closing it is the honest "I am done" signal, and any timer here is a guess.
LOGIN_WAIT_SECONDS = int(os.getenv("SIX_DEGREES_LOGIN_WAIT", "1800"))
MAX_SCROLL_ROUNDS = 400           # ~10 people load per round
SCROLL_PAUSE_SECONDS = 0.9
SCROLL_STALL_LIMIT = 10           # rounds with no new names before stopping
LOGIN_POLL_SECONDS = 2


def _has_session_cookie(target):
    """The one signal LinkedIn cannot render away.

    `li_at` is the session cookie. It is set only after a real sign-in and it
    survives redesigns, which the DOM does not: the `nav.global-nav` element an
    earlier version of this check looked for no longer exists on any LinkedIn
    page, so that check silently never matched.

    Reads the browser CONTEXT, not a page, on purpose. Signing in can open a
    second window or replace the tab, and a check bound to one Page object then
    watches something the user has already navigated away from — it waits
    forever while the session it is waiting for sits right there in the jar.
    """
    ctx = getattr(target, "context", target)
    try:
        for c in ctx.cookies("https://www.linkedin.com"):
            if c.get("name") == "li_at" and c.get("value"):
                return True
    except Exception:
        pass
    return False


def _looks_logged_out(page):
    """LinkedIn shows several different logged-out pages.

    Matching on the URL alone is not enough: the signed-out landing page is
    often just linkedin.com/ with a sign-in splash, which slips past a
    login/authwall check and leaves the scraper collecting nothing.
    """
    url = (page.url or "").lower()
    if any(marker in url for marker in ("/login", "/authwall", "/signup", "/checkpoint", "/uas/")):
        return True
    if _has_session_cookie(page):
        return False
    try:
        if page.query_selector("a[href*='/login'], button[data-tracking-control-name*='sign-in']"):
            return True
    except Exception:
        pass
    return "/feed" not in url and "/mynetwork" not in url


def _page_wall(pg):
    """"checkpoint" if this page is LinkedIn's security check, "signin" if it is a
    sign-in page or wall, else None. Only LinkedIn pages count."""
    try:
        if pg.is_closed():
            return None
        u = urlparse(pg.url or "")
        if not (u.hostname or "").endswith("linkedin.com"):
            return None
        path = u.path.lower()
        if path.startswith("/checkpoint"):
            return "checkpoint"
        if path.startswith(("/authwall", "/uas/", "/login")):
            return "signin"
    except Exception:
        pass
    return None


def _off_the_wall(context):
    """At least one open LinkedIn page is past any sign-in or security check.

    Sign-in can finish in another tab or window and leave a stale /login page
    behind, so one page on a wall doesn't mean you aren't signed in.
    """
    try:
        pages = [pg for pg in context.pages if not pg.is_closed()]
        linkedin = [pg for pg in pages
                    if (urlparse(pg.url or "").hostname or "").endswith("linkedin.com")]
        walls = [_page_wall(pg) for pg in linkedin]
        # A security check still open anywhere isn't finished, whatever else
        # is open; a stale sign-in page in another tab is.
        if "checkpoint" in walls:
            return False
        return any(w is None for w in walls)
    except Exception:
        return False


def ensure_logged_in(page, timeout_s=LOGIN_WAIT_SECONDS, log_fn=None, stop_on_checkpoint=False):
    """Wait for a human to finish logging in, rather than scraping an empty page.

    The browser uses a persistent profile, so this is a once-per-machine step —
    every later run finds the session already there and returns immediately.

    The session cookie survives LinkedIn's security check, so the cookie alone
    used to count as signed in and a scan carried on straight past the check
    (TRAPS §35). So: were you signed in when this started? If you were, and
    LinkedIn now shows a security check or a sign-in wall, that is LinkedIn
    pushing back — with stop_on_checkpoint (2nd-degree reads) the run ends
    there, since carrying on after one is what LinkedIn says turns a warning
    into a restriction. If you weren't, it is an ordinary sign-in, and LinkedIn's
    own sign-in and two-factor steps live under /checkpoint too: wait through
    them.
    """
    context = page.context
    had_session = _has_session_cookie(context)

    try:
        page.goto(FEED_URL, wait_until="domcontentloaded")
    except Exception:
        pass
    time.sleep(2)

    wall = _page_wall(page)
    signed_out = had_session and (wall or not _has_session_cookie(context) or _looks_logged_out(page))
    if stop_on_checkpoint and signed_out:
        reason = "a security check" if wall == "checkpoint" else "being signed out"
        _keep_pushback_evidence(page, reason)
        raise LinkedInPushedBack(0, reason)

    if _has_session_cookie(context) and not _looks_logged_out(page) and not wall:
        return True

    say = log_fn or (lambda m: None)
    if had_session and wall == "checkpoint":
        print()
        print("  LinkedIn wants a security check. Finish it in the browser window;")
        print("  this closes by itself once it's done. Then leave scanning for a day.")
        print()
        say("Waiting for you to finish LinkedIn's security check...")
    else:
        _print_sign_in_banner(say)
    return _wait_for_sign_in(page, context, timeout_s, say)


def _print_sign_in_banner(say):
    say("Waiting for you to sign into LinkedIn in the browser window...")
    print()
    print("  ==================================================================")
    print("  Sign into LinkedIn in the browser window that just opened.")
    print()
    print("  Use your email and password. \"Continue with Google\" and \"Sign in")
    print("  with Apple\" do not work here — Google blocks its sign-in flow")
    print("  inside automated browsers, which is why that window comes up")
    print("  greyed out and does nothing.")
    print()
    print("  Nothing is scraped until you are signed in, and the scrape starts")
    print("  by itself the moment you are. Take as long as you need.")
    print("  Close the browser window to cancel.")
    print("  ==================================================================")
    print()


def _wait_for_sign_in(page, context, timeout_s, say):
    waited = 0
    while waited < timeout_s:
        time.sleep(LOGIN_POLL_SECONDS)
        waited += LOGIN_POLL_SECONDS

        # Closing every window is how you say "not now". One page closing is
        # not: signing in legitimately opens and closes tabs.
        try:
            if not [pg for pg in context.pages if not pg.is_closed()]:
                print("\n  Browser closed — nothing was scraped.")
                say("Browser closed before sign-in.")
                return False
        except Exception:
            print("\n  Browser closed — nothing was scraped.")
            return False

        # The cookie belongs to the whole browser, so it is found no matter which
        # tab or window the sign-in finished in — but it only counts once a
        # LinkedIn page is past the security check or sign-in wall.
        if _has_session_cookie(context) and _off_the_wall(context):
            print()
            print("  Signed in — LinkedIn is clear.")
            print()
            say("Signed in.")
            return True

        if waited % 15 == 0:
            mins, secs = divmod(waited, 60)
            note = f"{mins}m{secs:02d}s" if mins else f"{secs}s"
            print(f"  waiting for sign-in... ({note})", flush=True)
            if waited % 60 == 0:
                say(f"Still waiting for sign-in... ({note})")

    print("\n  Gave up waiting for sign-in. Whatever you completed is saved in the")
    print("  browser profile — run this again and it will pick up from there.")
    say("Timed out waiting for sign-in.")
    return False


def open_login_window():
    """Just sign in, confirm it worked, and exit.

    Separated out because a sign-in that has to happen inside a run you are also
    trying to watch is two things going wrong at once. Do this first, see it
    succeed, and every later scrape starts immediately.
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=get_scraper_profile_path(),
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
            timeout=120000,
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.set_default_timeout(120000)

        # The cookie alone isn't enough: it survives a security check, and this is
        # the window you open to finish one (TRAPS §35). ensure_logged_in loads
        # the feed, returns at once if all is well, and otherwise waits for you.
        ok = ensure_logged_in(page)
        if ok:
            print("  LinkedIn is signed in on this machine and clear to use.\n")
        browser.close()
        return ok


def get_scraper_profile_path():
    """The Chrome profile the scraper drives.

    Separate from your everyday Chrome profile so the two never fight over the
    same lock. It holds a real logged-in LinkedIn session, so it lives inside
    the app's data directory (SIX_DEGREES_HOME, default ~/.six-degrees) and is
    removed along with everything else when you delete that folder. Treat it
    like a password: it can be several hundred megabytes and it is the one
    artifact here that grants access to your account.
    """
    base = Path(os.environ.get("SIX_DEGREES_HOME") or (Path.home() / ".six-degrees"))
    profile_dir = base / "chrome-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    return str(profile_dir)


def resolve_active_user():
    """Attach this scrape to the profile the app is showing.

    The app filters every view by user id, so rows written with no owner land in
    the database and then never appear on screen — the scrape looks like it
    silently did nothing. The app decides which profile is "you" (the one that
    owns the network — lib/profile.js) and this adopts the same answer, so the
    two can never disagree. It used to refuse outright when a stray empty
    profile existed, which stopped every scan with a reason nobody saw.

    Order: SIX_DEGREES_USER_ID (set by the app when it runs this), then
    SIX_DEGREES_USER by name (for the command line), then ask the app.
    """
    global _active_user_id
    if _active_user_id:
        return _active_user_id

    given_id = os.getenv("SIX_DEGREES_USER_ID", "").strip()
    if given_id:
        _active_user_id = given_id
        return _active_user_id

    wanted = os.getenv("SIX_DEGREES_USER", "").strip().lower()
    try:
        if wanted:
            resp = requests.get(f"{APP_URL}/api/users", headers=app_headers(json_body=False), timeout=15)
            users = resp.json().get("users", []) if resp.status_code == 200 else []
            for u in users:
                if (u.get("name") or "").strip().lower() == wanted:
                    _active_user_id = u["id"]
                    print(f"  Scraping into profile: {u['name']}")
                    return _active_user_id
            raise SystemExit(f"No profile named '{os.getenv('SIX_DEGREES_USER')}' in the app.")

        resp = requests.get(f"{APP_URL}/api/users?me=1", headers=app_headers(json_body=False), timeout=15)
        me = resp.json().get("user") if resp.status_code == 200 else None
    except SystemExit:
        raise
    except Exception:
        print(f"\n  Could not reach the app at {APP_URL}.")
        print("  Start it with `npm run dev` in another terminal, then run this again.\n")
        raise SystemExit(1)

    if not me or not me.get("id"):
        raise SystemExit(f"The app at {APP_URL} did not say which profile to use.")

    _active_user_id = me["id"]
    print(f"  Scraping into profile: {me.get('name')}")
    return _active_user_id


def read_bridged_ids():
    """The ids of connections whose circle has already been mapped."""
    params = {}
    if _active_user_id:
        params["userId"] = _active_user_id
    try:
        resp = requests.get(f"{APP_URL}/api/bridges", params=params,
                            headers=app_headers(json_body=False), timeout=30)
        if resp.status_code != 200:
            print("  (could not read mapped bridges; treating none as mapped)")
            return set()
        return set(resp.json().get("bridgeIds", []))
    except Exception:
        print("  (could not read mapped bridges; treating none as mapped)")
        return set()


def read_connections(endpoint="", params=None):
    """Read connections from the local app.

    The hosted build queried the cloud database directly. Locally the app owns
    the SQLite file, so the scraper asks it instead of opening the database a
    second time. PostgREST-style values ("eq.1") are unwrapped here so the many
    existing call sites did not have to change.
    """
    query = {}
    for key, value in (params or {}).items():
        if key in ("select", "order", "limit"):
            if key != "select":
                query[key] = value
            continue
        query[key] = value.split(".", 1)[1] if isinstance(value, str) and value.startswith("eq.") else value
    try:
        resp = requests.get(f"{APP_URL}/api/connections", params=query, headers=app_headers(json_body=False), timeout=30)
        if resp.status_code != 200:
            return []
        return resp.json().get("connections", [])
    except Exception:
        return []


def delete_bridge_cluster(bridge_name):
    """Delete all degree-2 connections for a bridge so it can be re-scraped clean."""
    # Find the bridge (read-only)
    bridges = read_connections(params={"name": f"eq.{bridge_name}", "degree": "eq.1", "limit": "1"})
    if not bridges:
        print(f"Bridge '{bridge_name}' not found.")
        return None

    bridge_id = bridges[0]["id"]
    existing = read_connections(params={"source_connection_id": f"eq.{bridge_id}", "degree": "eq.2", "select": "id"})
    count = len(existing)

    if count == 0:
        print(f"  No existing cluster data for {bridge_name}.")
        return bridge_id

    # Delete via Vercel API route (has service_role key)
    resp = requests.post(f"{APP_URL}/api/delete-cluster", json={"bridgeId": bridge_id}, headers=app_headers())
    if resp.status_code == 200:
        print(f"  Deleted {count} old records for {bridge_name}.")
    else:
        print(f"  Delete failed: {resp.status_code} {resp.text[:100]}")

    return bridge_id


class SaveFailed(Exception):
    """The app refused what was scraped.

    It used to print a one-line "Push error" and carry on — "Done! 0 new
    degree-2 connections added" — to the next person, spending more LinkedIn
    views on people who could not be saved either. TRAPS §32.
    """


class LinkedInPushedBack(Exception):
    """A results page would not open after END_CHECKS tries.

    That is what LinkedIn blocking the account's search looked like on
    2026-09-24: page 28 of a list never loaded. The batch used to note it for
    that person and carry on with the next one after a cooldown — straight
    into the same block. Raised after saving, so `found` is what was read.
    """

    def __init__(self, found=0, reason="a page that would not open"):
        super().__init__(reason)
        self.found = found
        self.reason = reason


class NotSignedIn(Exception):
    """LinkedIn wasn't signed in, or the window was closed while waiting for it.

    Not a fact about the person being read. It used to come back as "no
    connections", and that person was noted as hidden and skipped for good — a
    stop pressed while the browser was opening did exactly that. TRAPS §34.
    """


class SearchLimitReached(Exception):
    """LinkedIn says this account has used up its searches for the month.

    Every page of someone's connections is a search, and a free account has a
    monthly allowance that reading whole lists uses up fast. Raised after what
    was read has been saved, so `found` is how many that was; the record of how
    far the read got means the next run carries on from the same page.
    """

    def __init__(self, found=0):
        super().__init__("LinkedIn's monthly search limit")
        self.found = found


def push_connections(connections, degree=1, bridge_id=None, user_id=None, on_saved=None):
    """Push connections via Vercel API route (which has write access).
    No local keys needed — the server handles auth.

    on_saved runs as soon as the app has the rows, before the photos: those can
    take a while, and a stop that lands during them must not lose the note of
    how far a read got.
    """

    # Send to Vercel API route — it writes with the service_role key
    payload = {
        "connections": connections,
        "type": "degree2" if degree == 2 else "degree1",
        "bridgeId": bridge_id,
        "userId": user_id or _active_user_id,
    }

    resp = requests.post(
        f"{APP_URL}/api/ingest",
        headers=app_headers(),
        json=payload,
    )

    if resp.status_code == 200:
        result = resp.json()
        # "saved" is what was actually new; an older app only sends "processed",
        # which counted everything sent and made nothing look like something.
        inserted = result.get("saved", result.get("processed", 0))
        promoted = result.get("promoted", 0)
        notes = []
        if result.get("alreadyKnown"):
            notes.append(f"{result['alreadyKnown']} already on file")
        if result.get("alreadyConnected"):
            notes.append(f"{result['alreadyConnected']} already your connections")
        if result.get("duplicates"):
            notes.append(f"{result['duplicates']} repeats")
        print(f"  Sent {len(connections)} → {inserted} new" + (f" ({', '.join(notes)})" if notes else ""))
        if promoted:
            # Someone you were introduced to has accepted. The bridge that
            # produced them is kept on their row, so the path stays visible.
            # Worded carefully: this read as "N new 2nd-degree people added" when it
            # means the opposite — people already in a bridge's circle who are also
            # your connections, now counted once, with who introduced you kept.
            print(f"  {promoted} were already in a bridge's circle — merged into your connections, keeping who introduced you")
    else:
        print(f"  Push error: {resp.status_code} {resp.text[:200]}")
        raise SaveFailed(f"the app answered {resp.status_code}: {resp.text[:160]}")

    if on_saved:
        on_saved()

    # Batch update profile images separately (faster than inline)
    images_to_update = [
        {"profileUrl": c["profileUrl"], "imageUrl": c["imageUrl"]}
        for c in connections
        if c.get("imageUrl") and c.get("profileUrl")
    ]
    # Capture avatars permanently: download + compress each while its signed URL is
    # still fresh, then store the local /avatars/*.webp path instead of the licdn URL.
    images_to_update = localize_images(images_to_update)
    if images_to_update:
        print(f"  Updating {len(images_to_update)} profile images...")
        # Send in batches of 100 to avoid timeout
        for i in range(0, len(images_to_update), 100):
            batch = images_to_update[i:i+100]
            r = requests.post(
                f"{APP_URL}/api/update-images",
                headers=app_headers(),
                json={"images": batch},
            )
            if r.status_code == 200:
                result = r.json()
                print(f"  Images {i+1}-{min(i+100, len(images_to_update))}: {result.get('updated', 0)} updated")

    # Check for unlocked paths (read-only lookup)
    if degree == 1:
        print("  Checking for unlocked paths...")
        pending = read_connections(params={"unlock_status": "eq.pending", "degree": "eq.2", "select": "id,profile_url,name"})
        d1_urls = {c.get("profileUrl", "").strip() for c in connections if c.get("profileUrl")}
        for p in pending:
            if p["profile_url"] in d1_urls:
                # Unlock via API route
                requests.post(f"{APP_URL}/api/unlock", json={"connectionId": p["id"]}, headers=app_headers())
                print(f"  *** PATH UNLOCKED: {p['name']}! Run --bridge \"{p['name']}\" to scrape their network ***")

    return inserted


def push_company(people, company_name):
    """Push company-scraped people to database as degree 3 (company scan).
    Uses the same Vercel API route but with type='company'."""
    connections = []
    for p in people:
        connections.append({
            "name": p.get("name", "").strip(),
            "headline": p.get("headline", "").strip(),
            "profileUrl": p.get("profileUrl", "").strip(),
            "imageUrl": p.get("imageUrl", ""),
        })

    connections = [c for c in connections if c.get("name") and c.get("profileUrl")]
    if not connections:
        print(f"  No valid people to push for {company_name}")
        return 0

    payload = {
        "connections": connections,
        "type": "company",
        "companyName": company_name,
        "userId": _active_user_id,
    }

    resp = requests.post(
        f"{APP_URL}/api/ingest",
        headers=app_headers(),
        json=payload,
    )

    if resp.status_code == 200:
        result = resp.json()
        inserted = result.get("processed", 0)
        print(f"  Pushed {len(connections)} → {inserted} saved to database")
    else:
        print(f"  Push error: {resp.status_code} {resp.text[:200]}")
        raise SaveFailed(f"the app answered {resp.status_code}: {resp.text[:160]}")

    # Update profile images
    images_to_update = [
        {"profileUrl": c["profileUrl"], "imageUrl": c["imageUrl"]}
        for c in connections
        if c.get("imageUrl") and c.get("profileUrl")
    ]
    # Capture avatars permanently (download + compress while the signed URL is fresh).
    images_to_update = localize_images(images_to_update)
    if images_to_update:
        for i in range(0, len(images_to_update), 100):
            batch = images_to_update[i:i+100]
            r = requests.post(
                f"{APP_URL}/api/update-images",
                headers=app_headers(),
                json={"images": batch},
            )
            if r.status_code == 200:
                print(f"  Images {i+1}-{min(i+100, len(images_to_update))}: {r.json().get('updated', 0)} updated")

    return inserted


def scrape_full(headless=False):
    """Full first-time scrape: uses search page to get ALL connections with images.
    Paginates through /search/results/people/?network=["F"] (10 results per page).
    This is the setup method — captures everything including profile photos."""
    from playwright.sync_api import sync_playwright

    print("\n=== Full Account Setup Scrape ===\n")
    print("This scrapes ALL connections via the search page (not the connections page).")
    print("Takes 3-5 minutes for ~500 connections.\n")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=get_scraper_profile_path(),
            headless=headless,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
            timeout=120000,
        )

        page = browser.pages[0] if browser.pages else browser.new_page()
        page.set_default_timeout(120000)
        page.set_default_navigation_timeout(120000)

        # Check login
        try:
            page.goto("https://www.linkedin.com/", wait_until="domcontentloaded")
        except:
            pass
        if not ensure_logged_in(page):
            browser.close()
            return

        # Navigate to 1st-degree search
        search_url = "https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH"
        print("Opening 1st-degree connections search...")
        try:
            page.goto(search_url, wait_until="commit")
        except:
            pass
        time.sleep(8)

        all_connections = []
        all_images = []
        page_num = 1

        while page_num <= 100:
            print(f"  Page {page_num}... ", end="", flush=True)
            time.sleep(3)

            # Extract connections + images from current page
            page_data = page.evaluate("""
            () => {
              const urlMap = {};
              const imgMap = {};
              document.querySelectorAll('a').forEach(a => {
                const h = a.getAttribute('href') || '';
                if (!h.includes('/in/')) return;
                const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
                const img = a.querySelector('img');
                if (img && img.src && img.src.includes('media.licdn.com')) {
                  imgMap[url] = img.src;
                  return;
                }
                const text = a.textContent.trim();
                if (!text || text.length > 60 || text.includes('mutual') || text.includes('Connect')) return;
                if (!urlMap[text]) urlMap[text] = url;
              });
              const main = document.querySelector('[role="main"], main');
              const pageText = main ? main.innerText : '';
              const lines = pageText.split('\\n').map(l => l.trim());
              const results = [];
              let i = 0;
              while (i < lines.length) {
                if (urlMap[lines[i]]) {
                  const name = lines[i], url = urlMap[name];
                  let headline = '';
                  let j = i + 1;
                  while (j < lines.length && j < i + 8) {
                    const l = lines[j].trim();
                    if (!l || l.match(/^\\u2022\\s*(1st|2nd|3rd)/) || l === name) { j++; continue; }
                    if (l === 'Connect' || l === 'Follow' || l === 'Message' || l.includes('mutual connection')) break;
                    if (!headline) { headline = l; j++; continue; }
                    j++;
                  }
                  results.push({ name, headline, profileUrl: url, imageUrl: imgMap[url] || '' });
                }
                i++;
              }
              return results;
            }
            """)

            new_count = len(page_data)
            all_connections.extend(page_data)
            img_count = sum(1 for c in page_data if c.get("imageUrl"))
            print(f"{new_count} found ({img_count} with images)")

            # Click Next
            try:
                next_btn = page.locator('button:has-text("Next")').first
                if next_btn.is_visible(timeout=3000):
                    next_btn.click()
                    page_num += 1
                    time.sleep(3)
                else:
                    print("  No more pages.")
                    break
            except:
                print("  No more pages.")
                break

        print(f"\nTotal: {len(all_connections)} connections, {sum(1 for c in all_connections if c.get('imageUrl'))} with images")
        browser.close()

    # Push connections
    print(f"\nPushing {len(all_connections)} connections to the app...")
    inserted = push_connections(all_connections, degree=1)
    print(f"Done! {inserted} new.")

    return all_connections


# The connections page keeps its list inside <main>, which is its own scroll
# container: the window itself never scrolls, so window.scrollTo() — what this
# scraper used to call — is a no-op there. Nothing new ever loaded and the run
# ended with the first ten people. Scroll the real container instead, and send a
# genuine wheel event too, because the list loads on an intersection observer.
SCROLL_CONTAINER_JS = """
() => {
  let best = null;
  document.querySelectorAll('main, [role="main"], div').forEach(el => {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) return;
    if (el.scrollHeight <= el.clientHeight + 20) return;
    if (!best || el.scrollHeight > best.scrollHeight) best = el;
  });
  const target = best || document.scrollingElement || document.body;
  target.scrollTop = target.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  return target.scrollTop;
}
"""

# Anchor everything on the profile link, never on class names (LinkedIn's are
# hashed per deploy) and never on guessing which text line goes with which URL.
# Each person renders two <a> tags pointing at the same profile: one wrapping
# the photo, one wrapping the name and headline. Group by href and merge.
CONNECTIONS_EXTRACT_JS = r"""
() => {
  const root = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  const clean = s => (s || '').replace(/[’']s profile picture$/i, '').trim();
  const byHref = new Map();
  root.querySelectorAll('a[href*="/in/"]').forEach(a => {
    if (a.closest('nav, header, footer')) return;
    const raw = a.getAttribute('href') || '';
    if (!raw.includes('/in/')) return;
    let url = raw.startsWith('http') ? raw : 'https://www.linkedin.com' + raw;
    url = url.split('?')[0].split('#')[0].replace(/\/+$/, '') + '/';
    let rec = byHref.get(url);
    if (!rec) { rec = { profileUrl: url, name: '', headline: '', imageUrl: '', _named: false }; byHref.set(url, rec); }
    const img = a.querySelector('img');
    if (img) {
      if (!rec.imageUrl && img.src && img.src.includes('licdn.com') && !/ghost|^data:/.test(img.src)) rec.imageUrl = img.src;
      // Fallback only: the alt text reads "Jane Doe's profile picture".
      if (!rec.name && img.alt) rec.name = clean(img.alt);
    }
    const lines = (a.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length) {
      // The text anchor is authoritative; it always wins over the image alt.
      if (!rec._named) { rec.name = clean(lines[0]); rec._named = true; }
      if (!rec.headline && lines[1] && !/^Connected on/i.test(lines[1])) rec.headline = lines[1];
    }
    // "Connected on September 22, 2026" sits in the card, outside the link. It is
    // what "newest first" goes by, and it went missing when this extractor was
    // rewritten. Climb to the nearest block holding exactly ONE such line: more
    // than one means we have reached the list itself and would take a neighbour's.
    if (!rec.connectedDate) {
      let el = a;
      for (let k = 0; k < 8 && el.parentElement; k++) {
        el = el.parentElement;
        const hits = (el.innerText || '').match(/Connected on [A-Za-z]+\.? \d{1,2}, \d{4}/g);
        if (!hits) continue;
        if (hits.length === 1) rec.connectedDate = hits[0].replace(/^Connected on /, '');
        break;
      }
    }
  });
  return [...byHref.values()].filter(r => r.name && r.name.length >= 2).map(({ _named, ...r }) => r);
}
"""


def _reported_connection_count(page):
    """The "754 connections" line the page prints above the list."""
    try:
        return page.evaluate(
            """() => { const m = document.body.innerText.match(/([\\d,]+)\\s+connections?/i);
                       return m ? parseInt(m[1].replace(/,/g, '')) : null; }"""
        )
    except Exception:
        return None


def scrape_connections(headless=False, full_walk=False, log_fn=None):
    """Read your connections from the connections page.

    full_walk=False is the incremental refresh: it walks from the most recently
    added and stops once it has seen a long run of people already on file.
    full_walk=True keeps going to the bottom of the list, which is the way to
    collect an entire network in one pass.
    """
    from playwright.sync_api import sync_playwright

    say = log_fn or (lambda m: None)
    mode = "Full Connection Scrape" if full_walk else "Smart Connection Refresh"
    print(f"\n=== {mode} ===\n")

    existing_urls = set()
    if not full_walk:
        try:
            params = {"degree": "eq.1", "select": "profile_url", "limit": "5000"}
            if _active_user_id:
                params["user_id"] = f"eq.{_active_user_id}"
            existing_urls = {e["profile_url"] for e in read_connections(params=params)}
            print(f"  {len(existing_urls)} existing connections on file")
        except Exception:
            pass

    collected = {}
    reported = None

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=get_scraper_profile_path(),
            headless=headless,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
            timeout=120000,
        )

        page = browser.pages[0] if browser.pages else browser.new_page()
        page.set_default_timeout(120000)
        page.set_default_navigation_timeout(120000)

        if not ensure_logged_in(page, log_fn=log_fn):
            browser.close()
            return []

        print("Opening connections page...")
        say("Opening your connections page...")
        try:
            page.goto(CONNECTIONS_URL, wait_until="domcontentloaded")
        except Exception:
            pass
        try:
            # Wait for the list itself, not a fixed sleep: a slow render used to
            # look identical to an empty network.
            page.wait_for_selector('a[href*="/in/"]', timeout=60000)
        except Exception:
            print("  No connections rendered on the page.")
            say("No connections rendered — is the page loading?")
            browser.close()
            return []
        time.sleep(3)

        reported = _reported_connection_count(page)
        if reported:
            print(f"  LinkedIn reports {reported} connections")
            say(f"LinkedIn reports {reported} connections")

        known_streak = 0
        stalls = 0
        extract_errors = 0

        for round_num in range(MAX_SCROLL_ROUNDS):
            if stop_requested():
                print("  Stopped — keeping what was collected so far.")
                break
            try:
                page.evaluate(SCROLL_CONTAINER_JS)
            except Exception:
                pass
            try:
                page.mouse.move(700, 500)
                page.mouse.wheel(0, 3000)
            except Exception:
                pass
            time.sleep(SCROLL_PAUSE_SECONDS)

            before = len(collected)
            try:
                rows = page.evaluate(CONNECTIONS_EXTRACT_JS)
                extract_errors = 0
            except Exception as exc:
                # Never let this look like "you have no connections": say it out
                # loud and give up rather than reporting a confident zero.
                rows = []
                extract_errors += 1
                if extract_errors == 1:
                    print(f"  Could not read the page: {exc}")
                    say("Could not read the connections page.")
                if extract_errors >= 3:
                    print("  Aborting — the page could not be read three times running.")
                    browser.close()
                    return []
            for row in rows:
                url = row.get("profileUrl")
                if not url or url in collected:
                    continue
                collected[url] = row
                if url in existing_urls:
                    known_streak += 1
                else:
                    known_streak = 0
            gained = len(collected) - before

            if gained:
                stalls = 0
            else:
                stalls += 1
                # Older layouts paginate with a button instead of scrolling.
                try:
                    more = page.locator('button:has-text("Load more"), button:has-text("Show more")').first
                    if more.count() and more.is_visible(timeout=500):
                        more.click()
                        time.sleep(1.5)
                        stalls = 0
                except Exception:
                    pass

            if gained and len(collected) % 50 < gained:
                msg = f"  {len(collected)}" + (f" / {reported}" if reported else "") + " collected"
                print(msg, flush=True)
                say(msg.strip())

            if stalls >= SCROLL_STALL_LIMIT:
                print(f"  Reached the end of the list ({len(collected)} collected).")
                break
            if reported and len(collected) >= reported:
                print(f"  Collected all {len(collected)} connections.")
                break
            if not full_walk and known_streak >= 20:
                print(f"  Caught up — {known_streak} already on file in a row.")
                break

        browser.close()

    found = list(collected.values())
    new_rows = [r for r in found if r["profileUrl"] not in existing_urls] if existing_urls else found
    with_photos = sum(1 for r in found if r.get("imageUrl"))
    if existing_urls:
        print(f"\nCollected {len(found)} connections ({with_photos} with photos); {len(new_rows)} new.")
        say(f"Collected {len(found)} connections, {len(new_rows)} new")
    else:
        # A full walk does not load what is already saved, so it cannot say what is
        # new — it used to call all 814 "new", then the app said "0 new". The app's
        # "Sent … → N new" line below is the one that knows.
        print(f"\nCollected {len(found)} connections ({with_photos} with photos).")
        say(f"Collected {len(found)} connections")

    # Only meaningful on a full walk: a refresh stops early on purpose.
    if full_walk and reported and len(found) < reported * 0.5:
        print(f"  WARNING: LinkedIn reported {reported} but only {len(found)} were read.")
        print("  Re-run, and if it repeats the page layout has probably changed again.")
        say(f"Warning: only read {len(found)} of {reported}")

    if new_rows:
        print(f"\nPushing {len(new_rows)} connections to the app...")
        push_connections(new_rows, degree=1)
    else:
        print("\nNothing new to push.")

    print(f"\nDone. Visit {APP_URL} to see your network.")
    return new_rows


BRIDGE_COOLDOWN = 120             # after a real scrape: many page views, be polite
BRIDGE_LOAD_ATTEMPTS = 6          # how many times to look for the connections URN
BRIDGE_LOAD_STEP = 5              # seconds between looks
LINKEDIN_MAX_PAGES = 100          # LinkedIn's people search never goes past page 100
END_CHECKS = 3                    # looks for another page before calling a list finished
SAVE_EVERY_PAGES = 10             # save as a long read goes, so a stop loses little
# Pace between searches. 0.1.6 read a page every ~6 s — 27 searches in three and
# a half minutes — and LinkedIn blocked the account's search on the 28th. These
# are a stopgap until the pacing is set from research (TRAPS §35): a rest before
# every search, and a longer one after every SAVE_EVERY_PAGES. Fixed, not
# randomised: the point is fewer searches an hour, not looking like a person.
PAGE_PAUSE = 20                   # seconds before each next page of results
CHUNK_COOLDOWN = 60               # extra seconds after every SAVE_EVERY_PAGES pages
LEGACY_PAGES_READ = 10            # how far every read before 0.1.6 went, at most


# Someone whose connections are hidden can never produce a 2nd-degree row. The
# "who still needs bridging" query is "everyone with no 2nd-degree rows", so
# without a record of the attempt they come back in the list on every run — and
# because the list is sorted by tier, the same person is retried first, forever.
# That is what made auto-bridge look stuck rather than slow.
def _skips_path():
    base = Path(os.environ.get("SIX_DEGREES_HOME") or (Path.home() / ".six-degrees"))
    base.mkdir(parents=True, exist_ok=True)
    return base / "bridge-skips.json"


def load_bridge_skips():
    try:
        return json.loads(_skips_path().read_text())
    except Exception:
        return {}


def record_bridge_skip(profile_url, name, reason):
    skips = load_bridge_skips()
    skips[profile_url] = {
        "name": name,
        "reason": reason,
        "at": datetime.now().isoformat(timespec="seconds"),
    }
    try:
        _skips_path().write_text(json.dumps(skips, indent=2))
    except Exception as exc:
        print(f"  (could not record the skip: {exc})")


def clear_bridge_skips():
    try:
        _skips_path().unlink()
        print("Cleared the skip list — every bridge will be tried again.")
    except FileNotFoundError:
        print("No skips recorded.")


# How far each person's connections have been read.
#
# Reading someone's whole list can take a hundred pages and a quarter of an hour.
# Without a note of where a read got to, a stop, LinkedIn's monthly search limit
# or a crash threw all of it away and the next run started again at page 1 — and
# before 0.1.6 nobody's list was read past page 10 at all, with no way to go
# back for the rest. Every save now notes the last page read and whether
# LinkedIn had more, and the next run carries on from the page after. Kept per
# profile in the app, beside the skip list. TRAPS §34.
#
#   {"<profile id>": {"<their profile url>": {
#       "name": ..., "pages": 25,  # read through page 25
#       "more": true,              # LinkedIn had a page 26
#       "urn": ...,                # the id their connections are searched by
#       "hidden": true,            # only when their list had gone private
#       "at": ...}}}
def _progress_path():
    base = Path(os.environ.get("SIX_DEGREES_HOME") or (Path.home() / ".six-degrees"))
    base.mkdir(parents=True, exist_ok=True)
    return base / "bridge-progress.json"


def _progress_owner():
    return str(_active_user_id or "default")


def _read_progress_file():
    try:
        data = json.loads(_progress_path().read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def load_bridge_progress():
    """How far each of this profile's people has been read, by profile URL."""
    mine = _read_progress_file().get(_progress_owner())
    return mine if isinstance(mine, dict) else {}


def _change_progress(change):
    data = _read_progress_file()
    mine = data.get(_progress_owner())
    if not isinstance(mine, dict):
        mine = {}
    change(mine)
    data[_progress_owner()] = mine
    try:
        path = _progress_path()
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(path)          # never a half-written file
    except Exception as exc:
        print(f"  (could not note how far this read got: {exc})")


def record_bridge_progress(profile_url, name, pages, more, urn=None):
    """Note that someone's connections have been read through page `pages`.

    It never winds the note back. A read from page 1 that stops short of an
    earlier, deeper one leaves the deeper one standing: those pages are still
    saved. forget_bridge_progress() is for when they are not.
    """
    def change(mine):
        old = mine.get(profile_url) or {}
        read, left = int(pages), bool(more)
        if int(old.get("pages") or 0) > read:
            read, left = int(old["pages"]), bool(old.get("more"))
        entry = {"name": name, "pages": read, "more": left,
                 "at": datetime.now().isoformat(timespec="seconds")}
        if urn or old.get("urn"):
            entry["urn"] = urn or old.get("urn")
        mine[profile_url] = entry
    _change_progress(change)


def mark_bridge_hidden(profile_url, name):
    """Their list was readable once and is not now. What is mapped stays."""
    def change(mine):
        old = mine.get(profile_url) or {"pages": LEGACY_PAGES_READ, "more": True}
        mine[profile_url] = {**old, "name": name, "hidden": True,
                             "at": datetime.now().isoformat(timespec="seconds")}
    _change_progress(change)


def forget_bridge_progress(profile_url):
    _change_progress(lambda mine: mine.pop(profile_url, None))


def next_page_to_read(entry, retry_hidden=False):
    """The page to carry on from for someone already mapped, or None if there is nothing left.

    No note at all means they were mapped before 0.1.6 kept one, and every read
    then stopped at page 10.
    """
    if entry is None:
        return LEGACY_PAGES_READ + 1
    if entry.get("hidden") and not retry_hidden:
        return None
    if not entry.get("more"):
        return None
    nxt = int(entry.get("pages") or 0) + 1
    return nxt if nxt <= LINKEDIN_MAX_PAGES else None


# Stopping cleanly.
#
# A long auto-bridge run is the one thing here you will want to interrupt, and
# killing the process outright leaves a Chrome window with a live LinkedIn
# session orphaned behind it. So SIGTERM sets a flag instead: the loop notices
# between people, and while counting down, and exits with a summary.
_stop_requested = False


def _request_stop(signum, _frame):
    global _stop_requested
    if not _stop_requested:
        _stop_requested = True
        print("\n  Stopping after the current step — closing the browser cleanly...", flush=True)


def install_stop_handler():
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _request_stop)
        except (ValueError, OSError):
            pass          # not the main thread (server mode) — nothing to install


def stop_requested():
    return _stop_requested


def interruptible_sleep(seconds, on_tick=None, step=5):
    """Sleep, but notice a stop request. Returns False if we were interrupted."""
    waited = 0
    while waited < seconds:
        if stop_requested():
            return False
        chunk = min(step, seconds - waited)
        time.sleep(chunk)
        waited += chunk
        if on_tick and waited < seconds:
            on_tick(seconds - waited)
    return not stop_requested()




def _profile_unavailable(page):
    """LinkedIn's explicit "you cannot see this" pages.

    Worth checking separately: these never grow a connections link, so without
    this the scraper spends its whole budget waiting for something that is not
    coming.
    """
    try:
        return page.evaluate("""
        () => {
          const t = (document.body.innerText || '').toLowerCase();
          return t.includes('this profile is not available')
              || t.includes('profile unavailable')
              || t.includes("this page doesn't exist")
              || t.includes('page not found');
        }
        """)
    except Exception:
        return False


def _find_connection_urn(page):
    """The id LinkedIn uses to search someone's connections, read from an href."""
    try:
        return page.evaluate("""
        () => {
          for (const link of document.querySelectorAll('a')) {
            const m = (link.href || '').match(/connectionOf[=%5B%22"]*([A-Za-z0-9_:-]+)/);
            if (m) return m[1];
          }
          return null;
        }
        """)
    except Exception:
        return None


# What one page of someone's connections holds.
#
# A raw string (r"""), like every snippet of JavaScript in this file must be. In
# a plain string Python turns the "\n" in split('\n') into a real line break
# before the browser sees it, and the whole function is a syntax error —
# "Invalid or unexpected token". That broke every 2nd-degree scan on page 1 from
# 2026-09-09 until it was noticed. tests/scraper-js.test.mjs now parses every
# snippet on every PR. TRAPS §31.
BRIDGE_RESULTS_JS = r"""
        () => {
          // Build URL map from profile links
          // Anchor on the profile link, never on the anchor's text.
          //
          // This used to build a name -> URL map keyed by the link text, first
          // one wins. Any two results sharing display text collapsed onto a
          // single URL — and "LinkedIn Member" is the text for every
          // out-of-network person in a 2nd-degree search, so one person's photo
          // was handed to everybody who happened to be unnamed. That is where
          // the duplicate faces came from.
          const clean = (t) => (t || '').replace(/[\u2019']s profile picture$/i, '').trim();
          const byHref = new Map();
          const root = document.querySelector('[role="main"], main') || document.body;

          root.querySelectorAll('a[href*="/in/"]').forEach((a) => {
            if (a.closest('nav, header, footer')) return;
            const raw = a.getAttribute('href') || '';
            if (!raw.includes('/in/')) return;
            let url = raw.startsWith('http') ? raw : 'https://www.linkedin.com' + raw;
            url = url.split('?')[0].split('#')[0].replace(/\/+$/, '') + '/';

            let rec = byHref.get(url);
            if (!rec) { rec = { profileUrl: url, name: '', headline: '', imageUrl: '', named: false }; byHref.set(url, rec); }

            const img = a.querySelector('img');
            if (img && img.src && img.src.includes('media.licdn.com') && !/ghost/.test(img.src)) {
              if (!rec.imageUrl) rec.imageUrl = img.src;
              if (!rec.name && img.alt) rec.name = clean(img.alt);
            }

            const lines = (a.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
            if (lines.length && !rec.named) {
              const first = clean(lines[0]);
              if (first && first.length <= 60 && !/^(Connect|Follow|Message|Invite)$/i.test(first)) {
                rec.name = first;
                rec.named = true;
              }
            }

            // Headline lives beside the name in the result card, not inside the
            // anchor — walk up to the card and take the first real line after
            // the name. Not simply the next line: LinkedIn puts a screen-reader
            // line ("View Jane Doe's profile") straight after the name, and taking
            // that saved it as everybody's headline. Skip lines that are chrome.
            const chrome = (l) => /^View\b.*profile$/i.test(l)
              || /^(Connect|Follow|Message|Invite|Pending)$/i.test(l)
              || /mutual connection/i.test(l)
              || /followers$/i.test(l)
              || /degree connection/i.test(l)
              || /^(1st|2nd|3rd\+?)$/i.test(l)
              || /^\u2022/.test(l);
            if (!rec.headline) {
              let card = a;
              for (let k = 0; k < 6 && card.parentElement; k++) {
                card = card.parentElement;
                const cardLines = (card.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
                const idx = cardLines.findIndex((l) => clean(l) === rec.name);
                if (idx >= 0) {
                  const cand = cardLines.slice(idx + 1, idx + 5).find((l) => !chrome(l) && clean(l) !== rec.name);
                  if (cand) rec.headline = cand;
                  break;
                }
              }
            }
          });

          const results = [...byHref.values()]
            .filter((r) => r.name && r.name.length >= 2)
            .map(({ named, ...r }) => r);
          return results;
        }
        """

# The profile links on the page, as a fingerprint: how a click on Next is known
# to have brought up a different page rather than the same one again.
RESULT_LINKS_JS = r"""
() => {
  const root = document.querySelector('[role="main"], main') || document.body;
  const out = new Set();
  root.querySelectorAll('a[href*="/in/"]').forEach((a) => {
    if (a.closest('nav, header, footer')) return;
    out.add((a.getAttribute('href') || '').split('?')[0]);
  });
  return [...out].sort();
}
"""

# "About 1,340 results" above the list. Only for the log: it is approximate, and
# the end of a list is decided by the pages themselves.
RESULT_COUNT_JS = r"""
() => {
  const root = document.querySelector('[role="main"], main') || document.body;
  const text = (root.innerText || '').slice(0, 3000);
  const m = text.match(/(?:About\s+)?(\d[\d,.]*)\s*([KkMm])?\+?\s+results?\b/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= /k/i.test(m[2]) ? 1000 : 1000000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
"""

# LinkedIn's wording when a free account has used its searches for the month.
SEARCH_LIMIT_JS = r"""
() => {
  const t = (document.body.innerText || '').toLowerCase();
  // Reached, not approaching: "approaching the commercial use limit" is a
  // warning (PUSHBACK_JS), and reporting it as the limit sent people off to
  // wait for next month.
  const approaching = t.includes('approaching the commercial use limit');
  return (t.includes('commercial use limit') && !approaching)
      || t.includes('reached the monthly limit')
      || t.includes('reached your monthly limit');
}
"""

# LinkedIn pushing back, in its own words (Help Center articles a1393432,
# a1340567, a1339220) and by where it sends the page. Any of these ends the
# batch: carrying on after an "unusual activity" warning or a security check is
# what LinkedIn says turns a warning into a restriction. TRAPS §35.
PUSHBACK_JS = r"""
() => {
  const path = location.pathname.toLowerCase();
  if (path.startsWith('/checkpoint')) return 'a security check';
  if (path.startsWith('/authwall') || path.startsWith('/uas/') || path.startsWith('/login')) return 'being signed out';
  const t = (document.body.innerText || '').toLowerCase();
  if (t.includes('unusual activity from your account')) return 'an unusual-activity warning';
  if (t.includes('ability to view profiles has been temporarily restricted')
      || t.includes('profile viewing temporarily restricted')) return 'profile viewing being restricted';
  if (t.includes('restricted your account') || t.includes('account has been temporarily restricted')) return 'the account being restricted';
  if (t.includes('approaching the commercial use limit')) return 'the monthly search limit coming up';
  return null;
}
"""

# Did their profile page really render? Their first name in the tab title or the
# page heading means LinkedIn served the profile — so a missing connections link
# is them hiding their list, not a page that failed to load (TRAPS §35).
PROFILE_SHOWN_JS = r"""
(name) => {
  // Whole words only, and never against " | LinkedIn": every tab is titled
  // LinkedIn, and "li", "lin" or "ed" are inside it — a blank page counted as
  // Li Wei's profile.
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const first = norm(name).split(' ')[0];
  if (!first || first.length < 2) return false;
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp('(^|[^\\p{L}])' + esc + '([^\\p{L}]|$)', 'u');
  const title = norm(document.title).replace(/^\(\d+\)\s*/, '').replace(/\s*\|\s*linkedin\s*$/, '');
  const h1 = document.querySelector('main h1, h1');
  const heading = norm(h1 && h1.innerText);
  return word.test(heading) || (title !== 'linkedin' && word.test(title));
}
"""

# LinkedIn's empty-search message: positive evidence that a list has ended, as
# opposed to a page that simply didn't load.
NO_RESULTS_JS = r"""
() => {
  const root = document.querySelector('[role="main"], main') || document.body;
  return /no results found/i.test(root.innerText || '');
}
"""


def _window_closed(page):
    """Closing the browser window is how you say "stop". Treated as a stop."""
    global _stop_requested
    try:
        closed = page.is_closed()
    except Exception:
        closed = True
    if closed and not stop_requested():
        _stop_requested = True
        print("\n  The browser window was closed — stopping, and keeping what was read.")
    return closed


def _pushback(page):
    """The reason LinkedIn is pushing back, or None."""
    try:
        return page.evaluate(PUSHBACK_JS)
    except Exception:
        return None


def _keep_pushback_evidence(page, reason):
    """Keep what the page showed, so the wording can be recognised next time.

    The real notices have never been captured (PHASES.md). Local only, beside
    the database; nothing here leaves the machine.
    """
    try:
        text = page.evaluate("() => (document.body.innerText || '').slice(0, 2000)")
    except Exception:
        text = ""
    try:
        base = Path(os.environ.get("SIX_DEGREES_HOME") or (Path.home() / ".six-degrees")) / "pushback"
        base.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        (base / f"{stamp}.txt").write_text(f"reason: {reason}\nurl: {getattr(page, 'url', '')}\n\n{text}\n")
        print(f"  (What the page showed is kept in {base}/{stamp}.txt)")
    except Exception:
        pass


def _pushback_advice(reason):
    """What to do next, by what LinkedIn did."""
    reason = reason or ""
    if "security check" in reason:
        if os.environ.get("SIX_DEGREES_FROM_APP"):
            return ('Finish the check by hand: on the Scan page, step 2, press "Open LinkedIn". '
                    "Then leave scanning for a day.")
        return "Finish the check by hand: run with --login. Then leave scanning for a day."
    if "signed out" in reason:
        return "Sign in again (Open LinkedIn on the Scan page, or --login), then leave it a day."
    return "Leave it at least a day before scanning again."


def _pushed_back(page, reach, reason):
    """Note push-back on this read: the rest is left for later, never marked finished."""
    reach["pushed_back"] = True
    reach["pushback_reason"] = reason
    reach["more"] = True
    print(f"  LinkedIn is pushing back ({reason}). Stopping here.")
    _keep_pushback_evidence(page, reason)


# Which page the pagination bar says is showing, when it says.
CURRENT_PAGE_JS = r"""
() => {
  for (const el of document.querySelectorAll('[aria-current="true"], [aria-current="page"]')) {
    const t = (el.innerText || el.textContent || '').trim();
    if (/^\d{1,3}$/.test(t)) return parseInt(t, 10);
  }
  return null;
}
"""


def _url_page(url):
    """The page number in a LinkedIn search URL; page 1 when there is none."""
    try:
        return int(parse_qs(urlparse(url).query).get("page", ["1"])[0])
    except (ValueError, TypeError):
        return 1


def _result_links(page):
    try:
        return page.evaluate(RESULT_LINKS_JS)
    except Exception:
        return []


def _scroll_to_foot(page):
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        pass


def _read_results_page(page):
    """The people on the current page, looked for END_CHECKS times if it seems empty."""
    for attempt in range(1, END_CHECKS + 1):
        found = page.evaluate(BRIDGE_RESULTS_JS)
        if found:
            return found
        if attempt < END_CHECKS:
            _scroll_to_foot(page)
            time.sleep(2 * attempt)
    return []


def _find_next(page):
    """LinkedIn's Next button when there is another page, else None.

    Looked for END_CHECKS times, scrolling to the foot of the list and waiting a
    little longer each time: the pagination bar renders late, and calling a list
    finished because the button was slow would stop that person short for good.
    A Next that is there but disabled is LinkedIn saying this is the last page.
    """
    for attempt in range(1, END_CHECKS + 1):
        try:
            btn = page.locator('button:has-text("Next")').first
            if btn.is_visible() and btn.is_enabled():
                return btn
        except Exception:
            pass
        if attempt < END_CHECKS:
            print(f"  No Next button yet; looking again ({attempt + 1} of {END_CHECKS})...")
            _scroll_to_foot(page)
            time.sleep(2 * attempt)
    return None


def _wait_for_new_results(page, before, seconds):
    """True once the profile links differ from `before` — the page really changed."""
    waited = 0
    while waited < seconds:
        time.sleep(1)
        waited += 1
        now = _result_links(page)
        if now and now != before:
            return True
    return False


def _advance(page, pg):
    """Go from results page pg to pg + 1. Returns "moved", "end" or "stuck".

    "end" only once _find_next has looked END_CHECKS times. A click that leaves
    the same results showing is tried again, up to END_CHECKS times; after that
    the read stops as "stuck", which leaves the rest to the next run rather than
    calling the list finished.
    """
    before = _result_links(page)
    btn = _find_next(page)
    if btn is None:
        # The end of a list is only believed from a live page that was showing
        # results. A closed window or a blank page proves nothing, and a wrong
        # "end" marks a list finished for good.
        if _window_closed(page) or not before:
            return "stuck"
        return "end"
    for attempt in range(1, END_CHECKS + 1):
        try:
            btn.click(timeout=15000)
        except Exception:
            pass
        if _wait_for_new_results(page, before, 10):
            return "moved"
        if _url_page(page.url) == pg + 1:
            # The click landed and the page is just slow. Clicking again could
            # skip a page, so give it longer instead.
            return "moved" if _wait_for_new_results(page, before, 15) else "stuck"
        print(f"  Page {pg + 1} did not open; clicking Next again ({attempt + 1} of {END_CHECKS})...")
        btn = _find_next(page)
        if btn is None:
            return "stuck"
    return "stuck"


def _dedupe(connections):
    """Keep each profile once: the app refused a whole batch that named anyone twice (TRAPS §32)."""
    seen, unique = set(), []
    for c in connections:
        url = c.get("profileUrl")
        if url and url not in seen:
            seen.add(url)
            unique.append(c)
    return unique


def _page_limit_hint(next_page):
    if os.environ.get("SIX_DEGREES_FROM_APP"):
        return (f'To read the rest, set "Read up to" to every page on the Scan page and keep '
                f'"Also finish people already mapped" ticked: the next run carries on from page {next_page}.')
    return f"Run again with --deeper, and no --max-pages, to carry on from page {next_page}."


def _scrape_one_bridge(page, bridge_name, bridge_id, profile_url, max_pages=LINKEDIN_MAX_PAGES,
                       start_page=1, urn=None, on_save=None):
    """
    Read one person's connections, from start_page until their list ends or
    max_pages. Takes an already-open Playwright page.

    Returns (connections, status, reach). `connections` is what has not already
    been handed to on_save(connections, last_page, more, urn), which is called
    every SAVE_EVERY_PAGES pages of a long read. `reach` says how far it got:
      last     the last page read (start_page - 1 if none)
      more     LinkedIn has pages after `last` that were not read
      urn      the id LinkedIn searches their connections by
      found    how many people were read in all
      limited  LinkedIn's monthly search limit ended the read

    Timing is calibrated from successful runs:
    - 30s profile render wait (LinkedIn is slow)
    - 10s after search URL navigation
    - 3s on each page before reading it
    - Playwright locator click for Next (not JS — more reliable)
    """
    slug = profile_url.split("/in/")[1].rstrip("/")
    reach = {"last": start_page - 1, "more": False, "urn": urn, "found": 0, "limited": False,
             "pushed_back": False}

    if urn:
        # Known from an earlier read, so their profile needn't be opened again —
        # one fewer profile view, which is what LinkedIn counts most.
        print(f"  Going straight to {bridge_name}'s connections (their search id is known).")
    else:
        # Step 1: Navigate to profile (wait_until="commit" — don't wait for full load)
        print(f"  Opening {bridge_name}'s profile...")
        try:
            page.goto(profile_url, wait_until="commit")
        except Exception as e:
            print(f"  Navigation slow: {str(e)[:50]}... continuing anyway")

        # Steps 2 and 3, together. The URN is what we are actually after, and it is
        # read from a link's href — so look for it on every pass instead of waiting
        # for a "500+ connections" link first and only then extracting. A public
        # profile now finishes as soon as the link exists, and a private one is not
        # charged an extra scroll-and-wait on the way to the same answer.
        for attempt in range(BRIDGE_LOAD_ATTEMPTS):
            time.sleep(BRIDGE_LOAD_STEP)

            why = _pushback(page)
            if why:
                _pushed_back(page, reach, why)
                return [], "pushback", reach

            if _profile_unavailable(page):
                print("  Profile is not viewable — skipping.")
                return [], "private", reach

            urn = _find_connection_urn(page)
            if urn:
                print(f"  Profile loaded ({(attempt + 1) * BRIDGE_LOAD_STEP}s)")
                break

            # The connections block lazy-loads; nudge it once part-way through.
            if attempt == BRIDGE_LOAD_ATTEMPTS // 2:
                try:
                    page.evaluate("window.scrollTo(0, 600)")
                except Exception:
                    pass
            elif attempt < BRIDGE_LOAD_ATTEMPTS - 1:
                print(f"  Still loading... ({(attempt + 1) * BRIDGE_LOAD_STEP}s)")

        if not urn:
            why = _pushback(page)
            if why:
                _pushed_back(page, reach, why)
                return [], "pushback", reach
            shown = False
            try:
                shown = bool(page.evaluate(PROFILE_SHOWN_JS, bridge_name))
            except Exception:
                pass
            if not shown:
                # Their profile never rendered, so this says nothing about them.
                # Marking them hidden here is what made a block skip-list people
                # for good; this counts towards the batch's circuit breaker.
                print("  Their profile didn't load properly, so they're not marked hidden.")
                return [], "unclear", reach
            print(f"  Could not find URN — connections are private.")
            return [], "private", reach

        print(f"  Found URN: {urn[:30]}...")
        reach["urn"] = urn

    # Step 4: search everyone they are connected to. network=["F","S","O"] is
    # 1st, 2nd and 3rd+ — all of them; the app drops your own connections when
    # it saves. It used to be announced as a "3rd+ filter", which it never was.
    search_url = f"https://www.linkedin.com/search/results/people/?network=%5B%22F%22%2C%22S%22%2C%22O%22%5D&connectionOf=%5B%22{urn}%22%5D"
    if start_page > 1:
        search_url += f"&page={start_page}"
        print(f"  Opening their connections at page {start_page}...")
    else:
        print("  Opening their connections...")
    try:
        page.goto(search_url, wait_until="commit")
    except:
        pass

    # Step 5: Wait for search results — 10s initial + up to 30s retry
    # Successful runs: results appear within 10-15s
    time.sleep(10)
    results_loaded = False
    for attempt in range(6):
        try:
            page.wait_for_selector('a[href*="/in/"]', timeout=5000)
            print("  Search results loaded!")
            results_loaded = True
            break
        except:
            print(f"  Still loading... ({10 + (attempt+1)*5}s)")
            time.sleep(5)

    try:
        at_limit = bool(page.evaluate(SEARCH_LIMIT_JS))
    except Exception:
        at_limit = False
    why = _pushback(page)
    if why:
        _pushed_back(page, reach, why)
        return [], "pushback", reach
    if at_limit:
        print("  LinkedIn's monthly search limit.")
        reach["limited"] = reach["more"] = True
        _keep_pushback_evidence(page, "the monthly search limit")
        return [], "limited", reach

    if not results_loaded:
        # Their connections link was there, so their list is visible: a search
        # that won't open is LinkedIn failing us, not them hiding anything.
        _pushed_back(page, reach, "a search that would not open")
        return [], "pushback", reach

    if start_page > 1:
        # Carrying on only works if LinkedIn really opened that page. If it
        # quietly showed page 1 instead, reading on would note pages as read
        # that never were.
        shown = None
        try:
            shown = page.evaluate(CURRENT_PAGE_JS)
        except Exception:
            pass
        at = _url_page(page.url)
        if at != start_page or (shown is not None and shown != start_page):
            print(f"  LinkedIn opened page {shown or at}, not page {start_page}. "
                  "Stopping so no page is noted as read that wasn't.")
            reach["more"] = True
            return [], "error", reach

    try:
        total = page.evaluate(RESULT_COUNT_JS)
    except Exception:
        total = None
    if total:
        pages = -(-total // 10)
        print(f"  About {total:,} results in their list: {pages} pages"
              + (f", and LinkedIn shows the first {LINKEDIN_MAX_PAGES}." if pages > LINKEDIN_MAX_PAGES else "."))
    until = "until their list ends" if max_pages >= LINKEDIN_MAX_PAGES else f"up to page {max_pages}"
    print(f"  Reading from page {start_page} {until}, saving every {SAVE_EVERY_PAGES} pages.")

    # Step 6: read each page, then move to the next, until the list ends. Every
    # page is a search on your account.
    chunk, chunk_pages, pg = [], 0, start_page
    while True:
        if stop_requested() or _window_closed(page):
            reach["more"] = True
            print(f"  Stopped at page {pg}; the next run carries on from there.")
            break
        print(f"  Page {pg}... ", end="", flush=True)
        try:
            time.sleep(3)
            if page.evaluate(SEARCH_LIMIT_JS):
                print("LinkedIn's monthly search limit.")
                reach["limited"] = reach["more"] = True
                _keep_pushback_evidence(page, "the monthly search limit")
                break
            why = _pushback(page)
            if why:
                print()
                _pushed_back(page, reach, why)
                break
            page_results = _read_results_page(page)
        except Exception:
            if stop_requested():      # the browser went down with the stop
                reach["more"] = True
                print("stopped.")
                break
            raise
        if not page_results:
            why = _pushback(page)
            if why:
                print()
                _pushed_back(page, reach, why)
                break
            ended = False
            try:
                ended = bool(page.evaluate(NO_RESULTS_JS))
            except Exception:
                pass
            if pg == start_page and start_page > 1 and not ended:
                # Carrying on, and the very first page is blank without saying
                # "No results found". That is how a search LinkedIn is limiting
                # can look, so it is not taken as the end: a wrong "finished"
                # would drop the rest of their list for good. TRAPS §35.
                reach["more"] = True
                reach["unsure"] = True
                print(f"blank. That can mean their list ended, or that LinkedIn is limiting "
                      f"searches, so they are left for the next run to check.")
                break
            print(f"nothing on it after {END_CHECKS} looks — that's the end of their list.")
            break

        page_results = [c for c in page_results if slug not in c.get("profileUrl", "")]
        chunk.extend(page_results)
        chunk_pages += 1
        reach["last"] = pg
        reach["found"] += len(page_results)
        print(f"{len(page_results)} found (total: {reach['found']})")

        if pg >= LINKEDIN_MAX_PAGES:
            print(f"  That was page {pg}, as far as LinkedIn's search goes.")
            break
        if pg >= max_pages:
            reach["more"] = _find_next(page) is not None or _window_closed(page)
            if reach["more"]:
                print(f"  Stopped at the {max_pages}-page limit, and LinkedIn has more. "
                      + _page_limit_hint(pg + 1))
            else:
                print("  No more pages — that's all of their list.")
            break

        # Rest before the next search, and longer after every SAVE_EVERY_PAGES.
        rest = PAGE_PAUSE
        if (pg - start_page + 1) % SAVE_EVERY_PAGES == 0:
            rest += CHUNK_COOLDOWN
            print(f"  {SAVE_EVERY_PAGES} pages read; resting {rest}s before the next search.")
        if not interruptible_sleep(rest) or _window_closed(page):
            reach["more"] = True
            print(f"  Stopped before page {pg + 1}; the next run carries on from there.")
            break

        try:
            step = _advance(page, pg)
        except Exception:
            if not stop_requested():
                raise
            step = "stuck"
        if step == "end":
            print(f"  No Next button after {END_CHECKS} looks — that's all of their list.")
            break
        if step == "stuck":
            reach["more"] = True
            if not stop_requested():
                print(f"  Page {pg + 1} would not open after {END_CHECKS} tries. LinkedIn may be "
                      f"limiting searches; the next run carries on from there.")
                _pushed_back(page, reach, _pushback(page) or "a page that would not open")
            break
        pg += 1

        # Save as it goes, so a stop, a crash or the search limit costs at most
        # the last few pages rather than the whole list.
        if on_save and chunk_pages >= SAVE_EVERY_PAGES:
            on_save(_dedupe(chunk), reach["last"], True, reach["urn"])
            chunk, chunk_pages = [], 0

    # Filter out the bridge themselves (already done page by page) and keep each
    # profile once: the same person can turn up on more than one page, and a
    # mutual connection repeats under many results.
    chunk = _dedupe(chunk)
    print(f"  Read {reach['found']} in all, pages {start_page}–{reach['last']}"
          if reach["last"] >= start_page else "  Nothing read.")

    return chunk, "success", reach


class BridgeRead(list):
    """The connections read, plus how the read went (`status`).

    A list, so everything that only wants the people — the CLI, server mode —
    keeps working. auto_bridge_all reads `status` to tell "their list is hidden"
    (LinkedIn served their profile, with no connections link) from "unclear"
    (the profile never rendered), which must never be recorded as hidden.
    """
    status = "success"


def _read(connections, status):
    out = BridgeRead(connections or [])
    out.status = status
    return out


def scrape_bridge(bridge_name, headless=False, max_pages=LINKEDIN_MAX_PAGES, deeper=False, fresh=False):
    """Read one person's connections into the app (opens its own browser).

    deeper: carry on from the page the last read of them stopped at, instead of
            starting again at page 1.
    fresh:  their mapped circle was just deleted, so forget how far it was read.

    Returns every connection read ([] when none; None when they could not be
    looked up). Raises SaveFailed if the app refuses a save, NotSignedIn if
    LinkedIn isn't signed in, and, after saving, SearchLimitReached if
    LinkedIn's monthly limit ends the read or LinkedInPushedBack if a page
    would not open.
    """
    from playwright.sync_api import sync_playwright

    # Find the bridge (read-only, filtered by active user)
    params = {"name": f"eq.{bridge_name}", "degree": "eq.1", "limit": "1"}
    if _active_user_id:
        params["user_id"] = f"eq.{_active_user_id}"
    bridges = read_connections(params=params)
    if not bridges:
        print(f"Bridge '{bridge_name}' not found in database.")
        return

    bridge = bridges[0]
    bridge_id = bridge["id"]
    profile_url = bridge["profile_url"]

    if fresh:
        forget_bridge_progress(profile_url)
    start_page, urn = 1, None
    if deeper:
        entry = load_bridge_progress().get(profile_url)
        nxt = next_page_to_read(entry, retry_hidden=True)
        if nxt is None:
            print(f"Every page of {bridge_name}'s connections has been read already.")
            return _read([], "finished")
        if nxt > max_pages:
            print(f"Pages 1–{nxt - 1} of {bridge_name}'s connections are read already. "
                  f"Choose more than {max_pages} pages to read further.")
            return _read([], "finished")
        start_page, urn = nxt, (entry or {}).get("urn")

    print(f"\n=== {'Carrying on with' if start_page > 1 else 'Scraping'} connections of {bridge_name} ===\n")

    read = []

    def save(connections, last, more, urn_now):
        if not connections:
            record_bridge_progress(profile_url, bridge_name, last, more, urn_now)
            return
        print(f"  Saving {len(connections)} (through page {last})...")
        push_connections(connections, degree=2, bridge_id=bridge_id,
                         on_saved=lambda: record_bridge_progress(profile_url, bridge_name, last, more, urn_now))
        read.extend(connections)

    outcome = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch_persistent_context(
                user_data_dir=get_scraper_profile_path(),
                headless=headless,
                channel="chrome",
                args=["--disable-blink-features=AutomationControlled"],
                timeout=120000,
            )
            try:
                page = browser.pages[0] if browser.pages else browser.new_page()
                page.set_default_timeout(120000)
                page.set_default_navigation_timeout(120000)

                # No page load before this: ensure_logged_in has to see whether
                # the session cookie was there *before* LinkedIn answered, or a
                # sign-out between people looks like a first sign-in.
                if not ensure_logged_in(page, stop_on_checkpoint=True):
                    raise NotSignedIn()

                outcome = _scrape_one_bridge(page, bridge_name, bridge_id, profile_url,
                                             max_pages=max_pages, start_page=start_page, urn=urn,
                                             on_save=save)
            finally:
                try:
                    browser.close()
                except Exception:
                    pass
    except (SaveFailed, NotSignedIn, LinkedInPushedBack):
        if stop_requested():
            return _read([], "stopped")
        raise
    except Exception:
        # A stop takes the browser down with it, and closing it can then fail.
        # If the read itself got to the end, what it found is still saved below.
        if outcome is None:
            if stop_requested():
                return _read([], "stopped")
            raise

    connections, status, reach = outcome

    if connections:
        print(f"\nSaving {len(connections)} connections to the app...")
        save(connections, reach["last"], reach["more"], reach["urn"])
    elif status == "success" and (start_page > 1 or reach["last"] >= 1):
        # Nothing unsaved, but where the read ended is still worth noting — for a
        # read carried on from page 11 that found nothing, it means "finished".
        record_bridge_progress(profile_url, bridge_name, reach["last"], reach["more"], reach["urn"])
    elif status == "private" and start_page > 1:
        # Only reached when their profile clearly rendered without a connections
        # link; a profile that didn't render is "unclear" and marks nothing.
        mark_bridge_hidden(profile_url, bridge_name)
        print("  Their connections are not visible any more — keeping what is mapped.")

    if reach["limited"]:
        raise SearchLimitReached(len(read))
    if reach.get("pushed_back"):
        raise LinkedInPushedBack(len(read), reach.get("pushback_reason") or "a page that would not open")

    if not read:
        print(f"\nDone! No connections found ({status}).")
        return _read([], status)

    left = (f" LinkedIn has more; the next run carries on from page {reach['last'] + 1}."
            if reach["more"] else " That's all of their list.")
    print(f"\nDone! {len(read)} of {bridge_name}'s connections read and saved.{left}")
    return _read(read, status)


def scrape_company(company_name, headless=False, log_fn=None):
    """Scrape all people at a specific company from LinkedIn search.
    Returns list of {name, headline, profileUrl, imageUrl}."""
    from playwright.sync_api import sync_playwright

    def log(msg):
        print(msg)
        if log_fn:
            log_fn(msg)

    log(f"Scraping employees at: {company_name}")

    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=get_scraper_profile_path(),
            headless=headless,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
            timeout=120000,
        )

        page = browser.pages[0] if browser.pages else browser.new_page()
        page.set_default_timeout(120000)
        page.set_default_navigation_timeout(120000)

        # Check login
        try:
            page.goto("https://www.linkedin.com/", wait_until="domcontentloaded")
        except:
            pass
        if not ensure_logged_in(page):
            log("Not signed into LinkedIn — sign in and run this again.")
            browser.close()
            return []

        # === STEP 1: Find the people search page for this company ===
        # Strategy: try company page first, fall back to search feed
        import urllib.parse
        import re
        people_url = None
        company_id = None

        # --- Approach A: Direct company page ---
        company_slug = company_name.lower().replace(' ', '-').replace('.', '').replace(',', '')
        company_page_url = f"https://www.linkedin.com/company/{urllib.parse.quote(company_slug)}/"
        log(f"  Trying company page: {company_slug}")
        try:
            page.goto(company_page_url, wait_until="commit")
        except:
            pass
        time.sleep(6)

        # Check if the company page loaded (not a 404 or unavailable)
        page_ok = page.evaluate("""
        () => {
          const title = document.title || '';
          const body = document.body?.innerText || '';
          if (title.includes('Page not found') || title.includes('404')) return false;
          if (body.includes('page doesn') || body.includes('not available') || body.includes('doesn\\'t exist')) return false;
          // Check if we see a company name heading
          const h1 = document.querySelector('h1');
          return h1 && h1.textContent.trim().length > 0;
        }
        """)

        if page_ok:
            log(f"  Company page loaded ✓")
            # Extract people URL from company page ("See all X employees" link)
            people_url = page.evaluate("""
            () => {
              const links = document.querySelectorAll('a');
              for (const link of links) {
                const h = link.href || '';
                if (h.includes('currentCompany') && h.includes('/search/results/people/')) {
                  return h;
                }
              }
              // Try extracting numeric company ID from page source
              const scripts = document.querySelectorAll('script, code');
              for (const s of scripts) {
                const text = s.textContent || '';
                const match = text.match(/"companyId":(\\d+)/);
                if (match) {
                  return 'https://www.linkedin.com/search/results/people/?currentCompany=%5B%22' + match[1] + '%22%5D&origin=FACETED_SEARCH';
                }
              }
              return null;
            }
            """)
            if people_url:
                log(f"  Got people URL from company page")
        else:
            log(f"  Company page unavailable, using search fallback...")

        # --- Approach B: Search feed fallback ---
        if not people_url:
            log(f"  Searching LinkedIn feed for: {company_name}")
            search_url = f"https://www.linkedin.com/search/results/all/?keywords={urllib.parse.quote(company_name)}"
            try:
                page.goto(search_url, wait_until="commit")
            except:
                pass
            time.sleep(8)

            # Look for People section links with currentCompany
            people_url = page.evaluate("""
            () => {
              const links = document.querySelectorAll('a');
              for (const link of links) {
                const h = link.href || '';
                if (h.includes('currentCompany') && h.includes('/search/results/people/')) {
                  return h;
                }
              }
              for (const link of links) {
                const text = (link.textContent || '').trim().toLowerCase();
                const h = link.href || '';
                if ((text.includes('see all') && text.includes('people')) && h.includes('/search/results/people/')) {
                  return h;
                }
              }
              return null;
            }
            """)

            if not people_url:
                # Scroll down — People section may be below fold
                log(f"  Scrolling to find People section...")
                page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
                time.sleep(3)
                people_url = page.evaluate("""
                () => {
                  const links = document.querySelectorAll('a');
                  for (const link of links) {
                    const h = link.href || '';
                    if (h.includes('currentCompany') && h.includes('/search/results/people/')) {
                      return h;
                    }
                  }
                  return null;
                }
                """)

            if not people_url:
                # Try clicking the "People" tab on the search page
                log(f"  Trying People tab...")
                try:
                    people_btn = page.locator('button:has-text("People")').first
                    if people_btn.is_visible(timeout=3000):
                        people_btn.click()
                        time.sleep(5)
                        current = page.url
                        if 'currentCompany' in current:
                            people_url = current
                except:
                    pass

            if people_url:
                log(f"  Got people URL from search feed")

        if not people_url:
            log(f"Could not find people for '{company_name}' via company page or search")
            browser.close()
            return []

        # === STEP 2: Extract company ID and navigate to people search ===
        id_match = re.search(r'currentCompany=%5B%22(\d+)%22%5D', people_url)
        if not id_match:
            id_match = re.search(r'currentCompany=\[%22(\d+)%22\]', people_url)
        if id_match:
            company_id = id_match.group(1)
            log(f"  Company ID: {company_id}")

        # Build a clean base URL — strip any existing network filter
        # We'll select all degree tabs on the page instead
        base_url = re.sub(r'[&?]network=[^&]*', '', people_url)
        # Clean up any double && or trailing ?&
        base_url = base_url.replace('&&', '&').replace('?&', '?').rstrip('?').rstrip('&')

        log(f"  Opening people search...")
        try:
            page.goto(base_url, wait_until="commit")
        except:
            pass
        time.sleep(8)

        # === STEP 3: Select ALL degree tabs (1st + 2nd + 3rd) ===
        # LinkedIn shows degree filter buttons at the top of search results.
        # We need to click each one that isn't already selected.
        log(f"  Selecting all degree filters...")

        # Click each degree button: "1st", "2nd", "3rd+"
        for degree_label in ['1st', '2nd', '3rd\\+', '3rd']:
            try:
                btn = page.locator(f'button:has-text("{degree_label.replace(chr(92), "")}")').first
                if btn.is_visible(timeout=2000):
                    # Check if already active/selected
                    is_active = btn.evaluate("""
                    el => {
                      const cl = el.className || '';
                      const aria = el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || '';
                      return cl.includes('active') || cl.includes('selected') || aria === 'true';
                    }
                    """)
                    if not is_active:
                        btn.click()
                        log(f"    Clicked {degree_label.replace(chr(92), '')} ✓")
                        time.sleep(2)
                    else:
                        log(f"    {degree_label.replace(chr(92), '')} already selected ✓")
            except:
                pass

        # Give LinkedIn time to reload results with all filters
        time.sleep(5)

        # Verify the URL now has the network filter — if not, the buttons
        # might be pills/links instead. Try clicking connection degree links.
        current_url = page.url
        if 'network' not in current_url:
            log(f"  Buttons didn't set filter, trying degree links...")
            # Some LinkedIn layouts use links instead of buttons for degree filters
            degree_links = page.evaluate("""
            () => {
              const results = [];
              document.querySelectorAll('a, button').forEach(el => {
                const text = (el.textContent || '').trim();
                if (/^(1st|2nd|3rd\\+?)$/.test(text)) {
                  results.push(text);
                  el.click();
                }
              });
              return results;
            }
            """)
            if degree_links:
                log(f"    Clicked degree links: {degree_links}")
                time.sleep(5)

        # If STILL no network filter and we have the company ID, build the URL manually
        current_url = page.url
        if 'network' not in current_url and company_id:
            log(f"  Degree buttons not found — using URL with all degrees")
            all_degrees_url = f"https://www.linkedin.com/search/results/people/?currentCompany=%5B%22{company_id}%22%5D&network=%5B%22F%22%2C%22S%22%2C%22O%22%5D&origin=FACETED_SEARCH"
            try:
                page.goto(all_degrees_url, wait_until="commit")
            except:
                pass
            time.sleep(8)

        # === STEP 4: Paginate and scrape all results ===
        all_people = []
        seen_urls = set()
        page_num = 1

        while page_num <= 20:
            log(f"  Page {page_num}...")
            time.sleep(3)

            page_data = page.evaluate("""
            () => {
              const urlMap = {};
              const imgMap = {};
              document.querySelectorAll('img').forEach(img => {
                if (!img.src || !img.src.includes('media.licdn.com')) return;
                const link = img.closest('a');
                if (link) {
                  const h = link.getAttribute('href') || '';
                  if (h.includes('/in/')) {
                    const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
                    imgMap[url] = img.src;
                  }
                }
              });
              document.querySelectorAll('a').forEach(a => {
                const h = a.getAttribute('href') || '';
                if (!h.includes('/in/')) return;
                const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
                const img = a.querySelector('img');
                if (img && img.src && img.src.includes('media.licdn.com')) { imgMap[url] = img.src; return; }
                const text = a.textContent.trim();
                if (!text || text.length > 60 || text.includes('mutual') || text.includes('Connect')) return;
                if (!urlMap[text]) urlMap[text] = url;
              });
              const main = document.querySelector('[role="main"], main');
              const pageText = main ? main.innerText : '';
              const lines = pageText.split('\\n').map(l => l.trim());
              const results = [];
              let i = 0;
              while (i < lines.length) {
                if (urlMap[lines[i]]) {
                  const name = lines[i], url = urlMap[name];
                  let headline = '';
                  let j = i + 1;
                  while (j < lines.length && j < i + 8) {
                    const l = lines[j].trim();
                    if (!l || l.match(/^\\u2022\\s*(1st|2nd|3rd)/) || l === name) { j++; continue; }
                    if (l === 'Connect' || l === 'Follow' || l === 'Message' || l.includes('mutual connection')) break;
                    if (!headline) { headline = l; j++; continue; }
                    j++;
                  }
                  results.push({ name, headline, profileUrl: url, imageUrl: imgMap[url] || '' });
                }
                i++;
              }
              return results;
            }
            """)

            new_on_page = 0
            for p in page_data:
                url = p.get('profileUrl', '')
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_people.append(p)
                    new_on_page += 1

            img_count = sum(1 for p in page_data if p.get('imageUrl'))
            log(f"    {len(page_data)} on page, {new_on_page} new ({img_count} photos) — total: {len(all_people)}")

            if len(page_data) == 0:
                break

            # Click Next
            try:
                next_btn = page.locator('button:has-text("Next")').first
                if next_btn.is_visible(timeout=3000):
                    next_btn.click()
                    page_num += 1
                    time.sleep(3)
                else:
                    break
            except:
                break

        log(f"Total: {len(all_people)} people found at {company_name}")
        browser.close()

    return all_people


def auto_bridge_all(headless=False, log_fn=None, retry_private=False, max_bridges=0, tiers=None,
                    order="newest", max_pages=LINKEDIN_MAX_PAGES, deeper=False):
    """Map everyone whose circle is not mapped yet, in the order chosen.

    Picks up from where it left off. With deeper, it also finishes people
    already mapped whose list goes on, from the page their last read stopped at.
    """

    def log(msg):
        print(msg)
        if log_fn:
            log_fn(msg)

    # Get all degree-1 connections (filtered by active user)
    D1_LIMIT = 20000
    newest = order != "score"
    # "added" is the order rows were saved in: each scan saves LinkedIn's list
    # top to bottom, and that list is "recently added" first.
    d1_params = {"degree": "eq.1", "select": "id,name,tier,power_score,profile_url,created_at,connected_date",
                 "order": "added" if newest else "power_score.desc", "limit": str(D1_LIMIT)}
    if _active_user_id:
        d1_params["user_id"] = f"eq.{_active_user_id}"
    all_d1 = read_connections(params=d1_params)
    if len(all_d1) >= D1_LIMIT:
        log(f"WARNING: only the first {D1_LIMIT} connections were read; some will be missed.")

    # Who already has a mapped circle. Asked as one row per bridge rather than
    # by pulling every 2nd-degree row and de-duplicating — that carried a limit
    # of 2000, so past that many the answer was quietly wrong and a resumed run
    # re-scraped people it had already done.
    bridged_ids = read_bridged_ids()

    # Someone counts as mapped once any of their list has been read, even if
    # everyone on it was already one of your connections and nothing was saved —
    # otherwise they would be read again from page 1 on every run.
    progress = load_bridge_progress()
    mapped = set(bridged_ids) | {c["id"] for c in all_d1 if c.get("profile_url") in progress}

    # Filter unbridged, sort by tier priority (S first, then by score)
    tier_order = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}
    unbridged = [c for c in all_d1 if c["id"] not in mapped]

    # People already found to be private are not tried again. Without this they
    # reappear every run, in the same place, and the run never gets past them.
    skips = {} if retry_private else load_bridge_skips()
    skipped_now = [c for c in unbridged if c.get("profile_url") in skips]
    unbridged = [c for c in unbridged if c.get("profile_url") not in skips]

    # People already mapped whose list goes on past where it was read.
    unfinished = []
    for c in all_d1:
        if c["id"] not in mapped:
            continue
        nxt = next_page_to_read(progress.get(c.get("profile_url")), retry_hidden=retry_private)
        if nxt is not None and nxt <= max_pages:
            unfinished.append({**c, "_from_page": nxt})
    if deeper:
        unbridged = unbridged + unfinished

    # Choosing tiers rather than "everything" or "only what is new".
    #
    # New connections need no special mode: the list of who still needs bridging
    # is recomputed from the data every run, so anyone added since simply
    # appears in it, sorted into their tier. What is worth choosing is how far
    # down the list to go — most people never want to map their D-tier circles,
    # and that choice is the one that costs rate limit.
    # Newest-first goes strictly by the date you connected, across every tier —
    # that is what "my most recent connection" means. Tiers choose who is included
    # in highest-tier-first order.
    if tiers and newest:
        log("Going by the date you connected, so every tier is included")
    if tiers and not newest:
        wanted = {t.strip().upper() for t in tiers if t and t.strip()}
        before = len(unbridged)
        unbridged = [c for c in unbridged if (c.get("tier") or "D").upper() in wanted]
        log(f"Limiting to {'/'.join(sorted(wanted, key=lambda t: tier_order.get(t, 9)))}-tier "
            f"({len(unbridged)} of {before} outstanding)")

    if newest:
        # Your newest connections first, by LinkedIn's "Connected on" date. People
        # without one yet (saved before dates were captured; one full scan fills
        # them in) come after, in the order they were saved — LinkedIn's own
        # "recently added" order within a scan. sort() is stable, so reverse=True
        # keeps that order among equal keys.
        unbridged.sort(key=lambda c: (1 if c.get("connected_date") else 0,
                                      c.get("connected_date") or c.get("created_at") or ""),
                       reverse=True)
        undated = sum(1 for c in unbridged if not c.get("connected_date"))
        log("Order: newest connections first, by the date you connected")
        if undated:
            log(f"  {undated} have no connection date yet — run \"Scan my whole network\" once to fill them in")
    else:
        unbridged.sort(key=lambda c: (tier_order.get(c.get("tier", "D"), 4), -(float(c.get("power_score", 0)))))
        log("Order: highest tier first")
    # Always said, so a read that stops at a page limit is never a mystery.
    if max_pages >= LINKEDIN_MAX_PAGES:
        log(f"Reading every page of each person's connections until their list ends "
            f"(LinkedIn shows {LINKEDIN_MAX_PAGES} pages at most), saving every {SAVE_EVERY_PAGES}")
    else:
        log(f"Reading up to {max_pages} pages per person (about {max_pages * 10} of their connections)")

    finishing = sum(1 for c in unbridged if c.get("_from_page", 1) > 1)
    log(f"Found {len(unbridged) - finishing} unbridged connections")
    log(f"Already bridged: {len(mapped)}")
    if deeper:
        log(f"Finishing {finishing} already mapped whose list goes on, from the page each stopped at")
    elif unfinished:
        log(f"({len(unfinished)} already mapped have more pages to read. "
            f"Tick \"Also finish people already mapped\" to include them.)")
    if skipped_now:
        log(f"Skipping {len(skipped_now)} whose connections are hidden (--retry-private to try again)")

    if not unbridged:
        log("Nothing left to bridge.")
        return []

    # Show plan
    tier_counts = {}
    for c in unbridged:
        t = c.get("tier", "D")
        tier_counts[t] = tier_counts.get(t, 0) + 1
    for t in ["S", "A", "B", "C", "D"]:
        if tier_counts.get(t, 0) > 0:
            log(f"  {t}-tier: {tier_counts[t]} to bridge")

    if max_bridges and max_bridges > 0:
        unbridged = unbridged[:max_bridges]
        log(f"Stopping after {len(unbridged)} this run.")

    # Two people in a row whose reads were unclear — a profile that never
    # rendered, a failure — is how LinkedIn limiting us looks from here, so two
    # in a row end the batch. Only unclear reads count. A profile that rendered
    # with no connections link is them hiding their list: that is recorded and
    # counts as LinkedIn answering normally. Nothing unclear is ever recorded,
    # so there is nothing to take back (an earlier version recorded, then
    # un-recorded, and two hidden people side by side stalled every batch).
    # TRAPS §35.
    BREAKER = 2
    streak = 0
    stopped_early = None   # why the batch ended before its list did

    results = []
    for i, person in enumerate(unbridged):
        if stop_requested():
            log("Stopped.")
            break

        name = person["name"]
        tier = person.get("tier", "?")
        score = person.get("power_score", "?")
        url = person.get("profile_url", "")
        from_page = person.get("_from_page", 1)

        log(f"[{i+1}/{len(unbridged)}] {name} ({tier}-tier, score {score})"
            + (f", carrying on from page {from_page}" if from_page > 1 else ""))

        healthy = False           # LinkedIn answered normally for this person
        try:
            result = scrape_bridge(name, headless=headless, max_pages=max_pages, deeper=from_page > 1)
            count = len(result) if result else 0
            status = getattr(result, "status", None)
            if count > 0:
                healthy = True
                results.append({"name": name, "tier": tier, "found": count, "status": "done"})
                log(f"  {count} connections read")
            elif stop_requested() or status == "stopped":
                pass              # stopped part-way: nothing to conclude about them
            elif result is None:
                results.append({"name": name, "tier": tier, "found": 0, "status": "error"})
                log("  Could not find them in the app to read their list")
            elif status == "private":
                # Their profile rendered, with no connections link: a real answer.
                healthy = True
                results.append({"name": name, "tier": tier, "found": 0, "status": "private"})
                if from_page > 1:
                    log("  Their connections are hidden now — keeping what's mapped")
                elif url:
                    record_bridge_skip(url, name, "no visible connections")
                    log("  Connections are hidden — noted, and skipped from now on")
            elif status == "finished":
                healthy = True
                results.append({"name": name, "tier": tier, "found": 0, "status": "finished"})
                log(f"  Nothing past page {from_page - 1}: that was all of their list")
            elif status == "success" and from_page > 1:
                entry = load_bridge_progress().get(url) or {}
                if entry and not entry.get("more"):
                    healthy = True
                    results.append({"name": name, "tier": tier, "found": 0, "status": "finished"})
                    log(f"  Nothing past page {from_page - 1}: that was all of their list")
                else:
                    results.append({"name": name, "tier": tier, "found": 0, "status": "unclear"})
                    log("  Couldn't tell whether their list goes on; the next run checks again")
            else:
                # "unclear", or a search that opened but showed nobody: nothing
                # is recorded, and it counts towards the breaker.
                results.append({"name": name, "tier": tier, "found": 0, "status": "unclear"})
                log("  Nothing came back, and it wasn't clear why — not marked hidden; tried again next time")
        except KeyboardInterrupt:
            log("Stopped.")
            raise
        except NotSignedIn:
            results.append({"name": name, "tier": tier, "found": 0, "status": "error"})
            log("  LinkedIn isn't signed in, so nothing was read. Stopping the batch: sign in")
            log("  on the Scan page, then run it again.")
            stopped_early = "not signed in"
            break
        except LinkedInPushedBack as exc:
            results.append({"name": name, "tier": tier, "found": exc.found, "status": "done" if exc.found else "error"})
            log(f"  LinkedIn pushed back: {exc.reason}.")
            log("  Stopping the batch rather than carrying on into it. Everything read is saved, and")
            log("  the next run carries on from the same page.")
            log("  " + _pushback_advice(exc.reason))
            stopped_early = "LinkedIn pushed back"
            break
        except SearchLimitReached as exc:
            results.append({"name": name, "tier": tier, "found": exc.found, "status": "done" if exc.found else "error"})
            log("  LinkedIn says this account has reached its monthly search limit.")
            log("  Everything read so far is saved. Once the limit resets (the start of next month")
            log("  for a free account) the next run carries on from the same page.")
            stopped_early = "the monthly search limit"
            break
        except SaveFailed as exc:
            results.append({"name": name, "tier": tier, "found": 0, "status": "error"})
            log(f"  The app could not save these connections: {str(exc)[:120]}")
            log("  Stopping the batch: anyone after this would cost LinkedIn views and not be saved either.")
            stopped_early = "a failed save"
            break
        except BaseException as exc:
            # One bad profile must never end the run. BaseException rather than
            # Exception on purpose: a SystemExit raised deep in a helper would
            # otherwise take the whole loop down with it.
            results.append({"name": name, "tier": tier, "found": 0, "status": "error"})
            log(f"  Failed: {str(exc)[:80]}")

        if stop_requested():
            continue          # the loop's own check says "Stopped." and ends it
        if healthy:
            streak = 0
        else:
            streak += 1
            if streak >= BREAKER:
                log(f"  {streak} people in a row came back unclear, which is how LinkedIn limiting")
                log("  us looks. Stopping the batch; nobody was marked hidden for it, and they")
                log("  are tried again next time. Leave it a few hours first.")
                stopped_early = "unclear reads in a row"
                break

        # Cooldown between bridges (skip on the last one). The same full pause
        # after a person who came back with nothing: it used to be 15 s, which
        # made the loop go faster exactly when LinkedIn was pushing back.
        if i < len(unbridged) - 1:
            cooldown = BRIDGE_COOLDOWN
            log(f"  Waiting {cooldown}s before the next one...")
            if not interruptible_sleep(cooldown, on_tick=lambda left: log(f"    {left}s to go"), step=15):
                log("Stopped.")
                break

    # Summary
    success = sum(1 for r in results if r["status"] == "done")
    private = sum(1 for r in results if r["status"] == "private")
    errors = sum(1 for r in results if r["status"] in ("error", "unclear"))
    finished = sum(1 for r in results if r["status"] == "finished")
    head = ("Stopped" if stop_requested()
            else f"Stopped early ({stopped_early})" if stopped_early
            else "Complete")
    log(f"{head}: {success} bridged / {private} hidden / {errors} failed or unclear"
        + (f" / {finished} had nothing more" if finished else ""))
    if any(r["status"] == "private" for r in results):
        log("Hidden profiles are remembered and will be skipped next time.")

    return results


def rescrape_bridge(bridge_name, headless=False, max_pages=LINKEDIN_MAX_PAGES):
    """Delete all existing cluster data for a bridge and re-scrape from scratch."""
    print(f"\n=== Re-scraping {bridge_name} (delete + fresh scrape) ===\n")

    print(f"Deleting old cluster data...")
    bridge_id = delete_bridge_cluster(bridge_name)
    if bridge_id is None:
        return

    scrape_bridge(bridge_name, headless=headless, max_pages=max_pages, fresh=True)


def run_server(port=5555):
    """
    Run a local HTTP server that the website's Setup page can talk to.
    Start once: python3 scripts/scrape.py --server
    Then use the buttons on the Setup page — no more terminal commands.
    """
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import threading

    # Track current job
    state = {"running": False, "log": [], "result": None}

    # Only the app served from this machine may drive the scraper. This used to
    # answer Access-Control-Allow-Origin: * , which let any website the operator
    # happened to visit start a scrape of their LinkedIn account and read the
    # results back — including the batched auto-bridge run this file's own
    # docstring warns gets accounts flagged.
    ALLOWED_ORIGINS = {
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3210", "http://127.0.0.1:3210",
    }

    class ScrapeHandler(BaseHTTPRequestHandler):
        def _cors(self):
            origin = self.headers.get("Origin")
            if origin in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _reject_cross_site(self):
            """True (and already responded) if this request came from another site.

            A cross-origin POST with a simple content type reaches this server
            with no preflight, so refusing the response is not enough — the
            scrape would already have started.
            """
            origin = self.headers.get("Origin")
            if origin and origin not in ALLOWED_ORIGINS:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "cross-site request refused"}).encode())
                return True
            return False

        def do_OPTIONS(self):
            self.send_response(200)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self._reject_cross_site():
                return
            if self.path == "/status":
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "running": state["running"],
                    "log": state["log"][-20:],
                    "result": state["result"],
                }).encode())
                return

            if self.path == "/ping":
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                return

            self.send_response(404)
            self.end_headers()

        def do_POST(self):
            if self._reject_cross_site():
                return
            content_len = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_len)) if content_len else {}

            if self.path == "/scrape":
                if state["running"]:
                    self.send_response(409)
                    self._cors()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error":"Scrape already running"}')
                    return

                action = body.get("action", "connections")
                bridge_name = body.get("bridge", "")
                user_id = body.get("userId", "")

                # Set active user for this scrape session
                global _active_user_id
                _active_user_id = user_id or None

                state["running"] = True
                state["log"] = [f"Starting {action}" + (f": {bridge_name}" if bridge_name else "")]
                state["result"] = None

                def run_scrape():
                    try:
                        if action == "full-scrape":
                            state["log"].append("Full account setup — walking your whole connections list...")
                            result = scrape_connections(
                                full_walk=True,
                                log_fn=lambda msg: state["log"].append(msg))
                            count = len(result) if result else 0
                            state["result"] = {"status": "done", "action": "full-scrape", "found": count}
                            state["log"].append(f"Done! {count} connections with images captured")
                        elif action == "company":
                            company = body.get("company", "")
                            state["log"].append(f"Scanning company: {company}")
                            people = scrape_company(company, log_fn=lambda msg: state["log"].append(msg))
                            # Push scraped people to database so they persist
                            if people:
                                state["log"].append(f"Saving {len(people)} people to database...")
                                push_company(people, company)
                                state["log"].append(f"Saved to database ✓")
                            state["result"] = {"status": "done", "action": "company", "found": len(people), "people": people}
                            state["log"].append(f"Done! {len(people)} people found at {company}")
                        elif action == "auto-bridge":
                            state["log"].append("Auto-bridging all connections (S-tier first)...")
                            state["log"].append("2 min cooldown between each bridge")
                            results = auto_bridge_all(log_fn=lambda msg: state["log"].append(msg))
                            success = sum(1 for r in results if r.get("status") == "done")
                            state["result"] = {"status": "done", "action": "auto-bridge", "found": success, "total": len(results)}
                            state["log"].append(f"Done! {success}/{len(results)} bridges mapped")
                        elif action == "bridge" and bridge_name:
                            state["log"].append(f"Scraping bridge: {bridge_name}")
                            result = scrape_bridge(bridge_name)
                            count = len(result) if result else 0
                            state["result"] = {"status": "done", "action": "bridge", "bridge": bridge_name, "found": count}
                            state["log"].append(f"Done! {count} connections found")
                        elif action == "rescrape" and bridge_name:
                            state["log"].append(f"Re-scraping: {bridge_name}")
                            rescrape_bridge(bridge_name)
                            state["result"] = {"status": "done", "action": "rescrape", "bridge": bridge_name}
                            state["log"].append("Done! Re-scrape complete")
                        else:
                            # Refresh connections only — no auto-bridge
                            state["log"].append("Checking for new connections...")
                            result = scrape_connections(
                                log_fn=lambda msg: state["log"].append(msg))
                            new_count = len(result) if result else 0
                            state["log"].append(f"  {new_count} connections scanned")
                            state["result"] = {"status": "done", "action": "refresh", "found": new_count}
                            state["log"].append("Refresh complete!")
                    except Exception as e:
                        state["result"] = {"status": "error", "error": str(e)}
                        state["log"].append(f"Error: {str(e)[:100]}")
                    finally:
                        state["running"] = False

                threading.Thread(target=run_scrape, daemon=True).start()

                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"started":true}')
                return

            self.send_response(404)
            self.end_headers()

        def log_message(self, format, *args):
            pass  # Suppress default HTTP logs

    import socket
    # Kill any existing server on this port
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", port))
        s.close()
    except OSError:
        print(f"  Port {port} in use — killing old server...")
        import subprocess
        subprocess.run(f"lsof -ti:{port} | xargs kill -9", shell=True, capture_output=True)
        time.sleep(1)

    server = HTTPServer(("127.0.0.1", port), ScrapeHandler)
    print(f"\n{'='*50}")
    print(f"  6 Degrees Scraper Server")
    print(f"  Running on http://localhost:{port}")
    print(f"{'='*50}")
    print(f"\n  Open your visualization and use the Setup page buttons.")
    print(f"  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="6 Degrees LinkedIn Scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrape.py --server                 # Start local server (use Setup page buttons)
  python3 scripts/scrape.py                          # Scrape your degree-1 connections
  python3 scripts/scrape.py --login                  # Sign in once, then exit
  python3 scripts/scrape.py --full                   # Walk the whole connections list
  python3 scripts/scrape.py --refresh                # Only what is new since last run
  python3 scripts/scrape.py --bridge "Jane Doe"      # Scrape one bridge's connections
  python3 scripts/scrape.py --rescrape "Name"        # Delete + re-scrape a bridge
        """,
    )
    parser.add_argument("--full", action="store_true",
                        help="Walk your whole connections list top to bottom (first-time scrape)")
    parser.add_argument("--refresh", action="store_true",
                        help="Only look for connections added since the last run")
    parser.add_argument("--search", action="store_true",
                        help="Legacy: collect via the people-search pages instead of the connections page")
    parser.add_argument("--login", action="store_true",
                        help="Just sign into LinkedIn and save the session, then exit")
    parser.add_argument("--server", action="store_true", help="Start local scraper server (use website buttons)")
    parser.add_argument("--bridge", type=str, help="Name of one bridge person to scrape")
    parser.add_argument("--rescrape", type=str, help="Delete + re-scrape a bridge's cluster from scratch")
    parser.add_argument("--company", type=str, help="Scan everyone the app can see at one company")
    parser.add_argument("--auto-bridge", action="store_true",
                        help="Map every bridge in turn, highest tier first")
    parser.add_argument("--retry-private", action="store_true",
                        help="With --auto-bridge: try people previously found to be hidden")
    parser.add_argument("--clear-skips", action="store_true",
                        help="Forget every hidden-profile skip and start clean")
    parser.add_argument("--max-bridges", type=int, default=0,
                        help="With --auto-bridge: stop after this many people (0 = no limit)")
    parser.add_argument("--tiers", type=str, default="",
                        help="With --auto-bridge: only these tiers, e.g. --tiers=S,A")
    parser.add_argument("--order", choices=("newest", "score"), default="newest",
                        help="With --auto-bridge: newest connections first (default), or highest tier first")
    parser.add_argument("--max-pages", type=int, default=LINKEDIN_MAX_PAGES,
                        help="Result pages to read per person. By default every page, until their "
                             "list ends (LinkedIn shows 100 at most). Every page is a search on your account.")
    parser.add_argument("--deeper", action="store_true",
                        help="Carry on with people already mapped, from the page their last read "
                             "stopped at. With --auto-bridge: alongside new people. With --bridge: that person.")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    args = parser.parse_args()
    args.max_pages = max(1, min(LINKEDIN_MAX_PAGES, args.max_pages))

    # A failed save ends the run with its reason, not a traceback (TRAPS §32).
    def _say_why(exc_type, exc, tb):
        if issubclass(exc_type, SaveFailed):
            print(f"\n  The app could not save what was scraped: {exc}\n", file=sys.stderr)
        elif issubclass(exc_type, NotSignedIn):
            print("\n  LinkedIn isn't signed in, so nothing was read. Sign in with --login, then run it again.\n",
                  file=sys.stderr)
        elif issubclass(exc_type, LinkedInPushedBack):
            print(f"\n  LinkedIn pushed back: {getattr(exc, 'reason', exc)}. What was read is saved. "
                  f"{_pushback_advice(getattr(exc, 'reason', ''))}\n", file=sys.stderr)
        elif issubclass(exc_type, SearchLimitReached):
            print("\n  LinkedIn says this account has reached its monthly search limit. What was read "
                  "is saved; run again with --deeper once it resets.\n", file=sys.stderr)
        else:
            sys.__excepthook__(exc_type, exc, tb)
    sys.excepthook = _say_why

    install_stop_handler()
    _assert_local_target()

    if args.clear_skips:
        clear_bridge_skips()
        raise SystemExit(0)

    if args.login:
        raise SystemExit(0 if open_login_window() else 1)

    if not args.server:
        resolve_active_user()

    if args.company:
        # The server mode scraped and pushed as one step; the CLI has to do the
        # same or the scan appears to work and saves nothing.
        people = scrape_company(args.company, headless=args.headless)
        if people:
            print(f"\nSaving {len(people)} people from {args.company}...")
            push_company(people, args.company)
        print(f"Done. {len(people) if people else 0} found at {args.company}.")
    elif args.auto_bridge:
        results = auto_bridge_all(headless=args.headless, retry_private=args.retry_private,
                                  max_bridges=args.max_bridges,
                                  tiers=args.tiers.split(",") if args.tiers else None,
                                  order=args.order, max_pages=args.max_pages, deeper=args.deeper)
        done = sum(1 for r in results if r.get("status") == "done")
        print(f"\nDone. {done}/{len(results)} bridges mapped.")
    elif args.search:
        scrape_full(headless=args.headless)
    elif args.full:
        scrape_connections(headless=args.headless, full_walk=True)
    elif args.refresh:
        scrape_connections(headless=args.headless)
    elif args.server:
        run_server()
    elif args.rescrape:
        rescrape_bridge(args.rescrape, headless=args.headless, max_pages=args.max_pages)
    elif args.bridge:
        scrape_bridge(args.bridge, headless=args.headless, max_pages=args.max_pages, deeper=args.deeper)
    else:
        # Nothing collected yet means this is a first run, and the full scrape
        # is the one that walks every search page and captures photos. Running
        # the incremental refresh here is what made a fresh install look broken.
        existing = read_connections(params={"degree": "eq.1", "limit": "1"})
        if existing:
            print("\nExisting connections found — checking for new ones only.")
            print("Use --full to re-walk everything.\n")
            scrape_connections(headless=args.headless)
        else:
            print("\nNo connections yet — walking your whole connections list.")
            print("This takes a couple of minutes and captures photos.\n")
            scrape_connections(headless=args.headless, full_walk=True)
