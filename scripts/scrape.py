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
  python3 scripts/scrape.py --rescrape "Name"        # Delete + re-scrape a bridge

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


def ensure_logged_in(page, timeout_s=LOGIN_WAIT_SECONDS, log_fn=None):
    """Wait for a human to finish logging in, rather than scraping an empty page.

    The browser uses a persistent profile, so this is a once-per-machine step —
    every later run finds the session already there and returns immediately.
    """
    context = page.context

    try:
        page.goto(FEED_URL, wait_until="domcontentloaded")
    except Exception:
        pass
    time.sleep(2)

    if _has_session_cookie(context) and not _looks_logged_out(page):
        return True

    say = log_fn or (lambda m: None)
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

        # The cookie is the authority and it belongs to the whole browser, so it
        # is found no matter which tab or window the sign-in finished in.
        if _has_session_cookie(context):
            print()
            print("  ==================================================================")
            print("  Signed in. Starting the scrape now.")
            print("  ==================================================================")
            print()
            say("Signed in. Starting the scrape.")
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

        if _has_session_cookie(browser):
            print("\n  Already signed in — nothing to do.")
            print("  Run: python3 scripts/scrape.py --full\n")
            browser.close()
            return True

        ok = ensure_logged_in(page)
        if ok:
            print("  Sign-in saved to this machine. You will not be asked again.")
            print("  Now run: python3 scripts/scrape.py --full\n")
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
    silently did nothing. Ask the app who it has and adopt that profile.
    """
    global _active_user_id
    if _active_user_id:
        return _active_user_id

    try:
        resp = requests.get(f"{APP_URL}/api/users", headers=app_headers(json_body=False), timeout=15)
        users = resp.json().get("users", []) if resp.status_code == 200 else []
    except Exception:
        print(f"\n  Could not reach the app at {APP_URL}.")
        print("  Start it with `npm run dev` in another terminal, then run this again.\n")
        raise SystemExit(1)

    wanted = os.getenv("SIX_DEGREES_USER", "").strip().lower()
    if wanted:
        for u in users:
            if (u.get("name") or "").strip().lower() == wanted:
                _active_user_id = u["id"]
                print(f"  Scraping into profile: {u['name']}")
                return _active_user_id
        raise SystemExit(f"No profile named '{os.getenv('SIX_DEGREES_USER')}' in the app.")

    if not users:
        print(f"\n  No profile yet. Open {APP_URL}, enter your name, then run this again.\n")
        raise SystemExit(1)

    if len(users) > 1:
        names = ", ".join(f"'{u.get('name')}'" for u in users)
        raise SystemExit(
            f"The app has more than one profile ({names}).\n"
            "Pick one with: SIX_DEGREES_USER='Your Name' python3 scripts/scrape.py --full")

    _active_user_id = users[0]["id"]
    print(f"  Scraping into profile: {users[0].get('name')}")
    return _active_user_id


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


def push_connections(connections, degree=1, bridge_id=None, user_id=None):
    """Push connections via Vercel API route (which has write access).
    No local keys needed — the server handles auth."""

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
        inserted = result.get("processed", 0)
        promoted = result.get("promoted", 0)
        print(f"  Pushed {len(connections)} → {inserted} processed")
        if promoted:
            # Someone you were introduced to has accepted. The bridge that
            # produced them is kept on their row, so the path stays visible.
            print(f"  {promoted} of them were 2nd-degree contacts you have now connected with")
    else:
        print(f"  Push error: {resp.status_code} {resp.text[:200]}")
        inserted = 0

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
        inserted = 0

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
    print(f"Done! {inserted} processed.")

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
    print(f"\nCollected {len(found)} connections ({with_photos} with photos); {len(new_rows)} new.")
    say(f"Collected {len(found)} connections, {len(new_rows)} new")

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


BRIDGE_COOLDOWN = 120             # after a real scrape: many page views, be polite
BRIDGE_SKIP_COOLDOWN = 15         # after a hidden profile: one page view, no need
BRIDGE_LOAD_ATTEMPTS = 6          # how many times to look for the connections URN
BRIDGE_LOAD_STEP = 5              # seconds between looks


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


def _scrape_one_bridge(page, bridge_name, bridge_id, profile_url):
    """
    Core bridge scraping logic. Takes an already-open Playwright page.
    Returns (connections_list, status_string).

    Timing is calibrated from successful runs:
    - 30s profile render wait (LinkedIn is slow)
    - 10s after search URL navigation
    - 3s between pagination clicks
    - Playwright locator click for Next (not JS — more reliable)
    """
    slug = profile_url.split("/in/")[1].rstrip("/")

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
    urn = None
    for attempt in range(BRIDGE_LOAD_ATTEMPTS):
        time.sleep(BRIDGE_LOAD_STEP)

        if _profile_unavailable(page):
            print("  Profile is not viewable — skipping.")
            return [], "private"

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
        print(f"  Could not find URN — connections are private.")
        return [], "private"

    print(f"  Found URN: {urn[:30]}...")

    # Step 4: Navigate directly to search URL with 3rd+ degree filter baked in
    # This is the URL format that works: network=["F","S","O"] + connectionOf=["URN"]
    search_url = f"https://www.linkedin.com/search/results/people/?network=%5B%22F%22%2C%22S%22%2C%22O%22%5D&connectionOf=%5B%22{urn}%22%5D"
    print("  Opening connections search with 3rd+ filter...")
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

    if not results_loaded:
        print(f"  No search results found — may be private or empty.")
        return [], "empty"

    # Step 6: Paginate and extract — 3s between pages, up to 10 pages
    # Successful runs: 8-10 results per page, ~90 total across 10 pages
    connections = []
    for pg in range(1, 11):
        print(f"  Page {pg}... ", end="", flush=True)
        time.sleep(3)

        # Extract from current page
        page_results = page.evaluate("""
        () => {
          // Build URL map from profile links
          const urlMap = {};
          document.querySelectorAll('a').forEach(a => {
            const h = a.getAttribute('href') || '';
            if (!h.includes('/in/')) return;
            const url = h.startsWith('http') ? h.split('?')[0] : 'https://www.linkedin.com' + h.split('?')[0];
            const text = a.textContent.trim();
            if (!text || text.length > 60 || text.includes('mutual') || text.includes('Connect') || text.includes('Invite')) return;
            if (!urlMap[text]) urlMap[text] = url;
          });
          // Build image map from profile photos in search results
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
                if (l === 'Connect' || l === 'Follow' || l === 'Message' || l.includes('mutual connection') || l.match(/followers$/)) break;
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
        connections.extend(page_results)
        print(f"{len(page_results)} found (total: {len(connections)})")

        if pg < 10:
            # Playwright locator click — more reliable than JS click
            try:
                next_btn = page.locator('button:has-text("Next")').first
                if next_btn.is_visible(timeout=3000):
                    next_btn.click()
                    time.sleep(3)
                else:
                    print("  No more pages.")
                    break
            except:
                print("  No more pages.")
                break

    # Filter out the bridge themselves
    connections = [c for c in connections if slug not in c.get("profileUrl", "")]
    print(f"  Total: {len(connections)} connections")

    return connections, "success"


def scrape_bridge(bridge_name, headless=False):
    """Scrape degree-2 connections for a single bridge (opens its own browser)."""
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

    print(f"\n=== Scraping connections of {bridge_name} ===\n")

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
        except Exception:
            pass
        if not ensure_logged_in(page):
            browser.close()
            return

        connections, status = _scrape_one_bridge(page, bridge_name, bridge_id, profile_url)
        browser.close()

    if not connections:
        print(f"\nDone! No connections found ({status}).")
        return []

    print(f"\nPushing {len(connections)} connections to the app...")
    inserted = push_connections(connections, degree=2, bridge_id=bridge_id)
    print(f"\nDone! {inserted} new degree-2 connections added via {bridge_name}.")
    return connections


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


def auto_bridge_all(headless=False, log_fn=None, retry_private=False, max_bridges=0):
    """Auto-bridge all unbridged connections, S-tier first then down.
    Picks up from where we left off — skips already-bridged people."""

    def log(msg):
        print(msg)
        if log_fn:
            log_fn(msg)

    # Get all degree-1 connections (filtered by active user)
    d1_params = {"degree": "eq.1", "select": "id,name,tier,power_score,profile_url", "order": "power_score.desc", "limit": "2000"}
    if _active_user_id:
        d1_params["user_id"] = f"eq.{_active_user_id}"
    all_d1 = read_connections(params=d1_params)

    # Get existing bridge IDs (already have clusters, for this user)
    d2_params = {"degree": "eq.2", "select": "source_connection_id", "limit": "2000"}
    if _active_user_id:
        d2_params["user_id"] = f"eq.{_active_user_id}"
    all_d2 = read_connections(params=d2_params)
    bridged_ids = set(d["source_connection_id"] for d in all_d2 if d.get("source_connection_id"))

    # Filter unbridged, sort by tier priority (S first, then by score)
    tier_order = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}
    unbridged = [c for c in all_d1 if c["id"] not in bridged_ids]

    # People already found to be private are not tried again. Without this they
    # reappear every run, in the same place, and the run never gets past them.
    skips = {} if retry_private else load_bridge_skips()
    skipped_now = [c for c in unbridged if c.get("profile_url") in skips]
    unbridged = [c for c in unbridged if c.get("profile_url") not in skips]

    unbridged.sort(key=lambda c: (tier_order.get(c.get("tier", "D"), 4), -(float(c.get("power_score", 0)))))

    log(f"Found {len(unbridged)} unbridged connections")
    log(f"Already bridged: {len(bridged_ids)}")
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

    results = []
    for i, person in enumerate(unbridged):
        if stop_requested():
            log("Stopped.")
            break

        name = person["name"]
        tier = person.get("tier", "?")
        score = person.get("power_score", "?")
        url = person.get("profile_url", "")

        log(f"[{i+1}/{len(unbridged)}] {name} ({tier}-tier, score {score})")

        scraped = False
        try:
            result = scrape_bridge(name, headless=headless)
            count = len(result) if result else 0
            if count > 0:
                scraped = True
                results.append({"name": name, "tier": tier, "found": count, "status": "done"})
                log(f"  {count} connections found")
            else:
                results.append({"name": name, "tier": tier, "found": 0, "status": "private"})
                if url:
                    record_bridge_skip(url, name, "no visible connections")
                log("  Connections are hidden — noted, and skipped from now on")
        except KeyboardInterrupt:
            log("Stopped.")
            raise
        except BaseException as exc:
            # One bad profile must never end the run. BaseException rather than
            # Exception on purpose: a SystemExit raised deep in a helper would
            # otherwise take the whole loop down with it.
            results.append({"name": name, "tier": tier, "found": 0, "status": "error"})
            log(f"  Failed: {str(exc)[:80]}")

        # Cooldown between bridges (skip on the last one). A real scrape walks
        # many search pages and earns the full pause; a hidden profile was one
        # page view, so charging two minutes for it is what made a run of them
        # look like a hang.
        if i < len(unbridged) - 1:
            cooldown = BRIDGE_COOLDOWN if scraped else BRIDGE_SKIP_COOLDOWN
            log(f"  Waiting {cooldown}s before the next one...")
            if not interruptible_sleep(cooldown, on_tick=lambda left: log(f"    {left}s to go"), step=15):
                log("Stopped.")
                break

    # Summary
    success = sum(1 for r in results if r["status"] == "done")
    private = sum(1 for r in results if r["status"] == "private")
    errors = sum(1 for r in results if r["status"] == "error")
    log(f"{'Stopped' if stop_requested() else 'Complete'}: "
        f"{success} bridged / {private} hidden / {errors} failed")
    if private:
        log("Hidden profiles are remembered and will be skipped next time.")

    return results


def rescrape_bridge(bridge_name, headless=False):
    """Delete all existing cluster data for a bridge and re-scrape from scratch."""
    print(f"\n=== Re-scraping {bridge_name} (delete + fresh scrape) ===\n")

    print(f"Deleting old cluster data...")
    bridge_id = delete_bridge_cluster(bridge_name)
    if bridge_id is None:
        return

    scrape_bridge(bridge_name, headless=headless)


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
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    args = parser.parse_args()

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
                                  max_bridges=args.max_bridges)
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
        rescrape_bridge(args.rescrape, headless=args.headless)
    elif args.bridge:
        scrape_bridge(args.bridge, headless=args.headless)
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
