// The learning log as a complete behaviour logger (Blake, 2026-10-19: "a
// complete logger to collect data, behaviour etc, to have true specific data
// sets to use and point at in the future for calibration, analysis,
// behaviour"): the taxonomy (lib/behavior-taxonomy.js) and its doc, every page
// type fired from a UI hook, the pages' buffer (lib/behavior-buffer.js:
// batching, dedupe, rate limits), the server's batches (lib/learning-log.js
// recordBatch), the "Record my behaviour" switch, settings changes, the CSV
// export, the readers for analysis, and no network egress. On a temporary
// database with invented people.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-behaviour-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let getDb, log, tax, buf, settings, learningRoute, dataLearning, outreach, store, rpc, promote, readZip;
before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  log = await import('../lib/learning-log.js');
  tax = await import('../lib/behavior-taxonomy.js');
  buf = await import('../lib/behavior-buffer.js');
  settings = await import('../lib/settings.js');
  learningRoute = await import('../app/api/learning/route.js');
  ({ POST: dataLearning } = await import('../app/api/data/learning/route.js'));
  ({ POST: outreach } = await import('../app/api/outreach/route.js'));
  store = await import('../lib/class-store.js');
  rpc = await import('../lib/rpc.js');
  promote = await import('../lib/promote.js');
  ({ readZip } = await import('../lib/zip-read.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const url = (id) => `https://www.linkedin.com/in/${id}`;
const root = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

beforeEach(() => {
  const db = getDb();
  for (const t of ['linkedin_connections', 'users', 'user_stats', 'queue_items', 'learning_events', 'user_profile', 'notifications']) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM app_meta WHERE key = 'settings'");
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('me', 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections (id, user_id, degree, name, headline, tier, power_score, profile_url, source_connection_id, unlock_status)
                          VALUES (?, 'me', ?, ?, ?, ?, ?, ?, ?, 'locked')`);
  add.run('maya', 1, 'Maya Chen', 'VP Sales at Northwind Labs', 'A', 6.5, url('maya'), null);
  add.run('ada@maya', 2, 'Ada Stone', 'Founder at Quillon Labs', 'S', 7.9, url('ada'), 'maya');
  add.run('ben@maya', 2, 'Ben Ortiz', 'Recruiter at Halcyon', 'B', 4.0, url('ben'), 'maya');
  log.resetRateLimits();
});

const post = (fn, route, body) => fn(new Request(`http://127.0.0.1${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const batch = async (events, extra = {}) => (await post(learningRoute.POST, '/api/learning', { session: 's-test-1', events, ...extra })).json();
const events = (kind, type) => getDb().prepare(`SELECT * FROM learning_events WHERE kind = ?${type ? ' AND type = ?' : ''} ORDER BY seq`)
  .all(...[kind, ...(type ? [type] : [])]).map((e) => ({ ...e, data: JSON.parse(e.data) }));
const get = async (q) => (await learningRoute.GET(new Request(`http://127.0.0.1/api/learning?${q}`))).json();

// ── The taxonomy, its doc and its hooks ─────────────────────────────────────

/** Every .js file under a folder. */
function walk(rel) {
  const out = [];
  for (const name of readdirSync(path.join(root, rel))) {
    const p = path.join(rel, name);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...walk(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

test('the taxonomy: every kind and type documented in docs/brain/LEARNING-LOG.md, with its fields', () => {
  const doc = read('docs/brain/LEARNING-LOG.md');
  for (const kind of tax.KINDS) {
    assert.match(doc, new RegExp(`## \`${kind}\``), `a section for ${kind}`);
    for (const [type, def] of Object.entries(tax.TAXONOMY[kind])) {
      assert.ok(doc.includes(`\`${kind}/${type}\``), `${kind}/${type} is documented`);
      assert.ok(['page', 'server', 'scanner'].includes(def.from), `${kind}/${type} says who records it`);
      assert.ok(def.when.length > 10, `${kind}/${type} says when it fires`);
      for (const f of Object.keys(def.fields)) assert.ok(doc.includes(`\`${f}\``), `${kind}/${type}'s field ${f} is documented`);
    }
  }
  // The store's kinds are the taxonomy's, and the version moved with it.
  assert.deepEqual(log.KINDS, tax.KINDS);
  assert.equal(log.LEARNING_SCHEMA_VERSION, 2);
});

// How each page type is fired, by the helper that sends it.
const HOOKS = {
  'exposure/*': (type) => new RegExp(`logExposure\\('${type}'`),
  'interaction/hover': () => /logHover\(/,
  'interaction/card-dwell': () => /usePersonDwell\(/,
  'interaction/card-open': () => /openType: 'card-open'|logInteraction\('card-open'/,
  'control/search': () => /logSearch\(/,
  'section/seen': () => /useSeen\(/,
  'health/frames': () => /frameMeter\(/,
  'interaction/*': (type) => new RegExp(`logInteraction\\('${type}'|track\\('interaction', '${type}'`),
};

test('every page type fires from its UI hook: a call in the pages for each one the taxonomy lists', () => {
  const files = [...walk('app'), 'lib/learning-client.js', 'lib/galaxy-lab.js'];
  const src = files.map((f) => read(f)).join('\n');
  const missing = [];
  for (const id of tax.PAGE_TYPES) {
    const [kind, type] = id.split('/');
    const def = tax.typeOf(kind, type);
    if (def.reserved || def.from !== 'page') continue;
    const hook = HOOKS[id] || HOOKS[`${kind}/*`];
    const pattern = hook ? hook(type) : new RegExp(`(track|trackSettled)\\('${kind}', '${type}'`);
    if (!pattern.test(src)) missing.push(id);
  }
  assert.deepEqual(missing, [], 'page types with no hook');
});

// Where each server type is recorded: the file, and the call that records it.
const SERVER_HOOKS = {
  'interaction/profile-open': ['app/api/profile-view/route.js', /type: 'profile-open'/],
  'interaction/connect-click': ['app/api/scraper/route.js', /'connect-click'/],
  'interaction/read-all-mutuals': ['app/api/scraper/route.js', /'read-all-mutuals'/],
  'interaction/request-sent': ['lib/send-log.js', /type: 'request-sent'/],
  'interaction/invite-detected': ['app/api/scraper/route.js', /type: 'invite-detected'/],
  'interaction/more-like-this': ['lib/class-store.js', /'more-like-this'/],
  'interaction/not-this-one': ['lib/class-store.js', /'not-this-one'/],
  'onboarding/class-pick': ['lib/class-store.js', /'class-switch' : 'class-pick'/],
  'onboarding/class-switch': ['lib/class-store.js', /'class-switch' : 'class-pick'/],
  'scan/start': ['app/api/scraper/route.js', /kind: 'scan', type: 'start'/],
  'scan/page': ['app/api/scraper/route.js', /logScan\('page'/],
  'scan/batch': ['app/api/ingest/route.js', /kind: 'scan', type: 'batch'/],
  'scan/break': ['app/api/scraper/route.js', /logScan\('break'|kind: 'scan', type: 'break'/],
  'scan/limit': ['app/api/scraper/route.js', /kind: 'scan', type: 'limit'/],
  'scan/stop': ['app/api/scraper/route.js', /kind: 'scan', type: 'stop'/],
  'scan/error': ['app/api/scraper/route.js', /kind: 'scan', type: 'error'/],
  'scan/job': ['app/api/scraper/route.js', /kind: 'scan', type: 'job'/],
  'settings/change': ['lib/settings.js', /recordSettingsChange\(db, before, after/],
  'health/dropped': ['lib/learning-log.js', /kind: 'health', type: 'dropped'/],
  'outcome/accepted': ['lib/learning-log.js', /kind: 'outcome', type: 'accepted'/],
  'outcome/withdrawn': ['lib/send-log.js', /kind: 'outcome', type: 'withdrawn'/],
  'outcome/still-pending': ['lib/send-log.js', /kind: 'outcome', type: 'still-pending'/],
  'load/hour': ['lib/learning-log.js', /kind: 'load', type: 'hour'/],
  'snapshot/person': ['lib/learning-log.js', /'snapshot', 'person'/],
};

test('every server and scanner type is recorded where it happens', () => {
  const missing = [];
  for (const kind of tax.KINDS) {
    for (const [type, def] of Object.entries(tax.TAXONOMY[kind])) {
      if (def.from === 'page' || def.reserved) continue;
      const id = `${kind}/${type}`;
      if (kind === 'onboarding' && !SERVER_HOOKS[id]) {
        if (!new RegExp(`log\\(db, '${type}'`).test(read('lib/class-store.js'))) missing.push(id);
        continue;
      }
      const hook = SERVER_HOOKS[id];
      if (!hook || !hook[1].test(read(hook[0]))) missing.push(id);
    }
  }
  assert.deepEqual(missing, []);
});

// ── The pages' buffer ───────────────────────────────────────────────────────

function fakeBuffer(opts = {}) {
  let t = 1000;
  const timers = [];
  const sent = [];
  const b = buf.createBuffer({
    send: (payload, how) => sent.push({ ...payload, ...how }),
    now: () => t,
    later: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    idle: (fn) => fn(),
    ...opts,
  });
  return { b, sent, timers, tick: (ms) => { t += ms; }, fire: () => timers.splice(0).forEach((x) => x.fn()) };
}

test('batching: events wait and go together after a few seconds, when the page is idle; urgent sends everything now', () => {
  const { b, sent, timers, tick, fire } = fakeBuffer();
  for (let i = 0; i < 10; i += 1) { b.add({ kind: 'nav', type: 'enter', data: { tab: `t${i}` } }); tick(5); }
  assert.equal(sent.length, 0, 'nothing sent at once');
  assert.equal(timers.length, 1, 'one timer for the lot');
  assert.equal(timers[0].ms, buf.FLUSH_MS);
  fire();
  assert.equal(sent.length, 1, 'one batch');
  assert.equal(sent[0].events.length, 10);
  // A batch stays under keepalive's 64 KB: big events split, and urgent sends them all.
  const big = fakeBuffer();
  const limit = tax.typeOf('control', 'filter').limit;
  for (let i = 0; i < limit + 30; i += 1) { big.b.add({ kind: 'control', type: 'filter', data: { what: 'grid', value: `${i}:${'x'.repeat(1000)}` } }); big.tick(1); }
  big.b.flush({ urgent: true });
  assert.ok(big.sent.length >= 3, 'split');
  assert.ok(big.sent.every((p) => JSON.stringify(p.events).length <= buf.MAX_BATCH_BYTES), 'each under the cap');
  assert.equal(big.sent.reduce((n, p) => n + p.events.length, 0), limit, 'every one queued went');
  assert.equal(big.sent[0].dropped, 30, 'past the limit, dropped and counted');
  assert.ok(big.sent.every((p) => p.urgent === true));
});

test('dedupe on the page: the same event twice within a second is one; a second later it counts again', () => {
  const { b, tick } = fakeBuffer();
  assert.equal(b.add({ kind: 'control', type: 'tiers', data: { on: true } }), true);
  assert.equal(b.add({ kind: 'control', type: 'tiers', data: { on: true } }), false, 'React ran it twice');
  assert.equal(b.add({ kind: 'control', type: 'tiers', data: { on: false } }), true, 'a different value is a different event');
  tick(buf.SAME_MS + 1);
  assert.equal(b.add({ kind: 'control', type: 'tiers', data: { on: true } }), true);
  assert.equal(b.waiting(), 3);
});

test('rate limits on the page: a type past its limit a minute is dropped and counted, and the count goes with the next batch', () => {
  const { b, sent, tick, fire } = fakeBuffer();
  const limit = tax.typeOf('control', 'tiers').limit;
  for (let i = 0; i < limit + 25; i += 1) { b.add({ kind: 'control', type: 'tiers', data: { on: true, i } }); tick(2); }
  assert.equal(b.waiting(), limit);
  assert.equal(b.droppedSoFar(), 25);
  fire();
  assert.equal(sent[0].dropped, 25);
  // A minute on, the type is welcome again.
  tick(60 * 1000);
  assert.equal(b.add({ kind: 'control', type: 'tiers', data: { on: true, i: 'later' } }), true);
});

test('the switch on the page: off, nothing is queued and what was waiting goes', () => {
  const { b } = fakeBuffer();
  b.add({ kind: 'nav', type: 'enter', data: { tab: 'map' } });
  b.setOn(false);
  assert.equal(b.waiting(), 0);
  assert.equal(b.add({ kind: 'nav', type: 'enter', data: { tab: 'class' } }), false);
  b.setOn(true);
  assert.equal(b.add({ kind: 'nav', type: 'enter', data: { tab: 'class' } }), true);
});

// ── The server's batches ────────────────────────────────────────────────────

test('a batch: each event held to the taxonomy, its person snapshotted, the session and tab kept, unknown ones refused', async () => {
  const r = await batch([
    { kind: 'session', type: 'start', at: Date.now(), data: { shell: 'browser', size: 'medium-landscape', reload: false, secret: 'never kept' } },
    { kind: 'nav', type: 'enter', data: { tab: 'separation', sub: null, from: 'network', entry: 'header' } },
    { kind: 'interaction', type: 'card-open', person: { id: 'ada@maya' }, data: { where: 'galaxy', tab: 'network' } },
    { kind: 'interaction', type: 'hover', person: { id: 'ben@maya' }, data: { n: 2, ms: 4100, where: 'galaxy' } },
    { kind: 'interaction', type: 'hover', person: { id: 'ben@maya' }, data: { n: 1, ms: 400 } },
    { kind: 'control', type: 'made-up', data: {} },
    { kind: 'outcome', type: 'accepted', person: { id: 'ada@maya' }, data: {} },
    { kind: 'exposure', type: 'separation', data: { people: [{ id: 'ada@maya' }, { id: 'ben@maya' }], sort: 'separation' } },
  ]);
  assert.equal(r.on, true);
  assert.equal(r.recorded, 5);
  assert.equal(r.refused, 3, 'a short hover, a made-up type, and an outcome from a page');
  const [start] = events('session', 'start');
  assert.equal(start.data.sid, 's-test-1');
  assert.equal(start.data.version, JSON.parse(read('package.json')).version, 'the server adds the version');
  assert.ok('plugins' in start.data && 'class' in start.data && 'theme' in start.data);
  assert.equal(start.data.secret, undefined, 'only the type\'s own fields');
  const [open] = events('interaction', 'card-open');
  assert.equal(open.person, 'ada');
  assert.ok(open.snap, 'snapshotted');
  assert.equal(open.data.tab, 'network');
  assert.equal(events('interaction', 'hover')[0].data.ms, 4100);
  assert.equal(events('exposure', 'separation')[0].data.sid, 's-test-1');
});

test('dedupe on the server: a page event with a key is kept once per session and key', async () => {
  const seen = { kind: 'section', type: 'seen', key: 'separation:S:1', data: { page: 'separation', section: 'S' } };
  assert.equal((await batch([seen])).recorded, 1);
  assert.equal((await batch([seen])).recorded, 0, 'the same visit');
  assert.equal((await batch([seen], { session: 's-test-2' })).recorded, 1, 'another session');
  assert.equal((await batch([{ ...seen, key: 'separation:S:2' }])).recorded, 1, 'the next visit');
});

test('rate limits on the server: past a type\'s limit a minute the rest are dropped, and the drop is logged once', async () => {
  const limit = tax.typeOf('control', 'filter').limit;
  const flood = Array.from({ length: 150 }, (_, i) => ({ kind: 'control', type: 'filter', data: { what: 'tier', value: `T${i}`, where: 'network' } }));
  const r = await batch(flood);
  assert.equal(r.recorded, limit);
  assert.equal(r.dropped, 150 - limit);
  const [drop] = events('health', 'dropped');
  assert.equal(drop.data.n, 150 - limit);
  assert.equal(drop.data.where, 'server');
  // The pages' own drops are logged too.
  log.resetRateLimits();
  await batch([], { dropped: 7 });
  assert.equal(events('health', 'dropped').at(-1).data.n, 7);
  assert.equal(events('health', 'dropped').at(-1).data.where, 'page');
  // At most MAX_BATCH events are read from one batch.
  log.resetRateLimits();
  const many = Array.from({ length: log.MAX_BATCH + 50 }, (_, i) => ({ kind: 'nav', type: 'dwell', data: { tab: 'map', ms: i } }));
  const r2 = await batch(many);
  assert.ok(r2.recorded + r2.dropped + r2.refused <= log.MAX_BATCH);
});

test('search privacy: a query that could be a name keeps its category and length only; a company or sector query keeps its words', async () => {
  assert.equal(tax.queryCategory('Ada Stone'), 'person');
  assert.equal(tax.queryCategory('Quillon Labs'), 'company');
  assert.equal(tax.queryCategory('fintech'), 'sector');
  assert.equal(tax.queryCategory('VP Sales'), 'title');
  assert.equal(tax.queryCategory('Halcyon', { companies: new Set(['halcyon']) }), 'company');
  assert.equal(tax.queryCategory('  '), 'empty');
  await batch([
    { kind: 'control', type: 'search', data: { where: 'galaxy', category: 'person', length: 9, text: 'Ada Stone' } },
    { kind: 'control', type: 'search', data: { where: 'galaxy', category: 'company', length: 12, text: 'Quillon Labs' } },
    { kind: 'control', type: 'search', data: { where: 'map', category: 'not-a-category', length: 3, text: 'Ben' } },
  ]);
  const [person, company, other] = events('control', 'search');
  assert.equal(person.data.text, undefined, 'never a name');
  assert.equal(person.data.length, 9);
  assert.equal(company.data.text, 'Quillon Labs');
  assert.equal(other.data.category, 'other');
  assert.equal(other.data.text, undefined);
  assert.doesNotMatch(JSON.stringify(events('control')), /Ada Stone|"Ben"/);
});

test('health: an error keeps its message without links, numbers or quoted words; failed requests and slow frames are counted', async () => {
  assert.equal(tax.scrubMessage('Cannot read "Ada Stone" at https://www.linkedin.com/in/ada 12345'), 'Cannot read <text> at <link> <n>');
  await batch([
    { kind: 'health', type: 'error', data: { message: "Failed for 'Ben Ortiz' (row 99999)", code: 'TypeError', source: 'page.js:12' } },
    { kind: 'health', type: 'api-failure', data: { route: '/api/network', status: 500, method: 'GET' } },
    { kind: 'health', type: 'frames', data: { view: 'galaxy', frames: 600, p50: 17, p95: 50, max: 140, slow: 9 } },
    { kind: 'health', type: 'long-tasks', data: { count: 3, totalMs: 410, maxMs: 220 } },
  ]);
  assert.equal(events('health', 'error')[0].data.message, 'Failed for <text> (row <n>)');
  assert.equal(events('health', 'api-failure')[0].data.status, 500);
  assert.equal(events('health', 'frames')[0].data.p95, 50);
});

// ── The switch ──────────────────────────────────────────────────────────────

test('"Record my behaviour" off: only the outcomes and the send log are kept; the switch itself is logged; back on, all is', async () => {
  const db = getDb();
  assert.equal(settings.readSettings(db).recordBehaviour, true, 'on by default');
  settings.writeSettings(db, { recordBehaviour: false });
  const r = await batch([{ kind: 'nav', type: 'enter', data: { tab: 'map' } }, { kind: 'session', type: 'start', data: { shell: 'browser' } }]);
  assert.equal(r.on, false, 'the page is told, and stops');
  assert.equal(r.recorded, 0);
  const row = db.prepare("SELECT * FROM linkedin_connections WHERE id = 'ada@maya'").get();
  assert.equal(log.recordInteraction(db, { type: 'card-open', row }).off, true);
  assert.equal(log.recordExposure(db, { list: 'map', rows: [row] }).off, true);
  log.tryRecord(db, { kind: 'scan', type: 'start', data: { action: 'bridge' } });
  settings.writeSettings(db, { tierScale: 'fixed' });
  // The send log and outcomes stay.
  await post(outreach, '/api/outreach', { action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  log.recordAccepted(db, { row, sentAt: new Date().toISOString(), acceptedDay: '2026-10-19' });
  const kinds = db.prepare('SELECT kind, type FROM learning_events ORDER BY seq').all().map((e) => `${e.kind}/${e.type}`);
  assert.deepEqual([...new Set(kinds)].sort(), ['interaction/request-sent', 'outcome/accepted', 'settings/change', 'snapshot/person']);
  assert.deepEqual(events('settings', 'change').map((e) => e.data.key), ['recordBehaviour'], 'only the switch\'s own change');
  assert.equal(log.logStats(db).on, false);
  settings.writeSettings(db, { recordBehaviour: true });
  assert.equal((await batch([{ kind: 'nav', type: 'enter', data: { tab: 'map' } }])).recorded, 1);
  assert.equal(events('settings', 'change').length, 2);
});

test('settings: every change is logged with its key, old and new; a long value as its size and hash; an unchanged save is not', () => {
  const db = getDb();
  settings.writeSettings(db, { tierScale: 'fixed' });
  settings.writeSettings(db, { tierScale: 'fixed' });
  settings.writeSettings(db, { titleRanking: settings.readSettings(db).titleRanking });
  const [c] = events('settings', 'change');
  assert.equal(events('settings', 'change').length, 1);
  assert.equal(c.data.key, 'tierScale');
  assert.equal(c.data.new, 'fixed');
  assert.ok(c.data.old !== 'fixed');
  log.recordSettingsChange(db, { galaxyLayouts: [] }, { galaxyLayouts: Array.from({ length: 20 }, (_, i) => ({ name: `Layout ${i}`, lab: { a: i } })) });
  const big = events('settings', 'change').at(-1).data.new;
  assert.ok(big.size > 300 && /^[0-9a-f]{16}$/.test(big.hash));
});

// ── Export and Delete ───────────────────────────────────────────────────────

test('Export: JSON with the taxonomy, and a zip with a CSV per kind (formulas made plain text); counts per kind; Delete removes it all', async () => {
  const db = getDb();
  await batch([
    { kind: 'session', type: 'start', data: { shell: 'desktop', size: 'large-landscape' } },
    { kind: 'nav', type: 'dwell', data: { tab: 'map', ms: 1200, activeMs: 900 } },
    { kind: 'interaction', type: 'card-open', person: { id: 'ada@maya' }, data: { where: 'galaxy' } },
  ]);
  db.prepare("UPDATE linkedin_connections SET headline = '=HYPERLINK(\"x\") at Quillon Labs' WHERE id = 'ben@maya'").run();
  log.recordInteraction(db, { type: 'card-open', row: db.prepare("SELECT * FROM linkedin_connections WHERE id = 'ben@maya'").get() });
  const stats = await get('stats=1');
  assert.equal(stats.byKind.session, 1);
  assert.equal(stats.byKind.nav, 1);
  assert.equal(stats.byType['interaction/card-open'], 2);
  const json = await (await post(dataLearning, '/api/data/learning', { action: 'export' })).json();
  assert.ok(json.taxonomy.session.start);
  const res = await post(dataLearning, '/api/data/learning', { action: 'export-csv' });
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="Sixgree learning log .+ \(CSV\)\.zip"/);
  const entries = readZip(Buffer.from(await res.arrayBuffer()));
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['interaction.csv', 'nav.csv', 'session.csv', 'snapshot.csv', 'taxonomy.json']);
  const nav = entries.find((e) => e.name === 'nav.csv').data.toString('utf8').split('\r\n');
  assert.equal(nav[0], 'seq,at,kind,type,person,user_id,lens,snap,schema_version,activeMs,ms,sid,tab');
  assert.match(nav[1], /,nav,dwell,.*,900,1200,s-test-1,map$/);
  const snaps = entries.find((e) => e.name === 'snapshot.csv').data.toString('utf8');
  assert.match(snaps.split('\r\n')[0], /,title,level,company,industry,/);
  assert.doesNotMatch(snaps, /(^|,)=HYPERLINK/m, 'a headline that starts a formula is made plain text');
  const del = await (await post(dataLearning, '/api/data/learning', { action: 'delete', confirm: true })).json();
  assert.ok(del.deleted >= 5);
  assert.equal(del.stats.events, 0);
});

test('kept indefinitely: nothing in the log or its routes deletes or prunes events, except Delete learning log', () => {
  for (const f of ['lib/learning-log.js', 'lib/learning-client.js', 'lib/behavior-buffer.js', 'app/api/learning/route.js', 'app/api/data/learning/route.js']) {
    const deletes = [...read(f).matchAll(/DELETE FROM learning_events[^`'"]*/g)].map((m) => m[0]);
    assert.ok(deletes.every((d) => d === 'DELETE FROM learning_events'), `${f}: only the whole log, on Delete`);
  }
  assert.equal([...read('lib/learning-log.js').matchAll(/DELETE FROM learning_events/g)].length, 1);
});

// ── The readers ─────────────────────────────────────────────────────────────

test('session summaries: each window session with its loads, length, active time, version, size and time per tab', async () => {
  const t0 = Date.now() - 60000;
  await batch([
    { kind: 'session', type: 'start', at: t0, data: { shell: 'desktop', size: 'medium-landscape', reload: false } },
    { kind: 'nav', type: 'enter', at: t0 + 10, data: { tab: 'network', entry: 'open' } },
    { kind: 'nav', type: 'dwell', at: t0 + 20000, data: { tab: 'network', ms: 20000, activeMs: 15000 } },
    { kind: 'nav', type: 'enter', at: t0 + 20001, data: { tab: 'class', from: 'network', entry: 'header' } },
    { kind: 'session', type: 'resize', at: t0 + 30000, data: { size: 'wide-landscape', from: 'medium-landscape' } },
    { kind: 'session', type: 'pulse', at: t0 + 40000, data: { ms: 40000, activeMs: 30000, views: 2 } },
    { kind: 'nav', type: 'dwell', at: t0 + 50000, data: { tab: 'class', ms: 30000, activeMs: 20000 } },
    { kind: 'session', type: 'end', at: t0 + 50001, data: { ms: 50000, activeMs: 35000, views: 2, hiddenMs: 0 } },
  ]);
  await batch([{ kind: 'session', type: 'start', at: t0 + 1000, data: { shell: 'browser', size: 'phone-portrait' } }], { session: 's-other' });
  const { sessions } = await get('sessions=1');
  const s = sessions.find((x) => x.session === 's-test-1');
  assert.equal(sessions.length, 2);
  assert.equal(s.loads, 1);
  assert.equal(s.ms, 50000);
  assert.equal(s.activeMs, 35000);
  assert.equal(s.ended, true);
  assert.equal(s.shell, 'desktop');
  assert.equal(s.size, 'wide-landscape', 'the size it ended at');
  assert.equal(s.views, 2);
  assert.deepEqual(s.tabs, { network: 20000, class: 30000 });
  assert.equal(s.events, 8);
  assert.ok(s.version);
  const { tabs } = await get('dwell=1');
  assert.deepEqual(tabs.map((x) => [x.tab, x.visits, x.ms]), [['class', 1, 30000], ['network', 1, 20000]]);
});

test('the funnel: card, then profile, then Connect, then the request, then accepted; in order, with everyone who took each step', async () => {
  const db = getDb();
  const ada = { id: 'ada@maya' };
  await batch([
    { kind: 'interaction', type: 'card-open', person: ada, data: {} },
    { kind: 'interaction', type: 'card-open', person: { id: 'ben@maya' }, data: {} },
    { kind: 'interaction', type: 'connect-click', person: ada, data: { route: 'panel' } },
  ]);
  const profileView = (await import('../app/api/profile-view/route.js')).POST;
  await post(profileView, '/api/profile-view', { url: url('ada') });
  log.recordInteraction(db, { type: 'connect-click', person: 'ada', data: { route: 'panel', later: true } });
  await post(outreach, '/api/outreach', { action: 'mark-sent', connectionId: 'ada@maya', bridgeId: 'maya' });
  db.prepare('UPDATE queue_items SET sent_at = ? WHERE profile_url = ?').run(new Date(Date.now() - 86400000).toISOString(), url('ada'));
  const { db: builder } = await import('../lib/db.js');
  await promote.promoteToFirstDegree(builder, { profileUrl: url('ada'), userId: 'me', fields: { connected_date: new Date().toISOString().slice(0, 10) } });
  const f = await get('funnel=1');
  assert.deepEqual(f.stages.map((s) => s.stage), log.FUNNEL);
  const by = Object.fromEntries(f.stages.map((s) => [s.stage, s]));
  assert.equal(by['card-open'].reached, 2);
  assert.equal(by['profile-open'].reached, 1);
  assert.equal(by['profile-open'].rate, 0.5);
  assert.equal(by['connect-click'].reached, 1, 'Connect after the profile');
  assert.equal(by['connect-click'].any, 1);
  assert.equal(by['request-sent'].reached, 1);
  assert.equal(by.accepted.reached, 1);
  assert.equal(log.funnel(db, { people: true }).people.find((p) => p.person === 'ada').step, 'accepted');
});

test('duel calibration: every duel shown and answered, the choices, decision times, the left side and mirrored repeats', () => {
  const db = getDb();
  rpc.rescoreAll();
  store.classAction(db, { action: 'pick', class: 'founder' });
  const d1 = store.classAction(db, { action: 'duel', class: 'founder', seed: 1 }).body;
  store.classAction(db, { action: 'duel', class: 'founder', seed: 1 });
  assert.equal(events('onboarding', 'duel-shown').length, 1, 'the same duel shown again is one');
  const shown = events('onboarding', 'duel-shown')[0].data;
  assert.equal(shown.class, 'founder');
  assert.ok(shown.a?.title && shown.b?.title, 'the cards, as attributes');
  const a1 = store.classAction(db, { action: 'answer', class: 'founder', pair: d1.pair, choice: d1.pair.left, ms: 1800, seed: 2 }).body;
  if (a1?.pair) store.classAction(db, { action: 'answer', class: 'founder', pair: a1.pair, choice: 'neither', ms: 3200, seed: 3 });
  const cal = log.duelCalibration(db);
  const c = cal.classes.find((x) => x.class === 'founder');
  assert.ok(c.shown >= 2);
  assert.equal(c.answered, a1?.pair ? 2 : 1);
  assert.equal(c.leftRate, 1);
  assert.ok(c.medianMs >= 1800);
  assert.equal(cal.duels[0].ms, 1800);
  assert.ok(cal.duels[0].a.title);
});

// ── Nothing leaves the machine ──────────────────────────────────────────────

test('no egress: recording a batch never touches the network, and the logger\'s files make no request but to the app itself', async () => {
  const db = getDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the learning log tried to go online'); };
  try {
    log.recordBatch(db, [
      { kind: 'session', type: 'start', data: { shell: 'browser' } },
      { kind: 'interaction', type: 'hover', person: { id: 'ada@maya' }, data: { n: 1, ms: 2000 } },
    ], { session: 's-egress' });
    log.sessionSummaries(db); log.funnel(db); log.dwellByTab(db); log.duelCalibration(db); log.exportCsvZip(db);
    settings.writeSettings(db, { tierScale: 'fixed' });
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const file of ['lib/behavior-taxonomy.js', 'lib/behavior-buffer.js', 'lib/learning-log.js', 'app/api/learning/route.js', 'app/api/data/learning/route.js', 'app/components/BehaviorLogger.js', 'app/components/useBehaviour.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /\bfetch\(|https?:\/\/(?!127\.0\.0\.1)|XMLHttpRequest|sendBeacon|WebSocket|EventSource|node:https?|node:net/, file);
  }
  // The pages' side posts only to this app's own server, and watches only the app's own routes.
  const client = read('lib/learning-client.js');
  assert.deepEqual([...client.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]), ['/api/learning']);
  assert.doesNotMatch(client, /https?:\/\/|sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
  assert.match(client, /url\.origin !== window\.location\.origin/, 'failed requests are only ever the app\'s own');
  // And the settings page sends the switch to the app, nowhere else.
  assert.doesNotMatch(read('app/components/settings/LearningLog.js'), /https?:\/\//);
});

test('the logger is mounted once for every page, and the Settings switch is there', () => {
  assert.match(read('app/layout.js'), /<BehaviorLogger \/>/);
  const ui = read('app/components/settings/LearningLog.js');
  assert.match(ui, /Record my behaviour \(local only\)/);
  assert.match(ui, /saveSettings\(\{ recordBehaviour: next \}\)/);
  assert.match(ui, /export-csv/);
  assert.equal(settings.SETTINGS.recordBehaviour.default, true);
});
