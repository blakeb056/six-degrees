// Where Bridge Chains puts a circle's dots.
//
// Blake, 2026-09-28: "when i scan someone and have a lot of 2nd degree its
// almost a solid line and needs to expand more". Every dot sat on one ring, so
// 200 people round one circle were a band and 800 were a solid line. Here a
// circle fills rings from the inside out instead, as many as its count needs:
// a small circle is one ring, a big one spreads into more, and neighbours keep
// their distance. Plain maths, no React; tests/chain-layout.test.mjs.

const TAU = Math.PI * 2;

/** How many dots fit on a ring of `radius` across `sweep` radians, `spacing` apart. */
function capacity(radius, spacing, sweep) {
  if (radius <= 0) return 1;
  const arc = sweep * radius;
  // A whole circle closes on itself; an arc has a dot at each end.
  return Math.max(1, sweep >= TAU - 1e-9 ? Math.floor(arc / spacing) : Math.floor(arc / spacing) + 1);
}

/** The rings from `inner` outwards, `gap` apart (at least `spacing`), until `n` dots fit. */
function ringsFor(n, inner, spacing, sweep, gap = spacing) {
  const radii = [];
  let room = 0;
  for (let r = inner; room < n; r += Math.max(spacing, gap)) {
    radii.push(r);
    room += capacity(r, spacing, sweep);
  }
  return radii;
}

const outerOf = (n, inner, spacing, sweep, gap) => {
  const radii = ringsFor(n, inner, spacing, sweep, gap);
  return radii[radii.length - 1];
};

/**
 * Places `n` dots in rings round a centre at (0, 0).
 *
 * The first ring sits at `inner`, and each next one `spacing` further out.
 * When that would run past `outer`, the rings first start further in (down to
 * `innerMin`), then close up (down to `minSpacing`); past that they carry on
 * beyond `outer` rather than overlap, and zooming out shows them. The dots on
 * each ring share it evenly, in proportion to its length, so every ring is
 * about as full as the rest; the first `n` of a list sorted best-first land
 * nearest the centre. Every other ring is turned by half a step, so dots on
 * neighbouring rings don't line up in spokes.
 *
 * `start` and `sweep` fill an arc instead of the whole circle, each ring from
 * its middle outwards. `ringGap` keeps the rings at least that far apart, for
 * dots that carry a name under them and need the room.
 *
 * @returns {{ spacing: number, inner: number, rings: { radius: number, count: number }[],
 *   points: { x: number, y: number, angle: number, ring: number }[] }}
 */
export function ringLayout(n, {
  inner, outer, spacing, minSpacing = spacing / 3, innerMin = inner,
  start = -Math.PI / 2, sweep = TAU, ringGap = 0,
} = {}) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (!count) return { spacing, inner, rings: [], points: [] };

  let s = spacing;
  let r0 = inner;
  if (outerOf(count, r0, s, sweep, ringGap) > outer) {
    // Start further in, as far as innerMin, before closing anything up.
    if (outerOf(count, innerMin, s, sweep, ringGap) <= outer) {
      let lo = innerMin, hi = inner;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (outerOf(count, mid, s, sweep, ringGap) <= outer) lo = mid; else hi = mid;
      }
      r0 = lo;
    } else {
      r0 = innerMin;
      let lo = minSpacing, hi = spacing;
      if (outerOf(count, r0, lo, sweep, ringGap) <= outer) {
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (outerOf(count, r0, mid, sweep, ringGap) <= outer) lo = mid; else hi = mid;
        }
      }
      s = lo;
    }
  }

  const radii = ringsFor(count, r0, s, sweep, ringGap);
  const caps = radii.map((r) => capacity(r, s, sweep));
  const room = caps.reduce((a, b) => a + b, 0);

  // Share the dots in proportion to each ring's room, never over it; what the
  // rounding leaves goes to the rings with the most room left.
  const counts = caps.map((c) => Math.min(c, Math.floor((count * c) / room)));
  let left = count - counts.reduce((a, b) => a + b, 0);
  while (left > 0) {
    let best = -1;
    for (let k = 0; k < caps.length; k++) {
      if (counts[k] < caps[k] && (best < 0 || caps[k] - counts[k] > caps[best] - counts[best])) best = k;
    }
    counts[best]++;
    left--;
  }

  const whole = sweep >= TAU - 1e-9;
  const points = [];
  const rings = [];
  radii.forEach((radius, k) => {
    const m = counts[k];
    if (!m) return;
    rings.push({ radius, count: m });
    // Round a whole circle evenly; across an arc from one edge to the other, a
    // lone dot in the middle of it. An arc fills from its middle outwards, so
    // the first in the list sit nearest whatever the arc fans out from.
    const step = whole ? TAU / m : m > 1 ? sweep / (m - 1) : 0;
    const from = whole ? start + (k % 2 ? step / 2 : 0) : m > 1 ? start : start + sweep / 2;
    const slots = whole ? null : middleOut(m);
    for (let j = 0; j < m; j++) {
      const angle = from + (slots ? slots[j] : j) * step;
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle, ring: rings.length - 1 });
    }
  });
  return { spacing: s, inner: r0, rings, points };
}

