// The sixgree.com visit and download counter (workers/stats): what it counts,
// what it refuses, and that it keeps no IP address or browser string, only a
// salted hash for the day. Runs the Worker against
// node:sqlite standing in for D1, with D1's batch semantics: one transaction,
// statements in order, all or nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../workers/stats/index.js';

const SCHEMA = readFileSync(new URL('../workers/stats/schema.sql', import.meta.url), 'utf8');

function fakeD1(schema = SCHEMA) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        for (const s of list) await s.run();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

// Errors the Worker logs, kept so a test can see them (and none leak to the output).
function quietErrors() {
  const seen = [];
  const original = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  return { seen, restore: () => { console.error = original; } };
}

async function send(env, body, { origin = 'https://sixgree.com', ua = CHROME, ip = '203.0.113.7', country = 'US', raw, headers = {} } = {}) {
  const waits = [];
  const req = new Request('https://stats.sixgree.com/e', {
    method: 'POST', body: raw ?? JSON.stringify(body),
    headers: { ...(origin ? { origin } : {}), 'user-agent': ua, 'cf-connecting-ip': ip, 'content-type': 'text/plain', ...headers },
  });
  Object.defineProperty(req, 'cf', { value: { country } });
  const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}

async function stats(env, days = 7) {
  const res = await worker.fetch(new Request(`https://stats.sixgree.com/stats?days=${days}`), env, { waitUntil() {} });
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
  assert.deepEqual(s.cut, { pages: false, referrers: false, countries: false, at: 25 });
});

test('robots, other sites, junk and oversized bodies are never counted', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: '/' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  await send(env, { t: 'view', p: '/' }, { ua: 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0) Chrome/130' });
  await send(env, { t: 'view', p: '/' }, { ua: 'python-requests/2.31' });
  await send(env, { t: 'view', p: '/' }, { ua: '' });
  await send(env, { t: 'view', p: '/' }, { origin: 'https://evil.example' });
  await send(env, { t: 'view', p: '/' }, { origin: 'null' });
  await send(env, { t: 'view', p: '/' }, { origin: null });
  await send(env, { t: 'view', p: '/' }, { headers: { dnt: '1' } });
  await send(env, { t: 'download', p: 'windows' }, { headers: { 'sec-gpc': '1' } });
  await send(env, { t: 'click', p: '/' });
  await send(env, { t: 'view', p: 'x'.repeat(2000) });
  const s = await stats(env);
  assert.equal(s.totals.views, 0);
  assert.equal(s.totals.downloadClicks, 0);
});

test('junk bodies are refused quietly, never thrown', async () => {
  const errors = quietErrors();
  try {
    const env = { DB: fakeD1(), SALT: 's' };
    for (const raw of ['null', '"view"', '{not json', '[]', '7', '']) await send(env, null, { raw });
    assert.deepEqual(errors.seen, []);
    assert.equal((await stats(env)).totals.views, 0);
  } finally { errors.restore(); }
});

test('a body that can\'t be read is logged, and the page still gets its 204', async () => {
  const errors = quietErrors();
  try {
    const env = { DB: fakeD1(), SALT: 's' };
    const req = { method: 'POST', url: 'https://stats.sixgree.com/e', headers: new Headers({ origin: 'https://sixgree.com' }),
      text: () => Promise.reject(new Error('body already closed')) };
    const res = await worker.fetch(req, env, { waitUntil() {} });
    assert.equal(res.status, 204);
    assert.ok(errors.seen.some((m) => /body read failed: body already closed/.test(m)));
  } finally { errors.restore(); }
});

test('a real Chrome on a Cubot phone is a person, not a robot', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: '/' }, { ua: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36' });
  assert.equal((await stats(env)).totals.views, 1);
});

