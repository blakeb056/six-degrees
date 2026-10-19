// The limits, and "Lift limits for this session", through the app's own route
// (app/api/scraper/route.js). Blake, 2026-10-05: "Just a simple default limit
// for the day and a button to lift restrictions for this session." Blake,
// 2026-10-17: scan windows in place of the searches a day, which the lift never passes.
//
// The scanner is a stand-in: SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python, writes down each run's arguments and
// whether it was told the limits are lifted, and can wait for a line on its
// stdin. Nothing opens a browser or reaches LinkedIn. A temporary data folder,
// never the real one. Invented people. The scanner's own side (the pace and
// the stops that hold while lifted) is in tests/profile-views.test.mjs.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { standInRoot } from './helpers/scanner.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-simple-limits-'));
const HOME = path.join(dir, 'home');
const RUNS = path.join(dir, 'runs.txt');
const LISTEN = path.join(dir, 'listen');
const HEARD = path.join(dir, 'heard.txt');
const SAY = path.join(dir, 'say.txt');
const CODE = path.join(dir, 'code.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
mkdirSync(HOME);
standInRoot(path.join(dir, 'root'));
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do case "$a" in --bridge-url=*|--auto-bridge) printf '%s lifted=%s\\n' "$a" "$SIX_DEGREES_LIMITS_LIFTED" >> '${RUNS}';; esac; done`,
  // Told while it runs (route.js tellScanner): the first line on its stdin.
  `[ -f '${LISTEN}' ] && { IFS= read -r line; printf '%s\\n' "$line" > '${HEARD}'; }`,
  `[ -f '${SAY}' ] && cat '${SAY}'`,
  'echo "Saved."',
  // How the run ends (scrape.py EXIT_CODES): 0 unless a case says otherwise.
  `[ -f '${CODE}' ] && exit "$(cat '${CODE}')"`,
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb, writeSettings, putLimitsBack;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  ({ putLimitsBack } = await import('../lib/limits-lift.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const post = (body) => POST(new Request('http://127.0.0.1:3498/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3498' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const usage = async () => (await GET(new Request('http://127.0.0.1/api/scraper?usage=1'))).json();
const runs = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean) : []);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(ok, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await pause(25);
  }
  assert.fail(`waited for ${what}`);
}
const idle = async () => !(await job()).running;
const now = () => Date.now() / 1000;
/** `n` searches in the last hour, and a pause from LinkedIn if asked. */
function used(n, { cooldown = false } = {}) {
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({
    searches: Array.from({ length: n }, (_, i) => now() - 30 * (i + 1)), profiles: [],
  }));
  if (cooldown) {
    writeFileSync(path.join(HOME, 'linkedin-cooldown.json'), JSON.stringify({
      until: now() + 3600, reason: 'LinkedIn pushed back: a security check', set_at: now() - 600,
    }));
  }
}
const files = () => readdirSync(HOME).filter((f) => !f.startsWith('.') && f !== 'six-degrees.sqlite').sort()
  .map((f) => [f, f.endsWith('.json') ? readFileSync(path.join(HOME, f), 'utf8') : '']);

beforeEach(async () => {
  await until(idle, 'the last test’s scan to end');
  putLimitsBack();
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  for (const f of [RUNS, LISTEN, HEARD, SAY, CODE, ...['linkedin-activity.json', 'linkedin-cooldown.json', 'scan-limits.json', 'scan-queue.json'].map((n) => path.join(HOME, n))]) {
    rmSync(f, { force: true });
  }
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES (?, 'me', 1, ?, 'A', ?)`)
    .run('p-oriel', 'Oriel Vantasse', 'https://www.linkedin.com/in/oriel-vantasse');
  // Something earlier may have held a scan back: start each test from a clean notch.
  await job();
});

// Scan windows (Blake, 2026-10-17), in place of the searches a day: 60 search pages a
// window, two a day, 6 hours apart, which lifting never passes (tests/scan-windows.test.mjs).
const pick = (l) => ({ lifted: l.lifted, reached: l.reached, searches: l.searches, used: l.window?.used, cap: l.window?.cap, profilesReached: l.profilesReached });