/** 0 … m-1 from the middle outwards: for 5, 2 3 1 4 0. */
function middleOut(m) {
  let lo = Math.floor((m - 1) / 2);
  let hi = lo + 1;
  const out = [lo--];
  while (out.length < m) {
    if (hi < m) out.push(hi++);
    if (out.length < m && lo >= 0) out.push(lo--);
  }
  return out;
}

/** A dot's radius for a layout's spacing: bigger for higher tiers, never touching a neighbour. */
export function dotRadius(spacing, tier) {
  const scale = tier === 'S' ? 1 : tier === 'A' ? 0.86 : tier === 'B' ? 0.72 : 0.6;
  return Math.max(1.4, Math.min(7, spacing * 0.42 * scale));
}

/**
 * Where a bridge's circle is previewed on hover: a band beyond every ring of
 * bridges. With many bridges the overview grows extra rings, past where the
 * preview used to start, and it drew over them. `clear` leaves room for a
 * hovered bridge's dot (20) and its name under it.
 */
export function previewBand(maxR, bridgeRings = [], clear = 34) {
  const edge = Math.max(0, ...bridgeRings.map((r) => r.radius));
  const inner = Math.max(maxR * 0.66, edge ? edge + clear : 0);
  return { inner, outer: Math.max(maxR * 0.8, inner + maxR * 0.14) };
}

const TIER_BANDS = ['S', 'A', 'B', 'C', 'D'];

/**
 * An opened circle's people in tier bands round the person: S nearest, then A,
 * B, C and D, with a gap between bands like Network Circle's tier orbits, so a
 * big circle reads as layers instead of one clump. Points come back in the
 * order of `rows`, each with `slot`: the angle its ring gives each dot. The
 * spacing closes up, down to `minSpacing`, until every band fits inside
 * `outer`; past that the bands carry on outwards and zooming out shows them.
 *
 * @returns {{ spacing: number, edge: number, bands: { tier: string, inner: number, outer: number }[],
 *   points: { x: number, y: number, angle: number, slot: number }[] }}
 * `start` is the angle each ring's first dot sits at (the top, unless told).
 */
export function tierBandLayout(rows, { inner, outer, spacing, minSpacing = spacing / 3, gap = spacing, start = -Math.PI / 2 }) {
  const groups = TIER_BANDS.map((tier) => ({ tier, idx: [] }));
  rows.forEach((row, i) => {
    const t = TIER_BANDS.indexOf(row?.tier);
    groups[t < 0 ? 4 : t].idx.push(i);              // no tier: with D
  });
  const used = groups.filter((g) => g.idx.length);
  const place = (s) => {
    const points = new Array(rows.length);
    const bands = [];
    let r = inner;
    for (const g of used) {
      const l = ringLayout(g.idx.length, { inner: r, outer: Infinity, spacing: s, minSpacing: s, start });
      g.idx.forEach((rowIndex, j) => {
        const p = l.points[j];
        points[rowIndex] = { x: p.x, y: p.y, angle: p.angle, slot: TAU / l.rings[p.ring].count };
      });
      const edge = Math.max(r, ...l.rings.map((x) => x.radius));
      bands.push({ tier: g.tier, inner: r, outer: edge });
      r = edge + gap * (s / spacing);
    }
    return { spacing: s, points, bands, edge: bands.length ? bands[bands.length - 1].outer : inner };
  };
  let best = place(spacing);
  if (best.edge <= outer) return best;
  let lo = minSpacing;
  let hi = spacing;
  best = place(lo);
  if (best.edge > outer) return best;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const tryMid = place(mid);
    if (tryMid.edge <= outer) { lo = mid; best = tryMid; } else hi = mid;
  }
  return best;
}

/**
 * The chains that lead on from an opened circle (Blake, 2026-10-02: "once they
 * are clicked on and can view the cluster i want any scanned d2,3,4 or whatever
 * to be show inside with lines out of the d1 leading to the d2s").
 *
 * `parents[i]` is the index of the link that introduced link i, or -1 when the
 * person in the middle did. The links one step on sit on a ring at `from`, each
 * as near its own angle in `angles` as it can get (where that person's dot is
 * in the circle), or fanned about `toward` without one; each later step sits `hop` further out,
 * as near the angle of the link it came from as it can get without touching a
 * neighbour on its own ring (`spacing` apart). So a chain reads outwards from
 * the middle: the bridge, someone met through them, someone met through *them*.
 *
 * @param {number[]} parents
 * @returns {{ rings: { radius: number, count: number, depth: number }[],
 *   points: { x: number, y: number, angle: number, radius: number, depth: number, parent: number }[] }}
 */
