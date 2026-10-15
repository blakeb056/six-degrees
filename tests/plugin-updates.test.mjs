// Plugin updates (Blake, 2026-10-14: "there hasn't been a update button added
// yet for the plugins so make sure that is done"). Two halves:
//
//   - Settings → Plugins: with plugins on, the live plugin list is read when
//     Browse comes into view and on Check for plugin updates, merged over the
//     copy shipped with the app (the live one wins), and an installed plugin
//     older than the list shows Update in its card. Plugins off, and the
//     guided setup, keep the shipped copy with nothing fetched until Install.
//   - The daily update check (lib/update-check.js): with plugins on and one
//     installed, the same turn reads the plugin list and leaves one
//     notification per newer plugin version; none with plugins off, none with
//     the daily check off, none when the list can't be had.
//
// Every list here is served by a server on 127.0.0.1 (tests/helpers/plugins.mjs
// pluginServer, an http.createServer): never the real internet.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePackage, makeCatalog, pluginServer } from './helpers/plugins.mjs';
import { startTestReleaseServer } from '../scripts/test-release-server.mjs';
import { SHIPPED_PLUGINS, cardsFrom } from '../lib/plugins-shipped.js';
import { catalogAction, cardState, countUpdates, checkedLine, updatedTo } from '../lib/plugins-client.js';
import {
  LAST_CHECK_KEY, PLUGIN_NOTE_TYPE, PLUGINS_HREF, UPDATE_NOTE_TYPE,
  pluginNotifiedKey, pluginUpdates, pluginUpdateNotification, openPlugins,
} from '../lib/update-notice.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-plugin-updates-'));
const home = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = home;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

const SLUG = 'blakeb056/six-degrees';
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-10-14T09:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
const SCHEDULER = Symbol.for('six-degrees.update-check');

const auto = (version, more = {}) => makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'], version, ...more } });
const manual = (version) => makePackage({ manifest: { version } });

let getDb, readSettings, writeSettings, GATED_SETTINGS;
let runUpdateCheck, runPluginCheck, settlePluginNotes, checkForUpdateNow, startUpdateChecks;
let installPlugin, listPlugins, readCatalog;
let server, releases;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings, GATED_SETTINGS } = await import('../lib/settings.js'));
  ({ runUpdateCheck, runPluginCheck, settlePluginNotes, checkForUpdateNow, startUpdateChecks } = await import('../lib/update-check.js'));
  ({ installPlugin, listPlugins } = await import('../lib/plugins.js'));
  ({ readCatalog } = await import('../lib/plugin-catalog.js'));
  server = await pluginServer();
  releases = await startTestReleaseServer({ slug: SLUG, release: { version: '2.0.0', assets: [] } });
});

after(async () => {
  await server.close();
  await releases.close();
  rmSync(dir, { recursive: true, force: true });
});

const LIST_ENV = () => ({ SIX_DEGREES_PLUGIN_CATALOG: `${server.base}/catalog.json` });

/** Serve a plugin list naming these packages. */
function publish(...pkgs) {
  server.routes['/catalog.json'] = {
    body: JSON.stringify(makeCatalog(pkgs.map((pkg) => ({ pkg, url: `${server.base}/${pkg.manifest.id}-${pkg.manifest.version}.sgplugin` })))),
    headers: { 'content-type': 'application/json' },
  };
}
const install = (pkg) => installPlugin(home, pkg.zip, { sha256: pkg.sha256 });
const pluginsOn = (on) => writeSettings(getDb(), { pluginsEnabled: on }, GATED_SETTINGS);
const listAsks = () => server.requests.filter((r) => r.path === '/catalog.json').length;
const notes = (type = PLUGIN_NOTE_TYPE) => getDb().prepare('SELECT * FROM notifications WHERE type = ? ORDER BY created_at').all(type);
const meta = (key) => getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value ?? null;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM app_meta WHERE key = 'settings' OR key LIKE 'update_%' OR key LIKE 'plugin_update_%'");
  db.exec('DELETE FROM notifications');
  rmSync(path.join(home, 'plugins'), { recursive: true, force: true });
  server.requests.length = 0;
  releases.requests.length = 0;
  delete server.routes['/catalog.json'];
  delete globalThis[SCHEDULER];
});

/** GitHub's answer for the app: this version, so only the plugins have news. */
const appSame = async () => ({ version: '2.0.0', url: null, release: { tag_name: 'v2.0.0' } });