test('the scan window refuses a circle scan before anything starts, says when the next opens, and lifting doesn\'t pass it', async () => {
  used(60);
  const res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  const d = await res.json();
  assert.equal(d.limitReached, true);
  assert.match(d.error, /^Scan window 1 of 2 is used: 60 of 60 search pages\. The next window opens .+\.$/);
  assert.doesNotMatch(d.error, /Lift limits/, 'the lift isn\'t offered: it never passes a window');
  assert.deepEqual(runs(), [], 'nothing started');
  assert.deepEqual(pick((await job()).limits), { lifted: false, reached: true, searches: 60, used: 60, cap: 60, profilesReached: false });

  await post({ action: 'lift-limits' });
  const lifted = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(lifted.status, 409, 'lifted, the window still holds');
  assert.equal((await lifted.json()).limitReached, true);
  assert.deepEqual(runs(), []);
});

test('a stricter window holds sooner; lifting the limits puts the ceiling back, and no further', async () => {
  used(40);
  assert.equal((await post({ action: 'set-limits', windowPages: 30 })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(path.join(HOME, 'scan-limits.json'), 'utf8')), { daily: 50, pace: 'fast', gentle: true, profileReads: false, windowPages: 30 });
  const held = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(held.status, 409);
  assert.match((await held.json()).error, /^Scan window 1 of 2 is used: 40 of 30 search pages\./);
  await post({ action: 'lift-limits' });
  assert.equal((await post({ action: 'bridge', id: 'p-oriel' })).status, 200, 'lifted: the window is 60, and 40 are used');
  await until(idle, 'the scan to end');
  assert.deepEqual(runs(), ['--bridge-url=https://www.linkedin.com/in/oriel-vantasse lifted=1']);
});

test('a number the app won\'t take keeps the saved one; there is no monthly or profile-view cap to set', async () => {
  for (const daily of [0, 1001, '80', null]) {
    const d = await (await post({ action: 'set-limits', daily })).json();
    assert.equal(d.limits.daily, 50, String(daily));
  }
  const d = await (await post({ action: 'set-limits', daily: 75, monthly: 0, profiles: 10 })).json();
  assert.deepEqual(d.limits, { daily: 75, pace: 'fast', gentle: true, profileReads: false, dev: false, devSince: null, manual: false, digDeeper: false, chimes: true, chimeVolume: 0.6, breakEvery: 10, breakSeconds: null, roundPages: 25, windowPages: 60, windowsPerDay: 2, windowGapHours: 6 });
  // The windows: only ever stricter than their defaults.
  for (const [key, value] of [['windowPages', 120], ['windowsPerDay', 3], ['windowGapHours', 2], ['windowPages', '30']]) {
    const w = await (await post({ action: 'set-limits', [key]: value })).json();
    assert.deepEqual([w.limits.windowPages, w.limits.windowsPerDay, w.limits.windowGapHours], [60, 2, 6], `${key} ${value}`);
  }
  const strict = await (await post({ action: 'set-limits', windowPages: 20, windowsPerDay: 1, windowGapHours: 12 })).json();
  assert.deepEqual([strict.limits.windowPages, strict.limits.windowsPerDay, strict.limits.windowGapHours], [20, 1, 12]);
});

test('lifting takes off profile views a day and the cooldown, for this session only, writes nothing, and keeps the window', async () => {
  used(40, { cooldown: true });
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ daily: 50, pace: 'fast' }));
  let res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Scanning is paused until .*security check/);
  const before = files();

  const lift = await post({ action: 'lift-limits' });
  assert.deepEqual(await lift.json(), { ok: true, lifted: true });
  assert.deepEqual(files(), before, 'nothing written: the lift is in memory only');
  assert.deepEqual(pick((await job()).limits), { lifted: true, reached: false, searches: 40, used: 40, cap: 60, profilesReached: false });
  const u = await usage();
  assert.equal(u.lifted, true);
  assert.equal(u.cooldown, null);
  assert.equal(u.profilesLeftToday, null, 'no limit on profile views a day');
  assert.equal(u.searchesLeft, 20, 'the window holds: 20 of its 60 left');
  assert.ok(u.heldCooldown, 'the pause on file, which comes back with the limits');

  res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 200, 'past the cooldown');
  await until(idle, 'the scan to end');
  assert.deepEqual(runs(), ['--bridge-url=https://www.linkedin.com/in/oriel-vantasse lifted=1'], 'the scanner is told, so it skips them too');

  // Put back: the pause holds again at once.
  assert.deepEqual(await (await post({ action: 'put-limits-back' })).json(), { ok: true, lifted: false });
  res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Scanning is paused/);
  rmSync(path.join(HOME, 'linkedin-cooldown.json'));
  used(60);
  res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).limitReached, true);
  assert.equal(runs().length, 1);
});

