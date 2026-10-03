'use client';

import { useState, useEffect } from 'react';
import GalaxyLab, { NamesSwitch } from './GalaxyLab';
import { TIERS, GRID_DEGREES, showing, showingIn, toggleCell, toggleTier, toggleDegree, showAllTiers } from '../../lib/tier-grid';

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);
  return m;
}

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };


const DEGREE_NAMES = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
// What each degree is, per tab: Network Circle draws people; Degrees draws bridges and their circles.
const DEGREE_IS = {
  network: { 1: 'your connections', 2: 'people in a scanned circle', 3: 'people found by a company scan' },
  degrees: { 1: 'your bridges', 2: 'people in their circles' },
  paths: { 1: 'your connections', 2: 'people in a scanned circle', 3: 'people found by a company scan' },
};

/**
 * Tiers down, six degrees across: tap a tier to hide or show it, a dot to show
 * that degree for that tier, a number at the top for that degree in every tier.
 * The same in Network Circle, Degrees and Paths (lib/tier-grid.js).
 */
export function TierGrid({ grid, counts, onChange, mode, isMobile }) {
  const total = showing(grid, counts);
  const dot = isMobile ? 21 : 23;
  const anyAt = (d) => TIERS.some((t) => (counts[t]?.[d] || 0) > 0);
  const what = (d) => DEGREE_IS[mode]?.[d];
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase' }}>
          Tiers
        </div>
        {/* A degree, for every tier at once */}
        <div style={{ display: 'flex', gap: 3 }}>
          {GRID_DEGREES.map((d) => {
            const any = anyAt(d);
            const on = any && TIERS.every((t) => grid.hidden.includes(t) || !(counts[t]?.[d] > 0) || grid.degrees[t].includes(d));
            return (
              <button key={d} type="button" disabled={!any} aria-pressed={on}
                title={any ? `${DEGREE_NAMES[d]} degree${what(d) ? `: ${what(d)}` : ''}. Tap to ${on ? 'hide' : 'show'} it for every tier` : `Nobody at ${DEGREE_NAMES[d]} degree yet`}
                onClick={() => onChange(toggleDegree(grid, d, counts))}
                style={{
                  width: dot, height: 18, padding: 0, border: 'none', background: 'none', cursor: any ? 'pointer' : 'default',
                  fontSize: 10, fontWeight: 800, color: !any ? '#333' : on ? '#cfe6f7' : '#778',
                }}>
                {d}
              </button>
            );
          })}
        </div>
        <div style={{ width: 44 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {TIERS.map((t) => {
          const off = grid.hidden.includes(t);
          const n = showingIn(grid, counts, t);
          const color = TIER_COLORS[t];
          return (
            <div key={t} style={{
              display: 'flex', alignItems: 'center', borderRadius: 8,
              background: off ? 'rgba(255,255,255,0.02)' : `${color}14`,
              borderLeft: `3px solid ${off ? 'transparent' : color}`,
            }}>
              <button type="button" aria-pressed={!off} title={off ? `Show ${t}-Tier` : `Hide ${t}-Tier`}
                onClick={() => onChange(toggleTier(grid, t, counts))}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 6px 12px 10px',
                  border: 'none', background: 'none', cursor: 'pointer', color: off ? '#555' : color, textAlign: 'left',
                }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, opacity: off ? 0.2 : 1, flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', textDecoration: off ? 'line-through' : 'none' }}>{t}-Tier</span>
              </button>
              <div style={{ display: 'flex', gap: 3 }}>
                {GRID_DEGREES.map((d) => {
                  const people = counts[t]?.[d] || 0;
                  const on = !off && people > 0 && grid.degrees[t].includes(d);
                  return (
                    <button key={d} type="button" disabled={!people} aria-pressed={on}
                      aria-label={`${t}-Tier at ${DEGREE_NAMES[d]} degree`}
                      title={people
                        ? `${people.toLocaleString('en-US')} ${t}-Tier at ${DEGREE_NAMES[d]} degree. Tap to ${on ? 'hide' : 'show'} them`
                        : `No ${t}-Tier at ${DEGREE_NAMES[d]} degree yet`}
                      onClick={() => onChange(toggleCell(grid, t, d, counts))}
                      style={{
                        width: dot, height: dot, padding: 0, borderRadius: '50%', boxSizing: 'border-box',
                        cursor: people ? 'pointer' : 'default', fontSize: 10, fontWeight: 800, lineHeight: 1,
                        border: !people ? '1px dashed rgba(255,255,255,0.1)' : on ? `1.5px solid ${color}` : `1.5px solid ${color}70`,
                        background: on ? color : 'transparent',
                        color: !people ? 'rgba(255,255,255,0.12)' : on ? '#0a0a1a' : `${color}b0`,
                        opacity: off && people ? 0.45 : 1,
                      }}>
                      {d}
                    </button>
                  );
                })}
              </div>
              <div style={{ width: 44, textAlign: 'right', paddingRight: 8, fontSize: 10.5, color: off || !n ? '#445' : '#889', fontVariantNumeric: 'tabular-nums' }}>
                {n.toLocaleString('en-US')}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ fontSize: 10, color: '#667', lineHeight: 1.4 }}>
          Tap a tier to hide it, or a dot to show that degree.
        </div>
        <div style={{ fontSize: 10.5, color: '#889', whiteSpace: 'nowrap', marginLeft: 8 }}>
          {total.toLocaleString('en-US')} showing
          {grid.hidden.length > 0 && (
            <button type="button" onClick={() => onChange(showAllTiers(grid))} style={{
              marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 10, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#aab',
            }}>All tiers</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilterPanel({ collapsed, onToggle, mode, visualMode, grid, gridCounts = {}, onGridChange }) {
  const isMobile = useIsMobile();
  const isDegreesMode = mode === 'degrees';

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

        {/* Which tiers, at which degrees: the same grid in Network Circle and in Degrees */}
        <TierGrid grid={grid} counts={gridCounts} onChange={onGridChange} mode={isDegreesMode ? 'degrees' : 'network'} isMobile={isMobile} />

        {/* Network Circle's Galaxy: the physics that lays it out is what this panel is for. */}
        {!isDegreesMode && visualMode === 'galaxy' && (isMobile ? <NamesSwitch /> : <GalaxyLab />)}
      </div>
    </div>
  );
}
