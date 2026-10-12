'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import GalaxyLab, { NamesSwitch } from './GalaxyLab';
import { TIERS, GRID_DEGREES, showing, showingIn, toggleCell, toggleTier, toggleDegree, toggleTiers, showAllTiers } from '../../lib/tier-grid';
import { TIER_COLORS } from '../../lib/themes';
import EdgeToggle, { useEdgePanel } from './EdgeToggle';
import { LAB_DEFAULTS, LAYOUTS, drawsByDegree, labNow, setLab, watchLab } from '../../lib/galaxy-lab';
import { LINE_TIERS, cleanTierLines, toggleLineTier, isPicked, describeTierLines } from '../../lib/tier-lines';

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
  separation: {
    2: 'the people Separation ranks',
    3: 'ranked when a chain of scanned circles leads to them; company scans\u2019 finds are listed under the ranking, since nobody on file links you to them',
    4: 'ranked along a chain of scanned circles', 5: 'ranked along a chain of scanned circles', 6: 'ranked along a chain of scanned circles',
  },
  paths:{ 1: 'your connections', 2: 'people in a scanned circle', 3: 'people found by a company scan' },
};

/**
 * Tiers down, six degrees across: tap a tier to hide or show it, a dot to show
 * that degree for that tier, a number at the top for that degree in every tier.
 * The same in Network Circle, Degrees and Paths (lib/tier-grid.js).
 *
 * The word Tiers is a switch (Blake, 2026-10-12: "the user can click above where
 * it says tiers, it can be toggled off or on and turns off all the tiering and
 * leaves the user to pick which degree they want or not like usual"): off, the
 * tier rows fold away and a row of degrees is left, each with how many are at
 * it; on again, the rows come back as they were.
 */