test('bad page paths and referrers are filed safely, and no IP address or browser string is stored', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: 'javascript:alert(1)' }, { ip: '192.0.2.55' });
  await send(env, { t: 'view', p: '/A/../..//x' });
  await send(env, { t: 'view', p: '/a/../b/' });
  await send(env, { t: 'view', p: '/a//b/' });
  await send(env, { t: 'view', p: '/Docs/' });
  await send(env, { t: 'view', p: '/', r: '-.-' });
  await send(env, { t: 'view', p: '/', r: '192.168.1.10' });
  await send(env, { t: 'view', p: '/', r: 'localhost' });
  await send(env, { t: 'view', p: '/', r: 'News.YCombinator.com' });
  await send(env, { t: 'view', p: '/', r: 'example.com.' });
  await send(env, { t: 'view', p: '/', r: 'xn--d1acufc.xn--p1ai' });
  await send(env, { t: 'view', p: '/', r: 'com.google.android.gm' });
  const s = await stats(env);
  assert.deepEqual(s.pages, [{ page: '/', views: 7 }, { page: '/other', views: 4 }, { page: '/docs/', views: 1 }]);
  assert.deepEqual(s.referrers.map((x) => x.site).sort(),
    ['com.google.android.gm', 'example.com', 'news.ycombinator.com', 'xn--d1acufc.xn--p1ai'], 'only real host names, lower case');
  const rows = env.DB.db.prepare('SELECT * FROM visitors').all();
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.match(r.h, /^[0-9a-f]{16}$/);
  const everything = JSON.stringify([
    env.DB.db.prepare('SELECT * FROM events').all(), rows, env.DB.db.prepare('SELECT * FROM daily_visitors').all(),
  ]);
  assert.ok(!everything.includes('192.0.2.55') && !everything.includes('203.0.113.7'), 'no IP address anywhere');
  assert.ok(!everything.includes('Chrome'), 'no browser string anywhere');
});

test('only the site itself gets CORS for sending; stats are public', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  const ok = await send(env, { t: 'view', p: '/' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sixgree.com');
  const www = await send(env, { t: 'view', p: '/' }, { origin: 'https://www.sixgree.com' });
  assert.equal(www.headers.get('access-control-allow-origin'), 'https://www.sixgree.com');
  const other = await send(env, { t: 'view', p: '/' }, { origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const res = await worker.fetch(new Request('https://stats.sixgree.com/stats'), env, { waitUntil() {} });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal((await worker.fetch(new Request('https://stats.sixgree.com/nope'), env, { waitUntil() {} })).status, 404);
});

test('unique visitors: a returning visitor is counted once a day', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  for (const ip of ['a', 'b', 'a', 'c', 'b', 'a'].map((x) => `203.0.113.${x.charCodeAt(0)}`)) {
    await send(env, { t: 'view', p: '/' }, { ip });
  }
  const s = await stats(env);
  assert.equal(s.totals.views, 6);
  assert.equal(s.totals.visitorDays, 3);
});

test('a new visitor adds one to the stored count; the day is never recounted (D1 bills every row read)', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  const ins = env.DB.db.prepare('INSERT INTO visitors (day, h) VALUES (?, ?)');
  for (let i = 0; i < 5; i++) ins.run(today(), `${i}`.repeat(16));
  env.DB.db.prepare('INSERT INTO daily_visitors (day, n) VALUES (?, ?)').run(today(), 40);
  await send(env, { t: 'view', p: '/' });
  assert.equal((await stats(env)).totals.visitorDays, 41, 'a recount of the hashes would say 6');
});

test('REGRESSION: a day keeps its visitor count after its hashes are deleted', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  await send(env, { t: 'view', p: '/' }, { ip: '203.0.113.1' });
  await send(env, { t: 'view', p: '/' }, { ip: '203.0.113.2' });
  await send(env, { t: 'view', p: '/docs/' }, { ip: '203.0.113.2' });
  assert.equal((await stats(env)).totals.visitorDays, 2);
  env.DB.db.exec('DELETE FROM visitors');   // what the end-of-day cleanup does
  const s = await stats(env);
  assert.equal(s.totals.visitorDays, 2, 'the count outlives the hashes');
  assert.equal(s.totals.views, 3);
});

test('hashes are kept only for today: a view deletes every earlier one, and so does the daily cron', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  const ins = env.DB.db.prepare('INSERT INTO visitors (day, h) VALUES (?, ?)');
  ins.run(daysAgo(40), 'aaaaaaaaaaaaaaaa');
  ins.run(daysAgo(2), 'bbbbbbbbbbbbbbbb');
  ins.run(daysAgo(1), 'cccccccccccccccc');
  const left = () => env.DB.db.prepare('SELECT day FROM visitors ORDER BY day').all().map((r) => r.day);
  assert.equal((await stats(env)).oldestVisitorHash, daysAgo(40), '/stats shows the oldest hash held');
  await send(env, { t: 'view', p: '/' });
  assert.deepEqual(left(), [today()], 'the first view of the day deletes every earlier hash');
  assert.equal((await stats(env)).oldestVisitorHash, today());

  ins.run(daysAgo(1), 'dddddddddddddddd');   // a day nobody visited after
  const waits = [];
  await worker.scheduled({ cron: '5 0 * * *' }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(left(), [today()], 'the cron deletes everything before today');
  assert.equal((await stats(env)).totals.visitorDays, 1, 'counts are untouched');
});

