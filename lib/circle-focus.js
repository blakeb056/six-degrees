// Focus on one of your connections in Network Circle (Blake, 2026-10-16: "they
// click on a dot or hover over it for 3.5 secs and then it will gradually zoom
// in like an Apple feeling, and then show the network circle kind of blurred,
// and then show their circle with the scanned dots and also catalysts from them
// who's been scanned so it shows the full chain ... If they don't have anything
// scanned then it will be more subtle with the blur in place but showing just
// the core and telling them to scan the circle or making it easy to back out").
//
// Bridge Chains opens the same focus on a bridge (Blake, 2026-10-16: "I want
// the click UI/UX we added on the dots for Network Circle onto the bridge and
// make it just like that"): one implementation for both views.
//
// The numbers and the rules, kept apart from the drawing so they can be tested
// (app/components/CircleFocus.js draws what comes forward and runs the motion,
// for app/components/ForceGraph.js and app/components/ChainView.js). Plain
// maths, no React.

import { circleRings, MAX_DEGREE } from './circle.js';

/** How long the pointer rests on a dot before it opens. */
export const HOVER_HOLD = 3500;
/** The zoom in and back out, and the cross-fade that replaces both with Reduce Motion. */
export const FOCUS_IN_MS = 820;
export const FOCUS_OUT_MS = 560;
export const FADE_MS = 220;

/** Can this dot be opened: one of your own connections, never you (degree 0) nor anyone further out. */
export const canFocus = (node) => Boolean(node) && node.id != null && node.degree === 1;

/**
 * What comes forward for `person`: their circle, sharp, and the circles of the
 * people in it whose own circle was scanned (catalysts), chained outward ring
 * by ring (lib/circle.js circleRings, with `scanned`), so the whole chain reads
 * you, them, their people, the catalyst's people. `index` is circleIndex over
 * every row on file, built once, so a focus costs only the circle it shows.
 *
 * `trail` is who came before them along a chain, nearest you first: a bridge
 * in Bridge Chains you met through another bridge's circle (lib/chain-layout.js
 * clusterRings). Their rings are counted along it, so the circle of someone
 * met through a bridge is the 3rd degree, as the ring it sits on says, and
 * nobody on the trail is drawn in them. Network Circle has none.
 *
 * `kind` is 'circle' when anything round them is scanned, else 'core': just
 * the person, and the way to scan them.
 * Returns { kind, person, trail, rings, totals, catalysts: [{ row, degree, people }], circle, beyond },
 * or null with nobody to show.
 */
export function focusSubgraph(person, index, { isRequested, trail = [] } = {}) {
  if (!person || !index) return null;
  const before = (trail || []).filter(Boolean);
  const along = before.length;
  const found = circleRings(person, index, {
    scanned: true, maxDegree: MAX_DEGREE - along, skip: before, ...(isRequested ? { isRequested } : {}),
  });
  const rings = along ? found.rings.map((r) => ({ ...r, degree: r.degree + along })) : found.rings;
  const { totals } = found;
  // A catalyst is whoever has people hanging off them in the next ring out.
  const hanging = new Map();
  for (const ring of rings.slice(1)) for (const p of ring.people) hanging.set(p.parentId, (hanging.get(p.parentId) || 0) + 1);
  const catalysts = [];
  for (const ring of rings) {
    for (const p of ring.people) {
      if (hanging.has(p.row.id)) catalysts.push({ row: p.row, degree: ring.degree, people: hanging.get(p.row.id) });
    }
  }
  const circle = rings[0]?.people.length || 0;
  // The mutual web's people seen outside the scan (lib/mutual-web.js extendedNetwork):
  // drawn lighter, counted apart, and never taken for a scan. Their circle with only
  // those in it is still unscanned: the focus offers the scan as well.
  const outside = rings[0]?.people.filter((p) => p.row?.seen_outside).length || 0;
  return {
    kind: rings.length ? 'circle' : 'core', person, trail: before, rings, totals, catalysts, circle, beyond: totals.people - circle,
    outside, unscanned: rings.length > 0 && outside === circle,
  };
}

const TAU = Math.PI * 2;
const START = -Math.PI / 2;
/** An angle brought within half a turn of `near`, so two angles can be compared across the top. */
const wrapNear = (a, near) => a - TAU * Math.round((a - near) / TAU);

