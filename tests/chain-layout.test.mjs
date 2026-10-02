// Where Bridge Chains puts a circle's dots (lib/chain-layout.js). Blake,
// 2026-09-28: a scan with a lot of 2nd degree "is almost a solid line and
// needs to expand more". Every dot sat on one ring. These pin the spread: more
// people make more rings, neighbours keep their distance, and the layout stays
// inside the room it's given while it can.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringLayout, dotRadius, previewBand, tierBandLayout, outerFans } from '../lib/chain-layout.js';

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

test('the hover preview starts beyond every ring of bridges, however many there are', () => {
  const maxR = 400;
  assert.deepEqual(previewBand(maxR, []), { inner: 264, outer: 320 }, 'no bridges: where it always was');
  const few = ringLayout(12, { inner: maxR * 0.55, innerMin: maxR * 0.4, outer: maxR * 0.62, spacing: 46, minSpacing: 20 });
  assert.equal(previewBand(maxR, few.rings).inner, 264, 'one ring of bridges leaves it where it was');
  const many = ringLayout(160, { inner: maxR * 0.55, innerMin: maxR * 0.4, outer: maxR * 0.62, spacing: 46, minSpacing: 20 });
  const edge = Math.max(...many.rings.map((r) => r.radius));
  const band = previewBand(maxR, many.rings);
  assert.ok(band.inner >= edge + 34, `starts past the outermost bridge ring (${edge})`);
  assert.ok(band.outer - band.inner >= maxR * 0.14 - 1e-9, 'and keeps its depth');
});

test('an opened circle sits in tier bands, S nearest, with a gap between bands', () => {
  const rows = [
    ...Array.from({ length: 30 }, () => ({ tier: 'C' })),
    ...Array.from({ length: 12 }, () => ({ tier: 'S' })),
    ...Array.from({ length: 20 }, () => ({ tier: 'A' })),
    { tier: undefined },
  ];
  const l = tierBandLayout(rows, { inner: 60, outer: 400, spacing: 20, minSpacing: 4, gap: 16 });
  assert.deepEqual(l.bands.map((b) => b.tier), ['S', 'A', 'C', 'D'], 'no tier goes with D');
  for (let i = 1; i < l.bands.length; i++) assert.ok(l.bands[i].inner > l.bands[i - 1].outer, 'a gap between bands');
  const r = (p) => Math.hypot(p.x, p.y);
  const band = (t) => l.bands.find((b) => b.tier === t);
  rows.forEach((row, i) => {
    const b = band(row.tier || 'D');
    assert.ok(r(l.points[i]) >= b.inner - 1e-6 && r(l.points[i]) <= b.outer + 1e-6, 'each dot in its own tier band');
    assert.ok(l.points[i].slot > 0);
  });
  assert.ok(l.edge <= 400);
});

test('too many for the room: the bands close up before they spill', () => {
  const rows = Array.from({ length: 900 }, (_, i) => ({ tier: 'SABCD'[i % 5] }));
  const roomy = tierBandLayout(rows, { inner: 60, outer: 10000, spacing: 20, minSpacing: 4 });
  const room = roomy.edge * 0.6;
  const tight = tierBandLayout(rows, { inner: 60, outer: room, spacing: 20, minSpacing: 4 });
  assert.equal(roomy.spacing, 20);
  assert.ok(tight.spacing < 20 && tight.spacing >= 4);
  assert.ok(tight.edge <= room);
});

test('fans sit behind their own person, capped, and say how many more', () => {
  const anchors = [
    { angle: 0, slot: 0.5, count: 0 },
    { angle: Math.PI / 2, slot: 0.4, count: 300 },
    { angle: Math.PI, slot: 0.4, count: 5 },
  ];
  const [none, big, small] = outerFans(anchors, { from: 300, cap: 40 });
  assert.equal(none, null);
  assert.equal(big.points.length, 40);
  assert.equal(big.more, 260);
  assert.equal(small.points.length, 5);
  assert.equal(small.more, 0);
  for (const p of big.points) {
    assert.ok(Math.hypot(p.x, p.y) >= 300 - 1e-6, 'beyond `from`');
    const off = Math.abs(Math.atan2(p.y, p.x) - Math.PI / 2);
    assert.ok(off <= 0.4 / 2 + 1e-6, 'within their slot');
  }
});