export function chainTree(parents = [], { from = 0, hop = 60, spacing = 46, toward = 0, angles = [] } = {}) {
  const n = parents.length;
  const parent = parents.map((p, i) => (Number.isInteger(p) && p >= 0 && p < n && p !== i ? p : -1));

  // How many steps out each one is. A loop (it shouldn't happen) is cut where
  // it closes, so everyone still gets a place.
  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const trail = [];
    let k = i;
    while (k >= 0 && !depth[k] && !trail.includes(k)) { trail.push(k); k = parent[k]; }
    if (k >= 0 && !depth[k]) { parent[trail[trail.length - 1]] = -1; k = -1; }
    let d = k >= 0 ? depth[k] + 1 : 1;
    for (let j = trail.length - 1; j >= 0; j--) depth[trail[j]] = d++;
  }

  const points = new Array(n);
  const rings = [];
  for (let d = 1; d <= Math.max(0, ...depth); d++) {
    const here = [];
    for (let i = 0; i < n; i++) if (depth[i] === d) here.push(i);
    const radius = from + (d - 1) * hop;
    const placed = spread(here.map((i) => (parent[i] < 0 ? (Number.isFinite(angles[i]) ? angles[i] : toward) : points[parent[i]].angle)),
      Math.min(spacing / Math.max(1, radius), TAU / here.length));
    here.forEach((i, j) => {
      const angle = placed[j];
      points[i] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle, radius, depth: d, parent: parent[i] };
    });
    rings.push({ radius, count: here.length, depth: d });
  }
  return { rings, points };
}

/**
 * Angles as near the ones asked for as they can be while staying `sep` apart:
 * neighbours that would touch move apart by the same amount each way, so two
 * people met through the same person sit either side of them. Comes back in
 * the order given.
 */
function spread(wanted, sep) {
  const m = wanted.length;
  if (m < 2) return wanted.slice();
  const turn = (a) => ((a % TAU) + TAU) % TAU;
  const order = wanted.map((a, i) => i).sort((i, j) => turn(wanted[i]) - turn(wanted[j]) || i - j);
  // Start counting just after the widest empty stretch, so no group straddles the join.
  let cut = 0;
  let widest = -1;
  order.forEach((i, k) => {
    const next = order[(k + 1) % m];
    const gap = turn(turn(wanted[next]) - turn(wanted[i])) || (m > 1 && k === m - 1 ? TAU : 0);
    if (gap > widest) { widest = gap; cut = (k + 1) % m; }
  });
  const seq = order.slice(cut).concat(order.slice(0, cut));
  const first = turn(wanted[seq[0]]);
  const at = seq.map((i) => first + turn(turn(wanted[i]) - first));

  // Least movement that keeps them `sep` apart: take the spacing out, pool any
  // neighbours left out of order to their average, put the spacing back.
  const blocks = [];
  at.forEach((a, k) => {
    blocks.push({ sum: a - k * sep, count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].count > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count) {
      const last = blocks.pop();
      blocks[blocks.length - 1].sum += last.sum;
      blocks[blocks.length - 1].count += last.count;
    }
  });
  let placed = blocks.flatMap((b) => new Array(b.count).fill(b.sum / b.count)).map((q, k) => q + k * sep);
  // Round the join too: if the last has come back round onto the first, share the ring evenly.
  if (placed[m - 1] - placed[0] > TAU - sep) {
    const mid = (placed[0] + placed[m - 1]) / 2;
    placed = placed.map((_, k) => mid + (k - (m - 1) / 2) * (TAU / m));
  }
  const out = new Array(m);
  seq.forEach((i, k) => { out[i] = placed[k]; });
  return out;
}

/**
 * How much is going on in each circle, for the order Bridge Chains rings them in:
 * the busiest on the inner ring (Blake, 2026-10-03: "the inner most ring to have
 * the clusters with the most amount of notifications ... a cluster that has been
 * formed after scanning or if someone added back and is available to scan").
 * Every notification about the circle counts, an unread one twice; so does each
 * person in it who added you back and is ready to scan, and each cluster of
 * their own that has formed from it since.
 *
 * @param {Array<{id: any}>} circles
 * @param {{ notes?: Array<{circle: string|null, seen?: boolean}>, ready?: Map, chained?: Map }} facts
 * @returns {Map<any, {score: number, notes: number, unread: number, ready: number, chains: number}>}
 */
export function circleActivity(circles, { notes = [], ready = new Map(), chained = new Map() } = {}) {
  const byCircle = new Map();
  for (const n of notes) {
    if (n?.circle == null) continue;
    const c = byCircle.get(n.circle) || { notes: 0, unread: 0 };
    c.notes += 1;
    if (!n.seen) c.unread += 1;
    byCircle.set(n.circle, c);
  }
  const out = new Map();
  for (const b of circles) {
    const n = byCircle.get(String(b.id)) || { notes: 0, unread: 0 };
    const r = ready.get(b.id) || 0;
    const ch = chained.get(b.id) || 0;
    out.set(b.id, { score: n.notes + n.unread + r + ch, notes: n.notes, unread: n.unread, ready: r, chains: ch });
  }
  return out;
}
