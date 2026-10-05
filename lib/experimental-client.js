// The experimental all-day Auto-Bridge (Auto scan), as the header button and
// the status bar see it. The switch is the Scan page's checkbox, kept in this
// browser (its useRemembered: JSON under six-degrees-experimental-auto); the page
// announces a change with the 'six-degrees:experimental' event.

import { beginScrape } from './scraper-client';

const KEY = 'six-degrees-experimental-auto';

export function watchAllDay(change) {
  window.addEventListener('storage', change);
  window.addEventListener('six-degrees:experimental', change);
  return () => {
    window.removeEventListener('storage', change);
    window.removeEventListener('six-degrees:experimental', change);
  };
}

export function allDayNow() {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

const remembered = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};

/** Start Auto scan with the Scan page's remembered choices (order, pages, finish), 10 people, S and A first. */
export function startAutoScan() {
  const order = remembered('six-degrees-bridge-order', 'newest');
  return beginScrape('auto-bridge', {
    experimental: true,
    maxBridges: 10,
    order,
    tiers: order === 'score' ? ['S', 'A'] : [],
    maxPages: remembered('six-degrees-bridge-pages-v2', 100),
    deeper: remembered('six-degrees-bridge-finish', true),
  });
}

/**
 * Turn the switch on or off, as the Scan page's checkbox does, and tell every
 * page (the header's Auto scan button appears). The guided setup's pace step
 * has it too (app/components/onboarding).
 */
export function setAllDay(on) {
  try { localStorage.setItem(KEY, JSON.stringify(Boolean(on))); } catch { /* not remembered */ }
  window.dispatchEvent(new Event('six-degrees:experimental'));
}
