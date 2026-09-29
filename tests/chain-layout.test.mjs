// Where Bridge Chains puts a circle's dots (lib/chain-layout.js). Blake,
// 2026-09-28: a scan with a lot of 2nd degree "is almost a solid line and
// needs to expand more". Every dot sat on one ring. These pin the spread: more
// people make more rings, neighbours keep their distance, and the layout stays
// inside the room it's given while it can.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringLayout, dotRadius } from '../lib/chain-layout.js';

// The focused view's numbers on a 800×600 window (lib/chain-layout.js is told
// them by ChainView's CircleFocus): maxR = 270.
const ROOM = { inner: 270 * 0.55, innerMin: 62, outer: 270 * 0.94, spacing: 23, minSpacing: 4 };
const PHONE = { inner: 150 * 0.55, innerMin: 62, outer: 150 * 0.94, spacing: 14, minSpacing: 4 };

function closest(points) {
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return min;
}
const farthest = (points) => Math.max(...points.map((p) => Math.hypot(p.x, p.y)));

test('every person gets a place, and nobody shares one', () => {
  for (const n of [1, 7, 50, 200, 800]) {
    const { points } = ringLayout(n, ROOM);
    assert.equal(points.length, n);
    assert.equal(new Set(points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size, n);
  }
});

test('a small circle is one ring, as before', () => {
  const { rings, points } = ringLayout(12, ROOM);
  assert.equal(rings.length, 1);
  assert.ok(points.every((p) => Math.abs(Math.hypot(p.x, p.y) - ROOM.inner) < 1e-6));
});

test('a big circle spreads into more rings instead of a solid line', () => {
  const rings = [50, 200, 800].map((n) => ringLayout(n, ROOM).rings.length);
  assert.ok(rings[0] < rings[1] && rings[1] < rings[2], `rings for 50, 200, 800: ${rings}`);
  // 800 on one ring of this size would sit about 2 px apart.
  assert.ok(ringLayout(800, ROOM).rings.length >= 8);
});

test('neighbours keep their distance: the spacing asked for while it fits, never under the minimum', () => {
  for (const n of [50, 200]) {
    const layout = ringLayout(n, ROOM);
    assert.equal(layout.spacing, ROOM.spacing, `${n} fit at the spacing asked for`);
    assert.ok(closest(layout.points) >= ROOM.spacing * 0.95, `${n}: ${closest(layout.points)}`);
  }
  for (const [n, room] of [[800, ROOM], [1000, ROOM], [800, PHONE]]) {
    const layout = ringLayout(n, room);
    assert.ok(layout.spacing >= room.minSpacing);
    assert.ok(closest(layout.points) >= layout.spacing * 0.95, `${n}: ${closest(layout.points)} vs ${layout.spacing}`);
  }
});

test('it stays inside the room it is given, moving in and closing up to fit', () => {
  for (const [n, room] of [[200, ROOM], [800, ROOM], [1000, ROOM], [200, PHONE], [800, PHONE]]) {
    const layout = ringLayout(n, room);
    assert.ok(farthest(layout.points) <= room.outer + 1e-6, `${n}: ${farthest(layout.points)} > ${room.outer}`);
    assert.ok(layout.inner >= room.innerMin - 1e-6);
  }
  // Rings start further in before anything closes up.
  const big = ringLayout(800, ROOM);
  assert.ok(big.inner < ROOM.inner);
});

test('past what fits even at the minimum, rings carry on outward rather than overlap', () => {
  const tight = { inner: 40, innerMin: 40, outer: 60, spacing: 10, minSpacing: 8 };
  const layout = ringLayout(600, tight);
  assert.equal(layout.spacing, 8);
  assert.ok(farthest(layout.points) > tight.outer);
  assert.ok(closest(layout.points) >= 8 * 0.95);
});

test('the rings are about equally full, and the first in the list sit nearest the middle', () => {
  const { rings, points } = ringLayout(200, ROOM);
  const fill = rings.map((r) => r.count / ((2 * Math.PI * r.radius) / ROOM.spacing));
  assert.ok(Math.max(...fill) - Math.min(...fill) < 0.1, `fill ${fill.map((f) => f.toFixed(2))}`);
  const radius = (p) => Math.hypot(p.x, p.y);
  for (let i = 1; i < points.length; i++) assert.ok(radius(points[i]) >= radius(points[i - 1]) - 1e-6);
});

test('an arc stays inside its sweep, and grows rows as it fills', () => {
  const start = 1;
  const sweep = Math.PI / 2;
  const small = ringLayout(10, { inner: 180, outer: 260, spacing: 11, start, sweep });
  const large = ringLayout(300, { inner: 180, outer: 260, spacing: 11, minSpacing: 3, start, sweep });
  assert.equal(small.rings.length, 1);
  assert.ok(large.rings.length > 3);
  for (const p of large.points) assert.ok(p.angle >= start - 1e-9 && p.angle <= start + sweep + 1e-9);
  assert.ok(closest(large.points) >= large.spacing * 0.95);
});

test("an arc fills from its middle, so the first in the list sit nearest what it fans out from", () => {
  const start = 1;
  const sweep = Math.PI / 2;
  const { points } = ringLayout(9, { inner: 180, outer: 260, spacing: 11, start, sweep });
  const off = points.map((p) => Math.abs(p.angle - (start + sweep / 2)));
  assert.ok(off[0] < 1e-9, 'the first is in the middle');
  for (let i = 2; i < off.length; i++) assert.ok(off[i] >= off[i - 2] - 1e-9, `${off.map((o) => o.toFixed(2))}`);
});

test('nobody, or nonsense, is an empty layout', () => {
  assert.deepEqual(ringLayout(0, ROOM).points, []);
  assert.deepEqual(ringLayout(-3, ROOM).points, []);
  assert.deepEqual(ringLayout(NaN, ROOM).points, []);
});

test('it is quick enough to redo on every change, even for a whole list', () => {
  const t = performance.now();
  for (let i = 0; i < 50; i++) ringLayout(1000, ROOM);
  assert.ok((performance.now() - t) / 50 < 20);
});

test('dots are bigger for higher tiers and never wider than the gap to a neighbour', () => {
  for (const s of [4, 10, 23]) {
    const sizes = ['S', 'A', 'B', 'C'].map((t) => dotRadius(s, t));
    assert.ok(sizes[0] >= sizes[1] && sizes[1] >= sizes[2] && sizes[2] >= sizes[3]);
    assert.ok(sizes[0] * 2 <= Math.max(s, 2.8) + 1e-9, `S at ${s}: ${sizes[0]}`);
  }
});
