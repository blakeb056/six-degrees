import test from 'node:test';
import assert from 'node:assert/strict';
import { easeOf, slideValue, slideLabel } from '../lib/rarity.js';

test('the Separation slider: 50 is the score alone, each end weights it by rarity or ease', () => {
  assert.equal(easeOf(1), 0);
  assert.equal(easeOf(31), 1);
  assert.equal(easeOf(500), 1);
  assert.ok(easeOf(3) > easeOf(2) && easeOf(10) > easeOf(4) && easeOf(30) > easeOf(11));
  // In the middle the mutual count changes nothing.
  assert.equal(slideValue(7.8, 1, 50), 7.8);
  assert.equal(slideValue(7.8, 40, 50), 7.8);
  // At the rare end someone with one way in keeps their score; the ones everybody knows drop to nothing.
  assert.equal(slideValue(7.8, 1, 0), 7.8);
  assert.equal(slideValue(7.8, 40, 0), 0);
  // At the easy end it is the other way round.
  assert.equal(slideValue(7.8, 40, 100), 7.8);
  assert.equal(slideValue(7.8, 1, 100), 0);
  // In between it leans: a weaker rare person can pass a stronger common one, by degrees.
  assert.ok(slideValue(7.0, 1, 25) > slideValue(7.8, 20, 25));
  assert.ok(slideValue(7.0, 1, 45) < slideValue(7.8, 20, 45));
  // Power still counts at the ends: of two equally rare people, the stronger is first.
  assert.ok(slideValue(9, 1, 0) > slideValue(5, 1, 0));
  assert.deepEqual([0, 30, 50, 70, 100].map((v) => slideLabel(v).name),
    ['Rarest first', 'Leaning rare', 'By power', 'Leaning easy', 'Easiest first']);
});
