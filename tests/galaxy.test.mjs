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
