// Bridge Chains' overview, stacked from the middle out (lib/chain-layout.js
// bridgeGroups, stackRings, overviewRings; lib/reach.js notScannedYet).
//
// Blake, 2026-10-04: "we should have the inner most ring people who have new
// people to scan and accepted, the out s ring will just be more people in the
// ring then if that fills up too much another s ring or if not then have the
// unscanned bridges for s shown", and with every tier showing, "we need to have
// the rings separated by tier they cant be all together … in order to not
// distort and make the user have to zoom out to see the entirety". These pin
// the order of the rings, the gap between tiers, that each person is drawn
// once, and that 50, 500 or 1,500 people fit the window at the home zoom.
// Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeGroups, stackRings, overviewRings, previewBand, circleActivity } from '../lib/chain-layout.js';
import { reachIndex, notScannedYet } from '../lib/reach.js';
import { acceptedNote } from '../lib/notifications.js';

const people = (n, tier, p = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${p}-${tier}-${i}`, tier, name: `${p}${tier}${i}` }));
const radius = (pt) => Math.hypot(pt.x, pt.y);

// A network of `n` connections, in the shape the test networks have: about one
// in five with a scanned circle, tiers from S (few) to D (some).
function network(n) {
  const mix = { S: 0.08, A: 0.22, B: 0.27, C: 0.33, D: 0.1 };
  const bridges = [];
  const unscanned = [];
  for (const [t, share] of Object.entries(mix)) {
    const count = Math.max(1, Math.round(n * share));
    const b = Math.max(1, Math.round(count / 5));
    bridges.push(...people(b, t, 'b'));
    unscanned.push(...people(count - b, t, 'u'));
  }
  return { bridges, unscanned };
}

// The overview's room on a 1440×900 window (the map is 770 high: maxR 355),
// on a small laptop window, and on a phone.
const WINDOWS = { desktop: 355, laptop: 270, phone: 157 };

/** The home zoom the overview picks, and what reaches furthest at it: the rings, or a hovered circle's preview beyond them. */
function homeFit(layout, maxR) {
  const band = previewBand(maxR, layout.rings);
  const reachesTo = band.outer;
  const zoom = Math.max(0.6, Math.min(1.3, (maxR + 30) / (reachesTo + 8)));
  return { zoom, rings: layout.edge * zoom, preview: reachesTo * zoom, window: maxR + 30 };
}

test('from the middle out: circles with something new, then S (scanned, then not yet), then A, B, C, D', () => {
  const { bridges, unscanned } = network(300);
  const fresh = new Set([bridges.find((b) => b.tier === 'C').id, bridges.find((b) => b.tier === 'A').id]);
  const groups = bridgeGroups(bridges, unscanned, (b) => fresh.has(b.id));
  assert.deepEqual(groups.map((g) => g.key), [
    'new', 'S-bridges', 'S-unscanned', 'A-bridges', 'A-unscanned', 'B-bridges', 'B-unscanned',
    'C-bridges', 'C-unscanned', 'D-bridges', 'D-unscanned',
  ]);
  // The innermost ring keeps any tier, and its dots keep their own.
  assert.deepEqual(groups[0].rows.map((r) => r.tier).sort(), ['A', 'C']);

  const l = overviewRings(groups, WINDOWS.desktop);
  const span = (gi) => {
    const r = l.groups[gi].points.map(radius);
    return { lo: Math.min(...r), hi: Math.max(...r) };
  };
  for (let gi = 1; gi < groups.length; gi++) {
    assert.ok(span(gi).lo > span(gi - 1).hi, `${groups[gi].key} sits outside ${groups[gi - 1].key}`);
  }
  // A clear gap between tiers: wider than the step between two groups of one tier.
  const between = (a, b) => span(b).lo - span(a).hi;
  assert.ok(between(2, 3) > between(1, 2), 'S to A is a wider gap than S scanned to S not yet');
  assert.deepEqual(l.bands.map((b) => b.band), ['new', 'S', 'A', 'B', 'C', 'D']);
  for (let i = 1; i < l.bands.length; i++) assert.ok(l.bands[i].inner > l.bands[i - 1].outer);
});

test('each person once: a circle with something new is on the inner ring and not again in its tier', () => {
  const bridges = people(6, 'S', 'b');
  const unscanned = people(4, 'S', 'u');
  const groups = bridgeGroups([...bridges, bridges[0]], [...unscanned, unscanned[1]], (b) => b.id === bridges[2].id);
  const ids = groups.flatMap((g) => g.rows.map((r) => r.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(groups[0].rows.map((r) => r.id), [bridges[2].id]);
  assert.ok(!groups.find((g) => g.key === 'S-bridges').rows.some((r) => r.id === bridges[2].id));
  // No tier: with D, as everywhere else.
  assert.equal(bridgeGroups([{ id: 'x', tier: undefined }], [], () => false)[0].band, 'D');
  // Nobody at all: no groups, and an empty layout.
  assert.deepEqual(bridgeGroups([], [], () => false), []);
  assert.equal(overviewRings([], WINDOWS.desktop).rings.length, 0);
});

test('S scanned circles: one ring while they fit without crowding, another for the overflow', () => {
  const few = overviewRings(bridgeGroups(people(10, 'S'), [], () => false), WINDOWS.desktop);
  assert.equal(few.rings.length, 1, '10 on one ring');
  assert.equal(few.scale, 1);
  const more = overviewRings(bridgeGroups(people(30, 'S'), [], () => false), WINDOWS.desktop);
  assert.equal(more.rings.length, 2, '30: an inner ring and an outer one');
  assert.equal(more.scale, 1, 'at the spacing a name needs, not squeezed');
  // Neighbours on a ring keep the spacing a name under them needs.
  for (const ring of more.rings) assert.ok((2 * Math.PI * ring.radius) / ring.count >= 46 - 1e-9);
  // With nothing else to show and room for it, the S ring sits where the bridges always did.
  assert.ok(Math.abs(few.rings[0].radius - WINDOWS.desktop * 0.55) < 1e-9);
});

test('S only: the scanned circles, then the S connections not scanned yet, outside them', () => {
  const groups = bridgeGroups(people(40, 'S', 'b'), people(120, 'S', 'u'), () => false);
  const l = overviewRings(groups, WINDOWS.desktop);
  assert.deepEqual(groups.map((g) => g.key), ['S-bridges', 'S-unscanned']);
  const bridgeOuter = Math.max(...l.groups[0].points.map(radius));
  assert.ok(l.groups[1].points.every((p) => radius(p) > bridgeOuter));
  assert.ok(l.groups[1].dot < l.groups[0].dot, 'a smaller dot for someone not scanned yet');
  assert.equal(l.named, true, 'room for the names under the circles');
});

test('50, 500 and 1,500 people fit the window at the home zoom, preview and all', () => {
  for (const n of [50, 500, 1500]) {
    const { bridges, unscanned } = network(n);
    const groups = bridgeGroups(bridges, unscanned, (b) => b.id.endsWith('-0'));
    for (const [name, maxR] of Object.entries(WINDOWS)) {
      const l = overviewRings(groups, maxR);
      const placed = l.groups.reduce((a, g) => a + g.points.length, 0);
      assert.equal(placed, bridges.length + unscanned.length, `${n} on the ${name}: everyone has a place`);
      assert.ok(l.edge <= maxR * 0.86 + 1e-9, `${n} on the ${name}: the rings end at ${l.edge.toFixed(0)} of ${maxR}`);
      const fit = homeFit(l, maxR);
      assert.ok(fit.zoom >= 0.9, `${n} on the ${name}: home zoom ${fit.zoom.toFixed(2)}, no zooming out`);
      assert.ok(fit.preview <= fit.window, `${n} on the ${name}: a hovered circle's preview still fits`);
      // Dots shrink as the rings close up, never past touching.
      for (const g of l.groups) {
        assert.ok(g.dot * 2 <= Math.max(g.spacing, 2.4) + 1e-9, `${n} on the ${name}: dot ${g.dot} at spacing ${g.spacing}`);
        assert.ok(g.dot * 2 <= Math.max(g.step, 2.4) + 1e-9);
      }
    }
  }
});

