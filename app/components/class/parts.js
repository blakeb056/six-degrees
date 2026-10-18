'use client';

// Small pieces every class screen shares: the class emblem, the two tier
// badges (the class tier on the emblem's hexagon, the network tier on its
// dot, so the UI always says which), the five build bars and the build in
// words. Pure drawing; the screens fetch.

import { TIER_COLORS } from '../../../lib/themes';

const tierColor = (t) => `var(--sd-tier-${String(t || 'd').toLowerCase()}, ${TIER_COLORS?.[t] || '#6b7280'})`;

/** Each class's mark, drawn in its colour on a shield (Destiny-style emblems, simple lines). */
const MARKS = {
  poacher: <><circle cx="24" cy="25" r="8" /><circle cx="24" cy="25" r="2.6" fill="currentColor" stroke="none" /><path d="M24 12v5M24 33v5M11 25h5M32 25h5" /></>,
  founder: <><path d="M24 12c5 4 7 9 7 15l-3 5h-8l-3-5c0-6 2-11 7-15z" /><circle cx="24" cy="23" r="2.4" /><path d="M20 32l-3 5M28 32l3 5" /></>,
  seeker: <><path d="M24 12l9 13-9 13-9-13z" /><path d="M24 12v26M15 25h18" /></>,
  grower: <><path d="M24 38V22" /><path d="M24 26c0-6 4-9 10-9 0 6-4 9-10 9zM24 30c0-5-3-8-9-8 0 5 3 8 9 8z" /></>,
  cartographer: <><circle cx="15" cy="17" r="2.6" /><circle cx="33" cy="20" r="2.6" /><circle cx="22" cy="33" r="2.6" /><circle cx="34" cy="34" r="2.2" /><path d="M17 18l14 2M16 19l5 12M24 32l8 1M32 22l2 10" /></>,
  infiltrator: <><rect x="16" y="13" width="16" height="24" rx="2" /><circle cx="24" cy="24" r="2.4" /><path d="M24 26v4" /></>,
};

export function Emblem({ cls, color, size = 44, title }) {
  const mark = MARKS[cls] || MARKS.cartographer;
  return (
    <svg className="cl-emblem" width={size} height={size} viewBox="0 0 48 48" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ color }}>
      <path d="M24 3l17 6v13c0 11-7 19-17 23C14 41 7 33 7 22V9z" fill={`color-mix(in srgb, ${color} 16%, transparent)`} stroke={color} strokeWidth="1.6" />
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{mark}</g>
    </svg>
  );
}

/** "Class S" on the class's hexagon. */
export function ClassTier({ tier }) {
  if (!tier) return null;
  return <span className="cl-tier" title={`Class ${tier}: this person under your class`}><span className="shape" style={{ background: tierColor(tier) }} />Class {tier}</span>;
}

/** "Network A" on the network's dot: the power score's tier, the same for everyone. */
export function NetworkTier({ tier }) {
  if (!tier) return null;
  return <span className="cl-tier net" title={`Network ${tier}: their tier on the network axis (power score)`}><span className="dot" style={{ background: tierColor(tier) }} />Network {tier}</span>;
}

/** The five build bars: how much each block of your build moves who ranks where, in your network. */
export function BuildBars({ bars = [] }) {
  return (
    <div className="cl-bars" role="list" aria-label="Your build">
      {bars.map((b) => (
        <div key={b.key} className="cl-bar" role="listitem" aria-label={`${b.label} ${Math.round(b.share * 100)} percent`}>
          <span>{b.label}</span>
          <span className="track"><span className="fill" style={{ width: `${Math.round(b.share * 100)}%`, display: 'block' }} /></span>
          <span className="n">{Math.round(b.share * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** The strongest weights in words: likes and push-downs. */
export function BuildWords({ top = [] }) {
  if (!top.length) return null;
  return (
    <div className="cl-words">
      {top.map((t) => <span key={t.key} className={`cl-word ${t.sign > 0 ? 'up' : 'down'}`}>{t.label} {t.sign > 0 ? '+' : '−'}</span>)}
    </div>
  );
}

/** The two dials, read-only for now: doors against destinations, and the moonshot. */
export function Dials({ dials }) {
  if (!dials) return null;
  const doors = dials.gamma >= 0.9 ? 'Doors count as much as destinations' : dials.gamma >= 0.45 ? 'Doors count half' : 'Destinations first';
  const moon = dials.rho >= 1.15 ? 'Chases the very top' : dials.rho <= 0.85 ? 'Leans to sure things' : 'Balanced';
  return (
    <div className="cl-dials">
      <div className="cl-dial"><b>{doors}</b>Doors against destinations · {dials.gamma}</div>
      <div className="cl-dial"><b>{moon}</b>Moonshot · {dials.rho}</div>
    </div>
  );
}

export const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** A real person in a class list or the reveal: their photo or initials, name, both tiers, headline and why. */
export function PersonRow({ p, children }) {
  const photo = p.photo && p.photo.startsWith('/avatars/') ? p.photo : null;
  return (
    <div className="cl-person" data-person={p.id}>
      <span className="av">{photo ? <img src={photo} alt="" /> : initials(p.name)}</span>
      <span style={{ minWidth: 0 }}>
        <span className="nm">{p.name}<ClassTier tier={p.classTier} /><NetworkTier tier={p.tier} /></span>
        {p.headline && <span className="hl" style={{ display: 'block' }}>{p.headline}</span>}
        {p.why && <span className="wy" style={{ display: 'block' }}>{p.why}</span>}
      </span>
      <span className="cl-row" style={{ gap: 6, justifyContent: 'flex-end' }}>{children}</span>
    </div>
  );
}
