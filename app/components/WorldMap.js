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
// All offline: the world is Natural Earth's 1:110m countries and the places a
// gazetteer, both in public/geo, built by scripts/build-places.mjs. No map
// tiles, nothing fetched from anywhere but this app (lib/places.js).

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath, select, zoom as d3zoom, zoomIdentity } from 'd3';
import { makeGazetteer, placePeople, bestTier, mixOf } from '../../lib/places';
import { TIER_COLORS } from '../../lib/themes';
import { DEGREE_COLOURS } from '../../lib/galaxy-lab';
import { score } from '../../lib/separation';
import { localPhoto } from '../../lib/photos';
import { useSize, Seg } from './PathsAnalyzer';

const TIERS = ['S', 'A', 'B', 'C', 'D'];
const DEGREE_NAMES = { 1: '1st', 2: '2nd', 3: '3rd' };
const LINE = '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)';
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
// The look's tier colours as CSS variables, so a change of look redraws the dots
// at once; TIER_COLORS (the live object) as the fallback.
const tierFill = (t) => `var(--sd-tier-${t.toLowerCase()}, ${TIER_COLORS[t] || '#bdc3c7'})`;
const degreeFill = (d) => DEGREE_COLOURS[Math.min(d, 3)] || DEGREE_COLOURS[3];

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

/** A dot's radius on screen: grows with the square root of its people, and a little as you zoom in. */
const radiusFor = (count, k) => Math.min(30, 3.2 + Math.sqrt(count) * 2.1) * Math.min(1.8, Math.pow(k, 0.22));

const card = {
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
  borderRadius: 12, color: 'var(--sd-fg-2, #cfd8d8)', boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
};
const roundButton = {
  width: 32, height: 32, borderRadius: 8, border: LINE, cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)', fontFamily: 'inherit',
};

