'use client';

// The Map tab's finder, options and line panels (app/components/WorldMap.js
// draws the map; lib/map-lines.js does the sums). Each answers one question:
//   the finder        where is this person, company, place, or this connection's circle?
//   Through whom      how far does one connection's circle reach, and where?
//   Who gets you here  which of my connections can introduce me to the people in this place?
//   the options       declutter: only places with enough people, or enough of tier S or A; From you.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { TIER_COLORS } from '../../lib/themes';
import { DEGREE_COLOURS } from '../../lib/galaxy-lab';
import { score } from '../../lib/separation';
import { localPhoto } from '../../lib/photos';
import { bestTier } from '../../lib/places';
import { findOnMap, MIN_PEOPLE_STEPS, MIN_STRONG_STEPS } from '../../lib/map-lines';

export const TIERS = ['S', 'A', 'B', 'C', 'D'];
export const DEGREE_NAMES = { 1: '1st', 2: '2nd', 3: '3rd' };
export const LINE = '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)';
export const fmt = (n) => Number(n || 0).toLocaleString('en-US');
export const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
// The look's tier colours as CSS variables, so a change of look redraws the dots
// at once; TIER_COLORS (the live object) as the fallback.
export const tierFill = (t) => `var(--sd-tier-${t.toLowerCase()}, ${TIER_COLORS[t] || '#bdc3c7'})`;
export const degreeFill = (d) => DEGREE_COLOURS[Math.min(d, 3)] || DEGREE_COLOURS[3];
export const firstName = (name) => String(name || '').split(/[\s,]+/)[0] || 'They';

export const card = {
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
  borderRadius: 12, color: 'var(--sd-fg-2, #cfd8d8)', boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
};
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
export const byStrength = (a, b) => (TIER_RANK[a.tier] ?? 4) - (TIER_RANK[b.tier] ?? 4)
  || (Number(a.degree) || 1) - (Number(b.degree) || 1) || score(b) - score(a);

const smallButton = {
  border: LINE, borderRadius: 7, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 10.5, fontWeight: 650, padding: '3px 7px', color: 'var(--sd-fg-2, #cfd8d8)', whiteSpace: 'nowrap',
};
// Who a connection can introduce you to: Separation, filtered to their circle (`onIntros`,
// app/components/WorldMap.js). Blake, 2026-10-17: "Separation is what you want to do anyway".
export const introButton = { ...smallButton, color: 'var(--sd-orange, #FF6B35)' };
export const INTROS = 'Who they can introduce';
export const introsTitle = (name) => `Separation, filtered to who ${name || 'they'} can introduce you to`;
const strongIn = (people) => people.reduce((n, p) => n + (p.tier === 'S' || p.tier === 'A' ? 1 : 0), 0);
const sub = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--sd-fg-5, #667)' };

