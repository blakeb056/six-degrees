'use client';

// The app's tabs, the same on every page (Blake, 2026-10-02: "for paths we
// need a notch for it so the tabs are visible and continuity is there").
// Network Circle, Degrees and Separation are views of the map page: there they
// switch in place (onMode); anywhere else they are links back to it with the
// tab named (/?mode=…). A page's own sub-tabs go in the notch under this row
// (lib/island.js setNotchTabs), which looks for #main-tabs to hang from.

import Link from 'next/link';
import { IS_DEMO } from '../../lib/demo';

const MODES = [
  { key: 'network', label: 'Network Circle', short: 'Circle', on: { background: '#fff', color: '#000' }, off: { background: 'transparent', color: 'var(--sd-fg-3, #888)' } },
  { key: 'degrees', label: 'Degrees', on: { background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000' }, off: { background: 'rgba(var(--sd-ink, 255, 255, 255), 0.12)', color: 'var(--sd-fg-1, #fff)' } },
  { key: 'separation', label: 'Separation', on: { background: 'linear-gradient(135deg, #00E5FF, #FFD700 55%, #FF7043)', color: '#000' }, off: { background: 'rgba(var(--sd-ink, 255, 255, 255), 0.12)', color: 'var(--sd-fg-1, #fff)' } },
];
const PAGES = [
  { key: 'paths', href: '/paths', label: 'Paths', color: 'var(--sd-green, #00ff88)', on: 'linear-gradient(135deg, #00ff88, #3498DB)', demo: true },
  // Your network ranked by power, and the boards that read it (Blake, 2026-10-03:
  // "stats and insights … based off their circles"). Purple to gold, its own colour.
  // The sample and a CSV import have something to rank too, so it isn't `own`.
  { key: 'insights', href: '/insights', label: 'Insights', color: 'var(--sd-purple, #c39bd3)', on: 'linear-gradient(135deg, #9B59B6, #FFD700)' },
  // Social is part of Outlink now (Messages & follow-ups); /social forwards there.
  { key: 'outlink', href: '/queue', label: 'Outlink', color: 'var(--sd-orange, #FF6B35)', on: 'linear-gradient(135deg, #FF6B35, #FFD700)', own: true },
  { key: 'scan', href: '/setup', label: 'Scan', color: 'var(--sd-fg-4, #666)', on: 'linear-gradient(135deg, #00ff88, #1abc9c)', own: true },
];

/**
 * @param {{ active: string, isMobile?: boolean, csvMode?: boolean, onMode?: (key: string) => void,
 *   children?: any, after?: any }} props
 *   `children` sits after the map's tabs (the map page's sample or CSV chip),
 *   `after` at the end of the row (the Auto scan button). `own` pages (Outlink,
 *   Scan) need your own network, so they hide for the sample or a CSV.
 */
export default function AppTabs({ active, isMobile = false, csvMode = false, onMode, children, after }) {
  const pad = isMobile ? '6px 10px' : '8px 16px';
  const base = { padding: pad, borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600, textDecoration: 'none' };
  return (
    <div id="main-tabs" data-glass-panel="bar" style={{ display: 'flex', gap: isMobile ? 2 : 4, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', borderRadius: 8, padding: isMobile ? 2 : 3, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
      {MODES.map((m) => {
        const style = { ...base, cursor: 'pointer', ...(active === m.key ? m.on : m.off) };
        const label = isMobile && m.short ? m.short : m.label;
        return onMode
          ? <button key={m.key} type="button" onClick={() => onMode(m.key)} style={style}>{label}</button>
          : <Link key={m.key} href={`/?mode=${m.key}`} style={{ ...style, display: 'flex', alignItems: 'center' }}>{label}</Link>;
      })}
      {children}
      {PAGES.filter((p) => (IS_DEMO ? false : p.own ? !csvMode : true)).map((p) => {
        const on = active === p.key;
        return (
          <Link key={p.key} href={p.href} title={p.title} aria-current={on ? 'page' : undefined} style={{
            ...base, display: 'flex', alignItems: 'center', gap: 4,
            background: on ? p.on : 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: on ? '#000' : p.color,
          }}>
            {p.label}{p.badge && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>{p.badge}</span>}
          </Link>
        );
      })}
      {after}
    </div>
  );
}