test('a lot of fans share about `total` dots between them', () => {
  const anchors = Array.from({ length: 100 }, (_, i) => ({ angle: (i / 100) * Math.PI * 2, slot: 0.06, count: 500 }));
  const drawn = outerFans(anchors, { from: 300, total: 1200 }).reduce((n, f) => n + f.points.length, 0);
  assert.ok(drawn <= 1200, `${drawn} drawn`);
});

test('ringLayout: ringGap keeps the rings further apart than the dots on them', async () => {
  const { ringLayout } = await import('../lib/chain-layout.js');
  const l = ringLayout(60, { inner: 150, outer: 400, spacing: 30, ringGap: 64 });
  assert.ok(l.rings.length > 1);
  for (let k = 1; k < l.rings.length; k++) assert.ok(l.rings[k].radius - l.rings[k - 1].radius >= 64 - 1e-9);
  // Without it nothing changes.
  const plain = ringLayout(60, { inner: 150, outer: 400, spacing: 30 });
  assert.equal(plain.rings[1].radius - plain.rings[0].radius, 30);
});

test('chains: someone met through a bridge sits one hop out, beside that bridge', async () => {
  const { chainLayout } = await import('../lib/chain-layout.js');
  // 0..5 are your own; 6 came through 2; 7 through 6; 8 and 9 both through 4.
  const parents = [-1, -1, -1, -1, -1, -1, 2, 6, 4, 4];
  const l = chainLayout(parents, { inner: 200, outer: 240, spacing: 46, hop: 60 });
  assert.deepEqual(l.points.map((p) => p.depth), [0, 0, 0, 0, 0, 0, 1, 2, 1, 1]);
  assert.equal(l.points[6].radius, 260);
  assert.equal(l.points[7].radius, 320);
  const near = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  // An only child points straight out from its bridge, and so does theirs.
  assert.ok(near(l.points[6].angle, l.points[2].angle) < 1e-9);
  assert.ok(near(l.points[7].angle, l.points[2].angle) < 1e-9);
  // Two from the same bridge sit either side of it, a full spacing apart.
  const sep = 46 / 260;
  assert.ok(Math.abs(near(l.points[8].angle, l.points[9].angle) - sep) < 1e-9);
  assert.ok(Math.abs(near(l.points[8].angle, l.points[4].angle) - sep / 2) < 1e-9);
  assert.deepEqual(l.rings.map((r) => [r.depth, r.count]), [[0, 6], [1, 3], [2, 1]]);
  assert.equal(l.points[8].parent, 4);
});

test('chains: nobody on a ring touches a neighbour, however many came through one bridge', async () => {
  const { chainLayout } = await import('../lib/chain-layout.js');
  const parents = [-1, -1, -1, ...new Array(9).fill(0), ...new Array(4).fill(1)];
  const l = chainLayout(parents, { inner: 180, outer: 220, spacing: 40, hop: 60 });
  const kids = l.points.filter((p) => p.depth === 1).map((p) => p.angle).sort((a, b) => a - b);
  const sep = 40 / 240;
  for (let k = 1; k < kids.length; k++) assert.ok(kids[k] - kids[k - 1] >= sep - 1e-9);
  assert.ok(kids[0] + 2 * Math.PI - kids[kids.length - 1] >= sep - 1e-9);
});

test('chains: a ring too full to keep its spacing shares the circle evenly; a loop is cut, not followed for ever', async () => {
  const { chainLayout } = await import('../lib/chain-layout.js');
  const full = chainLayout([-1, ...new Array(60).fill(0)], { inner: 100, outer: 120, spacing: 46, hop: 60 });
  const a = full.points.slice(1).map((p) => p.angle).sort((x, y) => x - y);
  for (let k = 1; k < a.length; k++) assert.ok(Math.abs(a[k] - a[k - 1] - (2 * Math.PI) / 60) < 1e-9);
  const loop = chainLayout([1, 0, -1], { inner: 100, outer: 120, spacing: 46 });
  assert.equal(loop.points.length, 3);
  assert.ok(loop.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.deepEqual(chainLayout([], { inner: 100, outer: 120, spacing: 46 }).points, []);
});
