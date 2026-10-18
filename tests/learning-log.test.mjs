// Phase 0, Record: the send log (lib/send-log.js) and the learning log
// (lib/learning-log.js). Every request gets its send time, route, snapshot and
// attempts; accepts get accepted_at, the connection's day, the days it took and
// Blake's warmth band; and one append-only, versioned event store keeps
// exposure, interactions, outcomes, scans, onboarding and the account's load,
// deduped, exportable, deletable, and never sent anywhere. On a temporary
// database with invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-learning-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, outreach, ingest, dataLearning, learningRoute, log, sendLog, promote, store, rpc;
before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ POST: outreach } = await import('../app/api/outreach/route.js'));
  ({ POST: ingest } = await import('../app/api/ingest/route.js'));
  ({ POST: dataLearning } = await import('../app/api/data/learning/route.js'));
  learningRoute = await import('../app/api/learning/route.js');
  log = await import('../lib/learning-log.js');
  sendLog = await import('../lib/send-log.js');
  promote = await import('../lib/promote.js');
  store = await import('../lib/class-store.js');
  rpc = await import('../lib/rpc.js');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (id) => `https://www.linkedin.com/in/${id}`;
beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users', 'user_stats', 'queue_items', 'learning_events', 'user_profile', 'notifications']) db.exec(`DELETE FROM ${t}`);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, headline, tier, power_score, profile_url, source_connection_id, unlock_status, location, mutual_count)
                          VALUES (?, 'me', ?, ?, ?, ?, ?, ?, ?, 'locked', ?, ?)`);
  add.run('maya', 1, 'Maya Chen', 'VP Sales at Northwind Labs', 'A', 6.5, url('maya'), null, 'Austin, Texas, United States', null);
  add.run('zoe', 1, 'Zoe Park', 'Engineer at Halcyon', 'B', 4.4, url('zoe'), null, null, null);
  add.run('ada@maya', 2, 'Ada Stone', 'Founder at Quillon Labs', 'S', 7.9, url('ada'), 'maya', 'Denver, Colorado, United States', 4);
  add.run('ada@zoe', 2, 'Ada Stone', 'Founder at Quillon Labs', 'S', 7.9, url('ada'), 'zoe', 'Denver, Colorado, United States', 4);
  add.run('ben@maya', 2, 'Ben Ortiz', 'Recruiter at Halcyon', 'B', 4.0, url('ben'), 'maya', null, 1);
});

const post = (fn, route, body) => fn(new Request(`http://127.0.0.1${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const send = async (body) => (await post(outreach, '/api/outreach', body)).json();
const queue = (id) => getDb().prepare('SELECT * FROM queue_items WHERE profile_url = ?').get(url(id));
const events = (kind, type) => getDb().prepare(`SELECT * FROM learning_events WHERE kind = ?${type ? ' AND type = ?' : ''} ORDER BY seq`).all(...[kind, ...(type ? [type] : [])]);

// ── The send log ─────────────────────────────────────────────────────────────

