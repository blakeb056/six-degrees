// Network Circle at ten thousand dots (lib/galaxy-perf.js): a frame writes only
// what moved enough to see and what's on screen, and a filter change keeps
// everyone's place instead of starting the layout over. These pin the numbers;
// app/components/ForceGraph.js draws with them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG, coalesceMs, MOVE_PX, moveStep, viewOf, inView, lineInView, createPainter,
  placesKey, seedPlaces, warmStart, WARM_ALPHA, WARM_TICKS, coolingFor, createPlaces, snapshotPlaces,
  encodePlaces, decodePlaces, recallPlaces, rememberPlaces, PLACES_KEY, PLACES_STORED,
} from '../lib/galaxy-perf.js';

const box = { width: 1000, height: 600 };
const centred = { x: 500, y: 300, k: 1 };   // you in the middle of the box, as a map opens

// A painter over plain dots and links, recording what it writes.
function scene(dots, pairs = []) {
  const links = pairs.map(([s, t]) => ({ source: dots[s], target: dots[t] }));
  const wrote = { dots: [], lines: [] };
  const painter = createPainter({
    dots, links,
    drawDot: (i) => wrote.dots.push(i),
    drawLine: (j) => wrote.lines.push(j),
  });
  const pass = (opts) => { wrote.dots = []; wrote.lines = []; const r = painter.pass(opts); return { ...r, ...wrote }; };
  return { painter, pass, links };
}

// --- Level of detail and culling -------------------------------------------

test('a dot must move a quarter of a pixel on screen to be written again, more of the graph when zoomed out', () => {
  assert.equal(MOVE_PX, 0.25);
  assert.equal(moveStep(1), 0.25);
  assert.equal(moveStep(0.25), 1);       // zoomed out: a whole graph unit before it shows
  assert.equal(moveStep(4), 0.0625);     // zoomed in: almost every move shows
  assert.ok(moveStep(0.1) > moveStep(0.5) && moveStep(0.5) > moveStep(2));
  assert.ok(Number.isFinite(moveStep(0)) && Number.isFinite(moveStep(undefined)), 'a zoom of nothing is never a division by zero');
});

test('the view is the box under the zoom, in graph units, with room round it for a dot half on screen', () => {
  const v = viewOf(centred, box, { margin: 0, pad: 0 });
  assert.deepEqual(v, { x0: -500, y0: -300, x1: 500, y1: 300 });
  const zoomedIn = viewOf({ x: 500, y: 300, k: 2 }, box, { margin: 0, pad: 0 });
  assert.deepEqual(zoomedIn, { x0: -250, y0: -150, x1: 250, y1: 150 });
  const roomy = viewOf(centred, box);
  assert.ok(roomy.x0 < -500 && roomy.x1 > 500 && roomy.y0 < -300 && roomy.y1 > 300);
});

test('off screen is culled; a line is kept whenever it could cross the screen, even with both ends off it', () => {
  const v = viewOf(centred, box, { margin: 0, pad: 0 });
  assert.equal(inView(v, 0, 0), true);
  assert.equal(inView(v, 900, 0), false);
  assert.equal(lineInView(v, -900, 0, 900, 0), true, 'both ends off opposite edges, the line across the middle');
  assert.equal(lineInView(v, 600, -400, 900, -800), false, 'wholly past the top right corner');
  assert.equal(lineInView(v, 0, 0, 900, 900), true);
});

// --- The painter ------------------------------------------------------------

test('the first frame writes every dot and line, wherever they are', () => {
  const dots = [{ x: 0, y: 0 }, { x: 5000, y: 5000 }, { x: 10, y: 10 }];
  const { pass } = scene(dots, [[0, 1], [0, 2]]);
  const r = pass({ view: viewOf(centred, box), step: moveStep(1) });
  assert.deepEqual(r.dots, [0, 1, 2], 'even the one off screen, which would otherwise sit at you');
  assert.deepEqual(r.lines, [0, 1]);
});

test('a dot that moved less than the step is left as it is drawn; one that moved more is written', () => {
  const dots = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const { pass } = scene(dots, [[0, 1]]);
  pass({ view: viewOf(centred, box), step: moveStep(1) });
  dots[0].x += 0.1;   // under a quarter of a pixel
  dots[1].x += 3;
  const r = pass({ view: viewOf(centred, box), step: moveStep(1) });
  assert.deepEqual(r.dots, [1]);
  assert.deepEqual(r.lines, [0], 'the line follows the dot that moved');
  const still = pass({ view: viewOf(centred, box), step: moveStep(1) });
  assert.deepEqual([still.dots, still.lines], [[], []], 'nothing moved, nothing written');
});

