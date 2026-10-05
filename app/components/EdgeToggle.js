'use client';

// The round buttons at the map's edges that open and close its side panels:
// Filters on the left (FilterPanel.js, and Paths' SidePanel in
// PathsAnalyzer.js), Details on the right (Sidebar.js). Blake, 2026-10-04:
// "innovate with the current … more ui and native within the app with the ux
// and the way it animates and also texture color shading", and of the mock-ups,
// "i like the a graphics with c animation but i dont like the number
// notification".
//
// So it's the same circle in the same place, drawn in the app's own materials
// (app/globals.css, "Edge buttons"): a frosted puck with a lit rim, an inner
// shadow and a glow in its colour (the look's accent for Filters, its S-tier
// gold for Details), porcelain on a light look, a hairline on Analyst. Hovering
// lifts it and builds a cluster round it, clockwise from twelve, as Check for
// new's ↻ does (lib/cluster-dots.js); its name peeks out beside it. Opening
// slides the panel out from behind it: the dots stream along the panel's edge,
// the edge lights, and the puck docks there, chevron turned, as the panel's
// close control (so the panels have no Close row of their own). Closing undoes
// it. Esc closes a panel from inside it. Reduce Motion: nothing travels or
// builds, the panel fades. No count, on either button.
//
// It's position: fixed, so it's rendered beside its panel, never inside it: a
// panel's backdrop blur makes it the containing block for anything fixed inside.

import { useEffect, useRef, useState } from 'react';
import { clusterDots, streamOffsets } from '../../lib/cluster-dots';

// The orbit's box is 60 × 60 round the 36 px puck; the dots sit 24 out.
const ORBIT = clusterDots(30, 30, 24);
// Docked, the puck's centre is 8 px outside the panel's edge (--sd-edge-gap),
// so that's where the dots stream to: the line of the edge.
const STREAM = {
  left: streamOffsets(ORBIT, 22, 30),
  right: streamOffsets(ORBIT, 38, 30),
};
// The dots' colours: the look's tiers, Standard's until a look is applied (a
// style, since an SVG attribute can't read a CSS variable).
const TONE = { S: 'var(--sd-tier-s, #ffd700)', A: 'var(--sd-tier-a, #9b59b6)', B: 'var(--sd-tier-b, #3498db)' };

/** How long a panel takes to go, so it can stay on screen while it does. */
export const EDGE_CLOSE_MS = 260;

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A side panel's life: on screen while open, and for EDGE_CLOSE_MS after, so it
 * can slide away (`closing`). The timer, not an animation's end, takes it off:
 * a hidden tab gets no animation frames (TRAPS §17).
 */
export function useEdgePanel(open) {
  const [shown, setShown] = useState(open);
  const [was, setWas] = useState(open);
  if (was !== open) {
    setWas(open);
    if (open) setShown(true);
  }
  useEffect(() => {
    if (open || !shown) return undefined;
    const t = setTimeout(() => setShown(false), reduceMotion() ? 0 : EDGE_CLOSE_MS);
    return () => clearTimeout(t);
  }, [open, shown]);
  return { shown: open || shown, closing: !open && shown };
}

/**
 * @param {{ side: 'left' | 'right', label: string, open: boolean, onToggle: () => void,
 *   panelId: string, width: string, phoneWidth?: string }} props
 *   width: the open panel's width (a CSS length); phoneWidth: on a phone, if different.
 */
export default function EdgeToggle({ side, label, open, onToggle, panelId, width, phoneWidth }) {
  const ref = useRef(null);
  // Closing: the dots gather back round it once, then the class goes, so a
  // hover afterwards builds them afresh.
  const [closing, setClosing] = useState(false);
  const [was, setWas] = useState(open);
  if (was !== open) {
    setWas(open);
    setClosing(!open);
  }
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(() => setClosing(false), 600);
    return () => clearTimeout(t);
  }, [closing]);

  // Esc closes the panel the focus is in (or on this button), and leaves the
  // focus here. Not from a text box, and not while a dialog is over the page;
  // caught before Bridge Chains' own Esc (back one circle) so one key does one thing.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const here = document.activeElement;
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!(ref.current?.contains(here) || panel?.contains(here))) return;
      e.preventDefault();
      e.stopPropagation();
      onToggle();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onToggle, panelId]);

  const name = label.toLowerCase();
  return (
    <button
      ref={ref}
      type="button"
      className={`sd-edge sd-edge-${side}${open ? ' is-open' : ''}${closing ? ' is-closing' : ''}`}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={open ? `Close ${name}` : `Open ${name}`}
      onClick={onToggle}
      style={{ '--sd-edge-w': width, '--sd-edge-w-phone': phoneWidth || width }}
    >
      <span className="sd-edge-line" aria-hidden="true" />
      <svg className="sd-edge-orbit" viewBox="0 0 60 60" aria-hidden="true" focusable="false">
        {ORBIT.map((d) => (
          <circle key={d.i} className="sd-edge-dot sd-dot" cx={d.x} cy={d.y} r="2.4"
            style={{ fill: TONE[d.tier], '--i': d.i, '--sx': `${STREAM[side][d.i].dx}px`, '--sy': `${STREAM[side][d.i].dy}px` }} />
        ))}
      </svg>
      <span className="sd-edge-puck" aria-hidden="true">
        <svg className="sd-edge-chev" viewBox="0 0 16 16" focusable="false">
          <path d={side === 'left' ? 'M6 3.2 10.8 8 6 12.8' : 'M10 3.2 5.2 8 10 12.8'} />
        </svg>
      </span>
      <span className="sd-edge-peek" aria-hidden="true">{open ? 'Close' : label}</span>
    </button>
  );
}
