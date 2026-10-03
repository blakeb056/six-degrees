'use client';

// Paths: your network by company and industry — in the spirit of LinkedIn's
// InMaps (2011–2014), the network map LinkedIn used to give people and then
// retired. Companies are bubbles, coloured by industry and sized by how many
// of your people are there; a line joins two companies when one of your
// connections at the first knows people at the second. Click a company or an
// industry to analyse it: who you know there, who you can reach, the warmest
// way in, and what it connects to.
//
// Industry is inferred from company names and headlines (lib/companies.js) and
// says so. The layout is computed once per filter change and drawn as plain
// SVG — no running simulation, nothing appended to <body> (TRAPS §29).

import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3';
import { useCompanyScores, ScorePicker } from './CompanyScores';
import PeopleMap from './PeopleMap';
import { TierGrid } from './FilterPanel';
import { MapLook, useLivePhysics, HeatDefs, HeatGlow, PHYSICS_OFF } from './MapControls';
import { makeGrid, shows, gridCounts } from '../../lib/tier-grid';
import { heatBy, heatColour } from '../../lib/galaxy-lab';
import { companyStrength } from '../../lib/map-heat';
import {
  buildCompanyIndex, companyLinks, companyOf, getSeniority, industryOf, industryByKey,
  INDUSTRIES, UNKNOWN_INDUSTRY, waysInto, isSenior,
} from '../../lib/companies';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';

const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
const LINE = '1px solid rgba(255,255,255,0.1)';
const MAX_BUBBLES = 140;
const ALL_INDUSTRIES = [...INDUSTRIES, UNKNOWN_INDUSTRY];

export function jitter(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: LINE }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: '5px 10px', fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer',
          background: value === v ? 'rgba(52,152,219,0.25)' : 'transparent', color: value === v ? '#cfe6f7' : '#8b9a9a',
        }}>{label}</button>
      ))}
    </div>
  );
}

export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (p.w === Math.round(r.width) && p.h === Math.round(r.height) ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The left panel, as on the map page (app/components/FilterPanel.js): a
 * Filters tab at the edge until opened, then a column the map makes room for.
 * Paths' filters, and the ways to read the map, live here (Blake, 2026-10-02:
 * "incorporate the filter with maybe ways to read the data more").
 */
export function SidePanel({ open, onToggle, children }) {
  if (!open) {
    return (
      <button type="button" onClick={onToggle} style={{
        position: 'fixed', left: 16, top: 140, zIndex: 30, cursor: 'pointer', height: 36, borderRadius: 18, padding: '0 14px 0 10px',
        display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(52,152,219,0.15)', border: '2px solid rgba(52,152,219,0.5)',
        color: '#3498DB', fontWeight: 700, boxShadow: '0 0 12px rgba(52,152,219,0.3)', backdropFilter: 'blur(8px)',
      }}>
        <span style={{ fontSize: 18 }}>›</span><span style={{ fontSize: 11, fontWeight: 600 }}>Filters</span>
      </button>
    );
  }
  return (
    <aside style={{
      width: 300, flexShrink: 0, height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '16px 14px',
      borderRight: '1px solid rgba(52,152,219,0.15)', background: 'var(--sd-panel)', fontSize: 13,
    }}>
      <button type="button" onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginBottom: 14, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', fontSize: 12, fontWeight: 600,
      }}><span style={{ fontSize: 16 }}>›</span> Close</button>
      {children}
    </aside>
  );
}

export const panelHeading = { fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, margin: '14px 0 6px', textTransform: 'uppercase' };

/** Does this person pass the filters? Tier and degree from the grid, as in Network Circle. */
function passes(p, f) {
  if (f.grid && !shows(f.grid, p.tier, Number(p.degree) || 1)) return false;
  if (f.seniority === 'senior' && !isSenior(p.headline)) return false;
  if (f.seniority === 'csuite' && getSeniority(p.headline).level < 6) return false;
  return true;
}

