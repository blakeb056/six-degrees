// A profile opened in Sixgree's own browser, counted by the server
// (/api/profile-view POST): one of the day's profile views in the scanner's
// own record, and a line in the history of profiles opened (lib/profile-opened.js), with no scanner job. Blake,
// 2026-10-15: Connect "took like 2-3 min to load and it's not snappy like the
// view profile button which is essentially the same". The panel is already on
// the profile when this is asked (desktop/main.mjs showProfile); this only
// writes two small files. On a temporary data folder, never the real one.
// Invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-profile-view-'));
const HOME = path.join(dir, 'home');
process.env.SIX_DEGREES_HOME = HOME;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
mkdirSync(HOME);

let POST, getDb, linkedinState;

before(async () => {
  ({ POST } = await import('../app/api/profile-view/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  ({ linkedinState } = await import('../lib/linkedin-limits.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (slug) => `https://www.linkedin.com/in/${slug}`;
const ACTIVITY = () => path.join(HOME, 'linkedin-activity.json');
const OPENED = () => path.join(HOME, 'outlink-opened.json');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users']) db.exec(`DELETE FROM ${t}`);
  for (const f of [ACTIVITY(), OPENED()]) rmSync(f, { force: true });
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, tier, profile_url) VALUES (?, 'me', 2, ?, 'A', ?)`)
    .run('d2-ada', 'Ada Quill', url('ada-quill'));
});

const post = (body) => POST(new Request('http://127.0.0.1/api/profile-view', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('a profile opened in the panel is one profile view, and written down with the database’s link and name', async () => {
  const before = linkedinState(HOME).profilesLeftToday;
  const res = await post({ id: 'd2-ada', name: '--not-her', url: 'https://example.com/in/someone-else' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.counted, true);
  assert.equal(body.profilesLeftToday, before - 1, 'against the same daily limit as a scan’s views');
  assert.equal(json(ACTIVITY()).profiles.length, 1);
  const [entry] = json(OPENED()).opened;
  assert.equal(entry.id, 'd2-ada');
  assert.equal(entry.name, 'Ada Quill');
  assert.equal(entry.url, url('ada-quill'), 'the database’s link, never the page’s, when they are on file');
});

test('someone not on file: the page’s link, checked like any other', async () => {
  const res = await post({ id: 'nobody', name: 'Bo Invented', url: url('bo-invented') });
  assert.equal(res.status, 200);
  assert.deepEqual(json(OPENED()).opened.map((e) => [e.id, e.name, e.url]), [[null, 'Bo Invented', url('bo-invented')]]);
  assert.equal(json(ACTIVITY()).profiles.length, 1);
});

test('not a LinkedIn profile link: refused, and nothing is counted', async () => {
  for (const body of [{ url: 'https://example.com/in/x' }, { url: 'https://www.linkedin.com/feed/' }, {}, { id: 'nobody' }]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.throws(() => readFileSync(ACTIVITY()), /ENOENT/);
  assert.throws(() => readFileSync(OPENED()), /ENOENT/);
});

test('every open is counted, and the scanner’s searches and Auto’s requests in the record are kept', async () => {
  writeFileSync(ACTIVITY(), JSON.stringify({ searches: [1, 2, 3], profiles: [], invites: [4] }));
  await post({ id: 'd2-ada' });
  await post({ id: 'd2-ada' });
  const rec = json(ACTIVITY());
  assert.deepEqual(rec.searches, [1, 2, 3]);
  assert.deepEqual(rec.invites, [4]);
  assert.equal(rec.profiles.length, 2, 'no gap and no wait between them: you opened both');
});

test('the route starts nothing: no scanner, no scan state, no waiting', () => {
  const src = readFileSync(new URL('../app/api/profile-view/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /scraper|spawn|child_process|scan-state|setTimeout/);
});
