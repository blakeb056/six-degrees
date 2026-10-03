import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkPower, levelOf, networkLevel } from '../lib/level.js';

test('Network Power counts every tier, catalysts, circles and S-tier two steps away', () => {
  const d1 = [
    { id: 1, tier: 'S' }, { id: 2, tier: 'A', is_catalyst: true }, { id: 3, tier: 'B' },
    { id: 4, tier: 'C' }, { id: 5, tier: 'D' },
  ];
  const d2 = [
    { tier: 'S', source_connection_id: 1 }, { tier: 'B', source_connection_id: 1 },
    { tier: 'S', source_connection_id: 2 },
  ];
  // 100 + 40 + 15 + 5 + 1, two circles (400), one catalyst (150), two S two steps away (100), five connections
  assert.equal(networkPower(d1, d2), 161 + 400 + 150 + 100 + 5);
});

test('level n takes 10·n² power', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(9), 0);
  assert.equal(levelOf(10), 1);
  assert.equal(levelOf(39), 1);
  assert.equal(levelOf(40), 2);
  assert.equal(levelOf(-5), 0);
  assert.equal(networkLevel([], []), 0);
});
