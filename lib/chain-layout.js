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

/** The rings from `inner` outwards, `spacing` apart, until `n` dots fit. */
function ringsFor(n, inner, spacing, sweep) {
  const radii = [];
  let room = 0;
  for (let r = inner; room < n; r += spacing) {
    radii.push(r);
    room += capacity(r, spacing, sweep);
  }
  return radii;
}

const outerOf = (n, inner, spacing, sweep) => {
  const radii = ringsFor(n, inner, spacing, sweep);
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
 * its middle outwards.
 *
 * @returns {{ spacing: number, inner: number, rings: { radius: number, count: number }[],
 *   points: { x: number, y: number, angle: number, ring: number }[] }}
 */
export function ringLayout(n, {
  inner, outer, spacing, minSpacing = spacing / 3, innerMin = inner,
  start = -Math.PI / 2, sweep = TAU,
} = {}) {
  const count = Math.max(0, Math.floor(n) || 0);
  if (!count) return { spacing, inner, rings: [], points: [] };

  let s = spacing;
  let r0 = inner;
  if (outerOf(count, r0, s, sweep) > outer) {
    // Start further in, as far as innerMin, before closing anything up.
    if (outerOf(count, innerMin, s, sweep) <= outer) {
      let lo = innerMin, hi = inner;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (outerOf(count, mid, s, sweep) <= outer) lo = mid; else hi = mid;
      }
      r0 = lo;
    } else {
      r0 = innerMin;
      let lo = minSpacing, hi = spacing;
      if (outerOf(count, r0, lo, sweep) <= outer) {
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (outerOf(count, r0, mid, sweep) <= outer) lo = mid; else hi = mid;
        }
      }
      s = lo;
    }
  }

  const radii = ringsFor(count, r0, s, sweep);
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
 */
