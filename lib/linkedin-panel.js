// Sixgree's own browser: LinkedIn in a panel inside the desktop app's window
// (desktop/main.mjs), driven by the scanner instead of a Chrome of its own
// (scripts/scrape.py attach_panel). Blake, 2026-10-15: "I want it embedded in
// the sixgree screen with maybe the top ui tab visible with the notch".
//
// The pieces the server and the page share, with no Node imports: what the
// scanner is told about the panel, what the scanner says back, and when the
// page brings the panel forward.

import { touchesLinkedIn } from './scan-risk.js';

/**
 * What the desktop app names, and the server hands on to every scanner it
 * starts (desktop/lib.mjs panelEnv): Chromium's debugging port on this
 * computer, and the panel page's DevTools target id.
 */
export const PANEL_ENV_KEYS = Object.freeze(['SIX_DEGREES_PANEL_CDP', 'SIX_DEGREES_PANEL_TARGET']);

/**
 * The two from `env`, checked: { SIX_DEGREES_PANEL_CDP, SIX_DEGREES_PANEL_TARGET },
 * or {} when either is missing or isn't what the desktop app writes. Only a
 * port on 127.0.0.1 is ever passed on: a scanner told another address would
 * hand a LinkedIn session to whatever answered there.
 */
export function panelEnvOf(env = {}) {
  const cdp = String(env.SIX_DEGREES_PANEL_CDP ?? '').trim();
  const target = String(env.SIX_DEGREES_PANEL_TARGET ?? '').trim();
  const port = Number(cdp.match(/^http:\/\/127\.0\.0\.1:(\d{1,5})$/)?.[1]);
  if (!(port > 0 && port < 65536) || !/^[0-9A-Fa-f]{16,64}$/.test(target)) return {};
  return { SIX_DEGREES_PANEL_CDP: cdp, SIX_DEGREES_PANEL_TARGET: target };
}

/**
 * The environment a scanner is started with: `env` without either panel
 * variable, then both back only when they are sound (panelEnvOf). Outside the
 * desktop app there are none, and the scanner starts its own Chrome as always.
 */
export function scannerEnvWithPanel(env = {}) {
  const out = { ...env };
  for (const key of PANEL_ENV_KEYS) delete out[key];
  return { ...out, ...panelEnvOf(env) };
}

/** Is the panel there for scanners to use (both variables sound)? */
export const hasPanel = (env = {}) => Object.keys(panelEnvOf(env)).length > 0;

// What the scanner prints when its window would come forward or go back (its
// bring_forward and back_out_of_the_way, and a launch in front: signing in,
// a manual read, "Show the scanner's Chrome window"). In the panel there is no
// window to move, so it says so instead, and the page moves the panel. Keep in
// step with scripts/scrape.py PANEL_FRONT and PANEL_AWAY.
export const PANEL_FRONT = "Sixgree's browser: in front";
export const PANEL_AWAY = "Sixgree's browser: out of sight";

/** The scanner's last word on the panel in `log` (oldest first): 'front', 'away', or null. */
export function panelAsked(log) {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const line = String(log[i] ?? '').trim();
    if (line === PANEL_FRONT) return 'front';
    if (line === PANEL_AWAY) return 'away';
  }
  return null;
}

/**
 * Should the panel be in front for this job (lib/scraper-client.js's)? While
 * it runs: LinkedIn needs you (signing in, a security check, a manual read),
 * or the scanner put it in front.
 */
export function panelWanted(job) {
  if (!job?.running) return false;
  if (job.needsYou || job.action === 'login') return true;
  return panelAsked(job.log) === 'front';
}

/**
 * Is a scan driving the panel now? With a scanner that can (`panel.scanner`,
 * desktop/main.mjs panelState), any job that opens LinkedIn runs in the panel,
 * so a profile link must not take its page away: it opens in your own browser
 * meanwhile (app/components/OpenProfile.js), and Back and Forward wait.
 */
export function scanHoldsPanel(job, panel) {
  return Boolean(panel?.scanner && job?.running && touchesLinkedIn(job.action));
}

/**
 * Outlink's one line saying how it went (scrape.py main, --outlink):
 * "Outlink result: opened". The app no longer starts --outlink (every profile
 * link opens the panel itself, desktop/main.mjs showProfile); this reads the
 * scanner's line for its own tests.
 */
const OUTLINK_RESULT = /^Outlink result: ([a-z-]+)$/;

export function outlinkResultIn(line) {
  return String(line ?? '').trim().match(OUTLINK_RESULT)?.[1] ?? null;
}

// ── Where the bar and the panel go, under everything the header shows ────────
// (Blake, 2026-10-15: "I want the top tabs and the UI to not be cut off".)

/** The thin LinkedIn bar's height, in CSS pixels. */
export const PANEL_BAR = 40;

const bottomOf = (r) => (r && Number.isFinite(r.bottom) ? r.bottom : 0);

/**
 * Where the bar sits and where the panel starts, from what the page measured
 * (each a bounding rect in CSS pixels, or null when it isn't there):
 *   header   the <header> itself
 *   tabs     the header's tab buttons (#main-tabs), which are moved down onto
 *            its bottom line, and on a narrow window wrap to a second row
 *   notch    the notch hanging under the tabs, at rest (opened, it is over
 *            the panel's still picture instead), or its tucked pill
 * The bar goes just under the header. The notch hangs into the bar's row, so
 * the bar's words keep to its left (Back to Sixgree is at the right end,
 * past it); when either side hasn't room (a narrow window, a wide notch), the
 * bar goes under the notch instead, whole. Either way the bar never covers a
 * tab, and the panel starts under the bar and under the notch.
 * → { barTop, top, words }: `words` is the widest the bar's words may run.
 */
export function panelLayout({ width, header = null, tabs = null, notch = null, bar = PANEL_BAR, gap = 4, margin = 12, pad = 16, wordsMin = 150, buttonMin = 160 } = {}) {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const headerBottom = Math.max(0, bottomOf(header), bottomOf(tabs));
  let barTop = headerBottom;
  let words = w - 2 * pad;
  const hangs = Boolean(notch) && Number.isFinite(notch.left) && Number.isFinite(notch.right) && bottomOf(notch) > headerBottom;
  if (hangs) {
    const leftRoom = notch.left - margin - pad;
    const rightRoom = w - notch.right - margin - pad;
    if (leftRoom >= wordsMin && rightRoom >= buttonMin) words = leftRoom;
    else barTop = bottomOf(notch) + gap;
  }
  const top = Math.max(barTop + bar, hangs ? bottomOf(notch) + gap : 0);
  return { barTop: Math.round(barTop), top: Math.ceil(top), words: Math.max(0, Math.floor(words)) };
}
