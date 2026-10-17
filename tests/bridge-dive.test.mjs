// Bridge Chains goes one level deeper, and every circle it and Degrees draw
// sits in tier rings. Blake, 2026-10-17: "I want them to actually be able to
// click on the actual core, and it will bring them into the regular original
// layout where it's not blurred ... or they can scroll in even more", and, of
// Unscanned's one giant circle, "focus on the yellow, which is more priority,
// purple, and then blue and green, and the other ones don't really matter that
// much so they can be further out. With those dotted lines across the circle
// need to go." Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tierRings, TIER_RING } from '../lib/chain-layout.js';
import {
  focusStep, LEVELS, wheelIn, wheelOut, pinchIn, pinchOut, wheelGate, WHEEL_REST, youTether,
  diveDuration, DIVE_IN_MS, DIVE_OUT_MS, FADE_MS, focusLook,
} from '../lib/circle-focus.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const TIERS = ['S', 'A', 'B', 'C', 'D'];

// A circle of `n`, tiers mixed the way a real one is: few S, more of the rest.
function circle(n, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const weights = [0.12, 0.25, 0.22, 0.32, 0.09];
  return Array.from({ length: n }, (_, i) => {
    let r = rand();
    let t = 0;
    while (t < 4 && r > weights[t]) { r -= weights[t]; t++; }
    return { id: `p${i}`, name: `Person ${i}`, tier: TIERS[t] };
  });
}
const dist = (p) => Math.hypot(p.x, p.y);

// ── The tier-ring layout ─────────────────────────────────────────────────────

test('tier rings: S nearest the core, then A, B, C, and D furthest out', () => {
  const rows = circle(300);
  const l = tierRings(rows, { inner: 34, outer: 320, spacing: 34, maxDot: 11, labelRoom: 12 });
  assert.deepEqual(l.bands.map((b) => b.tier), TIERS);
  for (let i = 1; i < l.bands.length; i++) {
    const before = l.bands[i - 1];
    const here = l.bands[i];
    const farthestBefore = Math.max(...rows.map((r, j) => (r.tier === before.tier ? dist(l.points[j]) : 0)));
    const nearestHere = Math.min(...rows.map((r, j) => (r.tier === here.tier ? dist(l.points[j]) : Infinity)));
    assert.ok(nearestHere > farthestBefore, `every ${here.tier} sits further out than every ${before.tier}`);
  }
  // Each point says its tier, and the band counts add up.
  rows.forEach((r, j) => assert.equal(l.points[j].tier, r.tier));
  assert.equal(l.bands.reduce((a, b) => a + b.count, 0), rows.length);
});

test('tier rings: no tier goes with D, and an empty circle is an empty layout', () => {
  const l = tierRings([{ tier: 'S' }, { tier: undefined }, { tier: 'Z' }], { inner: 30, spacing: 30 });
  assert.deepEqual(l.bands.map((b) => [b.tier, b.count]), [['S', 1], ['D', 2]]);
  const none = tierRings([], { inner: 30, outer: 100, spacing: 30 });
  assert.deepEqual(none.points, []);
  assert.deepEqual(none.bands, []);
});

test('tier rings: S the biggest and strongest, D the smallest and most muted', () => {
  const l = tierRings(circle(200), { inner: 34, outer: 320, spacing: 34, maxDot: 11, labelRoom: 12 });
  const dots = l.bands.map((b) => b.dot);
  const fades = l.bands.map((b) => b.fade);
  for (let i = 1; i < dots.length; i++) {
    assert.ok(dots[i] < dots[i - 1], `${l.bands[i].tier} smaller than ${l.bands[i - 1].tier}: ${dots}`);
    assert.ok(fades[i] <= fades[i - 1]);
  }
  assert.equal(TIER_RING.S.fade, 1);
  assert.ok(TIER_RING.D.fade < 0.6, 'D is muted');
  assert.ok(l.bands[0].dot <= 11 + 1e-9, 'never past the biggest asked for');
});

test('tier rings: within a tier the first in the list sit nearest the core', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i, tier: 'A' }));
  const l = tierRings(rows, { inner: 30, outer: 400, spacing: 30 });
  for (let i = 1; i < rows.length; i++) assert.ok(dist(l.points[i]) >= dist(l.points[i - 1]) - 1e-6);
});

