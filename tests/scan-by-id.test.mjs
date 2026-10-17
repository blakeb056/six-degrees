// Whose list a circle scan reads (/api/scraper POST).
//
// Every Scan button sends the person's id, and the scan went by their name,
// which the scanner looks up and takes the first connection it finds. With two
// connections called Dalia Fenmoor, the Scan page confirmed one and the scanner
// read the other's list: a profile view and up to 100 searches on the wrong
// person, while the page said the right one's circle was being scanned. The id's
// profile URL is now looked up here, as Resume's is, and a scan reads that list
// from page 1 (--from-start); Resume carries on. Since 2026-10-16 each is one
// round of their list (lib/scan-rounds.js): 25 pages, or 50, from where the last
// stopped, so a Scan on someone part read carries on too.
//
// The scanner is a stand-in. SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python and writes down what it is started with,
// and SIX_DEGREES_ROOT a folder whose scrape.py stops at once if a real Python
// ever runs it. Nothing opens a browser or reaches LinkedIn. On a temporary
// data folder, never the real one. Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standInRoot } from './helpers/scanner.mjs';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scan-by-id-'));
const ARGS = path.join(dir, 'args.txt');
process.env.SIX_DEGREES_HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js
// chromeInstalled): without it the server refuses every scan (tests/first-run.test.mjs).
process.env.SIX_DEGREES_TEST_CHROME = 'found';
mkdirSync(process.env.SIX_DEGREES_HOME);
standInRoot(path.join(dir, 'root'));
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done > '${ARGS}'`,
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb, writeSettings;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  // The one-time "I understand" (lib/scan-risk.js) was given in this folder.
  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  rmSync(ARGS, { force: true });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url, source_connection_id, unlocked_from_bridge_id)
                          VALUES (?, 'me', ?, ?, ?, ?, ?)`);
  // Two connections share a name; a lookup by name finds the one saved first.
  add.run('p-dalia-1', 1, 'Dalia Fenmoor', 'https://www.linkedin.com/in/dalia-fenmoor-1', null, null);
  add.run('p-oriel', 1, 'Oriel Vantasse', 'https://www.linkedin.com/in/oriel-vantasse', null, null);
  // The other, found in Oriel's circle and connected since: ready for a scan.
  add.run('p-dalia-2', 1, 'Dalia Fenmoor', 'https://www.linkedin.com/in/dalia-fenmoor-2', null, 'p-oriel');
  add.run('d2-pax', 2, 'Pax Wendover', 'https://www.linkedin.com/in/pax-wendover', 'p-oriel', null);
});

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();

/** What the stand-in scanner was started with, after scrape.py, once the job has ended. */
async function scannerArgs() {
  for (let i = 0; i < 200 && (await job()).running; i++) await new Promise((r) => setTimeout(r, 25));
  const args = readFileSync(ARGS, 'utf8').trim().split('\n');
  return args.slice(args.findIndex((a) => a.endsWith('scrape.py')) + 1);
}

const ROUND_1 = ['--from-start', '--max-pages=25', '--round=25'];

test('a scan of someone picked by id reads their list, found by profile URL, from page 1: one round', async () => {
  const res = await post({ action: 'bridge', id: 'p-dalia-2', name: 'Dalia Fenmoor', maxPages: 25 });
  assert.equal(res.status, 200);
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1]);
  const { target, log } = await job();
  assert.deepEqual(target, { id: 'p-dalia-2', name: 'Dalia Fenmoor' });
  assert.equal(log[0], 'Mapping the circle behind Dalia Fenmoor…');
  assert.equal(log[1], 'A round of 25 pages: from page 1, to page 25 at most.');

  // The other Dalia Fenmoor, by her id: her own list.
  await post({ action: 'bridge', id: 'p-dalia-1', name: 'Dalia Fenmoor' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-1', ...ROUND_1]);
});

// The guided setup's first scan (Blake, 2026-10-14): three pages of the circle
// it picked, by id, gentle on a new account. Any other number reads every page,
// as before: the pages are a fixed set, like everything on the command line.
test('the setup\'s first scan reads three pages of the circle picked by id, and no other number gets through', async () => {
  const { FIRST_SCAN_PAGES } = await import('../lib/onboarding.js');
  const res = await post({ action: 'bridge', id: 'p-dalia-2', name: 'Dalia Fenmoor', maxPages: FIRST_SCAN_PAGES });
  assert.equal(res.status, 200);
  assert.deepEqual(await scannerArgs(),
    ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--from-start', '--max-pages=3', '--round=3']);
  for (const maxPages of [4, 2, '3', 0, -3, 3.5, 100]) {
    assert.equal((await post({ action: 'bridge', id: 'p-dalia-2', maxPages })).status, 200);
    assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1], String(maxPages));
  }
});

