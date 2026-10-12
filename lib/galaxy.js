// The Galaxy's view, as numbers, kept apart from the drawing so it can be tested
// (app/components/ForceGraph.js).

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
 * `span` is the stretch of circle shared out, clockwise from its first angle:
 * the whole of it, starting straight up, or the Wi-Fi fan's (fanSpan, below).
 */
export function seedAngles(ids, parentOf, [from, to] = FULL_CIRCLE) {
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
  place(spread(roots), from, to);
  // Anyone only reachable round a loop: shared out on their own.
  const left = ids.filter((id) => !out.has(id));
  if (left.length) place(spread(left), from, to);
  return out;
}

// The Wi-Fi fan (Blake, 2026-10-12: "like a wifi symbol shape of all the
// degrees"): you at the bottom, and each degree an arc fanning upward over you,
// the 1st nearest. Angles are the Galaxy's own, in graph coordinates where y
// grows downward, so straight up is -π/2 and clockwise is a growing angle.

/** Straight up, as an angle. */
export const UP = -Math.PI / 2;
/** The whole circle, clockwise from straight up: where everyone starts in Rings. */
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
 * How much further out each ring is drawn in the fan, so a ring's people have
 * the room they had all the way round: the fan is FAN_HALF / π of a circle, and
 * the room in a ring grows with the square of its radius. Without it the same
 * ten thousand people were crammed into 42% of the space and spilled over.
 */
export const FAN_SPREAD = Math.sqrt(Math.PI / FAN_HALF);

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
export function ringPath(r, { half = Math.PI, cx = 0, cy = 0 } = {}) {
  const n = (v) => Math.round(v * 100) / 100;
  if (half >= Math.PI) {
    return `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}`;
  }
  const [a0, a1] = fanSpan(half);
  return `M${n(cx + r * Math.cos(a0))} ${n(cy + r * Math.sin(a0))}`
    + `A${n(r)} ${n(r)} 0 ${2 * half > Math.PI ? 1 : 0} 1 ${n(cx + r * Math.cos(a1))} ${n(cy + r * Math.sin(a1))}`;
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
