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
import {
  buildCompanyIndex, companyLinks, companyOf, getSeniority, industryOf, industryByKey,
  INDUSTRIES, UNKNOWN_INDUSTRY, waysInto, isSenior,
} from '../../lib/companies';

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const LINE = '1px solid rgba(255,255,255,0.1)';
const MAX_BUBBLES = 140;
const ALL_INDUSTRIES = [...INDUSTRIES, UNKNOWN_INDUSTRY];

function jitter(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function Seg({ value, onChange, options }) {
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

function useSize(ref) {
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

/** Does this person pass the filters? */
function passes(p, f) {
  if (f.degree !== 'all' && String(p.degree) !== f.degree) return false;
  if (f.seniority === 'senior' && !isSenior(p.headline)) return false;
  if (f.seniority === 'csuite' && getSeniority(p.headline).level < 6) return false;
  if (f.tier === 'SA' && p.tier !== 'S' && p.tier !== 'A') return false;
  return true;
}

export default function PathsAnalyzer({ d1 = [], d2 = [], d3 = [], tab = 'map', onOpenCompany }) {
  const [filters, setFilters] = useState({ degree: 'all', seniority: 'all', tier: 'all' });
  const [hidden, setHidden] = useState(() => new Set());       // industries toggled off
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(null);                   // { kind: 'company'|'industry', key }

  const rows = useMemo(() => [...d1, ...d2, ...d3], [d1, d2, d3]);
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

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Filters filters={filters} setFilters={setFilters} query={query} setQuery={setQuery}
          industries={industries} hidden={hidden} setHidden={setHidden}
          onIndustry={(key) => setFocus({ kind: 'industry', key })} />
        {tab === 'map' ? (
          <CompanyMap companies={companies} links={links} focus={focus}
            onCompany={(name) => setFocus({ kind: 'company', key: name })}
            onIndustry={(key) => setFocus({ kind: 'industry', key })}
            onClear={() => setFocus(null)} />
        ) : (
          <IndustryCards industries={industries} index={index} d1={d1} d2={d2}
            onIndustry={(key) => setFocus({ kind: 'industry', key })}
            onCompany={(name) => setFocus({ kind: 'company', key: name })} />
        )}
      </div>
      {panel && (
        <AnalyzerPanel focus={focus} data={panel} index={index} links={links} d1={d1} d2={d2}
          filters={filters} onClose={() => setFocus(null)}
          onCompany={(name) => setFocus({ kind: 'company', key: name })}
          onOpenCompany={onOpenCompany} />
      )}
    </div>
  );
}

function Filters({ filters, setFilters, query, setQuery, industries, hidden, setHidden, onIndustry }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <div style={{ padding: '10px 16px', borderBottom: LINE, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a company"
          style={{ padding: '6px 10px', borderRadius: 7, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13, minWidth: 170 }} />
        <Seg value={filters.degree} onChange={(v) => set('degree', v)} options={[['all', 'All degrees'], ['1', '1st'], ['2', '2nd'], ['3', '3rd']]} />
        <Seg value={filters.seniority} onChange={(v) => set('seniority', v)} options={[['all', 'Any level'], ['senior', 'Director+'], ['csuite', 'C-suite']]} />
        <Seg value={filters.tier} onChange={(v) => set('tier', v)} options={[['all', 'All tiers'], ['SA', 'S & A only']]} />
      </div>
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
        <span style={{ fontSize: 11, color: '#667', alignSelf: 'center' }}>industries inferred from companies and headlines</span>
      </div>
    </div>
  );
}

function CompanyMap({ companies, links, focus, onCompany, onIndustry, onClear }) {
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
      id: c.name, co: c, r: 4 + Math.sqrt(c.shown.length) * 3.4,
      // A fixed jitter from the name, so the same network always lays out the same.
      x: anchor.get(c.industry.key).x + (jitter(c.name) - 0.5) * 40, y: anchor.get(c.industry.key).y + (jitter(c.name + '#') - 0.5) * 40,
    }));
    const edges = links.filter((l) => names.has(l.a) && names.has(l.b)).map((l) => ({ source: l.a, target: l.b, weight: l.weight, via: l.via.size }));
    const sim = forceSimulation(nodes)
      .force('x', forceX((d) => anchor.get(d.co.industry.key).x).strength(0.12))
      .force('y', forceY((d) => anchor.get(d.co.industry.key).y).strength(0.12))
      .force('collide', forceCollide((d) => d.r + 3))
      .force('charge', forceManyBody().strength(-25))
      .force('link', forceLink(edges).id((d) => d.id).strength((e) => Math.min(0.25, 0.03 * e.weight)).distance(60))
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
    return { nodes, edges, box, labels, cut: Math.max(0, companies.length - shown.length) };
  }, [companies, links]);

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
  const labelled = useMemo(() => new Set(layout.nodes.slice(0, 28).map((n) => n.id)), [layout]);

  return (
    <div ref={wrap} style={{ flex: 1, minHeight: 360, position: 'relative' }} onClick={onClear}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`${layout.box.x} ${layout.box.y} ${layout.box.w} ${layout.box.h}`} style={{ display: 'block' }}>
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
              <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }}
                opacity={dim ? 0.18 : 1}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onClick={(ev) => { ev.stopPropagation(); onCompany(n.id); }}>
                <title>{`${n.co.name} · ${n.co.industry.label} (inferred)\n${n.co.d1} you know · ${n.co.d2} reachable${n.co.d3 ? ` · ${n.co.d3} further` : ''}`}</title>
                <circle r={n.r} fill={n.co.industry.color} fillOpacity={0.75}
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
        Bubble = a company, sized by your people there; white centre = the share you already know; gold ring = an S-tier person inside.<br />
        A line = one of your connections at one company knows people at the other.
        {layout.cut ? ` Showing the ${MAX_BUBBLES} largest; ${layout.cut} smaller companies are in Industries.` : ''}
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

