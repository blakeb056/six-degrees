'use client';

// The ↻ of Check for new, as a cluster forming (Blake, 2026-10-03: "use the
// bridge cluster animation … building dots clock wise and is satisfying. this
// will make it feel more alive"). A hub with a ring of dots round it, the way
// the map draws a connection's circle. At rest it's the ↻; hovering the button
// builds the ring once, clockwise from the top; while it checks, the ring keeps
// building, round and round. The dots take the look's gold, purple and blue,
// as every other cluster does (lib/themes.js). Still under Reduce Motion.
//
// Hover is the button's own: give it the class "cluster-host".

import { TIER_COLORS } from '../../lib/themes';

const N = 10;
const CSS = `
@keyframes csBuild { from { opacity: 0; transform: scale(0.2); } 70% { opacity: 1; transform: scale(1.25); } to { opacity: 1; transform: scale(1); } }
@keyframes csLoop {
  0% { opacity: 0; transform: scale(0.2); }
  8% { opacity: 1; transform: scale(1.3); }
  14%, 72% { opacity: 1; transform: scale(1); }
  88%, 100% { opacity: 0; transform: scale(0.6); }
}
.cs { position: relative; display: inline-block; flex-shrink: 0; }
.cs .cs-glyph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; line-height: 1; transition: opacity .15s, transform .2s; }
.cs svg { position: absolute; inset: 0; overflow: visible; }
.cs .cs-dot { transform-box: fill-box; transform-origin: center; opacity: 0; }
.cs .cs-hub { opacity: 0; transition: opacity .15s; }
.cluster-host:hover .cs:not(.cs-live) .cs-glyph { opacity: 0; transform: scale(.6) rotate(90deg); }
.cluster-host:hover .cs:not(.cs-live) .cs-hub { opacity: 1; }
.cluster-host:hover .cs:not(.cs-live) .cs-dot { animation: csBuild .32s cubic-bezier(.2,.9,.3,1.3) both; animation-delay: calc(var(--i) * 34ms); }
.cs.cs-live .cs-glyph { opacity: 0; }
.cs.cs-live .cs-hub { opacity: 1; }
.cs.cs-live .cs-dot { animation: csLoop 1.5s ease-out infinite; animation-delay: calc(var(--i) * 95ms); }
@media (prefers-reduced-motion: reduce) {
  .cluster-host:hover .cs:not(.cs-live) .cs-dot, .cs.cs-live .cs-dot { animation: none; opacity: 1; }
  .cluster-host:hover .cs:not(.cs-live) .cs-glyph { transform: none; }
}
`;

/** @param {{ size?: number, live?: boolean, glyph?: string }} props  live: a check is running */
export default function ClusterSpinner({ size = 14, live = false, glyph = '↻' }) {
  const c = size / 2;
  const r = size * 0.42;
  const dot = Math.max(1, size * 0.085);
  const colours = [TIER_COLORS.S, TIER_COLORS.A, TIER_COLORS.B];
  return (
    <span className={`cs${live ? ' cs-live' : ''}`} aria-hidden="true" style={{ width: size, height: size }}>
      <style>{CSS}</style>
      <span className="cs-glyph" style={{ fontSize: size }}>{glyph}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="cs-hub" cx={c} cy={c} r={dot * 1.35} fill="currentColor" />
        {Array.from({ length: N }, (_, i) => {
          // Clockwise from twelve o'clock.
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
          return (
            <circle key={i} className="cs-dot sd-dot" style={{ '--i': i }} cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={dot}
              fill={colours[i % colours.length]} />
          );
        })}
      </svg>
    </span>
  );
}
