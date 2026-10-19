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
// The map follows the slider too (Blake, 2026-10-02): from the rare end to the
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
import { separationPeople, comparePower, summitLayout, convergeLayout, mapCount, mostMutuals, shortName, TIERS, keyFor, routeIndex, tierOf, tierShown, tierSections, sectionLayout, itemsBetween } from '../../lib/separation';
import { companyOf, industryOf, INDUSTRIES } from '../../lib/companies';
import { RARITY, rarityOf, rarityInfo, toggle, SLIDER_MIDDLE, slideValue, slideLabel, easeOf } from '../../lib/rarity';
import { hasRequest, refreshRequests, markRequested } from '../../lib/requests-client';
import { autoAsks, autoAsksSignature, askStatus, leavesTop, topToAsk } from '../../lib/ask-next';
import useRequests from './useRequests';
import useScanner from './useScanner';
import { initialsFor, TIER_LABELS } from '../../lib/tiers';
import { watchNotchShown, notchShownNow, noNotch } from '../../lib/island';
import Avatar from './Avatar';
// Every profile link, Connect and View profile alike: Sixgree's own browser where it can.
import OpenProfile from './OpenProfile';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';
// The strategy engine (experimental, off by default): a Gatekeepers list and a
// Leverage badge on each way in, only while Settings → Experimental has it on.
import useStrategy from './useStrategy';
import GatekeeperList, { LeverageBadge, GATE } from './GatekeeperList';
import { TIE_COLOUR } from '../../lib/mutual-web';
import { logExposure, logInteraction, logSearch, track } from '../../lib/learning-client';
import { useSeen } from './useBehaviour';

const ORANGE = '#FF6B35';
const CLASSIC = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
const CANT_NAME = 'a connection we can’t name';
// The fixed Filters (left:16) and Details (right:16) pucks are 36px wide at
// viewport top:140: inside the header band on a desktop, beside the search box
// on a phone. This much side padding keeps 12px clear of them at every width.
const SIDE = 64;
const SIDE_PHONE = 60;
const LABEL_ROW = 28;
const TITLE_ROW = 44;           // the ledger's title bar, on a computer (Blake, 2026-10-02: mock-up 2)
const BOTTOM_PAD = 72;           // clear of the last row's reach, and the corner toggles
const OVERSCAN = 8;
const SCROLL_STEP = 16;          // scroll is published to state in 16px steps, not every pixel
// The results in tier sections (Blake, 2026-10-16: "separating the tiers"): a
// header per tier, then its people as cards, every height fixed (lib/separation.js sectionLayout).
const SECTION_HEAD = 44;
const ROW_DESK = 60;
const ROW_PHONE = 98;
// The ledger's columns, wide (person, way in, how rare, score, actions) and
// narrower (the rarity goes under the way in).
const COLUMNS_WIDE = 'minmax(0,1.2fr) minmax(0,1.35fr) 124px 40px 108px';
const COLUMNS_MID = 'minmax(0,1.1fr) minmax(0,1.3fr) 40px 108px';
const WIDE_AT = 880;             // the list's width from which the rarity has a column of its own

// A colour as words: a light look deepens it toward ink, so gold or cyan reads on
// white (lib/themes.js --sd-tier-ink); a dark look leaves it as it is.
const ink = (c) => `color-mix(in srgb, ${c} 58%, var(--sd-tier-ink, ${c}))`;
// A colour see-through, for any colour, a CSS variable included.
const tint = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

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

/** A route in words: your connection, then anyone between them and the person (past the 2nd degree). */
function routeText(r) {
  const first = r.bridge ? `${r.bridge.name} (${r.bridge.tier})` : CANT_NAME;
  return [first, ...(r.via || []).map((v) => v.name || 'someone')].join(' → ');
}

function everyRoute(p) {
  return p.routes.map(routeText).join('\n');
}

const DEGREE_WORD = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th' };

function subline(person) {
  if (person.role && person.company) return `${person.role} @ ${person.company}`;
  return person.headline || person.role || person.company || '';
}