test('zoomed out, the same small move is not written; zoomed in, it is', () => {
  const dots = [{ x: 0, y: 0 }];
  const { pass } = scene(dots);
  pass({ step: moveStep(1) });
  dots[0].x += 0.5;
  assert.deepEqual(pass({ step: moveStep(0.25) }).dots, []);
  assert.deepEqual(pass({ step: moveStep(4) }).dots, [0]);
});

test('off screen, a moving dot is not written until the view comes to it', () => {
  const dots = [{ x: 0, y: 0 }, { x: 3000, y: 0 }];
  const { painter, pass } = scene(dots);
  pass({ view: viewOf(centred, box), step: moveStep(1) });
  dots[1].x += 40;
  const r = pass({ view: viewOf(centred, box), step: moveStep(1) });
  assert.deepEqual(r.dots, []);
  assert.equal(r.left, 1);
  assert.equal(painter.stale, 1, 'so the view knows to write it when it moves');
  // Panned over to it: written where it is now.
  const there = pass({ view: viewOf({ x: -2540, y: 300, k: 1 }, box), step: moveStep(1) });
  assert.deepEqual(there.dots, [1]);
  assert.equal(painter.stale, 0);
});

test('a dot leaving the screen is written once more, so it does not stay drawn where it was', () => {
  const dots = [{ x: 400, y: 0 }];
  const { pass } = scene(dots);
  pass({ view: viewOf(centred, box), step: moveStep(1) });
  dots[0].x = 3000;
  assert.deepEqual(pass({ view: viewOf(centred, box), step: moveStep(1) }).dots, [0]);
});

test('`all` writes everything exactly, as once the map is at rest', () => {
  const dots = [{ x: 0, y: 0 }, { x: 3000, y: 0 }];
  const { painter, pass } = scene(dots, [[0, 1]]);
  pass({ view: viewOf(centred, box), step: moveStep(1) });
  dots[0].x += 0.01;
  dots[1].x += 50;
  const r = pass({ view: viewOf(centred, box), step: moveStep(1), all: true });
  assert.deepEqual(r.dots, [0, 1]);
  assert.deepEqual(r.lines, [0]);
  assert.equal(painter.stale, 0);
});

test('only the lines drawn are written, and a line brought back is written at once', () => {
  const dots = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const { painter, pass } = scene(dots, [[0, 1], [0, 2]]);
  assert.deepEqual(pass({ lines: [1] }).lines, [1]);
  dots[0].y = 50;
  assert.deepEqual(pass({ lines: [1], step: 0.25 }).lines, [1]);
  let wrote = 0;
  const p2 = createPainter({ dots, links: [{ source: dots[0], target: dots[1] }], drawDot: () => {}, drawLine: () => { wrote++; } });
  assert.equal(p2.line(0), 1);
  assert.equal(wrote, 1);
  assert.equal(painter.line(0), 1);
});

// --- Places: a filter change without a layout reset ------------------------

const node = (id, x, y, extra = {}) => ({ id, x, y, ...extra });

test('everyone the last scene drew keeps exactly their place', () => {
  const places = new Map([['a', [10, 20]], ['b', [-30, 40]]]);
  const nodes = [{ id: 'you', x: 0, y: 0 }, { id: 'a' }, { id: 'b' }];
  const r = seedPlaces(nodes, places, { fixed: 'you' });
  assert.deepEqual(r, { kept: 2, fresh: 0 });
  assert.deepEqual([nodes[1].x, nodes[1].y, nodes[1].vx, nodes[1].vy], [10, 20, 0, 0]);
  assert.deepEqual([nodes[2].x, nodes[2].y], [-30, 40]);
});

test('a newcomer starts on their own ring, at the angle of whoever they came through', () => {
  const places = new Map([['bridge', [100, 0]]]);
  const nodes = [{ id: 'you' }, { id: 'bridge' }, { id: 'new' }];
  const parentOf = new Map([['new', 'bridge']]);
  seedPlaces(nodes, places, { fixed: 'you', parentOf, ringOf: () => 500 });
  const n = nodes[2];
  assert.ok(Math.abs(Math.hypot(n.x, n.y) - 500) < 1e-9, 'on their ring');
  assert.ok(Math.abs(Math.atan2(n.y, n.x)) <= 0.15 + 1e-9, 'beside their bridge, not across the map');
});