test('more people close the rings up rather than grow the circle', () => {
  const edges = [50, 500, 1500].map((n) => {
    const { bridges, unscanned } = network(n);
    return overviewRings(bridgeGroups(bridges, unscanned, () => false), WINDOWS.desktop);
  });
  assert.ok(edges[0].scale >= edges[1].scale && edges[1].scale > edges[2].scale, edges.map((l) => l.scale.toFixed(2)).join(' '));
  assert.ok(Math.abs(edges[2].edge - edges[1].edge) < WINDOWS.desktop * 0.05, 'the same size of circle');
});

test('a small network keeps its dots big: a ring of a few people takes no more room than it needs', () => {
  const { bridges, unscanned } = network(50);
  const l = overviewRings(bridgeGroups(bridges, unscanned, () => false), WINDOWS.desktop);
  assert.ok(l.groups[0].dot >= 7, `a scanned circle's dot: ${l.groups[0].dot}`);
});

test('stackRings: starts further in, then reaches out, then closes up', () => {
  const g = (count) => [{ band: 'S', count, spacing: 20, step: 20 }];
  const roomy = stackRings(g(10), { inner: 100, innerMin: 40, outer: 150, outerMax: 200, gap: 10 });
  assert.equal(roomy.inner, 100);
  assert.equal(roomy.scale, 1);
  const moved = stackRings(g(120), { inner: 100, innerMin: 40, outer: 150, outerMax: 200, gap: 10 });
  assert.ok(moved.inner < 100 && moved.edge <= 150 && moved.scale === 1, 'moved in');
  const reached = stackRings(g(200), { inner: 100, innerMin: 40, outer: 150, outerMax: 260, gap: 10 });
  assert.ok(reached.edge > 150 && reached.edge <= 260 && reached.scale === 1, 'reached out');
  const closed = stackRings(g(2000), { inner: 100, innerMin: 40, outer: 150, outerMax: 200, gap: 10 });
  assert.ok(closed.scale < 1 && closed.edge <= 200, 'closed up');
  // Neighbours on a ring stay at least the spacing it settled on.
  for (const ring of closed.rings) assert.ok((2 * Math.PI * ring.radius) / ring.count >= 20 * closed.scale - 1e-9);
});

