import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleMap, clusterValue } from '../lib/people-map.js';

// Invented people. Ana's circle: four, two S and one A; Ben's: two, one shared with Ana.
const d1 = [
  { id: 'ana', name: 'Ana', profile_url: 'u/ana', tier: 'S' },
  { id: 'ben', name: 'Ben', profile_url: 'u/ben', tier: 'A' },
  { id: 'cy', name: 'Cy', profile_url: 'u/cy', tier: 'B' },
];
const row = (id, from, tier, url = `u/${id}`) => ({ id: `${id}-${from}`, source_connection_id: from, tier, profile_url: url });
const d2 = [
  row('p1', 'ana', 'S'), row('p2', 'ana', 'S'), row('p3', 'ana', 'A'), row('p4', 'ana', 'C'),
  row('p4', 'ben', 'C'), row('p5', 'ben', 'B'),
  row('p1', 'ana', 'S'),                       // saved twice: still one person
  row('x', 'nobody', 'S'),                     // a connection not in the list: ignored
];

test('each connection: their cluster, what it is worth, and how much of it only they hold', () => {
  const m = peopleMap(d1, d2);
  const at = (id) => m.people.find((p) => p.id === id);
  assert.deepEqual([at('ana').size, at('ana').S, at('ana').A], [4, 2, 1]);
  assert.equal(at('ana').value, clusterValue({ size: 4, S: 2, A: 1 }));
  assert.equal(at('ana').value, 4 + 4 + 1);
  assert.equal(at('ana').only, 3);
  assert.equal(at('ana').share, 0.75);
  assert.deepEqual([at('ben').size, at('ben').only], [2, 1]);
  // Not scanned yet: nothing behind them.
  assert.deepEqual([at('cy').size, at('cy').value, at('cy').share], [0, 0, 0]);
});

test('a line joins two connections whose clusters share people', () => {
  const m = peopleMap(d1, d2);
  assert.deepEqual(m.links, [{ a: 'ana', b: 'ben', shared: 1 }]);
});

test('how a cluster compares: the share of your scanned connections worth less', () => {
  const m = peopleMap(d1, d2);
  assert.equal(m.rank('ana'), 1);
  assert.equal(m.rank('ben'), 0);
  assert.equal(m.rank('cy'), null);
  assert.deepEqual(peopleMap().people, []);
});
