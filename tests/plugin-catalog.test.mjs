// lib/plugin-catalog.js: the plugin list and the downloads behind Install,
// against a server on 127.0.0.1 (tests/helpers/plugins.mjs pluginServer),
// never the real internet. Where the official list would be asked, a stand-in
// fetch answers instead and says what was asked.
//
// What it promises: a list is checked entry by entry and never throws, an
// entry Sixgree can't trust is left out with why and one not for this version
// is shown with why; the list comes from the official address unless a test
// points elsewhere, and plain http only ever on 127.0.0.1 in that test; every
// fetch is https only, redirects included, capped in size and time, and sends
// no cookies and nothing but a User-Agent naming Sixgree's version; and a
// package from the list must be the list's size, checksum, plugin and version.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCatalog, catalogSource, linkProblem, fetchCapped, loadCatalog, listedEntry, forgetCatalog, downloadPackage,
  holdDownload, heldDownload, releaseDownload, entryView, FetchError, CatalogError,
  OFFICIAL_CATALOG_URL, CATALOG_ENV, MAX_CATALOG_BYTES, MAX_CATALOG_ENTRIES, USER_AGENT, HOLD_MS,
} from '../lib/plugin-catalog.js';
import { PluginError } from '../lib/plugins.js';
import { catalogAction, MAX_PLUGIN_BYTES } from '../lib/plugins-client.js';
import { APP_VERSION } from '../lib/app-version.js';
import { buildCatalog, PLUGINS } from '../scripts/build-plugin.mjs';
import { makePackage, makeCatalog, pluginServer, sha256 } from './helpers/plugins.mjs';

const APP = { appVersion: '1.2.8' };
const servers = [];
after(async () => { await Promise.all(servers.map((s) => s.close())); forgetCatalog(); });
async function serve(routes) {
  const server = await pluginServer(routes);
  servers.push(server);
  return server;
}

const manual = makePackage();
const auto = makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } });
const entry = (over = {}) => ({ ...makeCatalog([{ pkg: manual, url: 'https://plugins.example/manual-scan-1.0.0.sgplugin' }]).plugins[0], ...over });
const listOf = (...plugins) => ({ format: 'sixgree.plugin-catalog', format_version: 1, plugins });

/** A fetch that answers 404 and says what it was asked: where the real internet would be. */
function standIn() {
  const asked = [];
  const fetchImpl = async (url, init) => { asked.push({ url: String(url), init }); return new Response('no', { status: 404 }); };
  return { asked, fetchImpl };
}

test('a sound list: every entry shown, and the page gets no addresses or checksums', () => {
  const list = makeCatalog([
    { pkg: manual, url: 'https://plugins.example/manual-scan-1.0.0.sgplugin' },
    { pkg: auto, url: 'https://plugins.example/auto-scan-1.0.0.sgplugin', extra_from_a_later_format: true },
  ], { a_later_top_level_field: 1 });
  const checked = checkCatalog(list, APP);
  assert.equal(checked.problem, null);
  assert.deepEqual(checked.dropped, []);
  assert.deepEqual(checked.plugins.map((p) => [p.id, p.problem]), [['manual-scan', null], ['auto-scan', null]]);
  assert.equal(checked.plugins[0].sha256, manual.sha256, 'kept on the server for the download');
  assert.deepEqual(entryView(checked.plugins[0]), {
    id: 'manual-scan', name: 'Manual scan', version: '1.0.0', about: 'An invented scanner, for tests.',
    risk: 'An invented risk note.', kind: 'scanner', unlocks: ['manual'], size: manual.zip.length, host: 'plugins.example', problem: null,
  });
});

