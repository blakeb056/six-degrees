// The sixgree.com visit and download counter (workers/stats): what it counts,
// what it refuses, and that it keeps nothing personal. Runs the Worker against
// node:sqlite standing in for D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../workers/stats/index.js';

const SCHEMA = readFileSync(new URL('../workers/stats/schema.sql', import.meta.url), 'utf8');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { db, prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36';

async function send(env, body, { origin = 'https://sixgree.com', ua = CHROME, ip = '203.0.113.7', country = 'US' } = {}) {
  const waits = [];
  const req = new Request('https://stats.sixgree.com/e', {
    method: 'POST', body: JSON.stringify(body),
    headers: { origin, 'user-agent': ua, 'cf-connecting-ip': ip, 'content-type': 'text/plain' },
  });
  Object.defineProperty(req, 'cf', { value: { country } });
  const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}

async function stats(env) {
  const res = await worker.fetch(new Request('https://stats.sixgree.com/stats?days=7'), env, { waitUntil() {} });
  return res.json();
}

test('views, unique visitors, referrers, countries and download clicks are counted', async () => {
  const env = { DB: fakeD1(), SALT: 'test-salt' };
  assert.equal((await send(env, { t: 'view', p: '/', r: 'www.reddit.com' })).status, 204);
  await send(env, { t: 'view', p: '/download/', r: '' });
  await send(env, { t: 'view', p: '/', r: 'sixgree.com' }, { ip: '198.51.100.2', country: 'GB' });
  await send(env, { t: 'download', p: 'mac-apple-silicon' });
  await send(env, { t: 'download', p: 'not-a-platform' });
  const s = await stats(env);
  assert.equal(s.totals.views, 3);
  assert.equal(s.totals.visitorDays, 2, 'two different visitors today');
  assert.equal(s.totals.downloadClicks, 2);
  assert.deepEqual(s.referrers, [{ site: 'reddit.com', views: 1 }], 'www. dropped, the site itself not a referrer');
  assert.deepEqual(s.downloads.map((d) => d.platform).sort(), ['mac-apple-silicon', 'other']);
  assert.deepEqual(s.countries.map((c) => c.country).sort(), ['GB', 'US']);
});

test('robots, other sites, junk and oversized bodies are never counted', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: '/' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  await send(env, { t: 'view', p: '/' }, { ua: 'python-requests/2.31' });
  await send(env, { t: 'view', p: '/' }, { ua: '' });
  await send(env, { t: 'view', p: '/' }, { origin: 'https://evil.example' });
  await send(env, { t: 'view', p: '/' }, { origin: null });
  await send(env, { t: 'click', p: '/' });
  await send(env, { t: 'view', p: 'x'.repeat(2000) });
  const s = await stats(env);
  assert.equal(s.totals.views, 0);
  assert.equal(s.totals.downloadClicks, 0);
});

test('a bad page path is filed as /other, and nothing personal is stored', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: 'javascript:alert(1)' }, { ip: '192.0.2.55' });
  const s = await stats(env);
  assert.deepEqual(s.pages, [{ page: '/other', views: 1 }]);
  const rows = env.DB.db.prepare('SELECT * FROM visitors').all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].h, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(env.DB.db.prepare('SELECT * FROM events').all()).includes('192.0.2.55'), 'no IP anywhere');
  assert.ok(!rows[0].h.includes('192'), 'hash, not the address');
});

test('only the site itself gets CORS for sending; stats are public', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  const ok = await send(env, { t: 'view', p: '/' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sixgree.com');
  const other = await send(env, { t: 'view', p: '/' }, { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const res = await worker.fetch(new Request('https://stats.sixgree.com/stats'), env, { waitUntil() {} });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal((await worker.fetch(new Request('https://stats.sixgree.com/nope'), env, { waitUntil() {} })).status, 404);
});
