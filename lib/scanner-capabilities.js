// What the installed scanner unlocks in the app (Blake, 2026-10-13: "as little
// changing the app as possible, basically just the plugin scanner solution").
//
// The scanner is two plugins on the same scanner code (docs/PLUGINS.md):
//   - auto-scan  (unlocks "auto"): circle scans that turn the pages by
//     themselves, Auto scan's sittings, Auto connect, company scans, Check for
//     new (the walk of your own connections) and Dev mode;
//   - manual-scan (unlocks "manual"): manual mode, where you scroll and click
//     Next, and its chimes (Settings → Sound).
// The built-in scanner, while the app still has one, unlocks both, which is
// exactly how the app worked before plugins.
//
// The server works out which (lib/scanner-files.js scannerCapabilities) and
// sends it with the job answer every page already asks for
// (app/api/scraper/route.js job, `capabilities`). This file is the rules on top
// of that, in one place: what the pages show, which actions the server
// refuses, and which scanner settings the plugins decide. Kept to one
// condition at each place that already decides whether to offer a scan.
//
// No Node imports: the pages, the route and the tests all read it.

import { compareVersions } from './release.js';

/** No scanner at all: no plugin in use, and no built-in copy. */
export const SCANNER_NONE = Object.freeze({ auto: false, manual: false, from: 'none' });
/** The built-in scanner: everything, as before plugins. */
export const SCANNER_BUILT_IN = Object.freeze({ auto: true, manual: true, from: 'built-in' });

const FROM = ['built-in', 'plugin', 'none'];
// One frozen object per answer, so a page that keeps it compares it by itself
// and only redraws when it really changes.
const KEPT = new Map([[key(SCANNER_NONE), SCANNER_NONE], [key(SCANNER_BUILT_IN), SCANNER_BUILT_IN]]);
function key(c) {
  return `${c.from}:${c.auto ? 1 : 0}${c.manual ? 1 : 0}`;
}

/**
 * { auto, manual, from }, always the same object for the same answer. Nothing
 * unlocked is 'none', whatever `from` said.
 */
export function capabilities({ auto = false, manual = false, from = 'none' } = {}) {
  const c = { auto: auto === true, manual: manual === true, from: FROM.includes(from) ? from : 'none' };
  if (!c.auto && !c.manual) c.from = 'none';
  const k = key(c);
  if (!KEPT.has(k)) KEPT.set(k, Object.freeze(c));
  return KEPT.get(k);
}

/**
 * The server's answer, kept to its shape: { auto, manual, from }, or null when
 * it didn't say (not asked yet, or a server from before plugins). null reads
 * as the built-in scanner everywhere below: as the app always was, and the
 * server still refuses whatever isn't there.
 */
export function cleanCapabilities(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.auto !== 'boolean' || typeof raw.manual !== 'boolean') return null;
  return capabilities(raw);
}

/** The scanner's actions only the auto plugin unlocks. `auto-start` is Auto scan's Start, and every sitting. */
export const AUTO_ACTIONS = Object.freeze([
  'full', 'refresh',            // your own connections: Scan my network, Check for new
  'company',                    // a company scan (Paths)
  'connect',                    // Auto connect
  'read-profiles',              // Read profiles: profile after profile, by itself
  'auto-start',                 // Auto scan
]);

// Plain words for each refusal. Settings → Plugins is where either plugin is added.
export const AUTO_NEEDED = 'This needs the Auto scan plugin, which isn’t installed. You can add it in Settings → Plugins.';
export const DEV_NEEDS_AUTO = 'Dev mode comes with the Auto scan plugin, which isn’t installed. You can add it in Settings → Plugins.';
export const MANUAL_NEEDED = 'Manual mode comes with the Manual scan plugin, which isn’t installed. You can add it in Settings → Plugins.';
export const MANUAL_ALWAYS = 'Always on: the Auto scan plugin isn’t installed, so circle scans are manual.';

/**
 * Why `action` can't run with what's installed, or null. Circle scans (one
 * person, a round, Resume) run with either plugin: with only the manual one,
 * in manual mode (lockedModes). Signing in, setting the scanner up and saving
 * photos need only a scanner. With none at all, the route says the scanner
 * isn't installed before it asks this.
 */
export function capabilityRefusal(caps, action) {
  const c = caps || SCANNER_BUILT_IN;
  if (AUTO_ACTIONS.includes(action) && !c.auto) return AUTO_NEEDED;
  return null;
}

/**
 * The scanner settings (scan-limits.json) the installed plugins decide,
 * whatever is saved: { manual?, dev? }. Only the manual plugin: circle scans
 * are manual, and there is no Dev mode. Without the manual plugin: never
 * manual. Both, or the built-in scanner: nothing, they're yours to change. No
 * scanner: nothing, since nothing runs.
 */
export function lockedModes(caps) {
  const c = caps || SCANNER_BUILT_IN;
  if (!c.auto && !c.manual) return {};
  return {
    ...(c.manual ? (c.auto ? {} : { manual: true }) : { manual: false }),
    ...(c.auto ? {} : { dev: false }),
  };
}

/**
 * Why a change of the scanner's settings (`set-limits`) can't be made, or
 * null: turning on what isn't installed, or manual mode off with only the
 * manual plugin. Asked once scan-limits.json already says what lockedModes
 * decides, so a save that sends every setting back as it is (the Scan page's
 * speed) goes through.
 */
export function settingRefusal(caps, { manual, dev } = {}) {
  const c = caps || SCANNER_BUILT_IN;
  if (dev === true && !c.auto) return DEV_NEEDS_AUTO;
  if (manual === true && !c.manual) return MANUAL_NEEDED;
  if (manual === false && c.manual && !c.auto) return MANUAL_ALWAYS;
  return null;
}

