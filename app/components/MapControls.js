'use client';

// Paths' two maps (companies and people) read the way Network Circle does
// (Blake, 2026-10-02: "the paths should have the same filter as network circle
// even with phyics as well if they want to enable them and change color heat
// mapping"): colour by sector or by heat, and physics you can switch on, then
// drag bubbles and move the forces. Off, the layout is computed once and stays
// still, as it always has.

import { useEffect, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3';
import { heatColour } from '../../lib/galaxy-lab';
import { Seg, panelHeading } from './PathsAnalyzer';

export const PHYSICS_OFF = Object.freeze({ live: false, spread: 1, pull: 1, links: 1 });

const hint = { fontSize: 10.5, color: '#667', lineHeight: 1.45, marginTop: 6 };
const SLIDERS = [
  { key: 'spread', label: 'Spread', min: 0.2, max: 4, step: 0.05, tip: 'How hard bubbles push each other apart.' },
  { key: 'pull', label: 'Pull to their group', min: 0, max: 4, step: 0.05, tip: 'How hard each bubble keeps to its sector. At 0 they find their own shape.' },
  { key: 'links', label: 'Pull along lines', min: 0, max: 6, step: 0.05, tip: 'How hard two bubbles joined by a line pull together.' },
];

/** The panel's Colour and Physics sections. */
export function MapLook({ colourBy, onColourBy, physics, onPhysics, heatHint }) {
  return (
    <>
      <div style={panelHeading}>Colour</div>
      <Seg value={colourBy} onChange={onColourBy} options={[['sector', 'Sector'], ['heat', 'Heat']]} />
      {colourBy === 'heat' && <div style={hint}>{heatHint}</div>}

      <div style={panelHeading}>Physics</div>
      <Seg value={physics.live ? 'on' : 'off'} onChange={(v) => onPhysics({ ...physics, live: v === 'on' })} options={[['off', 'Still'], ['on', 'Live']]} />
      {physics.live ? (
        <div style={{ marginTop: 8 }}>
          {SLIDERS.map((s) => (
            <label key={s.key} title={s.tip} style={{ display: 'block', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aab' }}>
                <span>{s.label}</span>
                <span style={{ color: physics[s.key] === PHYSICS_OFF[s.key] ? '#556' : '#cfe6f7', fontVariantNumeric: 'tabular-nums' }}>{physics[s.key].toFixed(2)}×</span>
              </div>
              <input type="range" min={s.min} max={s.max} step={s.step} value={physics[s.key]}
                onChange={(e) => onPhysics({ ...physics, [s.key]: Number(e.target.value) })}
                style={{ width: '100%', accentColor: '#3498DB' }} />
            </label>
          ))}
          <div style={hint}>Drag a bubble and the ones joined to it follow. Click still opens it.</div>
          <button type="button" onClick={() => onPhysics({ ...PHYSICS_OFF, live: true })} style={{
            marginTop: 6, padding: '4px 10px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#aab',
          }}>Reset the forces</button>
        </div>
      ) : (
        <div style={hint}>Live lets the bubbles move: drag them, and change the forces that lay the map out.</div>
      )}
    </>
  );
}

/**
 * The map's layout, moving: a simulation on the layout's own nodes (each with
 * `ax`, `ay`, where its group sits) and lines (each with `k`, its pull), the
 * same forces the still layout settled under, redrawn once a frame while it moves.
 * Returns `drag(event, node)` for a bubble's pointer-down, and `clicked()`,
 * false right after a drag so letting go doesn't open the bubble.
 */
export function useLivePhysics(layout, physics) {
  const [, setFrame] = useState(0);
  const sim = useRef(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!physics.live || !layout.nodes.length) return undefined;
    let raf = 0;
    const s = forceSimulation(layout.nodes)
      .force('x', forceX((d) => d.ax).strength(0.12 * physics.pull))
      .force('y', forceY((d) => d.ay).strength(0.12 * physics.pull))
      .force('collide', forceCollide((d) => d.r + 3).iterations(2))
      .force('charge', forceManyBody().strength(-25 * physics.spread))
      // Each line's own pull from the still layout (`k`), so at 1× nothing moves until you drag.
      .force('link', forceLink(layout.edges).id((d) => d.id)
        .strength((e) => (e.k ?? 0.1) * physics.links).distance(60 * Math.sqrt(physics.spread)))
      .alpha(0.15)
      .on('tick', () => {
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; setFrame((f) => f + 1); });
      });
    sim.current = s;
    return () => { s.stop(); cancelAnimationFrame(raf); sim.current = null; };
  }, [layout, physics.live, physics.spread, physics.pull, physics.links]);

  const drag = (ev, node) => {
    const s = sim.current;
    if (!s) return;
    const svg = ev.currentTarget.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const at = (e) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(inv);
    };
    const start = { x: ev.clientX, y: ev.clientY };
    moved.current = false;
    const move = (e) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) moved.current = true;
      const p = at(e);
      node.fx = p.x; node.fy = p.y;
    };
    const up = () => {
      node.fx = null; node.fy = null;
      s.alphaTarget(0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    const p = at(ev);
    node.fx = p.x; node.fy = p.y;
    // Gently: the spacing between bubbles isn't scaled by the heat, the pulls are,
    // so a calm drag keeps them from piling up while they follow.
    s.alphaTarget(0.08).restart();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const clicked = () => {
    if (!moved.current) return true;
    moved.current = false;
    return false;
  };
  return { drag: physics.live ? drag : null, clicked };
}

/** Radial glows for Heat, one per step of the ramp; `id` keeps two maps' apart. */
export function HeatDefs({ id }) {
  return (
    <defs>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <radialGradient key={k} id={`${id}-${k}`}>
          <stop offset="0" stopColor={heatColour(k / 5)} stopOpacity={0.16 + 0.07 * k} />
          <stop offset="1" stopColor={heatColour(k / 5)} stopOpacity={0} />
        </radialGradient>
      ))}
    </defs>
  );
}

/** The glow behind the hotter bubbles, screen-blended so it pools where they cluster. */
export function HeatGlow({ id, nodes, heat }) {
  return (
    <g style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
      {nodes.filter((n) => heat(n) >= 0.5).map((n) => (
        <circle key={n.id} cx={n.x} cy={n.y} r={n.r * 1.9 + 18} fill={`url(#${id}-${Math.round(heat(n) * 5)})`} />
      ))}
    </g>
  );
}
