// What the installed scanner unlocks (lib/scanner-capabilities.js): the scan
// screens show only with a scanner, the Auto scan plugin unlocks the automatic
// features and Dev mode, the Manual scan plugin unlocks manual mode and its
// chimes, and with only the manual one every circle scan is a manual one.
//
// Checked three ways: the rules on their own; which plugins unlock what
// (lib/scanner-files.js scannerCapabilities) in every state; and the route
// (app/api/scraper), which carries it in the job answer, refuses what isn't
// installed and sets manual mode in scan-limits.json before the scanner reads
// it. The UI's conditions are scanShows, so they're checked here without a
// browser, and the job answer that carries them through the page's own client.
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python and writes down what each run was
// started with. Nothing opens a browser or reaches any website. On a temporary
// data folder, never the real one. Invented packages and people.

import { test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standInRoot } from './helpers/scanner.mjs';
import { makePackage } from './helpers/plugins.mjs';
import {
  capabilities, cleanCapabilities, capabilityRefusal, lockedModes, settingRefusal, scanShows,
  SCANNER_NONE, SCANNER_BUILT_IN, AUTO_ACTIONS, AUTO_NEEDED, DEV_NEEDS_AUTO, MANUAL_NEEDED, MANUAL_ALWAYS,
} from '../lib/scanner-capabilities.js';
import { scannerCapabilities, SCANNER_MISSING } from '../lib/scanner-files.js';
import { installPlugin } from '../lib/plugins.js';
import { readLimits, writeLimits, applyLockedModes } from '../lib/linkedin-limits.js';

register('./helpers/extensionless.mjs', import.meta.url);

const APP = { appVersion: '1.2.8' };
const AUTO_PKG = { manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } };
const MANUAL_PKG = {};   // tests/helpers/plugins.mjs: manual-scan, unlocking ["manual"]
const ONLY_AUTO = capabilities({ auto: true, manual: false, from: 'plugin' });
const ONLY_MANUAL = capabilities({ auto: false, manual: true, from: 'plugin' });
const BOTH = capabilities({ auto: true, manual: true, from: 'plugin' });

// ── The rules on their own ────────────────────────────────────────────────────

test('capabilities: one object per answer, and nothing unlocked is none', () => {
  assert.equal(capabilities({ auto: true, manual: true, from: 'built-in' }), SCANNER_BUILT_IN);
  assert.equal(capabilities({ auto: false, manual: true, from: 'plugin' }), ONLY_MANUAL, 'the same object, so a page compares it by itself');
  assert.deepEqual(ONLY_MANUAL, { auto: false, manual: true, from: 'plugin' });
  assert.equal(capabilities({ auto: false, manual: false, from: 'plugin' }), SCANNER_NONE);
  assert.equal(capabilities(), SCANNER_NONE);
  assert.ok(Object.isFrozen(ONLY_AUTO));
});

test('the server’s answer is kept to its shape; anything else is “not known”, which shows everything', () => {
  assert.equal(cleanCapabilities({ auto: true, manual: false, from: 'plugin' }), ONLY_AUTO);
  for (const raw of [null, undefined, 'auto', {}, { auto: 'yes', manual: true }, { auto: true }]) {
    assert.equal(cleanCapabilities(raw), null, JSON.stringify(raw));
  }
  assert.equal(cleanCapabilities({ auto: false, manual: false, from: 'nowhere' }), SCANNER_NONE);
  assert.deepEqual(scanShows(null), scanShows(SCANNER_BUILT_IN), 'not known yet, or a server from before plugins: as it always was');
});

test('what the pages show in each state', () => {
  const show = (c) => ({ ...scanShows(c) });
  assert.deepEqual(show(SCANNER_BUILT_IN), { scan: true, auto: true, manual: true, manualLocked: false, chimes: true }, 'built in: everything, as today');
  assert.deepEqual(show(BOTH), { scan: true, auto: true, manual: true, manualLocked: false, chimes: true }, 'both plugins: everything');
  assert.deepEqual(show(ONLY_MANUAL), { scan: true, auto: false, manual: true, manualLocked: true, chimes: true },
    'manual only: Scan, the switch on and locked, Sound; no Auto scan, Auto connect, Check for new, company scans, message sync or Dev mode');
  assert.deepEqual(show(ONLY_AUTO), { scan: true, auto: true, manual: false, manualLocked: false, chimes: false },
    'auto only: no manual-mode switch, no Sound');
  assert.deepEqual(show(SCANNER_NONE), { scan: false, auto: false, manual: false, manualLocked: false, chimes: false },
    'none: no Scan tab, no Auto scan, no Check for new, nothing that offers a scan');
  assert.equal(scanShows(ONLY_MANUAL), scanShows(ONLY_MANUAL), 'the same object each time');
});

