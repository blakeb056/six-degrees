// The scanner's own files: scrape.py, the program a scan runs; image_store.py,
// which it imports from beside it to save photos; and requirements.txt, its
// Python packages, pinned by hash.
//
// They are in one of two places, and findScanner() is the one place that
// decides which:
//   - an installed scanner plugin, while Settings → Plugins has Enable plugins
//     on: <data folder>/plugins/<id>/scanner/ (lib/plugins.js);
//   - otherwise the app's own scripts/, the built-in copy. Only a git checkout
//     has it: the downloads (the Mac app, the Windows and Linux apps, the npm
//     package) leave the scanner out (next.config.mjs, package.json "files"),
//     so a shipped copy scans only from a plugin.
//
// Everything that starts or sets up the scanner goes through findScanner, and
// a copy with neither must say so (SCANNER_MISSING), not fail on a path that
// isn't there. scannerPresent() and friends are the built-in copy alone, with
// plain paths and a look at the disk.
//
// The plugin runtime is the other half: the Python and the packages a scanner
// plugin runs on, which the desktop apps carry inside them so a plugin needs
// no setup there. Its packages are scripts/requirements.txt, the same pinned
// list the scanner has always used, so the build scripts bundle that Python
// whenever the checkout has the list (pluginRuntimeWanted), scanner or not
// (scripts/build-app.mjs, scripts/build-desktop.mjs).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { listPlugins, scannerPlugin, SCANNER_FOLDER } from './plugins.js';
import { APP_VERSION } from './app-version.js';
import { capabilities, SCANNER_BUILT_IN, SCANNER_NONE } from './scanner-capabilities.js';

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
 * The scanner's own code, which no download carries: only plugins bring it
 * now. next.config.mjs keeps it (and requirements.txt) out of the server Next
 * traces, package.json "files" out of the npm package, the build scripts take
 * out any that was traced in anyway, and CI checks every download for these
 * names (scripts/smoke-desktop.mjs, release.yml, npm-package.yml).
 */
export const SCANNER_CODE = Object.freeze(['scripts/scrape.py', 'scripts/image_store.py']);

/**
 * Should a desktop build bundle the plugin runtime (a Python with the pinned
 * packages from scripts/requirements.txt)? Yes whenever the checkout `root`
 * has that list, whether or not the scanner's code is there too.
 */
export function pluginRuntimeWanted(root) {
  return Boolean(root) && existsSync(scannerRequirements(root));
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

/**
 * What the scanner scans would use unlocks in the app (lib/scanner-capabilities.js):
 * { auto, manual, from }. The same choice as findScanner: with plugins on and
 * a sound scanner plugin installed, what every sound scanner plugin installed
 * unlocks, together (auto-scan and manual-scan run the same scanner, so with
 * both, both); otherwise the built-in copy, which unlocks everything; otherwise
 * nothing. A broken plugin, or one made for another Sixgree, unlocks nothing.
 */
export function scannerCapabilities(root, { dataDir = null, pluginsEnabled = false, appVersion = APP_VERSION } = {}) {
  if (pluginsEnabled && dataDir) {
    const unlocks = new Set(listPlugins(dataDir, { appVersion })
      .filter((p) => p.kind === 'scanner' && p.state === 'ready')
      .flatMap((p) => p.unlocks));
    if (unlocks.size) return capabilities({ auto: unlocks.has('auto'), manual: unlocks.has('manual'), from: 'plugin' });
  }
  return scannerPresent(root) ? SCANNER_BUILT_IN : SCANNER_NONE;
}

/** The server's answer to anything that needs the scanner, in a copy without it. */
export const SCANNER_MISSING = 'The scanner isn’t installed in this copy of Sixgree.';