test('nothing opens LinkedIn before the one-time "I understand", whichever button asks', async () => {
  const profile = path.join(process.env.SIX_DEGREES_HOME, 'chrome-profile');
  writeSettings(getDb(), { scanRiskAccepted: null });
  try {
    for (const body of [{ action: 'bridge', id: 'p-dalia-2' }, { action: 'login' }, { action: 'refresh' }]) {
      const res = await post(body);
      assert.equal(res.status, 409, body.action);
      const d = await res.json();
      assert.equal(d.needsRiskAcceptance, true);
      assert.match(d.error, /Scan page/);
    }
    assert.equal(existsSync(ARGS), false, 'nothing was started');
    assert.equal((await job()).running, false);

    // Someone who scanned before this existed (the scanner's own Chrome profile is here) isn't asked.
    mkdirSync(profile);
    assert.equal((await post({ action: 'bridge', id: 'p-dalia-2' })).status, 200);
    assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1]);
  } finally {
    rmSync(profile, { recursive: true, force: true });
    writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  }
  // Given on the Scan page: it starts.
  assert.equal((await post({ action: 'bridge', id: 'p-dalia-2' })).status, 200);
  await scannerArgs();
});

const PROGRESS = path.join(process.env.SIX_DEGREES_HOME, 'bridge-progress.json');
const LIMITS = path.join(process.env.SIX_DEGREES_HOME, 'scan-limits.json');
const noted = (notes) => writeFileSync(PROGRESS, JSON.stringify({ me: notes }));

test('a Scan on someone part read carries on with their next round, leaving out --from-start; Rescan starts again', async (t) => {
  t.after(() => rmSync(PROGRESS, { force: true }));
  noted({ 'https://www.linkedin.com/in/dalia-fenmoor-2': { pages: 25, more: true } });
  await post({ action: 'bridge', id: 'p-dalia-2' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=50', '--round=25']);
  assert.equal((await job()).log[1], 'A round of 25 pages: from page 26, to page 50 at most.');
  // The old "carry on" switch changes nothing now: the note decides.
  await post({ action: 'bridge', id: 'p-dalia-2', deeper: true });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=50', '--round=25']);
  // Rescan from the start: page 1, one round.
  await post({ action: 'bridge', id: 'p-dalia-2', fromStart: true });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1]);
  // Read to the end: a Scan is a rescan from page 1.
  noted({ 'https://www.linkedin.com/in/dalia-fenmoor-2': { pages: 40, more: false } });
  await post({ action: 'bridge', id: 'p-dalia-2' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1]);
});

test('Scan next round (Resume) carries on where the last round stopped, one round, whatever pages are asked', async (t) => {
  t.after(() => rmSync(PROGRESS, { force: true }));
  // No note: mapped before notes were kept, read to page 10.
  await post({ action: 'resume', id: 'p-dalia-2', maxPages: 10 });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=35', '--round=25']);
  assert.equal((await job()).log[0], 'Carrying on with Dalia Fenmoor…');
  noted({ 'https://www.linkedin.com/in/dalia-fenmoor-2': { pages: 0, more: true, readPages: [[2, 14]] } });
  await post({ action: 'resume', id: 'p-dalia-2' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=25', '--round=25']);
});

test('rounds of 50 when Scanner settings say so, the most', async (t) => {
  t.after(() => { rmSync(PROGRESS, { force: true }); rmSync(LIMITS, { force: true }); });
  writeFileSync(LIMITS, JSON.stringify({ roundPages: 50 }));
  await post({ action: 'bridge', id: 'p-dalia-2' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--from-start', '--max-pages=50', '--round=50']);
  noted({ 'https://www.linkedin.com/in/dalia-fenmoor-2': { pages: 80, more: true } });
  await post({ action: 'resume', id: 'p-dalia-2' });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=100', '--round=50'],
    'never past page 100');
});

test('a name alone still scans by name, for a caller with no id', async () => {
  await post({ action: 'bridge', name: 'Oriel Vantasse' });
  assert.deepEqual(await scannerArgs(), ['--bridge=Oriel Vantasse', '--max-pages=100']);
});

test('an id that is not one of your connections starts nothing, whatever name comes with it', async () => {
  for (const id of ['nobody', 'd2-pax']) {
    const res = await post({ action: 'bridge', id, name: 'Dalia Fenmoor' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'That connection could not be found.' });
  }
  assert.equal((await job()).running, false);
  assert.equal(existsSync(ARGS), false);
});

// Blake, 2026-10-04: no pop-ups and no windows unless they're needed. The
// scanner's Chrome stays out of sight by default; Fine-tune's "Show the
// scanner's Chrome window" sends showWindow, which becomes --show-window. The
// old "Hide the Chrome window" (headless) is gone: a stale page sending it
// starts the same out-of-sight scan, never a headless one.
test('the window: out of sight unless asked to show it; never headless from the app; sign-in always in front', async () => {
  assert.equal((await post({ action: 'refresh', showWindow: true })).status, 200);
  assert.deepEqual(await scannerArgs(), ['--refresh', '--show-window']);
  assert.equal((await post({ action: 'refresh' })).status, 200);
  assert.deepEqual(await scannerArgs(), ['--refresh']);
  assert.equal((await post({ action: 'refresh', headless: true })).status, 200);
  assert.deepEqual(await scannerArgs(), ['--refresh']);
  assert.equal((await post({ action: 'bridge', id: 'p-dalia-2', showWindow: true })).status, 200);
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', ...ROUND_1, '--show-window']);
  // Signing in is in front whatever the switch says (scripts/scrape.py launch_chrome sign_in=True).
  assert.equal((await post({ action: 'login', showWindow: true })).status, 200);
  assert.deepEqual(await scannerArgs(), ['--login']);
});
