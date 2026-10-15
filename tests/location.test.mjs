// Where someone is, and their follower count, as a scan reads them off their
// card in a list (Blake, 2026-10-14: "it will collect the location on each
// connection as it shows in the lists"), and where their profile's top card
// says they are (Dig deeper). Kept on their row as `location` and `followers`
// (db/schema.js), written by the ingest route (app/api/ingest/route.js), served
// by /api/network for the Map, and counted by scoring as a profile's follower
// count is, a profile read winning (lib/scoring.js followersOf). On a temporary
// database; the routes import as Next resolves them
// (tests/helpers/extensionless.mjs). Invented people and companies.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-location-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let POST, networkGET, getDb, applySchema, SCHEMA_SQL, followersOf, locationOf, followersCountOf, csvNetworkParts;

before(async () => {
  ({ POST } = await import('../app/api/ingest/route.js'));
  ({ GET: networkGET } = await import('../app/api/network/route.js'));
  ({ getDb, applySchema } = await import('../lib/db-client.js'));
  ({ SCHEMA_SQL } = await import('../db/schema.js'));
  ({ followersOf } = await import('../lib/scoring.js'));
  ({ locationOf, followersCountOf } = await import('../lib/ingest.js'));
  ({ csvNetworkParts } = await import('../lib/csv-network-file.js'));
  // Windows can't delete the folder while the database in it is open; the system's temp cleanup gets it there.
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* see above */ } });
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta', 'connection_ties']) getDb().exec(`DELETE FROM ${t}`);
});

const link = (slug) => `https://www.linkedin.com/in/${slug}`;
const ingest = async (body) => (await POST(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'me', ...body }),
}))).json();
const own = (connections) => ingest({ connections, type: 'degree1' });
const circle = (bridgeId, connections) => ingest({ connections, type: 'degree2', bridgeId });
const company = (companyName, connections) => ingest({ connections, type: 'company', companyName });
const rowsOf = (slug) => getDb().prepare(
  'SELECT degree, source_connection_id AS bridge, location, followers, experience FROM linkedin_connections WHERE profile_url = ? ORDER BY degree, source_connection_id',
).all(link(slug));
const at = (slug, headline, extra = {}) => ({ name: `Invented ${slug}`, headline, profileUrl: link(slug), ...extra });

// ── the column ──────────────────────────────────────────────────────────────

test('a database from before location was kept gets the two columns, and keeps its people', () => {
  const file = path.join(dir, 'older.sqlite');
  const old = new DatabaseSync(file);
  // The schema as it was: the same tables without location and followers.
  const before = SCHEMA_SQL.split('\n').filter((l) => !/^\s+(location|followers)\s/.test(l)).join('\n');
  assert.notEqual(before, SCHEMA_SQL, 'the two columns are in the schema');
  old.exec(before);
  old.prepare("INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id) VALUES ('r1', 1, 'Invented Ada', ?, 'me')").run(link('ada'));
  const cols = () => old.prepare('PRAGMA table_info(linkedin_connections)').all().map((c) => c.name);
  assert.ok(!cols().includes('location') && !cols().includes('followers'));
  applySchema(old);
  assert.ok(cols().includes('location'), 'location added');
  assert.ok(cols().includes('followers'), 'followers added');
  assert.deepEqual({ ...old.prepare('SELECT name, location, followers FROM linkedin_connections').get() },
    { name: 'Invented Ada', location: null, followers: null });
  applySchema(old);   // and again: a no-op
  old.close();
});

// ── what arrives ────────────────────────────────────────────────────────────

test('what the app keeps of a location and a follower count, whatever arrives', () => {
  assert.equal(locationOf('  Seattle,  Washington, United States '), 'Seattle, Washington, United States');
  for (const bad of ['', '   ', null, undefined, 42, {}, '3,766 followers', 'Maya Chen is a mutual connection', '500+ connections', 'x'.repeat(101)]) {
    assert.equal(locationOf(bad), '', String(bad));
  }
  assert.deepEqual([3766, 0, 1e9].map(followersCountOf), [3766, 0, 1e9]);
  assert.deepEqual([-1, 2.5, 1e9 + 1, '3766', null, undefined, NaN].map(followersCountOf), [null, null, null, null, null, null, null]);
});

// ── the ingest route ────────────────────────────────────────────────────────

