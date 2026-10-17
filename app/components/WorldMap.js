'use client';

// The Map tab: your network on a world map, by where people are (Blake,
// 2026-10-14: "then we will have a map section that's part of the geo
// location"; its own tab, beside Network Circle, Degrees and Separation).
//
// One dot per place, sized by how many people are there and drawn as the mix
// of their tiers, or of their degrees (a switch): a dot of one tier is that
// tier's colour, a dot of several is a pie of them. Zoom with the
// wheel or a pinch, drag to pan. Click a place for who's there; click a person
// for their card, as every other tab does. The Filters panel picks tiers and
// degrees, as on Network Circle.
//
// Lines and filters (Blake, 2026-10-15: "for maps I'm sure there's some cool
// graphics and filters we can have on here like for lines and etc"), each for
// one question (lib/map-lines.js, app/components/WorldMapParts.js):
//   - a place's list says who gets you there: lines from the connections who
//     reach the 2nd-degree people in it, as thick as how many, each with
//     Outlink's "ask for an intro";
//   - one connection's reach (from a place's list, the finder, or a route):
//     lines from where they are to everywhere their circle lives;
//   - From you, off to start: faint lines from home to your connections' places;
//   - the finder (a person, company or place), and filters as chips you clear.
//
// Views, one at a time from one control card (Blake, 2026-10-16: "more cool UI
// function and visuals for the locations like heat maps, line visuals ... and
// make it more clean"; lib/map-visuals.js, app/components/WorldMapLayers.js):
//   - Places: the dots, with a glow on the densest;
//   - Heat: a smooth density surface of everyone, a tier or a degree, and its densest place;
//   - Flows: the busiest routes from your connections to where their circles live;
//   - Hubs: places ranked by reach, each a click from the map flying there;
// and whenever someone's card is open, the path to them: you, then each person
// along their chain, place by place.
// Lines are drawn only for what's picked, or the busiest few routes, never for
// everyone, so the map stays smooth at any size; they draw in unless the system
// asks for less motion.
//
// All offline: the world is Natural Earth's 1:110m countries and the places a
// gazetteer, both in public/geo, built by scripts/build-places.mjs. No map
// tiles, nothing fetched from anywhere but this app (lib/places.js).

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { contours, geoIdentity, geoNaturalEarth1, geoPath, select, zoom as d3zoom, zoomIdentity } from 'd3';
import { makeGazetteer, placePeople, placeFor, bestTier, mixOf } from '../../lib/places';
import { keyFor } from '../../lib/separation';
import { galaxyChain } from '../../lib/galaxy';
import { IS_DEMO } from '../../lib/demo';
import {
  circlesByBridge, reachOf, gettersTo, homeOf, fromYou, filterPeople, keepPlaces, filterChips, clearChip,
  NO_FILTERS, locatedLine, companiesOf, arcPoints, arcPath, arcWidth, arcMotion, prefersReducedMotion, glowKeys,
} from '../../lib/map-lines';
import { heatWeights, densityBins, heatLevels, flowsBetween, topFlows, legendSteps, rankHubs, chainAcross } from '../../lib/map-visuals';
import { useSize } from './PathsAnalyzer';
import {
  DEGREE_NAMES, LINE, fmt, plural, tierFill, degreeFill, firstName, card, byStrength, smallButton,
  PersonRow, SidePanel, GettersList, ReachPanel, MapFinder, Chips, MapOptions,
} from './WorldMapParts';
import {
  MAP_VIEWS, readLook, writeLook, MapSeg, DotLegend, HeatLegend, FlowLegend, HubLegend, HubPanel, PathCard, FlowPanel, heatColours, heatFill,
} from './WorldMapLayers';

// The two files, fetched from this app once a session and kept.
let geoLoad = null;
function loadGeo() {
  if (!geoLoad) {
    geoLoad = Promise.all([fetch('/geo/places.json'), fetch('/geo/world.json')])
      .then(async ([places, world]) => {
        if (!places.ok || !world.ok) throw new Error('The map’s files are missing from this copy of Sixgree.');
        return { gaz: makeGazetteer(await places.json()), world: await world.json() };
      })
      .catch((e) => { geoLoad = null; throw e; });
  }
  return geoLoad;
}

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const check = () => setPhone(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return phone;
}

/** Whether the system asks for less motion, kept up to date. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(prefersReducedMotion(window));
    update();
    mq?.addEventListener?.('change', update);
    return () => mq?.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

// Home for From you: a place key, kept in this browser (a convenience, never the network).
const HOME_KEY = 'six-degrees-map-home';
const readHome = () => { try { return localStorage.getItem(HOME_KEY) || null; } catch { return null; } };
const writeHome = (key) => { try { if (key) localStorage.setItem(HOME_KEY, key); else localStorage.removeItem(HOME_KEY); } catch { /* storage off: this visit only */ } };

/** A dot's radius on screen: grows with the square root of its people, and a little as you zoom in. */
const radiusFor = (count, k) => Math.min(26, 3 + Math.sqrt(count) * 1.75) * Math.min(1.8, Math.pow(k, 0.22));

const roundButton = {
  width: 32, height: 32, borderRadius: 8, border: LINE, cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)', fontFamily: 'inherit',
};
const halo = { paintOrder: 'stroke', stroke: 'var(--sd-bg, #0a0a1a)', strokeWidth: 3.5, strokeLinejoin: 'round', pointerEvents: 'none' };

// Hover, dimming, the lines' draw-in, a route's moving dash and a view's fade.
// Reduced motion: no transitions, and the lines are given no animation at all
// (lib/map-lines.js arcMotion), and no moving dash.
const MAP_CSS = `
.sd-map-dot { transition: opacity 220ms ease; }
.sd-map-dot[data-dim] { opacity: 0.2; }
.sd-map-dot[data-dim]:hover { opacity: 0.65; }
.sd-map-dot .sd-map-body { transition: transform 160ms ease; }
.sd-map-dot:hover .sd-map-body, .sd-map-dot:focus-visible .sd-map-body { transform: scale(1.14); }
.sd-map-dot .sd-map-hover { opacity: 0; transition: opacity 160ms ease; }
.sd-map-dot:hover .sd-map-hover { opacity: 0.9; }
.sd-map-arc-hit { cursor: pointer; }
.sd-map-arc-hit:hover + .sd-map-arc { stroke-opacity: 1; }
.sd-map-row:hover { background-color: rgba(var(--sd-ink, 255, 255, 255), 0.06) !important; }
.sd-map-seg:hover:not([aria-pressed="true"]) { background-color: rgba(var(--sd-ink, 255, 255, 255), 0.06) !important; }
.sd-map-layer { animation: sd-map-fade 320ms ease both; }
@keyframes sd-map-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes sd-map-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .sd-map-dot, .sd-map-dot .sd-map-body, .sd-map-dot .sd-map-hover { transition: none; }
  .sd-map-layer { animation: none; }
}`;

