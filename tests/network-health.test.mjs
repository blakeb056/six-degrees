// Network health for the Scores tab (lib/network-health.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkHealth } from '../lib/network-health.js';

const url = (s) => `https://www.linkedin.com/in/${s}`;
const d2 = (bridge, who) => ({ id: `${bridge}-${who}`, degree: 2, source_connection_id: bridge, profile_url: url(who) });
const degree1 = ['maya', 'tom', 'lee', 'ana'].map((id) => ({ id, name: id.toUpperCase(), company: 'Hooli', degree: 1, profile_url: url(id) }));
const degree2 = [d2('maya', 'a'), d2('maya', 'b'), d2('maya', 'c'), d2('tom', 'c'), d2('tom', 'd'), d2('lee', 'e')];

test('health: circles scanned, reach two ways, effective size from the ties kept, top connections', () => {
  const h = networkHealth({ degree1, degree2, ties: 2 });
  assert.equal(h.circles, 3);
  assert.equal(h.early, true, 'under 5 circles is an early estimate');
  assert.ok(Math.abs(h.twoWays - 1 / 5) < 1e-9, 'c is reached two ways, out of a–e');
  assert.equal(h.effective.size, 4 - (2 * 2) / 4);
  assert.equal(h.effective.efficiency, 3 / 4);
  assert.deepEqual(h.top.map((b) => [b.id, b.circle, b.only]), [['maya', 3, 2], ['tom', 2, 1], ['lee', 1, 1]]);
});

test('an empty network is all zeros, not NaN', () => {
  const h = networkHealth();
  assert.deepEqual([h.circles, h.twoWays, h.effective.size, h.effective.efficiency, h.top.length], [0, 0, 0, 0, 0]);
});