/** One turn of the daily check, as the real one wires the plugins (checkForUpdateNow). */
const turn = (now = T0, more = {}) => runUpdateCheck({
  db: getDb(), now, currentVersion: '2.0.0', kind: 'mac-app', userId: 'me', fetchLatest: appSame,
  plugins: { installed: () => listPlugins(home), fetchList: () => readCatalog({ env: LIST_ENV() }) },
  ...more,
});

// ── Settings → Plugins: the cards ──────────────────────────────────────────────

test('the cards: the live list merged over the shipped copy, entry by entry, and the live one wins', () => {
  assert.equal(cardsFrom({ status: 'idle' }), SHIPPED_PLUGINS, 'nothing fetched: the shipped copy');
  const live = [
    { id: 'auto-scan', name: 'Auto scan', version: '9.0.0', about: 'Newer words.', risk: null, host: 'plugins.example', size: 1, problem: null },
    { id: 'manual-scan', name: 'Manual scan', version: '9.0.0', about: 'Newer words too.', risk: 'A newer risk.', host: 'plugins.example', size: 1, problem: null },
  ];
  const cards = cardsFrom({ status: 'ready', plugins: live });
  assert.deepEqual(cards.map((c) => [c.id, c.version, c.about, c.host]), live.map((l) => [l.id, l.version, l.about, l.host]));
  assert.equal(cards[0].risk, null, 'the live list says no risk line: it wins over the shipped one');
  assert.deepEqual(cards[0].unlocks, ['auto'], 'what the live entry leaves out comes from the shipped copy');
  assert.equal(cards[0].shipped, false);
  // An entry gone from the live list is gone from the cards: nothing to install.
  assert.deepEqual(cardsFrom({ status: 'ready', plugins: [live[1]] }).map((c) => c.id), ['manual-scan']);
  // One the shipped copy doesn't know shows as the list has it.
  const other = { id: 'other-scan', name: 'Other', version: '1.0.0', about: 'x', host: 'h', size: 1, problem: null };
  assert.deepEqual(cardsFrom({ status: 'ready', plugins: [other] }), [other]);
  // Asked again, or failed after a list that worked: the last list stays, not the shipped copy.
  assert.equal(cardsFrom({ status: 'loading', plugins: live })[0].version, '9.0.0');
  assert.equal(cardsFrom({ status: 'failed', detail: 'offline', plugins: live })[0].version, '9.0.0');
  assert.equal(cardsFrom({ status: 'failed', detail: 'offline' }), SHIPPED_PLUGINS, 'never had one: the shipped copy');
});

test('an installed plugin older than the list shows Update; the same or newer shows Installed', () => {
  // Versions above whatever ships in the app, so the test holds as the shipped copy moves on.
  const live = SHIPPED_PLUGINS.map((p) => ({ ...p, version: '90.0.2', host: '127.0.0.1:4848', size: 1, problem: null }));
  const cards = cardsFrom({ status: 'ready', plugins: live });
  const installed = [
    { id: 'auto-scan', version: '90.0.1', state: 'ready' },
    { id: 'manual-scan', version: '90.0.2', state: 'ready' },
  ];
  // The LinkedIn browser isn't installed here: Install.
  assert.deepEqual(cards.map((c) => catalogAction(c, installed)), ['update', 'installed', 'install']);
  assert.equal(countUpdates(cards, installed), 1);
  // Before the live list, the shipped copy (older than both) shows no update.
  assert.equal(countUpdates(cardsFrom({ status: 'idle' }), installed), 0);
  // Not for this Sixgree, or broken here: not an update.
  assert.equal(catalogAction({ ...live[0], problem: 'It is for a later Sixgree.' }, installed), null);
  assert.equal(catalogAction(live[0], [{ id: 'auto-scan', version: '1.0.0', state: 'broken' }]), 'reinstall');
});

test('Check for plugin updates says when, and how many: all up to date, 1 update, N updates', () => {
  const t = Date.parse('2026-10-14T22:00:00Z');
  assert.equal(checkedLine(t, 0, t), 'Checked just now; all up to date');
  assert.equal(checkedLine(t, 1, t + 30 * 1000), 'Checked just now; 1 update');
  assert.equal(checkedLine(t, 2, t + 60 * 1000), 'Checked 1 minute ago; 2 updates');
  assert.equal(checkedLine(t, 0, t + 5 * 60 * 1000), 'Checked 5 minutes ago; all up to date');
  assert.match(checkedLine(t, 0, t + 2 * HOUR), /^Checked at .+; all up to date$/);
  assert.equal(checkedLine(t + 5000, 0, t), 'Checked just now; all up to date', 'a clock a little behind is just now');
});