test('who counts as not scanned yet: your connections with no circle, minus what the scanner already read', () => {
  const url = (id) => `https://www.linkedin.com/in/${id}`;
  const d1 = (id, extra = {}) => ({ id, name: id, degree: 1, tier: 'A', power_score: 6, profile_url: url(id), ...extra });
  const jane = d1('jane', { tier: 'S', power_score: 9 });                         // scanned: a bridge
  const marcus = d1('marcus', { unlocked_from_bridge_id: 'jane', power_score: 3 }); // met through Jane, ready
  const nia = d1('nia');                                                            // list hidden
  const quin = d1('quin');                                                          // read, nobody new
  const ray = d1('ray', { power_score: 8 });                                        // to do
  const sol = d1('sol', { tier: 'S', power_score: 5 });                             // to do
  const degree2 = [{ id: 'tia@jane', degree: 2, source_connection_id: 'jane', profile_url: url('tia') }];
  const reach = reachIndex([jane, marcus, nia, quin, ray, sol], degree2, { skips: [{ profileUrl: url('nia') }], read: [url('quin')] });
  const { todo, hidden, read } = notScannedYet([jane, marcus, nia, quin, ray, sol], reach);
  assert.deepEqual(todo.map((r) => r.id), ['marcus', 'sol', 'ray'], 'met through a circle first, then by tier and score');
  assert.equal(hidden, 1);
  assert.equal(read, 1);
  assert.deepEqual(notScannedYet([], reach), { todo: [], hidden: 0, read: 0 });
});

test('an accepted request puts its circle on the inner ring until it is seen; people ready to scan keep it there', () => {
  assert.equal(acceptedNote({ type: 'added_back', title: 'Ada Park added you back' }), true);
  assert.equal(acceptedNote({ type: 'notice', title: 'Ada Park accepted!' }), true, 'the older wording');
  assert.equal(acceptedNote({ type: 'scan_done', title: 'Scan done: Ada Park’s circle' }), false);
  assert.equal(acceptedNote(null), false);

  const circles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const act = circleActivity(circles, {
    notes: [
      { circle: 'a', seen: false, accepted: true },
      { circle: 'b', seen: true, accepted: true },
      { circle: 'd', seen: false, accepted: false },
    ],
    ready: new Map([['c', 2]]),
  });
  assert.equal(act.get('a').fresh, true, 'an accepted request not seen yet');
  assert.equal(act.get('b').fresh, false, 'seen, and nobody ready: nothing new to act on');
  assert.equal(act.get('c').fresh, true, 'people ready to scan');
  assert.equal(act.get('d').fresh, false, 'a notification that isn’t an accepted request');
  // An accepted request counts once more than a plain notification does.
  assert.equal(act.get('a').score, 3);
  assert.equal(act.get('d').score, 2);
  assert.equal(act.get('a').newlyAccepted, 1);
});
