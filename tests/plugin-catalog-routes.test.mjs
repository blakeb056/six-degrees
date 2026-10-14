// Browse and one-click Install through their routes (app/api/plugins/catalog
// and app/api/plugins/download), as the page calls them (lib/plugins-client.js),
// against a plugin list and packages on a server on 127.0.0.1 that
// SIX_DEGREES_PLUGIN_CATALOG points at: never the real internet. The routes
// load as Next loads them (tests/helpers/extensionless.mjs).
//
// What they promise: nothing goes online until asked, and never while plugins
// are off; the list is fetched on its own route, and a package only on
// Install, from the address the list gave; a package that isn't the list's
// checksum is refused; nothing installs without the yes, and what installs is
// the package that was checked; an older version installed is offered as an
// update and replaced; a link installs the same way, https only outside a
// test; and while the scanner runs, Install is refused but the list answers.
// Which routes are gated is pinned in tests/gate.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standInRoot } from './helpers/scanner.mjs';
import { makePackage, makeCatalog, pluginServer, sha256 } from './helpers/plugins.mjs';
import { catalogAction, CATALOG_UNLOADED } from '../lib/plugins-client.js';
import { forgetCatalog } from '../lib/plugin-catalog.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-plugin-catalog-routes-'));
const home = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = standInRoot(path.join(dir, 'root'));

const SCAN_STATE = Symbol.for('six-degrees.scan-state');
const manual = makePackage();
const auto = makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } });
const manualLater = makePackage({ manifest: { version: '1.0.1', about: 'An invented scanner, a later version.' } });
const linked = makePackage({ manifest: { id: 'linked-scan', name: 'Linked scan' } });

let server;
let list, enabled, catalog, download;

before(async () => {
  server = await pluginServer({
    '/manual-scan-1.0.0.sgplugin': manual.zip,
    '/manual-scan-1.0.1.sgplugin': manualLater.zip,
    '/auto-scan-1.0.0.sgplugin': auto.zip,
    '/linked-scan.sgplugin': linked.zip,
  });
  process.env.SIX_DEGREES_PLUGIN_CATALOG = `${server.base}/catalog.json`;
  list = await import('../app/api/plugins/route.js');
  enabled = await import('../app/api/plugins/enabled/route.js');
  catalog = await import('../app/api/plugins/catalog/route.js');
  download = await import('../app/api/plugins/download/route.js');
});

after(async () => {
  await server.close();
  forgetCatalog();
  delete process.env.SIX_DEGREES_PLUGIN_CATALOG;
  rmSync(dir, { recursive: true, force: true });
});