test('a hostile list: what can’t be trusted is left out with why, never thrown', () => {
  const bad = [
    [{ ...entry(), id: '../../etc' }, /id isn’t one Sixgree accepts/, null],
    [{ ...entry(), id: 'Manual-Scan' }, /id isn’t one Sixgree accepts/, null],
    [{ ...entry(), id: 42 }, /id isn’t one Sixgree accepts/, null],
    [{ ...entry({ id: 'no-name' }), name: '' }, /has no name/, 'no-name'],
    [entry({ id: 'long-name', name: 'x'.repeat(61) }), /name is longer than 60/, 'long-name'],
    [entry({ id: 'turned-name', name: 'Manual‮ nacs' }), /aren’t plain text/, 'turned-name'],
    [entry({ id: 'bad-version', version: '1.0' }), /version isn’t a version number/, 'bad-version'],
    [entry({ id: 'huge-about', about: 'a'.repeat(5000) }), /about is longer than 400/, 'huge-about'],
    [entry({ id: 'plain-http', url: 'http://plugins.example/x.sgplugin' }), /isn’t https/, 'plain-http'],
    [entry({ id: 'loopback-http', url: 'http://127.0.0.1:9/x.sgplugin' }), /isn’t https/, 'loopback-http'],
    [entry({ id: 'file-url', url: 'file:///etc/passwd' }), /isn’t https/, 'file-url'],
    [entry({ id: 'with-password', url: 'https://me:pw@plugins.example/x.sgplugin' }), /name or password/, 'with-password'],
    [entry({ id: 'no-url', url: undefined }), /no link/, 'no-url'],
    [entry({ id: 'no-sum', sha256: 'abc' }), /sha256 isn’t a SHA-256/, 'no-sum'],
    [entry({ id: 'upper-sum', sha256: manual.sha256.toUpperCase() }), /sha256 isn’t a SHA-256/, 'upper-sum'],
    [entry({ id: 'no-size', size: '12' }), /size isn’t a number of bytes/, 'no-size'],
    [entry({ id: 'too-big', size: MAX_PLUGIN_BYTES + 1 }), /larger than a plugin package may be \(8 MB\)/, 'too-big'],
    [entry({ id: 'no-range', sixgree: 'any' }), /which Sixgree it is for/, 'no-range'],
    [entry({ id: 'no-unlocks', unlocks: [] }), /unlocks must list/, 'no-unlocks'],
    [null, /isn’t an entry/, null],
    ['manual-scan', /isn’t an entry/, null],
    [[entry()], /isn’t an entry/, null],
  ];
  const checked = checkCatalog(listOf(...bad.map(([e]) => e), entry(), entry({ name: 'The same id again' })), APP);
  assert.equal(checked.problem, null);
  assert.deepEqual(checked.plugins.map((p) => p.id), ['manual-scan'], 'only the sound one, and only its first listing');
  assert.equal(checked.plugins[0].name, 'Manual scan');
  assert.equal(checked.dropped.length, bad.length + 1);
  bad.forEach(([, why, id], i) => {
    assert.match(checked.dropped[i].reason, why, `entry ${i}`);
    assert.equal(checked.dropped[i].id, id, `entry ${i}: a hostile id is never echoed`);
  });
  assert.deepEqual(checked.dropped.at(-1), { id: 'manual-scan', reason: 'It is listed more than once; the first is shown.' });
});

test('an entry not for this version is shown with why, and offers no Install', () => {
  const checked = checkCatalog(listOf(
    entry({ id: 'future', sixgree: '>=99.0.0' }),
    entry({ id: 'old', sixgree: '<1.0.0' }),
    entry({ id: 'theme', kind: 'theme' }),
    entry({ id: 'odd-kind', kind: { evil: '<script>' } }),
    entry({ id: 'new-unlock', unlocks: ['manual', 'teleport'] }),
  ), APP);
  assert.deepEqual(checked.dropped, []);
  const why = Object.fromEntries(checked.plugins.map((p) => [p.id, p.problem]));
  assert.match(why.future, /made for Sixgree 99\.0\.0 or newer, and this copy is 1\.2\.8/);
  assert.match(why.old, /older than 1\.0\.0/);
  assert.equal(why.theme, 'It is a kind of plugin this Sixgree doesn’t know ("theme").');
  assert.equal(why['odd-kind'], 'It is a kind of plugin this Sixgree doesn’t know.', 'an odd kind is never echoed');
  assert.equal(why['new-unlock'], 'It turns on something this Sixgree doesn’t have ("teleport").');
  for (const p of checked.plugins) assert.equal(catalogAction(p, []), null, p.id);
});

