// Which scanner scans run (lib/scanner-files.js findScanner): an installed
// scanner plugin while Enable plugins is on, otherwise the app's own. Checked
// on its own, then through /api/scraper, which builds the scanner's command
// line and starts it in the scanner's own folder.
//
// What it promises: with plugins off, an installed plugin is never used; on,
// the plugin's scrape.py runs, from the plugin's folder, and the Scan page's
// checks say so with the path; a plugin changed on the disk, or made for
// another Sixgree, falls back to the built-in scanner and says why; and a copy
// with no built-in scanner still scans from a plugin.
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python and writes down what it was started with
// and where, and every scrape.py here stops at once if a real Python ever runs
// it. Nothing opens a browser or reaches any website. On a temporary data
// folder, never the real one. Invented packages and people.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standInRoot } from './helpers/scanner.mjs';
import { makePackage } from './helpers/plugins.mjs';
import { findScanner, SCANNER_MISSING } from '../lib/scanner-files.js';
import { installPlugin } from '../lib/plugins.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-plugin-scanner-'));
const ARGS = path.join(dir, 'args.txt');
const CWD = path.join(dir, 'cwd.txt');
const home = path.join(dir, 'home');
const ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = ROOT;
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js chromeInstalled).
process.env.SIX_DEGREES_TEST_CHROME = 'found';
mkdirSync(home);
standInRoot(ROOT);
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done > '${ARGS}'`,
  `pwd -P > '${CWD}'`,
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

const APP = { appVersion: '1.2.8' };
let GET, POST, setPluginsEnabled;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ setPluginsEnabled } = await import('../lib/plugins-view.js'));
  const { getDb } = await import('../lib/db-client.js');
  const { writeSettings } = await import('../lib/settings.js');
  // The one-time "I understand" (lib/scan-risk.js) was given in this folder.
  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  getDb().prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const pluginFolder = (id) => path.join(home, 'plugins', id);
function installed(options = {}, to = home) {
  const pkg = makePackage(options);
  installPlugin(to, pkg.zip, { ...APP, sha256: pkg.sha256 });
  return pkg;
}

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const ask = async (query = '') => (await GET(new Request(`http://127.0.0.1/api/scraper${query}`))).json();

/**
 * Start the sign-in, and say which scrape.py the stand-in was started with, and
 * where. The sign-in, since either scanner plugin runs it: Check for new, which
 * this used to start, needs the auto plugin now (lib/scanner-capabilities.js),
 * and these tests install the manual one.
 */
async function scanned() {
  rmSync(ARGS, { force: true });
  rmSync(CWD, { force: true });
  const res = await post({ action: 'login' });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  for (let i = 0; i < 200 && (await ask('?job=1')).running; i++) await new Promise((r) => setTimeout(r, 25));
  const args = readFileSync(ARGS, 'utf8').trim().split('\n');
  const script = args.find((a) => a.endsWith('scrape.py'));
  assert.deepEqual(args.slice(args.indexOf(script) + 1), ['--login']);
  return { script, cwd: readFileSync(CWD, 'utf8').trim() };
}

/** The Scan page's checks: which scanner is looked at afresh on every call. */
const checks = async () => (await ask()).checks;