test('tier rings: no two dots overlap, small circle or a thousand', () => {
  for (const [n, outer] of [[17, 300], [154, 320], [1000, 330], [1000, 160]]) {
    const l = tierRings(circle(n, n), { inner: 34, outer, spacing: 34, maxDot: 11, labelRoom: 12 });
    const pts = l.points;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        assert.ok(d > pts[i].r + pts[j].r, `${n} in ${outer}: dots ${i} and ${j} touch (${d.toFixed(2)} apart)`);
      }
    }
    // Nor does any dot touch the core.
    for (const p of pts) assert.ok(dist(p) - p.r >= 34 - 1e-6);
  }
});

test('tier rings: the room before each band holds its letter, clear of every dot', () => {
  const rows = circle(400);
  const l = tierRings(rows, { inner: 34, outer: 330, spacing: 34, labelRoom: 12 });
  l.bands.forEach((b, i) => {
    const before = i ? l.bands[i - 1].outer + l.bands[i - 1].dot : 34;
    assert.ok(b.label > before && b.label < b.inner - b.dot, `${b.tier}'s letter between the bands`);
    assert.ok(b.inner - b.dot - before >= 12 - 1e-6, 'at least the room asked for');
  });
  // The top of each band's first ring, where its letter sits, falls between two dots.
  for (const b of l.bands) {
    const first = l.points.filter((p) => p.tier === b.tier && Math.abs(dist(p) - b.inner) < 1e-6);
    if (first.length < 2) continue;
    const step = (2 * Math.PI) / first.length;
    for (const p of first) {
      const off = Math.abs(Math.atan2(p.x, -p.y));   // 0 straight up
      assert.ok(off >= step / 2 - 1e-6, `${b.tier}: a dot at the very top`);
    }
  }
  // And the first of each band (a catalyst, say, with its name) sits round the bottom, well clear of it.
  for (const b of l.bands) {
    const at = rows.findIndex((r) => r.tier === b.tier);
    assert.ok(l.points[at].y > 0, `${b.tier}'s first is in the lower half`);
  }
});

test('tier rings: it fits the room by closing up, and past the least it carries on outward', () => {
  const rows = circle(1000);
  const roomy = tierRings(rows, { inner: 34, outer: 10000, spacing: 34 });
  assert.equal(roomy.scale, 1);
  const room = roomy.edge * 0.5;
  const tight = tierRings(rows, { inner: 34, outer: room, spacing: 34 });
  assert.ok(tight.scale < 1 && tight.scale >= 0.15);
  assert.ok(tight.edge <= room + 1e-6, `${tight.edge} inside ${room}`);
  const spill = tierRings(rows, { inner: 34, outer: 40, spacing: 34, minScale: 0.3 });
  assert.equal(spill.scale, 0.3);
  assert.ok(spill.edge > 40, 'rather than overlap');
});

test('tier rings: a thousand people lay out quickly enough to redo on every resize', () => {
  const rows = circle(1000);
  const t = performance.now();
  for (let i = 0; i < 10; i++) tierRings(rows, { inner: 34, outer: 300, spacing: 34, labelRoom: 12 });
  assert.ok((performance.now() - t) / 10 < 60);
});

// ── Overview → focus → dive, and back ────────────────────────────────────────

test('the levels: overview, focus, dive', () => {
  assert.deepEqual([...LEVELS], ['overview', 'focus', 'dive']);
});

test('in: the overview opens to the focus, and the focus dives by its core or a scroll in', () => {
  const can = { canDive: true };
  assert.equal(focusStep('overview', 'open', can), 'focus');
  assert.equal(focusStep('focus', 'core', can), 'dive');
  assert.equal(focusStep('focus', 'in', can), 'dive');
  // Nothing else opens anything.
  for (const e of ['core', 'in', 'out', 'back', 'outside']) assert.equal(focusStep('overview', e, can), 'overview');
  assert.equal(focusStep('dive', 'in', can), 'dive', 'scrolling in further zooms the dive, no level past it');
  assert.equal(focusStep('dive', 'core', can), 'dive', 'the core in the dive opens their card');
});