test('a file that isn’t a list Sixgree reads says so, whatever it holds', () => {
  const problems = [
    [null, /isn’t a plugin list/], [[], /isn’t a plugin list/], ['catalog', /isn’t a plugin list/], [42, /isn’t a plugin list/],
    [{ format: 'sixgree.plugin', format_version: 1, plugins: [] }, /isn’t a Sixgree plugin list/],
    [{ format: 'sixgree.plugin-catalog', format_version: 2, plugins: [] }, /newer Sixgree \(list format 2\)/],
    [{ format: 'sixgree.plugin-catalog', format_version: '1', plugins: [] }, /format_version isn’t one/],
    [{ format: 'sixgree.plugin-catalog', format_version: 1 }, /no list of plugins/],
    [{ format: 'sixgree.plugin-catalog', format_version: 1, plugins: { 'manual-scan': {} } }, /no list of plugins/],
  ];
  for (const [raw, why] of problems) assert.match(checkCatalog(raw, APP).problem, why, JSON.stringify(raw));

  // Huge: only the first MAX_CATALOG_ENTRIES are read, and that is said.
  const many = checkCatalog(listOf(...Array.from({ length: MAX_CATALOG_ENTRIES + 50 }, (_, i) => entry({ id: `p-${i}` }))), APP);
  assert.equal(many.plugins.length, MAX_CATALOG_ENTRIES);
  assert.match(many.dropped.at(-1).reason, /holds 250 entries, and only the first 200 are read/);

  // Nothing JSON can hold makes it throw.
  const odd = [undefined, true, '', {}, { plugins: null }, listOf(null, 1, 'a', [], {}, { id: null }, { id: {} }),
    listOf({ ...entry(), name: { toString: null } }, { ...entry(), unlocks: 'manual' }, { ...entry(), size: 1e300 }, { ...entry(), sixgree: ['>=1'] })];
  for (const raw of odd) assert.doesNotThrow(() => checkCatalog(raw, APP), JSON.stringify(raw));
});

test('the list comes from the official address, unless a test points at https or http on 127.0.0.1', () => {
  assert.deepEqual(catalogSource({}), { url: OFFICIAL_CATALOG_URL, test: false });
  assert.equal(OFFICIAL_CATALOG_URL, 'https://raw.githubusercontent.com/blakeb056/sixgree-plugins/main/catalog.json');
  assert.deepEqual(catalogSource({ [CATALOG_ENV]: 'http://127.0.0.1:4848/catalog.json' }), { url: 'http://127.0.0.1:4848/catalog.json', test: true });
  assert.deepEqual(catalogSource({ [CATALOG_ENV]: 'https://plugins.example/list.json' }), { url: 'https://plugins.example/list.json', test: true });
  for (const bad of ['http://192.168.1.5:4848/catalog.json', 'http://localhost:4848/catalog.json', 'http://127.0.0.1/catalog.json',
    'http://[::1]:4848/catalog.json', 'http://127.0.0.1.evil.example:80/c.json', 'file:///tmp/catalog.json', 'nonsense',
    'https://me:pw@plugins.example/c.json', 'https://plugins.example/c.json#x']) {
    const source = catalogSource({ [CATALOG_ENV]: bad });
    assert.equal(source.url, OFFICIAL_CATALOG_URL, bad);
    assert.equal(source.test, false, bad);
    assert.match(source.ignored, /SIX_DEGREES_PLUGIN_CATALOG is set but ignored/, bad);
  }
});

test('a link must be https; plain http only on 127.0.0.1, and only in a test', () => {
  assert.equal(linkProblem('https://plugins.example/a.sgplugin'), null);
  assert.equal(linkProblem('  https://plugins.example/a.sgplugin  '), null);
  assert.match(linkProblem('http://plugins.example/a.sgplugin'), /isn’t https/);
  assert.match(linkProblem('http://127.0.0.1:4848/a.sgplugin'), /isn’t https/);
  assert.equal(linkProblem('http://127.0.0.1:4848/a.sgplugin', { test: true }), null);
  for (const bad of ['http://localhost:4848/a.sgplugin', 'http://10.0.0.2/a.sgplugin', 'ftp://127.0.0.1/a.sgplugin', 'data:,x']) {
    assert.match(linkProblem(bad, { test: true }), /isn’t https/, bad);
  }
  assert.match(linkProblem('https://u:p@plugins.example/a'), /name or password/);
  assert.match(linkProblem('not a link'), /isn’t a web address/);
  assert.match(linkProblem(''), /no link/);
  assert.match(linkProblem(42), /no link/);
  assert.match(linkProblem(`https://plugins.example/${'a'.repeat(2100)}`), /longer than 2,048/);
});