export function TierGrid({ grid, counts, onChange, mode, isMobile }) {
  const total = showing(grid, counts);
  const tiersOff = Boolean(grid.tiersOff);
  const dot = isMobile ? 21 : 23;
  const anyAt = (d) => TIERS.some((t) => (counts[t]?.[d] || 0) > 0);
  const what = (d) => DEGREE_IS[mode]?.[d];
  // Separation: your connections are the ways in, and all of them stay, whatever their tier.
  const waysIn = mode === 'separation';
  // Degrees draws no one past the 2nd degree: the 3rd, the people company scans
  // find, is on Network Circle. Its dot says so instead of "no one yet", which
  // read as locked (Blake, 2026-10-03: "the 3rd one is locked even though … we
  // have 3rd degrees unlocked by now"). Separation has them (Blake, 2026-10-05).
  const elsewhere = (d) => d === 3 && mode === 'degrees';
  const emptyTitle = (d, t) => (waysIn && d === 1
    ? 'Every connection stays a way in here, whatever their tier: the tiers choose who is ranked'
    : elsewhere(d)
      ? `${t ? `${t}-Tier at 3rd degree` : '3rd degree'}, the people company scans find, isn't drawn here. Network Circle shows ${t ? 'them' : 'it'}.`
      : `No ${t ? `${t}-Tier ` : 'one '}at ${DEGREE_NAMES[d]} degree yet`);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: tiersOff ? 8 : 6 }}>
        <div style={{ flex: 1 }}>
          <button type="button" aria-pressed={!tiersOff} onClick={() => onChange(toggleTiers(grid))}
            title={tiersOff ? 'Tiers are off: everyone is in, whatever their tier. Tap to pick by tier again, as you had it' : 'Turn tiers off and pick by degree alone'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 0', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'inherit',
              color: tiersOff ? 'var(--sd-fg-4, #667)' : 'var(--sd-fg-3, #889)',
            }}>
            {/* A small switch, lit while the tiers are on */}
            <span aria-hidden="true" style={{
              position: 'relative', display: 'inline-block', width: 22, height: 12, borderRadius: 6, flexShrink: 0,
              background: tiersOff ? 'rgba(var(--sd-ink, 255, 255, 255), 0.16)' : 'var(--sd-accent, #3498DB)',
            }}>
              <span style={{ position: 'absolute', top: 2, left: tiersOff ? 2 : 12, width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
            </span>
            Tiers{tiersOff ? ' off' : ''}
          </button>
        </div>
        {/* A degree, for every tier at once */}
        {!tiersOff && <div style={{ display: 'flex', gap: 3 }}>
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
        </div>}
        {!tiersOff && <div style={{ width: 44 }} />}
      </div>

      {tiersOff ? <DegreeRow grid={grid} counts={counts} onChange={onChange} what={what} emptyTitle={emptyTitle} waysIn={waysIn} /> : (
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
                  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
                  // Ink-deepened on a light look, so S's gold reads on white (lib/themes.js --sd-tier-ink)
                  color: off ? 'var(--sd-fg-5, #555)' : `color-mix(in srgb, ${color} 58%, var(--sd-tier-ink, ${color}))`,
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
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #667)', lineHeight: 1.4 }}>
          {tiersOff
            ? waysIn ? 'Every tier is ranked. Tap a degree to leave it out.' : 'Every tier is in. Tap a degree to show or hide it.'
            : waysIn
              ? 'Tap a tier to leave it out of the ranking. Every connection stays a way in.'
              : 'Tap a tier to hide it, or a dot to show that degree.'}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #889)', whiteSpace: 'nowrap', marginLeft: 8 }}>
          {total.toLocaleString('en-US')} showing
          {!tiersOff && grid.hidden.length > 0 && (
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

/**
 * Tiers off: just the degrees, each with how many people are at it across every
 * tier, tapped to show or hide it like the numbers over the grid (toggleDegree).
 */
function DegreeRow({ grid, counts, onChange, what, emptyTitle, waysIn }) {
  const at = (d) => TIERS.reduce((n, t) => n + (counts[t]?.[d] || 0), 0);
  return (
    <div role="group" aria-label="Degrees" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
      {GRID_DEGREES.map((d) => {
        const people = at(d);
        // Separation: your connections are the ways in, whatever the filter.
        const fixed = waysIn && d === 1;
        const on = people > 0 && (fixed || grid.flat.includes(d));
        return (
          <button key={d} type="button" disabled={!people || fixed} aria-pressed={on}
            aria-label={`${DEGREE_NAMES[d]} degree`}
            title={fixed ? emptyTitle(d) : people
              ? `${people.toLocaleString('en-US')} at ${DEGREE_NAMES[d]} degree${what(d) ? `: ${what(d)}` : ''}. Tap to ${on ? 'hide' : 'show'} them`
              : emptyTitle(d)}
            onClick={() => onChange(toggleDegree(grid, d, counts))}
            style={{
              padding: '8px 4px', borderRadius: 8, textAlign: 'center', fontFamily: 'inherit', boxSizing: 'border-box',
              cursor: people && !fixed ? 'pointer' : 'default', opacity: fixed ? 0.6 : 1,
              border: !people ? '1px dashed rgba(var(--sd-ink, 255, 255, 255), 0.1)' : on ? '1px solid rgba(52,152,219,0.6)' : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)',
              background: on ? 'rgba(52,152,219,0.18)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
              color: !people ? 'var(--sd-fg-5, #445)' : on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-3, #889)',
            }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{DEGREE_NAMES[d]}</span>
            <span style={{ display: 'block', fontSize: 10.5, marginTop: 2, fontVariantNumeric: 'tabular-nums', color: 'var(--sd-fg-4, #778)' }}>
              {people.toLocaleString('en-US')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filters → Lines, on Network Circle's Galaxy (Blake, 2026-10-05: "enable tier
 * lines that basically show the S tier's lines of who it's connected to"): only
 * the lines that touch a tier you pick, or every line, or none. The dots all
 * stay; kept with the Galaxy's settings and put back by its Reset
 * (lib/galaxy-lab.js `tierLines`, lib/tier-lines.js).
 */
export function TierLines() {
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  // Degrees and the fan draw only the lines of the one you pick or point at
  // (Blake, 2026-10-12: "the connections are still showing the clusters"), so
  // the chips wait for the shapes by tier, keeping what you chose there.
  if (drawsByDegree(lab)) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sd-fg-5, #555)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Lines</div>
        <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #667)', lineHeight: 1.4 }}>
          In Degrees and the Wi-Fi fan only the lines of the person you pick, or point at, are drawn.
        </div>
      </div>
    );
  }
  const choice = cleanTierLines(lab.tierLines);
  const pick = (next) => setLab({ tierLines: next });
  const chip = { flex: 1, minWidth: 0, height: 28, padding: '0 2px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' };
  const plain = (on) => ({
    ...chip,
    border: on ? '1px solid rgba(52,152,219,0.6)' : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
    background: on ? 'rgba(52,152,219,0.18)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
    color: on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-3, #888)',
  });
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sd-fg-5, #555)', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Lines</div>
      <div role="group" aria-label="Which lines to draw" style={{ display: 'flex', gap: 4 }}>
        <button type="button" aria-pressed={choice === 'all'} title="Draw every line" onClick={() => pick('all')} style={plain(choice === 'all')}>All</button>
        {LINE_TIERS.map((t) => {
          const on = isPicked(choice, t);
          const color = TIER_COLORS[t];
          return (
            <button key={t} type="button" aria-pressed={on}
              aria-label={`Lines through ${t}-Tier`}
              title={on ? `Stop drawing ${t}-Tier's lines` : choice === 'all' || choice === 'none' ? `Draw only ${t}-Tier's lines` : `Draw ${t}-Tier's lines too`}
              onClick={() => pick(toggleLineTier(choice, t))}
              style={{
                ...chip, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                border: on ? `1.5px solid ${color}` : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
                background: on ? `${color}2e` : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
                // Ink-deepened on a light look, as the tier rows above are
                color: on ? `color-mix(in srgb, ${color} 58%, var(--sd-tier-ink, ${color}))` : 'var(--sd-fg-3, #888)',
              }}>
              <span className="sd-dot-html" style={{ width: 7, height: 7, borderRadius: '50%', background: color, opacity: on ? 1 : 0.55, flexShrink: 0 }} />
              {t}
            </button>
          );
        })}
        <button type="button" aria-pressed={choice === 'none'} title="Draw no lines, just the dots" onClick={() => pick('none')} style={plain(choice === 'none')}>None</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #667)', lineHeight: 1.4, marginTop: 6 }}>
        {choice === 'all' ? 'Show only the lines that run through the tiers you pick. The dots all stay.' : describeTierLines(choice)}
      </div>
    </div>
  );
}

/** A shape's picture (lib/galaxy-lab.js LAYOUTS `icon`): its lines in the text's colour unless they have their own. */
function ShapeIcon({ parts, size = 26 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      {parts.map((p, i) => (p.dot
        ? <circle key={i} cx={p.dot[0]} cy={p.dot[1]} r={p.dot[2]} fill={p.colour || 'currentColor'} stroke="none" />
        : <path key={i} d={p.d} stroke={p.colour || 'currentColor'} />))}
    </svg>
  );
}

/**
 * Filters → Shape, on Network Circle's Galaxy (Blake, 2026-10-12: "a new tab
 * within the filter panel thats called shape and shows different shapes within
 * the data points so we can always add more creative ways to see the data"):
 * a button for each of the Galaxy's layouts with its picture and a line on what
 * it shows, lit while the map is that shape. The list is lib/galaxy-lab.js
 * LAYOUTS, so a new shape is a row there. A pick is Network Circle's own
 * (app/page.js pickGalaxyLayout), the same as the Physics panel's Layout row.
 */
export function ShapeList({ current, onPick }) {
  return (
    <div>
      <div role="group" aria-label="Shapes" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {LAYOUTS.map((s) => {
          const on = current === s.key;
          return (
            <button key={s.key} type="button" aria-pressed={on} title={s.about} onClick={() => onPick(s.key)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 10,
              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box',
              border: on ? '1px solid rgba(52,152,219,0.6)' : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
              background: on ? 'rgba(52,152,219,0.14)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
            }}>
              <span style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 9, flexShrink: 0,
                background: on ? 'rgba(52,152,219,0.16)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.05)',
                color: on ? 'var(--sd-accent, #3498DB)' : 'var(--sd-fg-3, #99a)',
              }}>
                <ShapeIcon parts={s.icon} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-2, #ccd)' }}>{s.label}</span>
                <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.4, marginTop: 2, color: 'var(--sd-fg-4, #778)' }}>{s.line}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #667)', lineHeight: 1.4, marginTop: 10 }}>
        {current == null
          ? 'None is lit: the Physics sliders are set your own way. Pick a shape to start from it.'
          : 'Degrees and the Wi-Fi fan show every degree. Pick another shape and the filter you had comes back.'}
      </div>
    </div>
  );
}

const PANEL_TABS = [['filters', 'Filters'], ['shape', 'Shape']];
const tabId = (key) => `sd-filters-tab-${key}`;

/** The panel's two tabs, on Network Circle's Galaxy: Filters (who is on the map) and Shape (how it's drawn). */
function PanelTabs({ tab, onTab }) {
  const go = (key) => { onTab(key); document.getElementById(tabId(key))?.focus(); };
  return (
    <div role="tablist" aria-label="Filter panel" style={{
      display: 'flex', gap: 3, padding: 3, marginBottom: 14, borderRadius: 9,
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
    }}>
      {PANEL_TABS.map(([key, label], i) => {
        const on = tab === key;
        return (
          <button key={key} id={tabId(key)} type="button" role="tab" aria-selected={on} aria-controls={`${tabId(key)}-panel`}
            tabIndex={on ? 0 : -1} onClick={() => onTab(key)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              go(PANEL_TABS[(i + (e.key === 'ArrowRight' ? 1 : PANEL_TABS.length - 1)) % PANEL_TABS.length][0]);
            }}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700,
              background: on ? 'rgba(52,152,219,0.18)' : 'transparent',
              boxShadow: on ? 'inset 0 0 0 1px rgba(52,152,219,0.5)' : 'none',
              color: on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-3, #888)',
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function FilterPanel({ collapsed, onToggle, mode, visualMode, grid, gridCounts = {}, onGridChange, shape = null, onPickShape = null }) {
  const isMobile = useIsMobile();
  const isDegreesMode = mode === 'degrees' || mode === 'separation';
  // Filters and Shape, only on Network Circle's Galaxy: the other views have one shape.
  const hasShapes = !isDegreesMode && visualMode === 'galaxy' && Boolean(onPickShape);
  const [tab, setTab] = useState('filters');
  const panelTab = hasShapes ? tab : 'filters';
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
          {hasShapes && <PanelTabs tab={panelTab} onTab={setTab} />}

          <div role={hasShapes ? 'tabpanel' : undefined} id={hasShapes ? `${tabId(panelTab)}-panel` : undefined}
            aria-labelledby={hasShapes ? tabId(panelTab) : undefined}>
          {panelTab === 'shape' ? <ShapeList current={shape} onPick={onPickShape} /> : <>
          {/* Which tiers, at which degrees: the same grid in Network Circle and in Degrees */}
          <TierGrid grid={grid} counts={gridCounts} onChange={onGridChange} mode={mode} isMobile={isMobile} />

          {/* Network Circle's Galaxy: which of its lines are drawn, by tier. */}
          {!isDegreesMode && visualMode === 'galaxy' && <TierLines />}

          {/* Network Circle's Galaxy: the physics that lays it out is what this panel is for. */}
          {!isDegreesMode && visualMode === 'galaxy' && (isMobile ? <NamesSwitch /> : <GalaxyLab onPickLayout={onPickShape || undefined} />)}
          </>}
          </div>
        </div>
      </div>}
    </>
  );
}