export default function WorldMap({ connections = [], fullDegree1 = [], fullDegree2 = [], degree3 = [], onSelect, selectedId = null }) {
  const [geo, setGeo] = useState(null);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let live = true;
    loadGeo().then((g) => { if (live) setGeo(g); }).catch((e) => { if (live) setFailed(e.message || 'The map could not load.'); });
    return () => { live = false; };
  }, []);

  const phone = useIsPhone();
  const reduced = useReducedMotion();
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const { w, h } = useSize(wrapRef);
  const [colourBy, setColourBy] = useState('tier');
  const [view, setView] = useState(zoomIdentity);
  // What's picked: a place ({ kind: 'place', key, start }: its list, and the
  // lines of who gets you there, `start` the line clicked), one of your
  // connections ({ kind: 'bridge', id, end }: their reach, `end` the place open),
  // or a route ({ kind: 'flow', id }: who carries it).
  const [focus, setFocus] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showHome, setShowHome] = useState(false);
  // Read at once: nothing they change is drawn before the map's files arrive, on the client.
  const [homeKey, setHomeKey] = useState(readHome);
  // The view (Places, Heat, Flows, Hubs), whose heat and how many routes: kept in this browser.
  const [look, setLookState] = useState(readLook);
  const setLook = (patch) => setLookState((was) => { const next = { ...was, ...patch }; writeLook(next); return next; });
  const mapView = look.view;
  // The path to whoever's card is open, unless it was closed for them.
  const [pathOff, setPathOff] = useState(null);
  // Hubs' Top places, closed for this visit to the view.
  const [hubsClosed, setHubsClosed] = useState(false);

  // Everyone the Filters panel shows, by place; then who the map's own filters keep (lib/places.js, lib/map-lines.js).
  const whereAll = useMemo(() => (geo ? placePeople(geo.gaz, connections) : null), [geo, connections]);
  const shownRows = useMemo(() => filterPeople(connections, filters), [connections, filters]);
  const where = useMemo(() => (geo ? (shownRows === connections ? whereAll : placePeople(geo.gaz, shownRows)) : null),
    [geo, shownRows, connections, whereAll]);
  // The row the map draws for a person, by profile, so a circle's rows find the filters' own.
  const shownByKey = useMemo(() => new Map(shownRows.map((r) => [keyFor(r), r])), [shownRows]);
  const shown = useCallback((row) => shownByKey.get(keyFor(row)) || null, [shownByKey]);
  // Every circle, by the connection it's through, whatever the filters (they apply to who's at the end).
  const circles = useMemo(() => circlesByBridge(fullDegree2), [fullDegree2]);
  const d1ById = useMemo(() => new Map(fullDegree1.map((c) => [c.id, c])), [fullDegree1]);
  const bridgeIds = useMemo(() => new Set([...circles.keys()].filter((id) => d1ById.has(id))), [circles, d1ById]);

  // Through whom: one connection's circle, place by place.
  const bridge = focus?.kind === 'bridge' ? d1ById.get(focus.id) || null : null;
  const reach = useMemo(() => (geo && bridge ? reachOf(geo.gaz, bridge, circles.get(bridge.id) || [], shown) : null),
    [geo, bridge, circles, shown]);
  // Who gets me there: the place's list, and the connections who reach the people in it.
  const picked = useMemo(() => (focus?.kind === 'place' && where ? where.places.find((p) => p.key === focus.key) || null : null), [focus, where]);
  const getters = useMemo(() => (geo && picked ? gettersTo(geo.gaz, picked.key, circles, d1ById, shown) : null),
    [geo, picked, circles, d1ById, shown]);
  const home = useMemo(() => (where ? homeOf(where.places, homeKey) : null), [where, homeKey]);

  // Flows: every route from your connections to where their circles live, worked
  // out once for the view; drawn are the busiest few, or with a place picked, the
  // busiest leaving it (in Hubs, a picked place's reach).
  const routed = mapView === 'flows' || mapView === 'hubs';
  const flowData = useMemo(() => (geo && routed ? flowsBetween(geo.gaz, circles, d1ById, shown) : null), [geo, routed, circles, d1ById, shown]);
  const flowFrom = routed && picked ? picked : null;
  const flowPicked = focus?.kind === 'flow' ? flowData?.flows.find((f) => f.id === focus.id) || null : null;
  const drawnFlows = useMemo(() => {
    if (!flowData || bridge || (mapView === 'hubs' && !flowFrom)) return [];
    const top = topFlows(flowData.flows, { max: flowFrom ? Math.min(look.flowMax, 20) : look.flowMax, from: flowFrom?.key || null });
    return flowPicked && !top.includes(flowPicked) ? [...top, flowPicked] : top;
  }, [flowData, bridge, mapView, flowFrom, look.flowMax, flowPicked]);

  // Hubs: the top places by reach.
  const hubs = useMemo(() => (mapView === 'hubs' && where ? rankHubs(where.places, circles, shown, { max: 10 }) : null), [mapView, where, circles, shown]);
  const hubRank = useMemo(() => new Map((hubs || []).map((hub, i) => [hub.place.key, { ...hub, rank: i + 1 }])), [hubs]);

  // The path to whoever's card is open: galaxyChain over every row on file, the
  // chain Network Circle draws (you, then the connection who introduced them, and
  // on), worked out once while a card is open.
  const cardOpen = selectedId != null;
  const lineage = useMemo(() => {
    if (!cardOpen) return null;
    const byId = new Map();
    for (const r of [...fullDegree1, ...fullDegree2, ...degree3, ...connections]) if (r?.id != null && !byId.has(r.id)) byId.set(r.id, r);
    const rows = [...byId.values()];
    return { byId, parentOf: galaxyChain(rows, { all: rows }).parentOf };
  }, [cardOpen, fullDegree1, fullDegree2, degree3, connections]);
  const path = useMemo(() => (geo && lineage && cardOpen && pathOff !== selectedId
    ? chainAcross(geo.gaz, selectedId, { parentOf: lineage.parentOf, byId: lineage.byId, home: home?.place || null }) : null),
  [geo, lineage, cardOpen, pathOff, selectedId, home]);
  const pathPerson = path ? lineage.byId.get(selectedId) : null;

  // The places a line starts or ends at: drawn whatever the thresholds, and the rest dimmed.
  const involved = useMemo(() => {
    const s = new Set();
    if (reach) {
      if (reach.from) s.add(reach.from.key);
      for (const e of reach.ends) s.add(e.key);
    }
    if (picked) {
      s.add(picked.key);
      for (const st of getters?.starts || []) s.add(st.key);
    }
    for (const f of drawnFlows) { s.add(f.from.key); s.add(f.to.key); }
    return s;
  }, [reach, picked, getters, drawnFlows]);
  const drawnPlaces = useMemo(() => {
    if (!where) return [];
    const keep = new Set(involved);
    if (showHome && home) keep.add(home.place.key);
    for (const key of hubRank.keys()) keep.add(key);
    for (const s of path?.steps || []) if (s.place) keep.add(s.place.key);
    return keepPlaces(where.places, filters, keep);
  }, [where, filters, involved, showHome, home, hubRank, path]);
  const homeLines = useMemo(() => (showHome && home ? fromYou(drawnPlaces, home.place) : []), [showHome, home, drawnPlaces]);

  // How much of the map the window shows. On a phone the header's tabs wrap to
  // more rows than the page leaves room for, so the map runs past the bottom of
  // the window: what's drawn, and the panels at the bottom, keep to the part you see.
  const [visibleH, setVisibleH] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setVisibleH(Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); };
  }, [w, h]);
  const shownH = visibleH ? Math.min(h, visibleH) : h;
  const below = h - shownH;

  // Where the busiest place is, as text so a new filter doesn't move the map: a
  // phone's map is wider than the screen and opens centred on it.
  const busiest = whereAll?.places[0];
  const focusAt = busiest ? `${busiest.lon},${busiest.lat}` : '';

  // The world, fitted to the window. On a phone, to the height between the
  // controls and the bottom panel, wider than the screen, to pan across.
  const pad = phone ? 8 : 20;
  const fitted = useMemo(() => {
    if (!geo || !w || !shownH) return null;
    const top = phone ? 150 : pad;
    const bottom = Math.max(top + 80, shownH - (phone ? 60 : pad));
    const wide = phone && w / (bottom - top) < 1.6;
    const projection = geoNaturalEarth1().fitExtent([[wide ? 0 : pad, top], [wide ? (bottom - top) * 2.1 : w - pad, bottom]], geo.world);
    let [[x0], [x1]] = geoPath(projection).bounds(geo.world);
    if (wide) {
      const [fx] = (focusAt && projection(focusAt.split(',').map(Number))) || [(x0 + x1) / 2];
      const shift = Math.max(w - x1, Math.min(-x0, w / 2 - fx));
      const [tx, ty] = projection.translate();
      projection.translate([tx + shift, ty]);
      x0 += shift;
      x1 += shift;
    }
    return { projection, extent: [[Math.min(0, x0), 0], [Math.max(w, x1), h]] };
  }, [geo, w, h, shownH, phone, pad, focusAt]);
  const projection = fitted?.projection || null;
  const land = useMemo(() => {
    if (!projection) return [];
    const path = geoPath(projection);
    return geo.world.features.map((f, i) => ({ key: `${f.id}-${i}`, d: path(f) || '' }));
  }, [geo, projection]);

  // The dots at the map's own scale, biggest first so a small one is never hidden under a big one.
  const dots = useMemo(() => {
    if (!projection) return [];
    return drawnPlaces.map((p) => {
      const [x, y] = projection([p.lon, p.lat]) || [NaN, NaN];
      return { ...p, x, y, best: bestTier(p.people), tiers: mixOf(p.people, 'tier'), degrees: mixOf(p.people, 'degree') };
    }).filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  }, [projection, drawnPlaces]);
  const dotByKey = useMemo(() => new Map(dots.map((d) => [d.key, d])), [dots]);
  const endByKey = useMemo(() => new Map((reach?.ends || []).map((e) => [e.key, e])), [reach]);
  // A soft glow under the densest few, in Places.
  const glowing = useMemo(() => glowKeys(dots, { max: 12, least: 8 }), [dots]);

  // Zoom and pan: the wheel, a pinch, or a drag; the buttons step it.
  const extent = fitted?.extent;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !extent) return undefined;
    const z = d3zoom().scaleExtent([1, 60]).translateExtent(extent).on('zoom', (e) => setView(e.transform));
    zoomRef.current = z;
    select(svg).call(z);
    return () => { select(svg).on('.zoom', null); };
  }, [extent]);
  const ease = reduced ? 0 : 1;
  const zoomBy = (factor) => { if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(250 * ease).call(zoomRef.current.scaleBy, factor); };
  // Flying somewhere is an aim, worked out from the map's size: opening a card
  // narrows the map mid-flight, and the aim is taken again at the new size, so
  // the place still lands in the middle rather than the map showing open sea.
  const geomRef = useRef(null);
  const aimRef = useRef(null);
  const aimAt = useCallback((aim, duration) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    const t = geomRef.current?.projection ? aim(geomRef.current) : null;
    if (svg && z && t) select(svg).transition().duration(duration).call(z.transform, t);
  }, []);
  useEffect(() => {
    geomRef.current = { projection, w, shownH };
    const aim = aimRef.current;
    if (aim && Date.now() - aim.at < 2500) aimAt(aim.fn, 0);
  }, [projection, w, shownH, aimAt]);
  const aimFor = useCallback((fn, duration) => { aimRef.current = { fn, at: Date.now() }; aimAt(fn, duration); }, [aimAt]);
  const zoomHome = () => aimFor(() => zoomIdentity, 300 * ease);
  const flyTo = (lon, lat, k = 4) => {
    const scale = Math.max(view.k, k);
    aimFor(({ projection: pr, w: width, shownH: height }) => {
      const [x, y] = pr([lon, lat]) || [];
      return Number.isFinite(x) ? zoomIdentity.translate(width / 2 - scale * x, height / 2 - scale * y).scale(scale) : null;
    }, 600 * ease);
  };
  // Some places on screen at once, clear of the control card and a panel.
  const fitPlaces = (places) => {
    const left = phone ? 16 : 420;
    const right = phone ? 16 : focus || (hubs && !hubsClosed) ? 400 : 110;
    const top = phone ? 170 : 110;
    const bottom = phone ? 190 : 60;
    aimFor(({ projection: pr, w: width, shownH: height }) => {
      const pts = places.map((p) => pr([p.lon, p.lat])).filter((p) => p && Number.isFinite(p[0]));
      if (!pts.length) return null;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const room = [Math.max(80, width - left - right), Math.max(80, height - top - bottom)];
      const k = Math.max(1, Math.min(12, Math.min(room[0] / Math.max(30, x1 - x0), room[1] / Math.max(30, y1 - y0)) * 0.9));
      return zoomIdentity.translate(left + room[0] / 2 - k * (x0 + x1) / 2, top + room[1] / 2 - k * (y0 + y1) / 2).scale(k);
    }, 700 * ease);
  };

  // The lines for what's picked, along great circles, at the map's own scale.
  const arcs = useMemo(() => {
    if (!projection) return [];
    const colourOf = (people) => (colourBy === 'tier' ? tierFill(bestTier(people)) : degreeFill(2));
    const list = [];
    if (reach?.from) {
      for (const e of reach.ends) {
        if (e.key === reach.from.key) continue;
        list.push({ id: `b:${bridge.id}:${e.key}`, kind: 'reach', from: reach.from, to: e, count: e.count, colour: colourOf(e.people), end: e.key,
          title: `${e.label}: ${plural(e.count, 'person', 'people')} through ${bridge.name}` });
      }
    }
    if (picked && getters) {
      for (const st of getters.starts) {
        list.push({ id: `p:${picked.key}:${st.key}`, kind: 'getters', from: st, to: picked, count: st.count,
          colour: colourOf(st.bridges.flatMap((b) => b.people)), end: st.key,
          title: `${st.bridges.map((b) => b.bridge.name).join(', ')} (${st.name}): ${plural(st.count, 'person', 'people')} in ${picked.name}` });
      }
    }
    for (const line of homeLines) {
      list.push({ id: `h:${line.place.key}`, kind: 'home', from: home.place, to: line.place, count: line.count, colour: 'var(--sd-fg-3, #889)', end: line.place.key,
        title: `${line.place.label}: ${plural(line.count, 'connection')}` });
    }
    for (const f of drawnFlows) {
      list.push({ id: `f:${f.id}`, kind: 'flow', from: f.from, to: f.to, count: f.count, end: f.id, colour: 'var(--sd-accent, #3498db)',
        title: `${f.from.name} to ${f.to.name}: ${plural(f.count, 'person', 'people')} through ${plural(f.bridges.length, 'connection')}` });
    }
    for (const leg of path?.legs || []) {
      list.push({ id: `c:${leg.step}:${leg.from.key}:${leg.to.key}`, kind: 'path', from: leg.from, to: leg.to, count: 1, colour: 'var(--sd-accent, #3498db)',
        end: leg.to.key, skipped: leg.skipped, title: `Step ${leg.step}: ${leg.from.name} to ${leg.to.name}` });
    }
    return list.map((a) => ({ ...a, base: arcPoints(a.from, a.to, 36).map((p) => projection(p) || [NaN, NaN]) })).filter((a) => a.base.length);
  }, [projection, colourBy, reach, bridge, picked, getters, homeLines, home, drawnFlows, path]);
  const motion = arcMotion(reduced, arcs.filter((a) => a.kind !== 'home' && a.kind !== 'path').length);
  const pathDrawn = arcs.some((a) => a.kind === 'path');

  // Heat: a smooth density surface of one group, worked out a beat behind the
  // zoom (useDeferredValue) and moved with it meanwhile (lib/map-visuals.js).
  const heatView = useDeferredValue(view);
  const heat = useMemo(() => {
    if (mapView !== 'heat' || !w || !h) return null;
    const weights = heatWeights(dots, look.heatOf);
    const people = weights.reduce((n, x) => n + x.weight, 0);
    const radius = 15 * Math.min(2.4, Math.pow(heatView.k, 0.35));
    const pts = [];
    for (const { place, weight } of weights) {
      const x = heatView.applyX(place.x);
      const y = heatView.applyY(place.y);
      if (x < -radius * 3 || y < -radius * 3 || x > w + radius * 3 || y > h + radius * 3) continue;
      pts.push([x, y, weight]);
    }
    const bins = densityBins(pts, { width: w, height: h, cell: 4, radius });
    const levels = heatLevels(bins.max, 7);
    const shape = geoPath(geoIdentity().scale(bins.cell).translate([-bins.pad, -bins.pad]));
    const paths = levels.length ? contours().size([bins.cols, bins.rows]).thresholds(levels)(bins.values)
      .map((c, i) => ({ d: shape(c) || '', level: i / Math.max(1, levels.length - 1) })) : [];
    return { paths, people, densest: weights[0] || null, counted: new Map(weights.map((x) => [x.place.key, x.weight])) };
  }, [mapView, look.heatOf, dots, heatView, w, h]);
  const heatShift = heatView.k ? view.k / heatView.k : 1;
  const heatTransform = `translate(${view.x - heatShift * heatView.x},${view.y - heatShift * heatView.y}) scale(${heatShift})`;

  // The path's steps on screen: a numbered mark at each place, stacked where two share one.
  const pathMarks = useMemo(() => {
    if (!path || !projection) return [];
    const at = new Map();
    for (const s of path.steps) {
      if (!s.place) continue;
      const p = projection([s.place.lon, s.place.lat]);
      if (!p) continue;
      const list = at.get(s.place.key) || [];
      list.push({ ...s, p });
      at.set(s.place.key, list);
    }
    return [...at.values()].flatMap((list) => list.map((s, i) => ({ ...s, nth: i })));
  }, [path, projection]);

  // Names for the places a line touches first, then the biggest in view, never on top of each other.
  const labels = useMemo(() => {
    const out = [];
    const boxes = [];
    const add = (key, x, y, r, text, strong, force = false) => {
      if (x < 0 || y < 0 || x > w || y > shownH) return false;
      const box = { x0: x + r + 3, y0: y - 7, x1: x + r + 5 + text.length * 6.3, y1: y + 7 };
      if (!force && boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) return false;
      boxes.push(box);
      out.push({ key, x: box.x0, y, text, strong });
      return true;
    };
    const at = (key) => {
      const d = dotByKey.get(key);
      return d ? [view.applyX(d.x), view.applyY(d.y), radiusFor(d.count, view.k)] : null;
    };
    // The path's names first, beside its marks: "Lev · Munich".
    const done = new Set();
    const onPath = new Map();
    for (const m of pathMarks) {
      const at = onPath.get(m.place.key) || { m, names: [] };
      at.names.push(m.person ? firstName(m.person.name) : 'You');
      onPath.set(m.place.key, at);
    }
    for (const [key, { m, names }] of onPath) {
      add(`path-${key}`, view.applyX(m.p[0]) + (names.length - 1) * 15, view.applyY(m.p[1]), 10, `${names.join(', ')} · ${m.place.name}`, 'path', true);
      done.add(key);
    }
    const special = [];
    if (reach) for (const e of reach.ends.slice(0, 30)) special.push([e.key, `${e.name} · ${fmt(e.count)}`]);
    if (picked) {
      special.push([picked.key, picked.name]);
      for (const st of (getters?.starts || []).slice(0, 20)) special.push([st.key, `${st.name} · ${fmt(st.count)}`]);
    }
    if (showHome && home) special.push([home.place.key, `Home · ${home.place.name}`]);
    for (const hub of hubs || []) special.push([hub.place.key, `${hub.place.name} · ${fmt(hub.reach)}`]);
    for (const f of drawnFlows.slice(0, 12)) special.push([f.from.key, f.from.name], [f.to.key, f.to.name]);
    for (const [key, text] of special) {
      const p = at(key);
      if (p && !done.has(key) && add(key, p[0], p[1], p[2], text, true)) done.add(key);
    }
    const room = Math.round(5 + 5 * view.k);
    let plain = 0;
    const order = heat ? [...heat.counted.keys()].map((key) => dotByKey.get(key)).filter(Boolean) : dots;
    for (const d of order) {
      if (plain >= room) break;
      if (done.has(d.key)) continue;
      if (involved.size && !involved.has(d.key)) continue;
      if (add(d.key, view.applyX(d.x), view.applyY(d.y), radiusFor(d.count, view.k), d.name, false)) plain++;
    }
    return out;
  }, [dots, dotByKey, view, w, shownH, reach, picked, getters, showHome, home, involved, hubs, drawnFlows, heat, pathMarks]);

  // The finder's lists: everyone (your connections whatever the filters), companies, places.
  const finderIndex = useMemo(() => {
    if (!whereAll) return null;
    const seen = new Set();
    const people = [];
    for (const r of [...fullDegree1, ...connections]) {
      const k = keyFor(r);
      if (seen.has(k)) continue;
      seen.add(k);
      people.push(r);
    }
    return { people, bridgeIds, companies: companiesOf(connections), places: whereAll.places };
  }, [whereAll, fullDegree1, connections, bridgeIds]);

  const pickPlace = (key) => setFocus(key ? { kind: 'place', key } : null);
  const showReach = (id) => setFocus({ kind: 'bridge', id, end: null });
  const onPerson = (p) => {
    onSelect?.(p);
    const at = geo ? placeFor(geo.gaz, p.location) : null;
    if (at?.status !== 'placed') return;
    flyTo(at.lon, at.lat, 4);
    if (where?.places.some((x) => x.key === at.key)) pickPlace(at.key);
  };
  const onPlace = (p) => { flyTo(p.lon, p.lat, p.kind === 'city' ? 5 : 3); pickPlace(p.key); };
  const clickDot = (d) => {
    if (endByKey.has(d.key)) { setFocus({ ...focus, end: focus.end === d.key ? null : d.key }); return; }
    pickPlace(focus?.kind === 'place' && focus.key === d.key ? null : d.key);
  };
  const clickArc = (a) => {
    if (a.kind === 'reach') setFocus({ ...focus, end: a.end });
    else if (a.kind === 'getters') setFocus({ ...focus, start: a.end });
    else if (a.kind === 'flow') setFocus({ kind: 'flow', id: a.end });
    else if (a.kind === 'path') flyTo(a.to.lon, a.to.lat, 4);
    else pickPlace(a.end);
  };
  const makeHome = (key) => {
    const next = homeKey === key ? null : key;
    setHomeKey(next);
    writeHome(next);
    if (next) setShowHome(true);
  };
  const pickView = (next) => {
    setLook({ view: next });
    setHubsClosed(false);
    if (focus?.kind === 'flow' && next !== 'flows') setFocus(null);
  };

  const chips = filterChips(filters, { through: bridge?.name || null });
  const clearOne = (key) => (key === 'through' ? setFocus(null) : setFilters((f) => clearChip(f, key)));
  const clearAll = () => { setFilters(NO_FILTERS); if (bridge) setFocus(null); };

  const slices = (d) => (colourBy === 'tier' ? d.tiers.map(([t, n]) => [tierFill(t), n]) : d.degrees.map(([g, n]) => [degreeFill(g), n]));
  const glowOf = (d) => {
    const mix = colourBy === 'tier' ? d.tiers : d.degrees;
    const [top] = [...mix].sort((a, b) => b[1] - a[1])[0] || [];
    return colourBy === 'tier' ? `sd-glow-${top || 'D'}` : `sd-glow-d${top || 1}`;
  };
  const total = connections.length;
  const placedCount = whereAll?.placed || 0;
  const drawnPeople = dots.reduce((n, d) => n + d.count, 0);
  const narrowed = shownRows !== connections || filters.minPeople > 1 || filters.minStrong > 0;
  const optionsSet = (filters.minPeople > 1 ? 1 : 0) + (filters.minStrong > 0 ? 1 : 0) + (showHome ? 1 : 0);
  const reachFrom = reach?.from && projection ? projection([reach.from.lon, reach.from.lat]) : null;
  const viewInfo = MAP_VIEWS.find((v) => v.key === mapView) || MAP_VIEWS[0];
  const heatBase = heatColours(look.heatOf)[0];
  const mostReach = hubs?.[0]?.reach || 1;
  const flowSteps = legendSteps(drawnFlows.map((f) => f.count));

  const pathCard = path && pathPerson ? (
    <PathCard person={pathPerson} path={path} phone={phone} below={below} canOutlink={!IS_DEMO} homeGuessed={home?.guessed}
      onStep={(s) => s.place && flyTo(s.place.lon, s.place.lat, 4)}
      onFit={() => fitPlaces(path.steps.filter((s) => s.place).map((s) => s.place))}
      onReach={bridgeIds.has(pathPerson.id) && !(bridge && bridge.id === pathPerson.id) ? () => showReach(pathPerson.id) : null}
      onClose={() => setPathOff(selectedId)} />
  ) : null;

  return (
    <div ref={wrapRef} data-world-map={mapView} style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'var(--sd-page)' }}
      onKeyDown={(e) => { if (e.key === 'Escape' && focus) setFocus(null); }}>
      <style>{MAP_CSS}</style>
      {failed ? (
        <Centered><div style={{ fontSize: 14, color: 'var(--sd-fg-3, #889)' }}>{failed}</div></Centered>
      ) : !geo ? (
        <Centered><div style={{ fontSize: 13, color: 'var(--sd-fg-4, #778)' }}>Drawing the map&hellip;</div></Centered>
      ) : (
        <>
          <svg ref={svgRef} width={w} height={h} role="img" aria-label={`World map, ${viewInfo.label}: ${plural(drawnPeople, 'person', 'people')} in ${plural(dots.length, 'place')}`}
            style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}>
            <defs>
              {['S', 'A', 'B', 'C', 'D'].map((t) => <Glow key={t} id={`sd-glow-${t}`} colour={tierFill(t)} />)}
              {[1, 2, 3].map((d) => <Glow key={d} id={`sd-glow-d${d}`} colour={degreeFill(d)} />)}
            </defs>
            <rect width={w} height={h} fill="transparent" onClick={() => setFocus(null)} />
            <g transform={view.toString()}>
              {land.map((c) => (
                <path key={c.key} d={c.d} fill="rgba(var(--sd-ink, 255, 255, 255), 0.07)"
                  stroke="rgba(var(--sd-ink, 255, 255, 255), 0.18)" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
                  style={{ fill: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', stroke: 'rgba(var(--sd-ink, 255, 255, 255), 0.18)' }}
                  onClick={() => setFocus(null)} />
              ))}
            </g>
            {heat && (
              <g key={`heat-${look.heatOf}`} className="sd-map-layer" data-map-heat={look.heatOf} transform={heatTransform} style={{ pointerEvents: 'none' }}>
                {heat.paths.map((p, i) => (
                  <path key={i} d={p.d} style={{
                    fill: heatFill(look.heatOf, p.level), fillOpacity: 0.08 + 0.13 * p.level,
                    stroke: heatFill(look.heatOf, p.level), strokeOpacity: 0.18 + 0.3 * p.level, strokeWidth: 0.8,
                  }} />
                ))}
              </g>
            )}
            {/* The glow under the densest places, in Places. */}
            {mapView === 'places' && dots.map((d) => {
              if (!glowing.has(d.key)) return null;
              const x = view.applyX(d.x);
              const y = view.applyY(d.y);
              const r = radiusFor(d.count, view.k) * 2.2;
              if (x < -r || y < -r || x > w + r || y > h + r) return null;
              if (involved.size && !involved.has(d.key)) return null;
              return <circle key={`glow-${d.key}`} cx={x} cy={y} r={r} fill={`url(#${glowOf(d)})`} opacity={0.6} style={{ pointerEvents: 'none' }} />;
            })}
            {/* Hubs: a ring round each of the top places, as wide as its reach. */}
            {hubs && (
              <g key="hubs" className="sd-map-layer" style={{ pointerEvents: 'none' }}>
                {hubs.map((hub) => {
                  const d = dotByKey.get(hub.place.key);
                  if (!d) return null;
                  const r = radiusFor(d.count, view.k);
                  return (
                    <circle key={`reach-${hub.place.key}`} cx={view.applyX(d.x)} cy={view.applyY(d.y)} r={r + 4 + 30 * Math.sqrt(hub.reach / mostReach) * Math.min(1.6, Math.pow(view.k, 0.2))}
                      style={{ fill: 'var(--sd-accent, #3498db)', fillOpacity: 0.08, stroke: 'var(--sd-accent, #3498db)', strokeOpacity: 0.55 }} strokeWidth={1.2} strokeDasharray="3 3" />
                  );
                })}
              </g>
            )}
            {/* The lines, under the dots so each runs into its place. */}
            {arcs.map((a, i) => {
              const d = arcPath(a.base.map(([x, y]) => [view.applyX(x), view.applyY(y)]), { jump: w * 0.3 * view.k, lift: a.kind === 'path' ? 0.1 : 0.16 });
              if (!d) return null;
              if (a.kind === 'path') {
                return (
                  <g key={a.id}>
                    <path className="sd-map-arc-hit" d={d} fill="none" stroke="transparent" strokeWidth={14}
                      onClick={(e) => { e.stopPropagation(); clickArc(a); }}><title>{a.title}</title></path>
                    <path d={d} fill="none" strokeLinecap="round" strokeWidth={5.5} style={{ stroke: 'var(--sd-bg, #0a0a1a)', strokeOpacity: 0.85, pointerEvents: 'none' }} />
                    <path d={d} fill="none" strokeLinecap="round" strokeWidth={2.6} strokeDasharray={a.skipped ? '6 5' : undefined}
                      style={{ stroke: a.colour, pointerEvents: 'none' }} />
                  </g>
                );
              }
              const width = a.kind === 'home' ? Math.min(2.4, 0.7 + Math.sqrt(a.count) * 0.3) : arcWidth(a.count);
              const lit = (a.kind === 'reach' && focus?.end === a.end) || (a.kind === 'getters' && focus?.start === a.end) || (a.kind === 'flow' && focus?.id === a.end);
              const draw = a.kind !== 'home' && motion.draw
                ? { strokeDasharray: 1, animation: `sd-map-draw ${motion.draw}ms cubic-bezier(.2,.7,.2,1) ${Math.round(i * motion.stagger)}ms both` } : null;
              const base = a.kind === 'home' ? 0.38 : a.kind === 'flow' ? 0.55 : 0.82;
              return (
                <g key={a.id} style={{ opacity: pathDrawn ? 0.4 : 1, transition: reduced ? undefined : 'opacity 240ms ease' }}>
                  <path className="sd-map-arc-hit" d={d} fill="none" stroke="transparent" strokeWidth={Math.max(12, width + 8)}
                    onClick={(e) => { e.stopPropagation(); clickArc(a); }}><title>{a.title}</title></path>
                  <path className="sd-map-arc" d={d} pathLength={1} fill="none" strokeLinecap="round"
                    strokeWidth={lit ? width + 1.5 : width}
                    style={{ stroke: a.colour, strokeOpacity: lit ? 1 : base, pointerEvents: 'none', ...draw }} />
                  {/* A route's dash runs from where the connections are to where their people are. */}
                  {a.kind === 'flow' && motion.draw > 0 && (
                    <path d={d} pathLength={1} fill="none" strokeLinecap="round" strokeWidth={Math.max(1.4, width * 0.6)} strokeDasharray="0.05 0.95"
                      style={{ stroke: 'var(--sd-fg-1, #fff)', strokeOpacity: 0.75, pointerEvents: 'none', animation: `sd-map-draw ${2400 + (i % 5) * 260}ms linear ${-(i * 370) % 2400}ms infinite` }} />
                  )}
                </g>
              );
            })}
            {dots.map((d) => {
              const x = view.applyX(d.x);
              const y = view.applyY(d.y);
              const r = radiusFor(d.count, view.k);
              if (x < -r || y < -r || x > w + r || y > h + r) return null;
              const on = picked?.key === d.key || (reach && focus?.end === d.key);
              const dim = involved.size > 0 && !involved.has(d.key);
              const end = endByKey.get(d.key);
              const inHeat = heat?.counted.get(d.key) || 0;
              const small = Boolean(heat) && !on;
              return (
                <g key={d.key} className="sd-map-dot" transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}
                  data-dim={dim ? '' : undefined}
                  role="button" tabIndex={0} aria-pressed={Boolean(on)}
                  aria-label={`${d.label}: ${plural(d.count, 'person', 'people')}, strongest tier ${d.best}${d.approx ? ', placed at its middle' : ''}${end ? `, ${fmt(end.count)} through ${bridge.name}` : ''}${heat ? `, ${fmt(inHeat)} in the heat` : ''}`}
                  onClick={(e) => { e.stopPropagation(); clickDot(d); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickDot(d); } }}>
                  <title>{`${d.label}: ${plural(d.count, 'person', 'people')} (${(colourBy === 'tier' ? d.tiers.map(([t, n]) => `${n} ${t}`) : d.degrees.map(([g, n]) => `${n} ${DEGREE_NAMES[g]}`)).join(', ')})${end ? `; ${fmt(end.count)} through ${bridge.name}` : ''}${heat ? `; ${fmt(inHeat)} of them in this heat map` : ''}${d.approx ? ', approximate: placed at its middle' : ''}`}</title>
                  <circle className="sd-map-focus" r={(small ? 4 : r) + 5} fill="none" style={{ stroke: 'var(--sd-accent, #3498db)' }} strokeWidth={2} />
                  <circle className="sd-map-hover" r={(small ? 4 : r) + 3} fill="none" style={{ stroke: 'var(--sd-fg-1, #fff)', pointerEvents: 'none' }} strokeWidth={1.5} />
                  {small ? (
                    <g className="sd-map-body">
                      <circle r={10} fill="transparent" />
                      <circle r={inHeat ? 2.8 : 2} style={{ fill: inHeat ? heatBase : 'var(--sd-fg-4, #778)', stroke: 'var(--sd-bg, #0a0a1a)' }} strokeWidth={1} fillOpacity={inHeat ? 0.95 : 0.6} />
                    </g>
                  ) : (
                    <>
                      {end && !on && <circle r={r + 3.5} fill="none" style={{ stroke: 'var(--sd-accent, #3498db)', pointerEvents: 'none' }} strokeWidth={1.6} strokeOpacity={0.9} />}
                      {on && <circle r={r + 5} fill="none" style={{ stroke: 'var(--sd-fg-1, #fff)' }} strokeWidth={2} />}
                      <g className="sd-map-body">
                        <Pie r={r} parts={slices(d)} />
                        <circle r={r} fill="none" style={{ stroke: d.approx ? 'var(--sd-fg-2, #cfd8d8)' : 'var(--sd-bg, #0a0a1a)' }} strokeWidth={d.approx ? 1.3 : 1.2}
                          strokeDasharray={d.approx ? '3 2' : undefined} />
                        {r >= 11 && (
                          <text textAnchor="middle" dy="0.35em" fontSize={r >= 18 ? 11 : 9.5} fontWeight={800}
                            style={{ fill: '#fff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.5, paintOrder: 'stroke', strokeLinejoin: 'round', pointerEvents: 'none' }}>{d.count > 999 ? `${Math.round(d.count / 100) / 10}k` : d.count}</text>
                        )}
                      </g>
                    </>
                  )}
                </g>
              );
            })}
            {/* Hubs: each top place's rank. */}
            {hubs && hubs.map((hub, i) => {
              const d = dotByKey.get(hub.place.key);
              if (!d) return null;
              const r = radiusFor(d.count, view.k);
              const x = view.applyX(d.x) + r * 0.72;
              const y = view.applyY(d.y) - r * 0.72;
              if (x < -10 || y < -10 || x > w + 10 || y > h + 10) return null;
              return (
                <g key={`rank-${hub.place.key}`} transform={`translate(${x},${y})`} style={{ pointerEvents: 'none' }}>
                  <circle r={8} style={{ fill: 'var(--sd-accent, #3498db)', stroke: 'var(--sd-bg, #0a0a1a)' }} strokeWidth={1.5} />
                  <text textAnchor="middle" dy="0.35em" fontSize={9.5} fontWeight={800} style={{ fill: 'var(--sd-bg, #0a0a1a)' }}>{i + 1}</text>
                </g>
              );
            })}
            {/* Where the lines come from: the connection whose reach this is, or the connections who get you to the place. */}
            {reachFrom && (
              <g transform={`translate(${view.applyX(reachFrom[0])},${view.applyY(reachFrom[1])})`} style={{ pointerEvents: 'none' }}>
                <circle r={radiusFor(dotByKey.get(reach.from.key)?.count || 1, view.k) + 7} fill="none" style={{ stroke: 'var(--sd-accent, #3498db)' }} strokeWidth={2.5} />
                <circle r={3.5} style={{ fill: 'var(--sd-accent, #3498db)', stroke: 'var(--sd-bg, #0a0a1a)' }} strokeWidth={1.5} />
              </g>
            )}
            {picked && (getters?.starts || []).map((st) => {
              const p = projection?.([st.lon, st.lat]);
              if (!p) return null;
              return (
                <circle key={`start-${st.key}`} cx={view.applyX(p[0])} cy={view.applyY(p[1])} r={radiusFor(dotByKey.get(st.key)?.count || 1, view.k) + 4}
                  fill="none" style={{ stroke: 'var(--sd-accent, #3498db)', pointerEvents: 'none' }} strokeWidth={focus?.start === st.key ? 2.5 : 1.4} strokeDasharray="4 3" />
              );
            })}
            {labels.map((l) => (
              <text key={`label-${l.key}`} x={l.x} y={l.y} dy="0.35em" fontSize={l.strong ? 11.5 : 11} fontWeight={l.strong === 'path' ? 800 : l.strong ? 750 : 600}
                style={{ fill: l.strong === 'path' ? 'var(--sd-accent, #3498db)' : l.strong ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #cfd8d8)', ...halo }}>
                {l.text}
              </text>
            ))}
            {reachFrom && (
              <text x={view.applyX(reachFrom[0])} y={view.applyY(reachFrom[1]) - radiusFor(dotByKey.get(reach.from.key)?.count || 1, view.k) - 12} textAnchor="middle" fontSize={11.5} fontWeight={800}
                style={{ fill: 'var(--sd-accent, #3498db)', ...halo }}>
                {firstName(bridge.name)}
              </text>
            )}
            {/* The path's steps: You, then 1, 2, 3 along the chain, each with a first name. */}
            {pathMarks.map((s) => {
              const x = view.applyX(s.p[0]) + s.nth * 15;
              const y = view.applyY(s.p[1]);
              if (x < -20 || y < -20 || x > w + 20 || y > h + 20) return null;
              const last = s.person && s.person.id === selectedId;
              return (
                <g key={`step-${s.step ?? 'x'}-${s.person?.id ?? 'you'}`} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); flyTo(s.place.lon, s.place.lat, 4); }}>
                  <title>{`${s.person ? s.person.name : 'You'}: ${s.place.label}`}</title>
                  <circle r={last ? 10 : 9} style={{ fill: s.person ? 'var(--sd-accent, #3498db)' : 'var(--sd-fg-1, #fff)', stroke: 'var(--sd-bg, #0a0a1a)' }} strokeWidth={2} />
                  <text textAnchor="middle" dy="0.35em" fontSize={9.5} fontWeight={800} style={{ fill: 'var(--sd-bg, #0a0a1a)', pointerEvents: 'none' }}>{s.step == null ? '?' : s.step === 0 ? '' : s.step}</text>
                </g>
              );
            })}
          </svg>

          {/* One card: find, pick a view, read its legend, then the filters. Top left, clear of the Filters button. */}
          <div style={{ position: 'absolute', top: phone ? 52 : 10, left: phone ? 8 : 64, width: phone ? 'calc(100% - 60px)' : 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...card, padding: phone ? '7px 8px' : '10px 11px', display: 'flex', flexDirection: 'column', gap: phone ? 6 : 8 }}>
              <MapFinder index={finderIndex} phone={phone} onPerson={onPerson} onBridge={(p) => showReach(p.id)} onPlace={onPlace}
                onCompany={(name) => setFilters((f) => ({ ...f, company: name }))} onText={(text) => setFilters((f) => ({ ...f, text }))} />
              <MapSeg value={mapView} onChange={pickView} label="What the map shows" wide options={MAP_VIEWS.map((v) => [v.key, v.label, v.question])} />
              {!phone && <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', lineHeight: 1.45, marginTop: -2 }}>{viewInfo.question}</div>}
              {mapView === 'places' && <DotLegend colourBy={colourBy} setColourBy={setColourBy} phone={phone} />}
              {mapView === 'heat' && <HeatLegend heatOf={look.heatOf} setHeatOf={(heatOf) => setLook({ heatOf })} heat={heat} onDensest={onPlace} />}
              {mapView === 'flows' && (
                <FlowLegend flows={flowData} drawn={drawnFlows.length} max={look.flowMax} setMax={(flowMax) => setLook({ flowMax })} steps={flowSteps}
                  from={flowFrom} widthOf={arcWidth} />
              )}
              {mapView === 'hubs' && <HubLegend hubs={hubs} phone={phone} />}
              <Chips chips={chips} onClear={clearOne} onClearAll={clearAll} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: LINE, paddingTop: 6, marginTop: 1 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--sd-fg-4, #778)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title="People with a location the map knows, of everyone the Filters panel shows">
                  {narrowed ? `Showing ${plural(drawnPeople, 'person', 'people')} in ${plural(dots.length, 'place')}` : locatedLine(placedCount, total)}
                </span>
                <button type="button" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}
                  style={{ ...smallButton, border: 'none', padding: '2px 0', color: 'var(--sd-fg-3, #889)' }}>
                  {optionsOpen ? '▾' : '▸'} Declutter, From you{optionsSet ? ` (${optionsSet})` : ''}
                </button>
              </div>
              {optionsOpen && <MapOptions filters={filters} setFilters={setFilters} home={home} showHome={showHome} setShowHome={setShowHome} />}
            </div>
            {/* The path to whoever's card is open, under the card. */}
            {!phone && pathCard}
          </div>

          {/* Zoom: top right, clear of the Details button; a column on a phone too, beside the finder */}
          <div style={{ position: 'absolute', top: phone ? 52 : 10, right: phone ? 8 : 64, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.8)} style={roundButton}>+</button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.8)} style={roundButton}>&minus;</button>
            <button type="button" aria-label="Show the whole world" title="Show the whole world" onClick={zoomHome} style={{ ...roundButton, fontSize: 13 }}>&#8962;</button>
          </div>

          {total > 0 && placedCount === 0 && (
            <div style={{ position: 'absolute', left: '50%', top: shownH / 2, transform: 'translate(-50%, -50%)', ...card, padding: '14px 18px', maxWidth: 340, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sd-fg-1, #fff)', marginBottom: 6 }}>No one on the map yet</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--sd-fg-3, #889)' }}>
                {whereAll?.none.length === total
                  ? 'Nobody here has a location yet. Scans read where each person is as they go, so the map fills in.'
                  : 'None of these locations is a place the map knows. They’re listed at the bottom left.'}
              </div>
            </div>
          )}

          {/* The path to whoever's card is open: a sheet at the bottom on a phone, when nothing else is. */}
          {phone && !(focus || (hubs && !hubsClosed)) && pathCard}

          {bridge && reach && (
            <ReachPanel bridge={bridge} reach={reach} openEnd={focus.end} onOpenEnd={(end) => setFocus({ ...focus, end })} canOutlink={!IS_DEMO}
              phone={phone} below={below} sheet={Math.round(shownH * 0.46)} selectedId={selectedId} onSelect={onSelect} onClose={() => setFocus(null)} />
          )}
          {picked && (
            <PlacePanel place={picked} getters={getters} bridgeIds={bridgeIds} onLines={showReach} canOutlink={!IS_DEMO}
              openStart={focus.start} isHome={homeKey === picked.key} onHome={() => makeHome(picked.key)} hub={hubRank.get(picked.key)}
              phone={phone} below={below} sheet={Math.round(shownH * 0.46)} selectedId={selectedId} onSelect={onSelect} onClose={() => setFocus(null)} />
          )}
          {hubs && !focus && !hubsClosed && (
            <HubPanel hubs={hubs} pickedKey={null} onPick={onPlace} phone={phone} below={below} sheet={Math.round(shownH * 0.46)} onClose={() => setHubsClosed(true)} />
          )}
          {flowPicked && (
            <FlowPanel flow={flowPicked} canOutlink={!IS_DEMO} phone={phone} below={below} sheet={Math.round(shownH * 0.46)}
              selectedId={selectedId} onSelect={onSelect} onLines={showReach} onClose={() => setFocus(null)} />
          )}
          {/* On a phone the lists take the bottom; who isn't on the map comes back when they close. */}
          {whereAll && !(phone && (focus || path || (hubs && !hubsClosed))) && <Unplaced where={whereAll} phone={phone} bottom={below + 8} />}
          {/* GeoNames' licence (CC BY 4.0) asks for this credit wherever its places show (docs/PLACES.md). */}
          {!(phone && (focus || path || (hubs && !hubsClosed))) && (
            <p data-map-credit="" style={{ position: 'absolute', right: 10, bottom: below + 6, margin: 0, fontSize: 9, color: 'var(--sd-fg-3, #888)', pointerEvents: 'none' }}>
              Places: GeoNames (CC BY 4.0) · Natural Earth
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A soft round glow in one colour, fading out from the middle. */
function Glow({ id, colour }) {
  return (
    <radialGradient id={id}>
      <stop offset="0%" style={{ stopColor: colour, stopOpacity: 0.5 }} />
      <stop offset="55%" style={{ stopColor: colour, stopOpacity: 0.14 }} />
      <stop offset="100%" style={{ stopColor: colour, stopOpacity: 0 }} />
    </radialGradient>
  );
}

/** A dot as a pie of its mix: [[colour, count]], clockwise from twelve. One colour is a plain circle. */
function Pie({ r, parts }) {
  const total = parts.reduce((s, [, n]) => s + n, 0);
  if (parts.length <= 1 || !total) return <circle r={r} style={{ fill: parts[0]?.[0] || 'transparent' }} fillOpacity={0.88} />;
  const slices = [];
  let at = -Math.PI / 2;
  for (const [colour, n] of parts) {
    const a = (n / total) * Math.PI * 2;
    const from = [r * Math.cos(at), r * Math.sin(at)];
    at += a;
    slices.push({ colour, d: `M0,0L${from[0]},${from[1]}A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${r * Math.cos(at)},${r * Math.sin(at)}Z` });
  }
  return slices.map((sl, i) => <path key={i} d={sl.d} style={{ fill: sl.colour }} fillOpacity={0.88} />);
}

function Centered({ children }) {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>{children}</div>;
}

/**
 * Who's at one place: who gets you there (the connections who reach the
 * 2nd-degree people in it), then everyone, strongest first; a click opens
 * their card, and a connection with a circle has its own reach. In Hubs, its
 * rank and reach.
 */
function PlacePanel({ place, getters, bridgeIds, onLines, canOutlink, openStart, isHome, onHome, hub = null, phone, below = 0, sheet = 320, selectedId, onSelect, onClose }) {
  const people = useMemo(() => [...place.people].sort(byStrength), [place]);
  const shown = people.slice(0, 300);
  const reachLine = hub ? ` · #${hub.rank} by reach: ${fmt(hub.reach)}, ${fmt(hub.through)} more through ${plural(hub.bridges, 'connection')} here` : '';
  return (
    <SidePanel label={`People in ${place.label}`} title={place.label} phone={phone} below={below} sheet={sheet} onClose={onClose}
      subtitle={`${plural(place.count, 'person', 'people')}${place.approx ? ` · placed at the ${place.kind === 'country' ? 'country' : 'region'}’s middle` : ''}${reachLine}`}
      actions={(
        <button type="button" aria-pressed={isHome} onClick={onHome} style={smallButton} title="From you, and the path to someone, start from home">
          {isHome ? 'Home ✓' : 'Make this home'}
        </button>
      )}>
      <GettersList getters={getters} here={place.name} canOutlink={canOutlink} selectedId={selectedId} onSelect={onSelect} onLines={onLines} openStart={openStart} />
      {shown.map((p) => (
        <PersonRow key={p.id} p={p} selectedId={selectedId} onSelect={onSelect}
          extra={bridgeIds.has(p.id) ? (
            <button type="button" onClick={() => onLines(p.id)} style={{ ...smallButton, marginRight: 4 }} title={`Lines from here to everywhere ${p.name}’s circle lives`}>Reach</button>
          ) : null} />
      ))}
      {people.length > shown.length && (
        <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', padding: '6px 8px' }}>and {plural(people.length - shown.length, 'other')}; the Filters panel narrows it</div>
      )}
    </SidePanel>
  );
}

/** Who isn't on the map, and why: no location yet, or one the map doesn't know. */
function Unplaced({ where, phone, bottom }) {
  const [open, setOpen] = useState(false);
  const unknown = where.unmatched.reduce((n, u) => n + u.count, 0);
  const rough = where.rough.reduce((n, u) => n + u.count, 0);
  if (!where.none.length && !unknown && !rough) return null;
  const list = (rows) => (
    <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 140, overflowY: 'auto' }}>
      {rows.map((u) => (
        <li key={u.text} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0', color: 'var(--sd-fg-3, #99a)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.text}>{u.text}</span>
          <span style={{ color: 'var(--sd-fg-4, #778)', fontVariantNumeric: 'tabular-nums' }}>{fmt(u.count)}</span>
        </li>
      ))}
    </ul>
  );
  const sub = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--sd-fg-5, #556)', marginTop: 8 };
  return (
    <section aria-label="Not on the map" style={{
      position: 'absolute', left: 8, ...card, padding: '8px 10px', width: phone ? 'auto' : 300, right: phone ? 8 : undefined,
      bottom,
    }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}>
        <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.45, color: 'var(--sd-fg-2, #cfd8d8)' }}>
          {where.none.length > 0 && <>{plural(where.none.length, 'person has', 'people have')} no location yet; scans fill it in.</>}
          {unknown > 0 && <>{where.none.length > 0 ? ' ' : ''}{unknown === 1 ? '1 person’s location isn’t' : `${fmt(unknown)} people’s locations aren’t`} recognised.</>}
          {rough > 0 && <>{where.none.length > 0 || unknown > 0 ? ' ' : ''}{fmt(rough)} placed by region or country only.</>}
        </span>
        {(unknown > 0 || rough > 0) && <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)' }}>{open ? '▾' : '▸'}</span>}
      </button>
      {open && unknown > 0 && (<><div style={sub}>Not recognised, never guessed</div>{list(where.unmatched)}</>)}
      {open && rough > 0 && (<><div style={sub}>A city the map doesn&rsquo;t know, at its region or country</div>{list(where.rough)}</>)}
    </section>
  );
}
