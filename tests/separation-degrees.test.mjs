// Separation past the 2nd degree (Blake, 2026-10-05: "it only lets us pick from
// 2nd degree and not 3rd degree even though i know we have 3rd degree
// connections"). Who is ranked at 3rd and beyond comes only from real chains of
// scanned circles; company scans' finds, which no chain reaches, are listed
// unranked. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  separationPeople, separationCounts, summitLayout, convergeLayout, withSteps, comparePower, MAX_ROUTES,
} from '../lib/separation.js';

const bridge = (id, tier = 'B', power_score = 5) => ({ id, name: `Bridge ${id}`, tier, power_score, degree: 1, profile_url: `/in/bridge-${id}` });
const row = (id, url, via, tier = 'B', power_score = 5, extra = {}) =>
  ({ id, degree: 2, name: `Person ${url}`, profile_url: url, source_connection_id: via, tier, power_score, ...extra });
const found = (id, url, company, tier = 'A', power_score = 7) =>
  ({ id, degree: 3, name: `Found ${url}`, profile_url: url, source_connection_id: null, scanned_company: company, tier, power_score });

test('a company scan’s find is listed unranked, with who found them, and never given a route', () => {
  const { people, unranked, summary } = separationPeople([row('1', '/in/x', 'a'), found('9', '/in/far', 'Acme')], [bridge('a')]);
  assert.deepEqual(people.map((p) => p.key), ['/in/x']);
  assert.equal(unranked.length, 1);
  assert.equal(unranked[0].degree, 3);
  assert.deepEqual(unranked[0].routes, []);
  assert.equal(unranked[0].waysIn, 0);
  assert.deepEqual(unranked[0].foundBy, ['Acme']);
  assert.ok(unranked[0].haystack.includes('acme'), 'searching the company finds them');
  assert.equal(summary.unranked, 1);
  assert.equal(summary.people, 1);
});

test('someone a company scan found who is also in a scanned circle is 2nd degree, once', () => {
  const { people, unranked } = separationPeople([row('1', '/in/x', 'a'), found('9', '/in/x', 'Acme')], [bridge('a')]);
  assert.equal(people.length, 1);
  assert.equal(people[0].degree, 2);
  assert.equal(unranked.length, 0);
  assert.deepEqual(people[0].rowIds.sort(), ['1', '9']);
});

test('your own connection a company scan also found is not a find', () => {
  const b = bridge('a');
  const { unranked } = separationPeople([{ ...found('9', b.profile_url, 'Acme') }], [b]);
  assert.equal(unranked.length, 0);
});

test('someone in the circle of a 2nd-degree person is 3rd degree, routed through both', () => {
  // P is in Bridge a's circle; X is in P's circle.
  const rows = [row('p', '/in/p', 'a', 'C', 3), row('x', '/in/x', 'p', 'S', 9)];
  const { people } = separationPeople(rows, [bridge('a', 'A')]);
  const x = people.find((p) => p.key === '/in/x');
  assert.equal(x.degree, 3);
  assert.equal(x.waysIn, 1);
  assert.equal(x.routes[0].id, 'a');
  assert.equal(x.routes[0].bridge.name, 'Bridge a');
  assert.deepEqual(x.routes[0].via.map((v) => v.id), ['p']);
  assert.ok(x.haystack.includes('person /in/p'), 'the person between is searchable');
  assert.equal(people.find((p) => p.key === '/in/p').degree, 2);
});

test('the nearest degree wins: in a connection’s circle and a 2nd-degree person’s, they are 2nd, through the connection only', () => {
  const rows = [row('p', '/in/p', 'a'), row('x1', '/in/x', 'p'), row('x2', '/in/x', 'b')];
  const x = separationPeople(rows, [bridge('a'), bridge('b')]).people.find((p) => p.key === '/in/x');
  assert.equal(x.degree, 2);
  assert.deepEqual(x.routes.map((r) => [r.id, r.via.length]), [['b', 0]]);
});

test('chains go on to 6th degree and no further, each step real', () => {
  const rows = [row('p2', '/in/2', 'a')];
  for (let d = 3; d <= 7; d++) rows.push(row(`p${d}`, `/in/${d}`, `p${d - 1}`));
  const { people, unranked } = separationPeople(rows, [bridge('a')]);
  const degreeOf = Object.fromEntries(people.map((p) => [p.key, p.degree]));
  assert.deepEqual(degreeOf, { '/in/2': 2, '/in/3': 3, '/in/4': 4, '/in/5': 5, '/in/6': 6 });
  const six = people.find((p) => p.key === '/in/6');
  assert.deepEqual(six.routes[0].via.map((v) => v.id), ['p2', 'p3', 'p4', 'p5']);
  // The 7th is past six degrees: listed, not ranked, and not dropped.
  assert.deepEqual(unranked.map((p) => p.key), ['/in/7']);
});

