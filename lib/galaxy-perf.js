// Network Circle at ten thousand dots, as numbers kept apart from the drawing
// so they can be tested (app/components/ForceGraph.js).
//
// Blake, 2026-10-17: "as getting more dots it's getting a little laggy with 10k
// dots compared to 900 dots". Measured on an invented 13,761-dot network
// (headless Chrome): every frame while the map settled was about 60 ms of
// forces and 35 ms of writing every dot and line to the page, about 300 of
// them, so 40 seconds at 7 frames a second; and every filter change threw the
// layout away and did all of it again, 30 to 45 seconds a tap. Once settled,
// hovering and zooming were already smooth. So this is about the settling:
//
// - painting: a dot or line is written to the page only when it has moved a
//   visible amount at this zoom (MOVE_PX), and not while it is off screen,
//   where nobody sees it (createPainter);
// - places: everyone keeps their place when the filter changes and when you
//   come back, newcomers start beside whoever they came through, and the forces
//   settle the difference gently instead of starting over (seedPlaces,
//   warmStart), remembered in this browser between visits (rememberPlaces);
// - a burst of filter taps on a big map is drawn once (coalesceMs).
//
// The look is untouched: the same SVG, the same forces, the same settled shape.

/** A map this big coalesces filter taps (coalesceMs); smaller ones redraw at once, as always. */
export const BIG = 3000;

/** How long a big map waits for the taps to stop before it redraws, in ms; 0 for a small one. */
export const coalesceMs = (count) => (count >= BIG ? 140 : 0);

// ---------------------------------------------------------------------------
// Painting only what moved, and only what's on screen.

/** How far a dot must move on screen, in pixels, before it's written again. */
export const MOVE_PX = 0.25;

/**
 * MOVE_PX in graph units at zoom `k`: zoomed out, a dot has to move further
 * before the move shows, so fewer are written each frame; zoomed in, fewer
 * are skipped. Level of detail for movement.
 */
export const moveStep = (k) => MOVE_PX / Math.max(Number(k) || 1, 1e-3);

/**
 * The part of the graph on screen, in graph units: the box `{ width, height }`
 * under the zoom `t` (`{ x, y, k }`), with `margin` screen pixels round it and
 * `pad` graph units more for the biggest dot, so nothing half on screen is missed.
 */
export function viewOf(t, box, { margin = 64, pad = 48 } = {}) {
  const k = Math.max(Number(t?.k) || 1, 1e-3);
  return {
    x0: (-margin - t.x) / k - pad,
    y0: (-margin - t.y) / k - pad,
    x1: (box.width + margin - t.x) / k + pad,
    y1: (box.height + margin - t.y) / k + pad,
  };
}

/** Is the point on screen (`view` from viewOf)? */
export const inView = (v, x, y) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;

/**
 * Could the line from (x1, y1) to (x2, y2) cross the screen? Its bounding box
 * against the view: a line between two dots off opposite edges still crosses
 * it, so the ends alone don't decide. Never says no to a line that shows.
 */
export const lineInView = (v, x1, y1, x2, y2) => (
  Math.max(x1, x2) >= v.x0 && Math.min(x1, x2) <= v.x1 && Math.max(y1, y2) >= v.y0 && Math.min(y1, y2) <= v.y1
);

/**
 * What has been written to the page for each dot and line, so a frame writes
 * only what changed. `dots[i]` and `links[j]` are the scene's own: a dot has
 * `x`, `y`; a link's `source` and `target` are dots once the forces have
 * resolved them. `drawDot(i, x, y)` and `drawLine(j, x1, y1, x2, y2)` write one.
 *
 * pass({ view, step, lines, all }) writes every dot that has moved `step` or
 * more since it was written and is on screen, now or where it was drawn (so it
 * leaves the screen too); a dot never written yet is written wherever it is.
 * The same for the lines in `lines` (indices; every link when it's left out).
 * `all` writes everything exactly: once the map has settled, and after a jump.
 * Returns { drawn, left }: `left` dots and lines are off screen and out of date,
 * to be written when the view moves to them (`stale`).
 */
