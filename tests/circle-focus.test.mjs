// Focus on a connection in Network Circle (lib/circle-focus.js). Blake,
// 2026-10-16: a click, or the pointer resting 3.5 s on one of your connections,
// zooms in; their circle comes forward with every catalyst's circle chained on,
// or with nothing scanned, just them and the way to scan. Invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleIndex } from '../lib/circle.js';
import {
  HOVER_HOLD, canFocus, focusSubgraph, focusLayout, focusLook, focusTransform, focusPoint,
  spring, springEasing, hoverIntent, wheelOut, pinchOut,
} from '../lib/circle-focus.js';

const url = (id) => `https://www.linkedin.com/in/${id}`;
const d1 = (id, extra = {}) => ({ id, name: id, degree: 1, tier: 'A', power_score: 6, profile_url: url(id), ...extra });
const d2 = (id, via, extra = {}) => ({ id: `${id}@${via}`, name: id, degree: 2, tier: 'B', power_score: 4, profile_url: url(id), source_connection_id: via, ...extra });

// You → Ava (1st). Ava's circle: Bo, Cy and Ben. You connected with Ben from it
// and scanned him (a catalyst): Dee and Eli. Eli was scanned too without your
// connecting (his card's scan box, accepted): Fay. Gil is connected through Ava
// but never scanned. Hal is one of yours with nothing scanned at all.
function network() {
  const ava = d1('ava', { tier: 'S' });
  const ben = d1('ben', { unlocked_from_bridge_id: 'ava' });
  const gil = d1('gil', { unlocked_from_bridge_id: 'ava' });
  const hal = d1('hal');
  const eli = d2('eli', 'ben', { outreach_status: 'accepted' });
  const degree1 = [ava, ben, gil, hal];
  const degree2 = [d2('bo', 'ava'), d2('cy', 'ava', { tier: 'C' }), d2('dee', 'ben'), eli, d2('fay', eli.id)];
  return { ava, ben, gil, hal, eli, index: circleIndex(degree1, degree2) };
}

const names = (ring) => ring.people.map((p) => p.row.name);

test('a scanned circle comes forward with each catalyst chained outward: you → them → their people → the catalyst’s', () => {
  const { ava, index } = network();
  const f = focusSubgraph(ava, index);
  assert.equal(f.kind, 'circle');
  assert.deepEqual(f.rings.map((r) => r.degree), [2, 3, 4]);
  assert.deepEqual(names(f.rings[0]).sort(), ['ben', 'bo', 'cy', 'gil']);
  assert.deepEqual(names(f.rings[1]).sort(), ['dee', 'eli'], 'Ben’s circle hangs off Ben');
  assert.deepEqual(names(f.rings[2]), ['fay'], 'and a circle scanned from Ben’s, without connecting, still chains on');
  assert.ok(f.rings[1].people.every((p) => p.parentId === 'ben'));
  assert.deepEqual(f.catalysts.map((c) => [c.row.name, c.degree, c.people]), [['ben', 2, 2], ['eli', 3, 1]]);
  assert.equal(f.circle, 4);
  assert.equal(f.beyond, 3);
});

test('connected through them but never scanned is not a catalyst', () => {
  const { ava, index } = network();
  const f = focusSubgraph(ava, index);
  assert.ok(!f.catalysts.some((c) => c.row.name === 'gil'));
  const gil = f.rings[0].people.find((p) => p.row.name === 'gil');
  assert.equal(gil.state, 'connected', 'still shown as someone you added');
});

test('nothing scanned: just the core', () => {
  const { hal, index } = network();
  const f = focusSubgraph(hal, index);
  assert.equal(f.kind, 'core');
  assert.deepEqual(f.rings, []);
  assert.deepEqual(f.catalysts, []);
  assert.equal(f.circle, 0);
  assert.equal(focusSubgraph(null, index), null);
});

test('the focus layout chains each catalyst’s circle out behind them', () => {
  const { ava, index } = network();
  const lay = focusLayout(focusSubgraph(ava, index).rings, 640);
  assert.equal(lay.rings.length, 3);
  assert.equal(lay.spokes.length, 2, 'a line from Ben and from Eli to their circles');
  const ring = (k) => lay.rings[k].items;
  const ben = ring(0).find((it) => it.row.name === 'ben');
  const angle = (it) => Math.atan2(it.y - 320, it.x - 320);
  const apart = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const it of ring(1)) assert.ok(apart(angle(it), angle(ben)) < 0.3, `${it.row.name} sits behind Ben`);
  for (const r of lay.rings) for (const it of r.items) {
    assert.ok(Math.hypot(it.x - 320, it.y - 320) <= 320, 'inside the square');
  }
});

// A circle the size of the biggest ones on file, three catalysts, two of them
// with big circles of their own: nobody on top of anyone, catalysts spread out.
function crowd() {
  const p = d1('pia');
  const degree1 = [p];
  const degree2 = [];
  for (let i = 0; i < 900; i++) degree2.push(d2(`c${i}`, 'pia', { power_score: (i % 9) + 1 }));
  for (const [cat, n] of [['kai', 300], ['lu', 120], ['mo', 4]]) {
    degree1.push(d1(cat, { unlocked_from_bridge_id: 'pia' }));
    for (let i = 0; i < n; i++) degree2.push(d2(`${cat}${i}`, cat));
  }
  return focusSubgraph(p, circleIndex(degree1, degree2));
}