test('the card after an Update says "Updated to 1.0.2 ✓"; a first install still says Installed', () => {
  assert.equal(updatedTo({ installed: { version: '1.0.2' }, replaced: { version: '1.0.1' } }), '1.0.2');
  assert.equal(updatedTo({ installed: { version: '1.0.1' }, replaced: null }), null, 'a first install');
  assert.equal(updatedTo({ installed: { version: '1.0.1' }, replaced: { version: '1.0.1' } }), null, 'the same version put back');
  assert.equal(updatedTo({ installed: { version: '1.0.0' }, replaced: { version: '1.0.1' } }), null, 'an older one');
  const idle = { busy: null, offer: null };
  const done = { ...idle, note: { at: 'browse', id: 'auto-scan', tone: 'ok', text: 'Installed Auto scan 1.0.2, in place of 1.0.1.', updated: '1.0.2' } };
  assert.deepEqual(cardState(done, 'auto-scan'), { state: 'idle', error: null, done: 'Updated to 1.0.2 ✓' });
  assert.deepEqual(cardState(done, 'manual-scan'), { state: 'idle', error: null }, 'only that card');
  const first = { ...idle, note: { ...done.note, updated: null } };
  assert.deepEqual(cardState(first, 'auto-scan'), { state: 'idle', error: null });
});

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the card: Update asks from which version to which, with the risk and the runs-its-own-code line', () => {
  const browse = read('app/components/settings/PluginBrowse.js');
  const yes = browse.slice(browse.indexOf('function CardYes'), browse.indexOf('export function PluginOffer'));
  assert.match(yes, /`Update \$\{plugin\.name\} from \$\{replaces\.version\} to \$\{plugin\.version\}\?`/);
  assert.match(yes, /\{update \? 'Update' : 'Install'\}/, 'its button says Update');
  assert.match(yes, /PLUGIN_TRUST_LINE/);
  const cards = browse.slice(browse.indexOf('export function PluginCards'), browse.indexOf('function CardYes'));
  assert.match(cards, /shown\.risk && \(/, 'the risk line stays in the card above the yes');
  assert.match(cards, /\{done \|\| 'Installed ✓'\}/);
  assert.match(cards, /isUpdate\(offer\) \? 'Updating' : 'Installing'/);
  assert.match(browse, /updated: updatedTo\(done\)/);
});

