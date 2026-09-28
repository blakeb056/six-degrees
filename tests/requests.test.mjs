// A request you've sent belongs to the PERSON, everywhere at once.
//
// The route (app/api/outreach/route.js) marks every copy of someone (one row
// per bridge that knows them), in both columns a request writes, keeps the
// bridge you asked through, awards XP once per person, and Undo takes all of it
// back. The page side (lib/requests-client.js) is one list every view reads:
// what this page did wins, then the list as loaded, then the rows' own columns.
// On a temporary database, never the real one. Invented people.

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-requests-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let POST, GET, getDb;
before(async () => {
  ({ POST, GET } = await import('../app/api/outreach/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (id) => `https://www.linkedin.com/in/${id}`;
beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users', 'user_stats']) db.exec(`DELETE FROM ${t}`);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url, source_connection_id, unlock_status)
                          VALUES (?, 'me', ?, ?, ?, ?, ?, ?)`);
  add.run('maya', 1, 'Maya Chen', 'A', url('maya'), null, 'locked');
  add.run('zoe', 1, 'Zoe Park', 'B', url('zoe'), null, 'locked');
  add.run('ada@maya', 2, 'Ada Stone', 'S', url('ada'), 'maya', 'locked');
  add.run('ada@zoe', 2, 'Ada Stone', 'S', url('ada'), 'zoe', 'locked');
  add.run('ben@maya', 2, 'Ben Ortiz', 'B', url('ben'), 'maya', 'locked');
});

const send = async (body) => (await POST(new Request('http://127.0.0.1/api/outreach', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))).json();
const copies = (id) => getDb().prepare(
  'SELECT id, outreach_status, unlock_status, unlocked_from_bridge_id, unlocked_from_name FROM linkedin_connections WHERE profile_url = ? ORDER BY id',
).all(url(id));
const xp = () => getDb().prepare("SELECT xp FROM user_stats WHERE id = 'me'").get()?.xp ?? 0;

test('a request marks every copy of the person, in both columns, and keeps who you asked through', async () => {
  const r = await send({ action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  assert.deepEqual([r.saved, r.xp, r.already], [2, 25, false]);
  assert.deepEqual(copies('ada').map((c) => [c.id, c.outreach_status, c.unlock_status, c.unlocked_from_bridge_id, c.unlocked_from_name]), [
    ['ada@maya', 'sent', 'pending', 'maya', 'Maya Chen'],
    ['ada@zoe', 'sent', 'pending', 'maya', 'Maya Chen'],
  ]);
  assert.equal(copies('ben')[0].outreach_status, null, 'nobody else is touched');
  assert.equal(xp(), 25);
});

test('XP once per person: a second click, or a click on another copy, gives none', async () => {
  await send({ action: 'mark-sent', connectionId: 'ada@maya' });
  assert.equal((await send({ action: 'mark-sent', connectionId: 'ada@zoe' })).xp, 0);
  assert.equal((await send({ action: 'mark-sent', profileUrl: url('ada') })).already, true);
  assert.equal(xp(), 25);
});

test('Undo takes all of it back: both columns, every copy, and the XP', async () => {
  await send({ action: 'mark-sent', connectionId: 'ada@zoe', bridgeId: 'zoe' });
  const r = await send({ action: 'undo', profileUrl: url('ada') });
  assert.deepEqual([r.saved, r.xp], [2, -25]);
  assert.deepEqual(copies('ada').map((c) => [c.outreach_status, c.unlock_status]), [[null, 'locked'], [null, 'locked']]);
  assert.equal(xp(), 0);
  // Never below zero, even for a request sent before sends gave XP.
  getDb().prepare("UPDATE linkedin_connections SET outreach_status = 'sent' WHERE id = 'ben@maya'").run();
  await send({ action: 'undo', connectionId: 'ben@maya' });
  assert.equal(xp(), 0);
});

test('the bridge must be one of your connections, and an origin already kept is never overwritten', async () => {
  await send({ action: 'mark-sent', connectionId: 'ben@maya', bridgeId: 'ada@zoe' });   // not a 1st-degree row
  assert.equal(copies('ben')[0].unlocked_from_bridge_id, null);
  await send({ action: 'undo', connectionId: 'ben@maya' });
  await send({ action: 'mark-sent', connectionId: 'ben@maya', bridgeId: 'maya' });
  await send({ action: 'undo', connectionId: 'ben@maya' });
  await send({ action: 'mark-sent', connectionId: 'ben@maya', bridgeId: 'zoe' });
  assert.equal(copies('ben')[0].unlocked_from_bridge_id, 'maya');
});

test('an accepted connection is never pulled back to pending, and nobody on file is not an error', async () => {
  getDb().prepare("UPDATE linkedin_connections SET unlock_status = 'unlocked', outreach_status = 'accepted' WHERE id = 'ada@maya'").run();
  await send({ action: 'mark-sent', connectionId: 'ada@zoe' });
  assert.deepEqual(copies('ada').map((c) => [c.id, c.outreach_status, c.unlock_status]), [
    ['ada@maya', 'accepted', 'unlocked'],
    ['ada@zoe', 'sent', 'pending'],
  ]);
  assert.deepEqual(await send({ action: 'mark-sent', profileUrl: url('nobody') }), { success: true, saved: 0, xp: 0 });
  assert.equal((await POST(new Request('http://127.0.0.1/api/outreach', { method: 'POST', body: JSON.stringify({ action: 'nope' }) }))).status, 400);
});

test('the list of requests out has each person once, whichever column said so', async () => {
  await send({ action: 'mark-sent', connectionId: 'ada@maya' });
  // A pending invitation the scanner found (it writes unlock_status only).
  getDb().prepare("UPDATE linkedin_connections SET unlock_status = 'pending' WHERE id = 'ben@maya'").run();
  const { pending } = await (await GET(new Request('http://127.0.0.1/api/outreach'))).json();
  assert.deepEqual(pending.map((p) => p.name).sort(), ['Ada Stone', 'Ben Ortiz']);
});

// ── The page side ──────────────────────────────────────────────────────────

let fresh = 0;
const client = () => import(`../lib/requests-client.js?test=${++fresh}`);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
afterEach(() => { delete globalThis.fetch; });

function fakeServer(pending = [], { failPosts = false } = {}) {
  const posts = [];
  globalThis.fetch = async (u, opts = {}) => {
    if (opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return failPosts
        ? { ok: false, status: 500, json: async () => ({ error: 'The app is restarting.' }) }
        : { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ pending }) };
  };
  return posts;
}

const row = (id, extra = {}) => ({ id: `${id}@maya`, name: id, profile_url: url(id), ...extra });

test('every view reads one list: loaded once, then what this page did wins', async () => {
  fakeServer([row('ada')]);
  const { watchRequests, requestsNow, hasRequest, requestCount, markRequested, undoRequest } = await client();
  // Until the list arrives, a row's own columns stand in.
  assert.equal(hasRequest(row('ben', { outreach_status: 'sent' })), true);
  const stop = watchRequests(() => {});
  await flush();
  assert.equal(requestsNow().known, true);
  assert.equal(hasRequest(row('ada')), true);
  assert.equal(hasRequest({ ...row('ada'), id: 'ada@zoe' }), true, 'every copy of the person');
  assert.equal(hasRequest(row('ben', { outreach_status: 'sent' })), false, 'the list wins over a stale row');
  await markRequested(row('ben'), { bridgeId: 'maya' });
  await undoRequest(row('ada'));
  assert.deepEqual([hasRequest(row('ben')), hasRequest(row('ada')), requestCount()], [true, false, 1]);
  stop();
});

test('a send that fails to save is taken back on screen, and says why', async () => {
  const posts = fakeServer([], { failPosts: true });
  const { watchRequests, hasRequest, markRequested } = await client();
  const seen = [];
  const stop = watchRequests(() => seen.push(hasRequest(row('ada'))));
  await flush();
  await assert.rejects(markRequested(row('ada'), { bridgeId: 'maya' }), /The app is restarting\./);
  assert.equal(hasRequest(row('ada')), false);
  assert.ok(seen.includes(true), 'it showed at once, before the save answered');
  assert.deepEqual(posts[0], { action: 'mark-sent', connectionId: 'ada@maya', profileUrl: url('ada'), bridgeId: 'maya' });
  stop();
});
