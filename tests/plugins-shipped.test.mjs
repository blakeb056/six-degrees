// The plugin cards before anything goes online (Blake, 2026-10-14: "i dont
// want to make it that hard to see the plugins"), and the install that happens
// inside the card that was pressed ("i want the actual box they click on to
// show the bar and etc not pop a box at the bottom").
//
//   - lib/plugins-shipped.js, the copy of the official list the app ships
//     with, says what a build of the packages and the list says (ids,
//     versions, names, words, risks);
//   - a card's Install (lib/plugins-client.js cardInstall) turns plugins on
//     when they're off, fetches the live list, which wins, checks the entry,
//     then downloads and checks the package, and says when it turned plugins
//     on, so Cancel or a failure can turn them back off;
//   - each card's state (settings/PluginBrowse.js cardState): downloading,
//     the yes, installing, an error, in that card and no other;
//   - the setup's and Settings' screens draw it so: no "Allow plugins" box
//     gating the cards, no yes at the bottom for a card.
//
// No server and no internet: stand-in functions answer instead. Invented packages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SHIPPED_PLUGINS, SHIPPED_PLUGIN_VERSION, cardsFrom } from '../lib/plugins-shipped.js';
import { cardInstall, cardState, catalogAction, CATALOG_UNLOADED } from '../lib/plugins-client.js';
import { checkCatalog } from '../lib/plugin-catalog.js';
import { PLUGINS, buildPackage, buildCatalog } from '../scripts/build-plugin.mjs';
import { scannerPresent, noScanner } from './helpers/scanner.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sameEntry = (p) => [p.id, p.name, p.version, p.about, p.risk, p.kind, [...p.unlocks]];

// ── The shipped copy ─────────────────────────────────────────────────────────