test('what only the auto plugin does is refused without it, and nothing else is', () => {
  for (const action of AUTO_ACTIONS) {
    assert.equal(capabilityRefusal(ONLY_MANUAL, action), AUTO_NEEDED, action);
    assert.equal(capabilityRefusal(SCANNER_NONE, action), AUTO_NEEDED, action);
    for (const c of [ONLY_AUTO, BOTH, SCANNER_BUILT_IN, null]) assert.equal(capabilityRefusal(c, action), null, action);
  }
  // Circle scans, one person or a round, and what any scanner does.
  for (const action of ['bridge', 'rescrape', 'resume', 'resume-all', 'auto-bridge', 'auto-bridge-retry', 'login', 'install', 'setup', 'photos']) {
    assert.equal(capabilityRefusal(ONLY_MANUAL, action), null, action);
    assert.equal(capabilityRefusal(ONLY_AUTO, action), null, action);
  }
  assert.deepEqual([...AUTO_ACTIONS].sort(),
    ['auto-start', 'company', 'connect', 'full', 'messages', 'messages-full', 'read-profiles', 'refresh']);
});

test('the settings the plugins decide, and the changes refused', () => {
  assert.deepEqual(lockedModes(ONLY_MANUAL), { manual: true, dev: false }, 'manual only: always manual, no Dev mode');
  assert.deepEqual(lockedModes(ONLY_AUTO), { manual: false }, 'auto only: never manual');
  for (const c of [BOTH, SCANNER_BUILT_IN, null, SCANNER_NONE]) assert.deepEqual(lockedModes(c), {}, JSON.stringify(c));

  assert.equal(settingRefusal(ONLY_MANUAL, { dev: true }), DEV_NEEDS_AUTO);
  assert.equal(settingRefusal(ONLY_MANUAL, { manual: false }), MANUAL_ALWAYS);
  assert.equal(settingRefusal(ONLY_MANUAL, { manual: true, dev: false, pace: 'slow' }), null, 'every setting sent back as it is');
  assert.equal(settingRefusal(ONLY_AUTO, { manual: true }), MANUAL_NEEDED);
  assert.equal(settingRefusal(ONLY_AUTO, { manual: false, dev: true }), null);
  assert.equal(settingRefusal(SCANNER_NONE, { dev: true }), DEV_NEEDS_AUTO);
  assert.equal(settingRefusal(SCANNER_NONE, { manual: true }), MANUAL_NEEDED);
  for (const c of [BOTH, SCANNER_BUILT_IN, null]) {
    for (const body of [{ manual: true }, { manual: false }, { dev: true }, { dev: false }, { daily: 40 }]) {
      assert.equal(settingRefusal(c, body), null, JSON.stringify([c, body]));
    }
  }
  assert.doesNotMatch([AUTO_NEEDED, DEV_NEEDS_AUTO, MANUAL_NEEDED, MANUAL_ALWAYS].join(' '), /\u2014|scrap/i, 'plain words: no long dashes, and “scanning”');
});

