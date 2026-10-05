import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterDots, streamOffsets, CLUSTER_N, CLUSTER_TIERS } from '../lib/cluster-dots.js';

// Check for new's ↻ and the map's edge buttons draw the same cluster from here
// (app/components/ClusterSpinner.js, app/components/EdgeToggle.js).

test('a cluster is ten dots clockwise from twelve, in gold, purple and blue in turn', () => {
  const dots = clusterDots(30, 30, 24);
  assert.equal(dots.length, CLUSTER_N);
  assert.deepEqual(dots[0], { i: 0, x: 30, y: 6, tier: 'S' });                  // twelve o'clock
  assert.ok(dots[1].x > 30 && dots[1].y < 30, 'the next one is to the right: clockwise');
  assert.deepEqual(dots.map((d) => d.tier).slice(0, 4), ['S', 'A', 'B', 'S']);
  assert.deepEqual(CLUSTER_TIERS, ['S', 'A', 'B']);
  for (const d of dots) assert.ok(Math.abs(Math.hypot(d.x - 30, d.y - 30) - 24) < 0.01, `on the ring: ${d.x},${d.y}`);
});

test('its numbers are rounded where they are made, so the server and the browser agree (TRAPS §10)', () => {
  for (const d of clusterDots(7, 7, 14 * 0.42)) {
    assert.equal(d.x, Math.round(d.x * 1000) / 1000);
    assert.equal(d.y, Math.round(d.y * 1000) / 1000);
  }
});

test('opening a panel streams the dots onto the line of its edge, up and down in turn', () => {
  const dots = clusterDots(30, 30, 24);
  const moves = streamOffsets(dots, 22, 30);
  dots.forEach((d, i) => assert.ok(Math.abs(d.x + moves[i].dx - 22) < 0.01, 'every dot ends on the edge'));
  const ends = dots.map((d, i) => d.y + moves[i].dy);
  assert.ok(ends[0] < 30 && ends[1] > 30 && ends[2] < ends[0] && ends[3] > ends[1], `${ends}`);
});
