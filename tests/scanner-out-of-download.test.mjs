// The scanner leaves every download (lib/scanner-files.js): it comes only as a
// plugin (Settings → Plugins). Its code is in none of them: not in the npm
// package (package.json "files"), not in the server Next traces into
// .next/standalone, which the npm package, the Mac app and the Windows and
// Linux apps all carry (next.config.mjs), and not in what the build scripts
// copy by name. Its source and its tests stay in the repository.
//
// The plugin runtime stays: the desktop builds bundle a Python with the pinned
// packages whenever the checkout has scripts/requirements.txt.
//
// And so: a shipped copy, with no scanner of its own, unlocks nothing until a
// scanner plugin is installed and plugins are on, and then runs that plugin's
// files; a checkout keeps its built-in scanner. Temporary folders and invented
// packages only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import nextConfig from '../next.config.mjs';
import {
  SCANNER_FILES, SCANNER_CODE, scannerPresent, pluginRuntimeWanted, findScanner, scannerCapabilities,
} from '../lib/scanner-files.js';
import { capabilities, scanShows, SCANNER_NONE, SCANNER_BUILT_IN } from '../lib/scanner-capabilities.js';
import { installPlugin } from '../lib/plugins.js';
import { makePackage } from './helpers/plugins.mjs';
import { noScanner } from './helpers/scanner.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoFile = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// realpath: on a Mac, /private/var/... for /var/...
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'sixgree-out-of-download-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

// What no download may carry: the scanner's code, its package list (a shipped
// copy never reads it: a plugin brings its own), the tool that packs it into
// plugins, and the harness its tests run it in.
const NOT_SHIPPED = [...SCANNER_FILES, 'scripts/build-plugin.mjs', 'tests/helpers/scanner_harness.py'];
// What the app does run, which must still ship.
const SHIPPED = [
  'package.json', 'server.js', 'scripts/apply-update.sh', 'scripts/audit-avatars.mjs',
  'lib/scanner-files.js', 'lib/scanner-python.js', 'lib/plugins.js', 'lib/scanner-setup.js',
  'node_modules/next/dist/server/next-server.js',
];

const APP = { appVersion: '1.2.8' };
const AUTO_PKG = { manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } };
const MANUAL_PKG = {};   // tests/helpers/plugins.mjs: manual-scan, unlocking ["manual"]

test('SCANNER_CODE is the scanner\'s code: its program and what it imports from beside it', () => {
  assert.deepEqual(SCANNER_CODE, ['scripts/scrape.py', 'scripts/image_store.py']);
  assert.ok(SCANNER_CODE.every((rel) => SCANNER_FILES.includes(rel)));
});

test('the npm package\'s "files" names none of the scanner\'s files, and no folder that holds them', () => {
  const files = pkg.files;
  const ships = (rel) => files.some((f) => rel === f.replace(/\/$/, '') || rel.startsWith(f.endsWith('/') ? f : `${f}/`));
  for (const rel of NOT_SHIPPED) assert.equal(ships(rel), false, `${rel} is in the npm package`);
  // What it runs from scripts/ is still named, one by one.
  for (const rel of ['scripts/check-node.mjs', 'scripts/update.mjs']) assert.ok(ships(rel), `${rel} still ships`);
});

test('next.config.mjs keeps the scanner out of the traced server, matched the way Next matches it', () => {
  const excludes = nextConfig.outputFileTracingExcludes['*'];
  for (const rel of [...SCANNER_CODE, 'scripts/requirements.txt', 'scripts/build-plugin.mjs']) {
    assert.ok(excludes.includes(rel), `${rel} is named`);
  }
  // Next's own picomatch, with the options it uses (next/dist/build/collect-build-traces.js):
  // a page's trace is matched with the globs made absolute against the project
  // folder, and the server's own trace with them as written.
  const picomatch = createRequire(import.meta.url)('next/dist/compiled/picomatch');
  const absolute = picomatch(excludes.map((g) => path.join(REPO, g)), { dot: true, contains: true });
  const relative = picomatch(excludes, { dot: true, contains: true });
  for (const rel of NOT_SHIPPED) {
    assert.ok(absolute(path.join(REPO, rel)), `${rel} is left out of a page's trace`);
    assert.ok(relative(rel), `${rel} is left out of the server's trace`);
  }
  for (const rel of SHIPPED) {
    assert.equal(absolute(path.join(REPO, rel)), false, `${rel} must still be traced`);
    assert.equal(relative(rel), false, `${rel} must still be traced`);
  }
});

