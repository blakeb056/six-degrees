// The experimental Auto scan, as the header button, its panel and the status
// bar see it. The switch is the Scan page's checkbox, kept in this browser (its
// useRemembered: JSON under six-degrees-experimental-auto); the page announces
// a change with the 'six-degrees:experimental' event. The pace and tiers picked
// in the panel are kept beside it (six-degrees-auto-scan), since Auto scan
// keeps no settings on the server: the server holds them only while it runs
// (app/api/scraper/route.js, lib/auto-scan.js).

import { scanRequest } from './scraper-client';
import { AUTO_DEFAULTS, cleanPace, cleanTiers } from './auto-scan';

const KEY = 'six-degrees-experimental-auto';
export const AUTO_SETTINGS_KEY = 'six-degrees-auto-scan';

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

/** The pace and tiers last picked in this browser: { pace, tiers }, Medium and S + A to start with. */
export function autoSettingsNow(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const raw = JSON.parse(storage?.getItem(AUTO_SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const tiers = cleanTiers(raw.tiers);
      return { pace: cleanPace(raw.pace), tiers: tiers.length ? tiers : [...AUTO_DEFAULTS.tiers] };
    }
  } catch { /* not remembered */ }
  return { pace: AUTO_DEFAULTS.pace, tiers: [...AUTO_DEFAULTS.tiers] };
}

/** Remember them. An empty tier list is kept as it is, so the panel can say to pick one. */
export function rememberAutoSettings({ pace, tiers }, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(AUTO_SETTINGS_KEY, JSON.stringify({ pace: cleanPace(pace), tiers: cleanTiers(tiers) })); } catch { /* not remembered */ }
}

async function post(body) {
  const r = await fetch('/api/scraper', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.error || 'Auto scan could not start.');
    err.details = d;
    throw err;
  }
  return d;
}

/**
 * Start Auto scan with this pace and these tiers: { auto } (the server's view),
 * or throws with why it can't (the scan's "I understand", Chrome, the scanner
 * not set up). Outside its hours it starts and waits for 9:00.
 */
export const startAutoScan = ({ pace, tiers }) => post(scanRequest('auto-start', { pace, tiers }));
/** Stop it, and its sitting if one is running. */
export const stopAutoScan = () => post({ action: 'auto-stop' });
/** A new pace or tiers while it's on: from the next sitting. */
export const updateAutoScan = ({ pace, tiers }) => post({ action: 'auto-settings', pace, tiers });

/**
 * Turn the switch on or off, as the Scan page's checkbox does, and tell every
 * page (the header's Auto scan button appears). The guided setup's pace step
 * has it too (app/components/onboarding).
 */
export function setAllDay(on) {
  try { localStorage.setItem(KEY, JSON.stringify(Boolean(on))); } catch { /* not remembered */ }
  window.dispatchEvent(new Event('six-degrees:experimental'));
}
