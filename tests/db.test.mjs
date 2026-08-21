// Contract tests for lib/db.js — the supabase-shaped adapter over SQLite.
// Each case here pins a behaviour that route code depends on and that a
// reasonable-looking rewrite would break silently.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-test-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let db, getDb;

before(async () => {
  ({ db } = await import('../lib/db.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  const raw = getDb();
  for (const t of ['linkedin_connections', 'notifications', 'queue_items', 'user_stats', 'users', 'user_profile']) {
    raw.exec(`DELETE FROM ${t}`);
  }
});

const person = (over = {}) => ({
  name: 'Test Person', profile_url: 'https://linkedin.com/in/test',
  degree: 1, company: 'Acme', role: 'Engineer', tier: 'B', power_score: 4.5, ...over,
});

// ── Contract 1: resolves to { data, error }, never rejects ─────────────────
test('resolves to {data, error} rather than throwing', async () => {
  const res = await db.from('linkedin_connections').select('*');
  assert.ok('data' in res && 'error' in res);
  assert.equal(res.error, null);
  assert.deepEqual(res.data, []);
});

test('a bad table surfaces as error, not a rejection', async () => {
  const res = await db.from('does_not_exist').select('*');
  assert.equal(res.data, null);
  assert.ok(res.error?.message);
});

// ── Contract 2: thenable AND catchable ─────────────────────────────────────
test('the builder is awaitable without a terminal call', async () => {
  await db.from('linkedin_connections').insert(person());
  const res = await db.from('linkedin_connections').select('*').eq('degree', 1);
  assert.equal(res.data.length, 1);
});

test('.catch() exists on the builder', async () => {
  const chain = db.from('linkedin_connections').select('*');
  assert.equal(typeof chain.then, 'function');
  assert.equal(typeof chain.catch, 'function');
  const res = await chain.catch(() => ({ data: null, error: { message: 'caught' } }));
  assert.equal(res.error, null);
});

// ── Contract 3: the builder MUTATES and returns this ───────────────────────
// app/api/notifications/route.js calls q.eq(...) without reassigning. An
// immutable builder would drop the filter with no error and no failing test.
test('filters applied without reassignment still take effect', async () => {
  await db.from('linkedin_connections').insert([
    person({ profile_url: 'https://linkedin.com/in/a', user_id: 'user-a' }),
    person({ profile_url: 'https://linkedin.com/in/b', user_id: 'user-b' }),
  ]);
  const q = db.from('linkedin_connections').select('*');
  q.eq('user_id', 'user-a');            // deliberately not reassigned
  const res = await q;
  assert.equal(res.data.length, 1, 'the unassigned .eq() must still filter');
  assert.equal(res.data[0].user_id, 'user-a');
});

test('each filter method returns the same builder instance', () => {
  const q = db.from('linkedin_connections');
  assert.equal(q.select('*'), q);
  assert.equal(q.eq('degree', 1), q);
  assert.equal(q.order('power_score', { ascending: false }), q);
  assert.equal(q.limit(5), q);
});

// ── Contract 4: .single() on zero rows ─────────────────────────────────────
test('.single() yields {data: null, error} when nothing matches', async () => {
  const res = await db.from('users').select('*').eq('name', 'Nobody').single();
  assert.equal(res.data, null);
  assert.ok(res.error, 'a miss must report an error, not an empty success');
});

test('.single() returns the row itself, not an array', async () => {
  await db.from('users').insert({ name: 'Ada' });
  const res = await db.from('users').select('*').eq('name', 'Ada').single();
  assert.equal(res.error, null);
  assert.equal(res.data.name, 'Ada');
});

// ── Contract 5: snake_case survives the round trip ─────────────────────────
test('snake_case column names are preserved', async () => {
  await db.from('linkedin_connections').insert(person({ profile_image_url: '/avatars/x.webp', company_prestige_score: 9 }));
  const { data } = await db.from('linkedin_connections').select('*').single();
  assert.ok('profile_image_url' in data);
  assert.ok('company_prestige_score' in data);
  assert.equal(data.company_prestige_score, 9);
});

// ── Type codecs: JSON and boolean columns cross the boundary intact ────────
test('JSON columns round-trip as objects and arrays', async () => {
  await db.from('users').insert({ name: 'Cfg', sectors: ['ai', 'media'], company_prestige_config: { s_score: 10 } });
  const { data } = await db.from('users').select('*').eq('name', 'Cfg').single();
  assert.deepEqual(data.sectors, ['ai', 'media']);
  assert.equal(data.company_prestige_config.s_score, 10);
});

test('boolean columns round-trip as booleans', async () => {
  await db.from('notifications').insert({ type: 't', title: 'Hi', seen: false });
  const { data } = await db.from('notifications').select('*').single();
  assert.equal(data.seen, false);
  await db.from('notifications').update({ seen: true }).eq('id', data.id);
  const after = await db.from('notifications').select('*').eq('id', data.id).single();
  assert.equal(after.data.seen, true);
});

// ── Query semantics ────────────────────────────────────────────────────────
test('.in() filters, and an empty list matches nothing', async () => {
  await db.from('linkedin_connections').insert([
    person({ profile_url: 'https://linkedin.com/in/s', tier: 'S' }),
    person({ profile_url: 'https://linkedin.com/in/d', tier: 'D' }),
  ]);
  const hit = await db.from('linkedin_connections').select('*').in('tier', ['S', 'A']);
  assert.equal(hit.data.length, 1);
  const none = await db.from('linkedin_connections').select('*').in('tier', []);
  assert.equal(none.data.length, 0);
});

test('.ilike() is case-insensitive', async () => {
  await db.from('users').insert({ name: 'Blake Burford' });
  const { data } = await db.from('users').select('*').ilike('name', 'blake burford').single();
  assert.equal(data.name, 'Blake Burford');
});

test('descending order puts NULL scores last', async () => {
  await db.from('linkedin_connections').insert([
    person({ profile_url: 'https://linkedin.com/in/1', power_score: 3 }),
    person({ profile_url: 'https://linkedin.com/in/2', power_score: null, tier: null }),
    person({ profile_url: 'https://linkedin.com/in/3', power_score: 9 }),
  ]);
  const { data } = await db.from('linkedin_connections').select('*').order('power_score', { ascending: false });
  assert.equal(data[0].power_score, 9);
  assert.equal(data.at(-1).power_score, null);
});

test('.eq(col, null) becomes IS NULL', async () => {
  await db.from('linkedin_connections').insert(person({ tier: null, power_score: null }));
  const { data } = await db.from('linkedin_connections').select('*').eq('tier', null);
  assert.equal(data.length, 1);
});

// ── Writes ─────────────────────────────────────────────────────────────────
test('insert returns the inserted rows with generated ids', async () => {
  const { data, error } = await db.from('linkedin_connections').insert(person()).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.match(data[0].id, /^[0-9a-f-]{36}$/);
});

test('update returns the affected rows', async () => {
  await db.from('linkedin_connections').insert(person());
  const { data } = await db.from('linkedin_connections').update({ tier: 'S' }).eq('name', 'Test Person').select();
  assert.equal(data[0].tier, 'S');
});

test('delete removes rows and reports what went', async () => {
  await db.from('linkedin_connections').insert(person());
  const { data } = await db.from('linkedin_connections').delete().eq('name', 'Test Person');
  assert.equal(data.length, 1);
  const after = await db.from('linkedin_connections').select('*');
  assert.equal(after.data.length, 0);
});

test('upsert with ignoreDuplicates does not fail on a conflict', async () => {
  const row = { profile_url: 'https://linkedin.com/in/dup', name: 'Dup' };
  await db.from('queue_items').upsert([row], { onConflict: 'profile_url', ignoreDuplicates: true });
  await db.from('queue_items').upsert([row], { onConflict: 'profile_url', ignoreDuplicates: true });
  const { data } = await db.from('queue_items').select('*');
  assert.equal(data.length, 1);
});

// ── RPC replacements ───────────────────────────────────────────────────────
test('score_new_connections scores only unscored rows', async () => {
  await db.from('linkedin_connections').insert([
    person({ profile_url: 'https://linkedin.com/in/ceo', role: 'CEO', company: 'Anthropic', tier: null, power_score: null }),
    person({ profile_url: 'https://linkedin.com/in/kept', tier: 'D', power_score: 1 }),
  ]);
  const { error } = await db.rpc('score_new_connections');
  assert.equal(error, null);
  const ceo = await db.from('linkedin_connections').select('*').eq('role', 'CEO').single();
  assert.equal(ceo.data.tier, 'S', 'CEO at a top-prestige company should land in S');
  const kept = await db.from('linkedin_connections').select('*').eq('profile_url', 'https://linkedin.com/in/kept').single();
  assert.equal(kept.data.tier, 'D', 'an already-scored row must not be rescored');
});

test('exec_sql is refused', async () => {
  const { data, error } = await db.rpc('exec_sql', { sql: 'DROP TABLE users' });
  assert.equal(data, null);
  assert.ok(error?.message);
});