/**
 * Where every dot goes, in a square `size` wide, for focusSubgraph's rings.
 *
 * Their circle is the first ring, everyone an even share of it, with the
 * catalysts spread round it rather than side by side. Each ring further out is
 * made of the catalysts' circles, each fanned out behind its catalyst as wide
 * as its people need, neighbours nudged apart where two would overlap. A ring
 * too full for one row takes more, outward (the last inward), and its dots
 * shrink only once the room between rings is used up. Every ring shares one
 * spacing, `gap` px between dots at most `maxGap`, so its dots are one size.
 * (The card's small map, lib/circle.js circleLayout, shares the circle out by
 * reach instead: in a big square that crowded their own people into a sliver.)
 *
 * Returns { size, center, rings: [{ degree, radius, mid, edge, dotR, rows, items }], spokes }:
 * items are the ring's people with x, y and angle; spokes run from each
 * catalyst to the middle of their circle in the next ring.
 */
export function focusLayout(rings = [], size = 640, { minGap = 3, maxGap = 18 } = {}) {
  const half = size / 2;
  const R = rings.length;
  const out = { size, center: { x: half, y: half }, rings: [], spokes: [] };
  if (!R) return out;
  const first = R === 1 ? 0.5 : 0.3;
  const radiusOf = (k) => half * (R === 1 ? first : first + ((0.92 - first) * k) / (R - 1));
  // Rows go outward towards the next ring (the last ring inward, unless it's the only one).
  const band = (k) => {
    const r = radiusOf(k);
    if (k + 1 < R) return { dir: 1, depth: (radiusOf(k + 1) - r) * 0.5 };
    if (R === 1) return { dir: 1, depth: half * 0.96 - r };
    return { dir: -1, depth: (r - radiusOf(k - 1)) * 0.4 };
  };
  const at = new Map();   // row id → their angle, once placed
  const rows = [];
  for (let k = 0; k < R; k++) {
    const radius = radiusOf(k);
    const { dir, depth } = band(k);
    const leads = new Set((rings[k + 1]?.people || []).map((p) => p.parentId));
    // One group for their own circle; further out, a group behind each catalyst.
    const groups = [];
    const byParent = new Map();
    for (const p of rings[k].people) {
      let g = byParent.get(p.parentId);
      if (!g) {
        g = { parentId: p.parentId, members: [], centre: k === 0 ? START : at.get(p.parentId) ?? START, rows: 1 };
        byParent.set(p.parentId, g);
        groups.push(g);
      }
      g.members.push(p);
    }
    const whole = k === 0;
    const budget = TAU * (whole ? 1 : 0.94);
    const radiiOf = (gap, n) => Array.from({ length: n }, (_, j) => radius + dir * j * gap);
    const widthOf = (g, gap) => (g.members.length * gap) / radiiOf(gap, g.rows).reduce((sum, r) => sum + r, 0);
    // The widest spacing (the biggest dots) that fits, each group in as few rows as it can.
    const fits = (gap) => {
      const most = Math.max(1, Math.floor(depth / gap) + 1);
      for (const g of groups) g.rows = 1;
      for (;;) {
        const widths = groups.map((g) => widthOf(g, gap));
        if (widths.reduce((sum, w) => sum + w, 0) <= budget) return true;
        let widest = -1;
        groups.forEach((g, i) => { if (g.rows < most && (widest < 0 || widths[i] > widths[widest])) widest = i; });
        if (widest < 0) return false;
        groups[widest].rows++;
      }
    };
    let gap = maxGap;
    if (whole) {
      // Their own circle all the way round, its rows as far apart as its dots
      // are along them: `rows` rows `gap` apart hold 2π(rows·r + gap·rows(rows−1)/2)/gap,
      // so for n people gap = 2π·rows·r / (n − π·rows(rows−1)). As few rows as
      // give the biggest dots, never more than maxGap apart, and never so many
      // that each row is left thin.
      const n = groups[0].members.length;
      let best = null;
      for (let rows = 1; rows < 64; rows++) {
        const room = n - Math.PI * rows * (rows - 1);
        const g = Math.min(maxGap, room > 0 ? (TAU * rows * radius) / room : Infinity);
        if (rows > 1 && (rows - 1) * g > depth) break;
        const along = TAU * (rows * radius + (g * rows * (rows - 1)) / 2) / n;
        if (rows > 1 && along > 1.35 * g) break;
        if (!best || g > best.gap + 0.25) best = { rows, gap: g };
      }
      groups[0].rows = best.rows;
      gap = Math.max(minGap, best.gap);
    } else {
      while (gap > minGap && !fits(gap)) gap -= 0.5;
      if (gap <= minGap) { gap = minGap; fits(gap); }
    }
    for (const g of groups) g.width = whole ? TAU : Math.min(budget, widthOf(g, gap));
    // Catalysts' circles centred behind them; two that overlap pushed apart, keeping their order.
    if (groups.length > 1) {
      const pad = gap / radius;
      groups.sort((a, b) => wrapNear(a.centre, START + Math.PI) - wrapNear(b.centre, START + Math.PI));
      for (let pass = 0; pass < 80; pass++) {
        let moved = false;
        for (let i = 0; i < groups.length; i++) {
          const a = groups[i];
          const b = groups[(i + 1) % groups.length];
          const bc = wrapNear(b.centre, a.centre + Math.PI);
          const over = a.centre + a.width / 2 + pad - (bc - b.width / 2);
          if (over > 1e-6) { a.centre -= over / 2; b.centre += over / 2; moved = true; }
        }
        if (!moved) break;
      }
    }
    const items = [];
    for (const g of groups) {
      const n = g.members.length;
      const radii = radiiOf(gap, g.rows);
      const along = radii.reduce((sum, r) => sum + r, 0);
      // Each row its share by its length; the few left over to the rows nearest a whole one more.
      const exact = radii.map((r) => (n * r) / along);
      const take = exact.map(Math.floor);
      let left = n - take.reduce((sum, x) => sum + x, 0);
      exact.map((x, j) => [x - take[j], j]).sort((p, q) => q[0] - p[0]).forEach(([, j]) => { if (left-- > 0) take[j]++; });
      const from = whole ? START : g.centre - g.width / 2;
      const slots = [];
      radii.forEach((r, j) => {
        // A whole ring's rows each start half a step round from the last, so they don't line up in spokes.
        const turn = whole && j % 2 ? 0.5 : 0;
        for (let i = 0; i < take[j]; i++) slots.push({ r, row: j, angle: from + ((i + 0.5 + turn) * g.width) / take[j] });
      });
      let order = g.members;
      if (whole) {
        // Round from the top, the catalysts spaced evenly among everyone else.
        slots.sort((p, q) => p.angle - q.angle || p.row - q.row);
        const cats = g.members.filter((p) => leads.has(p.row.id));
        const rest = g.members.filter((p) => !leads.has(p.row.id));
        order = new Array(n);
        cats.forEach((p, j) => { order[Math.floor(((j + 0.5) * n) / cats.length)] = p; });
        let r = 0;
        for (let i = 0; i < n; i++) if (!order[i]) order[i] = rest[r++];
      } else {
        // The ring's order (catalysts first, then by power) from the line out of their catalyst.
        slots.sort((p, q) => Math.abs(p.angle - g.centre) - Math.abs(q.angle - g.centre) || p.row - q.row);
      }
      order.forEach((p, i) => {
        const slot = slots[i];
        items.push({ ...p, angle: slot.angle, x: half + slot.r * Math.cos(slot.angle), y: half + slot.r * Math.sin(slot.angle) });
        at.set(p.row.id, slot.angle);
      });
    }
    rows.push(groups);
    const deep = (Math.max(...groups.map((g) => g.rows)) - 1) * gap;
    out.rings.push({
      degree: rings[k].degree, radius, rows: Math.max(...groups.map((g) => g.rows)),
      // The middle of its rows, for a guide; and its outer edge, for its name.
      mid: radius + (dir * deep) / 2, edge: dir > 0 ? radius + deep : radius,
      dotR: Math.max(1.1, Math.min(gap * 0.36, size / 55)), items,
    });
  }
  // A spoke from each catalyst to the middle of their circle, one ring out.
  for (let k = 0; k + 1 < R; k++) {
    const next = new Map(rows[k + 1].map((g) => [g.parentId, g]));
    for (const it of out.rings[k].items) {
      const g = next.get(it.row.id);
      if (!g) continue;
      const r = out.rings[k + 1].radius;
      out.spokes.push({ x1: it.x, y1: it.y, x2: half + r * Math.cos(g.centre), y2: half + r * Math.sin(g.centre) });
    }
  }
  return out;
}