export default function WorldMap({ connections = [], onSelect, selectedId = null }) {
  const [geo, setGeo] = useState(null);
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let live = true;
    loadGeo().then((g) => { if (live) setGeo(g); }).catch((e) => { if (live) setFailed(e.message || 'The map could not load.'); });
    return () => { live = false; };
  }, []);

  const phone = useIsPhone();
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const { w, h } = useSize(wrapRef);
  const [colourBy, setColourBy] = useState('tier');
  const [pickedKey, setPickedKey] = useState(null);
  const [view, setView] = useState(zoomIdentity);

  // Everyone the filters show, by place (lib/places.js).
  const where = useMemo(() => (geo ? placePeople(geo.gaz, connections) : null), [geo, connections]);

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
  const busiest = where?.places[0];
  const focusAt = busiest ? `${busiest.lon},${busiest.lat}` : '';

  // The world, fitted to the window. On a phone, to the height between the
  // controls and the bottom panel, wider than the screen, to pan across.
  const pad = phone ? 8 : 20;
  const fitted = useMemo(() => {
    if (!geo || !w || !shownH) return null;
    const top = phone ? 112 : pad;
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
    if (!projection || !where) return [];
    return where.places.map((p) => {
      const [x, y] = projection([p.lon, p.lat]) || [NaN, NaN];
      return { ...p, x, y, best: bestTier(p.people), tiers: mixOf(p.people, 'tier'), degrees: mixOf(p.people, 'degree') };
    }).filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  }, [projection, where]);

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
  const zoomBy = (factor) => { if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor); };
  const zoomHome = () => { if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, zoomIdentity); };

  // The place open in the panel; one the filters have emptied simply isn't.
  const picked = useMemo(() => dots.find((d) => d.key === pickedKey) || null, [dots, pickedKey]);

  // Names for the biggest places in view, never on top of each other.
  const labels = useMemo(() => {
    const out = [];
    const boxes = [];
    const room = Math.round(5 + 5 * view.k);
    for (const d of dots) {
      if (out.length >= room) break;
      const x = view.applyX(d.x);
      const y = view.applyY(d.y);
      if (x < 0 || y < 0 || x > w || y > shownH) continue;
      const r = radiusFor(d.count, view.k);
      const text = d.name;
      const box = { x0: x + r + 3, y0: y - 7, x1: x + r + 5 + text.length * 6.2, y1: y + 7 };
      if (boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue;
      boxes.push(box);
      out.push({ key: d.key, x: box.x0, y, text });
    }
    return out;
  }, [dots, view, w, shownH]);

  const slices = (d) => (colourBy === 'tier' ? d.tiers.map(([t, n]) => [tierFill(t), n]) : d.degrees.map(([g, n]) => [degreeFill(g), n]));
  const total = connections.length;
  const placedCount = where?.placed || 0;

  return (
    <div ref={wrapRef} data-world-map style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'var(--sd-page)' }}>
      {failed ? (
        <Centered><div style={{ fontSize: 14, color: 'var(--sd-fg-3, #889)' }}>{failed}</div></Centered>
      ) : !geo ? (
        <Centered><div style={{ fontSize: 13, color: 'var(--sd-fg-4, #778)' }}>Drawing the map&hellip;</div></Centered>
      ) : (
        <>
          <svg ref={svgRef} width={w} height={h} role="img" aria-label={`World map: ${plural(placedCount, 'person', 'people')} in ${plural(dots.length, 'place')}`}
            style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}>
            <rect width={w} height={h} fill="transparent" onClick={() => setPickedKey(null)} />
            <g transform={view.toString()}>
              {land.map((c) => (
                <path key={c.key} d={c.d} fill="rgba(var(--sd-ink, 255, 255, 255), 0.07)"
                  stroke="rgba(var(--sd-ink, 255, 255, 255), 0.18)" strokeWidth={0.6} vectorEffect="non-scaling-stroke"
                  style={{ fill: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', stroke: 'rgba(var(--sd-ink, 255, 255, 255), 0.18)' }}
                  onClick={() => setPickedKey(null)} />
              ))}
            </g>
            {dots.map((d) => {
              const x = view.applyX(d.x);
              const y = view.applyY(d.y);
              const r = radiusFor(d.count, view.k);
              if (x < -r || y < -r || x > w + r || y > h + r) return null;
              const on = d.key === pickedKey;
              return (
                <g key={d.key} className="sd-map-dot" transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}
                  role="button" tabIndex={0} aria-pressed={on}
                  aria-label={`${d.label}: ${plural(d.count, 'person', 'people')}, strongest tier ${d.best}${d.approx ? ', placed at its middle' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setPickedKey(on ? null : d.key); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickedKey(on ? null : d.key); } }}>
                  <title>{`${d.label}: ${plural(d.count, 'person', 'people')} (${(colourBy === 'tier' ? d.tiers.map(([t, n]) => `${n} ${t}`) : d.degrees.map(([g, n]) => `${n} ${DEGREE_NAMES[g]}`)).join(', ')})${d.approx ? ', approximate: placed at its middle' : ''}`}</title>
                  <circle className="sd-map-focus" r={r + 5} fill="none" style={{ stroke: 'var(--sd-accent, #3498db)' }} strokeWidth={2} />
                  {on && <circle r={r + 5} fill="none" style={{ stroke: 'var(--sd-fg-1, #fff)' }} strokeWidth={2} />}
                  <Pie r={r} parts={slices(d)} />
                  <circle r={r} fill="none" style={{ stroke: d.approx ? 'var(--sd-fg-2, #cfd8d8)' : 'var(--sd-bg, #0a0a1a)' }} strokeWidth={d.approx ? 1.3 : 1.2}
                    strokeDasharray={d.approx ? '3 2' : undefined} />
                  {r >= 11 && (
                    <text textAnchor="middle" dy="0.35em" fontSize={r >= 18 ? 11 : 9.5} fontWeight={800}
                      style={{ fill: '#fff', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.5, paintOrder: 'stroke', strokeLinejoin: 'round', pointerEvents: 'none' }}>{d.count > 999 ? `${Math.round(d.count / 100) / 10}k` : d.count}</text>
                  )}
                </g>
              );
            })}
            {labels.map((l) => (
              <text key={`label-${l.key}`} x={l.x} y={l.y} dy="0.35em" fontSize={11} fontWeight={600}
                style={{ fill: 'var(--sd-fg-2, #cfd8d8)', pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--sd-bg, #0a0a1a)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                {l.text}
              </text>
            ))}
          </svg>

          {/* Colour, the legend, and how many are on the map: top left, clear of the Filters button */}
          <div style={{ position: 'absolute', top: phone ? 52 : 10, left: phone ? 8 : 64, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: phone ? 'calc(100% - 64px)' : 340 }}>
            <div style={{ ...card, padding: phone ? '6px 8px' : '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Seg value={colourBy} onChange={setColourBy} options={[['tier', 'Tier'], ['degree', 'Degree']]} />
                {!phone && <span style={{ fontSize: 11, color: 'var(--sd-fg-3, #889)' }}>{plural(placedCount, 'person', 'people')} in {plural(dots.length, 'place')}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: phone ? 6 : 9, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--sd-fg-3, #889)' }}>
                {(colourBy === 'tier' ? TIERS.map((t) => [t, tierFill(t)]) : [1, 2, 3].map((d) => [DEGREE_NAMES[d], degreeFill(d)])).map(([name, colour]) => (
                  <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: colour, display: 'inline-block' }} />{name}
                  </span>
                ))}
              </div>
              {!phone && (
                <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)', lineHeight: 1.4 }}>
                  {colourBy === 'tier' ? 'Each dot is the mix of tiers there.' : 'Each dot is the mix of degrees there.'} A dashed ring is a region or a country, placed at its middle.
                </div>
              )}
            </div>
          </div>

          {/* Zoom: top right, clear of the Details button */}
          <div style={{ position: 'absolute', top: phone ? 52 : 10, right: phone ? 8 : 64, display: 'flex', flexDirection: phone ? 'row' : 'column', gap: 4 }}>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.8)} style={roundButton}>+</button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.8)} style={roundButton}>&minus;</button>
            <button type="button" aria-label="Show the whole world" title="Show the whole world" onClick={zoomHome} style={{ ...roundButton, fontSize: 13 }}>&#8962;</button>
          </div>

          {total > 0 && placedCount === 0 && (
            <div style={{ position: 'absolute', left: '50%', top: shownH / 2, transform: 'translate(-50%, -50%)', ...card, padding: '14px 18px', maxWidth: 340, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sd-fg-1, #fff)', marginBottom: 6 }}>No one on the map yet</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--sd-fg-3, #889)' }}>
                {where?.none.length === total
                  ? 'Nobody here has a location yet. Scans read where each person is as they go, so the map fills in.'
                  : 'None of these locations is a place the map knows. They’re listed at the bottom left.'}
              </div>
            </div>
          )}

          {picked && <PlacePanel place={picked} phone={phone} below={below} sheet={Math.round(shownH * 0.46)} selectedId={selectedId} onSelect={onSelect} onClose={() => setPickedKey(null)} />}
          {/* On a phone the place's list takes the bottom; who isn't on the map comes back when it closes. */}
          {where && !(phone && picked) && <Unplaced where={where} phone={phone} bottom={below + 8} />}
          {/* GeoNames' licence (CC BY 4.0) asks for this credit wherever its places show (docs/PLACES.md). */}
          {!(phone && picked) && (
            <p data-map-credit="" style={{ position: 'absolute', right: 10, bottom: below + 6, margin: 0, fontSize: 9, color: 'var(--sd-fg-3, #888)', pointerEvents: 'none' }}>
              Places: GeoNames (CC BY 4.0) · Natural Earth
            </p>
          )}
        </>
      )}
    </div>
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

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

/** Who's at one place: name, title, tier and degree; a click opens their card. */
function PlacePanel({ place, phone, below = 0, sheet = 320, selectedId, onSelect, onClose }) {
  const people = useMemo(() => [...place.people].sort((a, b) => (TIER_RANK[a.tier] ?? 4) - (TIER_RANK[b.tier] ?? 4)
    || (Number(a.degree) || 1) - (Number(b.degree) || 1) || score(b) - score(a)), [place]);
  const shown = people.slice(0, 300);
  return (
    <section aria-label={`People in ${place.label}`} style={{
      position: 'absolute', ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...(phone ? { left: 8, right: 8, bottom: below + 8, maxHeight: sheet } : { top: 120, right: 64, width: 300, maxHeight: `calc(100% - ${140 + below}px)` }),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderBottom: LINE }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>{place.label}</div>
          <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', marginTop: 2 }}>
            {plural(place.count, 'person', 'people')}{place.approx ? ` · placed at the ${place.kind === 'country' ? 'country' : 'region'}’s middle` : ''}
          </div>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--sd-fg-3, #889)', padding: 2 }}>&times;</button>
      </div>
      <div style={{ overflowY: 'auto', padding: 4 }}>
        {shown.map((p) => {
          const t = TIERS.includes(p.tier) ? p.tier : 'D';
          const photo = localPhoto(p.profile_image_url);
          const on = p.id === selectedId;
          return (
            <button key={p.id} type="button" onClick={() => onSelect?.(p)} aria-current={on ? 'true' : undefined} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 'none', borderRadius: 8,
              background: on ? 'rgba(52,152,219,0.16)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'rgba(var(--sd-ink, 255, 255, 255), 0.05)'; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
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
          );
        })}
        {people.length > shown.length && (
          <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)', padding: '6px 8px' }}>and {plural(people.length - shown.length, 'other')}; the Filters panel narrows it</div>
        )}
      </div>
    </section>
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
          {unknown > 0 && <>{where.none.length > 0 ? ' ' : ''}{unknown === 1 ? '1 person\u2019s location isn\u2019t' : `${fmt(unknown)} people\u2019s locations aren\u2019t`} recognised.</>}
          {rough > 0 && <>{where.none.length > 0 || unknown > 0 ? ' ' : ''}{fmt(rough)} placed by region or country only.</>}
        </span>
        {(unknown > 0 || rough > 0) && <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--sd-fg-4, #778)' }}>{open ? '▾' : '▸'}</span>}
      </button>
      {open && unknown > 0 && (<><div style={sub}>Not recognised, never guessed</div>{list(where.unmatched)}</>)}
      {open && rough > 0 && (<><div style={sub}>A city the map doesn&rsquo;t know, at its region or country</div>{list(where.rough)}</>)}
    </section>
  );
}