/** One person in a list: photo or initial, name and title, tier and degree; a click opens their card. */
export function PersonRow({ p, selectedId, onSelect, extra = null }) {
  const t = TIERS.includes(p.tier) ? p.tier : 'D';
  const photo = localPhoto(p.profile_image_url);
  const on = p.id === selectedId;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button type="button" onClick={() => onSelect?.(p)} aria-current={on ? 'true' : undefined} className="sd-map-row" style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: '6px 8px', border: 'none', borderRadius: 8,
        background: on ? 'rgba(52,152,219,0.16)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}>
        {photo ? (
          <img src={photo} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${tierFill(t)}` }} />
        ) : (
          <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: tierFill(t), color: '#0a0a1a' }}>
            {(p.name || '?').charAt(0)}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--sd-fg-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--sd-fg-4, #778)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.headline || p.role || ''}</span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, color: `color-mix(in srgb, ${tierFill(t)} 58%, var(--sd-tier-ink, ${tierFill(t)}))`, flexShrink: 0 }}>{t}</span>
        <span style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)', flexShrink: 0, width: 24, textAlign: 'right' }}>{DEGREE_NAMES[p.degree] || `${p.degree || 1}th`}</span>
      </button>
      {extra}
    </div>
  );
}

/** A panel at the right (a sheet at the bottom on a phone), with a title, a line under it and a close. */
export function SidePanel({ label, title, subtitle, phone, below = 0, sheet = 320, onClose, actions = null, children }) {
  return (
    <section aria-label={label} style={{
      position: 'absolute', ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...(phone ? { left: 8, right: 8, bottom: below + 8, maxHeight: sheet } : { top: 120, right: 64, width: 316, maxHeight: `calc(100% - ${140 + below}px)` }),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderBottom: LINE }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', marginTop: 2, lineHeight: 1.45 }}>{subtitle}</div>}
          {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>{actions}</div>}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--sd-fg-3, #889)', padding: 2 }}>&times;</button>
      </div>
      <div style={{ overflowY: 'auto', padding: 4 }}>{children}</div>
    </section>
  );
}

/**
 * Who gets you here: the connections who reach the 2nd-degree people at this
 * place, each with how many, their lines, and who they can introduce you to (Separation).
 */
export function GettersList({ getters, here, onIntros = null, selectedId, onSelect, onLines, openStart }) {
  if (!getters?.bridges.length) return null;
  const shown = getters.bridges.slice(0, 40);
  return (
    <div style={{ padding: '6px 8px 8px', borderBottom: LINE }}>
      <div style={sub}>Who gets you here</div>
      <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', margin: '3px 0 4px', lineHeight: 1.45 }}>
        {plural(getters.people, '2nd-degree person', '2nd-degree people')} in {here}, through {plural(getters.bridges.length, 'connection')}.
        {getters.unplacedBridges.length > 0 && ` ${fmt(getters.unplacedBridges.length)} of them ${getters.unplacedBridges.length === 1 ? 'has' : 'have'} no location yet, so no line.`}
      </div>
      {shown.map((g) => {
        const lit = openStart && g.place?.key === openStart;
        return (
          <div key={g.bridge.id} data-lit={lit ? '' : undefined} style={{ borderRadius: 8, background: lit ? 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' : 'transparent' }}>
            <PersonRow p={g.bridge} selectedId={selectedId} onSelect={onSelect} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 6px 42px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #889)' }}>
                reaches {fmt(g.count)} here{strongIn(g.people) ? `, ${fmt(strongIn(g.people))} S or A` : ''}{g.place ? ` · lives in ${g.place.name}` : ''}
              </span>
              <button type="button" onClick={() => onLines(g.bridge.id)} style={smallButton} title={`Lines from ${g.bridge.name} to everywhere their circle lives`}>Their reach</button>
              {onIntros && g.bridge.name && <button type="button" onClick={() => onIntros(g.bridge)} style={introButton} title={introsTitle(g.bridge.name)}>{INTROS}</button>}
            </div>
          </div>
        );
      })}
      {getters.bridges.length > shown.length && <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', padding: '4px 8px' }}>and {plural(getters.bridges.length - shown.length, 'other')}</div>}
    </div>
  );
}

/**
 * Through whom: one connection's circle, place by place. A place opens to who's
 * there; clicking a line's end on the map opens the same one.
 */
export function ReachPanel({ bridge, reach, openEnd, onOpenEnd, onIntros = null, phone, below, sheet, selectedId, onSelect, onClose }) {
  const listRef = useRef(null);
  useEffect(() => {
    if (!openEnd || !listRef.current) return;
    listRef.current.querySelector(`[data-end="${CSS.escape(openEnd)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [openEnd]);
  const name = bridge?.name || 'This connection';
  const places = reach.ends.length;
  const subtitle = !reach.total
    ? `No one in ${firstName(name)}’s circle matches the filters.`
    : `Reaches ${plural(reach.total, 'person', 'people')} in ${plural(places, 'place')}${reach.unplaced ? `, ${fmt(reach.unplaced)} with no location yet` : ''}.${reach.from ? ` Lines run from ${reach.from.name}.` : ` ${firstName(name)} has no location yet, so their circle’s places are ringed instead of lined.`}`;
  return (
    <SidePanel label={`Where ${name}’s circle lives`} title={`Through ${name}`} subtitle={subtitle} phone={phone} below={below} sheet={sheet} onClose={onClose}
      actions={<>
        <button type="button" onClick={() => onSelect?.(bridge)} style={smallButton}>Open their card</button>
        {onIntros && bridge?.name && <button type="button" onClick={() => onIntros(bridge)} style={introButton} title={introsTitle(bridge.name)}>{INTROS}</button>}
      </>}>
      <div ref={listRef}>
        {reach.ends.map((e) => {
          const open = e.key === openEnd;
          return (
            <div key={e.key} data-end={e.key} style={{ borderRadius: 8, background: open ? 'rgba(var(--sd-ink, 255, 255, 255), 0.05)' : 'transparent' }}>
              <button type="button" aria-expanded={open} onClick={() => onOpenEnd(open ? null : e.key)} className="sd-map-row" style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', background: 'transparent',
              }}>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: tierFill(bestTier(e.people)), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--sd-fg-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
                <span style={{ fontSize: 11, color: 'var(--sd-fg-3, #889)', fontVariantNumeric: 'tabular-nums' }}>{fmt(e.count)}</span>
                <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)' }}>{open ? '▾' : '▸'}</span>
              </button>
              {open && [...e.people].sort(byStrength).slice(0, 100).map((p) => <PersonRow key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} />)}
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}

/**
 * The search box: a person (their card, and their place), one of your
 * connections with a scanned circle (their lines), a company (a filter) or a
 * place. Enter keeps what's typed as a filter on names, companies and headlines.
 */
export function MapFinder({ index, onPerson, onBridge, onCompany, onPlace, onText, phone }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const deferred = useDeferredValue(query);
  const found = useMemo(() => findOnMap(index, deferred, phone ? 3 : 4), [index, deferred, phone]);
  const groups = [
    ['bridges', 'Their circle', found.bridges, (p) => p.name, (p) => onBridge(p)],
    ['people', 'People', found.people, (p) => p.name, (p) => onPerson(p)],
    ['companies', 'Companies', found.companies, (c) => `${c.name} · ${fmt(c.count)}`, (c) => onCompany(c.name)],
    ['places', 'Places', found.places, (p) => `${p.label} · ${fmt(p.count)}`, (p) => onPlace(p)],
  ].filter(([, , list]) => list.length);
  const done = () => { setQuery(''); setOpen(false); };
  return (
    <div style={{ position: 'relative' }}>
      <input type="search" value={query} placeholder="Find a person, company or place"
        aria-label="Find a person, company or place on the map"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') done();
          if (e.key === 'Enter' && query.trim().length >= 2) { onText(query.trim()); done(); }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 8, border: LINE, fontFamily: 'inherit', fontSize: 12,
          background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: 'var(--sd-fg-1, #fff)', outline: 'none',
        }} />
      {open && query.trim().length >= 2 && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 3, ...card, padding: 4, maxHeight: 320, overflowY: 'auto' }}>
          {groups.map(([key, title, list, labelOf, pick]) => (
            <div key={key} style={{ padding: '2px 0' }}>
              <div style={{ ...sub, padding: '4px 8px 2px' }}>{title}</div>
              {list.map((item) => (
                <button key={item.id || item.key || item.name} type="button" role="option" aria-selected="false" className="sd-map-row"
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { pick(item); done(); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--sd-fg-1, #fff)', background: 'transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelOf(item)}
                  {key === 'bridges' && <span style={{ color: 'var(--sd-fg-4, #778)', fontSize: 10.5 }}> · lines to their circle</span>}
                </button>
              ))}
            </div>
          ))}
          <button type="button" className="sd-map-row" onMouseDown={(e) => e.preventDefault()} onClick={() => { onText(query.trim()); done(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, color: 'var(--sd-fg-3, #889)', background: 'transparent' }}>
            Show only people matching &ldquo;{query.trim()}&rdquo; <span style={{ color: 'var(--sd-fg-5, #667)' }}>(Enter)</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The filters as chips, each with its ×, and Clear all. */
export function Chips({ chips, onClear, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
      {chips.map((c) => (
        <span key={c.key} className="sd-map-chip" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 650,
          background: 'color-mix(in srgb, var(--sd-accent, #3498db) 16%, transparent)', color: 'var(--sd-fg-1, #fff)',
          border: '1px solid color-mix(in srgb, var(--sd-accent, #3498db) 45%, transparent)', maxWidth: 220,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
          <button type="button" aria-label={`Clear ${c.label}`} onClick={() => onClear(c.key)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--sd-fg-3, #889)', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>&times;</button>
        </span>
      ))}
      {chips.length > 1 && <button type="button" onClick={onClearAll} style={{ ...smallButton, border: 'none', padding: '2px 4px', color: 'var(--sd-fg-3, #889)' }}>Clear all</button>}
    </div>
  );
}

/** The map's own options: the two declutter thresholds and From you (Heat is a view of its own). */
export function MapOptions({ filters, setFilters, home, showHome, setShowHome }) {
  const select = {
    fontFamily: 'inherit', fontSize: 11, padding: '2px 4px', borderRadius: 6, border: LINE,
    background: 'var(--sd-surface, #10131f)', color: 'var(--sd-fg-1, #fff)',
  };
  const row = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--sd-fg-3, #889)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
      <label style={row}>
        Places with at least
        <select value={filters.minPeople} onChange={(e) => setFilters({ ...filters, minPeople: Number(e.target.value) })} style={select}>
          {MIN_PEOPLE_STEPS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {filters.minPeople === 1 ? 'person' : 'people'}
      </label>
      <label style={row}>
        and at least
        <select value={filters.minStrong} onChange={(e) => setFilters({ ...filters, minStrong: Number(e.target.value) })} style={select}>
          {MIN_STRONG_STEPS.map((n) => <option key={n} value={n}>{n === 0 ? 'any' : n}</option>)}
        </select>
        of tier S or A
      </label>
      <label style={{ ...row, cursor: 'pointer' }}>
        <input type="checkbox" checked={showHome} onChange={(e) => setShowHome(e.target.checked)} />
        From you{home ? ` (${home.place.name}${home.guessed ? ', guessed' : ''})` : ''}
      </label>
      {showHome && home?.guessed && (
        <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)', lineHeight: 1.4, marginTop: -3, paddingLeft: 20 }}>
          Where most of your connections are. A place&rsquo;s list can make another one home.
        </div>
      )}
    </div>
  );
}

export { smallButton };