test('a request writes the send log: when, how, the person as known then, and what was shown beside them', async () => {
  const r = await send({ action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya', exposure: { list: 'class:founder', rank: 3, shown: ['x', 'y'] } });
  assert.equal(r.saved, 2);
  assert.equal(r.xp, 1, 'a send earns a token 1, whatever the tier');
  const q = queue('ada');
  assert.ok(q.sent_at);
  assert.equal(q.route, 'manual');
  assert.equal(q.result, 'pending');
  assert.equal(q.attempts, 1);
  const snap = JSON.parse(q.snapshot);
  assert.equal(snap.degree, 2);
  assert.equal(snap.tier, 'S');
  assert.equal(snap.mutualCount, 4);
  assert.equal(snap.waysIn, 2, 'two bridges show Ada');
  assert.equal(snap.bridge.id, 'maya');
  assert.equal(snap.location, 'Denver, Colorado, United States');
  assert.deepEqual(snap.exposure, { list: 'class:founder', rank: 3, sort: null, shown: ['x', 'y'] });
  assert.ok(snap.models.scoring >= 7);
  // In the learning log too, once.
  assert.equal(events('interaction', 'request-sent').length, 1);
});

test('marked again it stays one attempt; Undo keeps it as undone; asked again is attempt 2 with the first in its history', async () => {
  await send({ action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  await send({ action: 'mark-sent', connectionId: 'ada@zoe' });
  assert.equal(queue('ada').attempts, 1);
  const undo = await send({ action: 'undo', connectionId: 'ada@maya' });
  assert.equal(undo.xp, -1);
  assert.equal(queue('ada').result, 'undone');
  assert.equal(events('outcome', 'withdrawn').length, 1);
  await send({ action: 'mark-sent', connectionId: 'ada@maya', route: 'panel' });
  const q = queue('ada');
  assert.equal(q.attempts, 2);
  assert.equal(q.route, 'panel');
  assert.equal(JSON.parse(q.attempt_history)[0].result, 'undone');
  assert.equal(events('interaction', 'request-sent').length, 2);
});

test('Auto’s sends are logged as auto', async () => {
  const { markSentRows } = await import('../lib/requests.js');
  markSentRows(getDb(), { connectionId: 'ben@maya', bridgeId: 'maya', route: 'auto' });
  assert.equal(queue('ben').route, 'auto');
});

test('accepted through promotion: accepted_at, the connection’s day, the days it took and the warmth band', async () => {
  const db = getDb();
  await send({ action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  db.prepare('UPDATE queue_items SET sent_at = ? WHERE profile_url = ?').run(new Date(2026, 9, 1, 15, 0).toISOString(), url('ada'));
  const { db: builder } = await import('../lib/db.js');
  const res = await promote.promoteToFirstDegree(builder, { profileUrl: url('ada'), userId: 'me', fields: { connected_date: '2026-10-02' } });
  assert.equal(res.promoted, true);
  const q = queue('ada');
  assert.equal(q.result, 'accepted');
  assert.ok(q.accepted_at);
  assert.equal(q.accepted_day, '2026-10-02');
  assert.equal(q.warmth, 'very-warm', 'within a day');
  const acc = events('outcome', 'accepted');
  assert.equal(acc.length, 1);
  const data = JSON.parse(acc[0].data);
  assert.equal(data.days, 1);
  assert.equal(data.warmth, 'very-warm');
  assert.equal(data.via, 'promote');
  // The readers: one request's story.
  const [o] = log.outcomes(db);
  assert.equal(o.status, 'accepted');
  assert.equal(o.days, 1);
});

test('accepted through Check for new (a refresh of your connections), and the rest are checked as still pending', async () => {
  const db = getDb();
  await send({ action: 'mark-sent', connectionId: 'ben@maya', bridgeId: 'maya' });
  await send({ action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  db.prepare('UPDATE queue_items SET sent_at = ? WHERE profile_url = ?').run(new Date(2026, 9, 1, 9).toISOString(), url('ben'));
  const r = await post(ingest, '/api/ingest', {
    type: 'degree1', userId: 'me',
    connections: [{ profileUrl: url('ben'), name: 'Ben Ortiz', headline: 'Recruiter at Halcyon', connectedDate: '2026-10-09' }],
  });
  assert.equal(r.status, 200);
  const q = queue('ben');
  assert.equal(q.result, 'accepted');
  assert.equal(q.accepted_day, '2026-10-09');
  assert.equal(q.warmth, 'cool', '8 days');
  // Ada is still out: checked, and one "still pending" this week, however many checks.
  assert.ok(queue('ada').last_checked_at);
  await post(ingest, '/api/ingest', { type: 'degree1', userId: 'me', connections: [{ profileUrl: url('zoe'), name: 'Zoe Park', headline: 'Engineer at Halcyon' }] });
  assert.equal(events('outcome', 'still-pending').length, 1);
  assert.deepEqual(sendLog.sendLogCounts(db).warmth, { cool: 1 });
});

// ── The learning log ─────────────────────────────────────────────────────────

test('exposure: one event per list as drawn, with ranks and snapshots, and the same list again is a no-op', async () => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM linkedin_connections WHERE degree = 2 ORDER BY id").all();
  const first = log.recordExposure(db, { list: 'separation', rows, sort: 'power' });
  const again = log.recordExposure(db, { list: 'separation', rows, sort: 'power' });
  assert.equal(first.recorded, true);
  assert.equal(again.recorded, false, 'deduped');
  const [e] = events('exposure');
  const data = JSON.parse(e.data);
  assert.equal(data.list, 'separation');
  assert.deepEqual(data.shown.map((s) => [s[0], s[1]]), [['ada', 1], ['ada', 2], ['ben', 3]]);
  // The page's route: by id, the top 50 only.
  const res = await post(learningRoute.POST, '/api/learning', { event: 'exposure', list: 'breach', people: [{ id: 'ben@maya' }, { id: 'zoe' }] });
  assert.equal((await res.json()).recorded, true);
  const bad = await post(learningRoute.POST, '/api/learning', { event: 'exposure', list: 'somewhere', people: [{ id: 'zoe' }] });
  assert.equal(bad.status, 400);
  // byPerson finds Ben in both lists.
  assert.equal(log.byPerson(db, url('ben')).filter((x) => x.kind === 'exposure').length, 2);
});

test('snapshots are compact feature vectors, kept once per change, never whole rows or names', () => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM linkedin_connections WHERE id = 'ada@maya'").get();
  log.recordInteraction(db, { type: 'card-open', row });
  log.recordInteraction(db, { type: 'card-open', row, at: new Date(Date.now() + 120000).toISOString() });
  const snaps = events('snapshot');
  assert.equal(snaps.length, 1, 'the same facts: one snapshot');
  const vec = JSON.parse(snaps[0].data);
  assert.equal(vec.length, log.SNAPSHOT_FIELDS.length);
  const named = log.readSnapshot(vec);
  assert.equal(named.degree, 2);
  assert.equal(named.tier, 'S');
  assert.equal(named.mutual, 4);
  assert.equal(named.location, 'Denver, Colorado, United States');
  assert.equal(named.cluster, 'maya');
  assert.doesNotMatch(snaps[0].data, /Ada Stone/);
  db.prepare("UPDATE linkedin_connections SET tier = 'A' WHERE id = 'ada@maya'").run();
  log.recordInteraction(db, { type: 'skip', row: db.prepare("SELECT * FROM linkedin_connections WHERE id = 'ada@maya'").get() });
  assert.equal(events('snapshot').length, 2, 'a change: a new snapshot');
});

test('interactions: a double click is one, each type from the pages is accepted, unknown ones refused', async () => {
  for (const type of log.CLIENT_INTERACTIONS) {
    const r = await post(learningRoute.POST, '/api/learning', { event: 'interaction', type, id: 'zoe' });
    assert.equal((await r.json()).recorded, true, type);
    const twice = await post(learningRoute.POST, '/api/learning', { event: 'interaction', type, id: 'zoe' });
    assert.equal((await twice.json()).recorded, false, `${type} twice`);
  }
  const bad = await post(learningRoute.POST, '/api/learning', { event: 'interaction', type: 'hover', id: 'zoe' });
  assert.equal(bad.status, 400, 'hover is never logged');
});

test('scan outcomes: each batch of a circle scan, with its tier mix on both lenses', async () => {
  const r = await post(ingest, '/api/ingest', {
    type: 'degree2', userId: 'me', bridgeId: 'zoe',
    connections: [
      { profileUrl: url('cy'), name: 'Cy Lane', headline: 'CEO at Google' },
      { profileUrl: url('di'), name: 'Di Moss', headline: 'Analyst at Acme' },
    ],
  });
  assert.equal(r.status, 200);
  const [e] = events('scan', 'batch');
  const data = JSON.parse(e.data);
  assert.equal(data.bridge, 'zoe');
  assert.equal(data.people, 2);
  assert.equal(data.added, 2);
  assert.ok(Number.isInteger(data.S) && Number.isInteger(data.A) && Number.isInteger(data.classS));
});

test('onboarding: each duel with both cards, the choice and the decision time; class picks and Never picks', () => {
  const db = getDb();
  rpc.rescoreAll();
  store.classAction(db, { action: 'pick', class: 'founder' });
  const d = store.classAction(db, { action: 'duel', class: 'founder', seed: 1 }).body;
  store.classAction(db, { action: 'answer', class: 'founder', pair: d.pair, choice: 'neither', ms: 2400, seed: 2 });
  store.classAction(db, { action: 'avoid', class: 'founder', avoid: [{ key: 'student', strength: 'never' }] });
  const kinds = events('onboarding').map((e) => e.type);
  assert.ok(kinds.includes('class-pick'));
  assert.ok(kinds.includes('duel'));
  assert.ok(kinds.includes('never-pick'));
  const duel = JSON.parse(events('onboarding', 'duel')[0].data);
  assert.equal(duel.choice, 'neither');
  assert.equal(duel.ms, 2400);
  assert.ok(duel.a.title && duel.b.title, 'the cards, as attributes');
  assert.equal(events('onboarding', 'duel')[0].lens, 'founder');
  store.classAction(db, { action: 'pick', class: 'seeker' });
  assert.ok(events('onboarding').some((e) => e.type === 'class-switch'));
});

test('account load: searches, profile views and requests per finished hour, each hour once', () => {
  const db = getDb();
  const hour = Math.floor(Date.now() / 3600000) - 3;
  const at = (h, m) => (h * 3600) + m * 60;
  writeFileSync(path.join(dir, 'linkedin-activity.json'), JSON.stringify({
    searches: [at(hour, 1), at(hour, 2), at(hour + 1, 5)], profiles: [at(hour, 9)], invites: [at(hour + 1, 30)],
  }));
  assert.equal(log.mirrorAccountLoad(db, dir), 2);
  assert.equal(log.mirrorAccountLoad(db, dir), 0, 'each hour once');
  const loads = events('load').map((e) => JSON.parse(e.data));
  assert.deepEqual(loads.map((l) => [l.searches, l.profiles, l.invites]), [[2, 1, 0], [1, 0, 1]]);
});

test('readers: since() by kind, byPerson(), outcomes(), stats', async () => {
  const db = getDb();
  await send({ action: 'mark-sent', connectionId: 'ben@maya' });
  log.recordInteraction(db, { type: 'card-open', row: db.prepare("SELECT * FROM linkedin_connections WHERE id = 'ben@maya'").get() });
  assert.equal(log.since(db, '2000-01-01', { kind: 'interaction' }).length, 2);
  assert.ok(log.byPerson(db, 'ben').length >= 2);
  assert.equal(log.outcomes(db)[0].status, 'pending');
  const stats = log.logStats(db);
  assert.ok(stats.events >= 3 && stats.bytes > 0 && stats.byKind.interaction === 2);
  const r = await learningRoute.GET(new Request('http://127.0.0.1/api/learning?stats=1'));
  assert.equal((await r.json()).schemaVersion, log.LEARNING_SCHEMA_VERSION);
});

test('Settings → Your data: Export gives the whole log as JSON; Delete removes every event, and only with a confirmation', async () => {
  const db = getDb();
  await send({ action: 'mark-sent', connectionId: 'ben@maya' });
  const res = await post(dataLearning, '/api/data/learning', { action: 'export' });
  assert.match(res.headers.get('content-disposition'), /attachment; filename="Sixgree learning log/);
  const file = await res.json();
  assert.equal(file.format, 'sixgree-learning-log');
  assert.equal(file.schema_version, log.LEARNING_SCHEMA_VERSION);
  assert.ok(file.events.length >= 2);
  const refused = await post(dataLearning, '/api/data/learning', { action: 'delete' });
  assert.equal(refused.status, 400);
  const del = await (await post(dataLearning, '/api/data/learning', { action: 'delete', confirm: true })).json();
  assert.ok(del.deleted >= 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM learning_events').get().n, 0);
  // The send log is not the learning log: requests stay.
  assert.ok(queue('ben'));
});

test('nothing leaves the machine: recording never touches the network, and the log module makes no requests', async () => {
  const db = getDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the learning log tried to go online'); };
  try {
    const rows = db.prepare('SELECT * FROM linkedin_connections').all();
    log.recordExposure(db, { list: 'map', rows });
    log.recordInteraction(db, { type: 'never', row: rows[0] });
    log.recordAccepted(db, { row: rows[0], sentAt: new Date().toISOString(), acceptedDay: '2026-10-17' });
    log.mirrorAccountLoad(db, dir);
    log.exportLog(db);
    await send({ action: 'mark-sent', connectionId: 'zoe' });
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const file of ['lib/learning-log.js', 'lib/send-log.js', 'app/api/learning/route.js', 'app/api/data/learning/route.js']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|https?:\/\/(?!127\.0\.0\.1)|XMLHttpRequest|node:https?|node:net/, file);
  }
  // The pages' side only ever posts to this app's own server.
  const client = readFileSync(new URL('../lib/learning-client.js', import.meta.url), 'utf8');
  assert.deepEqual([...client.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]), ['/api/learning']);
});

test('the store is append-only and versioned: no row is ever changed, each carries its schema version', () => {
  const src = readFileSync(new URL('../lib/learning-log.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /UPDATE learning_events/);
  const schema = readFileSync(new URL('../db/schema.js', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS learning_events[\s\S]*schema_version INTEGER NOT NULL/);
  assert.match(schema, /idx_learning_person ON learning_events\(person, at\)/);
});
