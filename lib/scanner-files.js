// The scanner's own files: scrape.py, the program a scan runs; image_store.py,
// which it imports from beside it to save photos; and requirements.txt, its
// Python packages, pinned by hash.
//
// They are in one of two places, and findScanner() is the one place that
// decides which:
//   - an installed scanner plugin, while Settings → Plugins has Enable plugins
//     on: <data folder>/plugins/<id>/scanner/ (lib/plugins.js);
//   - otherwise the app's own scripts/, the built-in copy, kept until the
//     scanner has fully moved out of the app into its plugins.
//
// Everything that starts or sets up the scanner goes through findScanner, and
// a copy with neither must say so (SCANNER_MISSING), not fail on a path that
// isn't there. scannerPresent() and friends are the built-in copy alone, with
// plain paths and a look at the disk, so the build scripts use them too
// (scripts/build-app.mjs, scripts/build-desktop.mjs).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { scannerPlugin, SCANNER_FOLDER } from './plugins.js';
import { APP_VERSION } from './app-version.js';

/** The scanner's files, relative to the app's folder (lib/paths.js projectRoot). */
export const SCANNER_FILES = Object.freeze(['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt']);

/** The program a scan runs, in the app's folder `root`. */
export function scannerScript(root) {
  return path.join(root, 'scripts', 'scrape.py');
}

/** The scanner's pinned packages, in the app's folder `root`: what Install and Set up the scanner install. */
export function scannerRequirements(root) {
  return path.join(root, 'scripts', 'requirements.txt');
}

/** Does the app's folder `root` have the scanner: every one of its files? */
export function scannerPresent(root) {
  return Boolean(root) && SCANNER_FILES.every((rel) => existsSync(path.join(root, rel)));
}

/**
 * Where scans get the scanner from now.
 *
 * With plugins on (`pluginsEnabled`, the Enable plugins setting) and a scanner
 * plugin installed and sound, it is that plugin's scanner/ folder; with both
 * auto-scan and manual-scan installed, the newer version (lib/plugins.js
 * scannerPlugin). Otherwise the built-in copy in the app's folder `root`.
 * A plugin that is broken, or made for another version of Sixgree, is never
 * used: `skipped` says why, and the built-in copy is used if there is one.
 *
 * @returns {{
 *   found: boolean,
 *   from: 'plugin' | 'built-in' | null,
 *   plugin: { id, name, version } | null,
 *   script: string | null,        // scrape.py, the program a scan runs
 *   requirements: string | null,  // what Install puts in the scanner's Python
 *   cwd: string | null,           // where it runs: the plugin's own folder, or the app's
 *   skipped: string | null,       // why installed scanner plugins weren't used
 * }}
 */
export function findScanner(root, { dataDir = null, pluginsEnabled = false, appVersion = APP_VERSION } = {}) {
  let skipped = null;
  if (pluginsEnabled && dataDir) {
    const found = scannerPlugin(dataDir, { appVersion });
    if (found.plugin) {
      const dir = path.join(found.dir, SCANNER_FOLDER);
      return {
        found: true, from: 'plugin',
        plugin: { id: found.plugin.id, name: found.plugin.name, version: found.plugin.version },
        script: path.join(dir, 'scrape.py'), requirements: path.join(dir, 'requirements.txt'),
        // The plugin's folder, never the app's: a relative path the scanner
        // writes to then lands in its own folder, not inside the app (which in
        // the Mac app is signed, and must not change).
        cwd: found.dir,
        skipped: null,
      };
    }
    if (found.skipped.length) skipped = found.skipped.join(' ');
  }
  if (scannerPresent(root)) {
    return {
      found: true, from: 'built-in', plugin: null,
      script: scannerScript(root), requirements: scannerRequirements(root), cwd: root, skipped,
    };
  }
  return { found: false, from: null, plugin: null, script: null, requirements: null, cwd: null, skipped };
}

/** The server's answer to anything that needs the scanner, in a copy without it. */
export const SCANNER_MISSING = 'The scanner isn’t installed in this copy of Sixgree.';