export function tierBandLayout(rows, { inner, outer, spacing, minSpacing = spacing / 3, gap = spacing }) {
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
      const l = ringLayout(g.idx.length, { inner: r, outer: Infinity, spacing: s, minSpacing: s });
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
 * The people behind each person in an opened circle: their own circle, drawn
 * as a fan of small dots beyond `from`, centred on that person's angle and no
 * wider than their slot (at most a sixth of the circle), so each fan sits
 * behind its own person. At most `cap` dots a fan and about `total` in all, so
 * a big network stays quick; `more` is how many weren't drawn.
 *
 * @param {{ angle: number, slot: number, count: number }[]} anchors
 * @returns {({ points: { x: number, y: number }[], more: number } | null)[]}
 */
export function outerFans(anchors, { from, spacing = 7, cap = 40, total = 1200 } = {}) {
  const fans = anchors.filter((a) => a?.count > 0).length;
  const each = Math.max(6, Math.min(cap, Math.floor(total / Math.max(1, fans))));
  return anchors.map((a) => {
    if (!(a?.count > 0)) return null;
    const n = Math.min(a.count, each);
    // Only as wide as the dots need at `spacing`, never wider than their slot:
    // more rows once it's full, so a small fan stays a tight cluster.
    const room = Math.min(a.slot || TAU, TAU / 6);
    const width = Math.min(room, Math.max((spacing * 3) / from, (n * spacing) / from));
    const l = ringLayout(n, {
      inner: from, outer: Infinity, spacing, minSpacing: spacing, start: a.angle - width / 2, sweep: width,
    });
    return { points: l.points.map(({ x, y }) => ({ x, y })), more: a.count - n };
  });
}

/**
 * Every bridge's circle as a wedge of small dots behind the bridge, for the
 * Bridge Chains overview: the scale of each circle at a glance, drawn quietly.
 * A wedge is as wide as the gap to the bridge's neighbours (at most a sixth of
 * the circle) and grows outwards row by row, so a bigger circle reaches
 * further out. One spacing for every wedge, so their depths compare honestly;
 * it closes up (down to `minSpacing`) until the deepest fits inside `limit`.
 * If it still doesn't fit, or there are more than `total` dots in all, each
 * dot stands for `per` people, the same for every wedge, so the picture stays
 * on screen and the sizes still compare.
 *
 * @param {{ angle: number, count: number }[]} anchors
 * @returns {{ spacing: number, per: number, depth: number,
 *   fans: { points: { x: number, y: number }[], half: number }[] }}
 */
export function scaleFans(anchors, { from, limit, spacing = 5, minSpacing = 2.4, total = 24000 } = {}) {
  const people = anchors.reduce((n, a) => n + Math.max(0, a?.count || 0), 0);
  let per = Math.max(1, Math.ceil(people / total));
  let dots = anchors.map((a) => Math.ceil(Math.max(0, a?.count || 0) / per));

  // Where each wedge points: straight out from its bridge. But bridges on two
  // rings can sit at almost the same angle and would leave each other no room,
  // so when any two are that close the wedges take even turns round the circle,
  // in the bridges' own order, turned to sit as near their bridges as they can.
  const turn = (a) => ((a % TAU) + TAU) % TAU;
  const gap = (a, b) => { const d = Math.abs(a - b) % TAU; return Math.min(d, TAU - d) || TAU; };
  const order = anchors.map((a, i) => i).sort((i, j) => turn(anchors[i].angle) - turn(anchors[j].angle));
  const centre = anchors.map((a) => a.angle);
  if (order.length > 2) {
    const even = TAU / order.length;
    const crowded = order.some((i, k) => gap(anchors[i].angle, anchors[order[(k + 1) % order.length]].angle) < even * 0.6);
    if (crowded) {
      let x = 0, y = 0;
      order.forEach((i, k) => { x += Math.cos(anchors[i].angle - k * even); y += Math.sin(anchors[i].angle - k * even); });
      const first = Math.atan2(y, x);
      order.forEach((i, k) => { centre[i] = first + k * even; });
    }
  }

  // Each wedge's half-width: half the smaller gap to a neighbour, a little shy
  // of it so neighbouring wedges never touch.
  const half = new Array(anchors.length).fill(TAU / 12);
  if (order.length > 1) {
    order.forEach((i, k) => {
      const prev = centre[order[(k - 1 + order.length) % order.length]];
      const next = centre[order[(k + 1) % order.length]];
      half[i] = Math.min(TAU / 12, (Math.min(gap(centre[i], prev), gap(centre[i], next)) / 2) * 0.9);
    });
  }

  // A wedge is only as wide as its circle needs: about the square root of its
  // dots across, so its area grows with the people in it and a bigger circle is
  // both wider and deeper. Never wider than the room it has (`half`).
  const halfAt = (i, s) => Math.min(half[i], (Math.max(5, Math.round(Math.sqrt(dots[i]) * 1.15)) * s) / (2 * from));
  const rowsFor = (n, h, s) => {
    let rows = 0;
    for (let left = n; left > 0; rows++) left -= Math.max(1, Math.floor((2 * h * (from + rows * s)) / s));
    return rows;
  };
  let s = spacing;
  const deepest = () => Math.max(0, ...dots.map((n, i) => rowsFor(n, halfAt(i, s), s) * s));
  while (limit != null && s > minSpacing && from + deepest() > limit) s = Math.max(minSpacing, s * 0.9);
  // Still too deep at the closest spacing: one dot for two people, then three…
  while (limit != null && per < 200 && from + deepest() > limit) {
    per += 1;
    dots = anchors.map((a) => Math.ceil(Math.max(0, a?.count || 0) / per));
  }

  const fans = anchors.map((a, i) => {
    const h = halfAt(i, s);
    const points = [];
    for (let row = 0, left = dots[i]; left > 0; row++) {
      const radius = from + row * s;
      const fit = Math.min(left, Math.max(1, Math.floor((2 * h * radius) / s)));
      const step = (2 * h) / Math.max(1, Math.floor((2 * h * radius) / s));
      const start = centre[i] - (step * (fit - 1)) / 2;
      for (let k = 0; k < fit; k++) {
        const angle = start + step * k;
        points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      left -= fit;
    }
    return { points, half: h, angle: centre[i] };
  });
  return { spacing: s, per, depth: deepest(), fans };
}
