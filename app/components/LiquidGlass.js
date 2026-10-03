'use client';

// Lensing for the Glass look's panels (lib/liquid-glass.js): while a look draws
// its controls as glass (html[data-buttons="frosted"]), every [data-glass-panel]
// on the page gets an SVG filter made for its size, which its backdrop-filter
// runs after the blur (app/globals.css reads it from --lg-lens). Panels that
// open later are picked up, a panel that changes size gets a new map, and with
// Reduce Transparency on there's none at all. Renders nothing itself.

import { useEffect } from 'react';
import { lensMap } from '../../lib/liquid-glass';

const SVG_NS = 'http://www.w3.org/2000/svg';
// How much each kind of panel bends: a tall side panel a lot, the slim tab bar a little.
const KINDS = {
  side: { r: 2, bezel: 26, scale: 56 },
  bar: { r: 20, bezel: 12, scale: 22 },
};

export default function LiquidGlass() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    let defs = null;
    const made = new Map();   // panel → { id, w, h }
    let n = 0;
    let timer = null;

    const ensureDefs = () => {
      if (defs) return defs;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      svg.style.pointerEvents = 'none';
      defs = document.createElementNS(SVG_NS, 'defs');
      svg.appendChild(defs);
      document.body.appendChild(svg);
      return defs;
    };

    const update = () => {
      const on = root.dataset.buttons === 'frosted' && !reduce?.matches;
      const panels = on ? [...document.querySelectorAll('[data-glass-panel]')] : [];
      for (const [el, f] of made) {
        if (panels.includes(el)) continue;
        el.style.removeProperty('--lg-lens');
        document.getElementById(f.id)?.remove();
        made.delete(el);
      }
      for (const el of panels) {
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (w < 20 || h < 20) continue;
        const had = made.get(el);
        if (had && had.w === w && had.h === h) continue;
        const kind = KINDS[el.dataset.glassPanel] || KINDS.side;
        const id = had?.id || `lg-lens-${++n}`;
        document.getElementById(id)?.remove();
        const filter = document.createElementNS(SVG_NS, 'filter');
        filter.setAttribute('id', id);
        for (const [k, v] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(k, v);
        const image = document.createElementNS(SVG_NS, 'feImage');
        for (const [k, v] of Object.entries({ x: '0', y: '0', width: String(w), height: String(h), preserveAspectRatio: 'none', result: 'map' })) image.setAttribute(k, v);
        image.setAttribute('href', lensMap(w, h, Math.min(kind.r, Math.floor(Math.min(w, h) / 2)), kind.bezel));
        const shift = document.createElementNS(SVG_NS, 'feDisplacementMap');
        for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale: String(kind.scale), xChannelSelector: 'R', yChannelSelector: 'G' })) shift.setAttribute(k, v);
        filter.append(image, shift);
        ensureDefs().appendChild(filter);
        el.style.setProperty('--lg-lens', `url(#${id})`);
        made.set(el, { id, w, h });
      }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 150); };

    update();
    const ro = new ResizeObserver(schedule);
    const watchSizes = () => { ro.disconnect(); document.querySelectorAll('[data-glass-panel]').forEach((el) => ro.observe(el)); };
    watchSizes();
    // Panels open and close; the look changes.
    const mo = new MutationObserver((records) => {
      if (records.some((r) => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some((x) => x.nodeType === 1 && (x.matches?.('[data-glass-panel]') || x.querySelector?.('[data-glass-panel]'))))) {
        watchSizes();
        schedule();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    mo.observe(root, { attributes: true, attributeFilter: ['data-buttons'] });
    reduce?.addEventListener?.('change', schedule);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      mo.disconnect();
      reduce?.removeEventListener?.('change', schedule);
    };
  }, []);
  return null;
}
