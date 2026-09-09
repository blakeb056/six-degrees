// One way to run the scraper from the browser.
//
// Every view used to POST to a Python server on http://localhost:5555 that the
// user had to start by hand, and each one told them to "double-click Start
// Scraper on your Desktop" when it was not running. There were six copies of
// that logic and one of them is why a working scraper looked broken.
//
// Now they all call this, which talks to /api/scraper on the app itself.

export async function scraperStatus() {
  const r = await fetch('/api/scraper');
  if (!r.ok) throw new Error('Could not reach the app.');
  return r.json();
}

export async function startScrape(action, name, extra = {}) {
  const r = await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(name ? { name } : {}), ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not start the scraper.');
  return d;
}

/**
 * Run one scrape and report progress until it ends.
 * onLog receives the whole log each tick; returns the final status.
 */
export function runScrape(action, { name, onLog, ...extra } = {}) {
  return new Promise((resolve, reject) => {
    startScrape(action, name, extra).then(() => {
      const poll = setInterval(async () => {
        try {
          const s = await scraperStatus();
          onLog?.(s.log || []);
          if (!s.running) {
            clearInterval(poll);
            resolve(s);
          }
        } catch { /* transient; keep polling */ }
      }, 1500);
    }).catch(reject);
  });
}

/** What to tell someone when the scraper is not usable yet. */
export function notReadyMessage(status) {
  if (!status) return 'Could not reach the app.';
  if (!status.checks?.scriptsFound) return 'The scraper files are missing from this install.';
  if (!status.checks?.python) return 'Python 3 is not installed on this machine.';
  if (!status.checks?.dependencies) return 'The scraper is not installed yet — open Scan to set it up.';
  if (!status.checks?.chrome) return 'Google Chrome is not installed.';
  return null;
}

/** Stop whatever is running. The scraper closes its browser on the way out. */
export async function stopScrape() {
  await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  });
}
