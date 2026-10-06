'use client';

// Separation → Gatekeepers (the strategy engine, experimental): your
// connections ranked by Leverage, their position in your network, with the
// blunt reason under each name. A separate lens: power and tiers are shown as
// they are and never changed (lib/strategy-engine.js).
//
// Only people whose circle is scanned are ranked. The rest are counted under
// the list as not enough data, never given a low number (TRAPS §7).

import { useMemo } from 'react';
import Avatar from './Avatar';
import { keyFor } from '../../lib/separation';
import { whyLine } from '../../lib/strategy-engine';

export const GATE = '#B388FF';   // the strategy engine's own colour: not a tier's, not Rare's cyan
const COLUMNS = '52px 36px minmax(0,1.6fr) 104px 112px 132px';
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** Their entry, row and words, best Leverage first; and how many have no measured position. */
export function gatekeeperRows(connections = [], people = null, { tier = 'all', q = '' } = {}) {
  const ranked = [];
  let unscanned = 0;
  const seen = new Set();
  for (const c of connections || []) {
    if (!c || c.degree !== 1) continue;
    const key = keyFor(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (tier !== 'all' && c.tier !== tier) continue;
    if (q && !`${c.name || ''} ${c.headline || ''} ${c.company || ''}`.toLowerCase().includes(q)) continue;
    const e = people?.[key];
    if (!e || e.status !== 'measured') { unscanned += 1; continue; }
    ranked.push({ key, row: c, e, why: whyLine(e) });
  }
  ranked.sort((a, b) => a.e.rank - b.e.rank);
  return { ranked, unscanned };
}

export default function GatekeeperList({ connections, strategy, tierColors, onSelect, selectedKey, isMobile, tier, q }) {
  const { ranked, unscanned } = useMemo(() => gatekeeperRows(connections, strategy.people, { tier, q }), [connections, strategy.people, tier, q]);
  const cols = isMobile ? '40px 36px 1fr 52px' : COLUMNS;

  if (strategy.error) {
    return <Note tone="error">The strategy engine couldn&rsquo;t read your network: {strategy.error}</Note>;
  }
  if (strategy.loading) return <Note>Working out who gatekeeps whom…</Note>;

  return (
    <div data-gatekeepers="" style={{ maxWidth: 980, margin: '0 auto', paddingBottom: 72 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '12px 8px 8px' : '14px 12px 10px 15px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>Gatekeepers</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#000', background: GATE, borderRadius: 10, padding: '2px 8px' }}>{fmt(ranked.length)}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--sd-gold, #FFD700)', letterSpacing: 0.5 }}>EXPERIMENTAL</span>
        <span style={{ marginLeft: isMobile ? 0 : 'auto', fontSize: 11, color: 'var(--sd-fg-4, #777)' }}>
          ranked by position in your network · power and tiers unchanged
        </span>
      </div>
      {ranked.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', padding: '0 12px 6px 15px',
          fontSize: 9, fontWeight: 700, color: 'var(--sd-fg-5, #555)', textTransform: 'uppercase', letterSpacing: 0.5,
          borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
        }}>
          <span>#</span><span />
          <span>Connection · why</span>
          {!isMobile && <>
            <span title="People you can reach only through them: take them away and these are cut off">Only through them</span>
            <span title="Distinct industries and companies in their circle">Spans</span>
          </>}
          <span style={{ textAlign: 'right' }} title="0–100, from exclusive reach, betweenness and span. Tier plays no part.">Leverage</span>
        </div>
      )}
      {ranked.map(({ key, row, e, why }) => (
        <GateRow key={key} row={row} e={e} why={why} cols={cols} isMobile={isMobile}
          selected={key === selectedKey} tierColors={tierColors} onSelect={onSelect} />
      ))}
      {ranked.length === 0 && (
        <Note>{unscanned > 0
          ? 'No one to rank yet: no circle these filters show has been scanned.'
          : 'No one here with those filters.'}</Note>
      )}
      {unscanned > 0 && (
        <div style={{ padding: isMobile ? '14px 8px' : '16px 15px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--sd-fg-3, #99a)', borderTop: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.06)' }}>
          <b style={{ color: 'var(--sd-fg-2, #ccd)' }}>{fmt(unscanned)} not ranked: not enough data.</b>{' '}
          Their circles aren&rsquo;t scanned yet, so where they stand is unknown, not low. Scanning a circle ranks them.
        </div>
      )}
    </div>
  );
}

function GateRow({ row, e, why, cols, isMobile, selected, tierColors, onSelect }) {
  const c = tierColors[row.tier] || '#888';
  const lev = e.leverage ?? 0;
  return (
    <div role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`Rank ${e.rank}, ${row.name}, leverage ${lev}. ${why}`}
      onClick={() => onSelect?.(row)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect?.(row); } }}
      className="seprow"
      style={{
        display: 'grid', gridTemplateColumns: cols, gap: 10, alignItems: 'center', minHeight: isMobile ? 64 : 56,
        padding: '6px 12px', boxSizing: 'border-box', cursor: 'pointer',
        borderLeft: `3px solid ${selected ? '#FF6B35' : 'transparent'}`,
        borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)',
        background: selected ? 'rgba(255,107,53,0.08)' : 'transparent',
      }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: e.rank <= 3 ? GATE : 'var(--sd-fg-5, #555)' }}>#{e.rank}</span>
      <Avatar person={row} size={32} tierColors={tierColors} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600 }}>{row.name}</span>
          <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: c, border: `1px solid ${c}55`, borderRadius: 4, padding: '0 4px' }}>{row.tier}</span>
          {e.gatekeeper && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: GATE, border: `1px solid ${GATE}66`, borderRadius: 4, padding: '0 4px' }}>GATEKEEPER</span>}
        </div>
        <div style={{ ...(isMobile ? {} : ellipsis), fontSize: 11, color: 'var(--sd-fg-3, #99a)', marginTop: 2, lineHeight: 1.35 }}>{why}</div>
      </div>
      {!isMobile && <>
        <span style={{ fontSize: 13, fontWeight: 700, color: e.only > 0 ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-5, #556)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(e.only)}<span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--sd-fg-4, #778)' }}> of {fmt(e.circle)}</span>
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--sd-fg-2, #bbc)' }}>
          {e.span.industries} {e.span.industries === 1 ? 'industry' : 'industries'}
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--sd-fg-4, #778)' }}>{fmt(e.span.companies)} {e.span.companies === 1 ? 'company' : 'companies'}</span>
        </span>
      </>}
      <LeverageBadge value={lev} isMobile={isMobile} />
    </div>
  );
}

/** Leverage as a bar and its number; just the number on a phone. */
export function LeverageBadge({ value, isMobile, small }) {
  if (value == null) return null;
  if (small) {
    return (
      <span title={`Leverage ${value} of 100: position in your network (experimental)`} style={{
        flexShrink: 0, padding: '0 5px', borderRadius: 4, fontSize: 9.5, fontWeight: 800,
        color: GATE, border: `1px solid ${GATE}55`, background: `${GATE}12`, fontVariantNumeric: 'tabular-nums',
      }}>L {value}</span>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
      {!isMobile && (
        <div style={{ flex: 1, height: 6, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', borderRadius: 3 }}>
          <div style={{ height: '100%', borderRadius: 3, background: GATE, width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
      )}
      <span style={{ fontSize: 15, fontWeight: 800, color: GATE, width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function Note({ children, tone }) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: tone === 'error' ? 'var(--sd-red, #ff7676)' : 'var(--sd-fg-3, #888)' }}>
      {children}
    </div>
  );
}