test('the build scripts copy none of the scanner\'s files, check the server they copy, and bundle the plugin runtime', () => {
  for (const script of ['scripts/build-app.mjs', 'scripts/build-desktop.mjs']) {
    const src = repoFile(script);
    // Every list of files copied into the server by name.
    const lists = [...src.matchAll(/for \(const rel of \[([^\]]*)\]\)/g)].map((m) => m[1]);
    assert.ok(lists.length >= 1, `${script} copies its files by name`);
    for (const list of lists) {
      for (const rel of SCANNER_FILES) assert.equal(list.includes(rel), false, `${script} copies ${rel}`);
    }
    assert.match(src, /for \(const rel of SCANNER_FILES\) \{\n\s+if \(!existsSync\(path\.join\(SERVER_DIR, rel\)\)\) continue;\n\s+rmSync\(path\.join\(SERVER_DIR, rel\)/,
      `${script} takes out any of the scanner's files that were traced in`);
    assert.match(src, /pluginRuntimeWanted\(ROOT\)/, `${script} bundles Python whenever the checkout has the package list`);
    assert.doesNotMatch(src, /scannerPresent/, `${script} no longer asks whether the scanner is there`);
  }
});

test('the plugin runtime is wanted wherever scripts/requirements.txt is, with the scanner\'s code or without it', () => {
  const runtimeOnly = path.join(scratch, 'runtime-only');
  mkdirSync(path.join(runtimeOnly, 'scripts'), { recursive: true });
  writeFileSync(path.join(runtimeOnly, 'scripts', 'requirements.txt'), '# pinned packages\n');
  assert.equal(pluginRuntimeWanted(runtimeOnly), true);
  assert.equal(scannerPresent(runtimeOnly), false, 'and the scanner isn\'t there');
  const neither = path.join(scratch, 'neither');
  mkdirSync(neither);
  assert.equal(pluginRuntimeWanted(neither), false);
  assert.equal(pluginRuntimeWanted(null), false);
  // This checkout bundles it.
  assert.equal(pluginRuntimeWanted(REPO), true);
});

/**
 * A stand-in for the server folder a download carries: the app's package.json
 * and what it runs from scripts/, never the scanner. `requirements` adds the
 * package list too, as a copy that kept only that would have it.
 */
function shippedRoot(name, { requirements = false } = {}) {
  const root = path.join(scratch, name);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: pkg.name })}\n`);
  writeFileSync(path.join(root, 'scripts', 'apply-update.sh'), '#!/bin/bash\n');
  writeFileSync(path.join(root, 'scripts', 'audit-avatars.mjs'), '');
  if (requirements) writeFileSync(path.join(root, 'scripts', 'requirements.txt'), '# pinned packages\n');
  return root;
}

test('a shipped copy with no plugin: no scanner, so nothing unlocked and no Scan tab, plugins on or off', () => {
  const home = path.join(scratch, 'home-none');
  mkdirSync(home);
  for (const root of [shippedRoot('shipped'), shippedRoot('shipped-with-list', { requirements: true })]) {
    for (const pluginsEnabled of [false, true]) {
      const caps = scannerCapabilities(root, { dataDir: home, pluginsEnabled, ...APP });
      assert.deepEqual(caps, SCANNER_NONE, `${path.basename(root)}, plugins ${pluginsEnabled ? 'on' : 'off'}`);
      assert.equal(scanShows(caps).scan, false, 'no Scan tab');
      const found = findScanner(root, { dataDir: home, pluginsEnabled, ...APP });
      assert.equal(found.found, false, 'scans are refused: the scanner isn\'t installed (SCANNER_MISSING)');
      assert.equal(found.script, null);
    }
  }
});

test('a shipped copy with a scanner plugin: what the plugin unlocks, from the plugin\'s own files, only with plugins on', () => {
  const home = path.join(scratch, 'home-plugin');
  mkdirSync(home);
  const root = shippedRoot('shipped-plugin', { requirements: true });
  const install = (options) => {
    const made = makePackage(options);
    installPlugin(home, made.zip, { ...APP, sha256: made.sha256 });
  };
  install(AUTO_PKG);
  assert.deepEqual(scannerCapabilities(root, { dataDir: home, pluginsEnabled: false, ...APP }), SCANNER_NONE, 'plugins off: still none');
  assert.deepEqual(scannerCapabilities(root, { dataDir: home, pluginsEnabled: true, ...APP }),
    capabilities({ auto: true, manual: false, from: 'plugin' }));

  const found = findScanner(root, { dataDir: home, pluginsEnabled: true, ...APP });
  const dir = path.join(home, 'plugins', 'auto-scan');
  assert.equal(found.from, 'plugin');
  assert.equal(found.script, path.join(dir, 'scanner', 'scrape.py'), 'the plugin\'s scrape.py');
  assert.equal(found.requirements, path.join(dir, 'scanner', 'requirements.txt'), 'its own package list, not the app\'s');
  assert.equal(found.cwd, dir, 'run from the plugin\'s folder, never the app\'s');

  install(MANUAL_PKG);
  assert.deepEqual(scannerCapabilities(root, { dataDir: home, pluginsEnabled: true, ...APP }),
    capabilities({ auto: true, manual: true, from: 'plugin' }), 'both plugins: everything');
});

test('a checkout keeps its built-in scanner: everything, with no plugin', (t) => {
  if (noScanner(t)) return;
  const home = path.join(scratch, 'home-checkout');
  mkdirSync(home);
  assert.equal(scannerCapabilities(REPO, { dataDir: home, pluginsEnabled: false, ...APP }), SCANNER_BUILT_IN);
  const found = findScanner(REPO, { dataDir: home, pluginsEnabled: true, ...APP });
  assert.equal(found.from, 'built-in');
  assert.equal(found.script, path.join(REPO, 'scripts', 'scrape.py'));
});
