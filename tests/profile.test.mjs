// Which profile counts as "you". The failure this pins down: empty duplicate
// profiles made by a name prompt hid a real network and stopped the scraper.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-profile-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, resolveProfile, listProfiles, networkCounts, DEFAULT_NAME;

before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ resolveProfile, listProfiles, networkCounts, DEFAULT_NAME } = await import('../lib/profile.js'));
  // Windows cannot delete the folder while the database inside is open; the
  // system's temp cleanup gets it there.
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* see above */ } });
});

beforeEach(() => {
  const raw = getDb();
  raw.exec('DELETE FROM linkedin_connections');
  raw.exec('DELETE FROM users');
});

function addUser(id, name, createdAt) {
  getDb().prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
}

function addConnections(userId, n) {
  const stmt = getDb().prepare(
    'INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id) VALUES (?, 1, ?, ?, ?)');
  for (let i = 0; i < n; i++) {
    stmt.run(`${userId}-${i}`, `Person ${i}`, `https://linkedin.com/in/${userId}-${i}`, userId);
  }
}

test('a fresh machine gets one profile, made once', () => {
  const first = resolveProfile();
  assert.equal(first.name, DEFAULT_NAME);
  const again = resolveProfile();
  assert.equal(again.id, first.id);
  assert.equal(listProfiles().length, 1);
});

test('create:false does not make a profile', () => {
  assert.equal(resolveProfile({ create: false }), null);
  assert.equal(listProfiles().length, 0);
});

test('the profile with the network wins over newer empty duplicates', () => {
  addUser('real', 'Pat Example', '2026-08-25 03:10:11');
  addUser('dup1', 'Pat', '2026-09-10 04:46:16');
  addUser('dup2', 'Patt', '2026-09-10 05:10:31');
  addConnections('real', 5);
  assert.equal(resolveProfile().id, 'real');
});

test('it wins even when it is not the oldest', () => {
  addUser('empty-old', 'Old', '2026-01-01 00:00:00');
  addUser('real-new', 'New', '2026-09-01 00:00:00');
  addConnections('real-new', 3);
  assert.equal(resolveProfile().id, 'real-new');
});

test('with no connections anywhere, the oldest profile is used', () => {
  addUser('b', 'Second', '2026-09-02 00:00:00');
  addUser('a', 'First', '2026-09-01 00:00:00');
  assert.equal(resolveProfile().id, 'a');
});

test('counts are split by degree, so a total is never passed off as connections', () => {
  addUser('me', 'Me', '2026-09-01 00:00:00');
  addConnections('me', 3);
  const stmt = getDb().prepare(
    'INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id) VALUES (?, 2, ?, ?, ?)');
  for (let i = 0; i < 5; i++) stmt.run(`d2-${i}`, `Friend ${i}`, `https://linkedin.com/in/d2-${i}`, 'me');
  assert.deepEqual(networkCounts('me'), { first: 3, second: 5, third: 0 });
  assert.deepEqual(networkCounts('nobody'), { first: 0, second: 0, third: 0 });
});