/** What the map's bubbles are: companies, or your connections (Paths → People). An easy switch at the top of the panel. */
function ShowSwitch({ show, onShow }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...panelHeading, marginTop: 0 }}>Bubbles are</div>
      <Seg value={show} onChange={onShow} options={[['companies', 'Companies'], ['people', 'People']]} />
    </div>
  );
}

export default function PathsAnalyzer({ d1 = [], d2 = [], d3 = [], initialShow = 'companies', onOpenCompany }) {
  const [show, setShow] = useState(initialShow);
  const [filters, setFilters] = useState(() => ({ seniority: 'all', grid: makeGrid([1, 2, 3]) }));
  const [colourBy, setColourBy] = useState('sector');
  const [physics, setPhysics] = useState(PHYSICS_OFF);
  const [hidden, setHidden] = useState(() => new Set());       // industries toggled off
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(null);                   // { kind: 'company'|'industry', key }
  const [panelOpen, setPanelOpen] = useState(true);
  // Ways to read the map: what a bubble's size means, and which names show.
  const [sizeBy, setSizeBy] = useState('people');            // 'people' | 'sa' | 'known'
  const [labels, setLabels] = useState('top');               // 'top' | 'all' | 'none'

  const rows = useMemo(() => [...d1, ...d2, ...d3], [d1, d2, d3]);
  const counts = useMemo(() => gridCounts({ 1: d1, 2: d2, 3: d3 }), [d1, d2, d3]);
  const index = useMemo(() => buildCompanyIndex(rows), [rows]);
  const links = useMemo(() => companyLinks(d1, d2), [d1, d2]);

  // Companies with their filtered people.
  const companies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const co of index.values()) {
      if (hidden.has(co.industry.key)) continue;
      if (q && !co.name.toLowerCase().includes(q)) continue;
      const people = co.people.filter((p) => passes(p, filters));
      if (!people.length) continue;
      out.push({ ...co, shown: people });
    }
    return out.sort((a, b) => b.shown.length - a.shown.length);
  }, [index, filters, hidden, query]);

  // Everyone, by inferred industry — people with no company still have a headline.
  const industries = useMemo(() => {
    const byKey = new Map(ALL_INDUSTRIES.map((i) => [i.key, { ...i, people: [], companies: new Map() }]));
    const seen = new Set();
    for (const r of rows) {
      const k = r.profile_url || `id:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!passes(r, filters)) continue;
      const co = companyOf(r);
      const ind = co ? (index.get(co)?.industry || industryOf(co, r.headline)) : industryOf(null, r.headline);
      const bucket = byKey.get(ind.key);
      bucket.people.push(r);
      if (co) bucket.companies.set(co, (bucket.companies.get(co) || 0) + 1);
    }
    return [...byKey.values()].filter((i) => i.people.length).sort((a, b) => b.people.length - a.people.length);
  }, [rows, index, filters]);

  const panel = focus?.kind === 'company' ? index.get(focus.key)
    : focus?.kind === 'industry' ? industries.find((i) => i.key === focus.key) : null;

  const look = (heatHint) => (
    <MapLook colourBy={colourBy} onColourBy={setColourBy} physics={physics} onPhysics={setPhysics} heatHint={heatHint} />
  );

  // People: the same map with your connections as the bubbles (app/components/PeopleMap.js),
  // with the same switch, colours and physics.
  if (show === 'people') {
    return (
      <PeopleMap d1={d1} d2={d2} top={<ShowSwitch show={show} onShow={setShow} />}
        colourBy={colourBy} physics={physics}
        look={look('How strong each cluster is, person for person (S counts 3, A 2, the rest 1): the hotter, the stronger. Size is still how big it is.')} />
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <SidePanel open={panelOpen} onToggle={() => setPanelOpen((o) => !o)}>
        <ShowSwitch show={show} onShow={setShow} />
        <Filters filters={filters} setFilters={setFilters} counts={counts} query={query} setQuery={setQuery}
          industries={industries} hidden={hidden} setHidden={setHidden}
          onIndustry={(key) => setFocus({ kind: 'industry', key })} />
        <div style={panelHeading}>Read the map</div>
        <div style={{ fontSize: 11, color: '#8b9a9a', marginBottom: 4 }}>Bubble size</div>
        <Seg value={sizeBy} onChange={setSizeBy} options={[['people', 'Your people'], ['sa', 'S & A there'], ['known', 'You know']]} />
        <div style={{ fontSize: 11, color: '#8b9a9a', margin: '10px 0 4px' }}>Names</div>
        <Seg value={labels} onChange={setLabels} options={[['top', 'Biggest'], ['all', 'All'], ['none', 'None']]} />
        {look('How strong your people at each company are: the average power score of the five strongest. The hotter, the stronger; size is still how many.')}
      </SidePanel>
      {/* Room at the top for the notch's Map / Companies, so it never covers a label */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingTop: 40, boxSizing: 'border-box' }}>
        <CompanyMap companies={companies} links={links} focus={focus} sizeBy={sizeBy} labels={labels}
          colourBy={colourBy} physics={physics}
          onCompany={(name) => setFocus({ kind: 'company', key: name })}
          onIndustry={(key) => setFocus({ kind: 'industry', key })}
          onClear={() => setFocus(null)} />
      </div>
      {panel && (
        <AnalyzerPanel focus={focus} data={panel} index={index} links={links} d1={d1} d2={d2}
          filters={filters} onClose={() => setFocus(null)}
          onCompany={(name) => setFocus({ kind: 'company', key: name })}
          onIndustry={(key) => setFocus({ kind: 'industry', key })}
          onOpenCompany={onOpenCompany} />
      )}
    </div>
  );
}

function Filters({ filters, setFilters, counts, query, setQuery, industries, hidden, setHidden, onIndustry }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={panelHeading}>Filter</div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a company"
        style={{ padding: '6px 10px', borderRadius: 7, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
      {/* The same tiers × degrees as Network Circle (Blake, 2026-10-02) */}
      <TierGrid grid={filters.grid} counts={counts} onChange={(g) => set('grid', g)} mode="paths" />
      <div style={{ fontSize: 11, color: '#8b9a9a', marginTop: -10 }}>Level</div>
      <Seg value={filters.seniority} onChange={(v) => set('seniority', v)} options={[['all', 'Any level'], ['senior', 'Director+'], ['csuite', 'C-suite']]} />
      <div style={panelHeading}>Industries</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {industries.map((i) => {
          const off = hidden.has(i.key);
          return (
            <span key={i.key} style={{ display: 'inline-flex', borderRadius: 14, border: `1px solid ${i.color}55`, overflow: 'hidden', opacity: off ? 0.4 : 1 }}>
              <button title={off ? 'Show on the map' : 'Hide from the map'}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })}
                style={{ padding: '3px 7px', border: 'none', background: `${i.color}22`, cursor: 'pointer', color: i.color, fontSize: 11 }}>●</button>
              <button onClick={() => onIndustry(i.key)} title="Analyse this industry"
                style={{ padding: '3px 9px 3px 5px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#cfd8d8', fontSize: 11.5 }}>
                {i.label} <span style={{ color: '#778' }}>{i.people.length}</span>
              </button>
            </span>
          );
        })}
        <span style={{ fontSize: 11, color: '#667', alignSelf: 'center' }}>Inferred from companies and headlines. ● hides one; its name opens it.</span>
      </div>
    </div>
  );
}

function CompanyMap({ companies, links, focus, onCompany, onIndustry, onClear, sizeBy = 'people', labels: names = 'top', colourBy = 'sector', physics = PHYSICS_OFF }) {
  const wrap = useRef(null);
  const { w, h } = useSize(wrap);
  const [hover, setHover] = useState(null);

  // Lay out once per filter change: industries on a ring, each company pulled
  // to its industry and to the companies it's linked with, then frozen.
  const layout = useMemo(() => {
    const shown = companies.slice(0, MAX_BUBBLES);
    const names = new Set(shown.map((c) => c.name));
    const indKeys = [...new Set(shown.map((c) => c.industry.key))];
    const R = 260;
    const anchor = new Map(indKeys.map((k, i) => {
      const a = (i / Math.max(1, indKeys.length)) * Math.PI * 2 - Math.PI / 2;
      return [k, { x: Math.cos(a) * R, y: Math.sin(a) * R }];
    }));
    const nodes = shown.map((c) => ({
      id: c.name, co: c,
      // Size: your people there, the S and A among them, or the ones you already know.
      r: 4 + Math.sqrt(sizeBy === 'sa' ? c.shown.filter((p) => p.tier === 'S' || p.tier === 'A').length : sizeBy === 'known' ? c.d1 : c.shown.length) * (sizeBy === 'people' ? 3.4 : 5),
      // A fixed jitter from the name, so the same network always lays out the same.
      x: anchor.get(c.industry.key).x + (jitter(c.name) - 0.5) * 40, y: anchor.get(c.industry.key).y + (jitter(c.name + '#') - 0.5) * 40,
      // Where its industry sits, for live physics (MapControls.js).
      ax: anchor.get(c.industry.key).x, ay: anchor.get(c.industry.key).y,
    }));
    const edges = links.filter((l) => names.has(l.a) && names.has(l.b))
      .map((l) => ({ source: l.a, target: l.b, weight: l.weight, via: l.via.size, k: Math.min(0.25, 0.03 * l.weight) }));
    const sim = forceSimulation(nodes)
      .force('x', forceX((d) => anchor.get(d.co.industry.key).x).strength(0.12))
      .force('y', forceY((d) => anchor.get(d.co.industry.key).y).strength(0.12))
      .force('collide', forceCollide((d) => d.r + 3))
      .force('charge', forceManyBody().strength(-25))
      .force('link', forceLink(edges).id((d) => d.id).strength((e) => e.k).distance(60))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    const xs = nodes.flatMap((n) => [n.x - n.r, n.x + n.r]);
    const ys = nodes.flatMap((n) => [n.y - n.r, n.y + n.r]);
    const box = nodes.length
      ? { x: Math.min(...xs) - 60, y: Math.min(...ys) - 40, w: Math.max(...xs) - Math.min(...xs) + 120, h: Math.max(...ys) - Math.min(...ys) + 80 }
      : { x: -300, y: -300, w: 600, h: 600 };
    // Each label sits just outside its own cluster, on the side facing away
    // from the centre, so labels never pile up in the middle.
    const labels = indKeys.map((k) => {
      const ns = nodes.filter((n) => n.co.industry.key === k);
      const cx = ns.reduce((sum, n) => sum + n.x, 0) / ns.length;
      const cy = ns.reduce((sum, n) => sum + n.y, 0) / ns.length;
      const len = Math.hypot(cx, cy) || 1;
      const ux = cx / len, uy = cy / len;
      const reach = Math.max(...ns.map((n) => (n.x - cx) * ux + (n.y - cy) * uy + n.r));
      return { key: k, x: cx + ux * (reach + 16), y: cy + uy * (reach + 16) + 4, anchor: ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle', ind: industryByKey(k) };
    });
    for (const l of labels) {
      const wText = l.ind.label.length * 7.5;
      const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - wText : l.x - wText / 2;
      const right = Math.max(box.x + box.w, x0 + wText + 10);
      box.x = Math.min(box.x, x0 - 10); box.w = right - box.x;
      const bottom = Math.max(box.y + box.h, l.y + 12);
      box.y = Math.min(box.y, l.y - 18); box.h = bottom - box.y;
    }
    // Room at the foot for the legend drawn over the bottom-left corner, so a
    // cluster's label never lands on it.
    box.h += Math.max(60, box.h * 0.1);
    return { nodes, edges, box, labels, cut: Math.max(0, companies.length - shown.length) };
  }, [companies, links, sizeBy]);
  const { drag, clicked } = useLivePhysics(layout, physics);
  // Heat: how strong your people at each company are, ranked among the bubbles shown.
  const heat = useMemo(() => {
    const strength = new Map(layout.nodes.map((n) => [n.id, companyStrength(n.co.shown)]));
    return heatBy(layout.nodes, (n) => strength.get(n.id));
  }, [layout]);
  const hot = colourBy === 'heat';

  const active = hover || (focus?.kind === 'company' ? focus.key : null);
  const activeInd = focus?.kind === 'industry' ? focus.key : null;
  const neighbours = useMemo(() => {
    if (!active) return null;
    const s = new Set([active]);
    for (const e of layout.edges) {
      if (e.source.id === active) s.add(e.target.id);
      if (e.target.id === active) s.add(e.source.id);
    }
    return s;
  }, [active, layout]);
  const labelled = useMemo(() => new Set(names === 'none' ? [] : (names === 'all' ? layout.nodes : [...layout.nodes].sort((a, b) => b.r - a.r).slice(0, 28)).map((n) => n.id)), [layout, names]);

  return (
    <div ref={wrap} style={{ flex: 1, minHeight: 360, position: 'relative' }} onClick={onClear}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`${layout.box.x} ${layout.box.y} ${layout.box.w} ${layout.box.h}`} style={{ display: 'block', touchAction: drag ? 'none' : undefined }}>
          {hot && <HeatDefs id="coheat" />}
          {hot && <HeatGlow id="coheat" nodes={layout.nodes} heat={heat} />}
          <g>
            {layout.edges.map((e, i) => {
              const on = active && (e.source.id === active || e.target.id === active);
              return (
                <line key={i} x1={e.source.x} y1={e.source.y} x2={e.target.x} y2={e.target.y}
                  stroke={on ? '#FF6B35' : '#8fa6c0'} strokeOpacity={on ? 0.8 : active ? 0.04 : 0.14}
                  strokeWidth={on ? 1 + Math.log2(1 + e.weight) : 0.4 + Math.log2(1 + e.weight) * 0.5} />
              );
            })}
          </g>
          {layout.labels.map((l) => (
            <text key={l.key} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={13} fontWeight={800}
              fill={l.ind.color} opacity={activeInd && activeInd !== l.key ? 0.25 : 0.85}
              style={{ cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); onIndustry(l.key); }}>
              {l.ind.label}
            </text>
          ))}
          {layout.nodes.map((n) => {
            const dim = (neighbours && !neighbours.has(n.id)) || (activeInd && n.co.industry.key !== activeInd);
            const sel = focus?.kind === 'company' && focus.key === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: drag ? 'grab' : 'pointer' }}
                opacity={dim ? 0.18 : 1}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onPointerDown={drag ? (ev) => drag(ev, n) : undefined}
                onClick={(ev) => { ev.stopPropagation(); if (clicked()) onCompany(n.id); }}>
                <title>{`${n.co.name} · ${n.co.industry.label} (inferred)\n${n.co.d1} you know · ${n.co.d2} reachable${n.co.d3 ? ` · ${n.co.d3} further` : ''}`}</title>
                <circle r={n.r} fill={hot ? heatColour(heat(n)) : n.co.industry.color} fillOpacity={hot ? 0.9 : 0.75}
                  stroke={sel ? '#fff' : n.co.S ? TIER.S : 'rgba(0,0,0,0.35)'} strokeWidth={sel ? 2.5 : n.co.S ? 1.5 : 0.6} />
                {/* the share you already know, as an inner disc */}
                {n.co.d1 > 0 && <circle r={n.r * Math.sqrt(n.co.d1 / Math.max(1, n.co.people.length))} fill="#fff" fillOpacity={0.35} />}
                {(labelled.has(n.id) || n.id === active || sel) && (
                  <text y={n.r + 11} textAnchor="middle" fontSize={10} fill="#e6edf0" style={{ pointerEvents: 'none' }}>{n.co.name}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11, color: '#778', lineHeight: 1.6, pointerEvents: 'none' }}>
        Bubble = a company, sized by your people there; {hot ? 'colour = how strong they are, cold to white hot' : 'colour = its industry'}; white centre = the share you already know; gold ring = an S-tier person inside.<br />
        A line = one of your connections at one company knows people at the other.
        {layout.cut ? ` Showing the ${MAX_BUBBLES} largest; ${layout.cut} smaller companies are in Companies.` : ''}
      </div>
    </div>
  );
}

function Bar({ parts, total }) {
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
      {parts.map(([n, color], i) => <div key={i} style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: color }} />)}
    </div>
  );
}

function PersonLine({ p, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: TIER[p.tier] || '#667', flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 11, color: '#8b9a9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note || p.headline}</div>
      </div>
    </div>
  );
}

function AnalyzerPanel({ focus, data, index, links, d1, d2, filters, onClose, onCompany, onIndustry, onOpenCompany }) {
  const isCompany = focus.kind === 'company';
  const people = (isCompany ? data.people : data.people).filter((p) => passes(p, filters));
  const levels = useMemo(() => {
    const m = new Map();
    for (const p of people) {
      const s = getSeniority(p.headline);
      m.set(s.label, { n: (m.get(s.label)?.n || 0) + 1, level: s.level });
    }
    return [...m.entries()].sort((a, b) => b[1].level - a[1].level);
  }, [people]);
  const ways = useMemo(() => (isCompany ? waysInto(data.name, d1, d2) : null), [isCompany, data, d1, d2]);
  const related = useMemo(() => {
    if (!isCompany) return [];
    return links.filter((l) => l.a === data.name || l.b === data.name)
      .map((l) => ({ name: l.a === data.name ? l.b : l.a, weight: l.weight }))
      .sort((a, b) => b.weight - a.weight).slice(0, 8);
  }, [isCompany, links, data]);
  const top = [...people].sort((a, b) => (Number(b.power_score) || 0) - (Number(a.power_score) || 0)).slice(0, 6);
  const industry = isCompany ? data.industry : data;
  const d1n = people.filter((p) => p.degree === 1).length;
  const d2n = people.filter((p) => p.degree === 2).length;
  const topCos = !isCompany ? [...data.companies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) : [];

  return (
    <aside style={{ width: 360, flexShrink: 0, borderLeft: LINE, overflow: 'auto', padding: 16, background: 'rgba(255,255,255,0.02)' }}>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: 0 }}>✕ Close</button>
      <div style={{ fontSize: 10, letterSpacing: 1, color: '#8b9a9a', marginTop: 8 }}>{isCompany ? 'COMPANY' : 'INDUSTRY'} ANALYZER</div>
      <h2 style={{ margin: '4px 0 6px', fontSize: 20 }}>{isCompany ? data.name : data.label}</h2>
      {/* A company's industry opens that industry here (Blake, 2026-10-02: industries live in the side card, not a tab). */}
      {isCompany && onIndustry ? (
        <button type="button" onClick={() => onIndustry(industry.key)} title={`Open ${industry.label}: everyone there and its top companies`} style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `${industry.color}22`, color: industry.color,
        }}>{industry.label} · inferred →</button>
      ) : (
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${industry.color}22`, color: industry.color }}>
          {industry.label}{isCompany ? ' · inferred' : ''}
        </span>
      )}
      {isCompany && <CompanyScoreLine name={data.name} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '14px 0' }}>
        {[[d1n, 'you know', '#00ff88'], [d2n, 'reachable', '#FF6B35'], [people.filter((p) => isSenior(p.headline)).length, 'director+', '#FFD700']].map(([n, l, c]) => (
          <div key={l} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.04)', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{n}</div>
            <div style={{ fontSize: 10.5, color: '#8b9a9a' }}>{l}</div>
          </div>
        ))}
      </div>

      <Section title="By level">
        {levels.map(([label, { n }]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 28px', gap: 8, alignItems: 'center', fontSize: 11.5, marginBottom: 4 }}>
            <span style={{ color: '#aab7b7' }}>{label}</span>
            <Bar total={people.length} parts={[[n, '#3498DB']]} />
            <span style={{ color: '#778', textAlign: 'right' }}>{n}</span>
          </div>
        ))}
      </Section>

      {isCompany && ways && (
        <Section title="Ways in">
          {ways.direct.length > 0 && <div style={{ fontSize: 11, color: '#00ff88', margin: '2px 0' }}>You already know {ways.direct.length} here</div>}
          {(() => {
            // One line per person: someone who works here and also knows others
            // here is the best way in of all, so they lead, with both facts.
            const knows = new Map(ways.bridges.map(({ bridge, n }) => [bridge.id, n]));
            const direct = [...ways.direct].sort((x, y) => (knows.get(y.id) || 0) - (knows.get(x.id) || 0)).slice(0, 4);
            const directIds = new Set(ways.direct.map((p) => p.id));
            return (
              <>
                {direct.map((p) => (
                  <PersonLine key={p.id} p={p} note={knows.get(p.id) ? `works here · knows ${knows.get(p.id)} here` : `works here · ${p.headline || ''}`} />
                ))}
                {ways.bridges.filter(({ bridge }) => !directIds.has(bridge.id)).slice(0, 5).map(({ bridge, n }) => (
                  <PersonLine key={bridge.id} p={bridge} note={`knows ${n} ${n === 1 ? 'person' : 'people'} here`} />
                ))}
              </>
            );
          })()}
          {!ways.direct.length && !ways.bridges.length && <div style={{ fontSize: 12, color: '#778' }}>No one you know links here yet.</div>}
        </Section>
      )}

      <Section title={isCompany ? 'Most powerful people here' : 'Most powerful people in this industry'}>
        {top.map((p) => <PersonLine key={p.id} p={p} note={`${p.degree === 1 ? 'you know them' : p.degree === 2 ? '2nd degree' : '3rd+'} · ${p.headline || ''}`} />)}
      </Section>

      {isCompany && related.length > 0 && (
        <Section title="Connected companies">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {related.map((r) => (
              <button key={r.name} onClick={() => onCompany(r.name)} style={{ padding: '3px 9px', borderRadius: 10, border: LINE, background: `${(index.get(r.name)?.industry.color || '#666')}22`, color: '#dfe6e9', fontSize: 11.5, cursor: 'pointer' }}>
                {r.name} <span style={{ color: '#778' }}>{r.weight}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {!isCompany && (
        <Section title="Companies">
          {topCos.map(([name, n]) => (
            <div key={name} onClick={() => onCompany(name)} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 24px', gap: 8, alignItems: 'center', fontSize: 12, padding: '3px 0', cursor: 'pointer' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <Bar total={topCos[0][1]} parts={[[n, industry.color]]} />
              <span style={{ color: '#778', textAlign: 'right' }}>{n}</span>
            </div>
          ))}
        </Section>
      )}

      {isCompany && onOpenCompany && (
        <button onClick={() => onOpenCompany(data)} style={{ marginTop: 14, width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, background: 'linear-gradient(135deg, #00ff88, #3498DB)', color: '#000' }}>
          Path to the top of {data.name} →
        </button>
      )}
    </aside>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, letterSpacing: 0.8, color: '#8b9a9a', fontWeight: 700, marginBottom: 6 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

// The company's score in people's power, where it comes from, and a control
// to set it (Settings → Scores has every company).
function CompanyScoreLine({ name }) {
  const { companies, setScore } = useCompanyScores();
  const c = companies?.find((x) => x.name === name);
  if (!c) return null;
  const from = { yours: 'your score', known: 'known list', network: 'estimated', default: 'unknown company' }[c.source];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: '#aab7b7' }}>
      Company score <b style={{ color: '#fff', fontSize: 15 }}>{c.score}</b>/10 · {from}
      <span style={{ marginLeft: 'auto' }}><ScorePicker company={c} onSet={setScore} compact /></span>
    </div>
  );
}