test('the list is fetched only with plugins on, and only on view or Check (or a plugin notification opened here)', () => {
  const settings = read('app/components/settings/PluginsSection.js');
  // Every call that fetches the list: the observer's first sight, the button, the notification's event.
  const calls = settings.match(/\bload\(\)/g) || [];
  assert.equal(calls.length, 3, 'load() is called in exactly three places');
  const seen = settings.slice(settings.indexOf('const el = browseRef.current'), settings.indexOf('watch.observe(el)'));
  assert.match(seen, /if \(!on \|\| asked\.current \|\| !el\) return undefined;/, 'on view: only with plugins on, once');
  assert.match(seen, /IntersectionObserver/);
  const again = settings.slice(settings.indexOf('const again = () =>'), settings.indexOf('window.addEventListener(CHECK_PLUGINS_EVENT'));
  assert.match(again, /if \(!on\) return;\s*asked\.current = true;\s*load\(\);/, 'the event: only with plugins on');
  // The button is there only with plugins on.
  const button = settings.slice(settings.indexOf('data-plugin-updates'), settings.indexOf('<PluginCards install={install}'));
  assert.match(button, /Check for plugin updates/);
  assert.match(settings.slice(settings.lastIndexOf('{on && (', settings.indexOf('data-plugin-updates')), settings.indexOf('data-plugin-updates')), /^\{on && \(\s*<div $/);
  assert.match(button, /checkedLine\(checkedAt, countUpdates\(cardsFrom\(install\.catalog\), plugins\), now\)/);
  // And the route itself refuses while plugins are off (tests/plugin-catalog-routes.test.mjs).
  assert.match(read('app/api/plugins/catalog/route.js'), /if \(!pluginsEnabled\(\)\)/);
});

test('the guided setup keeps the shipped copy: nothing fetched there until Install', () => {
  const setup = read('app/components/onboarding/steps.js');
  const other = setup.slice(setup.indexOf('function OtherWays'), setup.indexOf('// ── Your galaxy is ready'));
  assert.doesNotMatch(other, /\.load\b|\bload\(|fetchCatalog/, 'no read of the list on sight');
  assert.match(other, /<PluginCards install=\{install\}/);
});

// ── The daily check: plugins ──────────────────────────────────────────────────

test('a newer plugin version leaves one notification, once per version, that opens Settings → Plugins', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  install(manual('1.0.1'));
  publish(auto('1.0.2'), manual('1.0.1'));

  const first = await turn(T0);
  assert.equal(first.ran, true);
  assert.equal(first.newer, false, 'the app itself is up to date');
  assert.deepEqual(first.plugins.notified, ['auto-scan']);
  assert.deepEqual(first.plugins.updates, [{ id: 'auto-scan', name: 'Auto scan', version: '1.0.2', installed: '1.0.1' }]);
  assert.equal(listAsks(), 1, 'one GET of the list');
  const [note] = notes();
  assert.equal(note.title, 'Auto scan 1.0.2 is out');
  assert.equal(note.message, 'Update it in Settings → Plugins.');
  assert.equal(note.user_id, 'me');
  assert.equal(note.seen, 0);
  assert.deepEqual(JSON.parse(note.data), { plugin: 'auto-scan', version: '1.0.2' });
  assert.equal(meta(pluginNotifiedKey('auto-scan')), '1.0.2');
  assert.equal(notes(UPDATE_NOTE_TYPE).length, 0, 'no app notification');

  // Within the day: nothing asked. The next days, the same version: still one.
  assert.equal((await turn(at(2 * HOUR))).reason, 'not-due');
  assert.equal(listAsks(), 1);
  assert.deepEqual((await turn(at(24 * HOUR))).plugins.notified, []);
  assert.deepEqual((await turn(at(48 * HOUR))).plugins.notified, []);
  assert.equal(notes().length, 1);

  // A later version, and the other plugin's: one more each.
  publish(auto('1.0.3'), manual('1.0.2'));
  assert.deepEqual((await turn(at(72 * HOUR))).plugins.notified.sort(), ['auto-scan', 'manual-scan']);
  assert.deepEqual(notes().map((n) => n.title).sort(), ['Auto scan 1.0.2 is out', 'Auto scan 1.0.3 is out', 'Manual scan 1.0.2 is out']);
  // An older one coming back (taken down): nothing.
  publish(auto('1.0.2'), manual('1.0.2'));
  assert.deepEqual((await turn(at(96 * HOUR))).plugins.notified, []);
  assert.equal(notes().length, 3);
});

test('plugins off: the list is never asked for, and no plugin notification', async () => {
  install(auto('1.0.1'));
  publish(auto('1.0.2'));
  assert.equal(readSettings(getDb(), GATED_SETTINGS).pluginsEnabled, false, 'off until turned on');
  const r = await turn(T0);
  assert.equal(r.ran, true, 'the app check still ran');
  assert.deepEqual(r.plugins, { ran: false, reason: 'plugins-off' });
  assert.equal(listAsks(), 0);
  assert.equal(notes().length, 0);
});

test('no plugin installed: the list is never asked for', async () => {
  pluginsOn(true);
  publish(auto('1.0.2'));
  const r = await turn(T0);
  assert.deepEqual(r.plugins, { ran: false, reason: 'none-installed' });
  assert.equal(listAsks(), 0);
});

test('the daily check turned off: neither the app nor the plugin list is asked', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  publish(auto('1.0.2'));
  writeSettings(getDb(), { updateCheck: false });
  let asked = 0;
  const r = await turn(T0, { fetchLatest: async () => { asked += 1; return null; } });
  assert.deepEqual(r, { ran: false, reason: 'off' });
  assert.equal(asked, 0);
  assert.equal(listAsks(), 0);
  assert.equal(notes().length, 0);
  assert.equal(meta(LAST_CHECK_KEY), null);
});

test('a list that can\'t be had is quiet: no notification, and the next try is a day later', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  for (const [i, route] of [
    { status: 500, body: 'oops' },
    { status: 200, body: 'not json', headers: { 'content-type': 'application/json' } },
    { status: 200, body: JSON.stringify({ format: 'something else' }) },
  ].entries()) {
    server.routes['/catalog.json'] = route;
    const r = await turn(at(i * 24 * HOUR));
    assert.equal(r.ran, true);
    assert.equal(typeof r.plugins.error, 'string', JSON.stringify(r.plugins));
    assert.equal(r.plugins.ran, true);
  }
  assert.equal(notes().length, 0);
  // Nothing listening at all.
  const gone = await turn(at(3 * 24 * HOUR), {
    plugins: { installed: () => listPlugins(home), fetchList: () => readCatalog({ env: { SIX_DEGREES_PLUGIN_CATALOG: 'http://127.0.0.1:9/catalog.json' } }) },
  });
  assert.match(gone.plugins.error, /couldn’t be reached|didn’t answer/);
  assert.equal(notes().length, 0);
  // The app's own failure doesn't stop the plugins' part, and the reverse.
  publish(auto('1.0.2'));
  const both = await turn(at(4 * 24 * HOUR), { fetchLatest: async () => { throw new Error('GitHub answered 403'); } });
  assert.equal(both.error, 'GitHub answered 403');
  assert.deepEqual(both.plugins.notified, ['auto-scan']);
});

