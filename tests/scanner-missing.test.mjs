// A copy of the app without the scanner's files (lib/scanner-files.js): the
// scanner is moving out of the app into add-ons of its own. /api/scraper still
// answers, the Scan page is told the files are missing, and everything that
// would run or set up the scanner says it isn't installed, first and plainly,
// never a 500. What needs no scanner (its settings, Stop, the queue) works as
// before, and quitting the desktop app finds nothing to stop.
//
// SIX_DEGREES_ROOT is the app's folder with only its package.json, and
// SIX_DEGREES_PYTHON a stand-in that writes down anything it is started with:
// nothing may be. Nothing opens a browser or reaches LinkedIn. On a temporary
// data folder, never the real one.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { SCANNER_MISSING } from '../lib/scanner-files.js';
import { runningJob, stopScan } from '../desktop/lib.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scanner-missing-'));
const ARGS = path.join(dir, 'args.txt');
const ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = ROOT;
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js chromeInstalled).
process.env.SIX_DEGREES_TEST_CHROME = 'found';
mkdirSync(process.env.SIX_DEGREES_HOME);
mkdirSync(ROOT);
writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify({ name: pkg.name }));
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done >> '${ARGS}'`,
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  const db = getDb();
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url) VALUES (?, 'me', ?, ?, ?)`)
    .run('p-mira', 1, 'Mira Calloway', 'https://www.linkedin.com/in/mira-calloway');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url, source_connection_id) VALUES (?, 'me', ?, ?, ?, ?)`)
    .run('d2-pax', 2, 'Pax Wendover', 'https://www.linkedin.com/in/pax-wendover', 'p-mira');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const status = async () => (await GET(new Request('http://127.0.0.1/api/scraper'))).json();

test('the Scan page is told the scanner\'s files are missing, and nothing is ready', async () => {
  const res = await GET(new Request('http://127.0.0.1/api/scraper'));
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.checks.scriptsFound, false);
  assert.equal(s.ready, false);
  assert.equal(s.running, false);
  const job = await GET(new Request('http://127.0.0.1/api/scraper?job=1'));
  assert.equal(job.status, 200);
  assert.equal((await job.json()).running, false);
});

test('everything that runs or sets up the scanner says it isn\'t installed, before any other check, and nothing starts', async () => {
  // No "I understand" was given here: the scanner's absence is still what is said.
  for (const body of [
    { action: 'install' }, { action: 'setup' }, { action: 'login' }, { action: 'full' }, { action: 'refresh' },
    { action: 'auto-bridge', tiers: ['S'] }, { action: 'resume-all' }, { action: 'messages' }, { action: 'photos' },
    { action: 'read-profiles', batch: 10 }, { action: 'bridge', id: 'p-mira' }, { action: 'company', name: 'Invented Co' },
    { action: 'connect', id: 'd2-pax' },
  ]) {
    const res = await post(body);
    assert.equal(res.status, 409, body.action);
    assert.deepEqual(await res.json(), { error: SCANNER_MISSING, scannerMissing: true }, body.action);
  }
  assert.equal((await status()).running, false);
  assert.equal(existsSync(ARGS), false, 'nothing was started');
});

test('Auto scan says the same at Start', async () => {
  const res = await post({ action: 'auto-start', tiers: ['S', 'A'], pace: 'medium' });
  assert.equal(res.status, 409);
  const answer = await res.json();
  assert.equal(answer.error, SCANNER_MISSING);
  assert.equal(answer.scannerMissing, true);
  assert.equal(answer.auto, undefined, 'Auto scan never turned on');
  assert.equal(existsSync(ARGS), false);
});

test('what needs no scanner works as before: its settings, Stop, the queue, and an unknown action is still refused as one', async () => {
  const limits = await post({ action: 'set-limits', daily: 40 });
  assert.equal(limits.status, 200);
  assert.equal((await limits.json()).limits.daily, 40);
  assert.equal((await post({ action: 'cancel' })).status, 200);
  assert.equal((await post({ action: 'queue-clear' })).status, 200);
  assert.equal((await post({ action: 'warp-speed' })).status, 400);
});

test('with no app folder found at all, the answer is the same, never a 500', async () => {
  const [wasRoot, wasCwd] = [process.env.SIX_DEGREES_ROOT, process.cwd()];
  const nowhere = path.join(dir, 'nowhere', 'deeper', 'still');
  mkdirSync(nowhere, { recursive: true });
  process.env.SIX_DEGREES_ROOT = path.join(dir, 'home');   // a folder, but not the app's
  process.chdir(nowhere);
  try {
    const res = await post({ action: 'full' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, SCANNER_MISSING);
  } finally {
    process.chdir(wasCwd);
    process.env.SIX_DEGREES_ROOT = wasRoot;
  }
});

test('quitting the desktop app finds nothing running, so it asks nothing and stops nothing', async () => {
  // desktop/lib.mjs, as main.mjs uses it, asking this route.
  const fetchImpl = async (url, init = {}) => (init.method === 'POST' ? POST : GET)(new Request(url, init));
  assert.equal(await runningJob('http://127.0.0.1', { fetchImpl }), null);
  assert.equal(await stopScan('http://127.0.0.1', { fetchImpl, timeoutMs: 100 }), 'none');
});