export function createPainter({ dots, links = [], drawDot, drawLine }) {
  const dx = new Float64Array(dots.length).fill(NaN);
  const dy = new Float64Array(dots.length).fill(NaN);
  const lp = new Float64Array(links.length * 4).fill(NaN);
  let stale = 0;

  const line = (j, all, view, step) => {
    const l = links[j];
    const x1 = l.source.x, y1 = l.source.y, x2 = l.target.x, y2 = l.target.y;
    const o = j * 4;
    const was = lp[o] === lp[o];
    if (!all && was && Math.abs(x1 - lp[o]) < step && Math.abs(y1 - lp[o + 1]) < step
      && Math.abs(x2 - lp[o + 2]) < step && Math.abs(y2 - lp[o + 3]) < step) return 0;
    if (!all && was && view && !lineInView(view, x1, y1, x2, y2) && !lineInView(view, lp[o], lp[o + 1], lp[o + 2], lp[o + 3])) return -1;
    lp[o] = x1; lp[o + 1] = y1; lp[o + 2] = x2; lp[o + 3] = y2;
    drawLine(j, x1, y1, x2, y2);
    return 1;
  };

  return {
    get stale() { return stale; },
    pass({ view = null, step = 0, lines = null, all = false } = {}) {
      let drawn = 0, left = 0;
      for (let i = 0; i < dots.length; i++) {
        const { x, y } = dots[i];
        const was = dx[i] === dx[i];
        if (!all && was && Math.abs(x - dx[i]) < step && Math.abs(y - dy[i]) < step) continue;
        if (!all && was && view && !inView(view, x, y) && !inView(view, dx[i], dy[i])) { left++; continue; }
        dx[i] = x; dy[i] = y;
        drawDot(i, x, y);
        drawn++;
      }
      const each = (j) => { const r = line(j, all, view, step); if (r > 0) drawn++; else if (r < 0) left++; };
      if (lines) for (const j of lines) each(j);
      else for (let j = 0; j < links.length; j++) each(j);
      stale = left;
      return { drawn, left };
    },
    /** One line written now, exactly, as when Filters → Lines or the replay brings it back. */
    line: (j) => line(j, true, null, 0),
  };
}

// ---------------------------------------------------------------------------
// Places: the layout kept across a filter change and between visits.

/**
 * What the places were worked out under: the shape and the forces, and
 * whether more than your connections were drawn (which moves every ring). Two
 * scenes with the same key can share places; any other can't.
 */
export function placesKey(lab = {}, { layered = false } = {}) {
  const byDegree = lab.shape === 'degrees' || lab.shape === 'fan';
  return [
    lab.shape || 'round', byDegree ? lab.bandBy || 'tier' : '', lab.sizeBy || 'power', lab.dotSize ?? 1,
    lab.gravity ?? 0, lab.rings ?? 1, lab.push ?? 15, lab.pull ?? 1, lab.distance ?? 1,
    layered ? 'layered' : 'one',
  ].join('|');
}

