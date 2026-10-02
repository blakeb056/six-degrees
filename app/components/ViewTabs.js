'use client';

// The views of the tab you're on (Galaxy, Pyramid, List; Bridge Chains,
// Separation…), as one small row at the top of the map. They used to be a list
// at the top of the Filters panel, which made that panel half view-switcher,
// half filters. Now the row switches the view and the panel only filters
// (Blake, 2026-10-02: "the filter section to the left is dedicated for
// adjusting the tiers, degrees and etc"). The same row is meant for every
// page's own sub-tabs, so each page reads the same way.

import { viewsForMode } from './views';

export default function ViewTabs({ mode, current, onChange, left = 16, isMobile = false }) {
  const views = viewsForMode(mode);
  if (views.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="View"
      style={{
        position: 'absolute', top: isMobile ? 8 : 12, left, zIndex: 25, display: 'flex', gap: 2, padding: 3,
        maxWidth: `calc(100% - ${left + 16}px)`, overflowX: 'auto',
        borderRadius: 10, background: 'rgba(10,15,30,0.82)', border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      {views.map((v) => {
        const on = v.key === current;
        return (
          <button
            key={v.key}
            role="tab"
            aria-selected={on}
            title={v.desc}
            onClick={() => onChange(v.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 9px' : '5px 12px',
              borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 12, fontWeight: 600,
              background: on ? 'rgba(52,152,219,0.2)' : 'transparent',
              color: on ? '#cfe6f7' : '#8b9aa8',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 12 }}>{v.icon}</span>
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
