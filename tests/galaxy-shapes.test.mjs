import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceSimulation, forceRadial, forceManyBody } from 'd3';
import {
  UP, FULL_CIRCLE, FAN_HALF, fanSpan, fromUp, toFan, fromFan, fanEdge, fanDrop, ringPath, seedAngles, forceFan,
} from '../lib/galaxy.js';

// The Wi-Fi fan's geometry (Blake, 2026-10-12: "like a wifi symbol shape of all
// the degrees"). Angles are the Galaxy's: y grows downward, so straight up is -π/2.

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const DEG = Math.PI / 180;

test('the fan is 150° across, centred straight up', () => {
  near(UP, -Math.PI / 2);
  near(FAN_HALF, 75 * DEG);
  const [left, right] = fanSpan();
  near(right - left, 150 * DEG);
  near((left + right) / 2, UP);
  near(FULL_CIRCLE[1] - FULL_CIRCLE[0], 2 * Math.PI);
});

test('fromUp says how far an angle is from straight up, whichever way it is written', () => {
  near(fromUp(UP), 0);
  near(fromUp(0), Math.PI / 2);                 // to the right (east)
  near(fromUp(Math.PI), -Math.PI / 2);          // to the left (west)
  near(fromUp(UP + 2 * Math.PI + 0.1), 0.1);    // once round and a little
  near(Math.abs(fromUp(Math.PI / 2)), Math.PI); // straight down: as far as it goes
});

test('squeezing into the fan keeps everyone in order, inside it, and opens back out exactly', () => {
  const round = Array.from({ length: 36 }, (_, i) => UP - Math.PI + (i + 0.5) * (2 * Math.PI / 36));
  const fanned = round.map((a) => toFan(a));
  for (const a of fanned) assert.equal(fanEdge(a), null);   // all inside
  for (let i = 1; i < fanned.length; i++) assert.ok(fanned[i] > fanned[i - 1]);   // same order, left to right
  near(toFan(UP), UP);                                      // straight up stays up
  round.forEach((a, i) => near(fromUp(fromFan(fanned[i])), fromUp(a)));
  // Opening out never goes past straight down, even for a dot just outside an end.
  near(Math.abs(fromUp(fromFan(UP + FAN_HALF + 0.2))), Math.PI);
});

test('fanEdge: nothing to do inside the fan, the nearer end outside it', () => {
  assert.equal(fanEdge(UP), null);
  assert.equal(fanEdge(UP + FAN_HALF - 0.01), null);
  near(fanEdge(0), UP + FAN_HALF);              // east, below the right end
  near(fanEdge(Math.PI), UP - FAN_HALF);        // west, below the left end
  near(fanEdge(Math.PI / 2 - 0.1), UP + FAN_HALF);   // just right of straight down
});

test('you sit half the outermost ring below the middle, so the fan is centred', () => {
  assert.equal(fanDrop(590), 295);
  // The fan reaches from you, at drop, up to drop - outer: centred on 0.
  const outer = 590, drop = fanDrop(outer);
  near((drop + (drop - outer)) / 2, 0);
});

test('a guide is a whole circle round you, or in the fan its arc over you, left to right', () => {
  assert.equal(ringPath(100), 'M100 0A100 100 0 1 1 -100 0A100 100 0 1 1 100 0');
  assert.equal(ringPath(10, { cx: 12, cy: 12 }), 'M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12');
  const arc = ringPath(100, { half: FAN_HALF });
  const [, x0, y0, , , large, sweep, x1, y1] = arc.match(/^M(-?[\d.]+) (-?[\d.]+)A([\d.]+) ([\d.]+) 0 (\d) (\d) (-?[\d.]+) (-?[\d.]+)$/).map(Number);
  near(x0, 100 * Math.cos(UP - FAN_HALF), 0.01);
  near(y0, 100 * Math.sin(UP - FAN_HALF), 0.01);
  near(x1, -x0, 0.01);                          // the right end mirrors the left
  near(y1, y0, 0.01);
  assert.ok(y0 < 0);                            // both ends above you
  assert.equal(large, 0);                       // 150°: the short way, over the top
  assert.equal(sweep, 1);                       // clockwise on screen: left, up, right
});

test('Physics off in the fan: everyone starts inside it, each circle beside its connection', () => {
  const ids = ['a', 'b', 'c', 'a1', 'a2', 'a3', 'b1', 'x'];
  const parentOf = new Map([['a1', 'a'], ['a2', 'a'], ['a3', 'a'], ['b1', 'b'], ['x', 'gone']]);
  const at = seedAngles(ids, parentOf, fanSpan());
  assert.equal(at.size, ids.length);
  for (const a of at.values()) assert.equal(fanEdge(a), null);
  // A's circle sits in A's slice, and A's slice is the widest: four of the eight.
  const slice = (id) => ['1', '2', '3'].map((k) => at.get(id + k)).filter((v) => v != null);
  for (const a of slice('a')) assert.ok(Math.abs(a - at.get('a')) < FAN_HALF);
  // Without a span, the whole circle from straight up, as always.
  const round = seedAngles(ids, parentOf);
  for (const a of round.values()) assert.ok(a >= FULL_CIRCLE[0] && a < FULL_CIRCLE[1]);
});

test('the fan force brings a map drawn all round you into the fan, and leaves you where you are', () => {
  const you = { id: 'you', x: 0, y: 300, fx: 0, fy: 300 };
  const people = Array.from({ length: 120 }, (_, i) => {
    const a = (i / 120) * 2 * Math.PI, r = 150 + (i % 3) * 150;
    return { id: i, r, x: r * Math.cos(a), y: 300 + r * Math.sin(a) };
  });
  const sim = forceSimulation([you, ...people])
    .force('radial', forceRadial((d) => d.r || 0, 0, 300).strength(1.35))
    .force('charge', forceManyBody().strength(-6))
    .force('fan', forceFan(() => ({ x: 0, y: 300 })))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  assert.equal(you.x, 0);
  assert.equal(you.y, 300);
  // Everyone within a few degrees of the fan; nobody below you.
  for (const p of people) {
    const off = Math.abs(fromUp(Math.atan2(p.y - 300, p.x))) - FAN_HALF;
    assert.ok(off < 5 * DEG, `person ${p.id} is ${(off / DEG).toFixed(1)}° outside the fan`);
    assert.ok(p.y < 300);
  }
});
