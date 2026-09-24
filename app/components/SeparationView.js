'use client';

// Separation — everyone you can reach in two steps, ranked, with every way in.
//
// The other Degrees views are organised by bridge: pick one of your connections
// and see who they open. This one answers the question the other way round —
// "who is the most powerful person I could reach, and through whom?" — so it
// is organised by the PERSON. Someone three of your connections know is one row
// with three routes, not three rows (lib/separation.js does that merge).
//
// Two parts, one scroll: a small "summit map" of the top of the list, drawn
// from You through each bridge to each person, and under it the full ranked
// list. The list is windowed — about thirty rows are mounted whether there are
// three thousand people or twenty — so it is never capped.
//
// TRAPS §29 shaped the rules here: derived data is memoised, hover never sets
// React state (CSS for the map, a style mutation for rows, as ListView does),
// nothing is appended to <body>, and the ResizeObserver publishes a size only
// when it changes. The map's height never depends on its width, so a scrollbar
// appearing cannot feed a resize loop.

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { separationPeople, compareWaysIn, summitLayout, shortName, TIERS } from '../../lib/separation';
import { initialsFor } from '../../lib/tiers';
import Avatar from './Avatar';

const ORANGE = '#FF6B35';
const CLASSIC = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const CANT_NAME = 'a connection we can’t name';
// The fixed Filters (left:16) and Details (right:16) pills sit at viewport
// top:140 — inside the header band on a desktop, in the controls row on a
// phone. This much side padding keeps them off the text at every width.
const SIDE = 56;
const LABEL_ROW = 28;
const BOTTOM_PAD = 72;           // clear of the last row's reach, and the corner toggles
const OVERSCAN = 8;
const SCROLL_STEP = 16;          // scroll is published to state in 16px steps, not every pixel

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => { const c = () => setM(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);
  return m;
}

/** The route to show in a row: the one the search matched, else the top-scored. */
function pickRoute(p, q) {
  if (q) {
    const hit = p.routes.find((r) => r.bridge && String(r.bridge.name || '').toLowerCase().includes(q));
    if (hit) return hit;
  }
  return p.routes[0] || null;
}

function everyRoute(p) {
  return p.routes.map((r) => (r.bridge ? `${r.bridge.name} (${r.bridge.tier})` : CANT_NAME)).join('\n');
}

function subline(person) {
  if (person.role && person.company) return `${person.role} @ ${person.company}`;
  return person.headline || person.role || person.company || '';
}

