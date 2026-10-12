// The thin ring of five bars round a person's dot: how much of their circle is
// scanned (lib/reach.js scanBars). Blake's pick, design C: thin bars, a
// catalyst's green outline on the dot itself, a small count badge.
//
// Plain path strings, so the Galaxy (d3) and Bridge Chains (React) draw the
// same shape. Bars run clockwise from the top.
//
// Since 2026-10-12 a scanned circle's ring is one continuous line instead of
// five bars (fillArcs, from lib/reach.js scanFill): read solid, the rest of
// what's known faint, and the unknown band at its end dashed.

const GAP = 0.32;     // radians between bars

/**
 * An arc of radius r around (0, 0), from `from` to `to` as fractions of a turn
 * clockwise from the top; null when it has no length. A whole turn is two
 * halves: an arc that ends where it starts draws nothing.
 */
export function arcPath(r, from, to) {
  const a = Math.max(0, Math.min(1, Number(from) || 0));
  const b = Math.max(a, Math.min(1, Number(to) || 0));
  if (b - a < 1e-6) return null;
  const p = (f) => {
    const t = -Math.PI / 2 + 2 * Math.PI * f;
    return `${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
  };
  const R = Math.round(r * 100) / 100;
  if (b - a > 1 - 1e-6) return `M${p(0)} A${R} ${R} 0 1 1 ${p(0.5)} A${R} ${R} 0 1 1 ${p(0)}`;
  return `M${p(a)} A${R} ${R} 0 ${b - a > 0.5 ? 1 : 0} 1 ${p(b)}`;
}

/**
 * The scan ring round a dot (lib/reach.js scanFill) as three arcs of radius r,
 * clockwise from the top: `read` (solid), `rest`, known and not read yet
 * (faint), and `unknown` at the end (dashed). Each a path string, or null when
 * that part is empty; all null for no ring.
 *
 * @param fill { read: 0..1, unknown: 0..1 } or null
 * @returns {{ read: string|null, rest: string|null, unknown: string|null }}
 */
export function fillArcs(r, fill) {
  if (!fill) return { read: null, rest: null, unknown: null };
  const read = Math.max(0, Math.min(1, Number(fill.read) || 0));
  const unknown = Math.max(0, Math.min(1 - read, Number(fill.unknown) || 0));
  return {
    read: arcPath(r, 0, read),
    rest: arcPath(r, read, 1 - unknown),
    unknown: arcPath(r, 1 - unknown, 1),
  };
}

/** Five arcs of radius r around (0, 0): [{ d, i }] */
export function ringSegments(r) {
  const span = (2 * Math.PI - 5 * GAP) / 5;
  return Array.from({ length: 5 }, (_, i) => {
    const a0 = -Math.PI / 2 + GAP / 2 + i * (span + GAP);
    const a1 = a0 + span;
    const p = (a) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
    return { i, d: `M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}` };
  });
}

/**
 * The ring round a bridge in Bridge Chains (Blake, 2026-10-02: "the bars on the
 * ring should signify how many dots in the clusters are ready to be scanned
 * and new clusters formed"). One bar for each person you added through that
 * circle: the ones scanned since, with a cluster of their own (`formed`),
 * then the ones waiting for a scan (`ready`). Past `max` bars the two kinds
 * share them in proportion, each keeping at least one.
 *
 * @returns {{ d: string, kind: 'formed' | 'ready' }[]}
 */
export function reachSegments(r, { formed = 0, ready = 0 } = {}, max = 12) {
  const total = Math.max(0, formed) + Math.max(0, ready);
  if (!total) return [];
  const n = Math.min(total, max);
  let nFormed = formed > 0 ? Math.max(1, Math.round((n * formed) / total)) : 0;
  if (ready > 0 && nFormed >= n) nFormed = n - 1;
  const gap = n === 1 ? 0.5 : Math.min(GAP, ((2 * Math.PI) / n) * 0.35);
  const span = (2 * Math.PI) / n - gap;
  const p = (a) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  return Array.from({ length: n }, (_, i) => {
    const a0 = -Math.PI / 2 + gap / 2 + i * (span + gap);
    return { kind: i < nFormed ? 'formed' : 'ready', d: `M${p(a0)} A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${p(a0 + span)}` };
  });
}

export const RING = {
  filled: '#1abc9c', empty: 'rgba(255,255,255,0.16)', badge: '#7F77DD',
  // The scan ring's other two parts (fillArcs). The faint part in the look's
  // ink, so it shows on a light map too (lib/themes.js --sd-ink); the unknown
  // band the read colour, dimmer and dashed: it fills in as the list is read.
  rest: 'rgba(var(--sd-ink, 255, 255, 255), 0.16)', unknown: 'rgba(26, 188, 156, 0.5)', dash: '2 2',
};