/** Serve this list at /catalog.json. */
function publish(items) {
  server.routes['/catalog.json'] = { body: JSON.stringify(makeCatalog(items)), headers: { 'content-type': 'application/json' } };
}
const at = (name) => `${server.base}/${name}`;
const json = (url, body, headers = {}) => new Request(`http://127.0.0.1${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const loadList = () => catalog.POST(new Request('http://127.0.0.1/api/plugins/catalog', { method: 'POST' }));
const get = (from) => download.POST(json('/api/plugins/download?check=1', from));
const confirm = (sum) => download.POST(json('/api/plugins/download', {}, sum ? { 'x-six-degrees-plugin-sha256': sum } : {}));
const setOn = (on) => enabled.POST(json('/api/plugins/enabled', { enabled: on }));
const view = async () => (await list.GET()).json();
const installedHere = () => (existsSync(path.join(home, 'plugins')) ? readdirSync(path.join(home, 'plugins')) : []);
const asked = () => server.requests.map((r) => r.path);

async function answer(res, status) {
  const body = await res.json();
  assert.equal(res.status, status, JSON.stringify(body));
  return body;
}

test('plugins off: nothing goes online, not the list and not a package', async () => {
  publish([{ pkg: manual, url: at('manual-scan-1.0.0.sgplugin') }]);
  assert.equal((await view()).enabled, false);
  assert.match((await answer(await loadList(), 409)).error, /Turn on Enable plugins first, then browse/);
  assert.match((await answer(await get({ id: 'manual-scan' }), 409)).error, /Turn on Enable plugins first/);
  assert.match((await answer(await get({ url: at('linked-scan.sgplugin') }), 409)).error, /Turn on Enable plugins first/);
  assert.deepEqual(asked(), [], 'no request reached the server');
});

test('turning plugins on, or listing them, fetches nothing; the list is fetched on its own route', async () => {
  await answer(await setOn(true), 200);
  await view();
  assert.deepEqual(asked(), []);

  const got = await answer(await loadList(), 200);
  assert.deepEqual(asked(), ['/catalog.json'], 'the list, and no package');
  assert.deepEqual(got.source, { host: server.base.slice(7), test: true, url: `${server.base}/catalog.json`, ignored: null });
  assert.deepEqual(got.plugins, [{
    id: 'manual-scan', name: 'Manual scan', version: '1.0.0', about: 'An invented scanner, for tests.', risk: 'An invented risk note.',
    kind: 'scanner', unlocks: ['manual'], size: manual.zip.length, host: server.base.slice(7), problem: null,
  }]);
  assert.deepEqual(got.dropped, []);
  assert.equal(catalogAction(got.plugins[0], (await view()).plugins), 'install');
});

test('Install from the list: downloaded on the press, checked, shown, and installed only with that yes', async () => {
  server.requests.length = 0;
  const checked = await answer(await get({ id: 'manual-scan' }), 200);
  assert.deepEqual(asked(), ['/manual-scan-1.0.0.sgplugin'], 'the package, from the address the list gave');
  assert.deepEqual(checked, {
    ok: true,
    plugin: {
      id: 'manual-scan', name: 'Manual scan', version: '1.0.0', about: 'An invented scanner, for tests.',
      risk: 'An invented risk note.', kind: 'scanner', unlocks: ['manual'],
    },
    sha256: manual.sha256,
    replaces: null,
    from: { kind: 'catalog', host: server.base.slice(7) },
  });
  assert.deepEqual(installedHere(), [], 'a check writes nothing');

  assert.match((await answer(await confirm(null), 409)).error, /Nothing is installed without a yes/);
  assert.match((await answer(await confirm(sha256('another package')), 409)).error, /isn’t here any more/);
  assert.deepEqual(installedHere(), []);

  const done = await answer(await confirm(checked.sha256), 200);
  assert.equal(done.installed.id, 'manual-scan');
  assert.deepEqual(done.from, { kind: 'catalog', host: server.base.slice(7) });
  assert.deepEqual(done.plugins.map((p) => [p.id, p.version, p.state]), [['manual-scan', '1.0.0', 'ready']]);
  assert.equal(done.scanner.from, 'plugin');
  assert.deepEqual(installedHere(), ['manual-scan']);
  assert.deepEqual(asked(), ['/manual-scan-1.0.0.sgplugin'], 'never downloaded twice');
  assert.match((await answer(await confirm(checked.sha256), 409)).error, /isn’t here any more/, 'one yes, one install');
  assert.equal(catalogAction((await (await loadList()).json()).plugins[0], done.plugins), 'installed');
});

test('an older version installed is offered as Update, and the same flow replaces it', async () => {
  publish([{ pkg: manualLater, url: at('manual-scan-1.0.1.sgplugin') }]);
  const got = await answer(await loadList(), 200);
  assert.equal(catalogAction(got.plugins[0], (await view()).plugins), 'update');
  const checked = await answer(await get({ id: 'manual-scan' }), 200);
  assert.deepEqual(checked.replaces, { version: '1.0.0', state: 'ready' });
  assert.equal(checked.plugin.about, 'An invented scanner, a later version.');
  const done = await answer(await confirm(checked.sha256), 200);
  assert.deepEqual(done.replaced, { version: '1.0.0', state: 'ready' });
  assert.deepEqual(done.plugins.map((p) => [p.id, p.version]), [['manual-scan', '1.0.1']]);
  assert.equal((await view()).enabled, true, 'the switch is kept');
});

test('a package that isn’t the list’s checksum is refused, and nothing waits for a yes', async () => {
  publish([{ pkg: auto, url: at('auto-scan-1.0.0.sgplugin'), sha256: sha256('not this package') }]);
  await answer(await loadList(), 200);
  const refused = await answer(await get({ id: 'auto-scan' }), 502);
  assert.match(refused.error, /doesn’t match the checksum the plugin list gives/);
  assert.match((await answer(await confirm(auto.sha256), 409)).error, /isn’t here any more/);
  assert.deepEqual(installedHere(), ['manual-scan']);
});

test('Install names a plugin on the list loaded here, and one for this version', async () => {
  publish([
    { pkg: auto, url: at('auto-scan-1.0.0.sgplugin'), sixgree: '>=99.0.0' },
    { pkg: manual, url: at('manual-scan-1.0.0.sgplugin') },
  ]);
  const got = await answer(await loadList(), 200);
  assert.match(got.plugins[0].problem, /made for Sixgree 99\.0\.0 or newer/);
  server.requests.length = 0;
  assert.match((await answer(await get({ id: 'auto-scan' }), 409)).error, /made for Sixgree 99\.0\.0 or newer/);
  assert.match((await answer(await get({ id: 'not-listed' }), 409)).error, /isn’t on the plugin list loaded here/);
  for (const body of [{}, { id: 'manual-scan', url: at('linked-scan.sgplugin') }, { id: 7 }, null]) {
    assert.match((await answer(await get(body), 400)).error, /Send the plugin’s id/, JSON.stringify(body));
  }
  assert.deepEqual(asked(), [], 'nothing downloaded for any of them');
});

test('Install from a link: the same yes; https only, unless a test’s list is on 127.0.0.1', async () => {
  const checked = await answer(await get({ url: at('linked-scan.sgplugin') }), 200);
  assert.deepEqual(checked.from, { kind: 'link', host: server.base.slice(7) });
  assert.equal(checked.plugin.id, 'linked-scan');
  const done = await answer(await confirm(checked.sha256), 200);
  assert.deepEqual(done.from, { kind: 'link', host: server.base.slice(7) });
  assert.deepEqual(installedHere().sort(), ['linked-scan', 'manual-scan']);

  assert.match((await answer(await get({ url: 'not a link' }), 400)).error, /isn’t a web address/);
  assert.match((await answer(await get({ url: at('nothing-here.sgplugin') }), 502)).error, /couldn’t be downloaded\. .* answered 404/);

  // Without a test's list, plain http is refused before anything is sent.
  delete process.env.SIX_DEGREES_PLUGIN_CATALOG;
  try {
    server.requests.length = 0;
    assert.match((await answer(await get({ url: at('linked-scan.sgplugin') }), 400)).error, /isn’t https/);
    assert.match((await answer(await get({ id: 'manual-scan' }), 409)).error, /isn’t on the plugin list loaded here/,
      'the list loaded from the test’s address isn’t the official one');
    assert.deepEqual(asked(), []);
  } finally {
    process.env.SIX_DEGREES_PLUGIN_CATALOG = `${server.base}/catalog.json`;
  }
});

test('a list that can’t be had says so plainly, with why', async () => {
  delete server.routes['/catalog.json'];
  const missing = await answer(await loadList(), 502);
  assert.equal(missing.error, CATALOG_UNLOADED);
  assert.equal(missing.detail, `${server.base.slice(7)} answered 404 (not found).`);
  assert.equal(missing.source.test, true);
  server.routes['/catalog.json'] = '{"format": "sixgree.plugin-catalog", "format_version": 1, "plugins": "none"}';
  assert.match((await answer(await loadList(), 502)).detail, /no list of plugins/);
});

test('while the scanner runs, Install is refused, saying what runs; the list still answers', async () => {
  publish([{ pkg: auto, url: at('auto-scan-1.0.0.sgplugin') }]);
  await answer(await loadList(), 200);
  globalThis[SCAN_STATE] = { running: true, action: 'install' };
  server.requests.length = 0;
  try {
    for (const res of [await get({ id: 'auto-scan' }), await get({ url: at('auto-scan-1.0.0.sgplugin') }), await confirm(auto.sha256)]) {
      assert.match((await answer(res, 409)).error, /^The scanner's packages are being installed\. Plugins can be installed once it has finished\./);
    }
    assert.deepEqual(asked(), [], 'nothing downloaded');
    assert.equal((await loadList()).status, 200);
  } finally {
    delete globalThis[SCAN_STATE];
  }
  assert.deepEqual(installedHere().sort(), ['linked-scan', 'manual-scan'], 'nothing changed');
});
