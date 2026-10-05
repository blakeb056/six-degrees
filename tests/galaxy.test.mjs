// The Galaxy re-fits its view when its box changes size, rather than rebuilding
// the scene (app/components/ForceGraph.js). These pin what a re-fit promises.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentre, reframe } from '../lib/galaxy.js';

// Where a point of the graph lands in the box, and the point at the middle of it.
const toScreen = (t, [gx, gy]) => [t.x + t.k * gx, t.y + t.k * gy];
const middleOf = (t, box) => [(box.width / 2 - t.x) / t.k, (box.height / 2 - t.y) / t.k];

const wide = { width: 1440, height: 770 };
const withPanel = { width: 1120, height: 770 };  // a 320-pixel panel open

test('opening a panel slides the view by half its width, at the same zoom', () => {
  assert.deepEqual(recentre({ x: 720, y: 385, k: 1.5 }, wide, withPanel), { x: 560, y: 385, k: 1.5 });
});

test('what was in the middle of the box is in the middle still', () => {
  const view = { x: 300, y: -40, k: 2.5 };
  const middle = middleOf(view, wide);
  assert.deepEqual(toScreen(recentre(view, wide, withPanel), middle), [withPanel.width / 2, withPanel.height / 2]);
});

test('closing the panel puts the view back exactly where it was', () => {
  const view = { x: 120, y: 56, k: 0.8 };
  assert.deepEqual(recentre(recentre(view, wide, withPanel), withPanel, wide), view);
});

test('a box that only gets shorter, like a phone showing its address bar, moves the view up and not across', () => {
  assert.deepEqual(recentre({ x: 200, y: 400, k: 1 }, { width: 390, height: 700 }, { width: 390, height: 640 }), { x: 200, y: 370, k: 1 });
});

test('the same size leaves the view alone', () => {
  const view = { x: 12, y: 34, k: 3 };
  assert.deepEqual(recentre(view, wide, { ...wide }), view);
});

// reframe: the box on screen and its window. A panel beside the map moves nothing.

const frame = (left, width, vw = 1440) => ({ left, top: 130, width, height: 770, vw, vh: 900 });
const full = frame(0, 1440);
const filtersOpen = frame(320, 1120);   // the Filters panel takes the left 320 pixels
const detailsOpen = frame(0, 1120);     // Details takes the right 320

// Where a point of the graph is on the screen, not in the box.
const onScreen = (t, box, p) => toScreen(t, p).map((v, i) => v + (i ? box.top : box.left));

test('opening Filters leaves every dot where it was on screen, at the same zoom', () => {
  const view = { x: 902, y: 264, k: 1.5 };
  const next = reframe(view, full, filtersOpen);
  assert.deepEqual(next, { x: 582, y: 264, k: 1.5 });
  for (const p of [[0, 0], [120, -80], [-300, 210]]) assert.deepEqual(onScreen(next, filtersOpen, p), onScreen(view, full, p));
});

test('opening Details, on the right, leaves the view exactly as it was', () => {
  const view = { x: 902, y: 264, k: 1.5 };
  assert.deepEqual(reframe(view, full, detailsOpen), view);
});

test('closing a panel puts the view back exactly', () => {
  const view = { x: 120, y: 56, k: 0.8 };
  assert.deepEqual(reframe(reframe(view, full, filtersOpen), filtersOpen, full), view);
  assert.deepEqual(reframe(reframe(view, full, detailsOpen), detailsOpen, full), view);
});

test('a window resized keeps the middle in the middle', () => {
  const view = { x: 300, y: -40, k: 2.5 };
  const smaller = { left: 0, top: 130, width: 1100, height: 630, vw: 1100, vh: 760 };
  assert.deepEqual(reframe(view, full, smaller), recentre(view, full, smaller));
  assert.deepEqual(toScreen(reframe(view, full, smaller), middleOf(view, full)), [550, 315]);
});

test('no box to compare with leaves the view alone', () => {
  const view = { x: 12, y: 34, k: 3 };
  assert.deepEqual(reframe(view, null, full), view);
});

// Physics off (lib/galaxy.js settle): the forces run to rest without drawing.
import { settle, ticksToSettle } from '../lib/galaxy.js';
import { forceSimulation, forceManyBody, forceCenter } from 'd3';

test('a simulation at full heat settles in d3\'s 300 ticks, and one at rest in none', () => {
  assert.ok(Math.abs(ticksToSettle(1) - 300) <= 1);
  assert.ok(ticksToSettle(0.5) < 300 && ticksToSettle(0.5) > 0);
  assert.equal(ticksToSettle(0.0005), 0);
  assert.equal(ticksToSettle(1, { target: 0.3 }), Infinity);   // held warm by a drag: never on its own
});