test('out: the dive comes back to the focus, never further in one go, and the focus to the overview', () => {
  const can = { canDive: true };
  for (const e of ['back', 'out']) {
    assert.equal(focusStep('dive', e, can), 'focus', `${e} from the dive`);
    assert.equal(focusStep('focus', e, can), 'overview', `${e} from the focus`);
  }
  assert.equal(focusStep('focus', 'outside', can), 'overview', 'a click on the map round the focus');
  assert.equal(focusStep('dive', 'outside', can), 'dive', 'the dive covers the map: nothing round it to click');
  // A walk: overview → focus → dive → focus → overview.
  let at = 'overview';
  const walk = ['open', 'core', 'back', 'back'].map((e) => (at = focusStep(at, e, can)));
  assert.deepEqual(walk, ['focus', 'dive', 'focus', 'overview']);
});

test('Network Circle, or a circle with nobody in it, never dives', () => {
  assert.equal(focusStep('focus', 'core'), 'focus');
  assert.equal(focusStep('focus', 'in', { canDive: false }), 'focus');
  assert.equal(focusStep('focus', 'out'), 'overview', 'and scrolling out still closes it, as it always has');
});

test('scrolling or pinching in dives; a nudge, or a scroll out, does not', () => {
  let s = wheelIn(null, { deltaY: -20 }, 0);
  assert.equal(s.in, false);
  s = wheelIn(s, { deltaY: -50 }, 60);
  assert.equal(s.in, true);
  assert.equal(wheelIn(wheelIn(null, { deltaY: -50 }, 0), { deltaY: -20 }, 900).in, false, 'a pause starts the count again');
  assert.equal(wheelIn(null, { deltaY: 500 }, 0).in, false, 'scrolling out');
  assert.equal(wheelIn(null, { deltaY: -20, ctrlKey: true }, 0).in, true, 'a trackpad pinch opening');
  assert.equal(wheelOut(null, { deltaY: -500 }, 0).out, false, 'and in never closes it');
  assert.equal(pinchIn(200, 260), true);
  assert.equal(pinchIn(200, 230), false);
  assert.equal(pinchIn(0, 10), false);
  assert.equal(pinchOut(200, 260), false);
});

test('the rest of a scroll that changed the level is let by; a fresh scroll after a pause goes on', () => {
  // A level changes at 1000; the trackpad's momentum runs on, 16 ms apart, for a second.
  let gate = { at: 1000, armed: false };
  for (let t = 1016; t < 2000; t += 16) {
    gate = wheelGate(gate, t);
    assert.equal(gate.pass, false, `momentum at ${t}`);
  }
  // A pause, then a fresh scroll: it counts, and so does the rest of it.
  gate = wheelGate(gate, 2000 + WHEEL_REST);
  assert.equal(gate.pass, true);
  assert.equal(wheelGate(gate, 2000 + WHEEL_REST + 16).pass, true);
  // Never changed: the first wheel counts.
  assert.equal(wheelGate(null, 5).pass, true);
});

test('the dive eases in and out on its own clock; Reduce Motion cross-fades', () => {
  assert.equal(diveDuration({ phase: 'open' }), DIVE_IN_MS);
  assert.equal(diveDuration({ phase: 'out' }), DIVE_OUT_MS);
  assert.equal(diveDuration({ phase: 'open', reduced: true }), FADE_MS);
  assert.ok(DIVE_OUT_MS < DIVE_IN_MS);
  // Diving, the map behind carries on in, under the cover; with Reduce Motion nothing zooms.
  const plain = focusLook('circle');
  const diving = focusLook('circle', { dive: true });
  assert.ok(diving.zoom > plain.zoom && diving.blur > plain.blur);
  assert.equal(focusLook('circle', { dive: true, reduced: true }).zoom, 1);
  assert.deepEqual(focusLook('circle'), { zoom: 2.4, blur: 9, dim: 0.5 }, 'Network Circle’s focus as it was');
});

// ── No dotted lines across the circle ────────────────────────────────────────

