// Sixgree's own browser: LinkedIn in a panel inside the desktop app's window
// (desktop/main.mjs), driven by the scanner instead of a Chrome of its own
// (scripts/scrape.py attach_panel). Blake, 2026-10-15: "I want it embedded in
// the sixgree screen with maybe the top ui tab visible with the notch".
//
// The pieces the server and the page share, with no Node imports: what the
// scanner is told about the panel, what the scanner says back, and when the
// page brings the panel forward.

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

/**
 * The scanner plugin version that first knows the panel and Outlink's
 * --outlink. An older plugin ignores the panel (and starts Chrome, as it
 * always did) but would fail on --outlink, so Outlink opens the profile in
 * the user's own browser with it, as before.
 */
export const PANEL_SCANNER_VERSION = '1.0.5';

function newerOrSame(have, need) {
  const parts = (v) => String(v ?? '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const a = parts(have);
  const b = parts(need);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * Can this scanner (lib/scanner-files.js findScanner's answer) open a profile
 * for Outlink in the panel? The built-in copy always can; a plugin from
 * PANEL_SCANNER_VERSION on.
 */
export function outlinkSupported(scanner) {
  if (!scanner?.found) return false;
  if (scanner.from === 'built-in') return true;
  return scanner.from === 'plugin' && newerOrSame(scanner.plugin?.version, PANEL_SCANNER_VERSION);
}

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
 * it's Outlink opening a profile, or the scanner put it in front.
 */
export function panelWanted(job) {
  if (!job?.running) return false;
  if (job.needsYou || job.action === 'outlink' || job.action === 'login') return true;
  return panelAsked(job.log) === 'front';
}

/** Outlink's one line saying how it went (scrape.py main, --outlink): "Outlink result: opened". */
const OUTLINK_RESULT = /^Outlink result: ([a-z-]+)$/;

export function outlinkResultIn(line) {
  return String(line ?? '').trim().match(OUTLINK_RESULT)?.[1] ?? null;
}
