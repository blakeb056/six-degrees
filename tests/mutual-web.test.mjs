// The mutual web (Blake, 2026-10-16: "scanning always for mutuals no matter what ...
// then it should be tracked to map a web of who knows who, to have the artificial
// extended network built up past the 1k mark"). Every mutual line Sixgree sees, on a
// card in any list or a profile already open in its browser, becomes ties (lib/ties.js),
// kept with how often and when (lib/ties-store.js), read as "Known through", warm doors
// and the people seen outside a circle's scan (lib/mutual-web.js). The paid step reads
// one person's full mutual list, only when pressed (scrape.py scan_mutual_list).
//
// The page readers run as Python sends them, against stand-in pages; the routes run on a
// temporary database as Next resolves them (tests/helpers/extensionless.mjs). Nothing
// here opens LinkedIn. Every person and company is invented.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { PYTHON, noPython } from './python.mjs';
import { SCRAPER, HARNESS, noScanner } from './helpers/scanner.mjs';
import {
  tiePairs, orderPair, tieUrl, urlKey, mergeSources, namedMutuals, cardTies, mutualLine, circleTieUrls, TIE_SOURCES,
} from '../lib/ties.js';
import {
  extendedNetwork, knownThrough, knownThroughText, tieIndex, firstDegreeByKey, tieLines, unpackTies, seenOn, webLine,
  mutualRound, mutualNotes, offersMutualList, mutualListNote, MUTUAL_ROUNDS,
} from '../lib/mutual-web.js';
import { breachPeople, warmDoor, bandOf } from '../lib/breach.js';
import { peopleByDegree } from '../lib/degrees.js';
import { separationPeople } from '../lib/separation.js';
import { circleIndex } from '../lib/circle.js';
import { focusSubgraph } from '../lib/circle-focus.js';
import { MUTUALS_MARK, MUTUAL_WATCH_JS, INVITE_WATCH_WORLD, mutualsSeenFor } from '../desktop/lib.mjs';
import { PLUGIN_SINCE, pluginTooOld, capabilityRefusal, AUTO_ACTIONS } from '../lib/scanner-capabilities.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';
import { compareVersions } from '../lib/release.js';
import { scanDoneNotification } from '../lib/notifications.js';
import { busyReason } from '../lib/scraper-client.js';

register('./helpers/extensionless.mjs', import.meta.url);

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-web-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');

let ingestRoute, tiesRoute, networkRoute, getDb, store;

before(async () => {
  ({ POST: ingestRoute } = await import('../app/api/ingest/route.js'));
  tiesRoute = await import('../app/api/ties/route.js');
  ({ GET: networkRoute } = await import('../app/api/network/route.js'));
  ({ getDb } = await import('../lib/db-client.js'));
  store = await import('../lib/ties-store.js');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  for (const t of ['linkedin_connections', 'notifications', 'app_meta', 'connection_ties', 'users']) getDb().exec(`DELETE FROM ${t}`);
  getDb().prepare("INSERT INTO users (id, name) VALUES ('me', 'Invented Me')").run();
});

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const url = (slug) => `https://www.linkedin.com/in/${slug}/`;
const ingest = async (body) => (await ingestRoute(new Request('http://127.0.0.1/api/ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'me', ...body }),
}))).json();
const tiesRows = () => getDb().prepare('SELECT a_url, b_url, source, seen_count FROM connection_ties ORDER BY a_url, b_url').all()
  .map((t) => `${t.a_url.split('/in/')[1].replace(/\/$/, '')}~${t.b_url.split('/in/')[1].replace(/\/$/, '')} ${t.source} ${t.seen_count}`);
const yours = async (...slugs) => ingest({ type: 'degree1', connections: slugs.map((s) => ({ name: name(s), headline: 'Engineer at Initech', profileUrl: url(s) })) });
const name = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const idOf = (slug, degree = 1) => getDb().prepare('SELECT id FROM linkedin_connections WHERE profile_url = ? AND degree = ?').get(url(slug), degree)?.id;

// ── The page readers return the mutuals they name ────────────────────────────

