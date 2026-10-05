'use client';

import { useState, useEffect } from 'react';
import GalaxyLab, { NamesSwitch } from './GalaxyLab';
import { TIERS, GRID_DEGREES, showing, showingIn, toggleCell, toggleTier, toggleDegree, showAllTiers } from '../../lib/tier-grid';
import { TIER_COLORS } from '../../lib/themes';
import EdgeToggle, { useEdgePanel } from './EdgeToggle';

const PANEL_ID = 'sd-filters-panel';

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);
  return m;
}



const DEGREE_NAMES = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
// What each degree is, per tab: Network Circle draws people; Degrees draws bridges and their circles.
const DEGREE_IS = {
  network: { 1: 'your connections', 2: 'people in a scanned circle', 3: 'people found by a company scan' },
  degrees: { 1: 'your bridges', 2: 'people in their circles' },
  separation: { 2: 'the people Separation ranks' },
  paths:{ 1: 'your connections', 2: 'people in a scanned circle', 3: 'people found by a company scan' },
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
  // Separation: your connections are the ways in, and all of them stay, whatever their tier.
  const waysIn = mode === 'separation';
  // Degrees and Separation draw no one past the 2nd degree: the 3rd, the people
  // company scans find, is on Network Circle. Its dot says so instead of "no one
  // yet", which read as locked (Blake, 2026-10-03: "the 3rd one is locked even
  // though … we have 3rd degrees unlocked by now").
  const elsewhere = (d) => d === 3 && (mode === 'degrees' || mode === 'separation');
  const emptyTitle = (d, t) => (waysIn && d === 1
    ? 'Every connection stays a way in here, whatever their tier: the tiers choose who is ranked'
    : elsewhere(d)
      ? `${t ? `${t}-Tier at 3rd degree` : '3rd degree'}, the people company scans find, isn't drawn here. Network Circle shows ${t ? 'them' : 'it'}.`
      : `No ${t ? `${t}-Tier ` : 'one '}at ${DEGREE_NAMES[d]} degree yet`);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--sd-fg-5, #555)', letterSpacing: 1, textTransform: 'uppercase' }}>
          Tiers
        </div>
        {/* A degree, for every tier at once */}
        <div style={{ display: 'flex', gap: 3 }}>
          {GRID_DEGREES.map((d) => {
            const any = anyAt(d);
            const on = any && TIERS.every((t) => grid.hidden.includes(t) || !(counts[t]?.[d] > 0) || grid.degrees[t].includes(d));
            return (
              <button key={d} type="button" disabled={!any} aria-pressed={on}
                title={any ? `${DEGREE_NAMES[d]} degree${what(d) ? `: ${what(d)}` : ''}. Tap to ${on ? 'hide' : 'show'} it for every tier` : emptyTitle(d)}
                onClick={() => onChange(toggleDegree(grid, d, counts))}
                style={{
                  width: dot, height: 18, padding: 0, border: 'none', background: 'none', cursor: any ? 'pointer' : 'default',
                  fontSize: 10, fontWeight: 800, color: !any ? 'var(--sd-fg-5, #333)' : on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-4, #778)',
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
              background: off ? 'rgba(var(--sd-ink, 255, 255, 255), 0.02)' : `${color}14`,
              borderLeft: `3px solid ${off ? 'transparent' : color}`,
            }}>
              <button type="button" aria-pressed={!off} title={off ? `Show ${t}-Tier` : `Hide ${t}-Tier`}
                onClick={() => onChange(toggleTier(grid, t, counts))}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 6px 12px 10px',
                  border: 'none', background: 'none', cursor: 'pointer', color: off ? 'var(--sd-fg-5, #555)' : color, textAlign: 'left',
                }}>
                <span className="sd-dot-html" style={{ width: 11, height: 11, borderRadius: '50%', background: color, opacity: off ? 0.2 : 1, flexShrink: 0 }} />
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
                        : emptyTitle(d, t)}
                      onClick={() => onChange(toggleCell(grid, t, d, counts))}
                      style={{
                        width: dot, height: dot, padding: 0, borderRadius: '50%', boxSizing: 'border-box',
                        cursor: people ? 'pointer' : 'default', fontSize: 10, fontWeight: 800, lineHeight: 1,
                        border: waysIn && d === 1 ? `1px solid ${color}40` : !people ? '1px dashed rgba(var(--sd-ink, 255, 255, 255), 0.1)' : on ? `1.5px solid ${color}` : `1.5px solid ${color}70`,
                        background: on ? color : waysIn && d === 1 ? `${color}1f` : 'transparent',
                        color: waysIn && d === 1 ? `${color}90` : !people ? 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' : on ? '#0a0a1a' : `${color}b0`,
                        opacity: off && people ? 0.45 : 1,
                      }}>
                      {d}
                    </button>
                  );
                })}
              </div>
              <div style={{ width: 44, textAlign: 'right', paddingRight: 8, fontSize: 10.5, color: off || !n ? 'var(--sd-fg-5, #445)' : 'var(--sd-fg-3, #889)', fontVariantNumeric: 'tabular-nums' }}>
                {n.toLocaleString('en-US')}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #667)', lineHeight: 1.4 }}>
          {waysIn
            ? 'Tap a tier to leave it out of the ranking. Every connection stays a way in.'
            : 'Tap a tier to hide it, or a dot to show that degree.'}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #889)', whiteSpace: 'nowrap', marginLeft: 8 }}>
          {total.toLocaleString('en-US')} showing
          {grid.hidden.length > 0 && (
            <button type="button" onClick={() => onChange(showAllTiers(grid))} style={{
              marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 10, cursor: 'pointer',
              border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: 'var(--sd-fg-3, #aab)',
            }}>All tiers</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilterPanel({ collapsed, onToggle, mode, visualMode, grid, gridCounts = {}, onGridChange }) {
  const isMobile = useIsMobile();
  const isDegreesMode = mode === 'degrees' || mode === 'separation';
  // Open or closed, the round Filters button at the left edge (EdgeToggle): it
  // docks on the open panel's edge and closes it, so the panel has no Close row.
  const { shown, closing } = useEdgePanel(!collapsed);
  const edge = (
    <EdgeToggle side="left" label="Filters" open={!collapsed} onToggle={onToggle}
      panelId={PANEL_ID} width="320px" phoneWidth="min(80vw, 300px)" />
  );
  // One shape, open or not, so React keeps the same button and it can travel.
  return (
    <>
      {edge}
      {shown && <div style={isMobile ? {
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100,
        width: '100vw', pointerEvents: closing ? 'none' : 'auto',
      } : { flexShrink: 0, height: '100%' }}>
        {isMobile && <div className={`sd-edge-scrim${closing ? ' is-closing' : ''}`} onClick={onToggle} style={{ position: 'absolute', inset: 0, background: 'rgba(var(--sd-shade, 0, 0, 0), 0.5)' }} />}
        <div id={PANEL_ID} className={`sd-edge-panel sd-edge-panel-left${closing ? ' is-closing' : ''}`} data-glass-panel={isMobile ? undefined : 'side'} style={{
          width: isMobile ? '80vw' : 320, minWidth: isMobile ? 0 : 320, maxWidth: isMobile ? 300 : 320, height: '100%',
          borderRight: '1px solid rgba(52,152,219,0.15)',
          padding: isMobile ? '12px 10px' : '16px 14px',
          overflowY: 'auto', overflowX: 'hidden',
          background: isMobile ? 'var(--sd-surface, rgba(10,15,30,0.98))' : 'var(--sd-panel)', fontSize: 13,
          backdropFilter: 'var(--sd-panel-blur)', WebkitBackdropFilter: 'var(--sd-panel-blur)',
          boxShadow: 'inset 0 0 60px rgba(52,152,219,0.04), 4px 0 24px rgba(0,0,0,0.3)',
        }}>
          {/* Which tiers, at which degrees: the same grid in Network Circle and in Degrees */}
          <TierGrid grid={grid} counts={gridCounts} onChange={onGridChange} mode={mode} isMobile={isMobile} />

          {/* Network Circle's Galaxy: the physics that lays it out is what this panel is for. */}
          {!isDegreesMode && visualMode === 'galaxy' && (isMobile ? <NamesSwitch /> : <GalaxyLab />)}
        </div>
      </div>}
    </>
  );
}
