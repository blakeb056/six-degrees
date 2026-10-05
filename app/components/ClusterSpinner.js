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
//
// The ring's geometry is lib/cluster-dots.js and its keyframes (csBuild,
// csLoop) are in app/globals.css: the map's edge buttons build the same
// cluster round themselves (app/components/EdgeToggle.js).

import { TIER_COLORS } from '../../lib/themes';
import { clusterDots } from '../../lib/cluster-dots';

const CSS = `
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
  return (
    <span className={`cs${live ? ' cs-live' : ''}`} aria-hidden="true" style={{ width: size, height: size }}>
      <style>{CSS}</style>
      <span className="cs-glyph" style={{ fontSize: size }}>{glyph}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="cs-hub" cx={c} cy={c} r={dot * 1.35} fill="currentColor" />
        {clusterDots(c, c, r).map((d) => (
          <circle key={d.i} className="cs-dot sd-dot" style={{ '--i': d.i }} cx={d.x} cy={d.y} r={dot}
            fill={TIER_COLORS[d.tier]} />
        ))}
      </svg>
    </span>
  );
}
