import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyStrength, clusterStrength } from '../lib/map-heat.js';
import { heatBy } from '../lib/galaxy-lab.js';

// Invented people only.
test('a company is as strong as its five strongest people there', () => {
  const at = (...scores) => scores.map((power_score) => ({ power_score }));
  assert.equal(companyStrength(at(9, 8, 7, 6, 5, 1, 1, 1)), 7);   // the juniors don't drag it down
  assert.equal(companyStrength(at('8.5')), 8.5);
  assert.equal(companyStrength([]), 0);
});

test('a cluster is as strong as its people, person for person; not scanned is the coldest', () => {
  assert.equal(clusterStrength({ size: 10, S: 10, A: 0 }), 3);
  assert.equal(clusterStrength({ size: 10, S: 0, A: 0 }), 1);
  assert.equal(clusterStrength({ size: 4, S: 1, A: 1 }), (3 + 2 + 2) / 4);
  assert.equal(clusterStrength({ size: 0 }), -1);
  // A small strong cluster runs hotter than a big plain one.
  const nodes = [{ size: 900, S: 20, A: 80 }, { size: 40, S: 12, A: 10 }, { size: 0 }];
  const heat = heatBy(nodes, clusterStrength);
  assert.deepEqual(nodes.map(heat), [0.5, 1, 0]);
});
