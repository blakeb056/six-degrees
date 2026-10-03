// The first run, as /api/scraper answers it (the 1.0 first-run fixes):
//
//  - Google Chrome is part of step 1, and nothing that opens LinkedIn starts
//    without it: the server refuses in the step's own words, before anything
//    is spawned. Setting up the scanner and saving photos don't need it.
//  - "Signed in" is the scanner's note (signed-in.json) once there is one, so
//    a window closed before signing in no longer ticks step 2; a folder from
//    before the note keeps the old check (Chrome's cookie file).
//  - Whose circle a batch is reading, for the Scan page's "Watch it fill in".
//
// Chrome is answered by SIX_DEGREES_TEST_CHROME, so these don't depend on
// whether the computer running them has it. The scanner is a stand-in, as in
// scan-by-id.test.mjs: SIX_DEGREES_PYTHON names a shell script that answers
// the app's look for a Python and writes down what it is started with, and
// SIX_DEGREES_ROOT a folder whose scrape.py stops at once if a real Python
// ever runs it. Nothing opens a browser or reaches LinkedIn. On a temporary
// data folder, never the real one. Invented people.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHROME_REFUSAL } from '../lib/scanner-setup.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-first-run-'));
const ARGS = path.join(dir, 'args.txt');
const HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done > '${ARGS}'`,
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb, registerScanState;
const forced = process.env.SIX_DEGREES_TEST_CHROME;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ registerScanState } = await import('../lib/scan-state.js'));
  // The one-time "I understand" (lib/scan-risk.js) was given in this folder.
  const { writeSettings } = await import('../lib/settings.js');
  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

after(() => {
  if (forced === undefined) delete process.env.SIX_DEGREES_TEST_CHROME;
  else process.env.SIX_DEGREES_TEST_CHROME = forced;
});

beforeEach(() => {
  process.env.SIX_DEGREES_TEST_CHROME = 'found';
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  rmSync(ARGS, { force: true });
  rmSync(path.join(HOME, 'chrome-profile'), { recursive: true, force: true });
  rmSync(path.join(HOME, 'signed-in.json'), { force: true });
  Object.assign(registerScanState({}), { running: false, action: null, target: null, recent: [], log: [], startedAt: null, exitCode: null, pages: 0, found: [] });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url)
                          VALUES (?, 'me', 1, ?, ?)`);
  add.run('p-mira', 'Mira Calloway', 'https://www.linkedin.com/in/mira-calloway');
  // Two connections share a name: a batch's log line can't say which.
  add.run('p-tobin-1', 'Tobin Ashgrove', 'https://www.linkedin.com/in/tobin-ashgrove-1');
  add.run('p-tobin-2', 'Tobin Ashgrove', 'https://www.linkedin.com/in/tobin-ashgrove-2');
});

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const status = async () => (await GET(new Request('http://127.0.0.1/api/scraper'))).json();
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();
const ended = async () => { for (let i = 0; i < 200 && (await job()).running; i++) await new Promise((r) => setTimeout(r, 25)); };

// ── Google Chrome ───────────────────────────────────────────────────────────

test('without Google Chrome, nothing that opens LinkedIn starts, and the refusal is step 1\'s words', async () => {
  process.env.SIX_DEGREES_TEST_CHROME = 'missing';
  const asks = [
    { action: 'login' }, { action: 'full' }, { action: 'refresh' }, { action: 'auto-bridge', maxBridges: 5 },
    { action: 'resume-all' }, { action: 'bridge', id: 'p-mira' }, { action: 'resume', id: 'p-mira' },
    { action: 'company', name: 'Initech' }, { action: 'messages' },
  ];
  for (const body of asks) {
    const res = await post(body);
    assert.equal(res.status, 409, body.action);
    assert.deepEqual(await res.json(), { error: CHROME_REFUSAL, needsChrome: true }, body.action);
  }
  assert.equal(existsSync(ARGS), false, 'nothing was started');
  assert.equal((await job()).running, false);
});

