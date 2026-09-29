// Whose list a circle scan reads (/api/scraper POST).
//
// Every Scan button sends the person's id, and the scan went by their name,
// which the scanner looks up and takes the first connection it finds. With two
// connections called Dalia Fenmoor, the Scan page confirmed one and the scanner
// read the other's list: a profile view and up to 100 searches on the wrong
// person, while the page said the right one's circle was being scanned. The id's
// profile URL is now looked up here, as Resume's is, and a scan reads that list
// from page 1 (--from-start); Resume carries on.
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

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scan-by-id-'));
const ARGS = path.join(dir, 'args.txt');
process.env.SIX_DEGREES_HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
mkdirSync(process.env.SIX_DEGREES_HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done > '${ARGS}'`,
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
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

test('a scan of someone picked by id reads their list, found by profile URL, from page 1', async () => {
  const res = await post({ action: 'bridge', id: 'p-dalia-2', name: 'Dalia Fenmoor', maxPages: 25 });
  assert.equal(res.status, 200);
  assert.deepEqual(await scannerArgs(),
    ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--from-start', '--max-pages=25']);
  const { target, log } = await job();
  assert.deepEqual(target, { id: 'p-dalia-2', name: 'Dalia Fenmoor' });
  assert.equal(log[0], 'Mapping the circle behind Dalia Fenmoor…');

  // The other Dalia Fenmoor, by her id: her own list.
  await post({ action: 'bridge', id: 'p-dalia-1', name: 'Dalia Fenmoor' });
  assert.deepEqual(await scannerArgs(),
    ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-1', '--from-start', '--max-pages=100']);
});

test('carrying on with someone picked by id leaves out --from-start', async () => {
  await post({ action: 'bridge', id: 'p-dalia-2', deeper: true });
  assert.deepEqual(await scannerArgs(),
    ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=100', '--deeper']);
});

test('Resume carries on where the last read stopped, to the end of the list', async () => {
  await post({ action: 'resume', id: 'p-dalia-2', maxPages: 10 });
  assert.deepEqual(await scannerArgs(), ['--bridge-url=https://www.linkedin.com/in/dalia-fenmoor-2', '--max-pages=100']);
  assert.equal((await job()).log[0], 'Carrying on with Dalia Fenmoor…');
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
