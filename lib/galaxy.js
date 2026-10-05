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
