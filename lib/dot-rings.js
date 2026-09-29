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

export const RING = { filled: '#1abc9c', empty: 'rgba(255,255,255,0.16)', badge: '#7F77DD' };