test('scan-limits.json is brought into line with what the plugins decide, and written only when it differs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-locked-modes-'));
  try {
    const file = path.join(dir, 'scan-limits.json');
    applyLockedModes(dir, lockedModes(ONLY_AUTO));
    assert.equal(existsSync(file), false, 'already never manual: nothing written');
    applyLockedModes(dir, lockedModes(BOTH));
    assert.equal(existsSync(file), false);

    writeLimits(dir, { manual: false, dev: true, daily: 70 });
    const l = applyLockedModes(dir, lockedModes(ONLY_MANUAL));
    assert.deepEqual([l.manual, l.dev, l.daily], [true, false, 70], 'manual on, Dev mode off, the rest kept');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).devSince, undefined);

    applyLockedModes(dir, lockedModes(ONLY_AUTO));
    assert.equal(readLimits(dir).manual, false);
    writeLimits(dir, { manual: true });
    applyLockedModes(dir, lockedModes(BOTH));
    assert.equal(readLimits(dir).manual, true, 'with both, it stays as you set it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Which plugins unlock what ─────────────────────────────────────────────────

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-capabilities-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function installed(to, options = {}, appVersion = APP.appVersion) {
  const pkg = makePackage(options);
  installPlugin(to, pkg.zip, { appVersion, sha256: pkg.sha256 });
}

test('scannerCapabilities: the built-in scanner, unless plugins are on with a sound scanner plugin; then what they unlock', () => {
  const home = path.join(dir, 'unit-home');
  const root = standInRoot(path.join(dir, 'unit-root'));
  const noApp = path.join(dir, 'no-app');
  mkdirSync(home);
  const caps = (opts) => scannerCapabilities(opts.root ?? root, { dataDir: home, ...APP, ...opts });

  assert.equal(caps({ pluginsEnabled: false }), SCANNER_BUILT_IN, 'plugins off, built in: everything');
  assert.equal(caps({ pluginsEnabled: true }), SCANNER_BUILT_IN, 'plugins on, nothing installed: still the built-in one');
  assert.equal(caps({ pluginsEnabled: false, root: noApp }), SCANNER_NONE, 'no plugins and no built-in scanner: none');
  assert.equal(caps({ pluginsEnabled: true, root: noApp }), SCANNER_NONE);

  installed(home, MANUAL_PKG);
  assert.equal(caps({ pluginsEnabled: false }), SCANNER_BUILT_IN, 'off: an installed plugin unlocks nothing');
  assert.equal(caps({ pluginsEnabled: true }), ONLY_MANUAL, 'manual only');
  assert.equal(caps({ pluginsEnabled: true, root: noApp }), ONLY_MANUAL, 'whether or not the app has a scanner of its own');

  rmSync(path.join(home, 'plugins', 'manual-scan'), { recursive: true });
  installed(home, AUTO_PKG);
  assert.equal(caps({ pluginsEnabled: true }), ONLY_AUTO, 'auto only');

  installed(home, MANUAL_PKG);
  assert.equal(caps({ pluginsEnabled: true }), BOTH, 'both');
  installed(home, { manifest: { id: 'all-in-one', name: 'All in one', unlocks: ['manual', 'auto'] } });
  rmSync(path.join(home, 'plugins', 'auto-scan'), { recursive: true });
  rmSync(path.join(home, 'plugins', 'manual-scan'), { recursive: true });
  assert.equal(caps({ pluginsEnabled: true }), BOTH, 'one plugin unlocking both');
  rmSync(path.join(home, 'plugins', 'all-in-one'), { recursive: true });

  // Broken (a file changed since it was installed): it unlocks nothing.
  installed(home, AUTO_PKG);
  installed(home, MANUAL_PKG);
  writeFileSync(path.join(home, 'plugins', 'auto-scan', 'scanner', 'scrape.py'), 'print("changed")');
  assert.equal(caps({ pluginsEnabled: true }), ONLY_MANUAL, 'a broken auto-scan beside a sound manual-scan: manual only');
  writeFileSync(path.join(home, 'plugins', 'manual-scan', 'scanner', 'scrape.py'), 'print("changed too")');
  assert.equal(caps({ pluginsEnabled: true }), SCANNER_BUILT_IN, 'both broken: the built-in scanner');
  assert.equal(caps({ pluginsEnabled: true, root: noApp }), SCANNER_NONE, 'both broken, and none built in: none');

  // Made for another Sixgree: switched off, so it unlocks nothing either.
  rmSync(path.join(home, 'plugins'), { recursive: true });
  installed(home, MANUAL_PKG);
  assert.equal(caps({ pluginsEnabled: true, appVersion: '0.9.0' }), SCANNER_BUILT_IN);
  assert.equal(caps({ pluginsEnabled: true, appVersion: '0.9.0', root: noApp }), SCANNER_NONE);
});

// ── The route ─────────────────────────────────────────────────────────────────

const HOME = path.join(dir, 'home');
const ROOT = path.join(dir, 'root');
const RUNS = path.join(dir, 'runs.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = ROOT;
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js chromeInstalled).
process.env.SIX_DEGREES_TEST_CHROME = 'found';
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
process.env.SIX_DEGREES_AUTO_TICK_MS = '40';
mkdirSync(HOME);
standInRoot(ROOT);
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  // Every run's arguments after scrape.py, one run a line, and what scan-limits.json said as it started.
  `line=""; seen=""; for a in "$@"; do [ -n "$seen" ] && line="$line $a"; case "$a" in *scrape.py) seen=1;; esac; done`,
  `limits="$(cat '${path.join(HOME, 'scan-limits.json')}' 2>/dev/null | tr -d ' \\n')"; echo "$line | $limits" >> '${RUNS}'`,
  'echo "Done."',
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

const CLOCK = Symbol.for('six-degrees.auto-clock');
const AUTO_KEY = Symbol.for('six-degrees.auto-scan');
// 20:00, outside Auto scan's hours: it waits, and no sitting starts by itself.
globalThis[CLOCK] = () => new Date(2026, 9, 14, 20, 0, 0).getTime();

let GET, POST, getDb, setPluginsEnabled, forgetScannerCapabilities;
before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ setPluginsEnabled, forgetScannerCapabilities } = await import('../lib/plugins-view.js'));
  const { writeSettings } = await import('../lib/settings.js');
  const db = getDb();
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z', autoConnectAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES (?, 'me', 1, ?, 'A', ?)`)
    .run('p-mira', 'Mira Calloway', 'https://www.linkedin.com/in/mira-calloway');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url, source_connection_id) VALUES (?, 'me', 2, ?, ?, ?)`)
    .run('d2-pax', 'Pax Wendover', 'https://www.linkedin.com/in/pax-wendover', 'p-mira');
});

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const status = async () => (await GET(new Request('http://127.0.0.1/api/scraper'))).json();
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const runs = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.trim()) : []);
const limitsFile = () => JSON.parse(readFileSync(path.join(HOME, 'scan-limits.json'), 'utf8'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ok, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await pause(20);
  }
  assert.fail(`waited for ${what}`);
}

/** Plugins on (or off), with exactly these scanner plugins installed. */
function use(on, ...packages) {
  rmSync(path.join(HOME, 'plugins'), { recursive: true, force: true });
  for (const p of packages) installed(HOME, p);
  setPluginsEnabled(on);
  forgetScannerCapabilities();
}

beforeEach(async () => {
  await post({ action: 'auto-stop' });
  await until(async () => !(await job()).running, 'the last test’s job to end');
  clearInterval(globalThis[AUTO_KEY]?.timer);
  delete globalThis[AUTO_KEY];
  for (const f of [RUNS, path.join(HOME, 'scan-limits.json'), path.join(HOME, 'scan-queue.json')]) rmSync(f, { force: true });
  delete globalThis[Symbol.for('six-degrees.scan-queue')];
});

/** Start `body`, wait for the stand-in to finish, and say what it ran with: { args, limits }. */
async function started(body) {
  const before = runs().length;
  const res = await post(body);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  await until(() => runs().length > before, `${body.action} to run`);
  await until(async () => !(await job()).running, `${body.action} to end`);
  const line = runs()[before];
  const bar = line.lastIndexOf(' |');
  const limits = line.slice(bar + 2).trim();
  return { args: line.slice(0, bar).trim(), limits: limits ? JSON.parse(limits) : null };
}

/** Every action only the auto plugin unlocks is refused, in plain words, and nothing runs. */
async function autoRefused() {
  const bodies = [
    { action: 'full' }, { action: 'refresh' }, { action: 'company', name: 'Invented Co' }, { action: 'messages' },
    { action: 'messages-full' }, { action: 'connect', id: 'd2-pax' }, { action: 'read-profiles', batch: 10 },
  ];
  for (const body of bodies) {
    const res = await post(body);
    assert.equal(res.status, 409, body.action);
    assert.deepEqual(await res.json(), { error: AUTO_NEEDED, needsPlugin: 'auto' }, body.action);
  }
  const auto = await post({ action: 'auto-start', pace: 'medium', tiers: ['S', 'A'] });
  assert.equal(auto.status, 409);
  assert.deepEqual(await auto.json(), { error: AUTO_NEEDED, needsPlugin: 'auto' });
  assert.equal((await job()).auto.on, false, 'Auto scan never turned on');
  assert.deepEqual(runs(), [], 'nothing started');
}

test('plugins off, built-in scanner: everything, as before plugins', async () => {
  use(false, MANUAL_PKG);
  assert.deepEqual((await status()).capabilities, SCANNER_BUILT_IN);
  assert.deepEqual((await job()).capabilities, SCANNER_BUILT_IN, 'the job answer every page asks carries it too');
  writeLimits(HOME, { manual: true });
  assert.match((await started({ action: 'refresh' })).args, /^--refresh$/);
  const circle = await started({ action: 'bridge', id: 'p-mira' });
  assert.equal(circle.limits.manual, true, 'manual mode is yours to set, as it was');
  assert.equal((await post({ action: 'set-limits', manual: false })).status, 200);
  assert.equal((await post({ action: 'set-limits', dev: true })).status, 200);
  assert.equal((await post({ action: 'set-limits', dev: false })).status, 200);
});

test('plugins on with nothing installed: the built-in scanner, so everything', async () => {
  use(true);
  assert.deepEqual((await status()).capabilities, SCANNER_BUILT_IN);
  assert.match((await started({ action: 'refresh' })).args, /^--refresh$/);
});

test('only manual-scan: no automatic features, and every circle scan is a manual one whatever was saved', async () => {
  use(true, MANUAL_PKG);
  // Saved while the auto plugin was here: manual mode off, Dev mode on.
  writeLimits(HOME, { manual: false, dev: true, daily: 70 });
  const s = await status();
  assert.deepEqual(s.capabilities, ONLY_MANUAL);
  assert.deepEqual((await job()).capabilities, ONLY_MANUAL);
  assert.equal(s.linkedin.limits.manual, true, 'the Scan page sees manual mode on');
  assert.equal(s.linkedin.dev, false, 'and Dev mode off: it comes with the auto plugin');

  await autoRefused();

  // Saved off again behind the app's back: the scan still starts manual.
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ daily: 70, manual: false, dev: true, devSince: 1 }));
  const one = await started({ action: 'bridge', id: 'p-mira' });
  assert.match(one.args, /--bridge-url=https:\/\/www\.linkedin\.com\/in\/mira-calloway/);
  assert.equal(one.limits.manual, true, 'the scanner found manual mode on as it started');
  assert.equal(one.limits.dev, undefined, 'and Dev mode off');
  assert.equal(one.limits.daily, 70, 'everything else as it was');
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ manual: false }));
  assert.equal((await started({ action: 'auto-bridge', order: 'newest', maxBridges: 5 })).limits.manual, true, 'a round too');
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ manual: false }));
  assert.equal((await started({ action: 'resume', id: 'p-mira' })).limits.manual, true, 'and Resume');

  // Manual mode stays on, and Dev mode stays off.
  const off = await post({ action: 'set-limits', manual: false });
  assert.equal(off.status, 409);
  assert.deepEqual(await off.json(), { error: MANUAL_ALWAYS });
  const dev = await post({ action: 'set-limits', dev: true });
  assert.equal(dev.status, 409);
  assert.deepEqual(await dev.json(), { error: DEV_NEEDS_AUTO });
  assert.equal(limitsFile().manual, true);
  assert.equal(limitsFile().dev, undefined);
  // The Scan page's speed sends every setting back as it shows them: that goes through.
  const pace = await post({ action: 'set-limits', ...(await status()).linkedin.limits, pace: 'slow' });
  assert.equal(pace.status, 200, JSON.stringify(await pace.clone().json()));
  assert.equal((await pace.json()).limits.pace, 'slow');
  // And what any scanner does.
  assert.match((await started({ action: 'login' })).args, /^--login$/);
});

test('only auto-scan: never manual, and the automatic features run', async () => {
  use(true, AUTO_PKG);
  writeLimits(HOME, { manual: true });
  const s = await status();
  assert.deepEqual(s.capabilities, ONLY_AUTO);
  assert.equal(s.linkedin.limits.manual, false, 'manual mode is off: there is no switch to turn it off with');
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ manual: true }));
  assert.equal((await started({ action: 'bridge', id: 'p-mira' })).limits.manual, undefined, 'never started with manual mode');
  assert.match((await started({ action: 'refresh' })).args, /^--refresh$/);
  assert.match((await started({ action: 'company', name: 'Invented Co' })).args, /^--company=Invented Co$/);

  const manual = await post({ action: 'set-limits', manual: true });
  assert.equal(manual.status, 409);
  assert.deepEqual(await manual.json(), { error: MANUAL_NEEDED });
  assert.equal((await post({ action: 'set-limits', dev: true })).status, 200, 'Dev mode comes with it');
  assert.equal((await post({ action: 'set-limits', dev: false })).status, 200);
});

test('both: everything, and manual mode is yours to set', async () => {
  use(true, AUTO_PKG, MANUAL_PKG);
  assert.deepEqual((await status()).capabilities, BOTH);
  assert.equal((await post({ action: 'set-limits', manual: true })).status, 200);
  assert.equal((await started({ action: 'bridge', id: 'p-mira' })).limits.manual, true);
  assert.equal((await post({ action: 'set-limits', manual: false })).status, 200);
  assert.equal((await started({ action: 'bridge', id: 'p-mira' })).limits.manual, undefined);
  assert.match((await started({ action: 'refresh' })).args, /^--refresh$/);
});

test('a broken plugin unlocks nothing: the built-in scanner stands in, as scans already do', async () => {
  use(true, AUTO_PKG);
  writeFileSync(path.join(HOME, 'plugins', 'auto-scan', 'scanner', 'scrape.py'), 'print("not what was installed")');
  forgetScannerCapabilities();
  assert.deepEqual((await status()).capabilities, SCANNER_BUILT_IN);
});

test('Auto scan ends if the auto plugin goes while it waits, and never starts a sitting without it', async () => {
  use(true, AUTO_PKG);
  const res = await post({ action: 'auto-start', pace: 'medium', tiers: ['S', 'A'] });
  assert.equal(res.status, 200);
  assert.deepEqual([(await res.json()).auto.phase], ['hours'], 'waiting for 9:00');
  use(true, MANUAL_PKG);
  await until(async () => (await job()).auto.on === false, 'Auto scan to end at its next tick');
  assert.deepEqual((await job()).auto.ended.phase, 'stopped');
  assert.equal((await job()).auto.ended.reason, AUTO_NEEDED);
  assert.deepEqual(runs(), [], 'no sitting ran');
});

test('no scanner at all: the job answer says none, and everything says the scanner isn’t installed, as before', async () => {
  use(false);
  renameSync(path.join(ROOT, 'scripts'), path.join(ROOT, 'scripts-gone'));
  try {
    forgetScannerCapabilities();
    assert.deepEqual((await status()).capabilities, SCANNER_NONE);
    assert.deepEqual((await job()).capabilities, SCANNER_NONE);
    for (const body of [{ action: 'refresh' }, { action: 'bridge', id: 'p-mira' }, { action: 'login' }]) {
      const r = await post(body);
      assert.equal(r.status, 409, body.action);
      assert.deepEqual(await r.json(), { error: SCANNER_MISSING, scannerMissing: true }, body.action);
    }
    assert.equal((await (await post({ action: 'auto-start', pace: 'medium', tiers: ['S'] })).json()).error, SCANNER_MISSING);
    assert.deepEqual(await (await post({ action: 'set-limits', dev: true })).json(), { error: DEV_NEEDS_AUTO });
    assert.equal((await post({ action: 'set-limits', daily: 40 })).status, 200, 'the daily number is still yours');
    assert.deepEqual(runs(), []);
  } finally {
    renameSync(path.join(ROOT, 'scripts-gone'), path.join(ROOT, 'scripts'));
  }
});

// ── The page's own client: the job answer carries it ──────────────────────────

test('the page reads what is installed from the job answer, the same object until it changes', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); delete globalThis.fetch; });
  let answer = { running: false, recent: [], capabilities: { auto: false, manual: true, from: 'plugin' } };
  globalThis.fetch = async (url) => {
    assert.equal(String(url), '/api/scraper?job=1');
    return { ok: true, status: 200, json: async () => structuredClone(answer) };
  };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  const { watchScanner, capabilitiesNow, scannerNow, SCANNER_UNKNOWN } = await import('../lib/scraper-client.js?capabilities');
  assert.equal(SCANNER_UNKNOWN.capabilities, null, 'not known until the server says');
  let changes = 0;
  const stop = watchScanner(() => { changes += 1; });
  await flush();
  const first = capabilitiesNow();
  assert.equal(first, ONLY_MANUAL);
  assert.deepEqual(scanShows(first), scanShows(ONLY_MANUAL));

  // A scan's progress changes the answer; what is installed stays the same object.
  answer = { ...answer, running: true, action: 'bridge', startedAt: 5, pages: 3, log: ['Page 3...'] };
  mock.timers.tick(5000);
  await flush();
  assert.equal(scannerNow().pages, 3);
  assert.equal(capabilitiesNow(), first);

  // A server from before plugins says nothing: everything shows, as before.
  answer = { running: false, recent: [] };
  mock.timers.tick(1500);
  await flush();
  assert.equal(capabilitiesNow(), null);
  assert.equal(scanShows(capabilitiesNow()).auto, true);
  assert.ok(changes >= 2);
  stop();
});
