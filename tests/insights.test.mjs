// Insights on a connection's card (lib/insights.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileInsights } from '../lib/insights.js';
import { exclusiveReach, bridgeOverlap } from '../lib/brokerage.js';
import { reachIndex } from '../lib/reach.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;
const d2 = (bridge, who, tier, company = who === 'ann' || who === 'bo' ? 'Hooli' : 'Initech') => ({ id: `${bridge}-${who}`, degree: 2, source_connection_id: bridge, profile_url: url(who), tier, company });

const connections = ['maya', 'tom', 'lee'].map((id) => ({ id, degree: 1, profile_url: url(id) }));
const degree2 = [
  d2('maya', 'ann', 'S'), d2('maya', 'bo', 'A'), d2('maya', 'cy', 'B'), d2('maya', 'di', 'C'), d2('maya', 'di', 'C'),
  d2('tom', 'bo', 'A'), d2('tom', 'cy', 'B'), d2('tom', 'di', 'C'), d2('tom', 'ed'),
  d2('lee', 'fay', 'S'),
];
const ctx = {
  degree2,
  exclusive: exclusiveReach(degree2, connections),
  overlap: bridgeOverlap(degree2, connections),
  reach: reachIndex(connections, degree2, { read: [url('maya')], lists: { [url('maya')]: { pages: 1, more: false, total: 4 } } }),
};

test('a connection\'s six numbers: circle, only through them, twin, tier mix, scanned, rank', () => {
  const i = profileInsights(connections[0], ctx);
  assert.equal(i.circle, 4, 'Di counted once');
  assert.equal(i.only, 1, 'Ann');
  assert.equal(i.onlyShare, 0.25);
  assert.deepEqual(i.twin, { id: 'tom', share: 3 / 5, shared: 3 });
  assert.deepEqual(i.mix, { S: 1, A: 1, B: 1, C: 1, D: 0 });
  assert.equal(i.bars, 5, 'read to the end');
  assert.deepEqual([i.rank, i.of], [1, 3], 'Maya reaches the most no one else does');
  assert.deepEqual(i.companies, [{ name: 'Hooli', count: 2 }, { name: 'Initech', count: 2 }], 'two or more at a company');
});

test('no twin under 15% or 3 people; a 2nd-degree person has no insights', () => {
  const lee = profileInsights(connections[2], ctx);
  assert.equal(lee.twin, null);
  assert.equal(lee.circle, 1);
  assert.equal(profileInsights({ id: 'x', degree: 2 }, ctx), null);
  assert.equal(profileInsights(null, ctx), null);
});
