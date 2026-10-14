// Settings → Plugins through its routes (app/api/plugins), as the page calls
// them (lib/plugins-client.js). The routes load as Next loads them
// (tests/helpers/extensionless.mjs).
//
// What they promise: Enable plugins is off until it's turned on, and only
// /api/plugins/enabled turns it on (POST /api/settings refuses it); nothing
// installs while plugins are off, nor without the yes (the checksum the check
// answered), nor from a body that arrived cut short; a check writes nothing;
// every change is refused while the scanner runs, with which job runs said;
// and an uninstall removes the plugin, after which scans go back to the
// built-in scanner. On a temporary data folder, with invented packages.
// Which routes are gated is pinned in tests/gate.test.mjs.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standInRoot } from './helpers/scanner.mjs';
import { makePackage } from './helpers/plugins.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-plugin-routes-'));
const home = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = standInRoot(path.join(dir, 'root'));

const SCAN_STATE = Symbol.for('six-degrees.scan-state');
let list, enabled, install, uninstall, settings;

before(async () => {
  list = await import('../app/api/plugins/route.js');
  enabled = await import('../app/api/plugins/enabled/route.js');
  install = await import('../app/api/plugins/install/route.js');
  uninstall = await import('../app/api/plugins/uninstall/route.js');
  settings = await import('../app/api/settings/route.js');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const json = (url, body) => new Request(`http://127.0.0.1${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const sendPackage = (zip, { check = false, headers = {} } = {}) => install.POST(new Request(
  `http://127.0.0.1/api/plugins/install${check ? '?check=1' : ''}`,
  { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-six-degrees-size': String(zip.length), ...headers }, body: zip },
));
const view = async () => (await list.GET()).json();
const setOn = (on) => enabled.POST(json('/api/plugins/enabled', { enabled: on }));
const pluginsFolder = () => path.join(home, 'plugins');

async function answer(res, status) {
  const body = await res.json();
  assert.equal(res.status, status, JSON.stringify(body));
  return body;
}

test('off at first: listed, nothing installed, and scans use the built-in scanner', async () => {
  assert.deepEqual(await view(), {
    enabled: false, plugins: [], scanner: { from: 'built-in', plugin: null, skipped: null },
  });
});

test('Enable plugins changes only through its own route: /api/settings refuses it', async () => {
  const res = await settings.POST(json('/api/settings', { settings: { pluginsEnabled: true } }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no setting called 'pluginsEnabled'/);
  assert.equal((await settings.GET()).status, 200);
  assert.equal('pluginsEnabled' in (await (await settings.GET()).json()).settings, false);
  assert.equal((await view()).enabled, false);

  for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, null]) {
    assert.equal((await enabled.POST(json('/api/plugins/enabled', body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await enabled.POST(new Request('http://127.0.0.1/api/plugins/enabled', { method: 'POST', body: 'not json' }))).status, 400);
});

test('nothing installs while plugins are off, not even a check', async () => {
  const pkg = makePackage();
  for (const check of [true, false]) {
    const body = await answer(await sendPackage(pkg.zip, { check, headers: { 'x-six-degrees-plugin-sha256': pkg.sha256 } }), 409);
    assert.equal(body.error, 'Turn on Enable plugins first, then install.');
  }
  assert.equal(existsSync(pluginsFolder()), false);
});

test('on: a check shows the package and writes nothing; the install needs that check’s yes', async () => {
  const on = await answer(await setOn(true), 200);
  assert.equal(on.enabled, true);
  assert.equal((await view()).enabled, true, 'kept');

  const pkg = makePackage();
  const checked = await answer(await sendPackage(pkg.zip, { check: true }), 200);
  assert.deepEqual(checked, {
    ok: true,
    plugin: {
      id: 'manual-scan', name: 'Manual scan', version: '1.0.0', about: 'An invented scanner, for tests.',
      risk: 'An invented risk note.', kind: 'scanner', unlocks: ['manual'],
    },
    sha256: pkg.sha256,
    replaces: null,
  });
  assert.equal(existsSync(pluginsFolder()), false, 'a check writes nothing');

  // No yes, or a yes to another package: nothing installed.
  assert.match((await answer(await sendPackage(pkg.zip), 409)).error, /without a yes/);
  const other = makePackage({ manifest: { version: '1.0.1' } });
  assert.match((await answer(await sendPackage(other.zip, { headers: { 'x-six-degrees-plugin-sha256': pkg.sha256 } }), 409)).error,
    /isn’t the package you said yes to/);
  assert.equal(existsSync(pluginsFolder()), false);

  const done = await answer(await sendPackage(pkg.zip, { headers: { 'x-six-degrees-plugin-sha256': checked.sha256 } }), 200);
  assert.equal(done.installed.id, 'manual-scan');
  assert.equal(done.replaced, null);
  assert.equal(done.enabled, true);
  assert.deepEqual(done.plugins.map((p) => [p.id, p.version, p.state]), [['manual-scan', '1.0.0', 'ready']]);
  assert.deepEqual(done.scanner, { from: 'plugin', plugin: { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' }, skipped: null });
  assert.deepEqual(readdirSync(pluginsFolder()), ['manual-scan']);

  // Checked again, it says what it would replace.
  assert.deepEqual((await answer(await sendPackage(other.zip, { check: true }), 200)).replaces, { version: '1.0.0', state: 'ready' });
});

test('a body cut short, too large, or without its size is refused before it is read', async () => {
  const pkg = makePackage({ manifest: { id: 'size-test' } });
  const cut = install.POST(new Request('http://127.0.0.1/api/plugins/install?check=1', {
    method: 'POST', headers: { 'x-six-degrees-size': String(pkg.zip.length + 10) }, body: pkg.zip,
  }));
  assert.match((await answer(await cut, 400)).error, /didn’t arrive whole/);
  const unsized = install.POST(new Request('http://127.0.0.1/api/plugins/install?check=1', { method: 'POST', body: pkg.zip }));
  assert.match((await answer(await unsized, 400)).error, /size wasn’t sent/);
  const huge = install.POST(new Request('http://127.0.0.1/api/plugins/install?check=1', {
    method: 'POST', headers: { 'x-six-degrees-size': String(9 * 1024 * 1024) }, body: pkg.zip,
  }));
  assert.match((await answer(await huge, 413)).error, /larger than a plugin package may be \(8 MB\)/);
});

test('a package that isn’t sound, or is for another Sixgree, is refused with why', async () => {
  const unlisted = makePackage({ extra: [{ name: 'scanner/sneaky.py', data: 'print(1)' }] });
  assert.match((await answer(await sendPackage(unlisted.zip, { check: true }), 400)).error, /doesn’t list: scanner\/sneaky\.py/);
  const traversal = makePackage({ extra: [{ name: '../../escape.py', data: 'x' }] });
  assert.match((await answer(await sendPackage(traversal.zip, { check: true }), 400)).error, /climbs out of its folder/);
  const future = makePackage({ manifest: { sixgree: '>=99.0.0' } });
  assert.match((await answer(await sendPackage(future.zip, { check: true }), 409)).error, /made for Sixgree 99\.0\.0 or newer/);
});

test('while the scanner runs, every change is refused, saying what runs; the list still answers', async () => {
  const pkg = makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } });
  globalThis[SCAN_STATE] = { running: true, action: 'install' };
  try {
    for (const res of [
      await setOn(false),
      await sendPackage(pkg.zip, { check: true }),
      await sendPackage(pkg.zip, { headers: { 'x-six-degrees-plugin-sha256': pkg.sha256 } }),
      await uninstall.POST(json('/api/plugins/uninstall', { id: 'manual-scan' })),
    ]) {
      const body = await answer(res, 409);
      assert.match(body.error, /^The scanner's packages are being installed\. Plugins can be/);
    }
    assert.equal((await list.GET()).status, 200);
  } finally {
    delete globalThis[SCAN_STATE];
  }
  assert.deepEqual(readdirSync(pluginsFolder()), ['manual-scan'], 'nothing changed');
  assert.equal((await view()).enabled, true);
});

test('off again: the plugin stays installed and listed, and scans use the built-in scanner', async () => {
  const off = await answer(await setOn(false), 200);
  assert.equal(off.enabled, false);
  assert.deepEqual(off.plugins.map((p) => p.id), ['manual-scan']);
  assert.equal(off.scanner.from, 'built-in');
  await answer(await setOn(true), 200);
  assert.equal((await view()).scanner.from, 'plugin');
});

test('uninstall: by id only, and afterwards scans use the built-in scanner again', async () => {
  for (const id of ['../manual-scan', 'Manual-Scan', 42]) {
    assert.match((await answer(await uninstall.POST(json('/api/plugins/uninstall', { id })), 400)).error, /isn’t the id of a plugin/);
  }
  assert.match((await answer(await uninstall.POST(json('/api/plugins/uninstall', { id: 'auto-scan' })), 404)).error, /No plugin called auto-scan/);
  assert.equal((await uninstall.POST(new Request('http://127.0.0.1/api/plugins/uninstall', { method: 'POST', body: '{' }))).status, 400);

  const done = await answer(await uninstall.POST(json('/api/plugins/uninstall', { id: 'manual-scan' })), 200);
  assert.deepEqual(done.removed, { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' });
  assert.deepEqual(done.plugins, []);
  assert.equal(done.scanner.from, 'built-in');
  assert.deepEqual(readdirSync(pluginsFolder()), []);
  // Removing one works with plugins off too.
  await answer(await sendPackage(makePackage().zip, { headers: { 'x-six-degrees-plugin-sha256': makePackage().sha256 } }), 200);
  await answer(await setOn(false), 200);
  await answer(await uninstall.POST(json('/api/plugins/uninstall', { id: 'manual-scan' })), 200);
  assert.deepEqual(readdirSync(pluginsFolder()), []);
});