export default function SeparationView({ connections = [], degree2 = [], onSelect, userName, selectedId, tierColors = CLASSIC }) {
  const isMobile = useIsMobile();
  const ROW_H = isMobile ? 68 : 56;
  const K = isMobile ? 5 : 10;
  const sidePad = isMobile ? 8 : 16;

  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  const [sort, setSort] = useState('power');     // 'power' | 'ways'
  const [tier, setTier] = useState('all');
  const [scrollY, setScrollY] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 800 });
  // The scroll element lives in state as well as a ref: the ResizeObserver
  // holds the element it was given, so a late observation after unmount never
  // reads a cleared ref (ChainView learned this the hard way). The ref is for
  // event handlers that move the scroll.
  const [scrollEl, setScrollEl] = useState(null);
  const scrollRef = useRef(null);
  const attachScroll = useCallback((el) => { scrollRef.current = el; setScrollEl(el); }, []);
  const searchRef = useRef(null);

  // ── Data: one merge per population, then order, then what's showing ──────
  const model = useMemo(() => separationPeople(degree2, connections), [degree2, connections]);
  const ordered = useMemo(
    () => (sort === 'ways' ? [...model.people].sort(compareWaysIn) : model.people),
    [model, sort],
  );
  const visible = useMemo(() => {
    if (!q && tier === 'all') return ordered;
    return ordered.filter((p) => (tier === 'all' || p.tier === tier) && (!q || p.haystack.includes(q)));
  }, [ordered, q, tier]);
  const top = useMemo(() => visible.slice(0, K), [visible, K]);
  const selectedKey = selectedId != null ? model.rowToKey.get(selectedId) ?? null : null;

  // onSelect is read through a ref so the row and map callbacks never change
  // identity, and memoised rows never re-render because a parent re-rendered.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const onPick = useCallback((p) => onSelectRef.current?.(p.person), []);
  const onPickBridge = useCallback((b) => { if (b) onSelectRef.current?.(b); }, []);

  // ── Size ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollEl;
    if (!el) return undefined;
    // observe() reports the first size itself, so nothing is measured here.
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollEl]);

  const cw = Math.max(0, Math.min(980, box.w - 2 * sidePad));
  // The map's height comes from the layout, never the DOM, so the list below
  // it can be positioned by arithmetic alone.
  const layout = useMemo(() => summitLayout(top, cw || 800, isMobile), [top, cw, isMobile]);
  const captionH = isMobile ? 58 : 40;   // fixed, so HEAD is arithmetic; the phone legend takes two lines
  const mapBlockH = top.length ? captionH + layout.height + 12 : 0;
  const HEAD = mapBlockH + LABEL_ROW;
  const total = HEAD + visible.length * ROW_H + BOTTOM_PAD;

  // ── Windowing ────────────────────────────────────────────────────────────
  // Derived from the last published scroll position on every render, so a
  // change in the map's height or the row height can never leave it stale.
  // No requestAnimationFrame (TRAPS §17): the scroll event owns it.
  const start = Math.max(0, Math.floor((scrollY - HEAD) / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, start + Math.ceil(box.h / ROW_H) + 2 * OVERSCAN);
  const onScroll = useCallback((e) => {
    const next = Math.floor(e.currentTarget.scrollTop / SCROLL_STEP) * SCROLL_STEP;
    setScrollY((prev) => (prev === next ? prev : next));
  }, []);
  const toTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollY(0);
  }, []);

  // ── Keyboard: '/' finds the search box from anywhere on the page ─────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeQuery = (v) => { setQuery(v); toTop(); };
  const changeTier = (t) => { setTier(t); toTop(); };
  const changeSort = (s) => { setSort(s); toTop(); };
  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      // Read the live text, not the deferred copy the list is still catching up to.
      const live = query.trim().toLowerCase();
      const first = ordered.find((p) => (tier === 'all' || p.tier === tier) && (!live || p.haystack.includes(live)));
      if (first) onPick(first);
    } else if (e.key === 'Escape') {
      if (query) changeQuery('');
      else e.currentTarget.blur();
    }
  };

  const { summary } = model;
  const filtered = !!q || tier !== 'all';
  const youLabel = !userName || /^you$/i.test(String(userName).trim()) ? 'You' : initialsFor(userName);
  const rows = visible.slice(start, end);

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: '#0a0a1a', color: '#fff', overflow: 'hidden',
    }}>
      {/* ── Header: what this is, how many, and what it can't say ── */}
      <div style={{ padding: `10px ${SIDE}px 8px`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{
            margin: 0, fontSize: 18, fontWeight: 800,
            background: 'linear-gradient(135deg, #FFD700, #FF6B35)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Separation</h2>
          <span style={{ fontSize: 12, color: '#aaa' }}>
            {isMobile
              ? `${plural(summary.people, 'person', 'people')} · ${fmt(summary.byTier.S)} S · ${fmt(summary.multi)} with 2+ ways`
              : `${plural(summary.people, 'person', 'people')} two steps away · ${fmt(summary.byTier.S)} S-tier · ${fmt(summary.multi)} reachable 2+ ways · through ${fmt(summary.bridges)} of your connections`}
          </span>
        </div>
        {/* The whole population at a glance: one segment per tier, to scale. */}
        <div aria-hidden="true" style={{ display: 'flex', gap: 1, height: 6, borderRadius: 3, overflow: 'hidden', margin: '8px 0 6px', background: 'rgba(255,255,255,0.04)' }}>
          {TIERS.filter((t) => summary.byTier[t] > 0).map((t) => (
            <div key={t} style={{ flex: summary.byTier[t], background: tierColors[t] || '#555' }} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#777', lineHeight: 1.4 }}>
          {isMobile
            ? 'Ranks reachability, not people · lists scanned so far'
            : 'Ranked by each person’s own score (title, company, headline). It ranks reachability, not people. From the lists scanned so far.'}
        </div>
        {summary.peopleOnlyUnresolved > 0 && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5, color: '#e8d9a0',
            background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.25)',
          }}>
            {/* Worded without a cause on purpose: the one time this happened, the
                people were still connections — under new ids — and a message
                saying "no longer in your list" was simply untrue. */}
            {plural(summary.peopleOnlyUnresolved, 'of these people', 'of these people')}{' '}
            came only through {plural(summary.onlyUnresolvedVia, 'connection record', 'connection records')}{' '}
            that {summary.onlyUnresolvedVia === 1 ? 'doesn’t' : 'don’t'} match anyone in your 1st-degree list, so who
            introduces you can’t be named. They’re still ranked.
          </div>
        )}
      </div>

      {/* ── Controls: search, order, and their tier ── */}
      <div style={{
        padding: `0 ${SIDE}px 10px`, flexShrink: 0,
        display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center',
        flexWrap: isMobile ? 'nowrap' : 'wrap',   // with the Sidebar open, the chips take a second line
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search people, companies, or who knows them"
          aria-label="Search people, companies, or who knows them"
          style={{
            flex: isMobile ? 'none' : '1 1 260px', minWidth: 0, height: isMobile ? 44 : 34, boxSizing: 'border-box',
            padding: '0 12px', borderRadius: 8, outline: 'none', color: '#fff',
            fontSize: isMobile ? 16 : 13,        // under 16px, iOS zooms the page on focus
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
          }}
        />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: isMobile ? 'nowrap' : 'wrap',
          // A phone scrolls this strip sideways, so the page itself never does.
          overflowX: isMobile ? 'auto' : 'visible', scrollbarWidth: 'thin', flexShrink: isMobile ? 0 : 1,
        }}>
          <div role="group" aria-label="Order" style={{ display: 'flex', flexShrink: 0, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 2 }}>
            {[['power', 'Power'], ['ways', 'Ways in']].map(([key, label]) => (
              <button key={key} type="button" aria-pressed={sort === key} onClick={() => changeSort(key)} style={{
                height: isMobile ? 40 : 30, padding: '0 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                background: sort === key ? 'linear-gradient(135deg, #FFD700, #FF6B35)' : 'transparent',
                color: sort === key ? '#000' : '#999',
              }}>{label}</button>
            ))}
          </div>
          <span style={{ fontSize: 10, color: '#666', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>Their tier</span>
          {['all', ...TIERS].map((t) => {
            const on = tier === t;
            const c = t === 'all' ? '#fff' : tierColors[t] || '#888';
            const n = t === 'all' ? summary.people : summary.byTier[t];
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => changeTier(t)} style={{
                height: isMobile ? 40 : 30, padding: '0 10px', borderRadius: 15, cursor: 'pointer', flexShrink: 0,
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                border: `1px solid ${on ? c : 'rgba(255,255,255,0.1)'}`,
                background: on ? `${c === '#fff' ? '#ffffff' : c}22` : 'rgba(255,255,255,0.03)',
                color: on ? c : '#999',
              }}>
                {t === 'all' ? 'All' : t}
                <span style={{ marginLeft: 5, fontWeight: 500, color: on ? c : '#666', opacity: 0.85 }}>{fmt(n)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── One scroll: the summit map, then every person ── */}
      <div
        ref={attachScroll}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', padding: `0 ${sidePad}px` }}
      >
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', height: total }}>
          {top.length > 0 && (
            <div style={{ height: mapBlockH, boxSizing: 'border-box', paddingTop: 10 }}>
              <div style={{ height: captionH - 10, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Top {fmt(top.length)} of {fmt(visible.length)}{filtered ? ' shown' : ''} · every way in drawn
                </div>
                <div style={{ fontSize: 10, color: '#777', marginTop: 2, whiteSpace: isMobile ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }}>
                  <span style={{ color: ORANGE }}>solid orange</span> = top-scored bridge · dashed = other routes · dot size = ways in
                </div>
              </div>
              {cw > 0 && (
                <SummitMap
                  layout={layout}
                  selectedKey={selectedKey}
                  tierColors={tierColors}
                  youLabel={youLabel}
                  isMobile={isMobile}
                  onPick={onPick}
                  onPickBridge={onPickBridge}
                />
              )}
            </div>
          )}

          {visible.length > 0 && (
            <div style={{
              height: LABEL_ROW, display: 'grid', alignItems: 'center', gap: 10, padding: '0 12px 0 15px',
              gridTemplateColumns: isMobile ? '44px 36px 1fr 44px' : '64px 36px minmax(0,1.4fr) minmax(0,1fr) 96px 44px',
              fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5,
              borderBottom: '1px solid rgba(255,255,255,0.08)', boxSizing: 'border-box',
            }}>
              <span title="Rank by score, then ways in. = means tied">#</span>
              <span />
              {isMobile ? <span>Person · way in</span> : <><span>Person</span><span>Way in</span><span>Power</span></>}
              <span style={{ textAlign: 'right' }}>{isMobile ? 'Score' : ''}</span>
            </div>
          )}

          {rows.map((p, i) => (
            <Row
              key={p.key}
              p={p}
              top={HEAD + (start + i) * ROW_H}
              height={ROW_H}
              isMobile={isMobile}
              selected={p.key === selectedKey}
              tierColors={tierColors}
              onPick={onPick}
              q={q}
            />
          ))}

          {visible.length === 0 && (
            <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', color: '#888', fontSize: 13, padding: '0 16px' }}>
              {q
                ? <>No one matches ‘{query.trim()}’. Search covers names, headlines, companies and who knows them.</>
                : <>No {tier}-tier people here.</>}
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={() => { setQuery(''); setTier('all'); toTop(); }} style={{
                  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff',
                }}>Clear</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The summit map ─────────────────────────────────────────────────────────
// A plain React <svg>: no d3, no canvas, no zoom — at most about 150 elements
// whatever the network's size. Hover is pure CSS from the scoped <style>, so a
// still mouse can never re-render anything. aria-hidden because the same people
// are the first rows of the list, and the list is the accessible path.
const MAP_CSS = `
.sepmap .sp { cursor: pointer; transition: opacity .12s; }
.sepmap .ppl:hover .sp { opacity: .28; }
.sepmap .ppl:hover .sp:hover, .sepmap .ppl:hover .sp.sel { opacity: 1; }
.sepmap .sp:hover .rt, .sepmap .sp.sel .rt { stroke-opacity: 1; stroke-width: 2px; }
.sepmap .br { cursor: pointer; }
.sepmap .br:hover text { text-decoration: underline; }
.sepmap .rt { pointer-events: none; }
`;
const HALO = { paintOrder: 'stroke', stroke: '#0a0a1a', strokeWidth: 3, strokeLinejoin: 'round' };

const SummitMap = memo(function SummitMap({ layout, selectedKey, tierColors, youLabel, isMobile, onPick, onPickBridge }) {
  const { width, height, you, people, bridges, links, spokes } = layout;
  const linksBy = useMemo(() => {
    const m = new Map();
    for (const l of links) { if (!m.has(l.key)) m.set(l.key, []); m.get(l.key).push(l); }
    return m;
  }, [links]);
  const gap = isMobile ? 36 : 26;
  const fs = isMobile ? 12 : 11;

  return (
    <svg className="sepmap" width={width} height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <style>{MAP_CSS}</style>
      <defs>
        <linearGradient id="sepYouGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD700" />
          <stop offset="1" stopColor="#FF6B35" />
        </linearGradient>
      </defs>

      {spokes.map((s) => (
        <line key={`s-${s.id ?? 'unresolved'}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#fff" strokeOpacity={0.12} strokeWidth={1} />
      ))}

      <g className="ppl">
        {people.map((pp) => {
          const { p } = pp;
          const c = tierColors[p.tier] || '#888';
          const sel = pp.key === selectedKey;
          const via = p.routes.map((r) => (r.bridge ? r.bridge.name : CANT_NAME)).join(', ');
          return (
            <g key={pp.key} className={sel ? 'sp sel' : 'sp'} onClick={() => onPick(p)}>
              <title>{`${p.person.name} · #${p.rank}${p.tied ? '=' : ''} · ${p.tier} · ${p.score.toFixed(1)} · via ${via}`}</title>
              {(linksBy.get(pp.key) || []).map((l) => {
                const mx = (l.x1 + l.x2) / 2;
                const stroke = l.unresolved ? '#777' : l.primary ? ORANGE : tierColors[l.tier] || '#888';
                return (
                  <path
                    key={`${l.key}-${l.bridgeId ?? 'u'}`}
                    className="rt"
                    d={`M${l.x1 + 5},${l.y1} C${mx},${l.y1} ${mx},${l.y2} ${l.x2 - pp.r},${l.y2}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={l.primary ? 1.5 : 1}
                    strokeOpacity={l.primary ? 0.8 : 0.35}
                    strokeDasharray={l.primary ? undefined : '3 3'}
                  />
                );
              })}
              <rect x={pp.x - 12} y={pp.y - gap / 2} width={Math.max(0, width - pp.x + 12)} height={gap} fill="transparent" />
              {sel && <circle cx={pp.x} cy={pp.y} r={pp.r + 3.5} fill="none" stroke="#fff" strokeWidth={1.5} />}
              <circle cx={pp.x} cy={pp.y} r={pp.r} fill={c} />
              <text x={pp.x + 14} y={pp.y} dy="0.35em" fontSize={fs} fill="#ddd" style={HALO}>
                {pp.label}
                <tspan dx={6} fill={c} fontWeight={700}>{p.score.toFixed(1)}</tspan>
              </text>
            </g>
          );
        })}
      </g>

      {bridges.map((b) => {
        const c = b.unresolved ? '#777' : tierColors[b.bridge.tier] || '#888';
        return (
          <g
            key={`b-${b.id ?? 'unresolved'}`}
            className={b.unresolved ? undefined : 'br'}
            onClick={b.unresolved ? undefined : () => onPickBridge(b.bridge)}
          >
            <title>{b.unresolved
              ? 'Routes whose connection record doesn’t match anyone in your 1st-degree list, so who introduces you can’t be named'
              : `${b.bridge.name} · ${b.bridge.tier}-tier · a way in to ${b.count} of these · click to open`}</title>
            <circle
              cx={b.x} cy={b.y} r={b.r}
              fill={b.unresolved ? 'none' : c}
              stroke={b.unresolved ? '#777' : '#0a0a1a'}
              strokeWidth={b.unresolved ? 1 : 1.5}
              strokeDasharray={b.unresolved ? '2 2' : undefined}
            />
            <text x={b.x - 9} y={b.y} dy="0.35em" textAnchor="end" fontSize={fs - 1} fill={c}
              fontStyle={b.unresolved ? 'italic' : undefined} fontWeight={b.unresolved ? 400 : 600} style={HALO}>
              {b.label}
            </text>
          </g>
        );
      })}

      <g>
        <circle cx={you.x} cy={you.y} r={you.r} fill="url(#sepYouGrad)" />
        <text x={you.x} y={you.y} dy="0.35em" textAnchor="middle" fontSize={youLabel.length > 2 ? 9 : 10} fontWeight={800} fill="#000">
          {youLabel}
        </text>
      </g>
    </svg>
  );
});

// ── Rows ───────────────────────────────────────────────────────────────────

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function Via({ p, route, tierColors, compact }) {
  if (!route?.bridge) {
    return <span style={{ ...ellipsis, color: '#777', fontStyle: 'italic', fontSize: compact ? 11 : 12 }}>via {CANT_NAME}</span>;
  }
  const b = route.bridge;
  const extra = p.waysIn - 1;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: compact ? 11 : 12 }}>
      <span style={{ color: '#666', flexShrink: 0 }}>via</span>
      {!compact && <Avatar person={b} size={16} tierColors={tierColors} />}
      <span style={{ ...ellipsis, color: tierColors[b.tier] || '#aaa', fontWeight: 600, minWidth: 0 }}>{compact ? shortName(b.name) : b.name}</span>
      {extra > 0 && (
        <span title={`Every way in:\n${everyRoute(p)}`} style={{
          flexShrink: 0, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 800,
          color: ORANGE, background: 'rgba(255,107,53,0.15)',
        }}>+{extra}</span>
      )}
    </span>
  );
}

const Row = memo(function Row({ p, top, height, isMobile, selected, tierColors, onPick, q }) {
  const { person } = p;
  const c = tierColors[p.tier] || '#888';
  const route = pickRoute(p, q);
  const podium = p.rank <= 3;
  const base = selected ? 'rgba(255,107,53,0.08)' : podium ? `${c}08` : 'transparent';
  const member = person.name === 'LinkedIn Member';
  const rank = `#${p.rank}${p.tied ? '=' : ''}`;
  const extra = p.waysIn - 1;
  const viaText = route?.bridge
    ? `via ${route.bridge.name}${extra > 0 ? ` and ${extra} other${extra > 1 ? 's' : ''}` : ''}`
    : `via ${CANT_NAME}${extra > 0 ? ` and ${extra} other${extra > 1 ? 's' : ''}` : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Rank ${p.rank}${p.tied ? ', tied' : ''}, ${person.name}, ${p.tier} tier, ${p.score.toFixed(1)}, ${p.waysIn} way${p.waysIn === 1 ? '' : 's'} in, ${viaText}`}
      aria-pressed={selected}
      onClick={() => onPick(p)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p); } }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = base; }}
      style={{
        position: 'absolute', top, left: 0, right: 0, height, boxSizing: 'border-box',
        display: 'grid', alignItems: 'center', gap: 10, padding: '0 12px',
        gridTemplateColumns: isMobile ? '44px 36px 1fr 44px' : '64px 36px minmax(0,1.4fr) minmax(0,1fr) 96px 44px',
        borderLeft: `3px solid ${selected ? ORANGE : 'transparent'}`,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: base, cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 800, color: podium ? c : '#555', whiteSpace: 'nowrap' }}>{rank}</span>
      <Avatar person={person} size={32} tierColors={tierColors} />

      {isMobile ? (
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: member ? '#888' : '#fff' }}>
            {person.name}{member && <span style={{ fontSize: 10, color: '#666', fontWeight: 400 }}> · out of network</span>}
          </span>
          <Via p={p} route={route} tierColors={tierColors} compact />
          <span style={{ ...ellipsis, fontSize: 10, color: '#666' }}>{subline(person)}</span>
        </div>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: member ? '#888' : '#fff' }}>{person.name}</span>
              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: c, border: `1px solid ${c}55`, borderRadius: 4, padding: '0 4px' }}>{p.tier}</span>
              {member && <span style={{ flexShrink: 0, fontSize: 10, color: '#666' }}>out of network</span>}
            </div>
            <div style={{ ...ellipsis, fontSize: 10, color: '#777', marginTop: 2 }}>{subline(person)}</div>
          </div>
          <Via p={p} route={route} tierColors={tierColors} />
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <div style={{ height: '100%', borderRadius: 3, background: c, width: `${Math.max(0, Math.min(1, p.score / 10)) * 100}%` }} />
          </div>
        </>
      )}

      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: c }}>{p.score.toFixed(1)}</div>
        {isMobile && <div style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>{p.tier}</div>}
      </div>
    </div>
  );
});
