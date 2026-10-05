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

// The same cluster, bigger, on a map (Blake, 2026-10-04: "once they click on
// the person to generate cluster i want the same way we have the check
// connection but bigger obviously when they click to scan it"). Degrees'
// Unscanned view puts it on the dot of whoever's circle is being built, so the
// scan can be found again from the overview. Whoever it is is the hub; two
// rings of dots build round them in one sweep clockwise from twelve, each
// joined to the hub as it lands, fade, and build again, until the scan ends.
// Gold, purple and blue, as above. Still under Reduce Motion: the whole
// cluster, drawn once.
const BIG_LOOP = 2.8;   // seconds for one sweep and its fade
const BIG_CSS = `
@keyframes fcDot {
  0% { opacity: 0; transform: scale(0.2); }
  6% { opacity: 1; transform: scale(1.4); }
  11%, 68% { opacity: 1; transform: scale(1); }
  86%, 100% { opacity: 0; transform: scale(0.6); }
}
@keyframes fcSpoke { 0% { opacity: 0; } 8%, 68% { opacity: 0.5; } 86%, 100% { opacity: 0; } }
@keyframes fcHalo { 0%, 100% { opacity: 0.18; } 50% { opacity: 0.4; } }
.fc-dot { transform-box: fill-box; transform-origin: center; opacity: 0; animation: fcDot ${BIG_LOOP}s ease-out infinite; animation-delay: var(--d); }
.fc-spoke { opacity: 0; animation: fcSpoke ${BIG_LOOP}s ease-out infinite; animation-delay: var(--d); }
.fc-halo { animation: fcHalo ${BIG_LOOP}s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .fc-dot { animation: none; opacity: 1; }
  .fc-spoke { animation: none; opacity: 0.4; }
  .fc-halo { animation: none; }
}
`;

/**
 * A cluster forming round (x, y), `r` out, for an SVG: the backdrop that lifts
 * it off the map, the rings of dots and their spokes. The hub (the person) is
 * drawn by the map on top, `hub` across. `still`: Reduce Motion is on.
 */
export function FormingCluster({ x, y, r, hub = 0, still = false }) {
  const dots = [];
  const ring = (n, at, size, phase) => {
    for (let i = 0; i < n; i++) dots.push({ a: -Math.PI / 2 + ((i + phase) * 2 * Math.PI) / n, at, size });
  };
  ring(12, r * 0.6, r * 0.05, 0.25);
  ring(20, r, r * 0.062, 0);
  // One sweep: the order round the clock decides when each lands, whichever ring it's on.
  const turn = (a) => (((a + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI);
  dots.sort((p, q) => turn(p.a) - turn(q.a));
  const colours = [TIER_COLORS.S, TIER_COLORS.A, TIER_COLORS.B];
  const delay = (i) => ({ '--d': `${((turn(dots[i].a) * BIG_LOOP * 0.62)).toFixed(3)}s` });
  const from = Math.max(hub, r * 0.16);
  return (
    <g pointerEvents="none" aria-hidden="true">
      <style>{BIG_CSS}</style>
      <circle cx={x} cy={y} r={r * 1.24} fill="var(--sd-bg)" fillOpacity={0.88} />
      <circle className={still ? undefined : 'fc-halo'} cx={x} cy={y} r={r * 1.24} fill="none"
        stroke={TIER_COLORS.S} strokeOpacity={still ? 0.3 : undefined} strokeWidth={r * 0.025} />
      {dots.map((p, i) => (
        <line key={'s' + i} className={still ? undefined : 'fc-spoke'} style={still ? { opacity: 0.4 } : delay(i)}
          x1={x + Math.cos(p.a) * from} y1={y + Math.sin(p.a) * from} x2={x + Math.cos(p.a) * p.at} y2={y + Math.sin(p.a) * p.at}
          stroke={colours[i % colours.length]} strokeWidth={r * 0.012} />
      ))}
      {dots.map((p, i) => (
        <circle key={'d' + i} className={still ? 'sd-dot' : 'sd-dot fc-dot'} style={still ? undefined : delay(i)}
          cx={x + Math.cos(p.a) * p.at} cy={y + Math.sin(p.a) * p.at} r={p.size} fill={colours[i % colours.length]} />
      ))}
    </g>
  );
}

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
