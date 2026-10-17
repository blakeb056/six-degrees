// The Galaxy's view, as numbers, kept apart from the drawing so it can be tested
// (app/components/ForceGraph.js).

import { keyFor } from './separation.js';

/**
 * The same view in a box of a new size. It moves by half the change, at the
 * same zoom, so whatever was in the middle of the box is in the middle still.
 * Used for a window resized, and undone exactly by resizing it back. A panel
 * opening beside the map uses reframe, below, which moves nothing.
 */
export function recentre({ x, y, k }, from, to) {
  return { x: x + (to.width - from.width) / 2, y: y + (to.height - from.height) / 2, k };
}

/**
 * The same view after the Galaxy's box has changed: `from` and `to` are the box
 * on screen and the window it was in, { left, top, width, height, vw, vh }.
 *
 * A panel opening or closing beside the map (the window the same size) moves
 * nothing: every dot stays where it is on screen, and the panel covers or
 * uncovers the map's edge. The view moves only by however far the box's corner
 * moved, which for the Filters panel on the left is its whole width and for
 * Details on the right is nothing at all. Re-centring there (Blake, 2026-10-05:
 * "it shouldn't be moving my positions") slid the whole map half a panel over.
 *
 * A window resized keeps whatever was in the middle in the middle (recentre).
 */
export function reframe(t, from, to) {
  if (!from || !to) return t;
  if (from.vw !== to.vw || from.vh !== to.vh) return recentre(t, from, to);
  return { x: t.x + (from.left - to.left), y: t.y + (from.top - to.top), k: t.k };
}

/**
 * How many ticks a d3 force simulation takes to come to rest from `alpha`: d3's
 * own timer stops once alpha falls below alphaMin, and each tick moves alpha
 * `decay` of the way to its target.
 */
export function ticksToSettle(alpha, { min = 0.001, decay = 1 - Math.pow(0.001, 1 / 300), target = 0 } = {}) {
  if (!(alpha >= min)) return 0;
  if (target >= min || !(decay > 0)) return Infinity;
  return Math.ceil(Math.log((min - target) / (alpha - target)) / Math.log(1 - decay));
}

/**
 * Where everyone starts round you with Physics off, as an angle: so the map is
 * worth drawing before the forces have tidied it, and they have less to do.
 * The circle is shared out between your connections (and anyone else whose
 * connection isn't drawn), each a slice as wide as the people who hang off
 * them, and each slice shared out the same way among those people, so every
 * ring fills evenly all the way round. Neighbours are interleaved, rather than
 * in the order they came, so one ring's people don't all start on one side.
 * `parentOf` maps an id to the id it hangs off, as the Galaxy draws it.
 */
export function seedAngles(ids, parentOf) {
  const has = new Set(ids);
  const kids = new Map();
  for (const id of ids) {
    const p = parentOf.get(id);
    if (p == null || p === id || !has.has(p)) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(id);
  }
  const weight = new Map();
  const weigh = (id, seen = new Set()) => {
    if (weight.has(id)) return weight.get(id);
    seen.add(id);
    let w = 1;
    for (const k of kids.get(id) || []) if (!seen.has(k)) w += weigh(k, seen);
    weight.set(id, w);
    return w;
  };
  const spread = (list) => list.map((id, i) => [(i * 0.618034) % 1, id]).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
  const out = new Map();
  const place = (list, a0, a1) => {
    const total = list.reduce((sum, id) => sum + weigh(id), 0);
    let a = a0;
    for (const id of list) {
      const span = ((a1 - a0) * weigh(id)) / total;
      out.set(id, a + span / 2);
      const next = (kids.get(id) || []).filter((k) => !out.has(k));
      if (next.length) place(spread(next), a, a + span);
      a += span;
    }
  };
  const roots = ids.filter((id) => { const p = parentOf.get(id); return p == null || p === id || !has.has(p); });
  place(spread(roots), -Math.PI / 2, 1.5 * Math.PI);
  // Anyone only reachable round a loop: shared out on their own.
  const left = ids.filter((id) => !out.has(id));
  if (left.length) place(spread(left), -Math.PI / 2, 1.5 * Math.PI);
  return out;
}

// The Wi-Fi fan (Blake, 2026-10-12: "like a wifi symbol shape of all the
// degrees"): you at the bottom, and each degree an arc fanning upward over you,
// the 1st nearest. Angles are the Galaxy's own, in graph coordinates where y
// grows downward, so straight up is -π/2 and clockwise is a growing angle.

