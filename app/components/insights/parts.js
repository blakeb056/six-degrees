'use client';

// The small pieces the Insights tab is built from: tier chips with their
// letter on them (C and D are two greys too close to tell apart by colour),
// rarity tags, the 1st / 2nd chip, the person cell, cards and the line under
// a number that says where it came from. Colours are the look's own: the
// theme's dot colours (lib/themes.js TIER_COLORS, a live object) and the
// --sd-* variables, so a light look reads as well as the dark ones.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Avatar from '../Avatar';
import { TIER_COLORS, luminance } from '../../../lib/themes';
import { RARITY } from '../../../lib/rarity';
import { roleLine } from '../../../lib/insights-board';
import { markRequested } from '../../../lib/requests-client';
import ConnectChoice, { secondaryLook } from '../AutoConnect';

export const fmt = (n) => Number(n || 0).toLocaleString('en-US');
export const one = (x) => (Math.round(Number(x || 0) * 10) / 10).toFixed(1);
export const pc = (x) => `${Math.round(Number(x) || 0)}%`;
export const RARITY_BY_KEY = Object.fromEntries(RARITY.map((r) => [r.key, r]));
export const LINE = 'rgba(var(--sd-ink, 255, 255, 255), 0.08)';
export const SOFT_LINE = 'rgba(var(--sd-ink, 255, 255, 255), 0.05)';
export const CARD_BG = 'rgba(var(--sd-ink, 255, 255, 255), 0.035)';

export function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.matchMedia('(max-width: 767px)').matches);   // the window's width, as AppHeader's
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return m;
}

/** Black or white, whichever reads on a colour. */
export function inkOn(hex) {
  try { return luminance(hex) > 0.36 ? '#000' : '#fff'; } catch { return '#000'; }
}
export const tierColor = (tier) => TIER_COLORS[tier] || '#888888';

/** A tier as a filled chip with its letter. */
export function TierChip({ tier, size = 20 }) {
  if (!tier) return null;
  const c = tierColor(tier);
  return (
    <span aria-label={`${tier} tier`} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      minWidth: size, height: size, padding: '0 4px', borderRadius: Math.round(size / 4),
      background: c, color: inkOn(c), fontSize: Math.round(size * 0.56), fontWeight: 800, lineHeight: 1,
    }}>{tier}</span>
  );
}

/** "1st" or "2nd". */
export function DegreeChip({ degree }) {
  const first = degree === 1;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: 0.2, flexShrink: 0, whiteSpace: 'nowrap',
      background: first ? 'rgba(0,255,136,0.1)' : 'rgba(255,107,53,0.1)',
      border: `1px solid ${first ? 'rgba(0,255,136,0.3)' : 'rgba(255,107,53,0.3)'}`,
      color: first ? 'var(--sd-green, #7dffc0)' : 'var(--sd-orange, #ffab8a)',
    }}>{first ? '1st' : '2nd'}</span>
  );
}

/** How rare the way in is, and the count: "+" where it's the ways your scans saw (a floor). */
export function RarityTag({ rarity, count = true, small = false }) {
  if (!rarity) return null;
  const r = RARITY_BY_KEY[rarity.key];
  const title = rarity.from === 'linkedin'
    ? `${fmt(rarity.count)} mutual connection${rarity.count === 1 ? '' : 's'}, LinkedIn’s own count`
    : `${fmt(rarity.count)} way${rarity.count === 1 ? '' : 's'} in seen in your scans, which can only go up`;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: small ? 11 : 11.5, color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>
      <i className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
      {r.label}
      {count && <span style={{ color: 'var(--sd-fg-4, #6f7a88)', fontSize: 10.5 }}>{fmt(rarity.count)}{rarity.from === 'linkedin' ? '' : '+'}</span>}
    </span>
  );
}

/** Face, name, tier and the role their score is built on. */
export function PersonCell({ row, size = 34, chip = true, sub }) {
  const { title, company } = roleLine(row);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar person={row} size={size} tierColors={TIER_COLORS} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <b style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--sd-fg-1, #fff)', ...ELLIPSIS }}>{row?.name || 'Someone'}</b>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', minWidth: 0 }}>
          {chip && <TierChip tier={row?.tier} size={15} />}
          <span style={ELLIPSIS}>{sub ?? [title, company].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
    </span>
  );
}

export const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

/** The page's title, in the tab's own colours (plain ink on Analyst, which takes gradients off). */
export const TITLE = {
  margin: 0, fontSize: 34, fontWeight: 850, letterSpacing: -0.6, lineHeight: 1.1,
  background: 'linear-gradient(135deg, var(--sd-gold, #FFD700) 10%, var(--sd-orange, #FF6B35) 60%, var(--sd-purple, #9B59B6))',
  WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
};

/** A board's title and the one line under it. */
export function Hero({ title, children, isMobile, right }) {
  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-end', gap: isMobile ? 10 : 24, marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ ...TITLE, fontSize: isMobile ? 27 : 34 }}>{title}</h1>
        <p style={{ margin: '5px 0 0', color: 'var(--sd-fg-2, #b8c4c4)', fontSize: isMobile ? 13 : 14, lineHeight: 1.45 }}>{children}</p>
      </div>
      {right}
    </div>
  );
}

/** A card, as the rail and the boards draw them. */
export function Card({ children, style, dashed = false, id }) {
  return (
    <section id={id} style={{
      border: dashed ? '1px dashed rgba(255,215,0,0.35)' : `1px solid ${LINE}`, borderRadius: 14,
      background: dashed ? 'rgba(255,215,0,0.04)' : CARD_BG, padding: '13px 14px 10px', minWidth: 0, ...style,
    }}>{children}</section>
  );
}

