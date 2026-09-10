// What happens to someone you met through a bridge once you actually connect
// with them.
//
// This is the "remember where they came from" contract. A 2nd-degree person you
// reach out to and who accepts becomes a 1st-degree connection — and the graph
// should still know which bridge introduced them, because that path is the
// whole point of the tool.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'sixdeg-promo-'));
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
process.env.SIX_DEGREES_HOME = dir;

const { db } = await import('../lib/db.js');

const USER = 'user-1';
const BRIDGE = 'bridge-jane';
const HER_URL = 'https://www.linkedin.com/in/prospect/';

before(async () => {
  await db.from('users').insert([{ id: USER, name: 'Tester' }]);
  await db.from('linkedin_connections').insert([{
    id: BRIDGE, degree: 1, name: 'Jane Bridge', profile_url: 'https://www.linkedin.com/in/jane/',
    user_id: USER, tier: 'S', power_score: 8,
  }]);
  // Found behind Jane.
  await db.from('linkedin_connections').insert([{
    id: 'prospect-d2', degree: 2, name: 'Prospect', profile_url: HER_URL,
    source_connection_id: BRIDGE, user_id: USER, tier: 'A', power_score: 6,
  }]);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('a 2nd-degree person starts out attributed to their bridge', async () => {
  const { data } = await db.from('linkedin_connections').select('*').eq('profile_url', HER_URL);
  assert.equal(data.length, 1);
  assert.equal(data[0].degree, 2);
  assert.equal(data[0].source_connection_id, BRIDGE);
});

test('connecting with them must not silently leave them at 2nd degree', async () => {
  // This is what a degree-1 scrape does: it sees her in your connections now.
  // The old ingest treated "any row with this profile_url exists" as "already
  // handled", then updated `.eq('degree', 1)` — which matched nothing, because
  // her only row was degree 2. She stayed a 2nd-degree contact forever.
  const { promoteToFirstDegree } = await import('../lib/promote.js');
  await promoteToFirstDegree(db, { profileUrl: HER_URL, userId: USER });

  const { data } = await db.from('linkedin_connections').select('*').eq('profile_url', HER_URL);
  assert.equal(data.length, 1, 'she must not be duplicated into a second row');
  assert.equal(data[0].degree, 1, 'she is a direct connection now');
});

test('the bridge that introduced them is remembered after promotion', async () => {
  const { data } = await db.from('linkedin_connections').select('*').eq('profile_url', HER_URL);
  const row = data[0];
  assert.equal(row.unlocked_from_bridge_id, BRIDGE, 'origin is kept');
  assert.equal(row.unlocked_from_name, 'Jane Bridge', 'and readable without a join');
});

test('they stop being counted inside the bridge cluster', async () => {
  // Two facts that must not be conflated: who introduced them (permanent) and
  // whose circle they sit in (no longer — they are your own connection now).
  const { data } = await db.from('linkedin_connections').select('*').eq('profile_url', HER_URL);
  assert.equal(data[0].source_connection_id, null);
});

test('promoting twice changes nothing', async () => {
  const { promoteToFirstDegree } = await import('../lib/promote.js');
  await promoteToFirstDegree(db, { profileUrl: HER_URL, userId: USER });
  const { data } = await db.from('linkedin_connections').select('*').eq('profile_url', HER_URL);
  assert.equal(data.length, 1);
  assert.equal(data[0].degree, 1);
  assert.equal(data[0].unlocked_from_bridge_id, BRIDGE, 'origin survives a re-run');
});
