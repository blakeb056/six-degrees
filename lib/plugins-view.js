// Settings → Plugins, the server's side: the Enable plugins switch, read and
// set, and what the section shows, for the routes under /api/plugins and for
// the scanner's own route (app/api/scraper), which asks whether plugins are on.

import { getDb, dataDir } from './db-client.js';
import { readSettings, writeSettings, GATED_SETTINGS } from './settings.js';
import { listPlugins, featureUnlocked } from './plugins.js';
import { FEATURE_UNLOCKS } from './plugins-shipped.js';
import { findScanner, scannerCapabilities } from './scanner-files.js';
import { projectRoot } from './paths.js';

/** Is Enable plugins on? Off when the setting can't be read: nothing of a plugin's runs on a guess. */
export function pluginsEnabled(db = getDb()) {
  try {
    return readSettings(db, GATED_SETTINGS).pluginsEnabled === true;
  } catch {
    return false;
  }
}

/** Turn Enable plugins on or off. @throws SettingsError for anything but true or false. */
export function setPluginsEnabled(on, db = getDb()) {
  return writeSettings(db, { pluginsEnabled: on }, GATED_SETTINGS).pluginsEnabled;
}

/**
 * What Settings → Plugins shows: whether plugins are on, every installed
 * plugin, each checked through (lib/plugins.js listPlugins), and which scanner
 * scans use now (lib/scanner-files.js findScanner), with why a scanner plugin
 * wasn't used when one wasn't. Paths stay on the server.
 */
export function pluginsView() {
  const dir = dataDir();
  const enabled = pluginsEnabled();
  // Settings → Plugins answers with this after every install, uninstall and
  // switch: the next job answer looks again, so the header follows at once.
  forgetScannerCapabilities();
  const scanner = findScanner(projectRoot(), { dataDir: dir, pluginsEnabled: enabled });
  return {
    enabled,
    plugins: listPlugins(dir),
    scanner: { from: scanner.from, plugin: scanner.plugin, skipped: scanner.skipped },
  };
}

// The last look at what the scanner unlocks, kept once per server process like
// the scan state (lib/scan-state.js), however the bundler splits the routes.
const CAPABILITIES = Symbol.for('six-degrees.scanner-capabilities');

/**
 * What the scanner scans would use unlocks now (lib/scanner-files.js
 * scannerCapabilities): { auto, manual, from }. Each look checks every
 * installed plugin file by file, so `maxAge` (ms) lets the job answer, which
 * every page asks for every few seconds, reuse a look that recent. Anything
 * that starts or refuses a scan looks afresh (the default).
 */
export function scannerCapabilitiesNow({ maxAge = 0, now = Date.now() } = {}) {
  const kept = globalThis[CAPABILITIES];
  if (maxAge > 0 && kept && now - kept.at >= 0 && now - kept.at < maxAge) return kept.value;
  const value = scannerCapabilities(projectRoot(), { dataDir: dataDir(), pluginsEnabled: pluginsEnabled() });
  globalThis[CAPABILITIES] = { at: now, value };
  return value;
}

/** Look afresh next time: a plugin was installed, removed or switched. */
export function forgetScannerCapabilities() {
  globalThis[CAPABILITIES] = null;
}

/**
 * The app's features that come with a feature plugin (lib/plugins.js, kind
 * "feature"), each on or off: { 'linkedin-browser': true }. On only with the
 * plugin installed, sound, and plugins on; the feature's code is the app's,
 * and shows only then (GET /api/plugins/features).
 */
export function appFeatures() {
  const dir = dataDir();
  const enabled = pluginsEnabled();
  return Object.fromEntries(FEATURE_UNLOCKS.map((unlock) => [unlock, featureUnlocked(dir, unlock, { pluginsEnabled: enabled })]));
}