test('the lift resets when the app restarts: a fresh server process has the limits on', async () => {
  used(50, { cooldown: true });
  await post({ action: 'lift-limits' });
  assert.equal((await job()).limits.lifted, true);
  const script = path.join(dir, 'restart.mjs');
  writeFileSync(script, [
    "import { register } from 'node:module';",
    `register(${JSON.stringify(pathToFileURL(path.join(HERE, 'helpers', 'extensionless.mjs')).href)});`,
    `const { GET } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, '..', 'app', 'api', 'scraper', 'route.js')).href)});`,
    "const j = await (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();",
    "const u = await (await GET(new Request('http://127.0.0.1/api/scraper?usage=1'))).json();",
    'console.log(JSON.stringify({ limits: j.limits, lifted: u.lifted, cooldown: Boolean(u.cooldown), searchesLeft: u.searchesLeft }));',
    'process.exit(0);',
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env, timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const restarted = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(restarted, { limits: { lifted: false, reached: false }, lifted: false, cooldown: true, searchesLeft: 10 });
  assert.equal((await job()).limits.lifted, true, 'this server still has it lifted');
});

test('a scan that stops at the scan window leaves the notch saying so, lifted or not', async () => {
  used(59);
  writeFileSync(SAY, '  Scan window 1 of 2 is used: 60 of 60 search pages. The next window opens at Sat Oct 17, 9:12 PM. The next run carries on from the same page.\n');
  writeFileSync(CODE, '11');   // BudgetReached: the scanner's exit for a limit
  assert.equal((await post({ action: 'bridge', id: 'p-oriel' })).status, 200);
  used(60);   // the scan's own search, written down as it went
  await until(idle, 'the scan to end');
  assert.deepEqual(pick((await job()).limits), { lifted: false, reached: true, searches: 60, used: 60, cap: 60, profilesReached: false });
  // Lifting doesn't clear it: the window holds.
  await post({ action: 'lift-limits' });
  assert.deepEqual(pick((await job()).limits), { lifted: true, reached: true, searches: 60, used: 60, cap: 60, profilesReached: false });
});

test('a scan under way is told the moment the limits are lifted or put back', async () => {
  writeFileSync(LISTEN, '');
  assert.equal((await post({ action: 'bridge', id: 'p-oriel' })).status, 200);
  await until(async () => (await job()).running, 'the scan to start');
  await post({ action: 'lift-limits' });
  await until(() => existsSync(HEARD), 'the scanner to hear it');
  assert.equal(readFileSync(HEARD, 'utf8').trim(), 'limits: lifted');
  await until(idle, 'the scan to end');
  assert.match((await job()).log.join('\n'), /Finished\./);
});

test('a round you start yourself is held at the scan window, asking for Auto scan\'s pacing or not, lifted or not', async () => {
  used(60);
  for (const body of [{ action: 'auto-bridge', maxBridges: 5 }, { action: 'auto-bridge', experimental: true, maxBridges: 5 }]) {
    const res = await post(body);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).limitReached, true);
  }
  await post({ action: 'lift-limits' });
  const lifted = await post({ action: 'auto-bridge', maxBridges: 5 });
  assert.equal(lifted.status, 409, 'lifting never passes a window');
  used(30);
  assert.equal((await post({ action: 'auto-bridge', maxBridges: 5 })).status, 200);
  await until(idle, 'the round to end');
  assert.deepEqual(runs(), ['--auto-bridge lifted=1']);
});
