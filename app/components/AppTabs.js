'use client';

// The app's tabs, the same on every page (Blake, 2026-10-03: "for paths we
// need a notch for it so the tabs are visible and continuity is there").
// Network Circle, Degrees and Separation are views of the map page: there they
// switch in place (onMode); anywhere else they are links back to it with the
// tab named (/?mode=…). A page's own sub-tabs go in the notch under this row
// (lib/island.js setNotchTabs), which looks for #main-tabs to hang from.

import Link from 'next/link';
import { IS_DEMO } from '../../lib/demo';

const MODES = [
  { key: 'network', label: 'Network Circle', short: 'Circle', on: { background: '#fff', color: '#000' }, off: { background: 'transparent', color: '#888' } },
  { key: 'degrees', label: 'Degrees', on: { background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000' }, off: { background: 'rgba(255,255,255,0.12)', color: '#fff' } },
  { key: 'separation', label: 'Separation', on: { background: 'linear-gradient(135deg, #00E5FF, #FFD700 55%, #FF7043)', color: '#000' }, off: { background: 'rgba(255,255,255,0.12)', color: '#fff' } },
];
const PAGES = [
  { key: 'paths', href: '/paths', label: 'Paths', color: '#00ff88', on: 'linear-gradient(135deg, #00ff88, #3498DB)', demo: true },
  { key: 'social', href: '/social', label: 'Social', badge: 'beta', color: '#FFD700', on: 'linear-gradient(135deg, #FFD700, #FF6B35)', demo: true, title: 'Experimental: what your own LinkedIn data says about your relationships' },
  { key: 'outlink', href: '/queue', label: 'Outlink', color: '#FF6B35', on: 'linear-gradient(135deg, #FF6B35, #FFD700)', own: true },
  { key: 'scan', href: '/setup', label: 'Scan', color: '#666', on: 'linear-gradient(135deg, #00ff88, #1abc9c)', own: true },
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
    <div id="main-tabs" style={{ display: 'flex', gap: isMobile ? 2 : 4, background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: isMobile ? 2 : 3, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
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
            background: on ? p.on : 'rgba(255,255,255,0.06)', color: on ? '#000' : p.color,
          }}>
            {p.label}{p.badge && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>{p.badge}</span>}
          </Link>
        );
      })}
      {after}
    </div>
  );
}