/**
 * What the pages show:
 *   scan          any scanner: the Scan tab and page, every scan-a-circle
 *                 button and card, the notch's budget
 *   auto          the auto plugin: Auto scan, Auto connect, Check for new and
 *                 the first scan of your connections, company scans, Dev mode
 *   manual        the manual-mode switch (the manual plugin, or built in)
 *   manualLocked  ...on and locked (only the manual plugin; with both, it's yours)
 *   chimes        Settings → Sound (the manual plugin, or built in)
 * null (not known yet, or a server from before plugins) shows everything, as before.
 */
export function scanShows(caps) {
  const c = caps || SCANNER_BUILT_IN;
  const k = key(c);
  if (!SHOWS.has(k)) {
    SHOWS.set(k, Object.freeze({
      scan: c.auto || c.manual,
      auto: c.auto,
      manual: c.manual,
      manualLocked: c.manual && !c.auto,
      chimes: c.manual,
    }));
  }
  return SHOWS.get(k);
}
const SHOWS = new Map();

// ── How circle scans run: one choice ─────────────────────────────────────────
// Blake, 2026-10-14: "make sure that the user cant auto scan and do manual
// mode and making that option more apparent". The Scan page asks it as one
// choice of two, Automatic or By hand, never both: By hand is manual mode
// (scan-limits.json `manual`), and with it Auto scan can't start (the route
// refuses it, app/api/scraper/route.js autoRefusal) and isn't offered.

/**
 * 'auto' (the scanner turns the pages) or 'manual' (you do), from what's
 * installed and the saved manual-mode setting: with one scanner plugin, its
 * own, whatever is saved; with both, or the built-in scanner, the saved
 * choice; with none, null. Never both.
 */
export function circleMode(caps, savedManual = false) {
  const c = caps || SCANNER_BUILT_IN;
  if (!c.auto && !c.manual) return null;
  if (!c.auto) return 'manual';
  if (!c.manual) return 'auto';
  return savedManual === true ? 'manual' : 'auto';
}

/** Said where a choice's plugin isn't installed, with the way to Settings → Plugins. */
export const INSTALL_AUTO = 'Install the Auto scan plugin';
export const INSTALL_MANUAL = 'Install the Manual scan plugin';
/** Said in place of Auto scan's controls while By hand is chosen. */
export const AUTO_NEEDS_AUTOMATIC = 'Auto scan needs Automatic.';

/**
 * The two choices as the Scan page draws them: { mode, auto, manual, autoScan }.
 * Each of `auto` and `manual` is { available, selected, locked, needs }:
 * available with its plugin; exactly one selected while a scanner is
 * installed (circleMode); locked when it's the only one there is; `needs` the
 * line that says which plugin to install when it isn't. `autoScan` is whether
 * Auto scan may be offered at all: only with Automatic.
 */
export function modeChoices(caps, savedManual = false) {
  const c = caps || SCANNER_BUILT_IN;
  const mode = circleMode(c, savedManual);
  return {
    mode,
    auto: { available: c.auto, selected: mode === 'auto', locked: c.auto && !c.manual, needs: c.auto ? null : INSTALL_AUTO },
    manual: { available: c.manual, selected: mode === 'manual', locked: c.manual && !c.auto, needs: c.manual ? null : INSTALL_MANUAL },
    autoScan: mode === 'auto',
  };
}

/** What choosing a mode saves (POST /api/scraper set-limits): manual mode on for By hand, off for Automatic. */
export function modeSetting(mode) {
  return { manual: mode === 'manual' };
}

// ── Actions newer than a scanner plugin ──────────────────────────────────────
// A plugin carries its own copy of the scanner, so one installed before an
// action was added doesn't know its flag and would stop with a usage error.
// Each such action, and the plugin version that first has it.
export const PLUGIN_SINCE = Object.freeze({
  'your-connections': '1.0.4',   // your connections through LinkedIn's search (scrape.py scan_your_connections)
  breach: '1.0.9',               // Breach: a company's people through LinkedIn's search for its name (scrape.py scan_company_search)
  mutuals: '1.0.11',             // Read all mutuals: one person's full mutual list, as ties (scrape.py scan_mutual_list)
});

// What a newer scanner understands on an action an older one runs too, and the
// plugin version that first has it: the app only passes it to one that does.
export const PLUGIN_FLAGS_SINCE = Object.freeze({
  'circle-round': '1.0.10',      // --round on a circle scan: one round from where the last stopped (lib/scan-rounds.js)
  // --again on your connections, Breach and Read all mutuals: a list read to its end read again from
  // page 1, only when asked (Blake, 2026-10-17). An older plugin starts again by itself, as it always did.
  'list-again': '1.0.12',
});

/** Whether this scanner understands `flag` (PLUGIN_FLAGS_SINCE): the built-in one always does. */
export function pluginHas(scanner, flag) {
  const since = PLUGIN_FLAGS_SINCE[flag];
  const have = scanner?.from === 'plugin' ? scanner.plugin?.version : null;
  return !since || !have || compareVersions(have, since) >= 0;
}

/**
 * Why `action` can't run on this scanner, or null: a scanner plugin older than
 * the version that brought the action. The built-in scanner is always this
 * version's own. `scanner` is lib/scanner-files.js findScanner's answer.
 */
export function pluginTooOld(scanner, action) {
  const since = PLUGIN_SINCE[action];
  const have = scanner?.from === 'plugin' ? scanner.plugin?.version : null;
  if (!since || !have || compareVersions(have, since) >= 0) return null;
  return `This needs version ${since} or newer of the ${scanner.plugin.name || 'scanner'} plugin, and ${have} is installed. `
    + 'You can update it in Settings → Plugins.';
}