export default function SeparationView({ connections = [], degree2 = [], degree3 = [], fullDegree1 = connections, fullDegree2 = degree2, showsAt = null, onSelect, userName, selectedId, tierColors = CLASSIC, preset = null, seen = NO_SEEN }) {
  const isMobile = useIsMobile();
  // Room at the top for the notch, only while it's on screen (a scan, or another tab's views).
  const notch = useSyncExternalStore(watchNotchShown, notchShownNow, noNotch);
  const ROW_H = isMobile ? ROW_PHONE : ROW_DESK;
  const K = isMobile ? 5 : 10;
  const sidePad = isMobile ? 8 : 16;

  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  // The slider, 0 (rarest ways in first) to 100 (easiest first); 50 is power alone.
  // The list follows a deferred copy, so the thumb never waits for a sort.
  const [at, setAt] = useState(SLIDER_MIDDLE);
  // The map's zoom: null fits the whole map in the window (Blake, 2026-10-03: "hard
  // to see the whole graph on the single screen ... at least have a plus and minus").
  const [zoom, setZoom] = useState(null);
  const atSlow = useDeferredValue(at);
  // The tier chips: the tiers switched on, as rarity's are; none is every tier.
  // Each tier is a section of the list, so a chip shows or hides a whole section.
  const [tiers, setTiers] = useState(() => new Set());
  // Sections folded away to their header (S, A, …, or 'unranked').
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Rarity beside the tier (lib/rarity.js): any bands switched on; none is everyone.
  const [rarities, setRarities] = useState(() => new Set());
  // Path: one sector or one company, or none. The picker is only on screen while it's open.
  const [path, setPath] = useState(null);            // { kind: 'sector' | 'company', key, label, color }
  const [pathOpen, setPathOpen] = useState(false);
  const [pathText, setPathText] = useState('');
  const [pathUsed, setPathUsed] = useState(false);   // companies are only read once Path is opened
  // Gatekeepers (the strategy engine): your connections by Leverage in place of the ledger.
  const strategy = useStrategy();
  const [gates, setGates] = useState(false);
  const gatesOn = strategy.on && gates;
  const leverageOf = useMemo(() => {
    const people = strategy.people;
    if (!people) return null;
    return (row) => (row ? people[keyFor(row)]?.leverage ?? null : null);
  }, [strategy.people]);
  // Filters a card's Insights asked for ("Show them", "S only"): applied once each.
  const [presetFor, setPresetFor] = useState(null);
  if (preset && preset.id !== presetFor) {
    setPresetFor(preset.id);
    setQuery(preset.query || '');
    setTiers(new Set(TIERS.includes(preset.tier) ? [preset.tier] : []));
    setRarities(new Set(preset.rarity ? [preset.rarity] : []));
    setGates(false);
  }
  const requests = useRequests();
  const scan = useScanner();
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
  // Every row past the 1st degree, so a chain is never cut by a hidden tier; the
  // grid (showsAt) picks who is ranked, at the degree each person is at.
  // Company scans' finds come back unranked: no one on file links you to them.
  // With the mutual web's people seen outside the scan (lib/mutual-web.js), each way in
  // through a tie marked as one (lib/separation.js route.seen).
  const sepRows = useMemo(() => [...(showsAt ? fullDegree2 : degree2), ...seen, ...degree3], [showsAt, fullDegree2, degree2, seen, degree3]);
  const model = useMemo(() => separationPeople(sepRows, connections, { include: showsAt }), [sepRows, connections, showsAt]);
  // How rare the way in to each person is, counted across every circle you've
  // scanned (not only the ones a bridge-tier filter leaves): never a score.
  // Past the 2nd degree it is the routes: LinkedIn shares no mutuals there.
  const waysAll = useMemo(() => routeIndex(seen.length ? [...fullDegree2, ...seen] : fullDegree2), [fullDegree2, seen]);
  const rarityBy = useMemo(() => {
    const m = new Map();
    for (const p of model.people) {
      m.set(p.key, p.degree > 2
        ? rarityOf({ ...p.person, mutual_count: null }, p.waysIn)
        : rarityOf(p.person, waysAll.get(p.key)?.size || p.waysIn));
    }
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
    for (const p of [...model.people, ...model.unranked]) {
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
  const matches = useCallback((p, text) => tierShown(tiers, p.tier)
    && (!rarities.size || rarities.has(rarityBy.get(p.key)?.key))
    && onPath(p)
    && (!text || p.haystack.includes(text)), [tiers, rarities, rarityBy, onPath]);
  const visible = useMemo(() => {
    if (!q && !tiers.size && !rarities.size && !path) return ordered;
    return ordered.filter((p) => matches(p, q));
  }, [ordered, q, tiers, rarities, path, matches]);
  // Under the ranking: who company scans found that no chain reaches. They have
  // no mutual connections on file, so a rarity filter leaves them out.
  const unrankedShown = useMemo(() => (rarities.size ? [] : model.unranked.filter((p) => tierShown(tiers, p.tier)
    && onPath(p) && (!q || p.haystack.includes(q)))), [model, rarities, tiers, onPath, q]);

  // Who you've already asked, or already know. The map is "who to ask next",
  // so it moves on past them: send requests to its ten and the next ten come
  // up. The list still shows everyone, marked. Auto's requests count from the
  // moment they're sent, as the scanner tells it (lib/ask-next.js): sending
  // takes them out and the next-best fills in, queued keeps them (marked), a
  // failed send puts them back.
  const d1Keys = useMemo(() => new Set(fullDegree1.map(keyFor)), [fullDegree1]);
  // Recomputed when a request starts, waits or ends, not on every page a scan reads.
  const autoSig = autoAsksSignature(scan);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const autoBy = useMemo(() => autoAsks(scan, (id) => model.rowToKey.get(id) ?? null), [autoSig, model]);
  const statusOf = useCallback((p) => askStatus({
    connected: d1Keys.has(p.key),
    requested: hasRequest(p.person, requests),
    undone: requests.mine.get(p.key) === false,
    auto: autoBy.get(p.key) ?? null,
  }), [d1Keys, requests, autoBy]);
  // An Auto request ended: read the list again, as the server has marked it,
  // so it holds once the scanner's last few jobs have moved on.
  const lastConnectEnd = (scan.recent || []).find((j) => j?.action === 'connect')?.startedAt ?? null;
  useEffect(() => { if (lastConnectEnd != null) refreshRequests(); }, [lastConnectEnd]);
  // How many the map draws follows the slider: ten, then fewer, then the one you're aiming at.
  const shown = mapCount(atSlow, K);
  const unasked = useMemo(() => topToAsk(visible, statusOf, K + 1), [visible, K, statusOf]);
  const top = useMemo(() => unasked.slice(0, shown), [unasked, shown]);
  const queuedKeys = useMemo(() => new Set(top.filter((p) => statusOf(p) === 'queued').map((p) => p.key)), [top, statusOf]);
  // The learning log (lib/learning-client.js): who the map's top shows, in order, once it settles.
  useEffect(() => { logExposure('separation', top.map((p) => p.person).filter(Boolean), { sort: 'separation' }); }, [top]);
  const askedShown = useMemo(() => visible.reduce((n, p) => n + (leavesTop(statusOf(p)) ? 1 : 0), 0), [visible, statusOf]);
  const selectedKey = selectedId != null ? model.rowToKey.get(selectedId) ?? null : null;
  const selectedGateKey = useMemo(() => {
    if (!gatesOn || selectedId == null) return null;
    const c = fullDegree1.find((r) => r.id === selectedId);
    return c ? keyFor(c) : null;
  }, [gatesOn, selectedId, fullDegree1]);
  // Down to one: the person picked, if they're in what's showing, else the top of the list.
  const single = shown === 1;
  // Down to one, it aims at whoever you share the most mutual connections with,
  // scanned or not (the ones not scanned are grey dots), unless you picked
  // someone; "Next" are the runners-up.
  const aimable = useMemo(() => {
    if (!single) return [];
    return mostMutuals(visible.filter((p) => !leavesTop(statusOf(p))), (p) => rarityBy.get(p.key)?.count || 0, (isMobile ? 3 : 6) + 1);
  }, [single, visible, statusOf, rarityBy, isMobile]);
  const target = useMemo(() => {
    if (!single) return null;
    return (selectedKey && visible.find((p) => p.key === selectedKey)) || aimable[0] || null;
  }, [single, selectedKey, visible, aimable]);
  const nextUp = useMemo(() => (single && target ? aimable.filter((p) => p.key !== target.key).slice(0, isMobile ? 3 : 6) : []),
    [single, target, aimable, isMobile]);

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
  // Wide enough: connections as pills and people as cards (Blake, 2026-10-02); a phone keeps the dots.
  const cards = !isMobile && cw >= 760;
  const layout = useMemo(
    () => (single
      ? convergeLayout(target, cw || 800, isMobile, { cards, mutuals: target ? rarityBy.get(target.key)?.count || 0 : 0 })
      : summitLayout(top, cw || 800, isMobile, { cards })),
    [single, target, top, cw, isMobile, cards, rarityBy],
  );
  const captionH = isMobile ? 58 : 36;   // fixed, so HEAD is arithmetic; the phone legend takes two lines, a computer's is the tooltip and the zoom
  const NEXT_H = nextUp.length ? 38 : 0;
  // Fit: as big as it can be with all of it in the window, never bigger than
  // life. A phone scrolls instead, unless you zoom.
  const fitZoom = isMobile ? 1 : Math.max(ZOOM_MIN, Math.min(1, (box.h - captionH - 22 - (single ? NEXT_H : 0)) / Math.max(1, layout.height)));
  // Dynamic (Blake, 2026-10-03: "it should be dynamic"): what the map shows
  // changes — the slider moves, you aim at someone else — and it fits again,
  // whatever zoom you'd set. A new window size re-fits on its own.
  const viewKey = single ? `aim:${target?.key ?? ''}` : `top:${top.map((t) => t.key).join(',')}`;
  const [zoomFor, setZoomFor] = useState(viewKey);
  if (zoomFor !== viewKey) {
    setZoomFor(viewKey);
    if (zoom != null) setZoom(null);
  }
  const scale = zoom ?? fitZoom;
  const mapH = single ? (target ? Math.round(layout.height * scale) + NEXT_H : 0) : Math.round(layout.height * scale);
  const mapBlockH = mapH ? captionH + mapH + 12 : 0;
  const titleH = isMobile ? 0 : TITLE_ROW;
  const labelH = isMobile ? 6 : LABEL_ROW;
  const HEAD = mapBlockH + titleH + labelH;
  // The list's own width decides its columns: the rarity has one when there's room.
  const wide = !isMobile && cw >= WIDE_AT;

  // ── The list: a section per tier, S to D, then the unranked finds ────────
  // Each keeps the order the list has (power, or the slider's). The chips have
  // already left out the tiers they hide (matches), so a hidden tier has no section.
  const sections = useMemo(() => {
    const out = tierSections(visible, { tiers, collapsed });
    if (unrankedShown.length) {
      out.push({ tier: 'unranked', people: unrankedShown, count: unrankedShown.length, collapsed: collapsed.has('unranked'),
        head: isMobile ? UNRANKED_NOTE_MOBILE : UNRANKED_NOTE_H });
    }
    return out;
  }, [visible, unrankedShown, tiers, collapsed, isMobile]);
  const list = useMemo(() => sectionLayout(sections, { top: HEAD, head: SECTION_HEAD, row: ROW_H, gap: isMobile ? 10 : 14 }),
    [sections, HEAD, ROW_H, isMobile]);
  const total = HEAD + list.height + BOTTOM_PAD;
  // Searching, a rarity or a path: a section then says how many of its tier are showing.
  const narrowed = !!q || rarities.size > 0 || !!path;
  // The learning log: a section folded or shown (React may run this twice; the log keeps one).
  const toggleSection = useCallback((t) => setCollapsed((set) => {
    const next = toggle(set, t);
    track('section', 'toggle', { page: 'separation', section: t, open: !next.has(t) });
    return next;
  }), []);

  // ── Windowing ────────────────────────────────────────────────────────────
  // Derived from the last published scroll position on every render, so a
  // change in the map's height or the row height can never leave it stale.
  // No requestAnimationFrame (TRAPS §17): the scroll event owns it.
  const mounted = itemsBetween(list.items, scrollY - OVERSCAN * ROW_H, scrollY + box.h + OVERSCAN * ROW_H);
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

  const changeQuery = (v) => { setQuery(v); toTop(); logSearch('separation', v); };
  // A tier chip shows or hides its section; All (or every tier picked) is all of them.
  const changeTier = (t) => {
    track('control', 'filter', { what: 'tier', value: t ?? 'all', where: 'separation' });
    setTiers((set) => {
      if (t == null) return new Set();
      const next = toggle(set, t);
      return next.size === TIERS.length ? new Set() : next;
    });
    toTop();
  };
  const changeRarity = (r) => { track('control', 'filter', { what: 'rarity', value: r, where: 'separation' }); setRarities((set) => toggle(set, r)); toTop(); };
  const clearAll = () => { setQuery(''); setTiers(new Set()); setRarities(new Set()); setPath(null); toTop(); };
  const openPath = () => { setPathUsed(true); setPathText(''); setPathOpen(true); };
  // A sector or a company aimed at: its name is a company's or a sector's, never a person's, so it's kept.
  const pickPath = (next) => { track('control', 'filter', { what: next?.kind || 'path', value: next?.label ?? null, where: 'separation' }); setPath(next); setPathOpen(false); toTop(); };
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
  const filtered = !!q || tiers.size > 0 || rarities.size > 0 || !!path;
  const slide = slideLabel(at);
  // The slider's colours as CSS variables, so a light look deepens them (lib/themes.js).
  const slideColor = at < 45 ? RARE_VAR : at > 55 ? EASY_VAR : 'var(--sd-gold, #FFD700)';
  const youLabel = !userName || /^you$/i.test(String(userName).trim()) ? 'You' : initialsFor(userName);

  // Where the slider is, in words (and in full, as its tooltip).
  const pillEl = (
    <span aria-live="polite" title={`${slide.name}. ${slide.detail} It only reorders: scores, tiers and ranks stay as they are.`} style={{
      textTransform: 'none', letterSpacing: 0, flexShrink: 0, height: 26, padding: '0 12px', borderRadius: 15, boxSizing: 'border-box',
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
      border: `1px solid ${tint(slideColor, 40)}`, background: tint(slideColor, 8), color: slideColor,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: slideColor }} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{at}</span>
      {slide.name}
    </span>
  );
  // The search, in the title's row on a computer and under it on a phone.
  const searchBox = (
    <input
      ref={searchRef}
      type="search"
      value={query}
      onChange={(e) => changeQuery(e.target.value)}
      onKeyDown={onSearchKey}
      placeholder="Search people, companies, who knows them"
      aria-label="Search people, companies, or who knows them"
      style={{
        width: isMobile ? '100%' : 340, flexShrink: 0, minWidth: 0, height: isMobile ? 44 : 32, boxSizing: 'border-box',
        padding: '0 12px', borderRadius: 8, outline: 'none', color: 'var(--sd-fg-1, #fff)',
        fontSize: isMobile ? 16 : 13,        // under 16px, iOS zooms the page on focus
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)',
      }}
    />
  );
  const chipH = isMobile ? 32 : 28;
  // "Only show": the rarity chips, beside the tiers on a computer, on a row of their own on a phone.
  // One group, so a line that wraps never leaves its label behind.
  const rarityChips = (
    <span role="group" aria-label="Only show, by how rare the way in is" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span title={RARITY_NOTE} style={GROUP_LABEL}>Only show</span>
      {RARITY.map((r) => {
        const on = rarities.has(r.key);
        return (
          <button key={r.key} type="button" aria-pressed={on} onClick={() => changeRarity(r.key)}
            title={`${r.label}: ${r.range} mutual connection${r.range === '1' ? '' : 's'}. ${RARITY_NOTE}`}
            style={chipStyle(on, r.color, chipH)}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
            {r.label}
            <span style={COUNT}>{fmt(byRarity[r.key])}</span>
          </button>
        );
      })}
    </span>
  );

  return (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', overflow: 'hidden',
    }}>
      <style>{LIST_CSS}</style>
      {/* ── Top: the search box, and on a phone what it ranks ── */}
      <div style={{ padding: `${notch ? 48 : 14}px ${isMobile ? SIDE_PHONE : SIDE}px 8px`, flexShrink: 0 }}>
        {/* Blake, 2026-10-03: no title, count line or tier strip up here ("remove this
            line of text … and the actual line of visual of the tiers"); the map and the
            slider say it. The search box keeps the row. */}
        {!isMobile && <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{searchBox}</div>}
        {/* On a phone: what it ranks, then the search, between the two pucks. */}
        {isMobile && (
          <div style={{ fontSize: 11, color: 'var(--sd-fg-4, #777)', lineHeight: 1.4, marginBottom: 6, textWrap: 'balance' }}>Ranks reachability, not people · lists scanned so far</div>
        )}
        {isMobile && searchBox}
        {summary.peopleOnlyUnresolved > 0 && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5, color: 'var(--sd-fg-2, #e8d9a0)',
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)',
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

      {/* ── Controls: their tier, path and rarity, then the slider ── */}
      {/* A phone's controls sit under the pucks, so they can use the width; nothing in them scrolls sideways. */}
      <div style={{ padding: `0 ${isMobile ? 10 : SIDE}px 10px`, flexShrink: 0, borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.06)' }}>
        <style>{SLIDER_CSS}</style>
        <div style={{
          marginTop: isMobile ? 4 : 2, padding: isMobile ? '10px 10px 8px' : '8px 14px', borderRadius: 12, position: 'relative',
          border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.025)',
        }}>
          {pathOpen && (
            <PathPicker facets={facets} text={pathText} onText={setPathText} isMobile={isMobile}
              onPick={pickPath} onClose={() => setPathOpen(false)} />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
            <span title={TIER_NOTE} style={GROUP_LABEL}>Their tier</span>
            <button type="button" aria-pressed={!tiers.size} onClick={() => changeTier(null)}
              title="Every tier, each in a section of its own" style={chipStyle(!tiers.size, 'var(--sd-fg-1, #fff)', chipH)}>
              All<span style={COUNT}>{fmt(summary.people)}</span>
            </button>
            {TIERS.map((t) => {
              const on = tiers.has(t);
              const c = tierColors[t] || '#888';
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => changeTier(t)}
                  aria-label={`${t} tier, ${fmt(summary.byTier[t])} people`}
                  title={`${t} tier: ${tierLabel(t)}. Shows or hides the ${t} section; pick more than one to see them together.`}
                  style={chipStyle(on, c, chipH)}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  {t}
                  <span style={COUNT}>{fmt(summary.byTier[t])}</span>
                </button>
              );
            })}
            {/* Path: one sector or one company. The picker opens under here and goes away once you pick. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, minWidth: 0, maxWidth: '100%', height: chipH, borderRadius: 14, overflow: 'hidden',
              border: `1px solid ${path ? 'rgba(var(--sd-ink, 255, 255, 255), 0.45)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`,
              background: path ? 'rgba(var(--sd-ink, 255, 255, 255), 0.1)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)' }}>
              <button type="button" aria-haspopup="dialog" aria-expanded={pathOpen} onClick={() => (pathOpen ? setPathOpen(false) : openPath())}
                title="Narrow everyone to one sector or one company" style={{
                  height: '100%', padding: path ? '0 6px 0 12px' : '0 12px', border: 'none', background: 'none', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                  fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--sd-fg-1, #fff)', maxWidth: isMobile ? 220 : 300, overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                {path?.color && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: path.color, flexShrink: 0 }} />}
                {path ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Path<span style={{ fontWeight: 500, color: 'var(--sd-fg-2, #cfe)' }}> · {path.label}</span></span> : 'Path ▾'}
              </button>
              {path && (
                <button type="button" aria-label={`Clear the path: ${path.label}`} onClick={() => pickPath(null)} style={{
                  height: '100%', padding: '0 10px 0 4px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--sd-fg-2, #ccc)',
                }}>×</button>
              )}
            </span>
            {strategy.on && (
              <button type="button" aria-pressed={gates} onClick={() => { setGates((g) => !g); toTop(); }}
                title="Experimental: your connections ranked by where they stand in your network (who you reach only through them), not by power"
                style={chipStyle(gates, GATE, chipH)}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 2, background: GATE, flexShrink: 0 }} />
                Gatekeepers{gates ? ' ✓' : ''}
              </button>
            )}
            {!isMobile && <span style={{ marginLeft: 8, minWidth: 0 }}>{rarityChips}</span>}
          </div>
          {/* On a phone the rarity chips have a row of their own, wrapping, never sideways */}
          {isMobile && (
            <div style={{ marginTop: 8, minWidth: 0 }}>{rarityChips}</div>
          )}

          {/* The slider: the rarest ways in at one end, the easiest at the other, power alone in the middle */}
          {/* The pill saying where the slider is sits over its middle, in place of "Power" */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            <span style={{ color: RARE_VAR, flex: 1, minWidth: 0 }}>Rare{isMobile ? '' : ' · one way in'}</span>
            {pillEl}
            <span style={{ color: EASY_VAR, flex: 1, minWidth: 0, textAlign: 'right' }}>Easy{isMobile ? '' : ' · many mutual connections'}</span>
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
                color: at === v ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-4, #667)', fontWeight: at === v ? 700 : 500, fontVariantNumeric: 'tabular-nums',
              }}>{v}{name && !isMobile ? ` · ${name}` : ''}</button>
            ))}
          </div>
          {/* On a phone, once the order has moved off power: the sentence, as there's no tooltip to hover */}
          {isMobile && at !== SLIDER_MIDDLE && (
            <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: 1.45, color: 'var(--sd-fg-2, #bbb)' }}>
              <span style={{ color: slideColor, fontWeight: 700 }}>{slide.name}.</span>{' '}{slide.detail}
            </div>
          )}
        </div>
      </div>

      {/* ── One scroll: the summit map, then every person ── */}
      <div
        ref={attachScroll}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', padding: `0 ${sidePad}px` }}
      >
        {gatesOn ? (
          // Every connection of yours, whatever their tier: the tier chips pick the people to connect with, never the ways in.
          <GatekeeperList connections={fullDegree1} strategy={strategy} tierColors={tierColors} isMobile={isMobile}
            onSelect={onSelect} selectedKey={selectedGateKey} q={q} />
        ) : (
        <div style={{ position: 'relative', maxWidth: 980, margin: '0 auto', height: total }}>
          {mapBlockH > 0 && (
            <div className="sepblock" style={{ height: mapBlockH, boxSizing: 'border-box', paddingTop: 10 }}>
              <div style={{ height: captionH - 10, overflow: 'hidden', display: isMobile ? 'block' : 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div title={isMobile ? undefined : `${!single && askedShown > 0 ? `${fmt(askedShown)} asked or connected, so it moved on. ` : ''}Solid orange: the top-scored bridge. Dashed: other routes.${single ? ' Pick anyone in the list to aim at them instead.' : cards ? ' A lit pill is someone’s best way in.' : ' Dot size: ways in.'}`}
                  style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: 'var(--sd-fg-1, #ddd)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {single
                    ? <>Aiming at {target.person.name} · {layout.unscanned
                      ? `${fmt(target.waysIn + layout.unscanned)} mutual connections: ${fmt(target.waysIn)} drawn, ${fmt(layout.unscanned)} in circles not scanned yet`
                      : target.waysIn === 1 ? 'the one connection of yours who leads to them' : `all ${fmt(target.waysIn)} connections of yours who lead to them`}</>
                    : <>Top {fmt(top.length)} you haven’t asked, of {fmt(visible.length)}{filtered ? ' shown' : ''}{at !== SLIDER_MIDDLE ? ` · ${slide.name.toLowerCase()}` : ''} · every way in drawn</>}
                </div>
                {!isMobile && <ZoomControl scale={scale} fitted={zoom == null}
                  onOut={() => setZoom(Math.max(ZOOM_MIN, Math.round((scale - 0.1) * 10) / 10))}
                  onFit={() => setZoom(null)}
                  onIn={() => setZoom(Math.min(ZOOM_MAX, Math.round((scale + 0.1) * 10) / 10))} />}
                {isMobile && <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #777)', marginTop: 2, whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.35 }}>
                  {!single && askedShown > 0 && <span style={{ color: 'var(--sd-gold, #FFD700)' }}>{fmt(askedShown)} asked or connected, so it moved on · </span>}
                  <span style={{ color: 'var(--sd-orange, #FF6B35)' }}>solid orange</span> = top-scored bridge · dashed = other routes
                  {single ? ' · pick anyone in the list to aim at them instead' : cards ? ' · a lit pill is someone’s best way in' : ' · dot size = ways in'}
                </div>}
              </div>
              {cw > 0 && (
                <SummitMap
                  layout={layout}
                  scale={scale}
                  selectedKey={selectedKey}
                  tierColors={tierColors}
                  youLabel={youLabel}
                  isMobile={isMobile}
                  onPick={onPick}
                  onPickBridge={onPickBridge}
                  mutualsBy={rarityBy}
                  queuedKeys={queuedKeys}
                  doors={!isMobile && cw >= 640}
                  cards={cards}
                />
              )}
              {/* Aiming at one person: the next few, to aim at instead */}
              {cw > 0 && single && (
                <>
                  {nextUp.length > 0 && (
                    <div style={{ height: NEXT_H, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                      <span style={{ fontSize: 10, color: 'var(--sd-fg-4, #666)', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Next</span>
                      {nextUp.map((p) => (
                        <button key={p.key} type="button" onClick={() => onPick(p)} title={`Aim at ${p.person.name}`} style={{
                          height: 26, padding: '0 10px', borderRadius: 13, cursor: 'pointer', flexShrink: 1, minWidth: 0,
                          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          border: `1px solid ${(tierColors[p.tier] || '#888')}55`, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', color: 'var(--sd-fg-2, #ccc)',
                        }}>
                          {shortName(p.person.name)}
                          <span style={{ marginLeft: 5, color: tierColors[p.tier] || '#888', fontWeight: 700 }}>{p.score.toFixed(1)}</span>
                          {/* The count they're ordered by: every mutual, scanned or not */}
                          <span style={{ marginLeft: 5, color: 'var(--sd-fg-4, #667)', fontWeight: 500 }}>
                            {(() => { const n = Math.max(rarityBy.get(p.key)?.count || 0, p.waysIn); return n === 1 ? '1 mutual' : `${fmt(n)} mutuals`; })()}
                          </span>
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
              height: TITLE_ROW, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 14px', boxSizing: 'border-box',
              borderTop: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.06)',
            }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>Ranked by reach</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--sd-fg-1, #fff)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.12)', borderRadius: 10, padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(visible.length)}{filtered ? ` of ${fmt(summary.people)}` : ''}
              </span>
              <span style={{ fontSize: 11, color: 'var(--sd-fg-4, #777)' }}>in tiers, S to D</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sd-fg-4, #777)' }}>
                order in each tier follows the slider · <span style={{ color: slideColor, fontWeight: 700 }}>{slide.name.toLowerCase()}</span>
              </span>
            </div>
          )}
          {visible.length > 0 && !isMobile && (
            <div aria-hidden="true" style={{
              height: LABEL_ROW, display: 'grid', alignItems: 'center', columnGap: 12, padding: '0 12px 0 15px',
              gridTemplateColumns: wide ? COLUMNS_WIDE : COLUMNS_MID,
              fontSize: 9.5, fontWeight: 700, color: 'var(--sd-fg-4, #666)', textTransform: 'uppercase', letterSpacing: 0.5, boxSizing: 'border-box',
            }}>
              <span style={{ ...ellipsis, paddingLeft: 2 }}>Rank · person</span>
              <span style={ellipsis}>Way in: you → your connection → them</span>
              {wide && <span style={ellipsis} title={RARITY_NOTE}>How rare</span>}
              <span style={{ ...ellipsis, textAlign: 'right' }}>Score</span>
              <span />
            </div>
          )}

          {mounted.map((it) => (it.kind === 'head'
            ? (
              <SectionHead
                key={it.key}
                section={it.section}
                top={it.top}
                height={it.height}
                tierColors={tierColors}
                of={narrowed && it.tier !== 'unranked' ? summary.byTier[it.tier] : null}
                isMobile={isMobile}
                onToggle={toggleSection}
              />
            ) : (
              <Row
                key={it.key}
                p={it.p}
                top={it.top}
                height={it.height}
                layout={isMobile ? 'phone' : wide ? 'wide' : 'mid'}
                selected={it.p.key === selectedKey}
                tierColors={tierColors}
                onPick={onPick}
                q={q}
                status={statusOf(it.p)}
                rarity={it.p.unranked ? null : rarityBy.get(it.p.key)}
                leverageOf={it.p.unranked ? null : leverageOf}
              />
            )))}

          {visible.length === 0 && unrankedShown.length === 0 && (
            <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', color: 'var(--sd-fg-3, #888)', fontSize: 13, padding: '0 16px' }}>
              {q
                ? <>No one matches ‘{query.trim()}’. Search covers names, headlines, companies and who knows them.</>
                : <>No one here with those filters.</>}
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={clearAll} style={{
                  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.15)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-1, #fff)',
                }}>Clear</button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

// ── Zoom ───────────────────────────────────────────────────────────────────
// Low enough that even aiming at someone with dozens of ways in fits the window
// whole: the layout stays as it is, only smaller (Blake, 2026-10-03: "it should
// just be more zoomed out").
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 1.5;

/** − | Fit | +, one segmented control as a Mac draws one. The middle says the zoom once you've changed it. */
function ZoomControl({ scale, fitted, onOut, onFit, onIn }) {
  const seg = (extra = {}) => ({
    height: 22, minWidth: 26, padding: '0 7px', border: 'none', background: 'none', color: 'var(--sd-fg-2, #c9cdd6)',
    fontSize: 12, fontWeight: 600, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    ...extra,
  });
  const line = { width: 1, alignSelf: 'stretch', margin: '4px 0', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.14)' };
  return (
    <div role="group" aria-label="Zoom the map" style={{
      display: 'inline-flex', alignItems: 'center', flexShrink: 0, borderRadius: 7, overflow: 'hidden',
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.13)',
      boxShadow: '0 1px 0 rgba(var(--sd-ink, 255, 255, 255), 0.05) inset, 0 1px 2px rgba(0,0,0,0.35)',
    }}>
      <button type="button" onClick={onOut} disabled={scale <= ZOOM_MIN + 0.001} title="Zoom out" aria-label="Zoom out"
        style={seg({ fontSize: 15, opacity: scale <= ZOOM_MIN + 0.001 ? 0.35 : 1 })}>−</button>
      <span style={line} />
      <button type="button" onClick={onFit} title={fitted ? 'The whole map fits the window' : 'Fit the whole map in the window'}
        style={seg({ minWidth: 44, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: fitted ? 'var(--sd-fg-3, #8f96a3)' : 'var(--sd-fg-1, #e6e9ef)' })}>
        {fitted ? 'Fit' : `${Math.round(scale * 100)}%`}
      </button>
      <span style={line} />
      <button type="button" onClick={onIn} disabled={scale >= ZOOM_MAX - 0.001} title="Zoom in" aria-label="Zoom in"
        style={seg({ fontSize: 15, opacity: scale >= ZOOM_MAX - 0.001 ? 0.35 : 1 })}>+</button>
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
/* The zoom glides too, and the list under the map with it. */
.sepmap { transition: width ${MOVE}, height ${MOVE}; }
.sepblock { transition: height ${MOVE}; }
.seprow { transition: top ${MOVE}; }
@keyframes sepIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .sepmap .mv, .sepmap .rt, .sepmap .spk, .sepmap, .sepblock, .seprow { transition: none; }
  .sepmap .in { animation: none; }
}
`;
const HALO = { paintOrder: 'stroke', stroke: 'var(--sd-bg)', strokeWidth: 3, strokeLinejoin: 'round' };
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

const SummitMap = memo(function SummitMap({ layout, scale = 1, selectedKey, tierColors, youLabel, isMobile, onPick, onPickBridge, mutualsBy, queuedKeys = null, doors = false, cards = false }) {
  const { width, height, you, people, bridges, links, spokes, ghosts = [], unscanned = 0, ghostLabel = null, drawn = 1 } = layout;
  const linksBy = useMemo(() => {
    const m = new Map();
    for (const l of links) { if (!m.has(l.key)) m.set(l.key, []); m.get(l.key).push(l); }
    return m;
  }, [links]);
  const gap = isMobile ? 36 : 26;
  const fs = isMobile ? 12 : 11;

  return (
    // Drawn at its own size and scaled whole by the viewBox, so zooming never
    // lays it out again and everything stays sharp.
    <svg className="sepmap" width={Math.round(width * scale)} height={Math.round(height * scale)} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', margin: '0 auto', width: Math.round(width * scale), height: Math.round(height * scale) }}>
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
        <path key={`s-${s.id ?? 'unresolved'}`} className="spk in" d={`M${s.x1},${s.y1} L${cards ? s.x2 - PILL_W : s.x2},${s.y2}`} fill="none" style={{ stroke: 'rgb(var(--sd-ink, 255, 255, 255))' }} strokeOpacity={0.14} strokeWidth={1} />
      ))}

      {/* Not as bright when most of the way in is still unscanned: the glow follows the share drawn. */}
      {cards && people.length === 1 && people[0].big && (
        <circle className="mv" style={{ ...at(people[0].x + Math.min(200, (width - people[0].x) / 2), people[0].y), opacity: 0.3 + 0.7 * drawn }} r={170} fill="url(#sepAimHalo)" />
      )}

      {/* Mutual connections in circles you haven't scanned: grey, each with a faint line in. */}
      {people.length === 1 && people[0].big && ghosts.length > 0 && (
        <g className="in" pointerEvents="none">
          {ghosts.map((g, i) => {
            const t = people[0];
            const x2 = cards ? t.x : t.x - t.r - 2;
            const mx = (g.x + x2) / 2;
            return <path key={`gl-${i}`} d={`M${g.x},${g.y} C${mx},${g.y} ${mx},${t.y} ${x2},${t.y}`} fill="none" stroke="#8a8fa8" strokeOpacity={0.09} strokeWidth={0.8} />;
          })}
          {ghosts.map((g, i) => <circle key={`gd-${i}`} cx={g.x} cy={g.y} r={3.3} fill="#4a4f68" stroke="#6b7090" strokeWidth={0.6} strokeOpacity={0.6} />)}
          {ghostLabel && (
            <text x={ghostLabel.x} y={ghostLabel.y} fontSize={10.5} fontWeight={700} fill="var(--sd-fg-3, #8a8fa8)" style={HALO}>
              {`+${fmt(unscanned)} more mutual${unscanned === 1 ? '' : 's'}, in circles not scanned yet`}
              {unscanned > ghosts.length ? ` (${fmt(ghosts.length)} shown)` : ''}
            </text>
          )}
        </g>
      )}
      <g className="ppl">
        {people.map((pp) => {
          const { p } = pp;
          const c = tierColors[p.tier] || '#888';
          const sel = pp.key === selectedKey;
          const via = p.routes.map((r) => `${r.bridge ? r.bridge.name : CANT_NAME}${viaTail(r)}`).join(', ');
          const tag = waysTag(p, mutualsBy?.get(p.key));
          const queued = Boolean(queuedKeys?.has(pp.key));
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
              {/* Past the 2nd degree: each person between your connection and them, a stop on the line */}
              {(linksBy.get(pp.key) || []).filter((l) => l.stops?.length).map((l) => {
                const stroke = l.unresolved ? '#777' : l.primary ? ORANGE : pp.big ? '#FFD700' : tierColors[l.tier] || '#888';
                return (
                  <g key={`v-${l.bridgeId ?? 'u'}`} className="in" pointerEvents="none">
                    {l.stops.map((s, i) => (
                      <g key={i} className="mv" style={at(s.x, s.y)}>
                        <circle r={pp.big ? 4.5 : 3.5} fill="var(--sd-bg)" stroke={stroke} strokeWidth={1.5} />
                        {(pp.big || l.primary) && (
                          <text y={-7} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--sd-fg-2, #ccd)" style={HALO}>{shortName(s.name)}</text>
                        )}
                      </g>
                    ))}
                  </g>
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
                  <SmallCard p={p} c={c} tag={tag} width={Math.max(240, Math.min(340, width - pp.x - 4))} sel={sel} queued={queued} />
                ) : pp.big ? (
                  <>
                    <circle r={pp.r} fill="var(--sd-bg)" stroke={c} strokeWidth={3} strokeOpacity={0.35 + 0.65 * drawn} />
                    <text dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={800} style={{ fill: ink(c) }}>{initialsFor(p.person.name)}</text>
                    <text x={lx} y={-20} fontSize={fs + 3} fontWeight={800} fill="var(--sd-fg-1, #fff)" style={HALO}>{clip(p.person.name)}</text>
                    <text x={lx} y={-4} fontSize={fs} fill="var(--sd-fg-3, #aaa)" style={HALO}>{clip(subline(p.person))}</text>
                    <text x={lx} y={13} fontSize={fs} fontWeight={700} style={{ ...HALO, fill: ink(c) }}>
                      #{p.rank}{p.tied ? '=' : ''} · {p.tier}-tier · {p.score.toFixed(1)}
                    </text>
                    <text x={lx} y={29} fontSize={fs} fill="var(--sd-fg-2, #ccc)" style={HALO}>
                      {clip(tag.more
                        ? `${fmt(tag.more)} mutual connections · ${fmt(p.waysIn)} drawn here`
                        : p.waysIn === 1 ? '1 mutual connection: the only way in' : `${fmt(p.waysIn)} mutual connections, all drawn`)}
                    </text>
                    {tag.more > 0 && (
                      <text x={lx} y={44} fontSize={fs - 1} fill="#778" style={HALO}>
                        {clip('The count is the platform’s; the rest are in circles not scanned yet')}
                      </text>
                    )}
                  </>
                ) : (
                  <>
                    {sel && <circle r={pp.r + 3.5} fill="none" stroke="#fff" strokeWidth={1.5} />}
                    <circle className="sd-dot" r={pp.r} fill={c} />
                    <text x={14} dy="0.35em" fontSize={fs} fill="var(--sd-fg-1, #ddd)" style={HALO}>
                      {pp.label}
                      <tspan dx={6} style={{ fill: ink(c) }} fontWeight={700}>{p.score.toFixed(1)}</tspan>
                      {queued && <tspan dx={6} fontSize={fs - 2} fontWeight={800} fill="var(--sd-gold, #FFD700)">Queued</tspan>}
                      {/* How many mutual connections lead to them: one is the rare kind */}
                      {doors && (
                        <tspan dx={8} fontSize={fs - 2} fontWeight={700} fill={tag.rare ? 'var(--sd-cyan, #00E5FF)' : 'var(--sd-fg-4, #778)'}>{tag.text}</tspan>
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
              <circle className="sd-dot"
                r={b.r}
                fill={b.unresolved ? 'none' : c}
                stroke={b.unresolved ? 'var(--sd-fg-4, #777)' : 'var(--sd-bg)'}
                strokeWidth={b.unresolved ? 1 : 1.5}
                strokeDasharray={b.unresolved ? '2 2' : undefined}
              />
              <text x={-9} dy="0.35em" textAnchor="end" fontSize={fs - 1}
                fontStyle={b.unresolved ? 'italic' : undefined} fontWeight={b.unresolved ? 400 : b.primary ? 800 : 600} style={{ ...HALO, fill: ink(c) }}>
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

// ── Cards (Blake, 2026-10-02: mock-ups 1 and 1b) ───────────────────────────
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
        <rect x={-PILL_W} y={-14} width={PILL_W} height={28} rx={14} fill="var(--sd-card, #11132a)" stroke="#555" strokeDasharray="3 3" />
        <text x={-PILL_W + 14} dy="0.35em" fontSize={11.5} fontStyle="italic" fill="var(--sd-fg-3, #888)">{clipText(b.label, 30)}</text>
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
      <rect x={-PILL_W} y={-14} width={PILL_W} height={28} rx={14} fill="var(--sd-card, #14172e)"
        stroke={hot ? 'rgba(255,107,53,0.7)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.12)'} strokeWidth={hot ? 1.3 : 1} />
      <circle className="sd-dot" cx={-PILL_W + 15} r={10} fill={c} />
      <text x={-PILL_W + 15} dy="0.35em" textAnchor="middle" fontSize={8} fontWeight={800} fill="#000">{initialsFor(b.bridge.name)}</text>
      <text x={-PILL_W + 31} dy="0.35em" fontSize={12} fontWeight={600} fill="var(--sd-fg-1, #e8e8f0)">
        {clipText(b.bridge.name, Math.max(6, Math.floor((PILL_W - 31 - tw - 10) / 6.4)))}
      </text>
      <rect x={-tw - 7} y={-9} width={tw} height={18} rx={9} fill={`${c}22`} />
      <text x={-7 - tw / 2} dy="0.35em" textAnchor="middle" fontSize={9.5} fontWeight={800} style={{ fill: ink(c) }}>{tag}</text>
    </g>
  );
}

/** Someone on the map: rank, name, role, score, and how many ways in. */
function SmallCard({ p, c, tag, width, sel, queued = false }) {
  const tw = chipW(tag.text);
  return (
    <g>
      <rect x={0} y={-20} width={width} height={40} rx={10} fill="var(--sd-card, #151830)" stroke={sel ? 'var(--sd-fg-1, #fff)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.09)'} strokeWidth={sel ? 1.5 : 1} />
      <text x={12} dy="0.35em" fontSize={11} fontWeight={800} fill="var(--sd-fg-3, #8a8fa8)">#{p.rank}{p.tied ? '=' : ''}</text>
      <text x={60} y={-3} fontSize={13} fontWeight={700} fill="var(--sd-fg-1, #fff)">{clipText(p.person.name, Math.floor((width - 60 - (queued ? 120 : 70)) / 7))}</text>
      {/* Auto's request waits in the scan queue: still here, until it's sent */}
      {queued && <text data-queued x={width - 52} y={-2} textAnchor="end" fontSize={9.5} fontWeight={800} fill="var(--sd-gold, #FFD700)">Queued</text>}
      <text x={60} y={12} fontSize={10.5} fill="var(--sd-fg-3, #8a8fa8)">{clipText(subline(p.person), Math.floor((width - 60 - tw - 20) / 5.6))}</text>
      <text x={width - 12} y={-2} textAnchor="end" fontSize={14} fontWeight={800} style={{ fill: ink(c) }}>{p.score.toFixed(1)}</text>
      <rect x={width - 12 - tw} y={4} width={tw} height={14} rx={7}
        fill={tag.rare ? 'rgba(0,229,255,0.1)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.06)'} stroke={tag.rare ? 'rgba(0,229,255,0.35)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.14)'} />
      <text x={width - 12 - tw / 2} y={11} dy="0.35em" textAnchor="middle" fontSize={9.5} fontWeight={800} fill={tag.rare ? 'var(--sd-cyan, #00E5FF)' : 'var(--sd-fg-2, #cfd3e6)'}>{tag.text}</text>
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
      <rect x={0} y={-76} width={width} height={152} rx={16} fill="var(--sd-card, #151830)" stroke="rgba(255,215,0,0.45)" />
      <circle cx={48} r={32} fill="var(--sd-bg)" stroke={c} strokeWidth={3} />
      <text x={48} dy="0.35em" textAnchor="middle" fontSize={18} fontWeight={800} style={{ fill: ink(c) }}>{initialsFor(p.person.name)}</text>
      <text x={tx} y={-40} fontSize={11} fontWeight={800} fill="var(--sd-gold, #FFD700)">#{p.rank}{p.tied ? '=' : ''} · {p.tier}-tier · {p.score.toFixed(1)}</text>
      <text x={tx} y={-17} fontSize={fs + 8} fontWeight={800} fill="var(--sd-fg-1, #fff)">{clipText(p.person.name, Math.floor(room * 0.72))}</text>
      <text x={tx} y={1} fontSize={12} fill="var(--sd-fg-3, #8a8fa8)">{clipText(subline(p.person), room)}</text>
      <rect x={tx} y={12} width={w1} height={20} rx={10} fill="rgba(255,112,67,0.12)" stroke="rgba(255,112,67,0.4)" />
      <text x={tx + w1 / 2} y={22} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={800} fill={EASY_VAR}>{first}</text>
      <rect x={tx + w1 + 6} y={12} width={w2} height={20} rx={10} fill="rgba(var(--sd-ink, 255, 255, 255), 0.06)" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.14)" />
      <text x={tx + w1 + 6 + w2 / 2} y={22} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={800} fill="var(--sd-fg-2, #cfd3e6)">{second}</text>
      <text x={tx} y={50} fontSize={10.5} fill="#6b7090">
        {tag.more ? `The ${fmt(tag.more)} is the platform’s count. The other ${fmt(tag.more - p.waysIn)}` : named === 1 ? 'Only one of your connections knows them.' : `${fmt(named)} of your connections know them.`}
      </text>
      {tag.more > 0 && (
        <text x={tx} y={64} fontSize={10.5} fill="#6b7090">
          {clipText('are in circles not scanned yet: the grey dots.', Math.floor((width - tx - 14) / 5.4))}
        </text>
      )}
    </g>
  );
}

// ── The list: a section per tier, then a card per person ───────────────────

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
// The unranked section's header: its title and note (a phone's note takes more lines).
const UNRANKED_NOTE_H = 88;
const UNRANKED_NOTE_MOBILE = 118;
// Read by a screen reader, never seen: who a Connect or View profile is for.
const SR_ONLY = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** Who's between your connection and them, past the 2nd degree: " → Ana → Ben". */
const viaTail = (route) => (route?.via || []).map((v) => ` → ${v.name || 'someone'}`).join('');

/** "S · Highest leverage" → "Highest leverage". */
const tierLabel = (t) => String(TIER_LABELS[t] || `${t} tier`).replace(/^[A-Z]\s*·\s*/, '');

/** The scores a section spans, highest first: "9.5 to 9.0", or one score. */
function scoreRange(people) {
  let hi = -Infinity;
  let lo = Infinity;
  for (const p of people) { hi = Math.max(hi, p.score); lo = Math.min(lo, p.score); }
  if (!Number.isFinite(hi)) return '';
  return hi === lo ? hi.toFixed(1) : `${hi.toFixed(1)} to ${lo.toFixed(1)}`;
}

/** A tier's header: its colour and letter, its name, how many, and the fold. */
const SectionHead = memo(function SectionHead({ section, top, height, tierColors, of = null, isMobile, onToggle }) {
  const unranked = section.tier === 'unranked';
  const c = unranked ? '#8a8fa8' : tierColors[section.tier] || '#888';
  const open = !section.collapsed;
  const name = unranked ? '3rd degree · not ranked' : `${section.tier} tier`;
  const sub = unranked ? 'found by company scans' : tierLabel(section.tier);
  const count = `${fmt(section.count)}${of != null && of !== section.count ? ` of ${fmt(of)}` : ''}`;
  const people = section.count === 1 && of == null ? 'person' : 'people';
  // The learning log: this tier's section on screen for a second, once a visit.
  const seenRef = useRef(null);
  useSeen(seenRef, 'separation', section.tier);
  return (
    <div ref={seenRef} className="sephead seprow" role="heading" aria-level={3} style={{
      position: 'absolute', top, left: 0, right: 0, height, boxSizing: 'border-box', overflow: 'hidden',
      borderRadius: open ? '10px 10px 0 0' : 10, borderLeft: `3px solid ${c}`,
      background: tint(c, 10), borderBottom: open ? `1px solid ${tint(c, 30)}` : '1px solid transparent',
    }}>
      <button type="button" aria-expanded={open} onClick={() => onToggle(section.tier)}
        aria-label={`${name}, ${sub}: ${count} ${people}. ${open ? 'Fold this section away' : 'Show this section'}`}
        title={open ? 'Fold this section away' : 'Show this section'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', width: '100%', height: SECTION_HEAD, padding: '0 12px 0 10px', margin: 0,
          display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, color: 'var(--sd-fg-1, #fff)', font: 'inherit', textAlign: 'left', boxSizing: 'border-box',
        }}>
        <svg aria-hidden="true" className="sepchev" width="12" height="12" viewBox="0 0 12 12" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unranked
          ? <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, border: '1.5px dashed var(--sd-fg-4, #777)', flexShrink: 0, boxSizing: 'border-box' }} />
          : (
            <span aria-hidden="true" style={{
              width: 24, height: 24, borderRadius: 7, background: c, color: '#000', fontSize: 13, fontWeight: 800, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{section.tier}</span>
          )}
        <span style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</span>
        <span style={{ ...ellipsis, fontSize: 12, color: 'var(--sd-fg-3, #99a)', minWidth: 0, flexShrink: 1 }}>{sub}</span>
        <span style={{
          fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 10, flexShrink: 0, whiteSpace: 'nowrap',
          background: tint(c, 24), color: 'var(--sd-fg-1, #fff)', fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
        {!unranked && !isMobile && (
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: 'var(--sd-fg-4, #777)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            score {scoreRange(section.people)}
          </span>
        )}
      </button>
      {unranked && (
        <div style={{ padding: isMobile ? '0 12px 0 14px' : '0 16px 0 46px', fontSize: isMobile ? 10.5 : 11.5, lineHeight: 1.45, color: 'var(--sd-fg-3, #99a)' }}>
          Found by company scans. No circle you&rsquo;ve scanned leads to them, so there&rsquo;s no one on file to
          introduce you and no route to rank. Scored the same way; they join the ranking once a scanned circle has them.
        </div>
      )}
    </div>
  );
});

/** No route on file: who found them, instead of a way in. */
function NoRoute({ p, compact }) {
  const where = p.foundBy?.length ? `a company scan of ${p.foundBy.slice(0, 2).join(', ')}${p.foundBy.length > 2 ? ` +${p.foundBy.length - 2}` : ''}` : 'a company scan';
  return (
    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }} title={`No one on file links you to them: found by ${where}.`}>
      <span style={{ ...ellipsis, fontSize: compact ? 11.5 : 12.5, fontWeight: 600, color: 'var(--sd-fg-3, #889)', fontStyle: 'italic' }}>
        no route on file
      </span>
      {!compact && <span style={{ ...ellipsis, fontSize: 10.5, marginTop: 1, color: 'var(--sd-fg-4, #777)' }}>found by {where}</span>}
    </span>
  );
}

const ARROW = { flexShrink: 0, fontSize: 11, color: 'var(--sd-fg-4, #667)' };
const NO_SEEN = Object.freeze([]);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';

/**
 * The way in, read left to right: You → your connection → them. The
 * connection is a chip in their own tier's colour, whatever tier the chips
 * show (bridges are never filtered); anyone between, past the 2nd degree,
 * sits on the line; "+2" is how many other ways in, all of them on hover.
 */
function PathLine({ p, route, tierColors, compact = false }) {
  if (p.unranked) return <NoRoute p={p} compact={compact} />;
  const b = route?.bridge;
  const c = b ? tierColors[b.tier] || '#888' : null;
  const extra = p.waysIn - 1;
  const via = route?.via || [];
  const between = via.length ? (compact && via.length > 1 ? `${via.length} between` : via.map((v) => shortName(v.name) || 'someone').join(' → ')) : '';
  const them = p.person.name === 'LinkedIn Member' ? 'them' : firstName(p.person.name);
  return (
    <span title={`Every way in:\n${everyRoute(p)}`} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 12 }}>
      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-3, #99a)' }}>You</span>
      <span aria-hidden="true" style={ARROW}>→</span>
      {b ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, flexShrink: 1, height: 22, padding: '0 8px 0 3px', boxSizing: 'border-box',
          borderRadius: 11, border: `1px solid ${tint(c, 55)}`, background: tint(c, 14),
        }}>
          {/* Their tier, as the section headers show one: the letter on its colour */}
          <span title={`${b.tier} tier`} style={{
            width: 15, height: 15, borderRadius: 4, background: c, color: '#000', fontSize: 9.5, fontWeight: 800, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>{b.tier}</span>
          <span style={{ ...ellipsis, minWidth: 0, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>{compact ? shortName(b.name) : b.name}</span>
        </span>
      ) : (
        <span style={{
          ...ellipsis, minWidth: 0, flexShrink: 1, height: 22, lineHeight: '20px', padding: '0 8px', boxSizing: 'border-box', borderRadius: 11,
          border: '1px dashed rgba(var(--sd-ink, 255, 255, 255), 0.3)', fontStyle: 'italic', color: 'var(--sd-fg-3, #889)',
        }}>{compact ? 'can’t be named' : CANT_NAME}</span>
      )}
      {between && <>
        <span aria-hidden="true" style={ARROW}>→</span>
        <span style={{ ...ellipsis, minWidth: 0, flexShrink: 2, color: 'var(--sd-fg-2, #bbc)' }}>{between}</span>
      </>}
      <span aria-hidden="true" style={ARROW}>→</span>
      <span style={{ ...ellipsis, minWidth: 24, flexShrink: 3, color: 'var(--sd-fg-3, #99a)' }}>{them}</span>
      {route?.seen && (
        <span title={`Seen with ${b?.name || 'them'} in a mutual line, outside what a scan of their circle read. A tie means seen together, not close.`}
          style={{
            flexShrink: 0, padding: '0 6px', borderRadius: 8, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: '16px',
            color: 'var(--sd-fg-2, #ccd)', border: `1px dashed ${TIE_COLOUR}`,
          }}>outside scan</span>
      )}
      {extra > 0 && (
        <span style={{
          flexShrink: 0, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
          color: 'var(--sd-fg-2, #ccd)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)',
        }}>+{extra}{compact ? '' : ` more`}</span>
      )}
    </span>
  );
}

/** How rare the way in is, as a bar: full for one door, nearly empty for the warmest. */
function RarityBar({ p, rarity }) {
  const info = rarity ? rarityInfo(rarity.key) : null;
  if (!info) return <span />;
  const fill = Math.max(0.06, 1 - easeOf(rarity.count));
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }} title={rarityTitle(p, rarity)}>
      <span style={{ height: 5, borderRadius: 3, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${fill * 100}%`, borderRadius: 3, background: info.color }} />
      </span>
      <span style={{ ...ellipsis, fontSize: 10.5, fontWeight: 600, color: 'var(--sd-fg-3, #99a)' }}>{rarityWords(p, rarity, info)}</span>
    </span>
  );
}

/** The same, as one line of words under the way in, where there's no column for it. */
function RarityLine({ p, rarity }) {
  const info = rarity ? rarityInfo(rarity.key) : null;
  if (!info) return null;
  return (
    <span title={rarityTitle(p, rarity)} style={{ ...ellipsis, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: 'var(--sd-fg-3, #99a)', minWidth: 0 }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
      <span style={ellipsis}>{rarityWords(p, rarity, info)}</span>
    </span>
  );
}

function rarityWords(p, rarity, info) {
  const mapped = rarity.from === 'linkedin' && rarity.count > p.waysIn ? `, ${fmt(p.waysIn)} mapped` : '';
  const what = p.degree > 2 ? `route${rarity.count === 1 ? '' : 's'}` : `mutual${rarity.count === 1 ? '' : 's'}`;
  return `${info.label} · ${fmt(rarity.count)} ${what}${mapped}`;
}

function rarityTitle(p, rarity) {
  return `${rarity.count} mutual connection${rarity.count === 1 ? '' : 's'}${rarity.from === 'scans' ? ' (from your scans, so it can only go up)' : ' (the platform’s count)'}. ${RARITY_NOTE}`;
}

/** "3rd", for someone ranked along a chain of scanned circles. */
function DegreeTag({ degree }) {
  return (
    <span title={`${DEGREE_WORD[degree]} degree: ${degree - 1} introductions away, along circles you've scanned`} style={{
      flexShrink: 0, fontSize: 9.5, fontWeight: 800, color: 'var(--sd-fg-2, #ccd)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.25)', borderRadius: 4, padding: '0 4px',
    }}>{DEGREE_WORD[degree]}</span>
  );
}

// Where a request stands, said once, in place of Connect: obvious, and in no tier's colour.
const STATE = Object.freeze({
  asked: { text: 'Request sent', mark: '✓', title: 'You sent a request. It shows everywhere in the app; Details can undo it.' },
  connected: { text: 'Connected', mark: '✓', title: 'Already one of your connections' },
  sending: { text: 'Sending…', mark: '', title: 'Auto is sending them a request now.' },
  queued: { text: 'Queued', mark: '', title: 'Auto’s request to them waits in the scan queue. Remove it in the notch.' },
});

/**
 * One clear next step per card. Connect, the primary, opens their profile to
 * connect yourself and marks the request sent (as the person card's does);
 * once asked, where it stands takes its place. View profile sits beside it.
 * Both are OpenProfile links: Sixgree's own browser where it can.
 */
function Actions({ p, route, status, compact = null }) {
  const { person } = p;
  const state = STATE[status] || null;
  const bridgeId = route?.bridge ? route.id : person.source_connection_id ?? null;
  const who = <span style={SR_ONLY}> {person.name}</span>;
  const main = state ? (
    <span className="sepstate" data-state={status} title={state.title}>
      {state.mark && <span aria-hidden="true">{state.mark}</span>}{state.text}
    </span>
  ) : (
    <OpenProfile person={person} stopPropagation className="sepgo" title="Opens their profile, to connect yourself"
      onOpen={() => { markRequested(person, { bridgeId }).catch(() => {}); logInteraction('connect-click', person, { route: 'linkedin', where: 'separation' }); }}
      style={{ height: compact ? 32 : 26, padding: compact ? '0 16px' : '0 14px' }}>
      Connect{who}
    </OpenProfile>
  );
  const view = (
    <OpenProfile person={person} stopPropagation className="sepview" style={{ padding: compact ? '3px 2px' : '1px 2px' }}>
      {compact ? 'Profile' : 'View profile'}{who}
    </OpenProfile>
  );
  // A phone puts View profile under the score, and the one step beside the way in.
  if (compact === 'main') return main;
  if (compact === 'view') return view;
  return <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, minWidth: 0 }}>{main}{view}</span>;
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
  const sub = { fontSize: 9, fontWeight: 700, color: 'var(--sd-fg-4, #667)', letterSpacing: 1, textTransform: 'uppercase', margin: '10px 0 6px' };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div role="dialog" aria-label="Pick a sector or a company" style={{
        position: 'absolute', zIndex: 41, top: isMobile ? 52 : 44, left: isMobile ? 6 : 14, width: isMobile ? 'calc(100% - 12px)' : 'min(560px, calc(100% - 28px))',
        maxHeight: 340, overflowY: 'auto', boxSizing: 'border-box', padding: 12, borderRadius: 12,
        background: 'var(--sd-surface, #0c101e)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)', boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}>
        <input
          autoFocus type="search" value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKey}
          placeholder="Type a sector or a company" aria-label="Type a sector or a company"
          style={{
            width: '100%', height: isMobile ? 44 : 34, boxSizing: 'border-box', padding: '0 12px', borderRadius: 8, outline: 'none',
            color: 'var(--sd-fg-1, #fff)', fontSize: isMobile ? 16 : 13, border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)',
          }}
        />
        {sectors.length > 0 && <div style={sub}>Sectors · inferred from company names and headlines</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sectors.map((i) => (
            <button key={i.key} type="button" onClick={() => onPick({ kind: 'sector', key: i.key, label: i.label, color: i.color })} style={{
              height: 28, padding: '0 10px', borderRadius: 14, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
              border: `1px solid ${i.color}66`, background: `${i.color}14`, color: 'var(--sd-fg-1, #ddd)', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: i.color }} />
              {i.label}
              <span style={{ fontWeight: 500, color: 'var(--sd-fg-3, #889)' }}>{fmt(i.count)}</span>
            </button>
          ))}
        </div>
        {companies.length > 0 && <div style={sub}>Companies{needle ? '' : ' · the biggest; type to find any'}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {companies.map((c) => (
            <button key={c.name} type="button" onClick={() => onPick({ kind: 'company', key: c.name, label: c.name })} style={{
              height: 28, padding: '0 10px', borderRadius: 14, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
              border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', color: 'var(--sd-fg-2, #ccc)',
            }}>
              {c.name}
              <span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--sd-fg-3, #889)' }}>{fmt(c.count)}</span>
            </button>
          ))}
        </div>
        {!sectors.length && !companies.length && (
          <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #888)', padding: '12px 2px 4px' }}>
            {facets ? `Nothing matches ‘${text.trim()}’.` : 'Reading where everyone works…'}
          </div>
        )}
      </div>
    </>
  );
}

// The slider's two ends, in the colours rarity already uses for them; as words,
// the variables a light look deepens (lib/themes.js lightTokens).
const RARE = '#00E5FF';
const EASY = '#FF7043';
const RARE_VAR = `var(--sd-cyan, ${RARE})`;
const EASY_VAR = `var(--sd-coral, ${EASY})`;
const SLIDER_CSS = `
.sepslide { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 24px; margin: 4px 0 0; background: transparent; cursor: pointer; }
.sepslide::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${RARE} 0%, #FFD700 50%, ${EASY} 100%); }
.sepslide::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -7px; border-radius: 50%; background: var(--sd-bg); border: 3px solid var(--sd-fg-1, #fff); box-shadow: 0 0 10px rgba(var(--sd-ink, 255, 255, 255), 0.45); }
.sepslide::-moz-range-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${RARE} 0%, #FFD700 50%, ${EASY} 100%); }
.sepslide::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--sd-bg); border: 3px solid var(--sd-fg-1, #fff); box-shadow: 0 0 10px rgba(var(--sd-ink, 255, 255, 255), 0.45); }
.sepslide:focus-visible { outline: 2px solid rgba(var(--sd-ink, 255, 255, 255), 0.7); outline-offset: 3px; border-radius: 6px; }
`;
// The list's cards and headers: hover and the picked card in CSS, never in React
// state (TRAPS §29), a focus ring inside the card, and Connect and View profile.
const LIST_CSS = `
.sepcard { transition: top ${MOVE}, background .12s; }
.sepcard:hover { background: rgba(var(--sd-ink, 255, 255, 255), 0.045); }
.sepcard[data-state="asked"] { background: rgba(var(--sd-ink, 255, 255, 255), 0.025); }
.sepcard[data-sel] { background: color-mix(in srgb, ${ORANGE} 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, ${ORANGE} 50%, transparent); }
.sepchev { display: block; flex-shrink: 0; color: var(--sd-fg-3, #99a); transition: transform .18s; }
.sephead:hover { filter: brightness(1.08); }
.seppick:focus-visible { outline: 2px solid var(--sd-accent, #3498db) !important; outline-offset: 3px !important; border-radius: 8px; }
.sephead button:focus-visible { outline: 2px solid var(--sd-accent, #3498db) !important; outline-offset: -3px !important; border-radius: 8px; }
.sepgo { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 84px; border-radius: 14px;
  background: linear-gradient(135deg, #FF8A4C, ${ORANGE}); color: #111 !important; font-size: 12px; font-weight: 800; text-decoration: none; white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); position: relative; }
.sepgo:hover { filter: brightness(1.08); }
.sepview { position: relative; font-size: 11px; font-weight: 600; color: var(--sd-fg-3, #99a); text-decoration: none; white-space: nowrap; }
.sepview:hover { color: var(--sd-fg-1, #fff); text-decoration: underline; }
.sepgo:focus-visible, .sepview:focus-visible { outline: 2px solid var(--sd-accent, #3498db); outline-offset: 2px; border-radius: 6px; }
.sepstate { display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; height: 26px; padding: 0 10px; border-radius: 13px;
  font-size: 11.5px; font-weight: 800; white-space: nowrap; color: var(--sd-fg-1, #fff); border: 1px solid rgba(var(--sd-ink, 255, 255, 255), 0.3); }
.sepstate[data-state="asked"] { background: var(--sd-fg-1, #fff); color: var(--sd-bg, #0a0a1a); border-color: transparent; }
.sepstate[data-state="sending"], .sepstate[data-state="queued"] { border-style: dashed; color: var(--sd-fg-2, #ccd); }
@media (prefers-reduced-motion: reduce) { .sepcard, .sepchev { transition: none; } }
`;
// The small capitals that name a group of chips.
const GROUP_LABEL = { fontSize: 10, color: 'var(--sd-fg-4, #666)', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'help', marginRight: 2 };
const COUNT = { fontWeight: 500, color: 'var(--sd-fg-4, #777)', fontVariantNumeric: 'tabular-nums' };
/** A filter chip: its colour shows only once it's on, and its words stay ink, so no colour stands for two things. */
const chipStyle = (on, color, height) => ({
  height, padding: '0 10px', borderRadius: 14, cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
  border: `1px solid ${on ? tint(color, 70) : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`,
  background: on ? tint(color, 16) : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
  color: on ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #bbb)',
});
// Blake, 2026-10-16: "I want that only to be for the outputs, for the actual tier to be
// controlled in the filter, and that is all, not the whole function." The chips filter
// the people ranked (matches, unrankedShown) and nothing else: every route keeps every
// connection and every person between, whatever their tier (lib/separation.js), and
// Gatekeepers lists all your connections. Each tier is a section of the list, so a chip
// shows or hides a whole section.
const TIER_NOTE = 'Shows or hides a section of the people to connect with, by their tier. Every connection who leads to them, and everyone in between, shows whatever their tier.';
const RARITY_NOTE = 'Rarity is how many mutual connections lead to them: few is a rare way in, many is warm (likely to accept). It never changes a score or a tier.';

/**
 * One person as a card in their tier's section: rank, face, name and role
 * (the part that picks them for Details), the way in, how rare it is, their
 * score, and one clear next step. A phone stacks it: who, then the way in
 * beside the step.
 */
const Row = memo(function Row({ p, top, height, layout, selected, tierColors, onPick, q, status, rarity, leverageOf = null }) {
  const { person } = p;
  const c = tierColors[tierOf(p)] || '#888';
  const route = pickRoute(p, q);
  const member = person.name === 'LinkedIn Member';
  const rank = p.unranked ? DEGREE_WORD[p.degree] : `#${p.rank}${p.tied ? '=' : ''}`;
  const extra = p.waysIn - 1;
  const viaText = p.unranked
    ? 'no route on file, found by a company scan'
    : `via ${route?.bridge ? `${route.bridge.name}, ${route.bridge.tier} tier` : CANT_NAME}${viaTail(route)}${extra > 0 ? ` and ${extra} other${extra > 1 ? 's' : ''}` : ''}`;
  const label = `${p.unranked ? `${DEGREE_WORD[p.degree]} degree, not ranked` : `Rank ${p.rank}${p.tied ? ', tied' : ''}`}, ${person.name}, ${p.tier} tier, ${p.score.toFixed(1)}${p.degree > 2 && !p.unranked ? `, ${DEGREE_WORD[p.degree]} degree` : ''}, ${p.waysIn} way${p.waysIn === 1 ? '' : 's'} in, ${viaText}${STATE[status] ? `. ${STATE[status].text}` : ''}`;
  const phone = layout === 'phone';
  const sub = subline(person);
  const score = (
    <span title="Power score" style={{ flexShrink: 0, textAlign: 'right', fontSize: 15, fontWeight: 800, color: ink(c), fontVariantNumeric: 'tabular-nums' }}>{p.score.toFixed(1)}</span>
  );
  // Who: the part that picks them, a button, so it's reached with Tab and pressed with Enter or Space.
  const pick = (
    <button type="button" className="seppick" aria-pressed={selected} aria-label={label} style={{
      background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: phone ? 1 : undefined, width: phone ? undefined : '100%', height: phone ? 42 : '100%',
    }}>
      {!phone && (
        <span style={{ width: 38, flexShrink: 0, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          color: !p.unranked && p.rank <= 3 ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-3, #889)' }}>{rank}</span>
      )}
      <Avatar person={person} size={phone ? 36 : 32} tierColors={tierColors} />
      <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ ...ellipsis, fontSize: 13.5, fontWeight: 650, color: member ? 'var(--sd-fg-3, #888)' : 'var(--sd-fg-1, #fff)' }}>{person.name}</span>
          {p.degree > 2 && !p.unranked && <DegreeTag degree={p.degree} />}
          {member && <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--sd-fg-4, #666)' }}>out of network</span>}
        </span>
        <span style={{ ...ellipsis, fontSize: 11, color: 'var(--sd-fg-3, #889)' }}>
          {phone && <span style={{ fontWeight: 700, color: 'var(--sd-fg-2, #bbc)', fontVariantNumeric: 'tabular-nums' }}>{rank}{sub ? ' · ' : ''}</span>}
          {sub}
        </span>
      </span>
    </button>
  );

  return (
    <div
      className="seprow sepcard"
      data-sel={selected ? '' : undefined}
      data-state={status || undefined}
      onClick={() => onPick(p)}
      style={{
        position: 'absolute', top, left: 0, right: 0, height, boxSizing: 'border-box', cursor: 'pointer',
        borderLeft: `3px solid ${tint(c, 55)}`, borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.05)',
        ...(phone
          ? { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: '8px 10px' }
          : { display: 'grid', gridTemplateColumns: layout === 'wide' ? COLUMNS_WIDE : COLUMNS_MID, alignItems: 'center', columnGap: 12, padding: '0 12px' }),
      }}
    >
      {phone ? (
        <>
          {/* A phone: who, with the score and View profile on the right; then the way in, beside the one step */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {pick}
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
              {score}
              <Actions p={p} route={route} status={status} compact="view" />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0 }}><PathLine p={p} route={route} tierColors={tierColors} compact /></span>
            <Actions p={p} route={route} status={status} compact="main" />
          </div>
        </>
      ) : (
        <>
          {pick}
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <PathLine p={p} route={route} tierColors={tierColors} />
            {(layout !== 'wide' || p.degree > 2 || (leverageOf && route?.bridge)) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {layout !== 'wide' && <RarityLine p={p} rarity={rarity} />}
                {layout === 'wide' && p.degree > 2 && !p.unranked && (
                  <span style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', whiteSpace: 'nowrap' }}>{p.degree - 1} introductions</span>
                )}
                {/* The strategy engine (experimental): where this way in stands, when it's on and measured */}
                {leverageOf && route?.bridge && <LeverageBadge small value={leverageOf(route.bridge)} />}
              </span>
            )}
          </span>
          {layout === 'wide' && (p.unranked
            ? <span title="No mutual connections on file: no scanned circle has them" style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)' }}>no mutuals on file</span>
            : <RarityBar p={p} rarity={rarity} />)}
          {score}
          <Actions p={p} route={route} status={status} />
        </>
      )}
    </div>
  );
});
