// A scan's batch through the ingest route (app/api/ingest/route.js), on a
// temporary database: what a refresh of your own connections says afterwards.
// The route imports as Next resolves it (tests/helpers/extensionless.mjs).
// Invented people and companies.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-ingest-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let POST, getDb;

before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta']) getDb().exec(`DELETE FROM ${t}`);
});

const person = (i, headline) => ({ name: `Person ${i}`, headline, profileUrl: `https://www.linkedin.com/in/person-${i}` });
const send = async (connections) => {
  const res = await POST(new Request('http://127.0.0.1/api/ingest', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connections, type: 'degree1', userId: 'me' }),
  }));
  return res.json();
};
const notes = () => getDb().prepare('SELECT type, title FROM notifications ORDER BY rowid').all().map((n) => `${n.type}: ${n.title}`);

test('new connections are the ones this refresh added, and high-value is the tier the model gave them', async () => {
  const first = await send([
    person(1, 'VP Sales at Hooli'),                   // 6.0: A
    person(2, 'Metadata Analyst at Initech'),         // not Meta: C
    person(3, 'Engineer at Applewood Bakery'),        // not Apple: C
    person(4, 'Nurse at Mercy Hospital'),
  ]);
  assert.equal(first.saved, 4);
  assert.deepEqual(notes(), ['refresh_summary: 4 new connections found!', 'new_elite_connection: High-value connection: Person 1']);
});

test('a re-scan of people already saved finds nothing new, however many it sends', async () => {
  const known = Array.from({ length: 110 }, (_, i) => person(100 + i, i % 2 ? 'Engineer at Applewood Bakery' : 'Metadata Engineer at Acme'));
  await send(known);
  getDb().exec('DELETE FROM notifications');
  const again = await send(known);
  assert.deepEqual([again.saved, again.alreadyKnown], [0, 110]);
  // It used to look up the first hundred only, so ten "new connections" turned up.
  assert.deepEqual(notes(), ['refresh_summary: Network up to date']);
});

// ── LinkedIn's mutual count, from a circle scan ─────────────────────────────

const circle = async (bridgeId, connections) => (await POST(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ connections, type: 'degree2', bridgeId, userId: 'me' }),
}))).json();
const counts = (slug) => getDb().prepare(
  'SELECT source_connection_id AS bridge, mutual_count AS n FROM linkedin_connections WHERE profile_url = ? ORDER BY source_connection_id',
).all(`https://www.linkedin.com/in/${slug}`).map((r) => [r.bridge, r.n]);
const inCircle = (slug, mutualCount) => ({ name: slug, headline: 'Engineer at Initech', profileUrl: `https://www.linkedin.com/in/${slug}`, mutualCount });

test('a circle scan keeps LinkedIn\'s mutual count, and every copy of the person carries the newest', async () => {
  await circle('bridge-maya', [inCircle('ada', 24), inCircle('ben', undefined)]);
  assert.deepEqual(counts('ada'), [['bridge-maya', 24]]);
  assert.deepEqual(counts('ben'), [['bridge-maya', null]]);
  // Found again through another bridge, with a newer count: both copies say it.
  await circle('bridge-zoe', [inCircle('ada', 30)]);
  assert.deepEqual(counts('ada'), [['bridge-maya', 30], ['bridge-zoe', 30]]);
  // A scan that didn't read the line leaves the count alone; a misread is dropped.
  await circle('bridge-maya', [inCircle('ada', undefined), inCircle('ben', -4)]);
  assert.deepEqual(counts('ada'), [['bridge-maya', 30], ['bridge-zoe', 30]]);
  assert.deepEqual(counts('ben'), [['bridge-maya', null]]);
});

test('only a circle scan brings a mutual count: your own connections never get one', async () => {
  await send([{ ...person(900, 'VP Sales at Hooli'), mutualCount: 12 }]);
  const row = getDb().prepare('SELECT mutual_count FROM linkedin_connections WHERE profile_url = ?').get('https://www.linkedin.com/in/person-900');
  assert.equal(row.mutual_count, null);
});
