// One limit, and "Lift limits for this session", through the app's own route
// (app/api/scraper/route.js). Blake, 2026-10-05: "we need to simplify this and
// allow more usage as it's constrained too much. Just a simple default limit
// for the day and a button to lift restrictions for this session."
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

register('./helpers/extensionless.mjs', import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-simple-limits-'));
const HOME = path.join(dir, 'home');
const RUNS = path.join(dir, 'runs.txt');
const LISTEN = path.join(dir, 'listen');
const HEARD = path.join(dir, 'heard.txt');
const SAY = path.join(dir, 'say.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
process.env.SIX_DEGREES_TEST_CHROME = 'found';
process.env.SIX_DEGREES_QUEUE_GAP_MS = '0';
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do case "$a" in --bridge-url=*|--auto-bridge) printf '%s lifted=%s\\n' "$a" "$SIX_DEGREES_LIMITS_LIFTED" >> '${RUNS}';; esac; done`,
  // Told while it runs (route.js tellScanner): the first line on its stdin.
  `[ -f '${LISTEN}' ] && { IFS= read -r line; printf '%s\\n' "$line" > '${HEARD}'; }`,
  `[ -f '${SAY}' ] && cat '${SAY}'`,
  'echo "Saved."',
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
  for (const f of [RUNS, LISTEN, HEARD, SAY, ...['linkedin-activity.json', 'linkedin-cooldown.json', 'scan-limits.json', 'scan-queue.json'].map((n) => path.join(HOME, n))]) {
    rmSync(f, { force: true });
  }
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES (?, 'me', 1, ?, 'A', ?)`)
    .run('p-oriel', 'Oriel Vantasse', 'https://www.linkedin.com/in/oriel-vantasse');
  // Something earlier may have held a scan back: start each test from a clean notch.
  await job();
});

test('the single daily limit refuses a circle scan before anything starts, and the notch offers the lift', async () => {
  used(50);
  const res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  const d = await res.json();
  assert.equal(d.limitReached, true);
  assert.match(d.error, /^Today’s limit of 50 is used: it counts the last 24 hours\. The next search frees up .+\. Lift limits for this session to carry on now\.$/);
  assert.deepEqual(runs(), [], 'nothing started');
  assert.deepEqual((await job()).limits, { lifted: false, reached: true, searches: 50, daily: 50 });

  // One number: raise it, and the same press starts.
  assert.equal((await post({ action: 'set-limits', daily: 60 })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(path.join(HOME, 'scan-limits.json'), 'utf8')), { daily: 60, pace: 'fast', gentle: true, profileReads: false });
  assert.equal((await post({ action: 'bridge', id: 'p-oriel' })).status, 200);
  await until(idle, 'the scan to end');
  assert.deepEqual(runs(), ['--bridge-url=https://www.linkedin.com/in/oriel-vantasse lifted=0']);
  assert.equal((await job()).limits.reached, false);
});

test('a number the app won\'t take keeps the saved one; there is no monthly or profile-view cap to set', async () => {
  for (const daily of [0, 1001, '80', null]) {
    const d = await (await post({ action: 'set-limits', daily })).json();
    assert.equal(d.limits.daily, 50, String(daily));
  }
  const d = await (await post({ action: 'set-limits', daily: 75, monthly: 0, profiles: 10 })).json();
  assert.deepEqual(d.limits, { daily: 75, pace: 'fast', gentle: true, profileReads: false });
});

test('lifting bypasses the daily limit and the cooldown, for this session only, and writes nothing', async () => {
  used(80, { cooldown: true });
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ daily: 50, pace: 'fast' }));
  let res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Scanning is paused until .*security check/);
  const before = files();

  const lift = await post({ action: 'lift-limits' });
  assert.deepEqual(await lift.json(), { ok: true, lifted: true });
  assert.deepEqual(files(), before, 'nothing written: the lift is in memory only');
  assert.deepEqual((await job()).limits, { lifted: true, reached: false, searches: 80, daily: 50 });
  const u = await usage();
  assert.equal(u.lifted, true);
  assert.equal(u.cooldown, null);
  assert.equal(u.leftToday, null);
  assert.ok(u.heldCooldown, 'the pause on file, which comes back with the limits');

  res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 200, 'past the cooldown and 80 of 50');
  await until(idle, 'the scan to end');
  assert.deepEqual(runs(), ['--bridge-url=https://www.linkedin.com/in/oriel-vantasse lifted=1'], 'the scanner is told, so it skips them too');

  // Put back: both hold again at once.
  assert.deepEqual(await (await post({ action: 'put-limits-back' })).json(), { ok: true, lifted: false });
  res = await post({ action: 'bridge', id: 'p-oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Scanning is paused/);
  rmSync(path.join(HOME, 'linkedin-cooldown.json'));
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
    'console.log(JSON.stringify({ limits: j.limits, lifted: u.lifted, cooldown: Boolean(u.cooldown), leftToday: u.leftToday }));',
    'process.exit(0);',
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: process.env, timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const restarted = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(restarted, { limits: { lifted: false, reached: false }, lifted: false, cooldown: true, leftToday: 0 });
  assert.equal((await job()).limits.lifted, true, 'this server still has it lifted');
});

test('a scan that stops at the daily limit leaves the notch offering the lift', async () => {
  used(50);
  writeFileSync(path.join(HOME, 'scan-limits.json'), JSON.stringify({ daily: 51 }));
  writeFileSync(SAY, 'Today\'s limit of 51 searches is used — it counts the last 24 hours. The next run carries on from the same page.\n');
  assert.equal((await post({ action: 'bridge', id: 'p-oriel' })).status, 200);
  used(51);   // the scan's own search, written down as it went
  await until(idle, 'the scan to end');
  assert.deepEqual((await job()).limits, { lifted: false, reached: true, searches: 51, daily: 51 });
  // Lifting clears it.
  await post({ action: 'lift-limits' });
  assert.deepEqual((await job()).limits, { lifted: true, reached: false, searches: 51, daily: 51 });
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

test('a round you start yourself is held at the limit, asking for Auto scan\'s pacing or not; lifted, it runs', async () => {
  used(50);
  for (const body of [{ action: 'auto-bridge', maxBridges: 5 }, { action: 'auto-bridge', experimental: true, maxBridges: 5 }]) {
    const res = await post(body);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).limitReached, true);
  }
  await post({ action: 'lift-limits' });
  assert.equal((await post({ action: 'auto-bridge', maxBridges: 5 })).status, 200);
  await until(idle, 'the round to end');
  assert.deepEqual(runs(), ['--auto-bridge lifted=1']);
});