test('setting up the scanner and saving photos don\'t need Chrome', async () => {
  process.env.SIX_DEGREES_TEST_CHROME = 'missing';
  // The stand-in Python already has the packages, so Install says so: not Chrome's refusal.
  const install = await (await post({ action: 'install' })).json();
  assert.notEqual(install.error, CHROME_REFUSAL);
  assert.equal(install.needsChrome, undefined);
  // Save photos opens no browser: it starts.
  assert.equal((await post({ action: 'photos' })).status, 200);
  await ended();
  assert.ok(existsSync(ARGS), 'the scanner was started for photos');
});

test('the Scan page is told Chrome is missing, and the scanner isn\'t ready; with it, it is', async () => {
  process.env.SIX_DEGREES_TEST_CHROME = 'missing';
  let s = await status();
  assert.equal(s.checks.chrome, false);
  assert.equal(s.ready, false);
  // Installed meanwhile: the next look says so, with nothing cached in the way.
  process.env.SIX_DEGREES_TEST_CHROME = 'found';
  s = await status();
  assert.equal(s.checks.chrome, true);
  assert.equal(s.ready, true);
  assert.equal((await post({ action: 'bridge', id: 'p-mira' })).status, 200);
  await ended();
});

// ── signed in ───────────────────────────────────────────────────────────────

const profile = path.join(HOME, 'chrome-profile');
const cookies = () => {
  mkdirSync(path.join(profile, 'Default'), { recursive: true });
  writeFileSync(path.join(profile, 'Default', 'Cookies'), 'a stand-in');
};
const note = (signedIn) => writeFileSync(path.join(HOME, 'signed-in.json'), JSON.stringify({ signedIn, at: 1790000000 }));

test('signed in comes from the scanner\'s note: a window closed before signing in doesn\'t count', async () => {
  assert.equal((await status()).checks.signedIn, false, 'nothing here yet');
  // The window opened (Chrome made its cookie file), and the scanner waited for a sign-in that never came.
  cookies();
  note(false);
  assert.equal((await status()).checks.signedIn, false);
  // Signed in: the scanner confirmed the session.
  note(true);
  assert.equal((await status()).checks.signedIn, true);
  // The scanner's Chrome profile deleted: signed out, whatever the note says.
  rmSync(profile, { recursive: true, force: true });
  assert.equal((await status()).checks.signedIn, false);
});

test('a data folder from before the note keeps the old check, so nobody signed in is told they\'re not', async () => {
  cookies();
  assert.equal((await status()).checks.signedIn, true);
  // Windows' Chrome keeps the cookie file one folder down (TRAPS §44).
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(path.join(profile, 'Default', 'Network'), { recursive: true });
  writeFileSync(path.join(profile, 'Default', 'Network', 'Cookies'), 'a stand-in');
  assert.equal((await status()).checks.signedIn, true);
  // A note that can't be read counts as none.
  writeFileSync(path.join(HOME, 'signed-in.json'), '{ half a fi');
  assert.equal((await status()).checks.signedIn, true);
});

// ── whose circle is filling in ──────────────────────────────────────────────

test('a batch\'s current person, found among your connections, for "Watch it fill in"', async () => {
  const state = registerScanState({});
  Object.assign(state, {
    running: true, action: 'auto-bridge', startedAt: 1000,
    log: ['Mapping every bridge in turn…', '[1/5] Mira Calloway (A-tier, score 6.4)', '  Page 1... 10 found (total: 10)'],
  });
  assert.deepEqual((await status()).mapping, { id: 'p-mira', name: 'Mira Calloway' });

  // Two connections with that name: neither is named, rather than the wrong one.
  state.log.push('[2/5] Tobin Ashgrove (B-tier, score 4.0)');
  assert.equal((await status()).mapping, null);

  // One person's scan knows its target.
  Object.assign(state, { action: 'bridge', target: { id: 'p-tobin-2', name: 'Tobin Ashgrove' }, log: ['Mapping the circle behind Tobin Ashgrove…'] });
  assert.deepEqual((await status()).mapping, { id: 'p-tobin-2', name: 'Tobin Ashgrove' });

  // Nothing running, or a job that reads no circle: nobody.
  Object.assign(state, { action: 'full', target: null, log: ['Scanning your whole network…'] });
  assert.equal((await status()).mapping, null);
  Object.assign(state, { running: false, action: 'auto-bridge', log: ['[1/5] Mira Calloway (A-tier, score 6.4)'] });
  assert.equal((await status()).mapping, null);
});
