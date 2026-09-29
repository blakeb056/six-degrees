// A scan's batch through the ingest route (app/api/ingest/route.js), on a
// temporary database: what a refresh of your own connections says afterwards,
// and how the first scan is scored after the Scan page's question about your
// field (saved as the page saves it, lib/settings-client.js, through
// app/api/settings/route.js). The routes import as Next resolves them
// (tests/helpers/extensionless.mjs). Invented people and companies.

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

let POST, settingsRoute, saveSettings, getDb;

before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ POST: settingsRoute } = await import('../app/api/settings/route.js'));
  ({ saveSettings } = await import('../lib/settings-client.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta', 'connection_ties']) getDb().exec(`DELETE FROM ${t}`);
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

// ── your field, asked before the first scan ─────────────────────────────────

// What the Scan page's question sends (app/components/FieldStep.js), through
// the page's own save (lib/settings-client.js), answered by the settings route.
const answer = async (patch, route = (url, opts) => settingsRoute(new Request(`http://127.0.0.1${url}`, opts))) => {
  const real = globalThis.fetch;
  globalThis.fetch = route;
  try { return await saveSettings(patch); } finally { globalThis.fetch = real; }
};
const scored = (i) => getDb().prepare('SELECT company_prestige_score AS company, score_why AS why FROM linkedin_connections WHERE profile_url = ?')
  .get(`https://www.linkedin.com/in/person-${i}`);

test('a field picked before the first scan is saved with nobody to rescore, and the first scan is already scored with it', async () => {
  const saved = await answer({ sectorFocus: { sectors: ['media'], strength: 'lean' }, fieldAsked: true });
  assert.equal(saved.error, null);
  assert.deepEqual([saved.settings.sectorFocus, saved.settings.fieldAsked], [{ sectors: ['media'], strength: 'lean' }, true]);
  assert.equal(saved.effects.sectorFocus.scored, 0);
  await send([person(1, 'Director of Partnerships at YouTube'), person(2, 'VP Sales at Hooli')]);
  // YouTube is 9 on the known list; lean media makes it 10.
  assert.equal(scored(1).company, 10);
  assert.match(scored(1).why, /YouTube \(10\/10: 9 \+ 1 your sector: Marketing & Media\)/);
});

test('skipping saves only that it was asked, and the first scan is scored as it always was', async () => {
  const skipped = await answer({ fieldAsked: true });
  assert.equal(skipped.error, null);
  assert.deepEqual([skipped.settings.sectorFocus, skipped.settings.fieldAsked], [{ sectors: [], strength: 'lean' }, true]);
  assert.equal(skipped.effects, null);
  await send([person(1, 'Director of Partnerships at YouTube')]);
  assert.equal(scored(1).company, 9);
  assert.doesNotMatch(scored(1).why, /your sector/);
});

test('a save that is refused, or can\'t reach the app, comes back as a message to show, and nothing is saved', async () => {
  assert.deepEqual(await answer({ sectorFocus: { sectors: ['astrology'] }, fieldAsked: true }),
    { settings: null, effects: null, error: "There is no sector called 'astrology'." });
  assert.deepEqual(await answer({ fieldAsked: true }, async () => { throw new TypeError('fetch failed'); }),
    { settings: null, effects: null, error: 'Could not reach the app. Reload this page to see what is saved.' });
  assert.equal(getDb().prepare("SELECT value FROM app_meta WHERE key = 'settings'").get(), undefined);
});

// ── Ties between your own connections (lib/ties.js) ─────────────────────────

test('your connections in someone\'s circle are kept as ties to them, once each, and go with a deleted person', async () => {
  await send([person(1, 'Founder at Hooli'), person(2, 'Engineer at Initech'), person(3, 'Nurse at Mercy Hospital')]);
  const bridgeId = getDb().prepare("SELECT id FROM linkedin_connections WHERE profile_url = ?").get('https://www.linkedin.com/in/person-1').id;
  const ties = () => getDb().prepare('SELECT a_url, b_url FROM connection_ties ORDER BY a_url, b_url').all()
    .map((t) => `${t.a_url.slice(-8)}~${t.b_url.slice(-8)}`);
  const got = await circle(bridgeId, [person(2, 'Engineer at Initech'), person(3, 'Nurse at Mercy Hospital'), person(50, 'VP at Globex')]);
  assert.equal(got.saved, 1, 'only the stranger is saved as 2nd degree');
  assert.deepEqual(ties(), ['person-1~person-2', 'person-1~person-3']);
  await circle(bridgeId, [person(2, 'Engineer at Initech')]);
  assert.equal(ties().length, 2, 'a rescan adds no second copy');
  const { POST: adminDelete } = await import('../app/api/admin-delete/route.js');
  await adminDelete(new Request('http://127.0.0.1/api/admin-delete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileUrl: 'https://www.linkedin.com/in/person-2' }),
  }));
  assert.deepEqual(ties(), ['person-1~person-3']);
});
