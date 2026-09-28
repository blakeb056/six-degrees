// Settings → Tiers, in the database: tiers graded on your network's curve (the
// default) or on the fixed scale, stamped with the scores, and redone when the
// choice changes. The model itself is pinned in tests/scoring.test.mjs.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-tiers-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, readSettings, writeSettings, rescoreAll, rescoreIfStale, tierScaleOf, afterSettingsChange;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings } = await import('../lib/settings.js'));
  ({ rescoreAll, rescoreIfStale, tierScaleOf } = await import('../lib/rpc.js'));
  ({ afterSettingsChange } = await import('../lib/settings-effects.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'company_scores', 'app_meta']) getDb().exec(`DELETE FROM ${t}`);
});

// Invented people at thirty companies nobody has heard of: an owner, three
// directors, eight managers and eighteen technicians.
function smallBusinesses() {
  const town = ['North', 'South', 'East', 'West', 'Harbor', 'Pine', 'Maple', 'Cedar', 'Lake', 'River'];
  const trade = ['Plumbing', 'Electric', 'Freight', 'Market', 'Supply'];
  const at = (k) => `${town[k % 10]} ${trade[Math.floor(k / 10)]}`;
  const title = (k) => (k === 0 ? 'Owner' : k <= 3 ? 'Director of Operations' : k <= 11 ? 'Store Manager' : 'Technician');
  return Array.from({ length: 30 }, (_, k) => ({ id: `p${k}`, name: `Person ${k}`, headline: `${title(k)} at ${at(k)}` }));
}

function insert(rows) {
  const st = getDb().prepare(`INSERT INTO linkedin_connections (id, degree, name, headline, profile_url)
    VALUES (?, 1, ?, ?, ?)`);
  for (const r of rows) st.run(r.id, r.name, r.headline, `/in/${r.id}`);
}
const meta = (key) => getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value;
const tiers = () => {
  const out = {};
  for (const { tier } of getDb().prepare('SELECT tier FROM linkedin_connections').all()) out[tier] = (out[tier] || 0) + 1;
  return out;
};
const tierOf = (id) => getDb().prepare('SELECT tier FROM linkedin_connections WHERE id = ?').get(id).tier;

test('tiers are graded on your network\'s curve unless you choose the fixed scale', () => {
  assert.equal(readSettings(getDb()).tierScale, 'curve');
  assert.equal(tierScaleOf(getDb()), 'curve');
  assert.throws(() => writeSettings(getDb(), { tierScale: 'relative' }), /curve.*fixed/);
  insert(smallBusinesses());
  rescoreAll();
  assert.equal(meta('scoring_tiers'), 'curve');
  assert.deepEqual(tiers(), { S: 1, A: 3, B: 8, C: 18 });
  assert.deepEqual(['p0', 'p1', 'p4', 'p12'].map(tierOf), ['S', 'A', 'B', 'C']);
});

test('switching the scale rescores everyone and says how many changed tier', () => {
  insert(smallBusinesses());
  rescoreAll();
  const before = readSettings(getDb());
  const after = writeSettings(getDb(), { tierScale: 'fixed' });
  // The owner goes back to A and the three directors to B; power doesn't move.
  assert.deepEqual(afterSettingsChange(getDb(), before, after), { tierScale: { scored: 30, people: 30, moved: 4, up: 0, down: 4 } });
  assert.equal(meta('scoring_tiers'), 'fixed');
  assert.deepEqual(tiers(), { A: 1, B: 11, C: 18 });
  // The same choice again sets nothing in motion.
  assert.equal(afterSettingsChange(getDb(), after, writeSettings(getDb(), { tierScale: 'fixed' })), null);
});

test('scores graded on another scale are stale, and are redone once', () => {
  insert(smallBusinesses());
  rescoreAll();
  // A Settings save whose rescore never finished: the choice is saved, the scores still say the curve.
  getDb().prepare(`INSERT INTO app_meta (key, value) VALUES ('settings', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({ tierScale: 'fixed' }));
  assert.deepEqual(rescoreIfStale(), { scored: 30 });
  assert.deepEqual(rescoreIfStale(), { scored: 0 });
  assert.equal(tierOf('p0'), 'A');
});

test('someone reachable through two of your connections is one person when counting who changed tier', () => {
  insert(smallBusinesses());
  // One of their people, mapped through two of yours: two rows, one person.
  const two = getDb().prepare(`INSERT INTO linkedin_connections (id, degree, name, headline, profile_url, source_connection_id)
    VALUES (?, 2, 'Person X', 'Owner at River Supply', '/in/x', ?)`);
  two.run('x1', 'p12');
  two.run('x2', 'p13');
  rescoreAll();
  assert.equal(tierOf('x1'), 'S');                                      // graded on your cut-offs
  const before = readSettings(getDb());
  const effects = afterSettingsChange(getDb(), before, writeSettings(getDb(), { tierScale: 'fixed' }));
  assert.deepEqual(effects.tierScale, { scored: 32, people: 31, moved: 5, up: 0, down: 5 });
});