test('a failing cron cleanup is logged and fails the run, so Cloudflare\'s cron history shows it', async () => {
  const errors = quietErrors();
  try {
    const env = { DB: fakeD1('CREATE TABLE unrelated (x)'), SALT: 's' };
    const waits = [];
    await worker.scheduled({ cron: '5 0 * * *' }, env, { waitUntil: (p) => waits.push(p) });
    await assert.rejects(Promise.all(waits), /visitors/);
    assert.ok(errors.seen.some((m) => /hash cleanup failed/.test(m)));
  } finally { errors.restore(); }
});

test('without the SALT secret, views count but no hash is stored', async () => {
  const errors = quietErrors();
  try {
    const env = { DB: fakeD1() };
    await send(env, { t: 'view', p: '/' });
    const s = await stats(env);
    assert.equal(s.totals.views, 1);
    assert.equal(s.totals.visitorDays, 0);
    assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM visitors').get().n, 0, 'an unsalted hash could be reversed');
    assert.ok(errors.seen.some((m) => /SALT/.test(m)), 'says so in the logs');
  } finally { errors.restore(); }
});

test('REGRESSION: a failed write is logged, never silent, and /stats says it failed instead of answering zeros', async () => {
  const errors = quietErrors();
  try {
    // The tables from before daily_visitors existed: the batch fails as a whole.
    const old = SCHEMA.slice(0, SCHEMA.indexOf('-- Each day\'s unique-visitor count'));
    const env = { DB: fakeD1(old), SALT: 's' };
    assert.equal((await send(env, { t: 'view', p: '/' })).status, 204, 'the page never sees it');
    assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0, 'D1 rolls the whole batch back');
    assert.ok(errors.seen.some((m) => /record failed/.test(m) && /daily_visitors/.test(m)), 'the failure is logged');
    const res = await worker.fetch(new Request('https://stats.sixgree.com/stats'), env, { waitUntil() {} });
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /could not be read/);
  } finally { errors.restore(); }
});

test('schema.sql can be run again: it raises a day\'s count to its hashes, and never lowers one', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA.slice(0, SCHEMA.indexOf('-- Each day\'s unique-visitor count')));
  const ins = db.prepare('INSERT INTO visitors (day, h) VALUES (?, ?)');
  ins.run(today(), 'aaaaaaaaaaaaaaaa');
  ins.run(today(), 'bbbbbbbbbbbbbbbb');
  db.exec(SCHEMA);
  db.exec(SCHEMA);
  const counts = () => db.prepare('SELECT day, n FROM daily_visitors ORDER BY day').all().map((r) => ({ ...r }));
  assert.deepEqual(counts(), [{ day: today(), n: 2 }]);
  // Hashes an older Worker stored after the first run, without counting them.
  ins.run(today(), 'cccccccccccccccc');
  ins.run(today(), 'eeeeeeeeeeeeeeee');
  db.exec(SCHEMA);
  assert.deepEqual(counts(), [{ day: today(), n: 4 }], 'raised to the hashes');
  db.prepare('INSERT INTO daily_visitors (day, n) VALUES (?, ?)').run(daysAgo(3), 50);   // its hashes long gone
  db.prepare('UPDATE daily_visitors SET n = 9 WHERE day = ?').run(today());
  db.exec(SCHEMA);
  assert.deepEqual(counts(), [{ day: daysAgo(3), n: 50 }, { day: today(), n: 9 }], 'never lowered');
});

test('/stats windows: 90 days at most, whole days only, and days with only some kinds of rows', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  const ev = env.DB.db.prepare("INSERT INTO events (day, kind, key, ref, country, n) VALUES (?, ?, ?, '', 'US', ?)");
  ev.run(daysAgo(90), 'view', '/', 100);       // just outside 90 days
  ev.run(daysAgo(89), 'view', '/', 1);         // the first of the 90
  ev.run(daysAgo(30), 'download', 'windows', 2); // downloads only
  ev.run(daysAgo(20), 'view', '/', 3);         // views only, no visitor count
  env.DB.db.prepare('INSERT INTO daily_visitors (day, n) VALUES (?, ?)').run(daysAgo(10), 7); // visitors only
  const s = await stats(env, 90);
  assert.equal(s.days, 90);
  assert.equal(s.since, daysAgo(89));
  assert.deepEqual(s.totals, { views: 4, visitorDays: 7, downloadClicks: 2 });
  assert.deepEqual(s.perDay.map((d) => [d.day, d.views, d.downloads, d.visitors]), [
    [daysAgo(89), 1, 0, 0], [daysAgo(30), 0, 2, 0], [daysAgo(20), 3, 0, 0], [daysAgo(10), 0, 0, 7],
  ]);
  assert.equal((await stats(env, 500)).days, 90);
  assert.equal((await stats(env, 2.5)).days, 2, 'whole days');
  assert.equal((await stats(env, 1)).since, today());
  assert.equal((await stats(env, 'x')).days, 28);
  assert.equal((await stats(env, 0)).days, 28);
});

