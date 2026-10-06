// Auto scan (experimental): its paces, its tiers, its hours, and how its
// sittings take turns with the scanner's queue (lib/auto-scan.js,
// app/api/scraper/route.js). Blake, 1.2.0: "it doesn't even work … it needs a
// slow / med / fast and the colour dots to pick which tiers."
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python, writes down each run's arguments, and
// sleeps as long as a file says. Nothing opens a browser or reaches LinkedIn.
// A temporary data folder, never the real one. The clock is set by the test.
// Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AUTO_PACES, PACE_KEYS, autoPlan, autoStatus, cleanPace, cleanTiers, clockText, inHours, nextHoursStart,
  paceLine, peopleAnHour, searchesAnHour, tierList,
} from '../lib/auto-scan.js';
import { AUTO } from '../lib/usage.js';

register('./helpers/extensionless.mjs', import.meta.url);

const at = (h, m = 0, day = 5) => new Date(2026, 9, day, h, m).getTime();
const HOUR = 3600 * 1000;

// ---- the rules, without a scanner ----

test('paces: Slow, Medium and Fast change only a sitting and its rest', () => {
  assert.deepEqual(PACE_KEYS, ['slow', 'medium', 'fast']);
  assert.deepEqual(Object.fromEntries(PACE_KEYS.map((k) => [k, [AUTO_PACES[k].sitting, AUTO_PACES[k].rest / 60]])),
    { slow: [4, 90], medium: [8, 60], fast: [12, 30] });
  // Medium is the pacing Auto scan always had (the scanner's own SESSION_PAGES and SESSION_REST).
  assert.deepEqual([AUTO_PACES.medium.sitting, AUTO_PACES.medium.rest], [AUTO.sitting, AUTO.sittingRest]);
  assert.ok(searchesAnHour('slow') < searchesAnHour('medium') && searchesAnHour('medium') < searchesAnHour('fast'));
  assert.deepEqual(PACE_KEYS.map(peopleAnHour), [20, 70, 180]);
  assert.equal(cleanPace('ludicrous'), 'medium');
});

test('the pace line says what a pace means, and when it reaches the daily limit', () => {
  assert.equal(paceLine('slow', 50), 'Slow: about 20 people an hour, 90 minutes’ rest after every 4 searches.');
  assert.equal(paceLine('medium', 50), 'Medium: about 70 people an hour, an hour’s rest after every 8 searches. It stops at your 50 a day, about 7 hours in.');
  assert.equal(paceLine('fast', 50), 'Fast: about 180 people an hour, 30 minutes’ rest after every 12 searches. It stops at your 50 a day, about 3 hours in.');
  assert.equal(paceLine('fast'), 'Fast: about 180 people an hour, 30 minutes’ rest after every 12 searches.');
});

test('Fast never goes past today\'s limit: a sitting is at most what is left, and at none it stops', () => {
  const noon = at(12);
  assert.deepEqual(autoPlan({ now: noon, pace: 'fast', leftToday: 50, leftMonth: 200 }), { kind: 'go', sitting: 12 });
  assert.deepEqual(autoPlan({ now: noon, pace: 'fast', leftToday: 5, leftMonth: 200 }), { kind: 'go', sitting: 5 });
  assert.deepEqual(autoPlan({ now: noon, pace: 'slow', leftToday: 50, leftMonth: 3 }), { kind: 'go', sitting: 3 });
  const done = autoPlan({ now: noon, pace: 'fast', leftToday: 0, leftMonth: 200, daily: 50 });
  assert.equal(done.kind, 'stop');
  assert.equal(done.as, 'limit');
  assert.equal(done.reason, 'Today’s limit of 50 searches is reached, so Auto scan has stopped for today.');
  // A pushback stops it too, whatever the pace.
  const pushed = autoPlan({ now: noon, pace: 'slow', leftToday: 50, cooldown: { until: noon + HOUR, reason: 'a security check' } });
  assert.deepEqual([pushed.kind, pushed.as], ['stop', 'stopped']);
});

