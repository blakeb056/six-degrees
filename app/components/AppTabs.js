'use client';

// The app's tabs, the same on every page (Blake, 2026-10-02: "for paths we
// need a notch for it so the tabs are visible and continuity is there").
// Network Circle, Degrees and Separation are views of the map page: there they
// switch in place (onMode); anywhere else they are links back to it with the
// tab named (/?mode=…). A page's own sub-tabs go in the notch under this row
// (lib/island.js setNotchTabs), which looks for #main-tabs to hang from.

import Link from 'next/link';
import { IS_DEMO } from '../../lib/demo';

// One calm style for every tab (Blake, 2026-10-05: the tabs looked like "gradient
// AI" and "the colours make no sense"): the look's secondary words, a touch
// brighter on hover, and the one you're on a solid pill with the primary words.
// No gradients and no colour of its own per tab; app/globals.css .sd-tab draws
// them, so every look, and frosted glass or soft, draws them its way.
const MODES = [
  { key: 'network', label: 'Network Circle', short: 'Circle' },
  { key: 'degrees', label: 'Degrees' },
  { key: 'separation', label: 'Separation' },
];
const PAGES = [
  { key: 'paths', href: '/paths', label: 'Paths', demo: true },
  // Insights isn't a tab: it's in your Profile, behind ✦ Insights (Blake, 2026-10-04:
  // "insights that should be in the profile where the button already is as that makes
  // more sense and not to add a tab"). /insights forwards there.
  // Social is part of Outlink now (Messages & follow-ups); /social forwards there.
  { key: 'outlink', href: '/queue', label: 'Outlink', own: true },
  { key: 'scan', href: '/setup', label: 'Scan', own: true },
];

/**
 * @param {{ active: string, isMobile?: boolean, csvMode?: boolean, onMode?: (key: string) => void,
 *   children?: any, after?: any }} props
 *   `children` sits after the map's tabs (the map page's sample or CSV chip),
 *   `after` at the end of the row (the Auto scan button). `own` pages (Outlink,
 *   Scan) need your own network, so they hide for the sample or a CSV.
 */
export default function AppTabs({ active, isMobile = false, csvMode = false, onMode, children, after }) {
  const base = { padding: isMobile ? '6px 10px' : '8px 16px', fontSize: isMobile ? 11 : 13, textDecoration: 'none', display: 'flex', alignItems: 'center' };
  return (
    <div id="main-tabs" data-glass-panel="bar" style={{ display: 'flex', gap: isMobile ? 2 : 4, padding: isMobile ? 2 : 3, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
      {MODES.map((m) => {
        const on = active === m.key;
        const label = isMobile && m.short ? m.short : m.label;
        return onMode
          ? <button key={m.key} type="button" className="sd-tab" aria-current={on ? 'page' : undefined} onClick={() => onMode(m.key)} style={base}>{label}</button>
          : <Link key={m.key} href={`/?mode=${m.key}`} className="sd-tab" aria-current={on ? 'page' : undefined} style={base}>{label}</Link>;
      })}
      {children}
      {PAGES.filter((p) => (IS_DEMO ? false : p.own ? !csvMode : true)).map((p) => (
        <Link key={p.key} href={p.href} title={p.title} className="sd-tab" aria-current={active === p.key ? 'page' : undefined} style={base}>
          {p.label}{p.badge && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>{p.badge}</span>}
        </Link>
      ))}
      {after}
    </div>
  );
}