// A small, steady number from an id, for where a newcomer starts round its parent.
function idTurn(id) {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Everyone the last scene drew keeps their place (`places`, a Map of id →
 * [x, y]); everyone else starts beside whoever they came through, on their
 * own ring when `ringOf` gives one, rather than in d3's spiral at the middle,
 * which is what made a filter change look like the map starting over.
 *
 * `nodes` are the scene's; `fixed` is an id that stays where it is (you).
 * `parentOf` maps an id to the id they hang off; `centre` is where you are;
 * `fits(n, x, y)`, when given, can refuse a kept place that is wrong for the
 * new shape (a ring that moved), so that person is placed afresh.
 * Writes x, y (and zero velocity) on the nodes; returns { kept, fresh }.
 */
export function seedPlaces(nodes, places, { parentOf = new Map(), centre = { x: 0, y: 0 }, ringOf = null, fits = null, fixed = null } = {}) {
  let kept = 0;
  const fresh = [];
  const byId = new Map();
  for (const n of nodes) {
    byId.set(n.id, n);
    if (n.id === fixed) continue;
    const at = places?.get(n.id);
    if (at && Number.isFinite(at[0]) && Number.isFinite(at[1]) && (!fits || fits(n, at[0], at[1]))) {
      n.x = at[0]; n.y = at[1]; n.vx = 0; n.vy = 0;
      kept++;
    } else fresh.push(n);
  }
  if (!kept) return { kept: 0, fresh: fresh.length };
  // Parents first: someone placed now can be the place their own circle starts from.
  const isFresh = new Set(fresh);
  const placed = new Set();
  for (const n of nodes) if (!isFresh.has(n)) placed.add(n.id);
  const depth = (n) => { let d = 0; for (let p = parentOf.get(n.id); p != null && d < 8; p = parentOf.get(p)) d++; return d; };
  const order = fresh.map((n) => [depth(n), n]).sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  for (const n of order) {
    const p = byId.get(parentOf.get(n.id));
    const turn = idTurn(n.id);
    let a, r;
    if (p && placed.has(p.id) && Number.isFinite(p.x)) {
      const px = p.x - centre.x, py = p.y - centre.y;
      a = Math.atan2(py, px) + (turn - 0.5) * 0.3;
      r = ringOf ? ringOf(n) : Math.hypot(px, py) + 30;
    } else {
      a = turn * 2 * Math.PI;
      r = ringOf ? ringOf(n) : null;
    }
    if (r == null || !Number.isFinite(r)) continue;   // nowhere to put them: d3 places them, as it always has
    n.x = centre.x + r * Math.cos(a);
    n.y = centre.y + r * Math.sin(a);
    n.vx = 0; n.vy = 0;
    placed.add(n.id);
  }
  return { kept, fresh: fresh.length };
}

/** The least the forces start again with, so the gap a filter leaves still closes. */
export const WARM_ALPHA = 0.05;
/** Below this the forces have stopped, as d3's alphaMin. */
export const SETTLED_ALPHA = 0.001;
/** Ticks a warm start takes to rest; d3's own is 300. */
export const WARM_TICKS = 100;

/**
 * How hard the forces start again after a rebuild. Nobody kept: from scratch,
 * as always (alpha 1, the shape's own cooling: `ticks` null). Mostly
 * newcomers (half or more): the same, with the kept ones' places as a start.
 * Nobody new and the last scene at rest (a tier or degree hidden): no forces
 * at all, everyone stays put (alpha 0, `ticks` 0). The last scene still
 * settling: it carries on from its alpha with the shape's own cooling.
 * Otherwise a warm start: WARM_ALPHA plus the share of newcomers, cooling to
 * rest in WARM_TICKS ticks.
 */
export function warmStart({ kept = 0, total = 0, alpha = 0 } = {}) {
  if (!kept || !total) return { alpha: 1, ticks: null };
  const share = Math.max(0, total - kept) / total;
  if (share >= 0.5) return { alpha: 1, ticks: null };
  const was = Math.min(1, Number(alpha) || 0);
  // Nobody new, and they were at rest: everyone stays exactly where they are.
  if (share === 0 && was < SETTLED_ALPHA) return { alpha: 0, ticks: 0 };
  const need = WARM_ALPHA + share;
  // Still settling when it was rebuilt (taps while it settles): it carries on as it was going, never faster.
  if (was >= need) return { alpha: was, ticks: null };
  return { alpha: need, ticks: WARM_TICKS };
}


/** The alpha decay that takes `alpha` to `min` in `ticks` ticks, as d3 counts them. */
export const coolingFor = (alpha, ticks, min = 0.001) => (alpha > min && ticks > 0 ? 1 - Math.pow(min / alpha, 1 / ticks) : 1);

/**
 * The places of every layout seen this visit, by placesKey, newest last, at
 * most `keep` of them. Each is { alpha, at: Map(id → [x, y]) }: `alpha` is
 * how far from settled they were when kept (0 settled).
 */
export function createPlaces({ keep = 6 } = {}) {
  const all = new Map();
  return {
    get: (key) => all.get(key) ?? null,
    put(key, entry) {
      all.delete(key);
      all.set(key, entry);
      while (all.size > keep) all.delete(all.keys().next().value);
    },
    entries: () => [...all.entries()],
    clear: () => all.clear(),
  };
}

/**
 * A scene's nodes as an entry for createPlaces, leaving out `fixed` (you).
 * `into`, the layout's places so far: whoever this scene didn't draw keeps
 * theirs, so a tier hidden and shown again comes back where it was.
 */
export function snapshotPlaces(nodes, { alpha = 0, fixed = null, into = null } = {}) {
  const at = new Map(into || []);
  for (const n of nodes) if (n.id !== fixed && Number.isFinite(n.x) && Number.isFinite(n.y)) at.set(n.id, [n.x, n.y]);
  return { alpha: Number(alpha) || 0, at };
}

// Between visits: the newest layouts' places, in this browser only.
export const PLACES_KEY = 'six-degrees-galaxy-places';
const PLACES_VERSION = 1;
/**
 * Layouts kept between visits, newest first, and how much of the browser's
 * storage they may take, in characters (a 13,000-dot layout is 400,000 to
 * 700,000), so the storage never fills: a layout that doesn't fit is left
 * out and a smaller, older one (your connections alone, say) still kept.
 */
export const PLACES_STORED = 4;
export const PLACES_CHARS = 1500000;

/** Places as text for storage: ids, and positions to a tenth of a unit. */
export function encodePlaces(key, entry) {
  const ids = [];
  const xy = [];
  for (const [id, [x, y]] of entry.at) { ids.push(id); xy.push(Math.round(x * 10), Math.round(y * 10)); }
  return { v: PLACES_VERSION, key, alpha: Math.round((entry.alpha || 0) * 1000) / 1000, ids, xy };
}

/** encodePlaces read back, or null for anything else. */
export function decodePlaces(raw) {
  if (!raw || raw.v !== PLACES_VERSION || typeof raw.key !== 'string' || !Array.isArray(raw.ids) || !Array.isArray(raw.xy)) return null;
  if (raw.xy.length !== raw.ids.length * 2) return null;
  const at = new Map();
  raw.ids.forEach((id, i) => {
    const x = raw.xy[2 * i] / 10, y = raw.xy[2 * i + 1] / 10;
    if (Number.isFinite(x) && Number.isFinite(y)) at.set(id, [x, y]);
  });
  return { key: raw.key, entry: { alpha: Number(raw.alpha) || 0, at } };
}

const browserStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** The places kept between visits, into `places` (createPlaces), oldest first. */
export function recallPlaces(places, storage = browserStorage()) {
  try {
    const list = JSON.parse(storage?.getItem(PLACES_KEY) || '[]');
    for (const raw of Array.isArray(list) ? list : []) {
      const got = decodePlaces(raw);
      if (got && !places.get(got.key)) places.put(got.key, got.entry);
    }
  } catch { /* nothing kept, or unreadable: the map settles as it always has */ }
}

/**
 * The newest PLACES_STORED layouts of `places` that fit in PLACES_CHARS,
 * kept in this browser. If the browser says no, nothing is kept: the map
 * then settles as it always has.
 */
export function rememberPlaces(places, storage = browserStorage()) {
  const kept = [];
  let size = 2;
  for (const [key, e] of places.entries().reverse()) {
    if (kept.length >= PLACES_STORED) break;
    const text = JSON.stringify(encodePlaces(key, e));
    if (size + text.length + 1 > PLACES_CHARS) continue;
    size += text.length + 1;
    kept.unshift(text);
  }
  try {
    storage?.setItem(PLACES_KEY, `[${kept.join(',')}]`);
  } catch {
    try { storage?.removeItem(PLACES_KEY); } catch { /* storage unavailable */ }
  }
}
