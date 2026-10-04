// Auto through the app (/api/scraper POST {action: 'connect', id}): who it is
// sent to, everything that refuses it before a process starts, and what a
// finished request leaves behind. Blake, 2026-10-03: "auto add and basically
// adds the person for them in the card or wherever its available".
//
// The scanner is a stand-in. SIX_DEGREES_PYTHON names a shell script that
// answers the app's look for a Python, writes down what it was started with,
// and prints the result line a real run would ("Connect result: …"), taken from
// a file the test writes. Nothing opens a browser or reaches LinkedIn. On a
// temporary data folder, never the real one. Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-auto-route-'));
const HOME = path.join(dir, 'home');
const ARGS = path.join(dir, 'args.txt');
const RESULT = path.join(dir, 'result.txt');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_ROOT = path.join(dir, 'root');
process.env.SIX_DEGREES_PYTHON = path.join(dir, 'python');
// Google Chrome is here, whatever the computer running this has (lib/scanner-setup.js chromeInstalled).
process.env.SIX_DEGREES_TEST_CHROME = 'found';
mkdirSync(HOME);
mkdirSync(path.join(dir, 'root', 'scripts'), { recursive: true });
writeFileSync(path.join(dir, 'root', 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
writeFileSync(process.env.SIX_DEGREES_PYTHON, [
  '#!/bin/sh',
  'for a in "$@"; do [ "$a" = "-c" ] && { echo "version 3.12.4"; echo venv; echo imports; exit 0; }; done',
  `for a in "$@"; do printf '%s\\n' "$a"; done > '${ARGS}'`,
  `[ -f '${RESULT}' ] && echo "Connect result: $(cat '${RESULT}')"`,
  'exit 0',
  '',
].join('\n'));
chmodSync(process.env.SIX_DEGREES_PYTHON, 0o755);

let GET, POST, getDb, writeSettings;

before(async () => {
  ({ GET, POST } = await import('../app/api/scraper/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ writeSettings } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (slug) => `https://www.linkedin.com/in/${slug}`;

beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users', 'user_stats']) db.exec(`DELETE FROM ${t}`);
  for (const f of [ARGS, RESULT, 'linkedin-activity.json', 'linkedin-cooldown.json']) rmSync(path.isAbsolute(f) ? f : path.join(HOME, f), { force: true });
  // Both one-time yeses given: the scan's, and Auto's own.
  writeSettings(db, { scanRiskAccepted: '2026-10-03T00:00:00.000Z', autoConnectAccepted: '2026-10-03T00:00:00.000Z' });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url, source_connection_id, unlock_status, outreach_status)
                          VALUES (?, 'me', ?, ?, ?, ?, ?, ?, ?)`);
  add.run('p-oriel', 1, 'Oriel Vantasse', 'A', url('oriel-vantasse'), null, null, null);
  add.run('p-maren', 1, 'Maren Holt', 'B', url('maren-holt'), null, null, null);
  // Ada is in two circles: one person, two rows.
  add.run('d2-ada@oriel', 2, 'Ada Quill', 'S', url('ada-quill'), 'p-oriel', 'locked', null);
  add.run('d2-ada@maren', 2, 'Ada Quill', 'S', url('ada-quill'), 'p-maren', 'locked', null);
  // Already asked through Maren's circle.
  add.run('d2-ben@oriel', 2, 'Ben Ostrander', 'A', url('ben-ostrander'), 'p-oriel', 'locked', null);
  add.run('d2-ben@maren', 2, 'Ben Ostrander', 'A', url('ben-ostrander'), 'p-maren', 'pending', 'sent');
  // In Oriel's circle, and since connected with you directly.
  add.run('d2-cy@oriel', 2, 'Cy Moreno', 'B', url('cy-moreno'), 'p-oriel', 'locked', null);
  add.run('p-cy', 1, 'Cy Moreno', 'B', url('cy-moreno'), null, null, null);
  // No profile on file.
  add.run('d2-dee@oriel', 2, 'Dee Lark', 'C', '', 'p-oriel', 'locked', null);
});

const post = (body) => POST(new Request('http://127.0.0.1/api/scraper', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const job = async () => (await GET(new Request('http://127.0.0.1/api/scraper?job=1'))).json();

/** Wait for the job to end; then what the stand-in scanner was started with, after scrape.py. */
async function ended() {
  for (let i = 0; i < 200 && (await job()).running; i++) await new Promise((r) => setTimeout(r, 25));
  const args = readFileSync(ARGS, 'utf8').trim().split('\n');
  return { args: args.slice(args.findIndex((a) => a.endsWith('scrape.py')) + 1), job: await job() };
}

const rows = (slug) => getDb().prepare(
  'SELECT id, outreach_status, unlock_status, unlocked_from_bridge_id FROM linkedin_connections WHERE profile_url = ? ORDER BY id',
).all(url(slug)).map((r) => ({ ...r }));

test('Auto sends to the person picked by id, with the URL and name from the database, never the request', async () => {
  writeFileSync(RESULT, 'sent');
  const res = await post({ action: 'connect', id: 'd2-ada@oriel', name: '--full', profileUrl: 'https://example.com/in/someone-else' });
  assert.equal(res.status, 200);
  const { args, job: done } = await ended();
  assert.deepEqual(args, [`--connect=${url('ada-quill')}`, '--connect-name=Ada Quill']);
  assert.deepEqual(done.recent[0].target, { id: 'd2-ada@oriel', name: 'Ada Quill' });
  assert.equal(done.log[0], 'Sending a connection request to Ada Quill…');
});

test('a sent request is marked on every copy of them, through the circle it was sent from, and says so', async () => {
  writeFileSync(RESULT, 'sent');
  assert.equal((await post({ action: 'connect', id: 'd2-ada@oriel' })).status, 200);
  const { job: done } = await ended();
  assert.equal(done.recent[0].outcome, 'sent');
  assert.equal(done.recent[0].exitCode, 0);
  assert.ok(done.log.includes('Marked as sent in Six Degrees.'), done.log.join('\n'));
  assert.deepEqual(rows('ada-quill'), [
    { id: 'd2-ada@maren', outreach_status: 'sent', unlock_status: 'pending', unlocked_from_bridge_id: 'p-oriel' },
    { id: 'd2-ada@oriel', outreach_status: 'sent', unlock_status: 'pending', unlocked_from_bridge_id: 'p-oriel' },
  ]);
  // The same store as the Connect button: the Outlink Pending list has her.
  const { GET: outreach } = await import('../app/api/outreach/route.js');
  const pending = await (await outreach(new Request('http://127.0.0.1/api/outreach?userId=me'))).json();
  assert.ok(pending.pending.some((p) => p.profile_url === url('ada-quill')));
});

test('already pending on LinkedIn is marked too; anything unclear, or a failed run, marks nothing', async () => {
  writeFileSync(RESULT, 'already-pending');
  await post({ action: 'connect', id: 'd2-ada@oriel' });
  let { job: done } = await ended();
  assert.equal(done.recent[0].outcome, 'already-pending');
  assert.equal(rows('ada-quill')[0].outreach_status, 'sent');

  for (const result of ['unclear', 'email-needed', 'no-connect', 'not-sent']) {
    getDb().prepare("UPDATE linkedin_connections SET outreach_status = NULL, unlock_status = 'locked', unlocked_from_bridge_id = NULL WHERE profile_url = ?").run(url('ada-quill'));
    writeFileSync(RESULT, result);
    assert.equal((await post({ action: 'connect', id: 'd2-ada@oriel' })).status, 200, result);
    ({ job: done } = await ended());
    assert.equal(done.recent[0].outcome, result);
    assert.ok(rows('ada-quill').every((r) => r.outreach_status === null && r.unlock_status === 'locked'), `${result} marks nothing`);
    assert.ok(!done.log.includes('Marked as sent in Six Degrees.'));
  }

  // A line that isn't a result the scanner prints is no result at all.
  writeFileSync(RESULT, 'sent-ish');
  await post({ action: 'connect', id: 'd2-ada@oriel' });
  ({ job: done } = await ended());
  assert.equal(done.recent[0].outcome, null);
  assert.ok(rows('ada-quill').every((r) => r.outreach_status === null));
});

test('who can’t be sent one: unknown, already a connection, already asked, no profile on file', async () => {
  const cases = [
    [{ id: 'nobody' }, 400, 'That person could not be found.'],
    [{}, 400, 'That person could not be found.'],
    [{ id: 'p-oriel' }, 409, 'Oriel Vantasse is already one of your connections.'],
    [{ id: 'd2-cy@oriel' }, 409, 'Cy Moreno is already one of your connections.'],
    [{ id: 'd2-ben@oriel' }, 409, 'A request to Ben Ostrander is already out.'],
    [{ id: 'd2-dee@oriel' }, 400, 'There is no LinkedIn profile on file for Dee Lark.'],
  ];
  for (const [body, status, error] of cases) {
    const res = await post({ action: 'connect', ...body });
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal((await res.json()).error, error);
  }
  assert.equal(existsSync(ARGS), false, 'nothing was started');
});

test('nothing starts before Auto’s one-time yes, nor before the scan’s, nor without Chrome', async () => {
  writeSettings(getDb(), { autoConnectAccepted: null });
  let res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  let d = await res.json();
  assert.equal(d.needsAutoAcceptance, true);
  assert.match(d.error, /asks once/);

  writeSettings(getDb(), { autoConnectAccepted: '2026-10-03T00:00:00.000Z', scanRiskAccepted: null });
  res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).needsRiskAcceptance, true);

  writeSettings(getDb(), { scanRiskAccepted: '2026-10-03T00:00:00.000Z' });
  process.env.SIX_DEGREES_TEST_CHROME = 'missing';
  try {
    res = await post({ action: 'connect', id: 'd2-ada@oriel' });
    assert.equal(res.status, 409);
    d = await res.json();
    assert.equal(d.needsChrome, true);
  } finally {
    process.env.SIX_DEGREES_TEST_CHROME = 'found';
  }
  assert.equal(existsSync(ARGS), false);
});

test('a pause after LinkedIn pushed back, Auto’s caps, and no profile views left each refuse it first', async () => {
  const now = Date.now() / 1000;
  writeFileSync(path.join(HOME, 'linkedin-cooldown.json'), JSON.stringify({ until: now + 3600, reason: 'LinkedIn pushed back: a security check', set_at: now }));
  let res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Scanning is paused until .+: LinkedIn pushed back: a security check\.$/);
  rmSync(path.join(HOME, 'linkedin-cooldown.json'));

  const activity = (lists) => writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({ searches: [], profiles: [], ...lists }));
  activity({ invites: Array.from({ length: 15 }, (_, i) => now - 60 * i) });
  res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /^Auto has sent 15 requests in the last 24 hours, its limit\. The next one frees up /);

  activity({ invites: Array.from({ length: 80 }, (_, i) => now - 2 * 86400 - 60 * i) });
  res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /80 requests in the last 7 days, its limit/);

  activity({ profiles: Array.from({ length: 50 }, (_, i) => now - 60 * i) });
  res = await post({ action: 'connect', id: 'd2-ada@oriel' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /profile views are used/);

  // Fourteen in a day is still one to go.
  activity({ invites: Array.from({ length: 14 }, (_, i) => now - 60 * i) });
  writeFileSync(RESULT, 'sent');
  assert.equal((await post({ action: 'connect', id: 'd2-ada@oriel' })).status, 200);
  await ended();
});

test('one thing at a time: Auto waits for a running scan, and says which', async () => {
  const { registerScanState } = await import('../lib/scan-state.js');
  const state = registerScanState({});
  const was = { running: state.running, action: state.action };
  Object.assign(state, { running: true, action: 'bridge' });
  try {
    const res = await post({ action: 'connect', id: 'd2-ada@oriel' });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'A scan is running. Press Auto again once it has finished.', action: 'bridge' });
  } finally {
    Object.assign(state, was);
  }
});

test('the usage record counts Auto’s requests, for Settings and for the caps', async () => {
  const now = Date.now();
  const s = now / 1000;
  writeFileSync(path.join(HOME, 'linkedin-activity.json'), JSON.stringify({
    searches: [], profiles: [], invites: [s - 60, s - 3600, s - 2 * 86400, s - 8 * 86400],
  }));
  const u = await (await GET(new Request('http://127.0.0.1/api/scraper?usage=1'))).json();
  assert.equal(u.invitesToday, 2);
  assert.equal(u.invitesWeek, 3);
  assert.deepEqual(u.inviteCaps, { day: 15, week: 80 });
  assert.equal(u.invitesFreeAt, null);
});
