'use client';

// Dots along the header's bottom line while a scan runs: one for each page the
// scanner reads, collecting from the left (Blake, 2026-10-03: "for every page
// it collects then small dots start collecting on the left side of the line on
// the lower header line giving that active feel"). The map's own colours, in
// the order of the name's gradient: gold, purple, blue (the theme's S, A and B). The newest one glows;
// a pulsing seed sits at the start until the first page is in. It's on every
// tab, since the header is, and a click opens the Scan page.
//
// The count comes from the server (app/api/scraper/route.js counts "Page N..."
// lines, and each fifty of your own connections list), so every tab and window
// shows the same trail. A few seconds after the scan ends, it fades away.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useScanner from './useScanner';
import { TIER_COLORS } from '../../lib/themes';

// The theme's S, A and B dots, in that order (the Scan page's cluster uses the same, page for page).
const colours = () => [TIER_COLORS.S, TIER_COLORS.A, TIER_COLORS.B];
const STEP = 9;        // a dot and its gap
const LINGER_MS = 4000;

const CSS = `
@keyframes trail-in { from { transform: scale(0); opacity: 0; } }
@keyframes trail-pulse { 0%, 100% { opacity: 0.45; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.25); } }
.scan-trail { transition: opacity 1.2s ease; }
.scan-trail .dot { animation: trail-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
.scan-trail .dot.newest { box-shadow: 0 0 6px 1px currentColor; }
.scan-trail .seed { animation: trail-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .scan-trail .dot, .scan-trail .seed { animation: none; }
  .scan-trail { transition: none; }
}`;

/** @param {{ inset: number }} props  how far in from each side the header's padding puts the line's content */
export default function ScanTrail({ inset }) {
  const scan = useScanner();
  const boxRef = useRef(null);
  const [room, setRoom] = useState(60);
  // What it last showed, kept on screen a moment after the scan ends: set as
  // the scan's answer changes (during render, as React has it for state that
  // follows a prop), and cleared by a timer once it stops.
  const [shown, setShown] = useState({ on: false, pages: 0, label: '' });
  const live = scan.running && !scan.pending;
  const label = scan.target?.name ? `Scanning ${scan.target.name}` : 'Scanning';
  if (live && (!shown.on || shown.pages !== (scan.pages || 0) || shown.label !== label)) {
    setShown({ on: true, pages: scan.pages || 0, label });
  }
  useEffect(() => {
    if (live || !shown.on) return undefined;
    const timer = setTimeout(() => setShown((s) => ({ ...s, on: false })), LINGER_MS);
    return () => clearTimeout(timer);
  }, [live, shown.on]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setRoom(Math.max(8, Math.floor(el.clientWidth / STEP) - 4)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pages } = shown;
  // As many as fit; past that, the oldest give way and a count says how many more.
  const first = Math.max(0, pages - room);
  const dots = [];
  for (let i = first; i < pages; i++) dots.push(i);
  const title = `${shown.label}: ${pages === 0 ? 'starting' : `${pages.toLocaleString('en-US')} page${pages === 1 ? '' : 's'} read`}. Open the Scan page`;
  return (
    <div ref={boxRef} aria-hidden={!shown.on} style={{ position: 'absolute', left: inset, right: inset, bottom: -4, height: 7, pointerEvents: 'none' }}>
      <style>{CSS}</style>
      <Link href="/setup" title={title} tabIndex={shown.on ? 0 : -1} className="scan-trail" style={{
        position: 'absolute', left: 0, top: 0, height: 7, display: 'flex', alignItems: 'center', gap: STEP - 5,
        pointerEvents: shown.on ? 'auto' : 'none', opacity: shown.on ? 1 : 0, textDecoration: 'none',
      }}>
        {first > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: '#889', marginRight: 2, fontVariantNumeric: 'tabular-nums' }}>+{first.toLocaleString('en-US')}</span>}
        {dots.map((i) => {
          const cs = colours();
          const c = cs[i % cs.length];
          return <span key={i} className={`dot${i === pages - 1 ? ' newest' : ''}`} style={{ width: 5, height: 5, borderRadius: '50%', background: c, color: c, flexShrink: 0 }} />;
        })}
        {shown.on && <span className="seed" style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff88', flexShrink: 0 }} />}
      </Link>
    </div>
  );
}
