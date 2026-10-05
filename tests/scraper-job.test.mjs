// /api/scraper's two small answers, for the Scan buttons outside the Scan page:
// ?job=1, what runs (and whose scan it is), from memory; and ?resume=<id>,
// where a profile card's Resume would carry on. And a second job is still
// refused while one runs, saying which. On a temporary data folder, never the
// real one. Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-scraper-job-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js
// chromeInstalled): without it the server refuses every scan (tests/first-run.test.mjs).
process.env.SIX_DEGREES_TEST_CHROME = 'found';

let GET, POST, getDb, registerScanState;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ registerScanState } = await import('../lib/scan-state.js'));
  // The one-time "I understand" (lib/scan-risk.js) was given in this folder.
  const { writeSettings } = await import('../lib/settings.js');
  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'users']) getDb().exec(`DELETE FROM ${t}`);
  rmSync(path.join(dir, 'bridge-progress.json'), { force: true });
  Object.assign(registerScanState({}), { running: false, action: null, target: null, recent: [], log: [], startedAt: null, exitCode: null, pages: 0, found: [] });
});

const ask = async (query) => (await GET(new Request(`http://127.0.0.1/api/scraper${query}`))).json();

test('?job=1 says what runs and whose scan it is, and how the last jobs ended', async () => {
  assert.deepEqual(await ask('?job=1'), {
    running: false, action: null, target: null, startedAt: null, exitCode: null,
    failure: null, progress: null, pages: 0, found: [], log: [], recent: [], budget: null, needsYou: null,
    queue: { paused: null, cap: 10, waiting: 0, items: [] },
  });

  const state = registerScanState({});
  Object.assign(state, {
    running: true, action: 'bridge', target: { id: 'p-ada', name: 'Ada Park' }, startedAt: 1000,
    log: ['Mapping the circle behind Ada Park…'],
    pages: 7,   // the header's dots (app/components/ScanTrail.js)
    found: [10, 10, 9],
    recent: [{ action: 'company', target: { id: null, name: 'Initech' }, startedAt: 900, exitCode: 0, failure: null }],
  });
  const job = await ask('?job=1');
  assert.equal(job.running, true);
  assert.deepEqual(job.target, { id: 'p-ada', name: 'Ada Park' });
  assert.equal(job.pages, 7);
  assert.deepEqual(job.found, [10, 10, 9]);
  assert.deepEqual(job.recent.map((j) => [j.startedAt, j.exitCode]), [[900, 0]]);
  assert.equal(job.needsYou, null, 'LinkedIn needs nothing of you yet');
  // The scanner's Chrome came forward for a sign-in: what for, from its own line (lib/scan-progress.js).
  state.log = [...state.log, 'LinkedIn needs you: sign in to LinkedIn in the Chrome window in front.', '  waiting for sign-in... (15s)'];
  assert.equal((await ask('?job=1')).needsYou, 'sign in to LinkedIn in the Chrome window in front.');
  state.log = [...state.log, '  Signed in, LinkedIn is clear.'];
  assert.equal((await ask('?job=1')).needsYou, null);

  // A second scan is refused while it runs, naming what does.
  const res = await POST(new Request('http://127.0.0.1/api/scraper', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'bridge', name: 'Ben Ortiz' }),
  }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'Something is already running.', action: 'bridge' });
});

test('?resume=<id> is where Resume carries on: the Paused list\'s rules, for one person', async () => {
  const db = getDb();
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, profile_url, source_connection_id)
                          VALUES (?, 'me', ?, ?, ?, ?)`);
  add.run('p-ada', 1, 'Ada Park', 'https://www.linkedin.com/in/ada-park', null);    // read to page 27 of more
  add.run('p-ben', 1, 'Ben Ortiz', 'https://www.linkedin.com/in/ben-ortiz', null);  // read to the end
  add.run('p-cy', 1, 'Cy Moreno', 'https://www.linkedin.com/in/cy-moreno', null);   // mapped before notes: page 10
  add.run('p-di', 1, 'Di Lang', 'https://www.linkedin.com/in/di-lang', null);       // never mapped
  add.run('d2-1', 2, 'Eve Stone', 'https://www.linkedin.com/in/eve-stone', 'p-ada');
  add.run('d2-2', 2, 'Fay Quinn', 'https://www.linkedin.com/in/fay-quinn', 'p-ben');
  add.run('d2-3', 2, 'Gus Hale', 'https://www.linkedin.com/in/gus-hale', 'p-cy');
  writeFileSync(path.join(dir, 'bridge-progress.json'), JSON.stringify({ me: {
    'https://www.linkedin.com/in/ada-park': { pages: 27, more: true, at: '2026-09-27T10:00:00' },
    'https://www.linkedin.com/in/ben-ortiz': { pages: 34, more: false },
  } }));

  assert.deepEqual(await ask('?resume=p-ada'), { resume: { nextPage: 28, pagesRead: 27, legacy: false } });
  assert.deepEqual(await ask('?resume=p-ben'), { resume: null });
  assert.deepEqual(await ask('?resume=p-cy'), { resume: { nextPage: 11, pagesRead: 10, legacy: true } });
  assert.deepEqual(await ask('?resume=p-di'), { resume: null });
  assert.deepEqual(await ask('?resume=nobody'), { resume: null });
  // Only your own 1st degree: a 2nd-degree row has no list of yours to carry on with.
  assert.deepEqual(await ask('?resume=d2-1'), { resume: null });
});