test('your own connections: location and followers are written, filled in later, and never cleared by a card without them', async () => {
  await own([at('ada', 'Founder at Northwind Labs', { location: 'Seattle, Washington, United States', followers: 3766 }), at('ben', 'Engineer at Initech')]);
  assert.deepEqual(rowsOf('ada').map((r) => [r.location, r.followers]), [['Seattle, Washington, United States', 3766]]);
  assert.deepEqual(rowsOf('ben').map((r) => [r.location, r.followers]), [[null, null]]);
  // A refresh whose cards showed nothing leaves them; one that did fills in or brings up to date.
  await own([at('ada', 'Founder at Northwind Labs'), at('ben', 'Engineer at Initech', { location: 'Lisbon, Portugal', followers: 120 })]);
  assert.deepEqual(rowsOf('ada').map((r) => [r.location, r.followers]), [['Seattle, Washington, United States', 3766]]);
  assert.deepEqual(rowsOf('ben').map((r) => [r.location, r.followers]), [['Lisbon, Portugal', 120]]);
  await own([at('ada', 'Founder at Northwind Labs', { location: 'Portland, Oregon, United States', followers: 4000 })]);
  assert.deepEqual(rowsOf('ada').map((r) => [r.location, r.followers]), [['Portland, Oregon, United States', 4000]]);
  // A misread is dropped, never stored.
  await own([at('ada', 'Founder at Northwind Labs', { location: '3,766 followers', followers: -5 })]);
  assert.deepEqual(rowsOf('ada').map((r) => [r.location, r.followers]), [['Portland, Oregon, United States', 4000]]);
});

test('a circle scan keeps where they are, and every copy of them carries the newest read', async () => {
  await circle('bridge-maya', [at('cy', 'VP Sales at Globex', { location: 'Austin, Texas, United States', followers: 900 })]);
  // Found through another bridge whose card showed neither: the copy that has them keeps them.
  await circle('bridge-leo', [at('cy', 'VP Sales at Globex')]);
  assert.deepEqual(rowsOf('cy').map((r) => [r.bridge, r.location, r.followers]),
    [['bridge-leo', null, null], ['bridge-maya', 'Austin, Texas, United States', 900]]);
  // A newer read anywhere brings every copy up to date, as the mutual count does.
  await circle('bridge-leo', [at('cy', 'VP Sales at Globex', { location: 'Denver, Colorado, United States', followers: 1200 })]);
  assert.deepEqual(rowsOf('cy').map((r) => [r.bridge, r.location, r.followers]),
    [['bridge-leo', 'Denver, Colorado, United States', 1200], ['bridge-maya', 'Denver, Colorado, United States', 1200]]);
});

test('a company scan keeps where they are, and a rescan fills in people saved before it was kept', async () => {
  await company('Invented Robotics', [at('dee', 'Recruiter at Invented Robotics')]);
  assert.deepEqual(rowsOf('dee').map((r) => [r.degree, r.location]), [[3, null]]);
  await company('Invented Robotics', [at('dee', 'Recruiter at Invented Robotics', { location: 'Greater London', followers: 3000 })]);
  assert.deepEqual(rowsOf('dee').map((r) => [r.degree, r.location, r.followers]), [[3, 'Greater London', 3000]]);
});

test('someone in a circle who becomes a connection keeps where they are', async () => {
  await circle('bridge-maya', [at('eve', 'Designer at Halcyon', { location: 'Toronto, Ontario, Canada' })]);
  const got = await own([at('eve', 'Designer at Halcyon')]);
  assert.equal(got.promoted, 1);
  assert.deepEqual(rowsOf('eve').map((r) => [r.degree, r.location]), [[1, 'Toronto, Ontario, Canada']]);
});

// ── followers: a list's count and a profile's ────────────────────────────────

test('a list\'s follower count counts when there is no profile read, and never over one', async () => {
  await own([at('fay', 'Creator at Invented Media', { followers: 2500000 })]);
  const read = (slug) => getDb().prepare('SELECT * FROM linkedin_connections WHERE profile_url = ?').get(link(slug));
  assert.equal(followersOf(read('fay')), 2500000, 'from the list, with no profile read');
  assert.match(read('fay').score_why || '', /Audience of 1M\+/, 'and it counts in their score');
  // Dig deeper reads their top card: the profile's count wins, and the list's stays beside it.
  const dig = await ingest({ type: 'experience', people: [{ profileUrl: link('fay'), status: 'card', card: { followers: 2612000, connections: 500, connectionsPlus: true } }] });
  assert.equal(dig.ok, true);
  assert.equal(followersOf(read('fay')), 2612000);
  // A later list read with a rounder number never replaces the profile's.
  await own([at('fay', 'Creator at Invented Media', { followers: 2600000 })]);
  assert.equal(read('fay').followers, 2600000, 'the list count is kept as read');
  assert.equal(JSON.parse(read('fay').experience).card.followers, 2612000, 'the profile card is untouched');
  assert.equal(followersOf(read('fay')), 2612000);
  // And it counts in the score as a profile's followers do (lib/scoring.js cardAudience): an audience of a million or more.
  assert.match(read('fay').score_why || '', /Audience of 1M\+/);
});

