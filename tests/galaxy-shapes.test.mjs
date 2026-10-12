import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceSimulation, forceRadial, forceManyBody } from 'd3';
import {
  UP, FULL_CIRCLE, FAN_HALF, fanSpan, fromUp, toFan, fromFan, fanEdge, fanDrop, ringPath, forceFan,
  DEGREE_STEPS, degreeName, degreeDot, degreeBands, bandSlots, degreeLayout, bandPath, linkPull, ownLines,
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

// Degrees and the fan by degree alone (Blake, 2026-10-12: "i just want the visual
// to be the degrees build up from 1st to 6"). Invented people only.
const cellOf = (d) => 2 * degreeDot(d) + 5;
const people = (counts) => Object.entries(counts).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => ({ id: `d${d}-${i}`, degree: Number(d), tier: 'SABCD'[i % 5] })));

test('six bands, 1st to 6th, from you outward, an empty degree a thin one', () => {
  assert.deepEqual(DEGREE_STEPS, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(DEGREE_STEPS.map(degreeName), ['1st', '2nd', '3rd', '4th', '5th', '6th']);
  const bands = degreeBands({ 1: 300, 2: 4000, 3: 60 }, cellOf);
  assert.deepEqual(bands.map((b) => b.degree), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < bands.length; i++) assert.ok(bands[i].inner > bands[i - 1].outer);   // in order, never overlapping
  for (const b of bands.slice(3)) { assert.equal(b.n, 0); near(b.outer - b.inner, 8); }
  // Sized by how many: four thousand make a deeper band than sixty.
  assert.ok(bands[1].outer - bands[1].inner > bands[2].outer - bands[2].inner);
  // Narrower, the fan's bands are deeper for the same people.
  const fan = degreeBands({ 1: 300, 2: 4000, 3: 60 }, cellOf, { span: 2 * FAN_HALF });
  assert.ok(fan[1].outer - fan[1].inner > bands[1].outer - bands[1].inner);
});

test('a dot size for each degree, a little smaller each step out; past the 6th is the 6th', () => {
  for (let d = 2; d <= 6; d++) assert.ok(degreeDot(d) < degreeDot(d - 1));
  assert.equal(degreeDot(9), degreeDot(6));
  assert.equal(degreeName(9), '6th');
});

test('one band per degree: every tier together in it, nobody in another degree\'s', () => {
  for (const span of [FULL_CIRCLE, fanSpan()]) {
    const crowd = people({ 1: 250, 2: 3000, 3: 80 });
    const { bands, at } = degreeLayout(crowd, new Map(), { cellOf, span });
    assert.equal(at.size, crowd.length);
    for (const p of crowd) {
      const band = bands[p.degree - 1], { r, a } = at.get(p.id);
      assert.ok(r >= band.inner && r <= band.outer, `${p.id} out of its band`);
      if (span !== FULL_CIRCLE) assert.equal(fanEdge(a), null);
    }
    // No tier sub-bands: each tier's people reach across the whole of the band.
    for (const tier of 'SD') {
      const radii = crowd.filter((p) => p.degree === 2 && p.tier === tier).map((p) => at.get(p.id).r);
      assert.ok(Math.min(...radii) - bands[1].inner < bands[1].cell && bands[1].outer - Math.max(...radii) < bands[1].cell);
    }
  }
});

test('everyone spread evenly along their band, with room for their dot', () => {
  for (const span of [FULL_CIRCLE, fanSpan()]) {
    const [band] = degreeBands({ 1: 500 }, cellOf, { span: span[1] - span[0] });
    const slots = bandSlots(band, 500, span);
    assert.equal(slots.length, 500);
    const rows = new Map();
    for (const s of slots) rows.set(s.r, [...(rows.get(s.r) || []), s.a]);
    for (const [r, angles] of rows) {
      angles.sort((x, y) => x - y);
      const gaps = angles.slice(1).map((a, i) => a - angles[i]);
      // Even: every gap along a row the same, and at least a dot's room apart.
      for (const gap of gaps) near(gap, gaps[0], 1e-9);
      if (gaps.length) assert.ok(gaps[0] * r >= band.cell - 1e-9);
    }
    for (const s of slots) assert.ok(s.a >= span[0] && s.a <= span[1]);
  }
});

test('a circle sits together, behind where its connection sits, pulled by nothing', () => {
  const crowd = [...people({ 1: 4 }), ...['d1-0', 'd1-3'].flatMap((via) => Array.from({ length: 30 }, (_, i) => ({ id: `${via}-k${i}`, degree: 2, via })))];
  const parentOf = new Map(crowd.filter((p) => p.via).map((p) => [p.id, p.via]));
  const { at } = degreeLayout(crowd, parentOf, { cellOf, span: fanSpan() });
  const angles = (via) => crowd.filter((p) => p.via === via).map((p) => at.get(p.id).a);
  // Whichever connection sits further round, their circle comes after the other's, all of it.
  const [first, second] = ['d1-0', 'd1-3'].sort((x, y) => at.get(x).a - at.get(y).a);
  assert.ok(Math.max(...angles(first)) < Math.min(...angles(second)));
});

test('ten thousand in the 2nd degree are laid out in a moment', () => {
  const crowd = people({ 1: 1000, 2: 10500, 3: 160 });
  const parentOf = new Map(crowd.filter((p) => p.degree === 2).map((p, i) => [p.id, `d1-${i % 90}`]));
  for (const span of [FULL_CIRCLE, fanSpan()]) {
    const t = performance.now();
    const { bands, at } = degreeLayout(crowd, parentOf, { cellOf, span });
    assert.ok(performance.now() - t < 500, 'under half a second');
    assert.equal(at.size, crowd.length);
    assert.equal(bands[1].n, 10500);
  }
});

test('by degree no line pulls: a connection is never dragged out to their circle', () => {
  assert.equal(linkPull({ source: 'a', target: 'b' }, { byDegree: true, base: 0.06, pull: 4 }), 0);
  assert.equal(linkPull({ none: true }, { base: 0.1, pull: 1 }), 0);
  assert.equal(linkPull({}, { base: 0.06, pull: 2 }), 0.12);
  assert.equal(linkPull({}, { base: 0.1, pull: 40 }), 1);
});

test('by degree only the picked and the pointed-at have their lines drawn', () => {
  const links = [{ source: 'you', target: 'a' }, { source: { id: 'a' }, target: { id: 'a1' } }, { source: 'b', target: 'b1' }, { source: 'you', target: 'b' }];
  assert.deepEqual([...ownLines(links, [null, null])], [0, 0, 0, 0]);
  assert.deepEqual([...ownLines(links, ['a', null])], [1, 1, 0, 0]);
  assert.deepEqual([...ownLines(links, ['a', 'b1'])], [1, 1, 1, 0]);
  const into = new Uint8Array(4);
  assert.equal(ownLines(links, ['b'], into), into);
});

test('a band as a bar: a whole ring round you, or its stretch over you in the fan', () => {
  assert.equal(bandPath(50, 60), ringPath(60) + ringPath(50));   // two circles, filled even-odd
  const bar = bandPath(50, 60, { half: FAN_HALF });
  assert.match(bar, /^M[-\d. ]+A60 60 0 0 1 [-\d. ]+L[-\d. ]+A50 50 0 0 0 [-\d. ]+Z$/);
});

test('a network ranked by power is not laid round by tier: the S tier is all along the band', () => {
  // 600 connections in the order a ranked list hands them over: every S first, then A, and so on.
  const ranked = 'SABCD'.split('').flatMap((tier) => Array.from({ length: 120 }, (_, i) => ({ id: `${tier}${i}`, degree: 1, tier })));
  const { bands, at } = degreeLayout(ranked, new Map(), { cellOf, span: fanSpan() });
  const [left, right] = fanSpan();
  for (const tier of 'SD') {
    const angles = ranked.filter((p) => p.tier === tier).map((p) => at.get(p.id).a);
    const middle = angles.reduce((a, b) => a + b, 0) / angles.length;
    near(middle, UP, (right - left) / 8);                                  // centred on the band, not at one end
    assert.ok(Math.min(...angles) - left < (right - left) / 10 && right - Math.max(...angles) < (right - left) / 10);
  }
  assert.equal(bands[0].n, 600);
});