test('every shortest route is kept, capped, and none twice', () => {
  // X is in the circles of two 2nd-degree people, each reachable two ways.
  const rows = [
    row('p1', '/in/p', 'a'), row('p2', '/in/p', 'b'),
    row('q1', '/in/q', 'a'),
    row('x1', '/in/x', 'p1'), row('x2', '/in/x', 'p2'), row('x3', '/in/x', 'q1'),
  ];
  const x = separationPeople(rows, [bridge('a'), bridge('b')]).people.find((p) => p.key === '/in/x');
  assert.equal(x.degree, 3);
  // Through P (via a, via b) and Q (via a): three routes, the P routes once each
  // although P has two rows.
  const sigs = x.routes.map((r) => `${r.id}>${r.via.map((v) => v.profile_url).join('>')}`).sort();
  assert.deepEqual(sigs, ['a>/in/p', 'a>/in/q', 'b>/in/p']);
  assert.equal(x.waysIn, 3);

  const many = [];
  const bridges = [];
  for (let i = 0; i < 40; i++) { bridges.push(bridge(`b${i}`)); many.push(row(`m${i}`, '/in/mid', `b${i}`)); }
  many.push(row('z', '/in/z', 'm0'));
  const z = separationPeople(many, bridges).people.find((p) => p.key === '/in/z');
  assert.equal(z.waysIn, MAX_ROUTES);
});

test('the grid picks who is ranked, at their degree, but never cuts a chain', () => {
  const rows = [row('p', '/in/p', 'a', 'D', 1), row('x', '/in/x', 'p', 'S', 9), found('f', '/in/f', 'Acme', 'S', 9)];
  // D hidden at 2nd degree: P is not ranked, X (through P) still is.
  const only3 = separationPeople(rows, [bridge('a')], { include: (tier, degree) => degree === 3 });
  assert.deepEqual(only3.people.map((p) => p.key), ['/in/x']);
  assert.equal(only3.unranked.length, 1);
  const no3 = separationPeople(rows, [bridge('a')], { include: (tier, degree) => degree !== 3 });
  assert.deepEqual(no3.people.map((p) => p.key), ['/in/p']);
  assert.equal(no3.unranked.length, 0);
});

test('same score: the nearer person first, and ranked apart', () => {
  const rows = [row('p', '/in/p', 'a', 'A', 7), row('x', '/in/x', 'p', 'A', 7)];
  const { people } = separationPeople(rows, [bridge('a')]);
  assert.deepEqual(people.map((p) => [p.key, p.rank, p.tied]), [['/in/p', 1, false], ['/in/x', 2, false]]);
  assert.ok(comparePower(people[0], people[1]) < 0);
});

test('2nd-degree ranking is unchanged when nothing lies further out', () => {
  const rows = [row('1', '/in/a', 'a', 'S', 8), row('2', '/in/b', 'a', 'A', 6), row('3', '/in/b', 'b', 'A', 6)];
  const { people } = separationPeople(rows, [bridge('a'), bridge('b')]);
  assert.deepEqual(people.map((p) => [p.key, p.degree, p.waysIn, p.rank]), [['/in/a', 2, 1, 1], ['/in/b', 2, 2, 2]]);
  for (const p of people) for (const r of p.routes) assert.deepEqual(r.via, []);
});

test('the Filters grid counts each person once, at the degree Separation has them', () => {
  const rows = [
    row('1', '/in/a', 'a', 'S'), row('2', '/in/a', 'b', 'S'),
    row('x', '/in/x', '1', 'A'),
    found('f1', '/in/f', 'Acme', 'A'), found('f2', '/in/a', 'Acme', 'S'),
  ];
  const counts = separationCounts(rows, [bridge('a'), bridge('b')]);
  assert.deepEqual(counts.S, { 2: 1 });
  assert.deepEqual(counts.A, { 3: 2 }, 'X ranked at 3rd, F unranked at 3rd');
});

test('the summit map puts the people between as stops along the line', () => {
  const rows = [row('p', '/in/p', 'a'), row('x', '/in/x', 'p', 'S', 9)];
  const { people } = separationPeople(rows, [bridge('a')]);
  const layout = summitLayout(people, 800);
  const toX = layout.links.find((l) => l.key === '/in/x');
  assert.deepEqual(toX.steps, ['Person /in/p']);
  assert.equal(toX.stops.length, 1);
  const s = toX.stops[0];
  assert.ok(s.x > toX.x1 && s.x < toX.x2, 'between your connection and them');
  assert.ok(s.y >= Math.min(toX.y1, toX.y2) && s.y <= Math.max(toX.y1, toX.y2));
  const toP = layout.links.find((l) => l.key === '/in/p');
  assert.deepEqual(toP.stops, []);
  // One node for Bridge a, though it leads to both.
  assert.equal(layout.bridges.length, 1);
  assert.equal(layout.bridges[0].count, 2);
});

test('aiming at a 3rd-degree person: one node per connection, its best route’s steps on the line', () => {
  const rows = [row('p1', '/in/p', 'a'), row('q1', '/in/q', 'a'), row('x1', '/in/x', 'p1'), row('x2', '/in/x', 'q1')];
  const x = separationPeople(rows, [bridge('a')]).people.find((p) => p.key === '/in/x');
  assert.equal(x.waysIn, 2);
  const layout = convergeLayout(x, 900);
  assert.equal(layout.bridges.length, 1);
  assert.equal(layout.bridges[0].count, 2);
  assert.equal(layout.links.length, 1);
  assert.equal(layout.links[0].stops.length, 1);
});

test('withSteps puts stops in order along the curve, evenly either side of its middle', () => {
  const l = withSteps({ x1: 0, y1: 0, x2: 300, y2: 0 }, [{ name: 'A' }, { name: 'B' }]);
  const [a, b] = l.stops.map((s) => s.x);
  assert.ok(a > 0 && a < b && b < 300);
  assert.equal(Math.round(a + b), 300);
  assert.deepEqual(l.steps, ['A', 'B']);
  assert.deepEqual(withSteps({ x1: 0, y1: 0, x2: 1, y2: 1 }).stops, []);
});
