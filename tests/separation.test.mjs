// The Separation view ranks everyone you can reach in two steps, and shows every
// way in. Its data comes from lib/separation.js; these pin what it promises.
// Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  separationPeople, routeIndex, routesFor, summitLayout, score1, keyFor, MIN_BRIDGE_GAP,
} from '../lib/separation.js';

const bridge = (id, tier, power_score = 5) => ({ id, name: `Bridge ${id}`, tier, power_score, degree: 1 });
const row = (id, url, via, tier = 'B', power_score = 5, extra = {}) =>
  ({ id, degree: 2, name: `Person ${url}`, profile_url: url, source_connection_id: via, tier, power_score, ...extra });
const people = (rows, bridges) => separationPeople(rows, bridges).people;

test('someone three of your connections know is one person with three routes', () => {
  const bridges = [bridge('a', 'B'), bridge('b', 'S'), bridge('c', 'A')];
  const rows = [row('1', '/in/x', 'a'), row('2', '/in/x', 'b'), row('3', '/in/x', 'c')];
  const list = people(rows, bridges);
  assert.equal(list.length, 1);
  assert.equal(list[0].waysIn, 3);
  assert.deepEqual(list[0].routes.map((r) => r.id), ['b', 'c', 'a'], 'top-scored bridge first');
});

test('the most powerful person comes first', () => {
  const bridges = [bridge('a', 'B')];
  const rows = [row('1', '/in/low', 'a', 'C', 2.1), row('2', '/in/high', 'a', 'S', 8.4), row('3', '/in/mid', 'a', 'A', 6)];
  assert.deepEqual(people(rows, bridges).map((p) => p.key), ['/in/high', '/in/mid', '/in/low']);
});

test('scores saved as text rank as numbers', () => {
  const rows = [row('1', '/in/nine', 'a', 'A', '9.5'), row('2', '/in/ten', 'a', 'S', '10.2')];
  assert.deepEqual(people(rows, [bridge('a', 'B')]).map((p) => p.key), ['/in/ten', '/in/nine']);
});

test('"LinkedIn Member" people stay separate: each has their own URL', () => {
  const rows = [
    row('1', '/in/ACoAA1', 'a', 'D', 1, { name: 'LinkedIn Member' }),
    row('2', '/in/ACoAA2', 'a', 'D', 1, { name: 'LinkedIn Member' }),
  ];
  assert.equal(people(rows, [bridge('a', 'B')]).length, 2);
});

test('a route whose bridge cannot be found is kept, counted, unnamed and last', () => {
  // The view-side half of the re-linked bridge ids: a person must never vanish
  // because the connection who led to them can't be found.
  const rows = [row('1', '/in/x', 'gone'), row('2', '/in/x', 'a'), row('3', '/in/y', 'gone', 'A', 6)];
  const { people: list, summary } = separationPeople(rows, [bridge('a', 'B')]);
  assert.deepEqual(list.map((p) => p.key), ['/in/y', '/in/x'], 'nobody is left out');
  const x = list.find((p) => p.key === '/in/x');
  assert.equal(x.waysIn, 2);
  assert.deepEqual(x.routes.map((r) => [r.id, r.bridge?.id ?? null]), [['a', 'a'], ['gone', null]]);
  assert.equal(summary.peopleOnlyUnresolved, 1);
  assert.equal(summary.onlyUnresolvedVia, 1);
  assert.equal(summary.unresolvedIds, 1);
  assert.equal(summary.bridges, 1);
});

test('a person reachable only through unnamed routes sorts after an equal one with a named route', () => {
  const rows = [row('1', '/in/a', 'gone', 'B', 5), row('2', '/in/b', 'a', 'B', 5)];
  assert.deepEqual(people(rows, [bridge('a', 'D', 1)]).map((p) => p.key), ['/in/b', '/in/a']);
});

