// How circle scans run, as one choice (Blake, 2026-10-14: "make sure that the
// user cant auto scan and do manual mode and making that option more
// apparent"): Automatic or By hand, never both, the plugins deciding what's
// there (lib/scanner-capabilities.js modeChoices); By hand, Auto scan is
// neither offered (the header, the Scan page) nor allowed (the route). And
// Settings opens on Plugins ("i want the plugins to be at the very top").
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python, and SIX_DEGREES_ROOT a folder whose
// scrape.py stops at once if a real Python ever runs it. Nothing opens a
// browser or reaches any website. A temporary data folder, never the real one.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  circleMode, modeChoices, modeSetting, capabilities, SCANNER_NONE, SCANNER_BUILT_IN,
  INSTALL_AUTO, INSTALL_MANUAL, AUTO_NEEDS_AUTOMATIC,
} from '../lib/scanner-capabilities.js';
import { standInRoot } from './helpers/scanner.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const AUTO = capabilities({ auto: true, from: 'plugin' });
const MANUAL = capabilities({ manual: true, from: 'plugin' });
const BOTH = capabilities({ auto: true, manual: true, from: 'plugin' });

// ── The choice ───────────────────────────────────────────────────────────────

test('never both: with any scanner exactly one way is chosen, and with none, neither', () => {
  for (const caps of [AUTO, MANUAL, BOTH, SCANNER_BUILT_IN, null]) {
    for (const saved of [true, false, undefined]) {
      const m = modeChoices(caps, saved);
      assert.equal([m.auto.selected, m.manual.selected].filter(Boolean).length, 1, `${JSON.stringify(caps)} ${saved}`);
      assert.equal(m.autoScan, m.mode === 'auto', 'Auto scan only with Automatic');
      assert.ok(m.mode === 'auto' || m.mode === 'manual');
    }
  }
  const none = modeChoices(SCANNER_NONE, true);
  assert.deepEqual([none.mode, none.auto.selected, none.manual.selected, none.autoScan], [null, false, false, false]);
  // Choosing one saves manual mode on or off: the one switch the scanner reads.
  assert.deepEqual(modeSetting('manual'), { manual: true });
  assert.deepEqual(modeSetting('auto'), { manual: false });
});

test('the plugins decide: one installed is chosen and locked, the other says which plugin to install', () => {
  const onlyAuto = modeChoices(AUTO, true);
  assert.equal(onlyAuto.mode, 'auto', 'a saved By hand means nothing without Manual scan');
  assert.deepEqual(onlyAuto.auto, { available: true, selected: true, locked: true, needs: null });
  assert.deepEqual(onlyAuto.manual, { available: false, selected: false, locked: false, needs: INSTALL_MANUAL });
  const onlyManual = modeChoices(MANUAL, false);
  assert.equal(onlyManual.mode, 'manual');
  assert.deepEqual(onlyManual.manual, { available: true, selected: true, locked: true, needs: null });
  assert.deepEqual(onlyManual.auto, { available: false, selected: false, locked: false, needs: INSTALL_AUTO });
  assert.equal(onlyManual.autoScan, false);
  // Both: the saved choice, and neither locked.
  for (const [saved, mode] of [[true, 'manual'], [false, 'auto']]) {
    const both = modeChoices(BOTH, saved);
    assert.equal(both.mode, mode);
    assert.equal(both.auto.locked || both.manual.locked, false);
    assert.equal(both.auto.needs ?? both.manual.needs, null);
  }
  assert.equal(circleMode(BOTH, true), 'manual');
  assert.equal(circleMode(SCANNER_BUILT_IN), 'auto');
  assert.equal(circleMode(SCANNER_NONE), null);
});

test('the Scan page asks it as two cards first, and By hand puts Auto scan away', () => {
  const page = read('../app/setup/page.js');
  const settings = page.indexOf('id="scan-settings"');
  const choice = page.indexOf('<Group title="How circle scans run"', settings);
  assert.ok(choice > settings && choice < page.indexOf('<Group title="Speed"', settings), 'first in Scanner settings');
  assert.match(page, /<ModeCards choices=\{modes\} disabled=\{running \|\| busy\} onPick=\{\(mode\) => run\('set-limits', modeSetting\(mode\)\)\} \/>/);
  assert.match(page, /const MODE_OPTIONS = \[\s*\{ key: 'auto', title: 'Automatic'/);
  assert.match(page, /\{ key: 'manual', title: 'By hand'/);
  assert.match(page, /role="radiogroup" aria-label="How circle scans run"/);
  // A choice without its plugin links to Settings → Plugins.
  assert.match(page, /<Link href="\/settings#plugins" data-mode-needs=""/);
  // The old switch is gone.
  assert.doesNotMatch(page, /title="Manual mode for circle scans"/);
  // By hand: no Auto scan switch, a line in its place.
  const sw = page.slice(page.indexOf('data-auto-scan-switch'), page.indexOf('data-auto-scan-switch') + 1600);
  assert.match(sw, /modes\.autoScan \? \(/);
  assert.match(sw, /<SettingTitle title="Auto scan" line=\{AUTO_NEEDS_AUTOMATIC\} \/>/);
  assert.equal(AUTO_NEEDS_AUTOMATIC, 'Auto scan needs Automatic.');
  // Calmer groups, plain headings, Dev mode marked advanced with its ceiling.
  for (const title of ['How circle scans run', 'Speed', 'What it reads', 'Safety']) assert.match(page, new RegExp(`<Group title="${title}"`));
  const dev = page.slice(page.indexOf('data-dev-mode-switch'), page.indexOf('more={', page.indexOf('data-dev-mode-switch')));
  assert.match(dev, /tag="Advanced · your account, your risk"/);
  // The header offers Auto scan only with Automatic.
  const header = read('../app/components/AppHeader.js');
  assert.match(header, /const autoScan = auto && mode !== 'manual';/);
  assert.match(header, /after=\{own && autoScan \? <AutoScanButton/);
});

test('Settings opens on Plugins: first in the notch\'s sections and first on the page', () => {
  const page = read('../app/settings/page.js');
  assert.match(page, /const SECTIONS = \[\s*\['plugins', 'Plugins'\],/);
  const plugins = page.indexOf('<PluginsSection />');
  assert.ok(plugins > 0 && plugins < page.indexOf('<UpdatePanel />'), 'above Updates, at the very top');
  assert.equal(page.split('<PluginsSection />').length, 2, 'once');
});

// ── The route: By hand, Auto scan can't start ────────────────────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-circle-mode-'));
const HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
mkdirSync(HOME);
standInRoot(path.join(dir, 'root'));
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, writeLimits;
before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ writeLimits } = await import('../lib/linkedin-limits.js'));
  const { getDb } = await import('../lib/db-client.js');
  const { writeSettings } = await import('../lib/settings.js');
  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});
const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();

test('By hand, the server refuses Auto scan, and every page is told which way circle scans run', async () => {
  // The built-in scanner here (a checkout's stand-in), so both ways are there.
  writeLimits(HOME, { manual: true });
  assert.equal((await job()).mode, 'manual');
  const res = await post({ action: 'auto-start', pace: 'fast', tiers: ['S'] });
  assert.equal(res.status, 409);
  const d = await res.json();
  assert.equal(d.manualMode, true);
  assert.match(d.error, /Auto scan can’t start/);
  assert.equal((await job()).auto.on, false);
  // Choosing Automatic (what the Scan page's card saves) lets it be offered again.
  const set = await post({ action: 'set-limits', ...modeSetting('auto') });
  assert.equal(set.status, 200);
  assert.equal((await job()).mode, 'auto');
});
