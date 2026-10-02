'use client';

// Separation — everyone you can reach in two steps, ranked, with every way in.
//
// The other Degrees views are organised by bridge: pick one of your connections
// and see who they open. This one answers the question the other way round —
// "who is the most powerful person I could reach, and through whom?" — so it
// is organised by the PERSON. Someone three of your connections know is one row
// with three routes, not three rows (lib/separation.js does that merge).
//
// The slider (Blake, 2026-10-02: "i want it to be slider ajusted and can be
// dynmaic") reorders everything as it moves: the rarest ways in at one end,
// the easiest at the other, each person's own score alone in the middle
// (lib/rarity.js slideValue). It never changes a score, a tier or a rank.
//
// The map follows the slider too (Blake, 2026-10-03): from the rare end to the
// middle it fans out to ten people, each with the one or two doors that lead
// to them; towards the easy end it closes in on fewer, and at the end on the
// one person you're aiming at, with every connection of yours who leads to them.
//
// "Path" beside the tier chips narrows everyone to one sector or one company.
// The picker opens under the button and goes away once you've picked.
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

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { separationPeople, comparePower, summitLayout, convergeLayout, mapCount, shortName, TIERS, keyFor, routeIndex } from '../../lib/separation';
import { companyOf, industryOf, INDUSTRIES } from '../../lib/companies';
import { RARITY, rarityOf, rarityInfo, toggle, SLIDER_MIDDLE, slideValue, slideLabel, easeOf } from '../../lib/rarity';
import { hasRequest } from '../../lib/requests-client';
import useRequests from './useRequests';
import { initialsFor } from '../../lib/tiers';
import { watchNotchShown, notchShownNow, noNotch } from '../../lib/island';
import Avatar from './Avatar';

const ORANGE = '#FF6B35';
const CLASSIC = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const CANT_NAME = 'a connection we can’t name';
// The fixed Filters (left:16) and Details (right:16) pills sit at viewport
// top:140 — inside the header band on a desktop, in the controls row on a
// phone. This much side padding keeps them off the text at every width.
const SIDE = 56;
const LABEL_ROW = 28;
const TITLE_ROW = 44;           // the ledger's title bar, on a computer (Blake, 2026-10-03: mock-up 2)
// The ledger's columns: rank, face, person, way in, how rare the way in, power.
const COLUMNS = '64px 36px minmax(0,1.3fr) minmax(0,1fr) 190px 132px';
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