test('a big circle takes more rows rather than piling dots on each other', () => {
  const f = crowd();
  const lay = focusLayout(f.rings, 600);
  lay.rings.forEach((ring) => {
    const dots = ring.items;
    let close = 0;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        if (Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) < ring.dotR * 1.6) close++;
      }
    }
    assert.ok(close <= dots.length * 0.01, `ring ${ring.degree}: ${close} of ${dots.length} touching`);
  });
  assert.ok(lay.rings[0].rows > 1, '900 people take more than one row');
  assert.equal(lay.rings[0].items.length, 903);
  assert.equal(lay.rings[1].items.length, 424);
  // The three catalysts spread round the ring, never side by side.
  const cats = lay.rings[0].items.filter((it) => ['kai', 'lu', 'mo'].includes(it.row.name)).map((it) => Math.atan2(it.y - 300, it.x - 300)).sort((a, b) => a - b);
  for (let i = 0; i < cats.length; i++) {
    const gap = (cats[(i + 1) % cats.length] - cats[i] + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(gap > 1.5, 'about a third of the way round apart');
  }
});

test('nothing to lay out: an empty layout', () => {
  assert.deepEqual(focusLayout([], 400), { size: 400, center: { x: 200, y: 200 }, rings: [], spokes: [] });
});

test('only your own connections open', () => {
  assert.equal(canFocus({ id: 'a', degree: 1 }), true);
  assert.equal(canFocus({ id: '__center__', degree: 0 }), false, 'you');
  assert.equal(canFocus({ id: 'b', degree: 2 }), false);
  assert.equal(canFocus(null), false);
});

test('resting on a dot opens it after the hold; moving off cancels', () => {
  const timers = new Map();
  let next = 1;
  const later = (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; };
  const cancel = (id) => timers.delete(id);
  const run = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  const fired = [];
  const intent = hoverIntent((k) => fired.push(k), { later, cancel });

  assert.equal(intent.start('ava'), true);
  assert.equal([...timers.values()][0].ms, HOVER_HOLD);
  assert.equal(HOVER_HOLD, 3500);
  assert.equal(intent.start('ava'), false, 'still on the same dot: the wait goes on');
  assert.equal(timers.size, 1);
  intent.stop('ava');
  assert.equal(timers.size, 0, 'moving off cancels');
  run();
  assert.deepEqual(fired, []);

  intent.start('ava');
  intent.start('ben');
  assert.equal(timers.size, 1, 'onto another: the first is cancelled');
  intent.stop('ava');
  assert.equal(intent.waiting, 'ben', 'leaving a dot it isn’t waiting on changes nothing');
  run();
  assert.deepEqual(fired, ['ben']);
  assert.equal(intent.waiting, null);
});

test('the zoom carries their dot to the middle of the map', () => {
  const box = { width: 1000, height: 600 };
  const origin = { x: 700, y: 150 };
  assert.deepEqual(focusPoint(origin, origin, box, 2.4), { x: 500, y: 300 });
  const t = focusTransform(origin, box, { zoom: 2, blur: 8 });
  assert.equal(t.transformOrigin, '700px 150px');
  assert.equal(t.transform, 'translate(-200px, 150px) scale(2)');
  assert.equal(t.filter, 'blur(4px) saturate(0.85)', 'blurred before the zoom doubles it');
  assert.equal(focusTransform(origin, box, { zoom: 1, blur: 4 }).transform, 'none');
});

test('a scanned circle blurs the map more than just the core; Reduce Motion never zooms', () => {
  const circle = focusLook('circle');
  const core = focusLook('core');
  assert.ok(circle.blur > core.blur && circle.dim > core.dim && circle.zoom > core.zoom);
  assert.equal(focusLook('circle', { reduced: true }).zoom, 1);
});

test('the spring eases from 0 to 1 without overshoot', () => {
  assert.equal(spring(0), 0);
  assert.equal(spring(1), 1);
  let last = 0;
  for (let i = 1; i <= 100; i++) {
    const v = spring(i / 100);
    assert.ok(v >= last && v <= 1);
    last = v;
  }
  assert.ok(spring(0.3) > 0.6, 'most of the way early, as a spring is');
  const css = springEasing(10);
  assert.match(css, /^linear\(0, [\d., ]+, 1\)$/);
  assert.equal(css.split(',').length, 11);
});

test('scrolling or pinching out closes it; a nudge or a scroll in does not', () => {
  let s = wheelOut(null, { deltaY: 20 }, 0);
  assert.equal(s.out, false);
  s = wheelOut(s, { deltaY: 20 }, 50);
  assert.equal(s.out, false);
  s = wheelOut(s, { deltaY: 30 }, 100);
  assert.equal(s.out, true);
  assert.equal(wheelOut(wheelOut(null, { deltaY: 50 }, 0), { deltaY: 20 }, 900).out, false, 'a pause starts the count again');
  assert.equal(wheelOut(null, { deltaY: -500 }, 0).out, false, 'scrolling in');
  assert.equal(wheelOut(null, { deltaY: 20, ctrlKey: true }, 0).out, true, 'a trackpad pinch closing');
  assert.equal(wheelOut(null, { deltaY: 4, deltaMode: 1 }, 0).out, true, 'a mouse wheel counting lines');
  assert.equal(pinchOut(200, 150), true);
  assert.equal(pinchOut(200, 190), false);
  assert.equal(pinchOut(0, 10), false);
});