test('a newcomer\'s own circle starts from where the newcomer was just placed', () => {
  const places = new Map([['bridge', [0, 100]]]);
  const nodes = [{ id: 'you' }, { id: 'grandchild' }, { id: 'child' }, { id: 'bridge' }];
  const parentOf = new Map([['child', 'bridge'], ['grandchild', 'child']]);
  seedPlaces(nodes, places, { fixed: 'you', parentOf, ringOf: (d) => (d.id === 'child' ? 300 : 600) });
  const [g, c] = [nodes[1], nodes[2]];
  assert.ok(Number.isFinite(g.x) && Number.isFinite(c.x));
  // Both up the top with the bridge (at 90°), within the jitter either side.
  assert.ok(Math.abs(Math.atan2(c.y, c.x) - Math.PI / 2) <= 0.15 + 1e-9);
  assert.ok(Math.abs(Math.atan2(g.y, g.x) - Math.PI / 2) <= 0.3 + 1e-9);
});

test('a kept place the new shape refuses is placed afresh; with none kept, d3 places everyone as always', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const r = seedPlaces(nodes, new Map([['a', [5, 5]], ['b', [900, 0]]]), { fits: (n, x) => x < 100 });
  assert.deepEqual(r, { kept: 1, fresh: 1 });
  const cold = [{ id: 'a' }];
  assert.deepEqual(seedPlaces(cold, new Map(), {}), { kept: 0, fresh: 1 });
  assert.equal(cold[0].x, undefined, 'left for d3, exactly as before');
});

test('how hard the forces start again after a filter change', () => {
  assert.deepEqual(warmStart({ kept: 0, total: 100 }), { alpha: 1, ticks: null }, 'nobody kept: from scratch, as always');
  assert.deepEqual(warmStart({ kept: 13000, total: 13000, alpha: 0 }), { alpha: 0, ticks: 0 }, 'a tier hidden: nobody moves at all');
  const few = warmStart({ kept: 9900, total: 10000, alpha: 0 });
  assert.equal(few.ticks, WARM_TICKS);
  assert.ok(Math.abs(few.alpha - (WARM_ALPHA + 0.01)) < 1e-9, 'just enough for the newcomers');
  assert.deepEqual(warmStart({ kept: 1000, total: 13000 }), { alpha: 1, ticks: null }, 'mostly newcomers: a fresh layout');
  assert.deepEqual(warmStart({ kept: 13000, total: 13000, alpha: 0.6 }), { alpha: 0.6, ticks: null }, 'still settling: it carries on as it was');
});

test('a warm start cools to rest in its ticks', () => {
  const decay = coolingFor(0.2, 100, 0.001);
  let a = 0.2;
  for (let i = 0; i < 100; i++) a += (0 - a) * decay;
  assert.ok(Math.abs(a - 0.001) < 1e-9);
  assert.equal(coolingFor(0, 0), 1, 'nothing to cool: at rest at once');
});

test('a filter change keeps the layout: hide a tier, show it again, and everyone is where they were', () => {
  const places = createPlaces();
  const key = placesKey({ shape: 'round' }, { layered: true });
  const all = Array.from({ length: 50 }, (_, i) => node(`p${i}`, i * 3, -i, { tier: i < 10 ? 'D' : 'A' }));
  places.put(key, snapshotPlaces([node('you', 0, 0), ...all], { fixed: 'you' }));
  // D hidden: the rest are kept, nobody new, so nothing moves.
  const rest = all.filter((n) => n.tier !== 'D').map((n) => ({ id: n.id, tier: n.tier }));
  const hid = seedPlaces(rest, places.get(key).at, {});
  assert.deepEqual(warmStart({ kept: hid.kept, total: rest.length, alpha: places.get(key).alpha }), { alpha: 0, ticks: 0 });
  assert.deepEqual(rest.map((n) => [n.x, n.y]), all.filter((n) => n.tier !== 'D').map((n) => [n.x, n.y]));
  // Kept again with only the rest on screen: the hidden ones keep their places too.
  places.put(key, snapshotPlaces(rest, { into: places.get(key).at }));
  const back = all.map((n) => ({ id: n.id }));
  const shown = seedPlaces(back, places.get(key).at, {});
  assert.deepEqual(shown, { kept: 50, fresh: 0 });
  assert.deepEqual(back.map((n) => [n.x, n.y]), all.map((n) => [n.x, n.y]));
});

test('places belong to a layout: another shape, other forces, or more than your connections is another key', () => {
  const base = placesKey({ shape: 'round', push: 15 }, { layered: false });
  assert.equal(placesKey({ shape: 'round', push: 15, colourBy: 'heat', names: 'all' }, { layered: false }), base, 'colours and names move nobody');
  assert.notEqual(placesKey({ shape: 'round', push: 6 }, { layered: false }), base);
  assert.notEqual(placesKey({ shape: 'round', push: 15 }, { layered: true }), base);
  assert.notEqual(placesKey({ shape: 'fan', bandBy: 'tier' }), placesKey({ shape: 'fan', bandBy: 'degree' }));
  assert.equal(placesKey({ shape: 'round', bandBy: 'tier' }), placesKey({ shape: 'round', bandBy: 'degree' }), 'Rings do not band');
});

