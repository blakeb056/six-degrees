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