/** Straight up, as an angle. */
export const UP = -Math.PI / 2;
/** The whole circle, clockwise from straight up: a phone's still rings, and Degrees' bands. */
export const FULL_CIRCLE = Object.freeze([UP, UP + 2 * Math.PI]);
/** Half the fan: 75° either side of straight up, so the fan is 150° across. */
export const FAN_HALF = (75 * Math.PI) / 180;
/** The fan as a stretch of circle, left end to right end. */
export const fanSpan = (half = FAN_HALF) => [UP - half, UP + half];

/** How far an angle is from straight up, from -π to π: negative to the left. */
export function fromUp(a) {
  let d = (a - UP) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * An angle anywhere round you squeezed into the fan, keeping its order:
 * straight up stays up, and straight down goes to the fan's two ends. How a
 * map already drawn round you becomes the fan without anyone changing places
 * with their neighbours. fromFan opens it out again.
 */
export const toFan = (a, half = FAN_HALF) => UP + fromUp(a) * (half / Math.PI);
export const fromFan = (a, half = FAN_HALF) => UP + Math.max(-Math.PI, Math.min(Math.PI, fromUp(a) * (Math.PI / half)));

/** Is this angle inside the fan? With where to put it back if it isn't: the nearer end. */
export function fanEdge(a, half = FAN_HALF) {
  const d = fromUp(a);
  return Math.abs(d) <= half ? null : UP + Math.sign(d) * half;
}

/**
 * A d3 force that holds everyone inside the fan round `centre()` (you): a wall
 * at each edge. Anyone the other forces are about to carry past an edge stops
 * on it instead, at the distance from you they were going to; inside the fan
 * it does nothing, so the other forces still spread everyone along their arc.
 * A hard wall rather than a push, since the repulsion of everyone above, which
 * all the way round cancels out, presses the rings near you downward, and a
 * push as gentle as the others lost to it. It reads where the other forces are
 * sending each dot, so it must be the simulation's last force, and `decay` its
 * velocityDecay (d3's 0.4 unless set). You and a dragged dot are left alone.
 */
export function forceFan(centre, { half = FAN_HALF, decay = 0.4 } = {}) {
  const keep = 1 - decay;   // d3 moves each dot this much of its velocity, after every force
  let nodes = [];
  const force = () => {
    const { x: cx, y: cy } = centre();
    for (const n of nodes) {
      if (n.fx != null) continue;
      const dx = n.x + n.vx * keep - cx, dy = n.y + n.vy * keep - cy, r = Math.hypot(dx, dy);
      const to = r > 1 ? fanEdge(Math.atan2(dy, dx), half) : null;
      if (to == null) continue;
      n.vx = (cx + r * Math.cos(to) - n.x) / keep;
      n.vy = (cy + r * Math.sin(to) - n.y) / keep;
    }
  };
  force.initialize = (all) => { nodes = all; };
  return force;
}

/**
 * How far below the middle of the map you sit in the fan. Its outermost arc,
 * `outer` out from you, reaches that far up; you are at the bottom; so halfway
 * puts the whole fan in the middle of the map, where a fit puts it on screen.
 */
export const fanDrop = (outer) => outer / 2;

/**
 * An SVG path for a guide ring of radius `r` round (cx, cy): the whole circle,
 * or, with `half` under π, the arc that far either side of straight up, drawn
 * left to right over the top (the fan's guides, and the Shape tab's pictures).
 */
const round2 = (v) => Math.round(v * 100) / 100;

export function ringPath(r, { half = Math.PI, cx = 0, cy = 0 } = {}) {
  const n = round2;
  if (half >= Math.PI) {
    return `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}`;
  }
  const [a0, a1] = fanSpan(half);
  return `M${n(cx + r * Math.cos(a0))} ${n(cy + r * Math.sin(a0))}`
    + `A${n(r)} ${n(r)} 0 ${2 * half > Math.PI ? 1 : 0} 1 ${n(cx + r * Math.cos(a1))} ${n(cy + r * Math.sin(a1))}`;
}

/**
 * An SVG path for a band from `inner` to `outer` round (cx, cy), to fill: the
 * whole ring (drawn with fill-rule evenodd, so the middle stays empty), or in
 * the fan its stretch over you. Degrees' and the fan's bars.
 */
export function bandPath(inner, outer, { half = Math.PI, cx = 0, cy = 0 } = {}) {
  if (half >= Math.PI) return ringPath(outer, { cx, cy }) + ringPath(inner, { cx, cy });
  const n = round2;
  const [a0, a1] = fanSpan(half);
  const at = (r, a) => `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
  const large = 2 * half > Math.PI ? 1 : 0;
  return `M${at(outer, a0)}A${n(outer)} ${n(outer)} 0 ${large} 1 ${at(outer, a1)}`
    + `L${at(inner, a1)}A${n(inner)} ${n(inner)} 0 ${large} 0 ${at(inner, a0)}Z`;
}

// Degrees and the Wi-Fi fan, by degree alone (Blake, 2026-10-12: "its showing
// the fan but the connections are still showing the clusters extended outwards
// … i just want the visual to be the degrees build up from 1st to 6"): a band
// for each degree from you outward, the 1st to the 6th, with every tier
// together in it; a colour and a dot size for each degree; everyone spread
// evenly along their band; and no line pulling anyone out of it.

/** The six degrees, from you outward: a band and a guide for each, even before anyone is there. */
export const DEGREE_STEPS = Object.freeze([1, 2, 3, 4, 5, 6]);
const stepOf = (d) => Math.min(6, Math.max(1, Math.round(Number(d) || 1)));

/** What each degree is called on the map. */
export const degreeName = (d) => ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][stepOf(d)];

/** A dot's radius at each degree, before Node size: the same for everyone there, a little smaller each step out. */
export const DEGREE_DOTS = Object.freeze({ 1: 5, 2: 3, 3: 2.6, 4: 2.4, 5: 2.2, 6: 2 });
export const degreeDot = (d) => DEGREE_DOTS[stepOf(d)];

/** How many fit along a row of radius `r` over `span` radians, `cell` apart. */
const rowRoom = (r, cell, span) => Math.max(1, Math.floor((span * r) / cell));

/**
 * The six bands, from you outward. Each is as deep as the rows its people
 * need, at `cellOf(degree)` apart (a dot's width and a little room) along
 * `span` radians of circle: ten thousand people make a deep band, a hundred a
 * thin one. A degree nobody is at yet is a thin band of its own, `empty` deep,
 * so the six still read as six bars. Returns [{ degree, key, n, inner, outer, rows, cell }].
 */
export function degreeBands(counts, cellOf, opts = {}) {
  return stepBands(DEGREE_STEPS, counts, cellOf, opts).map((b) => ({ ...b, degree: b.key }));
}

/**
 * Bands for any steps from you outward, `keys` in order (degrees 1 to 6, or the
 * tiers S to D): degreeBands for whatever the map is banded by.
 * Returns [{ key, n, inner, outer, rows, cell }].
 */
export function stepBands(keys, counts, cellOf, { span = 2 * Math.PI, first = 64, gap = 30, empty = 8 } = {}) {
  const bands = [];
  let inner = first;
  for (const key of keys) {
    const n = counts[key] || 0;
    const cell = cellOf(key);
    let rows = 0;
    for (let room = 0; room < n; rows++) room += rowRoom(inner + (rows + 0.5) * cell, cell, span);
    const outer = inner + (n ? rows * cell : empty);
    bands.push({ key, n, inner, outer, rows, cell });
    inner = outer + gap;
  }
  return bands;
}

/**
 * Where each of a band's `n` people sits, over `span` ([from, to]): every row
 * takes its share by its length, everyone evenly spaced along their row, and
 * each row starts a little further round than the last so the rows never line
 * up into spokes. Returned in order round the band, from `from`: [{ r, a }].
 */
export function bandSlots(band, n, [from, to] = FULL_CIRCLE) {
  if (n <= 0) return [];
  const span = to - from;
  const radii = Array.from({ length: Math.max(1, band.rows) }, (_, j) => band.inner + (j + 0.5) * band.cell);
  const room = radii.map((r) => rowRoom(r, band.cell, span));
  const total = room.reduce((sum, x) => sum + x, 0);
  // Each row its share; the few left over to the rows nearest a whole one more.
  const exact = room.map((x) => (n * x) / total);
  const take = exact.map(Math.floor);
  const short = n - take.reduce((sum, x) => sum + x, 0);
  exact.map((x, j) => [x - take[j], j]).sort((p, q) => q[0] - p[0]).slice(0, short).forEach(([, j]) => { take[j] += 1; });
  const slots = [];
  radii.forEach((r, j) => {
    const start = 0.25 + 0.5 * ((j * 0.618034) % 1);
    for (let i = 0; i < take[j]; i++) slots.push({ r, a: from + ((i + start) / take[j]) * span });
  });
  return slots.sort((p, q) => p.a - q.a || p.r - q.r);
}

/** A fixed number for an id, the same every time: an order that knows nothing about tier or power. */
export function idOrder(id) {
  let h = 0x811c9dc5;
  const text = String(id);
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  // Mixed once more (MurmurHash3's last step): short ids alike but for one letter came out alike.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Everyone in Degrees and the fan: their degree's band (past the 6th counted
 * as the 6th) and their place along it. Someone who hangs off another
 * (`parentOf`) placed already, nearer you, is ordered by where that one sits,
 * so a circle's people sit together and nobody's pulled anywhere to make it
 * so; everyone else, and each circle within itself, in an order of their ids
 * (idOrder), never their tier: a network ranked by power, laid round in that
 * order, put the S tier all at one end. `people` are { id, degree }; `cellOf`,
 * `span` and the rest as degreeBands and bandSlots take them.
 * Returns { bands, at: Map(id → { r, a }) }.
 */
export function degreeLayout(people, parentOf, opts) {
  const { bands, at } = bandLayout(people, parentOf, { ...opts, keys: DEGREE_STEPS, keyOf: (p) => stepOf(p.step ?? p.degree) });
  return { bands: bands.map((b) => ({ ...b, degree: b.key })), at };
}

/** The tiers, from you outward, when the bands are by tier (Filters → Tiers on): S nearest. */
export const TIER_STEPS = Object.freeze(['S', 'A', 'B', 'C', 'D']);
/** Someone's tier as a band: no tier is with D, as everywhere else. */
export const tierStep = (t) => (TIER_STEPS.includes(t) ? t : 'D');
/** A dot's radius in each tier's band, before Node size: S biggest. */
export const TIER_DOTS = Object.freeze({ S: 5, A: 4, B: 3.4, C: 3, D: 2.6 });
export const tierDot = (t) => TIER_DOTS[tierStep(t)];

/**
 * What the bands of Degrees and the fan are, from Filters → Tiers (Blake,
 * 2026-10-15: "we could use the wifi fan for both tiers and also degrees"):
 * with the tiers on, a band for each tier, S nearest you; with them off, a band
 * for each degree, 1st nearest. `bandBy` is 'tier' or 'degree'.
 */
export function bandSteps(bandBy) {
  return bandBy === 'degree'
    ? { keys: DEGREE_STEPS, keyOf: (p) => stepOf(p.step ?? p.degree), dot: (p) => degreeDot(p.step ?? p.degree), name: degreeName }
    : { keys: TIER_STEPS, keyOf: (p) => tierStep(p.tier), dot: (p) => tierDot(p.tier), name: (t) => `${t} tier` };
}

/**
 * degreeLayout for any bands: `keys` the steps from you outward and `keyOf`
 * which one a person is in. Returns { bands, at: Map(id → { r, a }) }.
 */
export function bandLayout(people, parentOf, { cellOf, span = FULL_CIRCLE, keys, keyOf, ...sizes }) {
  const byStep = new Map(keys.map((k) => [k, []]));
  for (const p of people) (byStep.get(keyOf(p)) || byStep.get(keys[keys.length - 1])).push(p);
  const counts = Object.fromEntries([...byStep].map(([k, list]) => [k, list.length]));
  const bands = stepBands(keys, counts, cellOf, { span: span[1] - span[0], ...sizes });
  const at = new Map();
  for (const band of bands) {
    const list = byStep.get(band.key);
    const slots = bandSlots(band, list.length, span);
    list.map((p) => [at.get(parentOf.get(p.id))?.a ?? Infinity, idOrder(p.id), p])
      .sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] - y[0]))
      .forEach(([, , p], i) => at.set(p.id, slots[i]));
  }
  return { bands, at };
}

/**
 * How hard a line pulls the two it joins together: not at all for one that
 * isn't drawn (`none`), nor in Degrees and the fan, where a line pulling a
 * connection out to their circle is what made the clusters. Otherwise the
 * layout's own pull, `base` times the Link force slider, at most 1.
 */
export const linkPull = (link, { byDegree = false, base = 0.1, pull = 1 } = {}) => (link.none || byDegree ? 0 : Math.min(1, base * pull));

/**
 * Degrees and the fan draw no lines but the ones of the people in `keep` (the
 * one picked, the one pointed at): which of `links` those are, 1 or 0 each,
 * into `into` when it's the right length. A link's ends are ids or the nodes.
 * With `parentOf`, the chain back to you is drawn too: the line into each
 * person they came through, all the way to your connection and you.
 */
export function ownLines(links, keep, into = null, parentOf = null) {
  const out = into && into.length === links.length ? into : new Uint8Array(links.length);
  const ids = new Set([...keep].filter((id) => id != null));
  const up = chainUp(parentOf, ids);
  const idOf = (end) => (end && typeof end === 'object' ? end.id : end);
  for (let i = 0; i < links.length; i++) {
    const s = idOf(links[i].source), t = idOf(links[i].target);
    out[i] = ids.has(s) || ids.has(t) || (up.has(t) && !links[i].also) ? 1 : 0;
  }
  return out;
}

/** Everyone between `ids` and you along `parentOf`: who they came through, and who that one did, to six steps. */
export function chainUp(parentOf, ids) {
  const up = new Set();
  if (!parentOf) return up;
  for (const id of ids) {
    for (let p = parentOf.get(id), hops = 0; p != null && hops < 7 && !up.has(p); p = parentOf.get(p), hops++) up.add(p);
  }
  return up;
}

/**
 * Who each person on the Galaxy came through, and how far along the chain
 * they are (Blake, 2026-10-15: "the 3rd degree dots are not successfully
 * connecting to who they are connected to from the d1 ... it all needs to
 * chain"). You, then your connections, then their circles, then the circles
 * of the people in those you connected with, and so on: you → 1st → 2nd →
 * 3rd … to the 6th.
 *
 * A row came through: a 1st-degree row, whoever introduced them
 * (`unlocked_from_bridge_id`, lib/promote.js), and only while more than your
 * connections are drawn (`chained`), so your connections alone stay on you;
 * any other row, the one whose circle they sit in (`source_connection_id`),
 * else whoever introduced them. A chained scan's circle is 2nd degree in the
 * table (scanned from a bridge, who is a 1st-degree row since you connected),
 * and the 3rd step along the chain: its bridge came through one of yours.
 *
 * `rows` are the people drawn; `all`, every row on file whatever the filters.
 * An id is resolved to someone drawn by id, else by profile URL (the same
 * person drawn under another row, as when a duplicate was folded or a
 * connection re-imported), else up their own chain to the nearest one drawn,
 * so a hidden bridge doesn't cut their circle loose.
 *
 * Returns { parentOf: Map(id → drawn id), stepOf: Map(id → 1…6), none: Set(id) }:
 * `none` are past the 2nd step, not one of your connections, with nobody drawn
 * to hang off (the people a company scan finds): no line to you, which would
 * say you know them, and no pull.
 */
export function galaxyChain(rows = [], { all = [], chained = rows.some((r) => (r?.degree || 1) > 1), maxStep = 6 } = {}) {
  const idOf = (v) => (v == null ? null : String(v));
  const drawn = new Map();
  const drawnByKey = new Map();
  for (const r of rows) {
    const id = idOf(r?.id);
    if (id == null || drawn.has(id)) continue;
    drawn.set(id, r);
    const key = keyFor(r);
    if (!drawnByKey.has(key)) drawnByKey.set(key, r.id);
  }
  const known = new Map(drawn);
  for (const r of all || []) {
    const id = idOf(r?.id);
    if (id != null && !known.has(id)) known.set(id, r);
  }
  const cameThrough = (r) => {
    const degree = r.degree || 1;
    const via = degree === 1 ? (chained ? r.unlocked_from_bridge_id : null) : (r.source_connection_id ?? r.unlocked_from_bridge_id);
    const v = idOf(via);
    return v == null || v === idOf(r.id) ? null : v;
  };
  // Someone drawn for an id: that row, or the same person under another row.
  const resolve = (id) => {
    if (drawn.has(id)) return drawn.get(id).id;
    const row = known.get(id);
    return row ? drawnByKey.get(keyFor(row)) ?? null : null;
  };

  const stepMemo = new Map();
  const stepOfRow = (r, seen = new Set()) => {
    const id = idOf(r.id);
    if (stepMemo.has(id)) return stepMemo.get(id);
    const own = Math.min(r.degree || 1, 3);
    const via = cameThrough(r);
    let step = own;
    if (via != null && !seen.has(id)) {
      seen.add(id);
      const up = known.get(via);
      if (up && !seen.has(idOf(up.id))) step = stepOfRow(up, seen) + 1;
    }
    step = Math.max(1, Math.min(step, maxStep));
    stepMemo.set(id, step);
    return step;
  };

  const parentOf = new Map();
  const stepOf = new Map();
  const none = new Set();
  for (const [id, r] of drawn) {
    stepOf.set(r.id, stepOfRow(r));
    let via = cameThrough(r);
    let parent = null;
    const walked = new Set([id]);
    while (via != null && !walked.has(via) && walked.size <= 8) {
      walked.add(via);
      const hit = resolve(via);
      if (hit != null && idOf(hit) !== id) { parent = hit; break; }
      const up = known.get(via);
      via = up ? cameThrough(up) : null;
    }
    if (parent != null) parentOf.set(r.id, parent);
    else if ((r.degree || 1) > 1 && stepOf.get(r.id) >= 3) none.add(r.id);
  }
  // A loop (two people each through the other) is cut where it closes, so
  // walking up from anyone always reaches you.
  for (const id of parentOf.keys()) {
    const trail = new Set([id]);
    for (let p = parentOf.get(id); p != null; p = parentOf.get(p)) {
      if (trail.has(p)) { parentOf.delete(id); break; }
      trail.add(p);
    }
  }
  return { parentOf, stepOf, none };
}

/**
 * Network Circle's people by the degree the map draws them at: galaxyChain's
 * step, the 1st to the 6th, as the Galaxy colours and bands them. The chips
 * under the map and the Filters grid counted the degree each row was saved at,
 * so they could say "3rd 0" beside dots in the 3rd's colour (a circle scanned
 * from someone you met through one of your connections is saved at 2nd and
 * drawn at 3rd); counting, and picking who shows, both go by this now.
 *
 * `byDegree` is lib/degrees.js peopleByDegree; `all` every row on file, as the
 * Galaxy gives galaxyChain; `chained`, whether your connections who came
 * through a circle hang off it (galaxyChain's own rule: only while more than
 * your connections are drawn), so a step here is the step drawn.
 * Returns { 1: rows, …, 6: rows }.
 */
export function chainedDegrees(byDegree = {}, { all = [], chained } = {}) {
  const rows = [1, 2, 3].flatMap((d) => byDegree?.[d] || []);
  const { stepOf } = galaxyChain(rows, { all, ...(typeof chained === 'boolean' ? { chained } : {}) });
  const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) out[Math.max(1, Math.min(6, stepOf.get(r.id) ?? (r.degree || 1)))].push(r);
  return out;
}

/**
 * Physics off (Blake, 2026-10-05: "if the physics are off then the dots dont
 * move ... as its intense on a computer"): the layout is worked out without
 * drawing it, and drawn once where it comes to rest. The simulation's own timer
 * is stopped, and its ticks run in slices of `budget` ms (the first one now), so
 * the page never waits long; `done` runs once it is at rest. A big network,
 * where every tick is slow, cools faster so the whole of it takes about `total`
 * ms of work (never fewer than `least` ticks) rather than a busy core for half
 * a minute. Returns a function that stops it part-way, for a change that
 * starts it over.
 */
export function settle(sim, { done, budget = 30, total = 3000, least = 50, now = () => performance.now(), later = (f) => setTimeout(f, 0), max = 1000 } = {}) {
  sim.stop();
  const decay = sim.alphaDecay();
  let cancelled = false;
  let sped = false;
  let spent = 0;
  let left = Math.min(max, ticksToSettle(sim.alpha(), { min: sim.alphaMin(), decay, target: sim.alphaTarget() }));
  const unhurry = () => { if (sped) { sped = false; sim.alphaDecay(decay); } };
  const slice = () => {
    if (cancelled) return;
    const until = now() + budget;
    while (left > 0) {
      const t = now();
      sim.tick();
      left -= 1;
      const took = now() - t;
      spent += took;
      if (!sped && left > least && left * took > total - spent) {
        const n = Math.max(least, Math.floor((total - spent) / took));
        const a = sim.alpha(), min = sim.alphaMin() * 0.99, target = sim.alphaTarget();
        if (n < left && a > min && target < min) {
          sim.alphaDecay(1 - Math.pow((min - target) / (a - target), 1 / n));
          left = n;
          sped = true;
        }
      }
      if (now() >= until) break;
    }
    if (left > 0) { later(slice); return; }
    unhurry();
    done?.();
  };
  slice();
  return () => { cancelled = true; unhurry(); };
}