test('the newest layouts are kept, the oldest dropped', () => {
  const places = createPlaces({ keep: 2 });
  places.put('a', { alpha: 0, at: new Map() });
  places.put('b', { alpha: 0, at: new Map() });
  places.put('a', { alpha: 0.5, at: new Map() });   // used again: newest
  places.put('c', { alpha: 0, at: new Map() });
  assert.deepEqual(places.entries().map(([k]) => k), ['a', 'c']);
  assert.equal(places.get('a').alpha, 0.5);
  assert.equal(places.get('b'), null);
});

test('you are never kept: you always start in the middle', () => {
  const e = snapshotPlaces([node('you', 7, 7), node('a', 1, 2), { id: 'b', x: NaN, y: 0 }], { fixed: 'you', alpha: 0.3 });
  assert.deepEqual([...e.at.keys()], ['a']);
  assert.equal(e.alpha, 0.3);
});

// --- Between visits ----------------------------------------------------------

function memoryStorage({ full = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    m,
  };
}

test('places are kept as ids and tenths, and read back the same', () => {
  const entry = { alpha: 0.25, at: new Map([['a', [1.234, -5.67]], ['b', [100, 200]]]) };
  const raw = encodePlaces('k', entry);
  assert.deepEqual(raw.xy, [12, -57, 1000, 2000]);
  const back = decodePlaces(JSON.parse(JSON.stringify(raw)));
  assert.equal(back.key, 'k');
  assert.deepEqual([...back.entry.at], [['a', [1.2, -5.7]], ['b', [100, 200]]]);
  assert.equal(back.entry.alpha, 0.25);
  assert.equal(decodePlaces({ v: 99 }), null);
  assert.equal(decodePlaces({ v: 1, key: 'k', ids: ['a'], xy: [1] }), null, 'a torn record is ignored');
});

test('a visit back starts from the places kept in this browser', () => {
  const storage = memoryStorage();
  const now = createPlaces();
  now.put('rings', { alpha: 0, at: new Map([['a', [1, 2]]]) });
  rememberPlaces(now, storage);
  const later = createPlaces();
  recallPlaces(later, storage);
  assert.deepEqual([...later.get('rings').at], [['a', [1, 2]]]);
});

test('only the newest few layouts are kept, and a big one never pushes a small one out', () => {
  const storage = memoryStorage();
  const places = createPlaces({ keep: 8 });
  for (let i = 0; i < PLACES_STORED + 2; i++) places.put(`k${i}`, { alpha: 0, at: new Map([[`id${i}`, [i, i]]]) });
  rememberPlaces(places, storage);
  const kept = JSON.parse(storage.getItem(PLACES_KEY)).map((r) => r.key);
  assert.equal(kept.length, PLACES_STORED);
  assert.equal(kept.at(-1), `k${PLACES_STORED + 1}`, 'newest last, as they are read back');
  // One too big to keep: left out, the small older one still kept.
  const big = createPlaces();
  big.put('small', { alpha: 0, at: new Map([['a', [0, 0]]]) });
  big.put('huge', { alpha: 0, at: new Map(Array.from({ length: 60000 }, (_, i) => [`some-long-person-id-${i}`, [i, i]])) });
  rememberPlaces(big, storage);
  assert.deepEqual(JSON.parse(storage.getItem(PLACES_KEY)).map((r) => r.key), ['small']);
});

test('a browser that says no keeps nothing and breaks nothing', () => {
  const storage = memoryStorage({ full: true });
  storage.m.set(PLACES_KEY, 'old');
  const places = createPlaces();
  places.put('a', { alpha: 0, at: new Map([['x', [1, 1]]]) });
  assert.doesNotThrow(() => rememberPlaces(places, storage));
  assert.equal(storage.getItem(PLACES_KEY), null);
  const unreadable = memoryStorage();
  unreadable.m.set(PLACES_KEY, '{not json');
  assert.doesNotThrow(() => recallPlaces(createPlaces(), unreadable));
});

// --- Coalescing a burst of taps ---------------------------------------------

test('a big map waits for a burst of taps to stop; a small one is drawn at once, as always', () => {
  assert.equal(coalesceMs(900), 0);
  assert.equal(coalesceMs(BIG - 1), 0);
  assert.ok(coalesceMs(BIG) > 0 && coalesceMs(13000) < 250, 'long enough to catch a second tap, short enough not to feel late');
});