test('the shipped copy names both scanners, with what each does, its risk and what it unlocks', () => {
  assert.deepEqual(SHIPPED_PLUGINS.map((p) => [p.id, p.version, [...p.unlocks]]),
    [['auto-scan', SHIPPED_PLUGIN_VERSION, ['auto']], ['manual-scan', SHIPPED_PLUGIN_VERSION, ['manual']]]);
  for (const p of SHIPPED_PLUGINS) {
    assert.ok(p.about && p.risk, p.id);
    assert.equal(p.kind, 'scanner');
    assert.ok(Object.isFrozen(p), 'never changed by a page');
  }
  // The pages read it: nothing from Node.
  assert.doesNotMatch(read('../lib/plugins-shipped.js'), /from 'node:|require\(/);
});

test('it is what a build makes the packages and the list from: the same ids, versions and words', (t) => {
  // scripts/build-plugin.mjs takes them from it, so the two can't drift.
  assert.deepEqual(PLUGINS.map((p) => [p.id, p.name, p.about, p.risk, p.unlocks]),
    SHIPPED_PLUGINS.map((p) => [p.id, p.name, p.about, p.risk, [...p.unlocks]]));
  if (noScanner(t)) return;
  // A list built here, from the scanner's own files, as `npm run build:plugins -- --catalog` writes it.
  const built = PLUGINS.map((plugin) => {
    const zip = buildPackage(plugin, { version: SHIPPED_PLUGIN_VERSION, appVersion: '1.2.8' });
    return { plugin, file: `${plugin.id}-${SHIPPED_PLUGIN_VERSION}.sgplugin`, zip, sha256: 'a'.repeat(64) };
  });
  const list = buildCatalog(built, { base: 'http://127.0.0.1:4848', version: SHIPPED_PLUGIN_VERSION, appVersion: '1.2.8' });
  assert.deepEqual(list.plugins.map(sameEntry), SHIPPED_PLUGINS.map(sameEntry));
});

test('a list already built in dist/plugins says the same ids and versions', (t) => {
  const file = new URL('../dist/plugins/catalog.json', import.meta.url);
  if (!existsSync(file) || !scannerPresent) {
    t.skip('no dist/plugins/catalog.json here (npm run build:plugins -- --catalog <address> writes one)');
    return;
  }
  const list = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(list.plugins.map((p) => [p.id, p.version]), SHIPPED_PLUGINS.map((p) => [p.id, p.version]));
});

test('the cards: the shipped copy until the live list is in, then the live list merged over it, which wins', () => {
  assert.equal(cardsFrom({ status: 'idle' }), SHIPPED_PLUGINS);
  assert.equal(cardsFrom({ status: 'loading' }), SHIPPED_PLUGINS);
  assert.equal(cardsFrom({ status: 'failed', detail: 'offline' }), SHIPPED_PLUGINS);
  assert.equal(cardsFrom(undefined), SHIPPED_PLUGINS);
  const live = [{ ...SHIPPED_PLUGINS[1], version: '1.1.0', host: 'plugins.example' }];
  assert.deepEqual(cardsFrom({ status: 'ready', plugins: live }).map((p) => [p.id, p.version, p.host]), [['manual-scan', '1.1.0', 'plugins.example']]);
  // A shipped card offers what any card does, from what's installed.
  assert.equal(catalogAction(SHIPPED_PLUGINS[0], []), 'install');
  assert.equal(catalogAction(SHIPPED_PLUGINS[0], [{ id: 'auto-scan', version: SHIPPED_PLUGIN_VERSION, state: 'ready' }]), 'installed');
  assert.equal(catalogAction(SHIPPED_PLUGINS[0], [{ id: 'auto-scan', version: '0.9.0', state: 'ready' }]), 'update');
});

// ── A card's Install, up to its yes ──────────────────────────────────────────

const LIVE = { source: { host: 'plugins.example' }, plugins: SHIPPED_PLUGINS.map((p) => ({ ...p, host: 'plugins.example', size: 118000 })), dropped: [] };
const CHECKED = { plugin: { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' }, sha256: 'b'.repeat(64), replaces: null, from: { kind: 'list', host: 'plugins.example' } };

/** Stand-ins for the three calls, writing down what was asked, in order. */
function stand({ list = LIVE, listFails = null, download = CHECKED } = {}) {
  const asked = [];
  return {
    asked,
    api: {
      savePluginsEnabled: async (on) => { asked.push(`enabled:${on}`); return { enabled: on, plugins: [], scanner: null }; },
      fetchCatalog: async () => { asked.push('list'); if (listFails) throw listFails; return list; },
      downloadPlugin: async (from) => { asked.push(`download:${from.id}`); return download; },
    },
  };
}

test('with plugins off, Install turns them on first, then fetches the list, then the package', async () => {
  const { asked, api } = stand();
  const got = await cardInstall(SHIPPED_PLUGINS[1], { enabled: false, api });
  assert.deepEqual(asked, ['enabled:true', 'list', 'download:manual-scan']);
  assert.equal(got.turnedOn, true);
  assert.equal(got.view.enabled, true);
  assert.equal(got.offer, CHECKED);
  assert.equal(got.list, LIVE);
});

test('with plugins on, nothing is switched: the list, then the package', async () => {
  const { asked, api } = stand();
  const got = await cardInstall(SHIPPED_PLUGINS[0], { enabled: true, api });
  assert.deepEqual(asked, ['list', 'download:auto-scan']);
  assert.equal(got.turnedOn, false);
  assert.equal(got.view, null);
});

test('the live list wins: an entry gone from it, or not for this version, installs nothing, and says why', async () => {
  const gone = stand({ list: { ...LIVE, plugins: [LIVE.plugins[0]] } });
  await assert.rejects(cardInstall(SHIPPED_PLUGINS[1], { enabled: false, api: gone.api }), (e) => {
    assert.match(e.message, /Manual scan isn’t on the plugin list now/);
    assert.equal(e.turnedOn, true, 'so the card can turn plugins back off');
    return true;
  });
  assert.deepEqual(gone.asked, ['enabled:true', 'list'], 'nothing downloaded');
  const old = stand({ list: { ...LIVE, plugins: [{ ...LIVE.plugins[1], problem: 'It needs Sixgree 9.0 or later.' }] } });
  await assert.rejects(cardInstall(SHIPPED_PLUGINS[1], { api: old.api }), /It needs Sixgree 9\.0 or later\./);
  assert.ok(!old.asked.some((a) => a.startsWith('download')));
});

test('a list that can\'t be had says so in the card, with why', async () => {
  const failing = Object.assign(new Error(CATALOG_UNLOADED), { data: { detail: 'The connection was refused.' } });
  const { asked, api } = stand({ listFails: failing });
  await assert.rejects(cardInstall(SHIPPED_PLUGINS[0], { enabled: true, api }), (e) => {
    assert.equal(e.message, `${CATALOG_UNLOADED} The connection was refused.`);
    assert.equal(e.turnedOn, false);
    return true;
  });
  assert.deepEqual(asked, ['list']);
});

test('the shipped entries are a list the app accepts as it is', () => {
  const list = { format: 'sixgree.plugin-catalog', format_version: 1, plugins: SHIPPED_PLUGINS.map((p) => ({
    ...p, sixgree: '>=1.2.8', url: `https://plugins.example/${p.id}-${p.version}.sgplugin`, sha256: 'c'.repeat(64), size: 1000,
  })) };
  const checked = checkCatalog(list, { appVersion: '1.2.8' });
  assert.equal(checked.problem, null);
  assert.deepEqual(checked.dropped, []);
  assert.deepEqual(checked.plugins.map((p) => [p.id, p.problem]), [['auto-scan', null], ['manual-scan', null]]);
});

// ── Each card's own state ────────────────────────────────────────────────────

test('a card goes Install, downloading, its yes, installing, then Installed or its error, and only that card', () => {
  const idle = { busy: null, offer: null, note: null };
  assert.deepEqual(cardState(idle, 'manual-scan'), { state: 'idle', error: null });
  assert.equal(cardState({ ...idle, busy: 'get:manual-scan' }, 'manual-scan').state, 'downloading');
  assert.equal(cardState({ ...idle, busy: 'get:manual-scan' }, 'auto-scan').state, 'idle', 'the other card');
  const offer = { at: 'browse', id: 'manual-scan', ...CHECKED };
  assert.equal(cardState({ ...idle, offer }, 'manual-scan').state, 'confirm');
  assert.equal(cardState({ ...idle, offer }, 'auto-scan').state, 'idle');
  assert.equal(cardState({ ...idle, offer, busy: 'install' }, 'manual-scan').state, 'installing');
  // A yes for a link isn't a card's.
  assert.equal(cardState({ ...idle, offer: { ...offer, at: 'link', id: undefined }, busy: 'install' }, 'manual-scan').state, 'idle');
  const failed = { ...idle, note: { at: 'browse', id: 'manual-scan', tone: 'bad', text: 'The download was cut short.' } };
  assert.deepEqual(cardState(failed, 'manual-scan'), { state: 'idle', error: 'The download was cut short.' });
  assert.equal(cardState(failed, 'auto-scan').error, null);
  assert.equal(cardState({ ...idle, note: { at: 'browse', id: 'manual-scan', tone: 'ok', text: 'Installed Manual scan 1.0.0.' } }, 'manual-scan').error, null);
});

test('the screens: every step inside the card, and no yes at the bottom for a card', () => {
  const browse = read('../app/components/settings/PluginBrowse.js');
  const cards = browse.slice(browse.indexOf('export function PluginCards'), browse.indexOf('function CardYes'));
  for (const kind of ['downloading', 'installing']) assert.match(cards, new RegExp(`<WorkBar kind="${kind}"`));
  assert.match(cards, /state === 'confirm' && <CardYes/);
  assert.match(cards, /Installed ✓/);
  assert.match(cards, /data-card-error/);
  const yes = browse.slice(browse.indexOf('function CardYes'), browse.indexOf('export function PluginOffer'));
  assert.match(yes, /PLUGIN_TRUST_LINE/);
  assert.match(yes, /Downloaded from/);
  assert.match(yes, /TURNS_ON_LINE/, 'says Install turns plugins on');
  // Neither screen puts a card's yes anywhere but in the card.
  const settings = read('../app/components/settings/PluginsSection.js');
  const setup = read('../app/components/onboarding/steps.js');
  for (const src of [settings, setup]) assert.doesNotMatch(src, /PluginOfferAt at="browse"/);
  // Settings: Browse whether plugins are on or off.
  assert.match(settings, /\{view && \(\s*<>\s*<h3 style=\{subhead\}>Browse<\/h3>/);
});

test('the setup: the cards in sight under the CSV, titled, with no box to tick first', () => {
  const setup = read('../app/components/onboarding/steps.js');
  const other = setup.slice(setup.indexOf('function OtherWays'), setup.indexOf('// ── Your galaxy is ready'));
  assert.match(other, /Other ways to bring in your network/);
  assert.match(other, /<PluginCards install=\{install\}[^>]*quiet/, 'quiet: the CSV stays the main way in');
  assert.doesNotMatch(other, /type="checkbox"|Allow plugins/);
  assert.match(other, /enabled: view\?\.enabled === true/, 'Install turns plugins on when they are off');
});