test('scoring reads either: no card and no list count is no follower count', () => {
  assert.equal(followersOf({ experience: null, followers: null }), null);
  assert.equal(followersOf({ experience: null, followers: 12 }), 12);
  assert.equal(followersOf({ experience: JSON.stringify({ status: 'card', card: { followers: 40 } }), followers: 12 }), 40);
  assert.equal(followersOf({ experience: JSON.stringify({ status: 'card', card: { followers: null, connections: 300 } }), followers: 12 }), 12);
  assert.equal(followersOf({ followers: -3 }), null);
});

// ── Dig deeper: the profile's own location ─────────────────────────────────

test('Dig deeper\'s top card: where they are goes on their row, with the card, alone, or with a read', async () => {
  await own([at('gus', 'Analyst at Initech'), at('hal', 'Analyst at Initech'), at('ivy', 'Analyst at Initech')]);
  const one = await ingest({ type: 'experience', people: [
    { profileUrl: link('gus'), status: 'card', card: { followers: 50, connections: 300 }, location: 'Chicago, Illinois, United States' },
    // A top card with a place and no numbers: the place alone, and no card or "couldn't read" stored.
    { profileUrl: link('hal'), status: 'card', location: 'Sydney, New South Wales, Australia' },
    { profileUrl: link('ivy'), status: 'read', source: 'page', roles: [{ title: 'Analyst', company: 'Initech', start: '2024-01' }], location: 'Dublin, Ireland' },
  ] });
  assert.equal(one.ok, true);
  assert.equal(rowsOf('gus')[0].location, 'Chicago, Illinois, United States');
  assert.equal(JSON.parse(rowsOf('gus')[0].experience).card.followers, 50);
  assert.equal(rowsOf('hal')[0].location, 'Sydney, New South Wales, Australia');
  assert.equal(rowsOf('hal')[0].experience, null);
  assert.equal(rowsOf('ivy')[0].location, 'Dublin, Ireland');
  assert.equal(JSON.parse(rowsOf('ivy')[0].experience).status, 'read');
  // A later read with no place leaves the one there.
  await ingest({ type: 'experience', people: [{ profileUrl: link('ivy'), status: 'card', card: { followers: 60 } }] });
  assert.equal(rowsOf('ivy')[0].location, 'Dublin, Ireland');
});

// ── the network the Map reads ───────────────────────────────────────────────

test('/api/network returns each person\'s location, by that name', async () => {
  await own([at('jo', 'Engineer at Initech', { location: 'Berlin, Germany' }), at('kai', 'Engineer at Initech')]);
  const bridge = getDb().prepare('SELECT id FROM linkedin_connections WHERE profile_url = ?').get(link('jo')).id;
  await circle(bridge, [at('lu', 'Engineer at Globex', { location: 'Munich, Bavaria, Germany' })]);
  const res = await networkGET(new Request('http://127.0.0.1/api/network?userId=me'));
  const body = await res.json();
  const by = Object.fromEntries([...body.degree1, ...body.degree2].map((p) => [p.profile_url.split('/').pop(), p]));
  assert.equal(by.jo.location, 'Berlin, Germany');
  assert.equal(by.kai.location, null);
  assert.ok('location' in by.kai, 'the field is there for everyone');
  assert.equal(by.lu.location, 'Munich, Bavaria, Germany');
});

// ── the CSV import ──────────────────────────────────────────────────────────

test('a Connections.csv import carries no location: Connections.csv has none', () => {
  const { parts } = csvNetworkParts([['1', 'Invented Ada', 'Engineer', 'Initech', 'https://www.linkedin.com/in/invented-ada', '2026-09-28']]);
  assert.equal(parts.people.length, 1);
  assert.ok(!('location' in parts.people[0]));
});