test('up to date, or a newer version not for this Sixgree: nothing to say', async () => {
  pluginsOn(true);
  install(auto('1.0.2'));
  publish(auto('1.0.2'));
  assert.deepEqual((await turn(T0)).plugins.updates, []);
  publish(auto('1.0.3', { sixgree: '>=99.0.0' }));
  assert.deepEqual((await turn(at(24 * HOUR))).plugins.updates, []);
  assert.equal(notes().length, 0);
});

test('a plugin\'s notification is read once that version is installed, or the plugin is gone', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  install(manual('1.0.1'));
  publish(auto('1.0.2'), manual('1.0.2'));
  await turn(T0);
  assert.equal(notes().filter((n) => !n.seen).length, 2);
  // Auto scan updated, Manual scan still old: only Auto scan's is read.
  assert.equal(settlePluginNotes(getDb(), [{ id: 'auto-scan', version: '1.0.2' }, { id: 'manual-scan', version: '1.0.1' }]), 1);
  assert.deepEqual(notes().map((n) => [JSON.parse(n.data).plugin, n.seen]).sort(), [['auto-scan', 1], ['manual-scan', 0]]);
  // Manual scan uninstalled: nothing left to say.
  assert.equal(settlePluginNotes(getDb(), [{ id: 'auto-scan', version: '1.0.2' }]), 1);
  assert.ok(notes().every((n) => n.seen === 1));
  // The routes that change what's installed settle them.
  for (const route of ['download', 'install', 'uninstall']) {
    assert.match(read(`app/api/plugins/${route}/route.js`), /settlePluginNotesNow\(\);/, route);
  }
});

test('runPluginCheck on its own: plugins off or nothing installed asks nothing', async () => {
  let asked = 0;
  const fetchList = async () => { asked += 1; return { plugins: [] }; };
  assert.deepEqual(await runPluginCheck({ db: getDb(), installed: () => [{ id: 'auto-scan', version: '1.0.0' }], fetchList }), { ran: false, reason: 'plugins-off' });
  pluginsOn(true);
  assert.deepEqual(await runPluginCheck({ db: getDb(), installed: () => [], fetchList }), { ran: false, reason: 'none-installed' });
  const broken = await runPluginCheck({ db: getDb(), installed: () => { throw new Error('unreadable'); }, fetchList });
  assert.equal(broken.ran, false);
  assert.equal(asked, 0);
});

test('the real turn asks the test servers it is given, for the app and the plugin list, never GitHub', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  publish(auto('1.0.2'));
  // One release above this copy's version, whatever it is, so the test holds through every release.
  const [maj, min, pat] = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version.split('.').map(Number);
  const newer = `${maj}.${min}.${pat + 1}`;
  releases.setRelease({ version: newer, assets: [] });
  const r = await checkForUpdateNow({ env: { SIX_DEGREES_TEST_RELEASES: releases.origin, ...LIST_ENV() }, now: T0 });
  assert.equal(r.notified, true, `the app: ${newer}`);
  assert.deepEqual(r.plugins.notified, ['auto-scan']);
  assert.deepEqual(releases.requests, [`GET /repos/${SLUG}/releases/latest`]);
  assert.deepEqual(server.requests.map((q) => q.path), ['/catalog.json'], 'one GET of the list, no package');
  assert.match(server.requests[0].headers['user-agent'], /^Sixgree\//);
  assert.equal(server.requests[0].headers.cookie, undefined);
});

