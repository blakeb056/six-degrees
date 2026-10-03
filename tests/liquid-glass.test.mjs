import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lensAt } from '../lib/liquid-glass.js';

test('Liquid Glass bends only a band along the edge, always inward, strongest at the rim', () => {
  const [w, h, r, bezel] = [320, 800, 2, 26];
  assert.deepEqual(lensAt(160, 400, w, h, r, bezel).map(Math.abs), [0, 0]);         // the middle never moves
  const [lx] = lensAt(0, 400, w, h, r, bezel);                                         // the left edge pulls right (inward)
  const [rx] = lensAt(w - 1, 400, w, h, r, bezel);                                     // the right edge pulls left
  assert.ok(lx > 0.8 && rx < -0.8, `${lx} ${rx}`);
  const [, ty] = lensAt(160, 0, w, h, r, bezel);
  assert.ok(ty > 0.8, 'the top edge pulls down');
  const near = Math.abs(lensAt(2, 400, w, h, r, bezel)[0]);
  const far = Math.abs(lensAt(20, 400, w, h, r, bezel)[0]);
  assert.ok(near > far && far > 0, 'it fades across the bezel');
  assert.deepEqual(lensAt(40, 400, w, h, r, bezel).map(Math.abs), [0, 0]);             // past the bezel: still
});
