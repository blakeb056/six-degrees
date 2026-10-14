// Settings → Plugins, the server's side: the Enable plugins switch, read and
// set, and what the section shows, for the routes under /api/plugins and for
// the scanner's own route (app/api/scraper), which asks whether plugins are on.

import { getDb, dataDir } from './db-client.js';
import { readSettings, writeSettings, GATED_SETTINGS } from './settings.js';
import { listPlugins } from './plugins.js';
import { findScanner } from './scanner-files.js';
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
  const scanner = findScanner(projectRoot(), { dataDir: dir, pluginsEnabled: enabled });
  return {
    enabled,
    plugins: listPlugins(dir),
    scanner: { from: scanner.from, plugin: scanner.plugin, skipped: scanner.skipped },
  };
}