test('hours: 9:00 to 18:00 on this computer\'s clock; at 20:00 Auto scan waits for 9:00', () => {
  assert.deepEqual(AUTO.hours, [9, 18]);
  assert.equal(inHours(at(8, 59)), false);
  assert.equal(inHours(at(9)), true);
  assert.equal(inHours(at(17, 59)), true);
  assert.equal(inHours(at(18)), false);
  assert.equal(nextHoursStart(at(20)), at(9, 0, 6));
  assert.equal(nextHoursStart(at(7)), at(9));
  assert.deepEqual(autoPlan({ now: at(20), pace: 'medium', leftToday: 50 }), { kind: 'hours', until: at(9, 0, 6) });
  // Resting after a sitting.
  assert.deepEqual(autoPlan({ now: at(12), pace: 'medium', restUntil: at(13), leftToday: 50 }), { kind: 'rest', until: at(13) });
  assert.equal(clockText(at(14, 5), at(12)), '14:05');
  assert.equal(clockText(at(9, 0, 6), at(20)), 'tomorrow 9:00');
});

test('tiers: S to D, each once, nothing else; said in plain words', () => {
  assert.deepEqual(cleanTiers(['a', 'S', 'x', 'A', 'd', 7]), ['S', 'A', 'D']);
  assert.deepEqual(cleanTiers(null), []);
  assert.equal(tierList(['S']), 'S');
  assert.equal(tierList(['A', 'S']), 'S and A');
  assert.equal(tierList(['S', 'A', 'B']), 'S, A and B');
});

test('the pace and tiers are remembered beside the switch; S and A, Medium, to start with', async () => {
  const { autoSettingsNow, rememberAutoSettings } = await import('../lib/experimental-client.js');
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(autoSettingsNow(storage), { pace: 'medium', tiers: ['S', 'A'] });
  rememberAutoSettings({ pace: 'fast', tiers: ['B', 'S', 'zz'] }, storage);
  assert.deepEqual(autoSettingsNow(storage), { pace: 'fast', tiers: ['S', 'B'] });
  store.set('six-degrees-auto-scan', '{not json');
  assert.deepEqual(autoSettingsNow(storage), { pace: 'medium', tiers: ['S', 'A'] });
});

test('the state in words', () => {
  const now = at(12);
  assert.equal(autoStatus(null).text, 'Off');
  assert.equal(autoStatus({ on: true, phase: 'running', sitting: 8 }, now).detail, 'A sitting of up to 8 searches.');
  assert.equal(autoStatus({ on: true, phase: 'rest', until: at(13, 5) }, now).text, 'Resting until 13:05');
  assert.equal(autoStatus({ on: true, phase: 'hours', until: at(9, 0, 6) }, at(20)).text, 'Outside hours · from tomorrow 9:00');
  assert.equal(autoStatus({ on: false, phase: 'off', ended: { phase: 'limit', reason: 'x' } }).text, 'Limit reached');
  assert.equal(autoStatus({ on: false, phase: 'off', ended: { phase: 'done', reason: 'y' } }).text, 'Nothing left to scan');
});

// ---- with the app's route and a stand-in scanner ----

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-auto-scan-'));
const HOME = path.join(dir, 'home');
const RUNS = path.join(dir, 'runs.txt');
const SLEEP = path.join(dir, 'sleep.txt');
const SAY = path.join(dir, 'say.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
process.env.SIX_DEGREES_AUTO_TICK_MS = '40';
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  // Every run's arguments after scrape.py, one run a line.
  `line=""; seen=""; for a in "$@"; do [ -n "$seen" ] && line="$line $a"; case "$a" in *scrape.py) seen=1;; esac; done; echo "$line" >> '${RUNS}'`,
  `[ -f '${SLEEP}' ] && sleep "$(cat '${SLEEP}')"`,
  `[ -f '${SAY}' ] && cat '${SAY}'`,
  'echo "Done."',
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

const CLOCK = Symbol.for('six-degrees.auto-clock');
const AUTO_KEY = Symbol.for('six-degrees.auto-scan');
let clock = at(12);
globalThis[CLOCK] = () => clock;

let GET, POST, getDb, writeSettings;
before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const post = (body) => POST(new Request('http://127.0.0.1:3498/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3498' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const runs = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.trim()) : []);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ok, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await pause(20);
  }
  assert.fail(`waited for ${what}`);
}