test('nothing is fetched until asked, and then only the list: no cookies, only a User-Agent naming this version', async () => {
  const list = makeCatalog([{ pkg: manual, url: 'http://127.0.0.1:1/never-asked.sgplugin' }]);
  const server = await serve({
    '/catalog.json': { body: JSON.stringify(list), headers: { 'content-type': 'application/json', 'set-cookie': 'tracker=1; Path=/' } },
  });
  assert.equal(server.requests.length, 0, 'loading the module fetched nothing');
  const env = { [CATALOG_ENV]: `${server.base}/catalog.json` };
  const first = await loadCatalog({ env, ...APP });
  await loadCatalog({ env, ...APP });
  assert.deepEqual(server.requests.map((r) => r.path), ['/catalog.json', '/catalog.json'], 'the list, and no package');
  assert.deepEqual(first.source, { host: server.base.slice(7), test: true, url: `${server.base}/catalog.json`, ignored: null });
  assert.deepEqual(first.plugins.map((p) => p.id), ['manual-scan']);
  for (const { headers } of server.requests) {
    assert.equal(headers['user-agent'], USER_AGENT);
    assert.equal(USER_AGENT, `Sixgree/${APP_VERSION}`);
    assert.equal(headers.cookie, undefined, 'a cookie it was given is never sent back');
    for (const name of ['authorization', 'referer', 'origin', 'x-forwarded-for']) assert.equal(headers[name], undefined, name);
    assert.deepEqual(Object.keys(headers).filter((h) => h.startsWith('x-')), []);
  }
  assert.equal(listedEntry('manual-scan', env).url, 'http://127.0.0.1:1/never-asked.sgplugin', 'kept for Install');
  assert.equal(listedEntry('manual-scan', {}), null, 'only for the list it came from');
  assert.equal(listedEntry('auto-scan', env), null);
});

test('without a test list, the official address is asked, and a test list that isn’t loopback is not', async () => {
  for (const env of [{}, { [CATALOG_ENV]: 'http://192.168.1.5:4848/catalog.json' }]) {
    const { asked, fetchImpl } = standIn();
    await assert.rejects(loadCatalog({ env, fetchImpl, ...APP }), (err) => {
      assert.ok(err instanceof CatalogError);
      assert.equal(err.message, 'raw.githubusercontent.com answered 404 (not found).');
      return true;
    });
    assert.deepEqual(asked.map((a) => a.url), [OFFICIAL_CATALOG_URL]);
    assert.equal(asked[0].init.redirect, 'manual');
    assert.equal(asked[0].init.credentials, 'omit');
    assert.deepEqual(asked[0].init.headers, { Accept: 'application/json', 'User-Agent': USER_AGENT });
  }
});

test('the list: capped at 256 KB, with or without a Content-Length, and refused when it isn’t JSON or isn’t a list', async () => {
  const big = Buffer.alloc(MAX_CATALOG_BYTES + 1, 0x20);
  const server = await serve({
    '/sized.json': big,
    '/unsized.json': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }); // chunked: no Content-Length
      const piece = Buffer.alloc(64 * 1024, 0x20);
      for (let i = 0; i < 5; i++) res.write(piece);
      res.end();
    },
    '/not-json.json': 'not json',
    '/not-utf8.json': Buffer.from([0x7b, 0xff, 0x7d]),
    '/wrong.json': JSON.stringify({ format: 'something-else' }),
    '/newer.json': JSON.stringify({ format: 'sixgree.plugin-catalog', format_version: 3, plugins: [] }),
  });
  const load = (p) => loadCatalog({ env: { [CATALOG_ENV]: `${server.base}${p}` }, ...APP });
  for (const p of ['/sized.json', '/unsized.json']) {
    await assert.rejects(load(p), /larger than a plugin list may be \(256 KB\)/, p);
  }
  await assert.rejects(load('/not-json.json'), /isn’t valid JSON/);
  await assert.rejects(load('/not-utf8.json'), /isn’t valid JSON/);
  await assert.rejects(load('/wrong.json'), /isn’t a Sixgree plugin list/);
  await assert.rejects(load('/newer.json'), /newer Sixgree \(list format 3\)/);
  await assert.rejects(load('/missing.json'), /answered 404 \(not found\)/);
});

test('a fetch gives up after its time limit, and says so', async () => {
  const server = await serve({ '/slow.json': () => { /* never answers */ } });
  const started = Date.now();
  await assert.rejects(
    fetchCapped(`${server.base}/slow.json`, { maxBytes: 1024, timeoutMs: 250, test: true }),
    (err) => err instanceof FetchError && /didn’t answer in time/.test(err.message),
  );
  assert.ok(Date.now() - started < 5000, 'it stopped near the limit');
  await assert.rejects(
    loadCatalog({ env: { [CATALOG_ENV]: `${server.base}/slow.json` }, timeoutMs: 250, ...APP }),
    (err) => err instanceof CatalogError && /didn’t answer in time/.test(err.message),
  );
});