test('suppressed with the app check: in tests, in a git checkout, and with SIX_DEGREES_NO_UPDATE_CHECK=1', async () => {
  pluginsOn(true);
  install(auto('1.0.1'));
  publish(auto('1.0.2'));
  const env = { SIX_DEGREES_TEST_RELEASES: releases.origin, ...LIST_ENV() };
  for (const [more, why] of [
    [{ env: { ...env, SIX_DEGREES_NO_UPDATE_CHECK: '1' }, gitCheckout: () => false }, /SIX_DEGREES_NO_UPDATE_CHECK/],
    [{ env, gitCheckout: () => true }, /git/],
    [{}, /node --test/],
  ]) {
    const started = startUpdateChecks(more);
    assert.match(started.off, why);
    assert.equal(started.tick, undefined, 'no timer');
    delete globalThis[SCHEDULER];
  }
  assert.equal(listAsks(), 0);
  // As an installed copy outside a test: its tick reads the list too.
  const started = startUpdateChecks({ env, gitCheckout: () => false });
  try {
    const r = await started.tick();
    assert.deepEqual(r.plugins.notified, ['auto-scan']);
    assert.equal(listAsks(), 1);
  } finally {
    started.stop();
  }
});

// ── The bell ───────────────────────────────────────────────────────────────────

test('the notification opens Settings → Plugins from the bell', () => {
  const note = pluginUpdateNotification({ id: 'auto-scan', name: 'Auto scan', version: '1.0.1', userId: 'me' });
  assert.equal(note.type, PLUGIN_NOTE_TYPE);
  assert.equal(note.title, 'Auto scan 1.0.1 is out');
  assert.doesNotMatch(JSON.stringify(note), /linkedin/i);
  const pushed = [];
  openPlugins({ push: (href) => pushed.push(href) });
  assert.deepEqual(pushed, [PLUGINS_HREF]);
  assert.equal(PLUGINS_HREF, '/settings#plugins');
  const header = read('app/components/AppHeader.js');
  assert.match(header, /else if \(n\.type === PLUGIN_NOTE_TYPE\) openPlugins\(router\);/);
  assert.match(read('app/components/settings/PluginsSection.js'), /window\.addEventListener\(CHECK_PLUGINS_EVENT, again\)/);
  // What counts as newer is the cards' own rule.
  assert.deepEqual(pluginUpdates([{ id: 'auto-scan', name: 'Auto scan', version: '1.0.1', problem: null }], [{ id: 'auto-scan', version: '1.0.0', state: 'ready' }]),
    [{ id: 'auto-scan', name: 'Auto scan', version: '1.0.1', installed: '1.0.0' }]);
});

// ── What the pages say ─────────────────────────────────────────────────────────

const text = (rel) => read(rel).replace(/\s+/g, ' ');

test('each place that describes the daily check says it reads the plugin list when plugins are on', () => {
  for (const f of ['README.md', 'SECURITY.md', 'docs/SIX-DEGREES-SPEC.md', 'site/index.html', 'site/_pages/docs.html',
    'site/_pages/download.html', 'site/_posts/local-first.md', 'app/components/UpdatePanel.js', 'docs/PLUGINS.md']) {
    const t = text(f);
    assert.ok(/plugin list/i.test(t), `${f}: names the plugin list`);
    assert.ok(/with plugins on|plugins are on/i.test(t), `${f}: only with plugins on`);
  }
  // The home page's FAQ says it twice: its structured data and the page.
  assert.equal((text('site/index.html').match(/newest version number \(and, with plugins on, the plugin list\)/g) || []).length, 2);
  assert.match(text('app/components/UpdatePanel.js'), /With plugins on, it reads the plugin list then too/);
});

test('the changelog: a Fixed line for the Update button, and plugins in the update notice', () => {
  const log = read('CHANGELOG.md');
  // Released in 2.1.0: read that version's section, whatever is unreleased above it.
  const unreleased = log.slice(log.indexOf('## [2.1.0]'), log.indexOf('## [2.0.0]'));
  const fixed = unreleased.slice(unreleased.indexOf('### Fixed'));
  assert.ok(unreleased.includes('### Fixed'), 'a Fixed section');
  assert.match(fixed, /A newer plugin shows its Update button/);
  assert.match(fixed, /Check for plugin updates/);
  const start = unreleased.indexOf('**Sixgree tells you when there\'s a new version.**');
  const added = unreleased.slice(start, unreleased.indexOf('### Changed', start));
  assert.match(added.replace(/\s+/g, ' '), /With plugins on and one installed, the same daily check also reads the plugin list/);
});