test('/stats says when a list was cut at 25 rows', async () => {
  const env = { DB: fakeD1(), SALT: 's' };
  for (let i = 0; i < 30; i++) await send(env, { t: 'view', p: `/blog/post-${i}/` });
  let s = await stats(env);
  assert.equal(s.pages.length, 25);
  assert.equal(s.cut.pages, true);
  assert.equal(s.cut.referrers, false);
  assert.equal(s.cut.countries, false);
  assert.equal(s.totals.views, 30, 'the totals are never cut');
  for (let i = 0; i < 30; i++) {
    await send(env, { t: 'view', p: '/', r: `site${i}.example.com` }, { country: `Q${String.fromCharCode(65 + (i % 26))}${i}` });
  }
  s = await stats(env);
  assert.equal(s.referrers.length, 25);
  assert.equal(s.cut.referrers, true);
  assert.equal(s.cut.countries, true);
});

test('REGRESSION: the site counts with a CORS fetch, not sendBeacon (no-referrer makes a beacon\'s Origin null in Firefox and Safari)', () => {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  const counting = app.slice(app.indexOf('// 9. Counting'));
  assert.ok(counting.length > 100, 'the counting section is there');
  assert.doesNotMatch(counting, /sendBeacon\(/);
  assert.match(counting, /fetch\('https:\/\/stats\.sixgree\.com\/e'/);
  assert.match(counting, /mode: 'cors'/);
  assert.match(counting, /keepalive: true/);
  assert.match(counting, /navigator\.webdriver/, 'automated browsers are not counted');
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src[^;"]*https:\/\/stats\.sixgree\.com/);
});

// Runs site/app.js §9 as a browser would, with a stand-in page and fetch.
function runCounting({ navigator = {}, hostname = 'sixgree.com' } = {}) {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  const calls = [];
  const fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(); };
  const ctx = { navigator, location: { hostname, pathname: '/docs/' }, document: { referrer: 'https://www.reddit.com/r/x', addEventListener() {} }, fetch, URL };
  ctx.window = { fetch };
  vm.runInNewContext(app.slice(app.indexOf('// 9. Counting')), ctx);
  return calls;
}

test('the page sends one view, and nothing for automated browsers, Do Not Track, Global Privacy Control or other hosts', () => {
  const [one, ...rest] = runCounting();
  assert.equal(rest.length, 0);
  assert.equal(one.url, 'https://stats.sixgree.com/e');
  assert.equal(one.opts.mode, 'cors');
  assert.equal(one.opts.keepalive, true);
  assert.equal(one.opts.credentials, 'omit');
  assert.deepEqual(JSON.parse(one.opts.body), { t: 'view', p: '/docs/', r: 'www.reddit.com' });
  assert.equal(runCounting({ navigator: { webdriver: true } }).length, 0);
  assert.equal(runCounting({ navigator: { doNotTrack: '1' } }).length, 0);
  assert.equal(runCounting({ navigator: { globalPrivacyControl: true } }).length, 0);
  assert.equal(runCounting({ hostname: 'blakeb056.github.io' }).length, 0);
});

test('the download counter counts installers only, not the checksums file', () => {
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  const src = app.slice(app.indexOf('const platformOf'), app.indexOf("send('view'"));
  const platformOf = new Function(`${src}; return platformOf;`)();
  const base = 'https://github.com/blakeb056/six-degrees/releases/latest/download/';
  assert.equal(platformOf(`${base}Sixgree-Mac-Apple-Silicon.dmg`), 'mac-apple-silicon');
  assert.equal(platformOf(`${base}Sixgree-Mac-Intel.dmg`), 'mac-intel');
  assert.equal(platformOf(`${base}Sixgree-Windows-Setup.exe`), 'windows');
  assert.equal(platformOf(`${base}Sixgree-Linux-x64.deb`), 'linux-deb');
  assert.equal(platformOf(`${base}Sixgree-Linux-x64.tar.gz`), 'linux-tar');
  assert.equal(platformOf(`${base}SHA256SUMS`), null);
  assert.equal(platformOf(`${base}latest-mac.yml`), null);
  assert.equal(platformOf('https://github.com/blakeb056/six-degrees'), null);
});