test('plain http only in a test, only on 127.0.0.1, and every redirect is checked as the first address was', async () => {
  const server = await serve({ '/ok': 'fine' });
  server.routes['/to-ok'] = { status: 302, headers: { location: '/ok' } };
  server.routes['/to-localhost'] = { status: 302, headers: { location: `http://localhost:${new URL(server.base).port}/ok` } };
  server.routes['/to-file'] = { status: 301, headers: { location: 'file:///etc/passwd' } };
  server.routes['/nowhere'] = { status: 307 };
  server.routes['/loop'] = { status: 302, headers: { location: '/loop' } };
  const get = (p, test = true) => fetchCapped(`${server.base}${p}`, { maxBytes: 1024, timeoutMs: 5000, test });

  // Not in a test: refused before anything is sent.
  await assert.rejects(get('/ok', false), /isn’t https/);
  assert.equal(server.requests.length, 0);

  assert.equal((await get('/ok')).data.toString(), 'fine');
  const followed = await get('/to-ok');
  assert.equal(followed.data.toString(), 'fine');
  assert.equal(followed.url, `${server.base}/ok`);

  const before = server.requests.length;
  await assert.rejects(get('/to-localhost'), /sent on to an address Sixgree won’t use\. The link isn’t https/);
  await assert.rejects(get('/to-file'), /sent on to an address Sixgree won’t use/);
  assert.deepEqual(server.requests.slice(before).map((r) => r.path), ['/to-localhost', '/to-file'], 'neither redirect was followed');
  await assert.rejects(get('/nowhere'), /answered 307 without saying where to/);
  await assert.rejects(get('/loop'), /sent on more than 5 times/);
  assert.equal(server.requests.filter((r) => r.path === '/loop').length, 6);
});

test('a package from the list must be the list’s size, checksum, plugin and version; nothing else is used', async () => {
  const later = makePackage({ manifest: { version: '1.0.1' } });
  const server = await serve({
    '/manual.sgplugin': manual.zip,
    '/later.sgplugin': later.zip,
    '/padded.sgplugin': Buffer.concat([manual.zip, Buffer.from('extra')]),
  });
  const listed = (over = {}) => ({ ...entry({ url: `${server.base}/manual.sgplugin` }), ...over });
  const get = (l) => downloadPackage(l.url, { listed: l, test: true, ...APP });

  const got = await get(listed());
  assert.equal(got.pkg.sha256, manual.sha256);
  assert.equal(got.pkg.manifest.id, 'manual-scan');
  assert.equal(got.host, server.base.slice(7));

  const refused = async (l, why) => assert.rejects(get(l), (err) => {
    assert.ok(err instanceof PluginError, err.message);
    assert.match(err.message, why);
    assert.equal(err.status, 502);
    return true;
  });
  await refused(listed({ sha256: sha256('something else') }), /doesn’t match the checksum the plugin list gives/);
  await refused(listed({ size: manual.zip.length + 7 }), /isn’t the size the plugin list gives/);
  await refused(listed({ url: `${server.base}/padded.sgplugin` }), /bigger than the plugin list says it is/);
  await refused(listed({ version: '1.0.1', url: `${server.base}/later.sgplugin`, sha256: later.sha256, size: later.zip.length, id: 'auto-scan' }),
    /The package is manual-scan 1\.0\.1, not the auto-scan 1\.0\.1 the plugin list names/);
  await refused(listed({ version: '2.0.0', url: `${server.base}/later.sgplugin`, sha256: later.sha256, size: later.zip.length }),
    /not the manual-scan 2\.0\.0/);
  await refused(listed({ url: `${server.base}/gone.sgplugin` }), /couldn’t be downloaded\. .* answered 404/);
});