// A stand-in simulation that ticks the way d3's does, and a clock it advances.
function fakeSim(alpha = 1) {
  const s = { a: alpha, ticks: 0, stopped: false, target: 0, decay: 1 - Math.pow(0.001, 1 / 300) };
  return Object.assign(s, {
    stop() { s.stopped = true; return s; },
    tick() { s.ticks += 1; s.a += (s.target - s.a) * s.decay; return s; },
    alpha: () => s.a, alphaMin: () => 0.001, alphaTarget: () => s.target,
    alphaDecay(d) { if (d === undefined) return s.decay; s.decay = d; return s; },
  });
}

test('settle stops the simulation\'s own timer and runs it to rest, then says so once', () => {
  const sim = fakeSim();
  let done = 0;
  settle(sim, { done: () => { done += 1; }, budget: Infinity });
  assert.equal(sim.stopped, true);
  assert.equal(done, 1);
  assert.ok(sim.a < 0.001);
  assert.ok(Math.abs(sim.ticks - 300) <= 1);
});

test('settle works in slices, never blocking the page for longer than its budget', () => {
  const sim = fakeSim();
  let t = 0;
  const queued = [];
  let done = false;
  settle(sim, { done: () => { done = true; }, budget: 10, now: () => (t += 1), later: (f) => queued.push(f) });
  assert.equal(done, false);
  assert.ok(sim.ticks > 0 && sim.ticks < 300);   // the first slice ran at once
  while (queued.length) queued.shift()();
  assert.equal(done, true);
  assert.ok(sim.a < 0.001);
});

test('a settle stopped part-way does no more, so a new change can start over', () => {
  const sim = fakeSim();
  const queued = [];
  let done = false;
  let t = 0;
  const stop = settle(sim, { done: () => { done = true; }, budget: 5, now: () => (t += 1), later: (f) => queued.push(f) });
  const at = sim.ticks;
  stop();
  while (queued.length) queued.shift()();
  assert.equal(sim.ticks, at);
  assert.equal(done, false);
});

test('a big network, every tick slow, cools faster: about `total` ms of work, then the decay put back', () => {
  const sim = fakeSim();
  const decay = sim.decay;
  let t = 0;
  const queued = [];
  let done = false;
  // Each tick takes 50 ms: all 300 would be 15 seconds.
  settle(sim, { done: () => { done = true; }, total: 3000, least: 20, budget: 30, now: () => (t += 50), later: (f) => queued.push(f) });
  while (queued.length) queued.shift()();
  assert.equal(done, true);
  assert.ok(sim.ticks <= 61, `${sim.ticks} ticks`);   // 3,000 ms of 50 ms ticks
  assert.ok(sim.a < 0.001);
  assert.equal(sim.decay, decay);
});

test('a dot held warm by a drag cannot keep settle going for ever', () => {
  const sim = fakeSim();
  sim.target = 0.3;
  settle(sim, { budget: Infinity, max: 50 });
  assert.equal(sim.ticks, 50);
});

test('settled without drawing, a real d3 layout lands where its own timer would have', () => {
  const make = () => forceSimulation(Array.from({ length: 40 }, (_, i) => ({ id: i })))
    .force('charge', forceManyBody().strength(-30)).force('center', forceCenter(0, 0)).stop();
  const ours = make();
  settle(ours, { budget: Infinity, total: Infinity });
  const theirs = make();
  theirs.tick(300);
  assert.ok(ours.alpha() < ours.alphaMin());
  // Within a tick of each other: the last tick moves a dot by a hair.
  for (let i = 0; i < 40; i++) assert.ok(Math.hypot(ours.nodes()[i].x - theirs.nodes()[i].x, ours.nodes()[i].y - theirs.nodes()[i].y) < 0.5);
});

import { seedAngles } from '../lib/galaxy.js';

test('Physics off starts everyone round you: each connection a slice as wide as their circle, the circle inside it', () => {
  // Invented people: Ana has a circle of three, the others none.
  const ids = ['ana', 'ben', 'cy', 'dee', 'a1', 'a2', 'a3'];
  const parentOf = new Map([['a1', 'ana'], ['a2', 'ana'], ['a3', 'ana']]);
  const at = seedAngles(ids, parentOf);
  assert.equal(at.size, ids.length);
  const turn = 2 * Math.PI;
  for (const a of at.values()) assert.ok(a >= -Math.PI / 2 && a < 1.5 * Math.PI);
  // Ana's slice is 4 of 7 of the circle; her circle sits within it, round her.
  const mine = ['a1', 'a2', 'a3'].map((k) => at.get(k));
  assert.ok(Math.max(...mine) - Math.min(...mine) < (4 / 7) * turn);
  for (const a of mine) assert.ok(Math.abs(a - at.get('ana')) < (2 / 7) * turn + 1e-9);
});

test('seedAngles copes with a loop and with someone whose connection isn\'t drawn', () => {
  const at = seedAngles(['x', 'y', 'z'], new Map([['x', 'y'], ['y', 'x'], ['z', 'gone']]));
  assert.equal(at.size, 3);
  for (const a of at.values()) assert.ok(Number.isFinite(a));
});