test('the best-scored copy of a person is the one shown, and it is the row itself', () => {
  const rows = [row('1', '/in/x', 'a', 'B', 4), row('2', '/in/x', 'b', 'A', 6.5)];
  const [p] = people(rows, [bridge('a', 'B'), bridge('b', 'C')]);
  assert.equal(p.person, rows[1], 'the exact row, not a copy, so its id matches selectedId');
  assert.equal(p.score, 6.5);
});

test('on a tied score, the copy with a photo is shown', () => {
  const rows = [row('1', '/in/x', 'a', 'B', 5), row('2', '/in/x', 'b', 'B', 5, { profile_image_url: '/avatars/x.webp' })];
  assert.equal(people(rows, [bridge('a', 'B'), bridge('b', 'C')])[0].person.id, '2');
});

test('7.7 and 7.699999999999999 are the same score, and ways in decides between them', () => {
  assert.equal(score1({ power_score: 7.699999999999999 }), 7.7);
  const bridges = [bridge('a', 'B'), bridge('b', 'B')];
  const rows = [
    row('1', '/in/float', 'a', 'S', 7.7),                       // one way in, the "bigger" float
    row('2', '/in/two', 'a', 'S', 7.699999999999999),           // two ways in
    row('3', '/in/two', 'b', 'S', 7.699999999999999),
  ];
  assert.deepEqual(people(rows, bridges).map((p) => p.key), ['/in/two', '/in/float']);
});

test('an equal (score, ways in) pair shares a rank and is marked tied', () => {
  const bridges = [bridge('a', 'S', 9), bridge('b', 'D', 1)];
  const rows = [
    row('1', '/in/top', 'a', 'S', 8.5),
    row('2', '/in/tie1', 'b', 'S', 8.2),   // worse bridge: after tie2, same rank
    row('3', '/in/tie2', 'a', 'S', 8.2),
    row('4', '/in/next', 'a', 'S', 8.0),
  ];
  const list = people(rows, bridges);
  assert.deepEqual(list.map((p) => [p.key, p.rank, p.tied]), [
    ['/in/top', 1, false], ['/in/tie2', 2, true], ['/in/tie1', 2, true], ['/in/next', 4, false],
  ]);
});

test('filtering the list never renumbers anyone', () => {
  const rows = [row('1', '/in/a', 'a', 'S', 9), row('2', '/in/b', 'a', 'A', 6), row('3', '/in/c', 'a', 'C', 3)];
  const list = people(rows, [bridge('a', 'B')]);
  const before = new Map(list.map((p) => [p.key, p.rank]));
  const onlyC = list.filter((p) => p.tier === 'C');
  assert.equal(onlyC[0].rank, 3);
  for (const p of list.filter((q) => q.haystack.includes('/in/b'))) assert.equal(p.rank, before.get(p.key));
});

test('every row id maps to its person', () => {
  const rows = [row('1', '/in/x', 'a'), row('2', '/in/x', 'b'), row('3', '/in/y', 'a'), row('4', null, 'a')];
  const { rowToKey, people: list } = separationPeople(rows, [bridge('a', 'B'), bridge('b', 'B')]);
  for (const r of rows) assert.ok(list.some((p) => p.key === rowToKey.get(r.id)), `row ${r.id}`);
  assert.equal(rowToKey.get('4'), 'id:4', 'no URL falls back to the row id');
});

test('URLs that differ only by a query or trailing slash are one person', () => {
  assert.equal(keyFor({ profile_url: 'https://www.linkedin.com/in/ada-q/?x=1' }), 'https://www.linkedin.com/in/ada-q');
  const rows = [row('1', '/in/x/', 'a'), row('2', '/in/x?utm=1', 'b')];
  assert.equal(people(rows, [bridge('a', 'B'), bridge('b', 'B')]).length, 1);
});