test('your line to the circle stops at its edge, never across it', () => {
  const half = 300;
  const edge = 260;
  for (const angle of [0, 1, 2.5, -2, Math.PI]) {
    const you = { x: half + (half + 2) * Math.cos(angle), y: half + (half + 2) * Math.sin(angle) };
    const l = youTether(you, half, edge);
    assert.ok(l, 'a line while you sit outside it');
    assert.equal(l.x1, you.x);
    assert.ok(Math.abs(Math.hypot(l.x2 - half, l.y2 - half) - edge) < 1e-9, 'it ends on the edge');
    // Every point along it is outside the circle.
    for (let t = 0; t <= 1; t += 0.05) {
      const x = l.x1 + (l.x2 - l.x1) * t;
      const y = l.y1 + (l.y2 - l.y1) * t;
      assert.ok(Math.hypot(x - half, y - half) >= edge - 1e-9);
    }
  }
  assert.equal(youTether({ x: 310, y: 300 }, 300, 260), null, 'nothing when you sit inside it');
});

// The part of a source file from `from` up to the next top-level function.
function section(src, from) {
  const at = src.indexOf(from);
  assert.ok(at >= 0, `${from} is there`);
  const next = src.indexOf('\nfunction ', at + from.length);
  const nextExport = src.indexOf('\nexport ', at + from.length);
  const ends = [next, nextExport].filter((i) => i > 0);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

test('nothing in the tier rings, the dive or Unscanned is drawn dotted', () => {
  const rings = read('app/components/TierRings.js');
  assert.doesNotMatch(rings, /strokeDasharray|stroke-dasharray/);
  const focus = read('app/components/CircleFocus.js');
  assert.doesNotMatch(section(focus, 'function CircleDive('), /strokeDasharray/);
  // In Bridge Chains (canDive) your line is the tether, solid; the dotted one is Network Circle's alone.
  const map = section(focus, 'function FocusMap(');
  assert.match(map, /canDive\s*\?\s*tether && <line [^>]*strokeLinecap="round"/);
  assert.doesNotMatch(map.match(/canDive\s*\?\s*tether && <line [^>]*\/>/)[0], /strokeDasharray/);
  // Someone seen outside the scan is lighter in Bridge Chains, not dotted.
  assert.match(section(focus, 'function Dot('), /if \(plain\) \{\s*return <circle [^>]*fillOpacity=\{0\.45\}/);
  const unscanned = read('app/components/UnscannedView.js');
  const overview = section(unscanned, 'function Overview(');
  assert.doesNotMatch(overview, /strokeDasharray/, 'no dotted ring on each dot, no dotted guides');
  assert.match(overview, /<TierDots /);
  // Building a circle: the guides where it forms are solid; the only dash left draws the next place's ring round (pathLength 1).
  const build = section(unscanned, 'function BuildCircle(');
  const dashes = build.match(/strokeDasharray=\S+/g) || [];
  assert.deepEqual(dashes, ['strokeDasharray="1'], `only the next place's ring: ${dashes}`);
  assert.match(build, /pathLength=\{1\} strokeDasharray="1 1"/);
});

test('one look: the dive, the focus on a circle seen outside the scan and Unscanned all draw TierRings', () => {
  const focus = read('app/components/CircleFocus.js');
  const unscanned = read('app/components/UnscannedView.js');
  const has = (src, re, what) => assert.ok(re.test(src), what);
  for (const [name, src] of [['the dive', section(focus, 'function CircleDive(')], ['the focus', section(focus, 'function FocusMap(')], ['Unscanned', section(unscanned, 'function Overview(')]]) {
    has(src, /tierRings\(|overviewLayout\(/, `${name} lays out in tier rings`);
    for (const part of ['TierBands', 'TierDots', 'TierLetters']) has(src, new RegExp(`<${part} `), `${name} draws ${part}`);
  }
  has(unscanned, /function overviewLayout\(list, maxR\) \{\s*return tierRings\(/, 'Unscanned’s overview is tier rings');
  has(section(unscanned, 'function BuildCircle('), /tierRings\(/, 'and a circle built there, once it settles');
  // Only Bridge Chains dives: Network Circle's focus is as it was.
  assert.match(read('app/components/ChainView.js'), /canDive dive=\{focus\.dive\} onStep=\{stepFocus\}/);
  assert.doesNotMatch(read('app/components/ForceGraph.js'), /canDive|onStep/);
});