export default function SeparationView({ connections = [], degree2 = [], fullDegree1 = connections, fullDegree2 = degree2, onSelect, userName, selectedId, tierColors = CLASSIC, preset = null }) {
  const isMobile = useIsMobile();
  // Room at the top for the notch, only while it's on screen (a scan, or another tab's views).
  const notch = useSyncExternalStore(watchNotchShown, notchShownNow, noNotch);
  const ROW_H = isMobile ? 68 : 56;
  const K = isMobile ? 5 : 10;
  const sidePad = isMobile ? 8 : 16;

  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  // The slider, 0 (rarest ways in first) to 100 (easiest first); 50 is power alone.
  // The list follows a deferred copy, so the thumb never waits for a sort.
  const [at, setAt] = useState(SLIDER_MIDDLE);
  const atSlow = useDeferredValue(at);
  const [tier, setTier] = useState('all');
  // Rarity beside the tier (lib/rarity.js): any bands switched on; none is everyone.
  const [rarities, setRarities] = useState(() => new Set());
  // Path: one sector or one company, or none. The picker is only on screen while it's open.
  const [path, setPath] = useState(null);            // { kind: 'sector' | 'company', key, label, color }
  const [pathOpen, setPathOpen] = useState(false);
  const [pathText, setPathText] = useState('');
  const [pathUsed, setPathUsed] = useState(false);   // companies are only read once Path is opened
  // Filters a card's Insights asked for ("Show them", "S only"): applied once each.
  const [presetFor, setPresetFor] = useState(null);
  if (preset && preset.id !== presetFor) {
    setPresetFor(preset.id);
    setQuery(preset.query || '');
    setTier(preset.tier || 'all');
    setRarities(new Set(preset.rarity ? [preset.rarity] : []));
  }
  const requests = useRequests();
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
  // How rare the way in to each person is, counted across every circle you've
  // scanned (not only the ones a bridge-tier filter leaves): never a score.
  const waysAll = useMemo(() => routeIndex(fullDegree2), [fullDegree2]);
  const rarityBy = useMemo(() => {
    const m = new Map();
    for (const p of model.people) m.set(p.key, rarityOf(p.person, waysAll.get(p.key)?.size || p.waysIn));
    return m;
  }, [model, waysAll]);
  const ordered = useMemo(() => {
    if (atSlow === SLIDER_MIDDLE) return model.people;
    const value = new Map();
    for (const p of model.people) value.set(p.key, slideValue(p.score, rarityBy.get(p.key)?.count || p.waysIn, atSlow));
    return [...model.people].sort((a, b) => value.get(b.key) - value.get(a.key) || comparePower(a, b));
  }, [model, rarityBy, atSlow]);
  const byRarity = useMemo(() => {
    const out = Object.fromEntries(RARITY.map((r) => [r.key, 0]));
    for (const r of rarityBy.values()) out[r.key]++;
    return out;
  }, [rarityBy]);
  // Where everyone works, and the sector that suggests (inferred, as in Paths):
  // read once, the first time Path is opened.
  const facets = useMemo(() => {
    if (!pathUsed) return null;
    const by = new Map();
    const sectors = new Map();
    const companies = new Map();
    for (const p of model.people) {
      const company = companyOf(p.person) || null;
      const sector = industryOf(company, p.person.headline).key;
      by.set(p.key, { company, sector });
      sectors.set(sector, (sectors.get(sector) || 0) + 1);
      if (company) companies.set(company, (companies.get(company) || 0) + 1);
    }
    return {
      by,
      sectors: INDUSTRIES.map((i) => ({ ...i, count: sectors.get(i.key) || 0 })).filter((i) => i.count > 0).sort((a, b) => b.count - a.count),
      companies: [...companies].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }, [model, pathUsed]);
  const onPath = useCallback((p) => {
    if (!path || !facets) return true;
    const f = facets.by.get(p.key);
    return path.kind === 'sector' ? f?.sector === path.key : f?.company === path.key;
  }, [path, facets]);
  const matches = useCallback((p, text) => (tier === 'all' || p.tier === tier)
    && (!rarities.size || rarities.has(rarityBy.get(p.key)?.key))
    && onPath(p)
    && (!text || p.haystack.includes(text)), [tier, rarities, rarityBy, onPath]);
  const visible = useMemo(() => {
    if (!q && tier === 'all' && !rarities.size && !path) return ordered;
    return ordered.filter((p) => matches(p, q));
  }, [ordered, q, tier, rarities, path, matches]);

  // Who you've already asked, or already know. The map is "who to ask next",
  // so it moves on past them: send requests to its ten and the next ten come
  // up. The list still shows everyone, marked.
  const d1Keys = useMemo(() => new Set(fullDegree1.map(keyFor)), [fullDegree1]);
  const statusOf = useCallback((p) => (d1Keys.has(p.key) ? 'connected' : hasRequest(p.person, requests) ? 'asked' : null),
    [d1Keys, requests]);
  // How many the map draws follows the slider: ten, then fewer, then the one you're aiming at.
  const shown = mapCount(atSlow, K);
  const unasked = useMemo(() => visible.filter((p) => !statusOf(p)).slice(0, K + 1), [visible, K, statusOf]);
  const top = useMemo(() => unasked.slice(0, shown), [unasked, shown]);
  const askedShown = useMemo(() => visible.reduce((n, p) => n + (statusOf(p) ? 1 : 0), 0), [visible, statusOf]);
  const selectedKey = selectedId != null ? model.rowToKey.get(selectedId) ?? null : null;
  // Down to one: the person picked, if they're in what's showing, else the top of the list.
  const single = shown === 1;
  const target = useMemo(() => {
    if (!single) return null;
    return (selectedKey && visible.find((p) => p.key === selectedKey)) || unasked[0] || null;
  }, [single, selectedKey, visible, unasked]);
  const nextUp = useMemo(() => (single && target ? unasked.filter((p) => p.key !== target.key).slice(0, isMobile ? 3 : 6) : []),
    [single, target, unasked, isMobile]);

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
  // One map for both: ten people fanned out, or the one you're aiming at with
  // everyone who leads to them. The same shape, so it glides from one to the other.
  // Wide enough: connections as pills and people as cards (Blake, 2026-10-03); a phone keeps the dots.
  const cards = !isMobile && cw >= 760;
  const layout = useMemo(
    () => (single ? convergeLayout(target, cw || 800, isMobile, { cards }) : summitLayout(top, cw || 800, isMobile, { cards })),
    [single, target, top, cw, isMobile, cards],
  );
  const captionH = isMobile ? 58 : 40;   // fixed, so HEAD is arithmetic; the phone legend takes two lines
  const NEXT_H = nextUp.length ? 38 : 0;
  const mapH = single ? (target ? layout.height + NEXT_H : 0) : layout.height;
  const mapBlockH = mapH ? captionH + mapH + 12 : 0;
  const titleH = isMobile ? 0 : TITLE_ROW;
  const HEAD = mapBlockH + titleH + LABEL_ROW;
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
  const changeRarity = (r) => { setRarities((set) => toggle(set, r)); toTop(); };
  const clearAll = () => { setQuery(''); setTier('all'); setRarities(new Set()); setPath(null); toTop(); };
  const openPath = () => { setPathUsed(true); setPathText(''); setPathOpen(true); };
  const pickPath = (next) => { setPath(next); setPathOpen(false); toTop(); };
  const changeAt = (v) => { setAt(Math.max(0, Math.min(100, Math.round(Number(v) || 0)))); toTop(); };
  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      // Read the live text, not the deferred copy the list is still catching up to.
      const live = query.trim().toLowerCase();
      const first = ordered.find((p) => matches(p, live));
      if (first) onPick(first);
    } else if (e.key === 'Escape') {
      if (query) changeQuery('');
      else e.currentTarget.blur();
    }
  };

  const { summary } = model;
  const filtered = !!q || tier !== 'all' || rarities.size > 0 || !!path;
  const slide = slideLabel(at);
  const slideColor = at < 45 ? RARE : at > 55 ? EASY : '#FFD700';
  const youLabel = !userName || /^you$/i.test(String(userName).trim()) ? 'You' : initialsFor(userName);
  const rows = visible.slice(start, end);

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: '#0a0a1a', color: '#fff', overflow: 'hidden',
    }}>
      {/* ── Header: what this is, how many, and what it can't say ── */}
      <div style={{ padding: `${notch ? 48 : 14}px ${SIDE}px 8px`, flexShrink: 0 }}>
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

      {/* ── Controls: search, then the slider with their tier and rarity ── */}
      <div style={{ padding: `0 ${SIDE}px 10px`, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <style>{SLIDER_CSS}</style>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search people, companies, or who knows them"
          aria-label="Search people, companies, or who knows them"
          style={{
            width: '100%', minWidth: 0, height: isMobile ? 44 : 34, boxSizing: 'border-box',
            padding: '0 12px', borderRadius: 8, outline: 'none', color: '#fff',
            fontSize: isMobile ? 16 : 13,        // under 16px, iOS zooms the page on focus
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
          }}
        />
        <div style={{
          marginTop: 8, padding: isMobile ? '8px 10px' : '8px 14px', borderRadius: 12, position: 'relative',
          border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)',
        }}>
          {pathOpen && (
            <PathPicker facets={facets} text={pathText} onText={setPathText} isMobile={isMobile}
              onPick={pickPath} onClose={() => setPathOpen(false)} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: isMobile ? 'nowrap' : 'wrap', minWidth: 0,
            // A phone scrolls this strip sideways, so the page itself never does.
            overflowX: isMobile ? 'auto' : 'visible', scrollbarWidth: 'thin' }}>
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
            {/* Path: one sector or one company. The picker opens under here and goes away once you pick. */}
            <span style={{ display: 'inline-flex', flexShrink: 0, height: isMobile ? 40 : 30, borderRadius: 15, overflow: 'hidden',
              border: `1px solid ${path ? PATH : 'rgba(0,255,136,0.35)'}`, background: path ? 'rgba(0,255,136,0.12)' : 'rgba(0,255,136,0.04)' }}>
              <button type="button" aria-haspopup="dialog" aria-expanded={pathOpen} onClick={() => (pathOpen ? setPathOpen(false) : openPath())}
                title="Narrow everyone to one sector or one company" style={{
                  padding: path ? '0 6px 0 12px' : '0 12px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: PATH, maxWidth: isMobile ? 200 : 300, overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                {path ? <>Path<span style={{ fontWeight: 500, color: '#cfe' }}> · {path.label}</span></> : 'Path ▾'}
              </button>
              {path && (
                <button type="button" aria-label={`Clear the path: ${path.label}`} onClick={() => pickPath(null)} style={{
                  padding: '0 10px 0 4px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: PATH,
                }}>×</button>
              )}
            </span>
            {/* Where the slider is, in words */}
            <span aria-live="polite" style={{
              marginLeft: 'auto', flexShrink: 0, height: isMobile ? 40 : 30, padding: '0 12px', borderRadius: 15, boxSizing: 'border-box',
              display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
              border: `1px solid ${slideColor}66`, background: `${slideColor}14`, color: slideColor,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: slideColor }} />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{at}</span>
              {slide.name}
            </span>
          </div>

          {/* The slider: the rarest ways in at one end, the easiest at the other, power alone in the middle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            <span style={{ color: RARE }}>Rare{isMobile ? '' : ' · one way in'}</span>
            <span style={{ color: '#FFD700' }}>Power</span>
            <span style={{ color: EASY }}>Easy{isMobile ? '' : ' · many mutual connections'}</span>
          </div>
          <input
            className="sepslide" type="range" min={0} max={100} step={1} value={at}
            onChange={(e) => changeAt(e.target.value)}
            onDoubleClick={() => changeAt(SLIDER_MIDDLE)}
            aria-label="Order: the rarest ways in, to the easiest"
            aria-valuetext={`${at}: ${slide.name}`}
            title="Drag to reorder everyone. Double-click to go back to the middle."
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: -2 }}>
            {[[0, 'Rarest'], [25, ''], [SLIDER_MIDDLE, 'By power'], [75, ''], [100, 'Easiest']].map(([v, name]) => (
              <button key={v} type="button" onClick={() => changeAt(v)} aria-label={`Set the slider to ${v}${name ? `: ${name}` : ''}`} style={{
                padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 10,
                color: at === v ? '#fff' : '#667', fontWeight: at === v ? 700 : 500, fontVariantNumeric: 'tabular-nums',
              }}>{v}{name && !isMobile ? ` · ${name}` : ''}</button>
            ))}
          </div>
          <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: '#bbb' }}>
            <span style={{ color: slideColor, fontWeight: 700 }}>{slide.name}.</span>{' '}{slide.detail}
            {!isMobile && <span style={{ color: '#667' }}>{' '}It only reorders: scores, tiers and ranks stay as they are.</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minWidth: 0, flexWrap: isMobile ? 'nowrap' : 'wrap',
            overflowX: isMobile ? 'auto' : 'visible', scrollbarWidth: 'thin' }}>
            <span title={RARITY_NOTE} style={{ fontSize: 10, color: '#666', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'help' }}>Only show</span>
            {RARITY.map((r) => {
              const on = rarities.has(r.key);
              return (
                <button key={r.key} type="button" aria-pressed={on} onClick={() => changeRarity(r.key)}
                  title={`${r.label}: ${r.range} mutual connection${r.range === '1' ? '' : 's'}. ${RARITY_NOTE}`} style={{
                    height: isMobile ? 40 : 28, padding: '0 10px', borderRadius: 14, cursor: 'pointer', flexShrink: 0,
                    fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                    border: `1px solid ${on ? r.color : 'rgba(255,255,255,0.1)'}`,
                    background: on ? `${r.color}22` : 'rgba(255,255,255,0.03)',
                    color: on ? r.color : '#999',
                  }}>
                  {r.label}
                  <span style={{ marginLeft: 5, fontWeight: 500, color: on ? r.color : '#666', opacity: 0.85 }}>{fmt(byRarity[r.key])}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── One scroll: the summit map, then every person ── */}
      <div
        ref={attachScroll}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', padding: `0 ${sidePad}px` }}
      >
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', height: total }}>
          {mapBlockH > 0 && (
            <div style={{ height: mapBlockH, boxSizing: 'border-box', paddingTop: 10 }}>
              <div style={{ height: captionH - 10, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {single
                    ? <>Aiming at {target.person.name} · every connection of yours who leads to them</>
                    : <>Top {fmt(top.length)} you haven’t asked, of {fmt(visible.length)}{filtered ? ' shown' : ''}{at !== SLIDER_MIDDLE ? ` · ${slide.name.toLowerCase()}` : ''} · every way in drawn</>}
                </div>
                <div style={{ fontSize: 10, color: '#777', marginTop: 2, whiteSpace: isMobile ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }}>
                  {!single && askedShown > 0 && <span style={{ color: '#FFD700' }}>{fmt(askedShown)} asked or connected, so it moved on · </span>}
                  <span style={{ color: ORANGE }}>solid orange</span> = top-scored bridge · dashed = other routes
                  {single ? ' · pick anyone in the list to aim at them instead' : cards ? ' · a lit pill is someone’s best way in' : ' · dot size = ways in'}
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
                  mutualsBy={rarityBy}
                  doors={!isMobile && cw >= 640}
                  cards={cards}
                />
              )}
              {/* Aiming at one person: the next few, to aim at instead */}
              {cw > 0 && single && (
                <>
                  {nextUp.length > 0 && (
                    <div style={{ height: NEXT_H, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                      <span style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Next</span>
                      {nextUp.map((p) => (
                        <button key={p.key} type="button" onClick={() => onPick(p)} title={`Aim at ${p.person.name}`} style={{
                          height: 26, padding: '0 10px', borderRadius: 13, cursor: 'pointer', flexShrink: 1, minWidth: 0,
                          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          border: `1px solid ${(tierColors[p.tier] || '#888')}55`, background: 'rgba(255,255,255,0.03)', color: '#ccc',
                        }}>
                          {shortName(p.person.name)}
                          <span style={{ marginLeft: 5, color: tierColors[p.tier] || '#888', fontWeight: 700 }}>{p.score.toFixed(1)}</span>
                          <span style={{ marginLeft: 5, color: '#667', fontWeight: 500 }}>{p.waysIn === 1 ? '1 way' : `${p.waysIn} ways`}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {visible.length > 0 && !isMobile && (
            <div style={{
              height: TITLE_ROW, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 15px', boxSizing: 'border-box',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>Ranked by reach</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#000', background: '#FFD700', borderRadius: 10, padding: '2px 8px' }}>
                {fmt(visible.length)}{filtered ? ` of ${fmt(summary.people)}` : ''}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#777' }}>
                order follows the slider · <span style={{ color: slideColor }}>{slide.name.toLowerCase()}</span>
              </span>
            </div>
          )}
          {visible.length > 0 && (
            <div style={{
              height: LABEL_ROW, display: 'grid', alignItems: 'center', gap: 10, padding: '0 12px 0 15px',
              gridTemplateColumns: isMobile ? '44px 36px 1fr 44px' : COLUMNS,
              fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5,
              borderBottom: '1px solid rgba(255,255,255,0.08)', boxSizing: 'border-box',
            }}>
              <span title="Rank by score, then ways in. = means tied">#</span>
              <span />
              {isMobile ? <span>Person · way in</span> : <><span>Person</span><span>Way in</span><span title={RARITY_NOTE}>How rare the way in</span><span style={{ textAlign: 'right' }}>Power</span></>}
              {isMobile && <span style={{ textAlign: 'right' }}>Score</span>}
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
              status={statusOf(p)}
              rarity={rarityBy.get(p.key)}
            />
          ))}

          {visible.length === 0 && (
            <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', color: '#888', fontSize: 13, padding: '0 16px' }}>
              {q
                ? <>No one matches ‘{query.trim()}’. Search covers names, headlines, companies and who knows them.</>
                : <>No one here with those filters.</>}
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={clearAll} style={{
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
const MOVE = '.38s cubic-bezier(.2,.8,.2,1)';
const MAP_CSS = `
.sepmap .sp { cursor: pointer; transition: opacity .12s; }
.sepmap .ppl:hover .sp { opacity: .28; }
.sepmap .ppl:hover .sp:hover, .sepmap .ppl:hover .sp.sel { opacity: 1; }
.sepmap .sp:hover .rt, .sepmap .sp.sel .rt { stroke-opacity: 1; stroke-width: 2px; }
.sepmap .br { cursor: pointer; }
.sepmap .br:hover text { text-decoration: underline; }
.sepmap .rt { pointer-events: none; }
/* Everything glides to its new place as the slider moves: dots and names by
   their group's transform, lines by their path. Newcomers fade in. */
.sepmap .mv { transition: transform ${MOVE}; }
.sepmap .rt, .sepmap .spk { transition: d ${MOVE}, stroke-opacity .12s; }
.sepmap .in { animation: sepIn .3s ease-out both; }
@keyframes sepIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .sepmap .mv, .sepmap .rt, .sepmap .spk { transition: none; }
  .sepmap .in { animation: none; }
}
`;
const HALO = { paintOrder: 'stroke', stroke: '#0a0a1a', strokeWidth: 3, strokeLinejoin: 'round' };
const at = (x, y) => ({ transform: `translate(${x}px, ${y}px)` });

/**
 * How many mutual connections lead to someone, said the way the data has it:
 * the ones drawn are the connections of yours whose circles you've scanned;
 * LinkedIn's own count, when a scan saved one, can be higher.
 */
function waysTag(p, mutuals) {
  if (mutuals?.from === 'linkedin' && mutuals.count > p.waysIn) {
    return { text: `${fmt(mutuals.count)} mutuals · ${fmt(p.waysIn)} mapped`, rare: false, more: mutuals.count };
  }
  return p.waysIn === 1 ? { text: 'only way in', rare: true, more: 0 } : { text: `${fmt(p.waysIn)} ways in`, rare: false, more: 0 };
}

const SummitMap = memo(function SummitMap({ layout, selectedKey, tierColors, youLabel, isMobile, onPick, onPickBridge, mutualsBy, doors = false, cards = false }) {
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

      <defs>
        <radialGradient id="sepAimHalo"><stop offset="0" stopColor="#FFD700" stopOpacity="0.2" /><stop offset="1" stopColor="#FFD700" stopOpacity="0" /></radialGradient>
      </defs>
      {spokes.map((s) => (
        <path key={`s-${s.id ?? 'unresolved'}`} className="spk in" d={`M${s.x1},${s.y1} L${cards ? s.x2 - PILL_W : s.x2},${s.y2}`} fill="none" stroke="#fff" strokeOpacity={0.12} strokeWidth={1} />
      ))}

      {cards && people.length === 1 && people[0].big && (
        <circle className="mv" style={at(people[0].x + Math.min(200, (width - people[0].x) / 2), people[0].y)} r={170} fill="url(#sepAimHalo)" />
      )}
      <g className="ppl">
        {people.map((pp) => {
          const { p } = pp;
          const c = tierColors[p.tier] || '#888';
          const sel = pp.key === selectedKey;
          const via = p.routes.map((r) => (r.bridge ? r.bridge.name : CANT_NAME)).join(', ');
          const tag = waysTag(p, mutualsBy?.get(p.key));
          const lx = pp.r + 14;
          const room = Math.max(8, Math.floor((width - pp.x - lx) / 6));
          const clip = (t) => (String(t || '').length > room ? `${String(t).slice(0, room - 1)}…` : String(t || ''));
          return (
            <g key={pp.key} className={sel ? 'sp sel' : 'sp'} onClick={() => onPick(p)}>
              <title>{`${p.person.name} · #${p.rank}${p.tied ? '=' : ''} · ${p.tier} · ${p.score.toFixed(1)} · ${tag.text} · via ${via}`}</title>
              {(linksBy.get(pp.key) || []).map((l) => {
                const mx = (l.x1 + l.x2) / 2;
                // Aiming at one person: their other routes are gold; among ten, each bridge's tier colour.
                const stroke = l.unresolved ? '#777' : l.primary ? ORANGE : pp.big ? '#FFD700' : tierColors[l.tier] || '#888';
                return (
                  <path
                    key={`${l.key}-${l.bridgeId ?? 'u'}`}
                    className="rt in"
                    d={cards
                      ? `M${l.x1},${l.y1} C${mx},${l.y1} ${mx},${l.y2} ${l.x2},${l.y2}`
                      : `M${l.x1 + 5},${l.y1} C${mx},${l.y1} ${mx},${l.y2} ${l.x2 - pp.r - (pp.big ? 2 : 0)},${l.y2}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={pp.big ? (l.primary ? 2.2 : 1.4) : l.primary ? 1.5 : 1}
                    strokeOpacity={pp.big ? (l.primary ? 0.95 : 0.6) : l.primary ? 0.8 : 0.35}
                    strokeDasharray={l.primary ? undefined : pp.big ? '5 4' : '3 3'}
                  />
                );
              })}
              {/* As cards, each line plugs into both boxes: a small dot at each end */}
              {cards && (linksBy.get(pp.key) || []).map((l) => {
                const stroke = l.unresolved ? '#777' : l.primary ? ORANGE : pp.big ? '#FFD700' : tierColors[l.tier] || '#888';
                return (
                  <g key={`e-${l.bridgeId ?? 'u'}`} className="in" pointerEvents="none">
                    <circle className="mv" style={at(l.x1, l.y1)} r={2.6} fill={stroke} />
                    <circle className="mv" style={at(l.x2, l.y2)} r={2.6} fill={stroke} />
                  </g>
                );
              })}
              <g className="mv in" style={at(pp.x, pp.y)}>
                {(pp.rings || []).map((r, i) => (
                  <circle key={r} r={r} fill="none" stroke={c} strokeOpacity={0.28 - i * 0.08} strokeWidth={1} strokeDasharray={i ? '2 5' : undefined} />
                ))}
                {!cards && <rect x={-12} y={-gap / 2} width={Math.max(0, width - pp.x + 12)} height={gap} fill="transparent" />}
                {cards && pp.big ? (
                  <BigCard p={p} c={c} tag={tag} width={Math.max(260, Math.min(400, width - pp.x - 4))} fs={fs} />
                ) : cards ? (
                  <SmallCard p={p} c={c} tag={tag} width={Math.max(240, Math.min(340, width - pp.x - 4))} sel={sel} />
                ) : pp.big ? (
                  <>
                    <circle r={pp.r} fill="#0a0a1a" stroke={c} strokeWidth={3} />
                    <text dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={800} fill={c}>{initialsFor(p.person.name)}</text>
                    <text x={lx} y={-20} fontSize={fs + 3} fontWeight={800} fill="#fff" style={HALO}>{clip(p.person.name)}</text>
                    <text x={lx} y={-4} fontSize={fs} fill="#aaa" style={HALO}>{clip(subline(p.person))}</text>
                    <text x={lx} y={13} fontSize={fs} fontWeight={700} fill={c} style={HALO}>
                      #{p.rank}{p.tied ? '=' : ''} · {p.tier}-tier · {p.score.toFixed(1)}
                    </text>
                    <text x={lx} y={29} fontSize={fs} fill="#ccc" style={HALO}>
                      {clip(tag.more
                        ? `${fmt(tag.more)} mutual connections · ${fmt(p.waysIn)} drawn here`
                        : p.waysIn === 1 ? '1 mutual connection: the only way in' : `${fmt(p.waysIn)} mutual connections, all drawn`)}
                    </text>
                    {tag.more > 0 && (
                      <text x={lx} y={44} fontSize={fs - 1} fill="#778" style={HALO}>
                        {clip('The count is LinkedIn’s; the rest are in circles not scanned yet')}
                      </text>
                    )}
                  </>
                ) : (
                  <>
                    {sel && <circle r={pp.r + 3.5} fill="none" stroke="#fff" strokeWidth={1.5} />}
                    <circle r={pp.r} fill={c} />
                    <text x={14} dy="0.35em" fontSize={fs} fill="#ddd" style={HALO}>
                      {pp.label}
                      <tspan dx={6} fill={c} fontWeight={700}>{p.score.toFixed(1)}</tspan>
                      {/* How many mutual connections lead to them: one is the rare kind */}
                      {doors && (
                        <tspan dx={8} fontSize={fs - 2} fontWeight={700} fill={tag.rare ? RARE : '#778'}>{tag.text}</tspan>
                      )}
                    </text>
                  </>
                )}
              </g>
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
              : `${b.bridge.name} · ${b.bridge.tier}-tier${b.count > 1 ? ` · a way in to ${b.count} of these` : ''} · click to open`}</title>
            <g className="mv in" style={at(b.x, b.y)}>
              {cards ? <Pill b={b} c={c} big={people.length === 1 && people[0].big} /> : (<>
              <circle
                r={b.r}
                fill={b.unresolved ? 'none' : c}
                stroke={b.unresolved ? '#777' : '#0a0a1a'}
                strokeWidth={b.unresolved ? 1 : 1.5}
                strokeDasharray={b.unresolved ? '2 2' : undefined}
              />
              <text x={-9} dy="0.35em" textAnchor="end" fontSize={fs - 1} fill={c}
                fontStyle={b.unresolved ? 'italic' : undefined} fontWeight={b.unresolved ? 400 : b.primary ? 800 : 600} style={HALO}>
                {b.label}
              </text>
              </>)}
            </g>
          </g>
        );
      })}

      <g className="mv" style={at(you.x, you.y)}>
        <circle r={you.r} fill="url(#sepYouGrad)" />
        <text dy="0.35em" textAnchor="middle" fontSize={youLabel.length > 2 ? 9 : 10} fontWeight={800} fill="#000">
          {youLabel}
        </text>
      </g>
    </svg>
  );
});

// ── Cards (Blake, 2026-10-03: mock-ups 1 and 1b) ───────────────────────────
// Connections as pills in the middle, people as cards on the right; at the
// easy end, the one person as a big card. Plain SVG, placed by the same
// gliding groups as the dots, so the slider still moves everything smoothly.
const PILL_W = 236;
const clipText = (t, n) => (String(t || '').length > n ? `${String(t).slice(0, Math.max(1, n - 1))}…` : String(t || ''));
const chipW = (text, size = 9.5) => Math.round(String(text).length * size * 0.6 + 14);

/** A connection: their initials, name, tier and what they are to the people on the map. */
function Pill({ b, c, big }) {
  if (b.unresolved) {
    return (
      <g>
        <rect x={-PILL_W} y={-14} width={PILL_W} height={28} rx={14} fill="#11132a" stroke="#555" strokeDasharray="3 3" />
        <text x={-PILL_W + 14} dy="0.35em" fontSize={11.5} fontStyle="italic" fill="#888">{clipText(b.label, 30)}</text>
      </g>
    );
  }
  const tier = b.bridge.tier;
  const tag = big
    ? (b.primary ? `${tier} · best way in` : tier)
    : b.onlyFor ? `${tier} · only door${b.onlyFor > 1 ? ` ×${b.onlyFor}` : ''}`
      : b.bestFor ? `${tier} · door for ${b.bestFor}` : tier;
  const hot = big ? b.primary : b.bestFor > 0;
  const tw = chipW(tag);
  return (
    <g>
      <rect x={-PILL_W} y={-14} width={PILL_W} height={28} rx={14} fill="#14172e"
        stroke={hot ? 'rgba(255,215,0,0.55)' : 'rgba(255,255,255,0.09)'} strokeWidth={hot ? 1.3 : 1} />
      <circle cx={-PILL_W + 15} r={10} fill={c} />
      <text x={-PILL_W + 15} dy="0.35em" textAnchor="middle" fontSize={8} fontWeight={800} fill="#000">{initialsFor(b.bridge.name)}</text>
      <text x={-PILL_W + 31} dy="0.35em" fontSize={12} fontWeight={600} fill="#e8e8f0">
        {clipText(b.bridge.name, Math.max(6, Math.floor((PILL_W - 31 - tw - 10) / 6.4)))}
      </text>
      <rect x={-tw - 7} y={-9} width={tw} height={18} rx={9} fill={`${c}22`} />
      <text x={-7 - tw / 2} dy="0.35em" textAnchor="middle" fontSize={9.5} fontWeight={800} fill={c}>{tag}</text>
    </g>
  );
}

/** Someone on the map: rank, name, role, score, and how many ways in. */
function SmallCard({ p, c, tag, width, sel }) {
  const tw = chipW(tag.text);
  return (
    <g>
      <rect x={0} y={-20} width={width} height={40} rx={10} fill="#151830" stroke={sel ? '#fff' : 'rgba(255,255,255,0.09)'} strokeWidth={sel ? 1.5 : 1} />
      <text x={12} dy="0.35em" fontSize={11} fontWeight={800} fill="#FFD700">#{p.rank}{p.tied ? '=' : ''}</text>
      <text x={60} y={-3} fontSize={13} fontWeight={700} fill="#fff">{clipText(p.person.name, Math.floor((width - 60 - 70) / 7))}</text>
      <text x={60} y={12} fontSize={10.5} fill="#8a8fa8">{clipText(subline(p.person), Math.floor((width - 60 - tw - 20) / 5.6))}</text>
      <text x={width - 12} y={-2} textAnchor="end" fontSize={14} fontWeight={800} fill={c}>{p.score.toFixed(1)}</text>
      <rect x={width - 12 - tw} y={4} width={tw} height={14} rx={7}
        fill={tag.rare ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.06)'} stroke={tag.rare ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.14)'} />
      <text x={width - 12 - tw / 2} y={11} dy="0.35em" textAnchor="middle" fontSize={9.5} fontWeight={800} fill={tag.rare ? RARE : '#cfd3e6'}>{tag.text}</text>
    </g>
  );
}

/** The one person you're aiming at: a large card with both numbers that matter. */
function BigCard({ p, c, tag, width, fs }) {
  const named = p.routes.filter((r) => r.bridge).length;
  const first = tag.more ? `${fmt(tag.more)} mutual connections` : p.waysIn === 1 ? '1 mutual connection' : `${fmt(p.waysIn)} mutual connections`;
  const second = tag.more ? `${fmt(p.waysIn)} drawn here` : p.waysIn === 1 ? 'the only way in' : 'all drawn here';
  const w1 = chipW(first, 10.5);
  const w2 = chipW(second, 10.5);
  const tx = 96;
  const room = Math.floor((width - tx - 14) / 6.6);
  return (
    <g>
      <rect x={0} y={-76} width={width} height={152} rx={16} fill="#151830" stroke="rgba(255,215,0,0.45)" />
      <circle cx={48} r={32} fill="#0a0a1a" stroke={c} strokeWidth={3} />
      <text x={48} dy="0.35em" textAnchor="middle" fontSize={18} fontWeight={800} fill={c}>{initialsFor(p.person.name)}</text>
      <text x={tx} y={-40} fontSize={11} fontWeight={800} fill="#FFD700">#{p.rank}{p.tied ? '=' : ''} · {p.tier}-tier · {p.score.toFixed(1)}</text>
      <text x={tx} y={-17} fontSize={fs + 8} fontWeight={800} fill="#fff">{clipText(p.person.name, Math.floor(room * 0.72))}</text>
      <text x={tx} y={1} fontSize={12} fill="#8a8fa8">{clipText(subline(p.person), room)}</text>
      <rect x={tx} y={12} width={w1} height={20} rx={10} fill="rgba(255,112,67,0.12)" stroke="rgba(255,112,67,0.4)" />
      <text x={tx + w1 / 2} y={22} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={800} fill={EASY}>{first}</text>
      <rect x={tx + w1 + 6} y={12} width={w2} height={20} rx={10} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.14)" />
      <text x={tx + w1 + 6 + w2 / 2} y={22} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#cfd3e6">{second}</text>
      <text x={tx} y={50} fontSize={10.5} fill="#6b7090">
        {tag.more ? `The ${fmt(tag.more)} is LinkedIn’s count;` : named === 1 ? 'Only one of your connections knows them.' : `${fmt(named)} of your connections know them.`}
      </text>
      {tag.more > 0 && (
        <text x={tx} y={64} fontSize={10.5} fill="#6b7090">
          {clipText(`the other ${fmt(tag.more - named)} are in circles you haven’t scanned yet.`, Math.floor((width - tx - 14) / 5.4))}
        </text>
      )}
    </g>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function Via({ p, route, tierColors, compact }) {
  if (!compact) return <WayIn p={p} route={route} tierColors={tierColors} />;
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

/** The ledger's way in: the connection's face and name, and under it "only way in" or how many more. */
function WayIn({ p, route, tierColors }) {
  const b = route?.bridge;
  const extra = p.waysIn - 1;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} title={`Every way in:\n${everyRoute(p)}`}>
      {b ? <Avatar person={b} size={26} tierColors={tierColors} /> : <span style={{ width: 26, height: 26, borderRadius: '50%', border: '1px dashed #666', flexShrink: 0 }} />}
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...ellipsis, fontSize: 13, fontWeight: 700, color: b ? tierColors[b.tier] || '#ddd' : '#777', fontStyle: b ? 'normal' : 'italic' }}>
          {b ? b.name : CANT_NAME}
        </span>
        <span style={{ ...ellipsis, fontSize: 10.5, marginTop: 1, color: extra > 0 ? '#99a' : RARE, fontWeight: extra > 0 ? 500 : 700 }}>
          {extra > 0 ? `+${extra} more way${extra > 1 ? 's' : ''} in` : 'only way in'}
        </span>
      </span>
    </span>
  );
}

/** How rare the way in is, as a bar: full for one door, nearly empty for the warmest. */
function RarityBar({ p, rarity }) {
  const info = rarity ? rarityInfo(rarity.key) : null;
  if (!info) return <span />;
  const fill = Math.max(0.06, 1 - easeOf(rarity.count));
  const mapped = rarity.from === 'linkedin' && rarity.count > p.waysIn ? `, ${fmt(p.waysIn)} mapped` : '';
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}
      title={`${rarity.count} mutual connection${rarity.count === 1 ? '' : 's'}${rarity.from === 'scans' ? ' (from your scans, so it can only go up)' : ' (LinkedIn’s count)'}. ${RARITY_NOTE}`}>
      <span style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${fill * 100}%`, borderRadius: 3, background: info.color }} />
      </span>
      <span style={{ ...ellipsis, fontSize: 10.5, fontWeight: 700, color: info.color }}>
        {info.label} · {fmt(rarity.count)} mutual{rarity.count === 1 ? '' : 's'}{mapped}
      </span>
    </span>
  );
}

/** "Request sent" or "Connected", and how rare the way in is. */
function Tags({ status, rarity }) {
  const info = rarity ? rarityInfo(rarity.key) : null;
  return (
    <>
      {status === 'asked' && (
        <span title="You sent a request. It shows everywhere in the app." style={{
          flexShrink: 0, fontSize: 9, fontWeight: 800, color: '#FFD700', border: '1px dashed rgba(255,215,0,0.6)', borderRadius: 4, padding: '0 4px',
        }}>Request sent</span>
      )}
      {status === 'connected' && (
        <span title="Already one of your connections" style={{
          flexShrink: 0, fontSize: 9, fontWeight: 800, color: '#00ff88', border: '1px solid rgba(0,255,136,0.5)', borderRadius: 4, padding: '0 4px',
        }}>Connected</span>
      )}
      {info && status !== 'connected' && (
        <span title={`${rarity.count} mutual connection${rarity.count === 1 ? '' : 's'}${rarity.from === 'scans' ? ' (from your scans, so it can only go up)' : ''}. ${RARITY_NOTE}`} style={{
          flexShrink: 0, fontSize: 9, fontWeight: 700, color: info.color, border: `1px solid ${info.color}55`, borderRadius: 4, padding: '0 4px',
        }}>{info.label}</span>
      )}
    </>
  );
}

// ── Path: pick one sector or one company ───────────────────────────────────
// Opens under the Path button, over the slider, and closes on a pick, on Esc
// or on a click anywhere else. Sectors are inferred (lib/companies.js), so it says so.
function PathPicker({ facets, text, onText, onPick, onClose, isMobile }) {
  const needle = text.trim().toLowerCase();
  const sectors = (facets?.sectors || []).filter((i) => !needle || i.label.toLowerCase().includes(needle));
  const companies = (facets?.companies || []).filter((c) => !needle || c.name.toLowerCase().includes(needle)).slice(0, needle ? 60 : 24);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'Enter') {
      if (sectors.length === 1 && !companies.length) onPick({ kind: 'sector', key: sectors[0].key, label: sectors[0].label, color: sectors[0].color });
      else if (companies.length === 1 && !sectors.length) onPick({ kind: 'company', key: companies[0].name, label: companies[0].name });
    }
  };
  const sub = { fontSize: 9, fontWeight: 700, color: '#667', letterSpacing: 1, textTransform: 'uppercase', margin: '10px 0 6px' };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div role="dialog" aria-label="Pick a sector or a company" style={{
        position: 'absolute', zIndex: 41, top: isMobile ? 52 : 44, left: isMobile ? 6 : 14, width: isMobile ? 'calc(100% - 12px)' : 'min(560px, calc(100% - 28px))',
        maxHeight: 340, overflowY: 'auto', boxSizing: 'border-box', padding: 12, borderRadius: 12,
        background: '#0c101e', border: `1px solid ${PATH}55`, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}>
        <input
          autoFocus type="search" value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKey}
          placeholder="Type a sector or a company" aria-label="Type a sector or a company"
          style={{
            width: '100%', height: isMobile ? 44 : 34, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, outline: 'none',
            color: '#fff', fontSize: isMobile ? 16 : 13, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)',
          }}
        />
        {sectors.length > 0 && <div style={sub}>Sectors · inferred from company names and headlines</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sectors.map((i) => (
            <button key={i.key} type="button" onClick={() => onPick({ kind: 'sector', key: i.key, label: i.label, color: i.color })} style={{
              height: 28, padding: '0 10px', borderRadius: 14, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
              border: `1px solid ${i.color}66`, background: `${i.color}14`, color: '#ddd', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: i.color }} />
              {i.label}
              <span style={{ fontWeight: 500, color: '#889' }}>{fmt(i.count)}</span>
            </button>
          ))}
        </div>
        {companies.length > 0 && <div style={sub}>Companies{needle ? '' : ' · the biggest; type to find any'}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {companies.map((c) => (
            <button key={c.name} type="button" onClick={() => onPick({ kind: 'company', key: c.name, label: c.name })} style={{
              height: 28, padding: '0 10px', borderRadius: 14, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#ccc',
            }}>
              {c.name}
              <span style={{ marginLeft: 6, fontWeight: 500, color: '#889' }}>{fmt(c.count)}</span>
            </button>
          ))}
        </div>
        {!sectors.length && !companies.length && (
          <div style={{ fontSize: 12, color: '#888', padding: '12px 2px 4px' }}>
            {facets ? `Nothing matches ‘${text.trim()}’.` : 'Reading where everyone works…'}
          </div>
        )}
      </div>
    </>
  );
}

const PATH = '#00ff88';
// The slider's two ends, in the colours rarity already uses for them.
const RARE = '#00E5FF';
const EASY = '#FF7043';
const SLIDER_CSS = `
.sepslide { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 24px; margin: 4px 0 0; background: transparent; cursor: pointer; }
.sepslide::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${RARE} 0%, #FFD700 50%, ${EASY} 100%); }
.sepslide::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -7px; border-radius: 50%; background: #0a0a1a; border: 3px solid #fff; box-shadow: 0 0 10px rgba(255,255,255,0.45); }
.sepslide::-moz-range-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${RARE} 0%, #FFD700 50%, ${EASY} 100%); }
.sepslide::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #0a0a1a; border: 3px solid #fff; box-shadow: 0 0 10px rgba(255,255,255,0.45); }
.sepslide:focus-visible { outline: 2px solid rgba(255,255,255,0.7); outline-offset: 3px; border-radius: 6px; }
`;
const RARITY_NOTE = 'Rarity is how many mutual connections lead to them: few is a rare way in, many is warm (likely to accept). It never changes a score or a tier.';

const Row = memo(function Row({ p, top, height, isMobile, selected, tierColors, onPick, q, status, rarity }) {
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
        gridTemplateColumns: isMobile ? '44px 36px 1fr 44px' : COLUMNS,
        borderLeft: `3px solid ${selected ? ORANGE : 'transparent'}`,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: base, cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 800, color: podium ? c : '#555', whiteSpace: 'nowrap' }}>{rank}</span>
      <Avatar person={person} size={32} tierColors={tierColors} />

      {isMobile ? (
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: member ? '#888' : '#fff', minWidth: 0 }}>
              {person.name}{member && <span style={{ fontSize: 10, color: '#666', fontWeight: 400 }}> · out of network</span>}
            </span>
            <Tags status={status} rarity={rarity} />
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
              {/* The rarity has its own column here */}
              <Tags status={status} rarity={null} />
              {member && <span style={{ flexShrink: 0, fontSize: 10, color: '#666' }}>out of network</span>}
            </div>
            <div style={{ ...ellipsis, fontSize: 10, color: '#777', marginTop: 2 }}>{subline(person)}</div>
          </div>
          <Via p={p} route={route} tierColors={tierColors} />
          <RarityBar p={p} rarity={rarity} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
              <div style={{ height: '100%', borderRadius: 3, background: c, width: `${Math.max(0, Math.min(1, p.score / 10)) * 100}%` }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: c, width: 30, textAlign: 'right' }}>{p.score.toFixed(1)}</span>
          </div>
        </>
      )}

      {isMobile && (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: c }}>{p.score.toFixed(1)}</div>
          <div style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>{p.tier}</div>
        </div>
      )}
    </div>
  );
});