function IndustryCards({ industries, index, d1, d2, onIndustry, onCompany }) {
  const bridgesInto = useMemo(() => {
    const byId = new Map(d1.map((c) => [c.id, c]));
    const out = new Map();
    for (const r of d2) {
      const co = companyOf(r);
      const ind = co ? index.get(co)?.industry.key : industryOf(null, r.headline).key;
      if (!ind) continue;
      const m = out.get(ind) || new Map();
      m.set(r.source_connection_id, (m.get(r.source_connection_id) || 0) + 1);
      out.set(ind, m);
    }
    const best = new Map();
    for (const [ind, m] of out) {
      const [id, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      if (byId.get(id)) best.set(ind, { bridge: byId.get(id), n });
    }
    return best;
  }, [index, d1, d2]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {industries.map((i) => {
          const d1n = i.people.filter((p) => p.degree === 1).length;
          const d2n = i.people.filter((p) => p.degree === 2).length;
          const senior = i.people.filter((p) => isSenior(p.headline)).length;
          const S = i.people.filter((p) => p.tier === 'S').length;
          const topCos = [...i.companies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          const way = bridgesInto.get(i.key);
          return (
            <div key={i.key} onClick={() => onIndustry(i.key)} style={{ padding: 14, borderRadius: 10, border: LINE, borderTop: `3px solid ${i.color}`, background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <b style={{ fontSize: 14, color: i.color }}>{i.label}</b>
                <span style={{ fontSize: 20, fontWeight: 800 }}>{i.people.length}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#8b9a9a', margin: '4px 0 6px' }}>
                {d1n} you know · {d2n} reachable · {i.companies.size} companies · {senior} director+ · {S} S-tier
              </div>
              <Bar total={i.people.length} parts={[[d1n, '#00ff88'], [d2n, '#FF6B35']]} />
              {topCos.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {topCos.map(([name, n]) => (
                    <button key={name} onClick={(e) => { e.stopPropagation(); onCompany(name); }}
                      style={{ padding: '2px 8px', borderRadius: 10, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#dfe6e9', fontSize: 11, cursor: 'pointer' }}>
                      {name} <span style={{ color: '#778' }}>{n}</span>
                    </button>
                  ))}
                </div>
              )}
              {way && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#aab7b7' }}>
                  Best way in: <b style={{ color: TIER[way.bridge.tier] || '#ccc' }}>{way.bridge.name}</b> knows {way.n} here
                </div>
              )}
            </div>
          );
        })}
      </div>
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

function AnalyzerPanel({ focus, data, index, links, d1, d2, filters, onClose, onCompany, onOpenCompany }) {
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
      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${industry.color}22`, color: industry.color }}>
        {industry.label}{isCompany ? ' · inferred' : ''}
      </span>

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
