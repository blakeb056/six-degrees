'use client';

import { useState, useEffect } from 'react';
import GalaxyLab, { NamesSwitch } from './GalaxyLab';

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);
  return m;
}

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };


export default function FilterPanel({ collapsed, onToggle, mode, filter, onFilterChange, visualMode, onVisualModeChange, tierCounts, bridgeTierCounts, degrees = [1], onDegreesChange, degreeCounts = {}, hiddenTiers = [], onHiddenTiersChange }) {
  const isMobile = useIsMobile();
  const isDegreesMode = mode === 'degrees';
  // Network Circle: each tier switches on and off, so the noisy ones (C, D) can go
  // while the rest stay. Degrees keeps one tier at a time.
  const toggles = !isDegreesMode && !!onHiddenTiersChange;
  const counts = isDegreesMode ? (bridgeTierCounts || {}) : (tierCounts || {});
  const allCount = isDegreesMode
    ? Object.values(bridgeTierCounts || {}).reduce((s, v) => s + v, 0)
    : Object.values(tierCounts || {}).reduce((s, v) => s + v, 0);

  if (collapsed) {
    return (
      <div
        onClick={onToggle}
        style={{
          position: 'fixed', left: 16, top: 140, zIndex: 30, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 0,
          height: 36, borderRadius: 18,
          background: 'rgba(52,152,219,0.15)', border: '2px solid rgba(52,152,219,0.5)',
          color: '#3498DB', fontWeight: 700,
          boxShadow: '0 0 12px rgba(52,152,219,0.3)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          overflow: 'hidden', transition: 'width 0.25s ease',
          width: 36,
          padding: '0 10px',
        }}
        onMouseEnter={e => { e.currentTarget.style.width = '120px'; }}
        onMouseLeave={e => { e.currentTarget.style.width = '36px'; }}
      >
        <span style={{ fontSize: 18, flexShrink: 0, width: 16, textAlign: 'center' }}>›</span>
        <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 6, opacity: 0.9 }}>Filters</span>
      </div>
    );
  }

  return (
    <div style={isMobile ? {
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100,
      width: '100vw', pointerEvents: 'auto',
    } : { flexShrink: 0, height: '100%' }}>
      {isMobile && <div onClick={onToggle} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />}
      <div style={{
        width: isMobile ? '80vw' : 320, minWidth: isMobile ? 0 : 320, maxWidth: isMobile ? 300 : 320, height: '100%',
        borderRight: '1px solid rgba(52,152,219,0.15)',
        padding: isMobile ? '12px 10px' : '16px 14px',
        overflowY: 'auto', overflowX: 'hidden',
        background: isMobile ? 'rgba(10,15,30,0.98)' : 'rgba(10,15,30,0.65)', fontSize: 13,
        backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
        boxShadow: 'inset 0 0 60px rgba(52,152,219,0.04), 4px 0 24px rgba(0,0,0,0.3)',
      }}>
        {/* Close button */}
        <button
          onClick={onToggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, color: '#aaa', fontSize: 12, cursor: 'pointer',
            padding: '6px 12px', marginBottom: 14, fontWeight: 600, width: '100%',
          }}
        >
          <span style={{ fontSize: 16 }}>›</span> Close
        </button>

        {/* Tier Filters */}
        {/* Network Circle: which degrees to draw. Any mix, never none: 2nd and
            3rd without your own connections shows who's valuable outside them. */}
        {!isDegreesMode && onDegreesChange && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
              Degree
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[[1, '1st', 'Your connections'], [2, '2nd', 'In a scanned circle'], [3, '3rd', 'Found by a company scan']].map(([d, label, what]) => {
                const on = degrees.includes(d);
                const count = degreeCounts[d] || 0;
                const last = on && degrees.length === 1;
                return (
                  <button
                    key={d}
                    title={`${what}: ${count.toLocaleString()}${last ? ' (keep at least one)' : ''}`}
                    aria-pressed={on}
                    disabled={last || (!on && !count)}
                    onClick={() => onDegreesChange(on ? degrees.filter((x) => x !== d) : [...degrees, d].sort())}
                    style={{
                      flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                      cursor: last || (!on && !count) ? 'default' : 'pointer',
                      border: on ? '1px solid rgba(52,152,219,0.6)' : '1px solid rgba(255,255,255,0.08)',
                      background: on ? 'rgba(52,152,219,0.18)' : 'rgba(255,255,255,0.03)',
                      color: on ? '#cfe6f7' : count ? '#888' : '#444',
                    }}
                  >
                    {label}
                    <div style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.8, marginTop: 2 }}>{count.toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isDegreesMode && visualMode === 'galaxy' && <NamesSwitch />}

        <div style={{ marginBottom: 18 }}>
          {/* In Degrees these chips filter by the tier of the connection who
              introduces you, not the person reached — Separation has its own
              "Their tier" chips for that, so the two must not read alike. */}
          <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
            {isDegreesMode ? 'Filter by bridge tier' : 'Filter'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* All button */}
            <button
              onClick={() => (toggles ? onHiddenTiersChange([]) : onFilterChange && onFilterChange('all'))}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', width: '100%',
                background: (toggles ? !hiddenTiers.length : filter === 'all') ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
                color: (toggles ? !hiddenTiers.length : filter === 'all') ? '#fff' : '#888',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>All</span>
              <span style={{ fontSize: 10, color: '#555' }}>{allCount}</span>
            </button>
            {/* Tier buttons */}
            {toggles && (
              <div style={{ fontSize: 10, color: '#667', margin: '2px 2px 4px' }}>Click a tier to hide or show it</div>
            )}
            {toggles && ['S', 'A', 'B', 'C', 'D'].map(t => {
              const on = !hiddenTiers.includes(t);
              const last = on && hiddenTiers.length >= 4;
              return (
                <button
                  key={t}
                  aria-pressed={on}
                  title={last ? 'Keep at least one tier showing' : on ? `Hide ${t}-Tier` : `Show ${t}-Tier`}
                  onClick={() => !last && onHiddenTiersChange(on ? [...hiddenTiers, t] : hiddenTiers.filter(x => x !== t))}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: 6, border: 'none', cursor: last ? 'default' : 'pointer', width: '100%',
                    background: on ? `${TIER_COLORS[t]}14` : 'rgba(255,255,255,0.02)',
                    color: on ? TIER_COLORS[t] : '#555',
                    borderLeft: on ? `3px solid ${TIER_COLORS[t]}` : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLORS[t], opacity: on ? 1 : 0.2 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, textDecoration: on ? 'none' : 'line-through' }}>{t}-Tier</span>
                    {!on && <span style={{ fontSize: 9.5, color: '#667' }}>hidden</span>}
                  </div>
                  <span style={{ fontSize: 10, color: '#555' }}>{counts[t] || 0}</span>
                </button>
              );
            })}
            {!toggles && ['S', 'A', 'B', 'C', 'D'].map(t => (
              <button
                key={t}
                onClick={() => onFilterChange && onFilterChange(t)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', width: '100%',
                  background: filter === t ? `${TIER_COLORS[t]}20` : 'rgba(255,255,255,0.03)',
                  color: filter === t ? TIER_COLORS[t] : '#888',
                  borderLeft: filter === t ? `3px solid ${TIER_COLORS[t]}` : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: TIER_COLORS[t], opacity: filter === t ? 1 : 0.4,
                  }} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{t}-Tier</span>
                </div>
                <span style={{ fontSize: 10, color: '#555' }}>{counts[t] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* The Galaxy's physics lab (experimental): sliders and a replay, on a computer. */}
        {!isDegreesMode && visualMode === 'galaxy' && !isMobile && <GalaxyLab />}

        {/* Stats */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
            Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.entries(counts).filter(([k]) => ['S', 'A', 'B'].includes(k)).map(([tier, count]) => (
              <div key={tier} style={{
                padding: '6px 8px', borderRadius: 6,
                background: `${TIER_COLORS[tier]}10`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: TIER_COLORS[tier] }}>{count}</div>
                <div style={{ fontSize: 8, color: '#555' }}>{tier}-Tier</div>
              </div>
            ))}
            <div style={{
              padding: '6px 8px', borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{allCount}</div>
              <div style={{ fontSize: 8, color: '#555' }}>Total</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