beforeEach(async () => {
  await post({ action: 'auto-stop' });
  await until(async () => !(await job()).running, 'the last test’s job to end');
  clearInterval(globalThis[AUTO_KEY]?.timer);
  delete globalThis[AUTO_KEY];
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  for (const f of [RUNS, SLEEP, SAY, path.join(HOME, 'linkedin-activity.json'), path.join(HOME, 'linkedin-cooldown.json'), path.join(HOME, 'scan-queue.json')]) rmSync(f, { force: true });
  delete globalThis[Symbol.for('six-degrees.scan-queue')];
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES ('p-oriel', 'me', 1, 'Oriel Vantasse', 'A', 'https://www.linkedin.com/in/oriel-vantasse')`).run();
  clock = at(12);
});

test('REGRESSION: a scan you start yourself never takes Auto scan\'s hours, even at 20:00 and even asking for them', async () => {
  clock = at(20);
  const res = await post({ action: 'auto-bridge', experimental: true, order: 'score', tiers: ['S', 'A'], maxBridges: 5 });
  assert.equal(res.status, 200);
  await until(() => runs().length === 1, 'the round to start at once');
  assert.doesNotMatch(runs()[0], /--experimental|--sitting/);
  assert.match(runs()[0], /--auto-bridge --max-bridges=5 --tiers=S,A --order=score/);
});

test('Auto scan at 20:00 waits for 9:00, then runs a sitting of its pace in the picked tiers', async () => {
  clock = at(20);
  const res = await post({ action: 'auto-start', pace: 'medium', tiers: ['A', 'S'] });
  assert.equal(res.status, 200);
  const { auto } = await res.json();
  assert.deepEqual([auto.on, auto.phase, auto.until], [true, 'hours', at(9, 0, 6)]);
  await pause(150);
  assert.equal(runs().length, 0, 'nothing starts outside the hours');

  clock = at(9, 0, 6);
  await until(() => runs().length === 1, 'the first sitting at 9:00');
  assert.match(runs()[0], /--auto-bridge --tiers=S,A --order=score --experimental --sitting=8 --max-pages=100 --deeper/);
  await until(async () => (await job()).auto.phase === 'rest', 'the rest after it');
  assert.equal((await job()).auto.until, at(10, 0, 6), 'Medium rests an hour');
  await pause(150);
  assert.equal(runs().length, 1, 'no second sitting during the rest');
  clock = at(10, 1, 6);
  await until(() => runs().length === 2, 'the next sitting after the rest');
});

test('Fast\'s sitting is only what is left of the daily limit', async () => {
  const now = clock / 1000;
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({ searches: Array.from({ length: 45 }, (_, i) => now - 60 * (i + 1)), profiles: [] }));
  await post({ action: 'auto-start', pace: 'fast', tiers: ['S'] });
  await until(() => runs().length === 1, 'a sitting');
  assert.match(runs()[0], /--sitting=5\b/);
});

test('at the daily limit Auto scan stops calmly, saying so', async () => {
  const now = clock / 1000;
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({ searches: Array.from({ length: 50 }, (_, i) => now - 60 * (i + 1)), profiles: [] }));
  const { auto } = await (await post({ action: 'auto-start', pace: 'fast', tiers: ['S'] })).json();
  assert.equal(auto.on, false);
  assert.deepEqual(auto.ended.phase, 'limit');
  assert.match(auto.ended.reason, /Today’s limit of 50 searches is reached/);
  assert.equal(runs().length, 0);
});

test('nothing left in the picked tiers: it says so and stops', async () => {
  writeFileSync(SAY, 'Limiting to S-tier (0 of 12 outstanding)\nNothing left to bridge.\n');
  await post({ action: 'auto-start', pace: 'slow', tiers: ['S'] });
  await until(async () => (await job()).auto.ended?.phase === 'done', 'Auto scan to end');
  const { auto } = await job();
  assert.equal(auto.on, false);
  assert.equal(auto.ended.reason, 'Everyone in S has been scanned. Pick more tiers to carry on.');
});

test('the queue goes first: a press during a sitting runs before the next sitting', async () => {
  writeFileSync(SLEEP, '0.6');
  await post({ action: 'auto-start', pace: 'fast', tiers: ['S', 'A'] });
  await until(async () => (await job()).auto.phase === 'running', 'the sitting to run');
  const queued = await (await post({ action: 'bridge', id: 'p-oriel' })).json();
  assert.equal(queued.queued, true, 'a circle scan pressed during a sitting waits its turn');
  await until(() => runs().length === 2, 'the queued scan, straight after the sitting');
  // Its rest over, the next sitting: after the queue, never alongside it.
  await until(async () => !(await job()).running, 'the queued scan to end');
  clock = at(14);
  await until(() => runs().length === 3, 'the next sitting');
  const [first, second, third] = runs();
  assert.match(first, /--sitting=12/);
  assert.match(second, /--bridge-url=https:\/\/www\.linkedin\.com\/in\/oriel-vantasse --from-start/);
  assert.match(third, /--sitting=12/);
});

test('Stop ends Auto scan and its sitting; it doesn\'t come back after a rest', async () => {
  writeFileSync(SLEEP, '5');
  await post({ action: 'auto-start', pace: 'medium', tiers: ['S'] });
  await until(() => runs().length === 1, 'the sitting to run');
  const { auto } = await (await post({ action: 'auto-stop' })).json();
  assert.deepEqual([auto.on, auto.ended.phase], [false, 'stopped']);
  await until(async () => !(await job()).running, 'the sitting to stop');
  clock = at(16);
  await pause(150);
  assert.equal(runs().length, 1);
});

test('Start says why it can\'t, at once: no tier picked, or the scan\'s "I understand" not given', async () => {
  const none = await post({ action: 'auto-start', pace: 'fast', tiers: [] });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).error, 'Pick at least one tier for Auto scan to scan.');
  writeSettings(getDb(), { scanRiskAccepted: null });
  const risk = await post({ action: 'auto-start', pace: 'fast', tiers: ['S'] });
  assert.equal(risk.status, 409);
  assert.equal((await risk.json()).needsRiskAcceptance, true);
  assert.equal((await job()).auto.on, false);
});

// ---- the switch: one setting, always on the Scan page ----
// Blake, 1.2.0: "there's no setting in the scanner to turn off the Auto scan
// button, it was only in the onboarding."

test('the Auto scan switch is first in Scanner settings, never greyed out, and the same setting everywhere', () => {
  const page = readFileSync(new URL('../app/setup/page.js', import.meta.url), 'utf8');
  const sw = page.indexOf('data-auto-scan-switch');
  const settings = page.indexOf('id="scan-settings"');
  assert.ok(sw > settings, 'in Scanner settings');
  assert.ok(sw < page.indexOf('className="scan-two"', settings), 'first, above the budget');
  const toggle = page.slice(sw, page.indexOf('more={', sw));
  assert.match(toggle, /onChange=\{setAllDay\}/);
  assert.doesNotMatch(toggle, /disabled=/, 'never greyed out while something runs');
  assert.match(page, /useSyncExternalStore\(watchAllDay, allDayNow/);
  // The header's own Turn off, and the guided setup, write the same one.
  assert.match(readFileSync(new URL('../app/components/AutoScanButton.js', import.meta.url), 'utf8'), /setAllDay\(false\)/);
  assert.match(readFileSync(new URL('../app/components/onboarding/steps.js', import.meta.url), 'utf8'), /setAllDay\(!auto\)/);
});

test('turning the switch off stops Auto scan, so it never runs with no button to see it by', async () => {
  const { setAllDay, allDayNow } = await import('../lib/experimental-client.js');
  const store = new Map();
  const sent = [];
  const saved = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.window = { dispatchEvent: () => true };
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); };
  try {
    setAllDay(true);
    assert.equal(allDayNow(), true);
    assert.deepEqual(sent, []);
    setAllDay(false);
    assert.equal(allDayNow(), false);
    await pause(10);
    assert.deepEqual(sent, [{ action: 'auto-stop' }]);
    assert.equal(store.get('six-degrees-experimental-auto'), 'false', 'the key the guided setup and the Scan page read');
  } finally {
    Object.assign(globalThis, saved);
  }
});