test('findScanner: built in, unless plugins are on and a sound scanner plugin is installed', () => {
  const own = path.join(dir, 'unit-home');
  mkdirSync(own);
  const builtIn = {
    found: true, from: 'built-in', plugin: null, skipped: null, cwd: ROOT,
    script: path.join(ROOT, 'scripts', 'scrape.py'), requirements: path.join(ROOT, 'scripts', 'requirements.txt'),
  };
  assert.deepEqual(findScanner(ROOT, { dataDir: own, pluginsEnabled: true, ...APP }), builtIn, 'on, with nothing installed');
  installed({}, own);
  assert.deepEqual(findScanner(ROOT, { dataDir: own, pluginsEnabled: false, ...APP }), builtIn, 'off: the plugin is never used');
  assert.deepEqual(findScanner(ROOT, { dataDir: own, ...APP }), builtIn, 'off unless said otherwise');

  const folder = path.join(own, 'plugins', 'manual-scan');
  assert.deepEqual(findScanner(ROOT, { dataDir: own, pluginsEnabled: true, ...APP }), {
    found: true, from: 'plugin', plugin: { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' }, skipped: null,
    script: path.join(folder, 'scanner', 'scrape.py'), requirements: path.join(folder, 'scanner', 'requirements.txt'), cwd: folder,
  });
  // No app folder found at all: the plugin still scans; without it, nothing does.
  assert.equal(findScanner(null, { dataDir: own, pluginsEnabled: true, ...APP }).from, 'plugin');
  assert.deepEqual(findScanner(null, { dataDir: own, ...APP }), {
    found: false, from: null, plugin: null, script: null, requirements: null, cwd: null, skipped: null,
  });

  // Made for another Sixgree: switched off, and the built-in one is used, saying why.
  const later = findScanner(ROOT, { dataDir: own, pluginsEnabled: true, appVersion: '0.9.0' });
  assert.equal(later.from, 'built-in');
  assert.match(later.skipped, /^Manual scan 1\.0\.0 can’t be used: It is made for Sixgree 1\.0\.0 or newer, and this copy is 0\.9\.0\./);
  // Broken, and no built-in scanner to fall back on: not found, with why.
  writeFileSync(path.join(folder, 'scanner', 'scrape.py'), 'print("changed")');
  const none = findScanner(path.join(dir, 'no-app'), { dataDir: own, pluginsEnabled: true, ...APP });
  assert.equal(none.found, false);
  assert.equal(none.skipped, 'Manual scan 1.0.0 can’t be used: scanner/scrape.py has changed since it was installed.');
});

test('plugins off: an installed scanner plugin is ignored, and scans run the built-in one from the app’s folder', async () => {
  installed();
  const c = await checks();
  assert.equal(c.scriptsFound, true);
  assert.deepEqual(c.scanner, { from: 'built-in', plugin: null, script: path.join(ROOT, 'scripts', 'scrape.py'), skipped: null });
  const run = await scanned();
  assert.equal(run.script, path.join(ROOT, 'scripts', 'scrape.py'));
  assert.equal(run.cwd, realpathSync(ROOT));
});

test('plugins on: scans run the plugin’s scrape.py, from the plugin’s own folder, and the checks say so', async () => {
  setPluginsEnabled(true);
  const script = path.join(pluginFolder('manual-scan'), 'scanner', 'scrape.py');
  const c = await checks();
  assert.equal(c.scriptsFound, true);
  assert.deepEqual(c.scanner, {
    from: 'plugin', plugin: { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' }, script, skipped: null,
  });
  const run = await scanned();
  assert.equal(run.script, script);
  assert.equal(run.cwd, realpathSync(pluginFolder('manual-scan')));
  // The newer of two scanner plugins.
  installed({ manifest: { id: 'auto-scan', name: 'Auto scan', version: '1.1.0', unlocks: ['auto'] } });
  assert.equal((await scanned()).script, path.join(pluginFolder('auto-scan'), 'scanner', 'scrape.py'));
});

test('a plugin changed on the disk is never run: the built-in scanner is, and the checks say why', async () => {
  rmSync(pluginFolder('auto-scan'), { recursive: true });
  writeFileSync(path.join(pluginFolder('manual-scan'), 'scanner', 'scrape.py'), 'print("not what was installed")');
  const c = await checks();
  assert.equal(c.scanner.from, 'built-in');
  assert.equal(c.scanner.skipped, 'Manual scan 1.0.0 can’t be used: scanner/scrape.py has changed since it was installed.');
  assert.equal((await scanned()).script, path.join(ROOT, 'scripts', 'scrape.py'));
});

test('a copy with no built-in scanner scans from a plugin, and says the scanner is missing without one', async () => {
  rmSync(pluginFolder('manual-scan'), { recursive: true });
  installed();
  renameSync(path.join(ROOT, 'scripts'), path.join(ROOT, 'scripts-gone'));
  try {
    assert.equal((await checks()).scanner.from, 'plugin');
    assert.equal((await scanned()).script, path.join(pluginFolder('manual-scan'), 'scanner', 'scrape.py'));

    setPluginsEnabled(false);
    const c = await checks();
    assert.equal(c.scriptsFound, false);
    assert.equal(c.scanner.from, null);
    const res = await post({ action: 'refresh' });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: SCANNER_MISSING, scannerMissing: true });
  } finally {
    renameSync(path.join(ROOT, 'scripts-gone'), path.join(ROOT, 'scripts'));
  }
});
