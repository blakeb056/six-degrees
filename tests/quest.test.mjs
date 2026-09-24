// Outlink's game rules. Invented people only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuest, levelFor, STAGE_SIZE } from '../lib/quest.js';

const bridge = (id) => ({ id, name: `Bridge ${id}`, tier: 'S' });
const rec = (id, b, priority, tier = 'A') => ({ id, profile_url: `/in/${id}`, tier, priority, bridge: b });

test('each cluster offers its best people, a stage at a time', () => {
  const jane = bridge('jane');
  const recs = Array.from({ length: 12 }, (_, i) => rec(`p${i}`, jane, 100 - i));
  const q = buildQuest({ recs });
  const c = q.clusters[0];
  assert.equal(c.targets.length, STAGE_SIZE);
  assert.deepEqual(c.targets.map((p) => p.id), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.deepEqual([c.stage, c.stages, c.done], [1, 3, 0]);
});

test('sending to the whole stage clears it and the next five appear', () => {
  const jane = bridge('jane');
  const recs = Array.from({ length: 12 }, (_, i) => rec(`p${i}`, jane, 100 - i));
  const q = buildQuest({ recs, sentIds: new Set(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) });
  const c = q.clusters[0];
  assert.equal(c.stage, 2);
  assert.deepEqual(c.targets.map((p) => p.id), ['p5', 'p6', 'p7', 'p8', 'p9']);
  assert.equal(c.done, 1);
  assert.equal(q.clearedStages, 1);
});

test('points come from invites sent and people added, by tier', () => {
  const jane = bridge('jane');
  const q = buildQuest({
    recs: [rec('s1', jane, 9, 'S'), rec('a1', jane, 8, 'A')],
    sentIds: new Set(['s1', 'a1']),
    added: [{ id: 'new1', tier: 'S', unlocked_from_bridge_id: 'jane' }],
  });
  assert.equal(q.points, 25 + 15 + 100);
  assert.equal(q.addedTotal, 1);
  assert.equal(q.clusters[0].added.length, 1);
});

test('clusters you have started come first, finished ones last', () => {
  const a = bridge('a'), b = bridge('b'), c = bridge('c');
  const recs = [
    ...[1, 2].map((i) => rec(`a${i}`, a, 50)),
    ...[1, 2].map((i) => rec(`b${i}`, b, 90)),
    ...[1].map((i) => rec(`c${i}`, c, 70)),
  ];
  const q = buildQuest({ recs, sentIds: new Set(['a1', 'c1']) });
  assert.deepEqual(q.clusters.map((x) => x.bridge.id), ['a', 'b', 'c']);
  assert.equal(q.clusters[2].complete, true);
});

test('next moves are the best open people, nudged toward started clusters, never repeated', () => {
  const a = bridge('a'), b = bridge('b');
  const recs = [rec('x', a, 60), rec('y', a, 50), rec('z', b, 70), rec('z', b, 70)];
  const q = buildQuest({ recs, sentIds: new Set(['y']) });
  assert.deepEqual(q.nextMoves.map((m) => m.person.id), ['x', 'z']);
});

test('people you added whose circle is not mapped yet are the next doors', () => {
  const q = buildQuest({ added: [{ id: 'n1', unlocked_from_bridge_id: 'a' }, { id: 'n2', unlocked_from_bridge_id: 'a' }], mappedIds: new Set(['n2']) });
  assert.deepEqual(q.newDoors.map((p) => p.id), ['n1']);
});

test('levels need a little more each time', () => {
  assert.deepEqual([levelFor(0).level, levelFor(39).level, levelFor(40).level, levelFor(160).level], [1, 1, 2, 3]);
});