/** A card's title, its line under it, and a link to its board. */
export function CardHead({ title, sub, more, onMore }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 750, color: 'var(--sd-fg-1, #fff)' }}>{title}</h3>
        {more && <button type="button" onClick={onMore} style={LINK_BTN}>{more}</button>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', margin: '2px 0 6px', lineHeight: 1.4 }}>{sub}</div>}
    </>
  );
}

export const LINK_BTN = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: 'var(--sd-blue, #3498DB)', whiteSpace: 'nowrap', fontWeight: 600 };

/** Where a number came from, under it. */
export function Src({ children, style }) {
  if (!children) return null;
  return <div style={{ fontSize: 11, color: 'var(--sd-fg-4, #6f7a88)', lineHeight: 1.5, marginTop: 6, ...style }}>{children}</div>;
}

/** A row in a rail card: rank, who, and a number on the right with what it counts. */
export function MiniRow({ rank, left, value, valueColor, label, first }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderTop: first ? 'none' : `1px solid ${SOFT_LINE}` }}>
      {rank != null && <span style={{ width: 14, fontSize: 11.5, color: 'var(--sd-fg-4, #6f7a88)', fontWeight: 700, flexShrink: 0 }}>{rank}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>{left}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right', flexShrink: 0 }}>
        <b style={{ fontSize: 15, fontWeight: 800, color: valueColor || 'var(--sd-fg-1, #fff)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
        {label && <span style={{ fontSize: 10, color: 'var(--sd-fg-4, #6f7a88)', whiteSpace: 'nowrap' }}>{label}</span>}
      </span>
    </div>
  );
}

/** A board that needs circles, on a network with none yet. */
export function NeedsCircles({ source, compact = false }) {
  const csv = source === 'csv';
  return (
    <div style={{ fontSize: compact ? 12 : 13, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.5, padding: compact ? '4px 0 6px' : '6px 0' }}>
      {csv
        ? 'A CSV import is your connections only: LinkedIn’s export has no circles. Scan your own network to see who stands behind your connections.'
        : 'Scan a few circles to see who stands behind your connections.'}
      {!csv && source === 'own' && <> <Link href="/setup" style={{ color: 'var(--sd-green, #00ff88)', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Open Scan →</Link></>}
    </div>
  );
}

const ACT = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, padding: '6px 11px',
  borderRadius: 7, whiteSpace: 'nowrap', textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
};
const OUTLINE = { ...ACT, color: 'var(--sd-blue, #3498DB)', border: '1px solid rgba(52,152,219,0.4)', background: 'rgba(52,152,219,0.06)' };

/** Their circle in Bridge Chains: the link every page uses (/?chain=<id>). */
export function OpenCircle({ id, compact }) {
  return <Link href={`/?chain=${encodeURIComponent(id)}`} style={{ ...OUTLINE, ...(compact ? { padding: '4px 8px', fontSize: 11 } : null) }}>Open circle</Link>;
}

/** The Scan page's "Scan one circle" for them (/setup?scan=<id>): what it costs, and one button that starts it. */
export function ScanCircle({ id, compact }) {
  return <Link href={`/setup?scan=${encodeURIComponent(id)}`} style={{ ...OUTLINE, ...(compact ? { padding: '4px 8px', fontSize: 11 } : null) }} title="Opens the Scan page with them picked: what the scan costs, and one button that starts it">Scan circle</Link>;
}

/**
 * Ask: what the person card's Connect does. Their LinkedIn profile opens in
 * a new tab to send the request there, and it's marked sent through the
 * connection who is your best way in (lib/requests-client.js), everywhere at once.
 * On your own network Auto stands first, the better pick, and Ask steps back
 * to an outline beside it, as everywhere else Connect is offered
 * (components/AutoConnect.js; Blake, 2026-10-03: "wherever its available").
 */
export function AskButton({ row, bridgeId, asked, compact, canAuto = false }) {
  if (asked) {
    return <span title="A request is marked sent. The next check of your own connections notices when they accept." style={{ ...ACT, cursor: 'default', color: 'var(--sd-fg-4, #6f7a88)', border: `1px dashed ${LINE}`, ...(compact ? { padding: '4px 8px', fontSize: 11 } : null) }}>Asked</span>;
  }
  if (!row?.profile_url) return null;
  const size = compact ? { padding: '4px 9px', fontSize: 11 } : null;
  const ask = (second) => (
    <a href={row.profile_url} target="_blank" rel="noopener noreferrer"
      title="Opens their LinkedIn profile in a new tab to send the request there, and marks it sent here"
      onClick={() => { markRequested(row, { bridgeId }).catch(() => {}); }}
      style={second
        ? { ...ACT, ...secondaryLook(compact ? 'row' : 'table'), ...size }
        : { ...ACT, color: '#000', border: 'none', background: 'linear-gradient(135deg, #FF6B35, #FFD700)', ...size }}>
      Ask
    </a>
  );
  return <ConnectChoice person={row} canAuto={canAuto} size={compact ? 'row' : 'table'} connect={ask} />;
}

/** A horizontal bar made of parts: [{ value, color, label? }] over `max`. */
export function Bars({ parts, max, height = 14, gap = 2 }) {
  const total = Math.max(1, max || parts.reduce((t, p) => t + p.value, 0));
  return (
    <span style={{ display: 'flex', gap, height, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', borderRadius: 4, overflow: 'hidden', minWidth: 0, flex: 1 }}>
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <span key={i} title={p.title} style={{
          width: `${(100 * p.value) / total}%`, background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 800, color: inkOn(p.ink || '#888888'), overflow: 'hidden', whiteSpace: 'nowrap',
        }}>{p.label && (100 * p.value) / total >= 5 ? p.label : ''}</span>
      ))}
    </span>
  );
}