test('a package from a link: the package’s own checks only, and capped at 8 MB', async () => {
  const unlisted = makePackage({ extra: [{ name: 'scanner/sneaky.py', data: 'print(1)' }] });
  const server = await serve({
    '/link.sgplugin': manual.zip,
    '/sneaky.sgplugin': unlisted.zip,
    '/huge.sgplugin': (req, res) => {
      res.writeHead(200);
      const piece = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 9; i++) res.write(piece);
      res.end();
    },
  });
  const got = await downloadPackage(`${server.base}/link.sgplugin`, { test: true, ...APP });
  assert.equal(got.pkg.sha256, manual.sha256);
  await assert.rejects(downloadPackage(`${server.base}/sneaky.sgplugin`, { test: true, ...APP }),
    (err) => err instanceof PluginError && err.status === 400 && /doesn’t list: scanner\/sneaky\.py/.test(err.message));
  await assert.rejects(downloadPackage(`${server.base}/huge.sgplugin`, { test: true, ...APP }),
    (err) => err instanceof PluginError && err.status === 502 && /larger than a plugin package may be \(8 MB\)/.test(err.message));
});

test('a checked download waits for its yes: by its checksum, a quarter of an hour, a few at most', () => {
  const sum = (n) => sha256(`package ${n}`);
  const t = 1_000_000;
  holdDownload(sum(1), Buffer.from('one'), { kind: 'link', host: 'a.example' }, t);
  assert.deepEqual(heldDownload(sum(1), t + 1000).from, { kind: 'link', host: 'a.example' });
  assert.equal(heldDownload('not-a-sum', t), null);
  assert.equal(heldDownload(sum(1), t + HOLD_MS + 1), null, 'too old: gone');
  for (let n = 2; n <= 7; n++) holdDownload(sum(n), Buffer.from(String(n)), { kind: 'catalog', host: 'b.example' }, t + n);
  assert.equal(heldDownload(sum(2), t + 10), null, 'the oldest go first');
  assert.equal(heldDownload(sum(3), t + 10), null);
  assert.equal(heldDownload(sum(7), t + 10).buf.toString(), '7');
  releaseDownload(sum(7));
  assert.equal(heldDownload(sum(7), t + 10), null, 'released once installed');
});

test('each card offers Install, Update, Reinstall or Installed', () => {
  const card = { id: 'manual-scan', version: '1.0.1', problem: null };
  assert.equal(catalogAction(card, []), 'install');
  assert.equal(catalogAction(card, [{ id: 'auto-scan', version: '9.0.0', state: 'ready' }]), 'install');
  assert.equal(catalogAction(card, [{ id: 'manual-scan', version: '1.0.0', state: 'ready' }]), 'update');
  assert.equal(catalogAction(card, [{ id: 'manual-scan', version: '1.0.0', state: 'unsupported' }]), 'update');
  assert.equal(catalogAction(card, [{ id: 'manual-scan', version: '1.0.1', state: 'ready' }]), 'installed');
  assert.equal(catalogAction(card, [{ id: 'manual-scan', version: '1.2.0', state: 'ready' }]), 'installed', 'a newer copy here stays');
  assert.equal(catalogAction(card, [{ id: 'manual-scan', version: '1.0.1', state: 'broken' }]), 'reinstall');
  assert.equal(catalogAction({ ...card, problem: 'Not for this one.' }, []), null);
  assert.equal(catalogAction(null, []), null);
});

test('scripts/build-plugin.mjs --catalog: a list naming the built packages, read back whole', () => {
  const built = PLUGINS.map((plugin) => {
    const pkg = makePackage({ manifest: { id: plugin.id, name: plugin.name, unlocks: plugin.unlocks, sixgree: '>=1.2.8' } });
    return { plugin, file: `${plugin.id}-1.0.0.sgplugin`, zip: pkg.zip, sha256: pkg.sha256 };
  });
  const list = buildCatalog(built, { base: 'http://127.0.0.1:4848', version: '1.0.0', appVersion: '1.2.8' });
  assert.deepEqual(list.plugins.map((p) => [p.id, p.url, p.size, p.sha256]),
    built.map((b) => [b.plugin.id, `http://127.0.0.1:4848/${b.file}`, b.zip.length, b.sha256]));
  const inTest = checkCatalog(list, { ...APP, test: true });
  assert.deepEqual(inTest.plugins.map((p) => [p.id, p.problem, p.risk]), PLUGINS.map((p) => [p.id, null, p.risk]));
  // Outside a test, its plain-http links are never used.
  assert.equal(checkCatalog(list, APP).plugins.length, 0);
  assert.equal(buildCatalog(built, { base: 'https://plugins.example/v1/', version: '1.0.0', appVersion: '1.2.8' }).plugins[0].url,
    'https://plugins.example/v1/auto-scan-1.0.0.sgplugin');
});