/** A snippet of scrape.py as Python delivers it (a raw string, read through the AST). */
function snippet(t, which) {
  if (noScanner(t)) return null;
  const run = spawnSync(PYTHON, ['-c', `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == sys.argv[2] for t in node.targets):
        print(json.dumps(node.value.value))
`, SCRAPER, which], { encoding: 'utf8' });
  if (noPython(t, run)) return null;
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

// A results page as BRIDGE_RESULTS_JS reads one (tests/scraper-mutuals.test.mjs builds the same):
// profile links inside cards, the links in each mutual line, and the page's text in order.
function resultsPage(results) {
  const lines = [];
  const anchors = [];
  const link = (slug, text, card) => ({ getAttribute: () => `/in/${slug}?miniProfileUrn=x`, closest: () => null, querySelector: () => null, innerText: text, parentElement: card });
  for (const r of results) {
    const card = { innerText: [r.name, '• 2nd', r.headline, 'Orlando, FL', ...[r.mutual].flat(), 'Connect'].filter(Boolean).join('\n') };
    card.parentElement = { innerText: card.innerText, parentElement: null };
    anchors.push(link(r.slug, r.name, card));
    for (const v of [r.via].flat().filter(Boolean)) anchors.push(link(v.slug, v.name, card));
    lines.push(...card.innerText.split('\n'));
  }
  const root = { innerText: lines.join('\n'), querySelectorAll: () => anchors };
  return { querySelector: () => root, body: root };
}

// Out of the page's own realm, as plain data.
const run = (js, doc) => JSON.parse(JSON.stringify(vm.runInNewContext(`(${js})()`, { document: doc })));
const bySlug = (rows) => Object.fromEntries(rows.map((r) => [r.profileUrl.split('/in/')[1].replace(/\/$/, ''), r]));

test('every card a circle, your connections or a company search reads carries the mutuals its line names, with their links', (t) => {
  const js = snippet(t, 'BRIDGE_RESULTS_JS');
  if (!js) return;
  const maya = { slug: 'maya-chen', name: 'Maya Chen' };
  const leo = { slug: 'leo-park', name: 'Leo Park' };
  const got = bySlug(run(js, resultsPage([
    { slug: 'ada-stone', name: 'Ada Stone', headline: 'VP Sales at Northwind Labs', mutual: 'Maya Chen, Leo Park & 103 other mutual connections', via: [maya, leo] },
    { slug: 'ben-ortiz', name: 'Ben Ortiz', headline: 'Designer at Halcyon', mutual: ['Maya Chen', 'and 4 other mutual connections'], via: maya },
    { slug: 'cy-moreno', name: 'Cy Moreno', headline: 'Founder at Ironwood', mutual: 'Leo Park is a mutual connection', via: leo },
    { slug: 'di-lang', name: 'Di Lang', headline: 'Engineer at Initech', mutual: '12 mutual connections' },
    { slug: 'ed-voss', name: 'Ed Voss', headline: 'Analyst at Globex', mutual: 'Zed Quinn and 2 other mutual connections' },   // a name with no link
    { slug: 'member-1', name: 'LinkedIn Member', headline: 'Engineer', mutual: 'Maya Chen and 3 other mutual connections', via: maya },
    { slug: 'member-2', name: 'LinkedIn Member', headline: 'Analyst', mutual: 'Leo Park and 8 other mutual connections', via: leo },
  ])));
  const named = (slug) => got[slug].mutualNames?.map((m) => `${m.name} ${m.profileUrl.split('/in/')[1]}`);
  assert.deepEqual(named('ada-stone'), ['Maya Chen maya-chen/', 'Leo Park leo-park/']);
  assert.deepEqual(named('ben-ortiz'), ['Maya Chen maya-chen/'], 'the name drawn on a line of its own, above the rest');
  assert.deepEqual(named('cy-moreno'), ['Leo Park leo-park/']);
  assert.equal(named('di-lang'), undefined, 'a line that names nobody');
  assert.equal(named('ed-voss'), undefined, 'a name the page doesn\'t link is left out: no tie is better than a wrong one');
  assert.equal(named('member-1'), undefined, 'a name two results share has no card of its own here');
  assert.equal(named('maya-chen'), undefined, 'the mutuals themselves name nobody');
  // The counts are read as before.
  assert.deepEqual([got['ada-stone'].mutualCount, got['ben-ortiz'].mutualCount, got['cy-moreno'].mutualCount], [105, 5, 1]);
});

test('the older search reader (the first full scan, the old company scan) reads the names the same way', (t) => {
  const js = snippet(t, 'SEARCH_RESULTS_JS');
  if (!js) return;
  const a = (slug, text) => ({ getAttribute: () => `/in/${slug}`, textContent: text, querySelector: () => null });
  const lines = ['Ada Stone', '• 2nd', 'VP Sales at Northwind Labs', 'Lisbon, Portugal', 'Maya Chen and 23 other mutual connections', 'Connect',
    'Ben Ortiz', '• 2nd', 'Designer at Halcyon', '12 mutual connections', 'Connect'];
  const main = { innerText: lines.join('\n') };
  const doc = {
    querySelector: () => main,
    querySelectorAll: (sel) => (sel === 'img' ? [] : [a('ada-stone', 'Ada Stone'), a('maya-chen', 'Maya Chen'), a('ben-ortiz', 'Ben Ortiz')]),
  };
  const got = bySlug(run(js, doc));
  assert.deepEqual(got['ada-stone'].mutualNames, [{ profileUrl: 'https://www.linkedin.com/in/maya-chen', name: 'Maya Chen' }]);
  assert.equal(got['ada-stone'].headline, 'VP Sales at Northwind Labs');
  assert.equal(got['ben-ortiz'].mutualNames, undefined);
});

// ── What a tie is ────────────────────────────────────────────────────────────

test('a tie is a pair, smaller URL first, each once; a card\'s line is its person seen with each name', () => {
  assert.deepEqual(orderPair(url('zoe'), url('ada')), { a_url: url('ada'), b_url: url('zoe') });
  assert.equal(orderPair(url('ada'), url('ada')), null);
  assert.deepEqual(tiePairs(url('maya'), [url('ada'), url('zoe'), url('ada'), url('maya')]),
    [{ a_url: url('ada'), b_url: url('maya') }, { a_url: url('maya'), b_url: url('zoe') }]);
  assert.equal(tieUrl('https://linkedin.com/in/Ada-Stone?trk=x#y'), 'https://www.linkedin.com/in/Ada-Stone/');
  assert.equal(tieUrl('https://example.com/in/ada'), null);
  assert.equal(urlKey('https://www.linkedin.com/in/Jos%C3%A9-Ruiz/'), 'josé-ruiz');
  assert.equal(mergeSources('circle', 'card'), 'circle,card');
  assert.equal(mergeSources('circle,card', 'card'), 'circle,card');
  assert.equal(mergeSources('', 'nonsense'), '');
  assert.deepEqual([...TIE_SOURCES], ['circle', 'card', 'profile', 'mutual-list']);
  assert.deepEqual(namedMutuals([{ profileUrl: url('ada'), name: 'Ada' }, { profileUrl: url('ada'), name: 'Ada' }, { profileUrl: 'x', name: 'Nobody' }, { profileUrl: url('me'), name: 'Me' }], { self: url('me') }),
    [{ profileUrl: url('ada'), name: 'Ada' }], 'each link once, never the card\'s own person, only profile links');

  const { pairs, cards } = cardTies([
    { profileUrl: url('ada'), mutualNames: [{ profileUrl: url('maya'), name: 'Maya' }, { profileUrl: url('leo'), name: 'Leo' }] },
    { profileUrl: url('ada'), mutualNames: [{ profileUrl: url('maya'), name: 'Maya' }] },   // the same card twice in one read
    { profileUrl: url('ben') },
  ]);
  assert.deepEqual(pairs.map((p) => `${urlKey(p.a_url)}~${urlKey(p.b_url)}`), ['ada~maya', 'ada~leo']);
  assert.equal(cards, 2);
});

test('the mutual line read for its names and its count, as the readers read it', () => {
  assert.deepEqual(mutualLine('Maya Chen, Leo Park & 103 other mutual connections'), { names: ['Maya Chen', 'Leo Park'], count: 105 });
  assert.deepEqual(mutualLine('Maya Chen and Leo Park are mutual connections'), { names: ['Maya Chen', 'Leo Park'], count: 2 });
  assert.deepEqual(mutualLine('Maya Chen is a mutual connection'), { names: ['Maya Chen'], count: 1 });
  assert.deepEqual(mutualLine('12 mutual connections'), { names: [], count: 12 });
  assert.deepEqual(mutualLine('Maya Chen and 1 other mutual connection'), { names: ['Maya Chen'], count: 2 });
  for (const no of ['VP Sales at Northwind Labs', '12 conexiones en común', '', null]) assert.equal(mutualLine(no), null);
});

// ── Storage ──────────────────────────────────────────────────────────────────

test('the ties table keeps where, how often and when; a person can be known only through ties', () => {
  const cols = (t) => getDb().prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  for (const c of ['source', 'seen_count', 'last_seen', 'seen_at']) assert.ok(cols('connection_ties').includes(c), c);
  assert.ok(cols('linkedin_connections').includes('seen_via'));
});

test('a database from before the web gains the columns, its circle ties kept as circle ties seen once', async () => {
  const file = path.join(dir, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE connection_ties (id TEXT, user_id TEXT NOT NULL, a_url TEXT NOT NULL, b_url TEXT NOT NULL,
    seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, a_url, b_url))`);
  old.prepare("INSERT INTO connection_ties (id, user_id, a_url, b_url) VALUES ('t1', 'me', ?, ?)").run(url('ada'), url('maya'));
  const { applySchema } = await import('../lib/db-client.js');
  applySchema(old);
  const row = old.prepare('SELECT source, seen_count, last_seen FROM connection_ties').get();
  assert.deepEqual({ ...row }, { source: 'circle', seen_count: 1, last_seen: null });
  assert.equal(store.allTies(old, 'me')[0].last !== null, true, 'the date it was first seen stands for the last');
  old.close();
});

test('a tie seen again is one row: its count goes up, its date moves on, and each way it was seen is kept', () => {
  const db = getDb();
  const first = store.recordTies(db, { userId: 'me', pairs: [orderPair(url('ada'), url('maya'))], source: 'card', at: '2026-10-14T12:00:00.000Z' });
  assert.deepEqual(first, { added: 1, again: 0 });
  const again = store.recordTies(db, {
    userId: 'me', pairs: [{ a_url: url('maya'), b_url: url('ada') }, orderPair(url('ada'), url('maya'))], source: 'profile', at: '2026-10-16T12:00:00.000Z',
  });
  assert.deepEqual(again, { added: 0, again: 1 }, 'the same pair, either way round, once a sighting');
  store.recordTies(db, { userId: 'me', pairs: [orderPair(url('ada'), url('maya'))], source: 'card', at: '2026-10-16T13:00:00.000Z' });
  const [t] = store.allTies(db, 'me');
  assert.deepEqual([t.n, t.first, t.last, t.sources], [3, '2026-10-14T12:00:00.000Z', '2026-10-16T13:00:00.000Z', ['card', 'profile']]);
  assert.deepEqual(store.recordTies(db, { userId: 'me', pairs: [orderPair(url('a'), url('b'))], source: 'gossip' }), { added: 0, again: 0 }, 'only the four sources');
  // Packed for the page and read back.
  assert.deepEqual(unpackTies(store.packTies(store.allTies(db, 'me'))).map((x) => [urlKey(x.a), urlKey(x.b), x.n]), [['ada', 'maya', 3]]);
});

// ── Ingest: a scan's cards become ties ───────────────────────────────────────

test('a circle scan\'s cards are kept as ties to the mutuals they name, and only the people the page listed are the circle\'s', async () => {
  await yours('maya-chen', 'leo-park', 'bea-kim', 'xan-ray');
  const bridgeId = idOf('xan-ray');
  const card = (slug, mutualNames, extra = {}) => ({ name: name(slug), headline: 'VP at Globex', profileUrl: url(slug), mutualNames, ...extra });
  const got = await ingest({
    type: 'degree2', bridgeId, connections: [
      card('ada-stone', [{ profileUrl: url('maya-chen'), name: 'Maya Chen' }, { profileUrl: url('leo-park'), name: 'Leo Park' }], { mutualCount: 105 }),
      card('bea-kim', [{ profileUrl: url('leo-park'), name: 'Leo Park' }], { mutualCount: 7 }),   // one of yours, listed in Xan's circle
      { name: 'Maya Chen', headline: '', profileUrl: url('maya-chen') },                          // only a name in a mutual line
      { name: 'Leo Park', headline: '', profileUrl: url('leo-park') },
    ],
  });
  assert.equal(got.ties, 3);
  assert.deepEqual(tiesRows(), [
    'ada-stone~leo-park card 1',
    'ada-stone~maya-chen card 1',
    'bea-kim~leo-park card 1',
    'bea-kim~xan-ray circle 1',
  ], 'Bea is a card of Xan\'s list: a circle tie; Maya and Leo were only names in lines, so not Xan\'s');
  assert.equal(store.webSize(getDb(), 'me').cards, 2);
  // Read again: each seen once more.
  await ingest({ type: 'degree2', bridgeId, connections: [card('ada-stone', [{ profileUrl: url('maya-chen'), name: 'Maya Chen' }], { mutualCount: 105 })] });
  assert.ok(tiesRows().includes('ada-stone~maya-chen card 2'));
});

test('your connections\' search and a company search keep their cards\' ties too; a scan with no names keeps none', async () => {
  await yours('maya-chen', 'leo-park');
  await ingest({ type: 'degree1', connections: [{ name: 'Leo Park', headline: 'Engineer', profileUrl: url('leo-park'), mutualNames: [{ profileUrl: url('maya-chen'), name: 'Maya Chen' }] }] });
  await ingest({ type: 'company', companyName: 'Northwind Labs', connections: [{ name: 'Di Lang', headline: 'CTO at Northwind Labs', profileUrl: url('di-lang'), mutualNames: [{ profileUrl: url('maya-chen'), name: 'Maya Chen' }] }] });
  await ingest({ type: 'company', companyName: 'Northwind Labs', connections: [{ name: 'Ed Voss', headline: 'VP at Northwind Labs', profileUrl: url('ed-voss') }] });
  assert.deepEqual(tiesRows(), ['di-lang~maya-chen card 1', 'leo-park~maya-chen card 1']);
});

test('which of your connections in a circle\'s batch make circle ties: the listed ones, or all with an older scanner', () => {
  const connected = [url('bea'), url('maya')];
  assert.deepEqual(circleTieUrls([{ profileUrl: url('bea') }, { profileUrl: url('maya') }], connected), connected, 'no names sent: as before');
  assert.deepEqual(circleTieUrls([
    { profileUrl: url('ada'), mutualNames: [{ profileUrl: url('maya'), name: 'Maya' }, { profileUrl: url('bea'), name: 'Bea' }] },
    { profileUrl: url('bea'), mutualCount: 4 },
    { profileUrl: url('maya') },
  ], connected), [url('bea')]);
});

// ── The extended network: past the 1,000 ─────────────────────────────────────

const row = (id, slug, extra = {}) => ({ id, name: name(slug), profile_url: url(slug), tier: 'B', power_score: 5, ...extra });
const tie = (a, b, n = 1, last = '2026-10-16T12:00:00.000Z', sources = ['card']) => ({ a: url(a), b: url(b), n, last, sources });

test('someone seen with one of your connections is reachable through them, outside what a scan of their circle read', () => {
  const degree1 = [row('m', 'maya-chen', { degree: 1, tier: 'S' }), row('x', 'xan-ray', { degree: 1 }), row('l', 'leo-park', { degree: 1 })];
  const degree2 = [
    row('a@x', 'ada-stone', { degree: 2, source_connection_id: 'x' }),   // in Xan's scanned circle
    row('b@m', 'bo-lind', { degree: 2, source_connection_id: 'm' }),     // in Maya's scanned circle
  ];
  const degree3 = [row('d', 'di-lang', { degree: 3, scanned_company: 'Northwind Labs' })];
  const tiePeople = [row('z', 'zed-quinn', { degree: 2, seen_via: 'ties', tier: 'D', power_score: 0 })];
  const ties = [
    tie('ada-stone', 'maya-chen', 3),   // Maya's circle stopped at 1,000 before Ada: seen outside the scan
    tie('bo-lind', 'maya-chen'),        // in Maya's scan already: nothing new
    tie('di-lang', 'leo-park', 2),      // a company scan's find, now 2nd degree through Leo
    tie('zed-quinn', 'maya-chen'),      // known only through ties (a profile in the panel)
    tie('maya-chen', 'leo-park'),       // two of yours: attaches nobody
    tie('ada-stone', 'di-lang'),        // two people you don't know: attaches nobody
  ];
  const seen = extendedNetwork({ degree1, degree2, degree3, tiePeople, ties });
  assert.deepEqual(seen.map((s) => `${s.name} via ${s.source_connection_id}`), ['Ada Stone via m', 'Di Lang via l', 'Zed Quinn via m']);
  const ada = seen[0];
  assert.deepEqual([ada.id, ada.person_id, ada.degree, ada.seen_outside, ada.seen_with.n], ['seen:m:a@x', 'a@x', 2, true, 3]);
  // On the map: the company's find is 2nd degree now, each person once at the nearest degree.
  const by = peopleByDegree(degree1, [...degree2, ...seen], degree3);
  assert.deepEqual(by[2].map((r) => r.name).sort(), ['Ada Stone', 'Bo Lind', 'Di Lang', 'Zed Quinn']);
  assert.equal(by[3].length, 0);
  // Separation: a way in through Maya marked as the web's, and a scan's own row kept in front.
  const model = separationPeople([...degree2, ...seen, ...degree3], degree1);
  const at = (n) => model.people.find((p) => p.person.name === n);
  assert.deepEqual(at('Ada Stone').routes.map((r) => [r.id, Boolean(r.seen)]).sort(), [['m', true], ['x', false]]);
  assert.equal(at('Ada Stone').person.id, 'a@x');
  assert.equal(at('Ada Stone').outside, undefined, 'a scan found her too');
  assert.equal(at('Zed Quinn').outside, true, 'known only through the web');
  // The focus: Maya's circle with Ada lighter, and a circle of only those still to scan.
  const index = circleIndex(degree1, [...degree2, ...seen]);
  const maya = focusSubgraph(degree1[0], index);
  assert.deepEqual([maya.circle, maya.outside, maya.unscanned], [3, 2, false]);
  const leo = focusSubgraph(degree1[2], index);
  assert.deepEqual([leo.kind, leo.outside, leo.unscanned], ['circle', 1, true]);
});

test('the network route keeps people known only through ties out of the scanned 2nd degree, and attaches them by their ties', async () => {
  await yours('maya-chen', 'leo-park');
  await ingest({ type: 'company', companyName: 'Northwind Labs', connections: [{ name: 'Di Lang', headline: 'CTO at Northwind Labs', profileUrl: url('di-lang'), mutualNames: [{ profileUrl: url('leo-park'), name: 'Leo Park' }] }] });
  const db = getDb();
  store.keepTiePeople(db, 'me', [{ profileUrl: url('zed-quinn'), name: 'Zed Quinn' }]);
  store.recordTies(db, { userId: 'me', pairs: [orderPair(url('zed-quinn'), url('maya-chen')), orderPair(url('maya-chen'), url('leo-park'))], source: 'profile' });
  const net = await (await networkRoute(new Request('http://127.0.0.1/api/network?userId=me'))).json();
  assert.equal(net.degree2.length, 0, 'never counted as scanned');
  assert.deepEqual(net.seen.map((s) => `${s.name}→${net.degree1.find((d) => d.id === s.source_connection_id).name}`).sort(), ['Di Lang→Leo Park', 'Zed Quinn→Maya Chen']);
  assert.equal(net.ties, 1, 'network health counts the ties between two of your connections');
  const { networkCounts } = await import('../lib/profile.js');
  assert.deepEqual(networkCounts('me'), { first: 2, second: 0, third: 1 });
});

test('someone known only through ties whom a scan reads later becomes the scan\'s, request and all', async () => {
  await yours('maya-chen');
  const db = getDb();
  store.keepTiePeople(db, 'me', [{ profileUrl: url('zed-quinn'), name: 'Zed Quinn' }]);
  db.prepare("UPDATE linkedin_connections SET outreach_status = 'sent' WHERE profile_url = ?").run(url('zed-quinn'));
  const got = await ingest({ type: 'degree2', bridgeId: idOf('maya-chen'), connections: [{ name: 'Zed Quinn', headline: 'COO at Globex', profileUrl: url('zed-quinn') }] });
  assert.equal(got.adopted, 1);
  const rows = db.prepare('SELECT degree, source_connection_id AS via, seen_via, headline, outreach_status AS sent FROM linkedin_connections WHERE profile_url = ?').all(url('zed-quinn'));
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ degree: 2, via: idOf('maya-chen'), seen_via: null, headline: 'COO at Globex', sent: 'sent' }]);
});

// ── Known through ────────────────────────────────────────────────────────────

test('"Known through": your connections they were seen with, most seen first, with how often and when', () => {
  const degree1 = [row('m', 'maya-chen', { degree: 1 }), row('l', 'leo-park', { degree: 1 }), row('b', 'bea-kim', { degree: 1 }), row('c', 'cal-ito', { degree: 1 })];
  const index = tieIndex([
    tie('ada-stone', 'maya-chen', 2, '2026-10-14T15:00:00.000Z', ['card']),
    tie('ada-stone', 'leo-park', 1, '2026-10-16T15:00:00.000Z', ['profile']),
    tie('ada-stone', 'zed-quinn', 9),   // not yours: says nothing about how you'd reach her
  ]);
  const mine = firstDegreeByKey(degree1);
  const d1ById = new Map(degree1.map((r) => [r.id, r]));
  const circles = [row('a@b', 'ada-stone', { degree: 2, source_connection_id: 'b', created_at: '2026-10-01T15:00:00.000Z' })];
  const via = knownThrough(url('ada-stone'), { index, mine, circles, d1ById });
  assert.deepEqual(via.map((v) => [v.name, v.n, v.sources.join(',')]), [['Maya Chen', 2, 'card'], ['Leo Park', 1, 'profile'], ['Bea Kim', 1, 'circle']]);
  const on = seenOn('2026-10-16T15:00:00.000Z');
  assert.match(on, /^Oct 1[67], 2026$/, 'on this computer\'s calendar');
  assert.equal(knownThroughText(via), `Known through: Maya Chen, Leo Park, Bea Kim (seen together 4 times, last on ${on})`);
  assert.equal(knownThroughText(via.slice(0, 1)), `Known through: Maya Chen (seen together twice, last on ${seenOn('2026-10-14T15:00:00.000Z')})`);
  assert.equal(knownThroughText([...via, { name: 'Cal Ito', n: 1, last: null }], { names: 2 }),
    `Known through: Maya Chen, Leo Park and 2 more (seen together 5 times, last on ${on})`);
  assert.equal(knownThroughText([]), '');
  assert.ok(!/close/i.test(knownThroughText(via)), 'seen together, never close');
});

test('Show ties draws the selection\'s lines only, between people on screen, most seen first', () => {
  const index = tieIndex([tie('ada', 'maya', 3), tie('ada', 'leo'), tie('ada', 'off-map'), tie('leo', 'maya', 2)]);
  const onScreen = new Map([['ada', 'A'], ['maya', 'M'], ['leo', 'L']]);
  assert.deepEqual(tieLines({ index, onScreen, selected: 'ada' }), [{ a: 'A', b: 'M', n: 3 }, { a: 'A', b: 'L', n: 1 }]);
  assert.deepEqual(tieLines({ index, onScreen, among: ['maya', 'leo'] }), [{ a: 'M', b: 'L', n: 2 }]);
  assert.deepEqual(tieLines({ index, onScreen }), [], 'nothing selected: no lines, never the whole web');
  assert.equal(tieLines({ index, onScreen, selected: 'ada', max: 1 }).length, 1);
});

// ── Breach: warm doors ───────────────────────────────────────────────────────

test('a door the web saw with one of your connections is warm, and says who to ask', () => {
  const network = {
    degree1: [row('m', 'maya-chen', { degree: 1 }), row('l', 'leo-park', { degree: 1 })],
    degree2: [],
    degree3: [
      row('d', 'di-lang', { degree: 3, headline: 'Engineer at Northwind Labs', scanned_company: 'Northwind Labs' }),
      row('e', 'ed-voss', { degree: 3, headline: 'Engineer at Northwind Labs', scanned_company: 'Northwind Labs' }),
    ],
  };
  const index = tieIndex([tie('di-lang', 'maya-chen', 2), tie('di-lang', 'leo-park')]);
  const mine = firstDegreeByKey(network.degree1);
  const knownVia = (r, rows) => knownThrough(r.profile_url, { index, mine, circles: rows });
  const people = breachPeople(network, 'Northwind Labs', { knownVia });
  const di = people.find((p) => p.name === 'Di Lang');
  const ed = people.find((p) => p.name === 'Ed Voss');
  assert.deepEqual(di.askVia.map((v) => v.name), ['Maya Chen', 'Leo Park']);
  assert.equal(warmDoor(di), 'Ask Maya Chen or Leo Park');
  assert.ok(di.why.slice(0, 3).includes('Ask Maya Chen or Leo Park'), 'among the chips a door shows');
  assert.equal(di.mutuals, 2, 'a named mutual is a mutual');
  assert.ok(di.odds > ed.odds, 'warm doors come first');
  assert.equal(warmDoor(ed), null);
  assert.equal(warmDoor({ askVia: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), 'Ask A +2');
  // A summit seat lifted a band by its named mutual, as by a count.
  const vp = { seat: { level: 5, label: 'VP / partner' }, headline: 'VP at Northwind Labs', mutuals: 1, askVia: [{ name: 'Maya Chen' }] };
  assert.equal(bandOf(vp).band, 'climb');
  // Without the web, as before.
  assert.equal(breachPeople(network, 'Northwind Labs').find((p) => p.name === 'Di Lang').askVia.length, 0);
});

// ── The panel: a profile's mutual line, read where it is ─────────────────────

/** A stand-in profile page for the watcher: a document a MutationObserver watches, its top card, and a console. */
function profilePage(pathname, { line = 'Maya Chen, Leo Park and 103 other mutual connections', links = [], degree = '· 2nd', aside = null } = {}) {
  const logged = [];
  let observer = null;
  let timer = null;
  const el = (text, kids = [], extra = {}) => ({
    nodeType: 1, textContent: text, closest: (sel) => (sel === 'aside' ? extra.aside || null : null), querySelectorAll: (sel) => (sel === 'a' ? kids.filter((k) => k.href) : kids), ...extra,
  });
  const anchors = links.map((l) => el(l.name, [], { href: `https://www.linkedin.com/in/${l.slug}/` }));
  const lineEl = line ? el(line, anchors) : null;
  const h1 = el('Ada Stone');
  const section = el(['Ada Stone', 'VP Sales at Northwind Labs', degree, line].filter(Boolean).join(' '),
    [h1, el('VP Sales at Northwind Labs'), el(degree), ...(lineEl ? [lineEl, ...anchors] : []), ...(aside ? [el(aside, [], { aside: {} })] : [])]);
  h1.closest = (sel) => (sel === 'section' ? section : null);
  const main = { querySelector: (sel) => (sel === 'h1' ? h1 : null) };
  const ctx = {
    window: {},
    document: { querySelector: (sel) => (sel === 'main' ? main : null), body: main },
    location: { pathname, href: `https://www.linkedin.com${pathname}` },
    console: { log: (l) => logged.push(l) },
    setTimeout: (fn) => { timer = fn; return 1; },
    clearTimeout: () => { timer = null; },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
  };
  vm.runInNewContext(MUTUAL_WATCH_JS, ctx);
  const settle = () => { const fn = timer; timer = null; fn?.(); };
  return { ctx, logged, settle, change: () => { observer([]); settle(); } };
}

test('the panel\'s watcher reads a profile\'s mutual line once, with its links and degree, and nothing elsewhere', () => {
  const page = profilePage('/in/ada-stone/', { links: [{ slug: 'maya-chen', name: 'Maya Chen' }] });
  page.settle();
  assert.equal(page.logged.length, 1);
  assert.ok(page.logged[0].startsWith(MUTUALS_MARK));
  assert.deepEqual(JSON.parse(page.logged[0].slice(MUTUALS_MARK.length)), {
    href: 'https://www.linkedin.com/in/ada-stone/', name: 'Ada Stone', degree: '2nd',
    line: 'Maya Chen, Leo Park and 103 other mutual connections',
    links: [{ href: 'https://www.linkedin.com/in/maya-chen/', name: 'Maya Chen' }],
  });
  page.change();
  assert.equal(page.logged.length, 1, 'once a profile');
  vm.runInNewContext(MUTUAL_WATCH_JS, page.ctx);
  assert.equal(page.logged.length, 1, 'one watcher a page');

  const details = profilePage('/in/ada-stone/details/experience/');
  details.settle();
  const feed = profilePage('/feed/');
  feed.settle();
  const none = profilePage('/in/zed-quinn/', { line: null });
  none.settle();
  assert.deepEqual([details.logged.length, feed.logged.length, none.logged.length], [0, 0, 0], 'only a profile itself, with a line');
  assert.equal(INVITE_WATCH_WORLD, 1916, 'in the invitation watcher\'s world of its own: LinkedIn\'s page never sees it');
});

test('what the shell sends: only the watcher\'s line, on the profile still showing, once a profile a day', () => {
  const line = (report) => MUTUALS_MARK + JSON.stringify({ href: url('ada-stone'), name: 'Ada Stone', degree: '2nd', line: 'Maya Chen and 4 other mutual connections', links: [{ href: url('maya-chen'), name: 'Maya Chen' }], ...report });
  const seen = new Map();
  const got = mutualsSeenFor(line(), { url: url('ada-stone'), seen, today: '2026-10-16' });
  assert.deepEqual(got, {
    slug: 'ada-stone',
    body: { source: 'profile', person: { profileUrl: url('ada-stone'), name: 'Ada Stone', degree: '2nd' }, line: 'Maya Chen and 4 other mutual connections', mutuals: [{ profileUrl: url('maya-chen'), name: 'Maya Chen' }] },
  });
  assert.equal(mutualsSeenFor(line(), { url: url('ben-ortiz'), seen, today: '2026-10-16' }), null, 'the panel moved on');
  assert.equal(mutualsSeenFor(line({ line: 'VP Sales' }), { url: url('ada-stone'), seen, today: '2026-10-16' }), null);
  assert.equal(mutualsSeenFor('[sixgree:invite-sent]{}', { url: url('ada-stone'), seen }), null);
  seen.set('ada-stone', '2026-10-16');
  assert.equal(mutualsSeenFor(line(), { url: url('ada-stone'), seen, today: '2026-10-16' }), null, 'once a day');
  assert.ok(mutualsSeenFor(line(), { url: url('ada-stone'), seen, today: '2026-10-17' }));
  const main = src('desktop/main.mjs');
  assert.match(main, /executeJavaScriptInIsolatedWorld\(INVITE_WATCH_WORLD, \[\{ code: MUTUAL_WATCH_JS \}\]\)/);
  assert.match(main, /fetch\(`\$\{origin\}\/api\/ties`/);
});

test('the app keeps a profile\'s line as ties: names matched to your connections, a stranger kept with what\'s known', async () => {
  await yours('maya-chen', 'leo-park');
  await ingest({ type: 'degree1', connections: [{ name: 'Sam Lee', headline: 'A', profileUrl: url('sam-lee-1') }, { name: 'Sam Lee', headline: 'B', profileUrl: url('sam-lee-2') }] });
  const post = async (body) => (await tiesRoute.POST(new Request('http://127.0.0.1/api/ties', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))).json();
  const got = await post({
    source: 'profile', person: { profileUrl: url('ada-stone'), name: 'Ada Stone', degree: '2nd' },
    line: 'Maya Chen, Sam Lee and 103 other mutual connections', mutuals: [{ profileUrl: url('leo-park'), name: 'Leo Park' }],
  });
  assert.deepEqual(got, { ok: true, added: 2, again: 0, people: 1 });
  assert.deepEqual(tiesRows(), ['ada-stone~leo-park profile 1', 'ada-stone~maya-chen profile 1'], 'two Sam Lees: neither is taken');
  const ada = getDb().prepare('SELECT degree, seen_via, name, mutual_count, source_connection_id AS via FROM linkedin_connections WHERE profile_url = ?').get(url('ada-stone'));
  assert.deepEqual({ ...ada }, { degree: 2, seen_via: 'ties', name: 'Ada Stone', mutual_count: 105, via: null });
  // Your own connection's profile is never kept as a stranger.
  await post({ source: 'profile', person: { profileUrl: url('new-friend'), name: 'New Friend', degree: '1st' }, line: 'Maya Chen is a mutual connection' });
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM linkedin_connections WHERE profile_url = ?').get(url('new-friend')).n, 0);
  // The read side.
  const one = await (await tiesRoute.GET(new Request(`http://127.0.0.1/api/ties?url=${encodeURIComponent(url('ada-stone'))}`))).json();
  assert.deepEqual(one.ties.map((t) => [t.name, t.degree, t.n, t.sources]).sort(), [['Leo Park', 1, 1, ['profile']], ['Maya Chen', 1, 1, ['profile']]]);
  const size = await (await tiesRoute.GET(new Request('http://127.0.0.1/api/ties?summary=1'))).json();
  assert.deepEqual([size.ties, size.profiles, size.people], [3, 2, 1], 'the 1st-degree profile\'s tie counts, its person isn\'t kept');
  const all = unpackTies(await (await tiesRoute.GET(new Request('http://127.0.0.1/api/ties'))).json());
  assert.equal(all.length, 3);
  // Refusals.
  assert.match((await post({ source: 'gossip', person: { profileUrl: url('ada-stone') } })).error, /profile or a mutual list/);
  assert.match((await post({ source: 'profile', person: { profileUrl: 'https://example.com/ada' } })).error, /LinkedIn profile link/);
});

test('Settings → Your data says the web\'s size as what was seen, never as the whole', () => {
  assert.equal(webLine({ ties: 1240, cards: 3100, profiles: 12, lists: 2, people: 0, bySource: { circle: 0 } }),
    '1,240 ties from 3,100 cards, 12 profiles and 2 full lists. Seen together, not close.');
  assert.equal(webLine({ ties: 1, cards: 0, profiles: 0, lists: 0, people: 1, bySource: { circle: 1 } }),
    '1 tie from circle scans; 1 person known only through them. Seen together, not close.');
  assert.match(webLine({ ties: 0 }), /^No ties yet/);
  assert.match(src('app/components/settings/DataSection.js'), /<Fact label="Mutual web">\{webLine\(info\.web\)\}<\/Fact>/);
  assert.match(src('app/api/data/route.js'), /web: webSize\(db, /);
});

// ── The paid step: Read all mutuals ──────────────────────────────────────────

function scanner(t, script) {
  if (noScanner(t)) return null;
  const home = mkdtempSync(path.join(tmpdir(), 'sixgree-web-scan-'));
  try {
    const r = spawnSync(PYTHON, [HARNESS, SCRAPER, script], { encoding: 'utf8', env: { ...process.env, SIX_DEGREES_HOME: home } });
    if (noPython(t, r)) return null;
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    return { out: JSON.parse(lines.pop().replace(/^RESULT /, '')), log: lines.join('\n') };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('Read all mutuals is a round of their list filtered to your connections, read like a circle, sent as ties', (t) => {
  const r = scanner(t, `
install_browser(types.SimpleNamespace(set_default_timeout=lambda ms: None, set_default_navigation_timeout=lambda ms: None))
calls = []
def one(page, name, person_id, profile_url, **kw):
    calls.append({'name': name, 'id': person_id, 'url': profile_url, 'start': kw.get('start_page'), 'max': kw.get('max_pages'),
                  'urn': kw.get('urn'), 'mutuals': kw.get('mutuals'), 'key': kw.get('list_key'), 'manual': kw.get('manual'), 'company': kw.get('company')})
    return ([{'name': 'Invented Maya', 'headline': 'Engineer', 'profileUrl': 'https://www.linkedin.com/in/invented-maya/'}],
            'success', {'last': kw.get('max_pages'), 'more': True, 'urn': 'ACoAAInvented', 'found': 1, 'limited': False})
ns['_scrape_one_bridge'] = one
ns['read_cooldown'] = lambda now=None: None
ns['manual_reads'] = lambda: False
target = 'https://www.linkedin.com/in/invented-vp/'
ns['read_connections'] = lambda endpoint='', params=None: [{'id': 'vp-row', 'name': 'Invented Vp', 'profile_url': target}]
ns['record_bridge_progress'](target, 'Invented Vp', 12, True, 'ACoAACircle')
ns['scan_mutual_list'](target, pages=5)
ns['scan_mutual_list'](target, pages=50)
out['calls'] = calls
out['note'] = ns['load_bridge_progress']().get(ns['mutuals_key'](target))
out['circle'] = ns['load_bridge_progress']().get(target)['pages']
out['posted'] = [p['json'] for p in posted if p['url'].endswith('/api/ties')]
out['ingest'] = [p for p in posted if p['url'].endswith('/api/ingest')]
out['url'] = ns['mutual_search_url']('ACoAAInvented')`);
  if (!r) return;
  assert.deepEqual(r.out.calls.map((c) => [c.start, c.max, c.urn]), [[1, 5, 'ACoAACircle'], [6, 15, 'ACoAAInvented']],
    'a round from where the last stopped, 10 pages at most, their search id from their circle\'s read, then the list\'s own: no profile view');
  for (const c of r.out.calls) {
    assert.equal(c.mutuals, true);
    assert.equal(c.key, 'mutuals:https://www.linkedin.com/in/invented-vp/');
    assert.equal(c.company, null, 'not a company search');
  }
  assert.equal(r.out.circle, 12, 'their circle\'s note is left as it was');
  assert.deepEqual([r.out.note.pages, r.out.note.more], [15, true]);
  assert.equal(r.out.ingest.length, 0, 'never sent as people');
  assert.deepEqual(r.out.posted[0], {
    source: 'mutual-list', person: { profileUrl: 'https://www.linkedin.com/in/invented-vp/', name: 'Invented Vp' },
    mutuals: [{ profileUrl: 'https://www.linkedin.com/in/invented-maya/', name: 'Invented Maya' }], list: true, userId: null,
  });
  assert.equal(r.out.posted[1].list, false, 'a list is counted once, at its first round');
  assert.equal(r.out.url, 'https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&connectionOf=%5B%22ACoAAInvented%22%5D');
  assert.match(r.log, /Read all mutuals: reading the mutual connections you share with Invented Vp, pages 1 to 5/);
  assert.match(r.log, /each a search counted in the scan window/);
});

test('the reader drops the names in each card\'s line from a full mutual list: they know you, not them', (t) => {
  const r = scanner(t, `
ns['GENTLE']['on'] = False
ns['interruptible_sleep'] = lambda s, on_tick=None, step=5: True
page = ResultsPage(pages=1)
real = page.people
page.people = lambda: real() + [dict(person(9000), mutualOnly=True)]
ns['_read_results_page'] = lambda p: p.evaluate(ns['BRIDGE_RESULTS_JS'])
people, status, reach = ns['_scrape_one_bridge'](page, 'Invented Vp', 'vp', 'https://www.linkedin.com/in/invented-vp/', max_pages=1,
                                                urn='ACoAAInvented', mutuals=True, list_key='mutuals:x')
out.update({'people': len(people), 'status': status, 'found': reach['found'], 'note': 'mutuals:x' in ns['_PAGES_READ']})`);
  if (!r) return;
  assert.deepEqual([r.out.people, r.out.found, r.out.note], [10, 10, true]);
  assert.match(r.log, /Opening the mutual connections you share with Invented Vp\.\.\./);
});

test('the app runs it as its own action by id, any degree, with either plugin, in rounds of 3, 5 or 10, only when pressed', () => {
  const route = src('app/api/scraper/route.js');
  assert.match(route, /mutuals: +\{ flag: '--mutuals', +needsId: true, label: '[^']+', searches: true \}/);
  assert.match(route, /const readsLists = [^\n]*'mutuals'/);
  assert.match(route, /profileUrl && action === 'mutuals' \? \[`--mutuals=\$\{profileUrl\}`, `--round=\$\{mutualRound\(body\.pages\)\}`\]/);
  assert.match(route, /action === 'mutuals'\s+\? 'SELECT name, profile_url FROM linkedin_connections WHERE id = \? AND user_id = \?'/);
  assert.match(route, /mutuals: me \? mutualNotes\(readProgress\(dataDir\(\), me\.id\)\) : \{\}/);
  assert.deepEqual([...MUTUAL_ROUNDS], [3, 5, 10]);
  assert.deepEqual([3, 5, 10, 50, undefined, '5'].map(mutualRound), [3, 5, 10, 5, 5, 5]);
  assert.ok(!AUTO_ACTIONS.includes('mutuals'));
  assert.equal(capabilityRefusal({ auto: false, manual: true }, 'mutuals'), null, 'by hand runs it too');
  assert.equal(PLUGIN_SINCE.mutuals, '1.0.11');
  assert.ok(compareVersions(SHIPPED_PLUGIN_VERSION, '1.0.11') >= 0);
  const plugin = (version) => ({ from: 'plugin', plugin: { name: 'Manual scan', version } });
  assert.match(pluginTooOld(plugin('1.0.10'), 'mutuals'), /version 1\.0\.11 or newer of the Manual scan plugin/);
  assert.equal(pluginTooOld(plugin('1.0.11'), 'mutuals'), null);
  assert.equal(busyReason({ running: true, action: 'mutuals', target: { name: 'Invented Vp' } }), 'The mutual connections you share with Invented Vp are being read');
  assert.equal(scanDoneNotification({ action: 'mutuals', target: { name: 'Invented Vp' }, exitCode: 0 }).title, 'Read all mutuals: a round done for Invented Vp');
  // Offered only where it matters, never started by anything but a press.
  assert.equal(offersMutualList({ profile_url: url('a'), degree: 1, tier: 'S' }), true);
  assert.equal(offersMutualList({ profile_url: url('a'), degree: 1, tier: 'B' }), false);
  assert.equal(offersMutualList({ profile_url: url('a'), degree: 3, tier: 'C' }, { summit: true }), true);
  assert.equal(offersMutualList({ profile_url: url('a'), degree: 2, seen_via: 'ties' }, { summit: true }), false);
  // Read all mutuals again asks for page 1 (--again, 2026-10-17); nothing starts a finished list by itself.
  assert.match(src('app/components/ReadAllMutuals.js'), /startHere\('mutuals', \{ id, name: person\.name, pages, \.\.\.\(how === 'every page read' \? \{ again: true \} : \{\}\) \}\)/);
  for (const file of ['lib/auto-scan.js', 'lib/scan-queue.js']) assert.ok(!/'mutuals'/.test(src(file)), `${file} never starts it`);
  // How far an earlier read got.
  const notes = mutualNotes({ [`mutuals:${url('a')}`]: { pages: 5, more: true }, [url('a')]: { pages: 9 }, 'breach:x:23': { pages: 2 } });
  assert.deepEqual(notes, { [url('a')]: { pages: 5, more: true, total: null, at: null } });
  assert.equal(mutualListNote(notes[url('a')]), 'carries on from page 6');
  assert.equal(mutualListNote({ pages: 4, more: false }), 'every page read');
  assert.equal(mutualListNote(null), '');
});

test('the scanner takes --mutuals and --round, and the readers\' names travel with each card it sends', (t) => {
  const r = scanner(t, `
ns['localize_images'] = lambda images: images
out['help'] = 'Read all mutuals' in open(ns['__file__']).read()
out['round'] = (ns['MUTUALS_ROUND'], ns['MUTUALS_ROUND_MAX'])
ns['push_company']([{'name': 'Invented Di', 'headline': 'CTO', 'profileUrl': 'https://www.linkedin.com/in/invented-di/',
                    'mutualNames': [{'profileUrl': 'https://www.linkedin.com/in/invented-maya/', 'name': 'Invented Maya'}]}], 'Northwind Labs')
out['company'] = [p['json'] for p in posted if p['url'].endswith('/api/ingest')][0]['connections'][0]`);
  if (!r) return;
  assert.equal(r.out.help, true);
  assert.deepEqual(r.out.round, [5, 10]);
  assert.deepEqual(r.out.company.mutualNames, [{ profileUrl: 'https://www.linkedin.com/in/invented-maya/', name: 'Invented Maya' }]);
  assert.match(src('scripts/scrape.py'), /parser\.add_argument\("--mutuals", type=str,/);
  assert.match(src('scripts/scrape.py'), /elif args\.mutuals:\n\s+scan_mutual_list\(args\.mutuals, pages=MUTUALS_ROUND if args\.round is None else args\.round,/);
});
