// The thin ring of five bars round a person's dot: how much of their circle is
// scanned (lib/reach.js scanBars). Blake's pick, design C: thin bars, a
// catalyst's green outline on the dot itself, a small count badge.
//
// Plain path strings, so the Galaxy (d3) and Bridge Chains (React) draw the
// same shape. Bars run clockwise from the top.

const GAP = 0.32;     // radians between bars

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

export const RING = { filled: '#1abc9c', empty: 'rgba(255,255,255,0.16)', badge: '#7F77DD' };