/**
 * How the map behind looks while it's open. A scanned circle: zoomed well in
 * and blurred, so the circle in front is all that reads. Just the core: a
 * lighter touch, the map still there behind. `blur` and `dim` are as seen on
 * screen. With Reduce Motion nothing zooms: a cross-fade instead.
 */
export function focusLook(kind, { reduced = false } = {}) {
  const look = kind === 'circle' ? { zoom: 2.4, blur: 9, dim: 0.5 } : { zoom: 1.6, blur: 4, dim: 0.32 };
  return reduced ? { ...look, zoom: 1 } : look;
}

const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * The map behind as a CSS transform on its layer: the dot at `origin` (px in
 * the map's box) scaled `zoom` times about itself and carried to the middle of
 * the box. Done on the layer the browser has already drawn, so ten thousand
 * dots cost one picture moved, not ten thousand moved every frame; and its
 * blur, `blur` px on screen, is set before the zoom scales it.
 * Returns { transformOrigin, transform, filter }.
 */
export function focusTransform(origin, box, { zoom = 1, blur = 0 } = {}) {
  const k = zoom > 0 ? zoom : 1;
  const dx = box.width / 2 - origin.x, dy = box.height / 2 - origin.y;
  return {
    transformOrigin: `${round(origin.x)}px ${round(origin.y)}px`,
    transform: k === 1 ? 'none' : `translate(${round(dx)}px, ${round(dy)}px) scale(${k})`,
    filter: `blur(${round(blur / k)}px) saturate(0.85)`,
  };
}

/** Where a point of the map lands under focusTransform: the origin goes to the middle of the box. */
export function focusPoint(p, origin, box, zoom) {
  return { x: box.width / 2 + (p.x - origin.x) * zoom, y: box.height / 2 + (p.y - origin.y) * zoom };
}

/** How long the move to `phase` takes: in to 'open', back out from it otherwise, or the cross-fade with Reduce Motion. */
export const focusDuration = ({ phase, reduced }) => (reduced ? FADE_MS : phase === 'open' ? FOCUS_IN_MS : FOCUS_OUT_MS);

/**
 * The style of the map behind a focus, whichever view it is: zoomed to their
 * dot and blurred while it's open ('open'), as it was before ('in', its first
 * frame) and while it goes ('out'). `focus` is { dot, phase, reduced, ease }.
 * The origin moves with the zoom, so moving the focus along a chain while it's
 * open glides the map from one dot to the next at the same zoom.
 */
export function focusLayer(focus, box, look) {
  const shown = focus.phase === 'open';
  const dur = focusDuration(focus);
  const t = focusTransform(focus.dot, box, look);
  return {
    // The map past the box's edge drawn too, or carrying a dot near the edge
    // to the middle shows where the <svg> stops; the box clips it as ever.
    overflow: 'visible',
    transformOrigin: t.transformOrigin,
    transform: shown && t.transform !== 'none' ? t.transform : 'translate(0px, 0px) scale(1)',
    filter: shown ? t.filter : 'blur(0px) saturate(1)',
    transition: ['transform', 'transform-origin', 'filter'].map((p) => `${p} ${dur}ms ${focus.ease}`).join(', '),
    willChange: 'transform, filter',
  };
}

/**
 * The ease of the zoom: a critically damped spring from 0 to 1 over t in 0…1,
 * quick off the mark and settling softly with no overshoot, as iOS moves a
 * view. `stiffness` sets how quickly it gets most of the way.
 */
export function spring(t, stiffness = 7.5) {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  const f = (x) => 1 - (1 + stiffness * x) * Math.exp(-stiffness * x);
  return f(t) / f(1);
}

/** The spring as a CSS easing, linear() through `steps` + 1 points. */
export function springEasing(steps = 24) {
  return `linear(${Array.from({ length: steps + 1 }, (_, i) => round(spring(i / steps), 4)).join(', ')})`;
}

/** Near the spring, for a browser without linear(): iOS's own curve. */
export const SPRING_FALLBACK = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * Resting on a dot, or a bridge: `hold` ms on the same one calls `fire(key)`.
 * Moving off it (stop with its key, or none) or onto another cancels; the
 * other starts its own wait. Moving within it (a bridge is a dot, its face and
 * its name) changes nothing. `later` and `cancel` are setTimeout and
 * clearTimeout unless given.
 */
export function hoverIntent(fire, { hold = HOVER_HOLD, later = setTimeout, cancel = clearTimeout } = {}) {
  let timer = null;
  let key = null;
  const clear = () => {
    if (timer != null) cancel(timer);
    timer = null;
    key = null;
  };
  return {
    /** Start waiting on `k`. False when already waiting on it. */
    start(k) {
      if (timer != null && k === key) return false;
      clear();
      key = k;
      timer = later(() => {
        const was = key;
        timer = null;
        key = null;
        fire(was);
      }, hold);
      return true;
    },
    /** Stop waiting: on `k` only, or on whoever with no key. */
    stop(k) {
      if (k === undefined || k === key) clear();
    },
    /** Who it's waiting on, or null. */
    get waiting() { return key; },
  };
}

/**
 * Scrolling out of it: a wheel turned towards you, or a trackpad pinch
 * closing, added up over a moment so a stray nudge doesn't close it. `state`
 * is { total, at } from the last wheel (or null); returns the next, with
 * `out` true once it's far enough. A scroll the other way starts the count again.
 */
export function wheelOut(state, { deltaY = 0, deltaMode = 0, ctrlKey = false }, now, { threshold = 60, quiet = 300 } = {}) {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1) * (ctrlKey ? 4 : 1);
  const fresh = !state || now - state.at > quiet || px <= 0;
  const total = px > 0 ? (fresh ? 0 : state.total) + px : 0;
  return { total, at: now, out: total >= threshold };
}

/** Two fingers drawn together far enough to close it: under `ratio` of where they started. */
export const pinchOut = (start, now, ratio = 0.8) => start > 0 && now > 0 && now < start * ratio;