test('search looks through who knows them, not just the person', () => {
  const b = { ...bridge('a', 'S'), name: 'Quill Ferreira' };
  const [p] = people([row('1', '/in/x', 'a', 'B', 5, { company: 'Northwind Labs' })], [b]);
  assert.ok(p.haystack.includes('quill ferreira'));
  assert.ok(p.haystack.includes('northwind labs'));
});

test('the summary counts people, tiers, several-ways-in and bridges', () => {
  const rows = [row('1', '/in/x', 'a', 'S', 8), row('2', '/in/x', 'b', 'S', 8), row('3', '/in/y', 'a', 'D', 1)];
  const { summary } = separationPeople(rows, [bridge('a', 'B'), bridge('b', 'A')]);
  assert.equal(summary.people, 2);
  assert.deepEqual(summary.byTier, { S: 1, A: 0, B: 0, C: 0, D: 1 });
  assert.equal(summary.multi, 1);
  assert.equal(summary.bridges, 2);
  assert.equal(summary.peopleOnlyUnresolved, 0);
});

test('routesFor finds every route for a selected row, unnamed ones last', () => {
  const bridges = [bridge('a', 'C'), bridge('b', 'S'), bridge('c', 'A')];
  const rows = [row('1', '/in/x', 'a'), row('2', '/in/x', 'b'), row('3', '/in/y', 'c'), row('4', '/in/x', 'gone')];
  const idx = routeIndex(rows);
  const byIdMap = new Map(bridges.map((b) => [b.id, b]));
  assert.deepEqual(routesFor(rows[0], idx, byIdMap).map((r) => [r.id, !!r.bridge]), [['b', true], ['a', true], ['gone', false]]);
  assert.deepEqual(routesFor(null, idx, byIdMap), []);
  // A row from outside the index still gets its own route.
  assert.deepEqual(routesFor(row('9', '/in/z', 'c'), idx, byIdMap).map((r) => r.id), ['c']);
});

test('the summit map draws every route of the top K, one unnamed node, and never crowds bridges', () => {
  const bridges = Array.from({ length: 12 }, (_, i) => bridge(`b${i}`, 'ABCD'[i % 4], 9 - i / 2));
  const rows = [];
  // Ten people, several ways in each, and two unnamed routes among them.
  for (let p = 0; p < 10; p++) {
    for (let k = 0; k <= p % 4; k++) rows.push(row(`${p}-${k}`, `/in/p${p}`, `b${(p + k * 3) % 12}`, 'S', 9 - p / 10));
  }
  rows.push(row('u1', '/in/p1', 'gone1', 'S', 8.9), row('u2', '/in/p2', 'gone2', 'S', 8.8));
  const top = people(rows, bridges).slice(0, 10);
  const map = summitLayout(top, 900, false);

  const expected = top.reduce((n, p) => n + p.routes.filter((r) => r.bridge).length + (p.routes.some((r) => !r.bridge) ? 1 : 0), 0);
  assert.equal(map.links.length, expected, 'every route drawn');
  for (const p of top) {
    const primary = map.links.find((l) => l.key === p.key && l.primary);
    assert.equal(primary?.bridgeId, p.routes[0].id, 'the solid line is the top-scored bridge');
  }
  assert.equal(map.bridges.filter((b) => b.unresolved).length, 1, 'at most one unnamed node');
  const ys = map.bridges.map((b) => b.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= MIN_BRIDGE_GAP - 1e-9, 'bridges at least 18px apart');
  assert.ok(map.height >= ys[ys.length - 1], 'the map grows to fit them');

  const phone = summitLayout(top.slice(0, 5), 343, true);
  assert.equal(phone.people.length, 5);
  assert.equal(phone.people[1].y - phone.people[0].y, 36, 'a phone gets 36px tap rows');
});

test('an empty network is an empty list and an empty map', () => {
  assert.deepEqual(people([], []), []);
  assert.deepEqual(people(undefined, undefined), []);
  assert.equal(summitLayout([], 800).height, 0);
});
