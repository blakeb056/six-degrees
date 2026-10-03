'use client';

// Paths → People: the Paths map with people in place of companies (Blake,
// 2026-10-02, mock-up 3b). One bubble per connection of yours, sized by the
// cluster behind them, coloured by their sector and grouped like the company
// map; a white centre for the share of their cluster you can only reach
// through them, a gold ring for the S tier inside, and a line between two
// connections whose clusters share people. Point at one for their numbers;
// click to open their cluster in Bridge Chains.
//
// Laid out once per filter change and drawn as plain SVG, as the company map
// is (TRAPS §29). The numbers come from lib/people-map.js.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3';
import { peopleMap } from '../../lib/people-map';
import { companyOf, industryOf, industryByKey, INDUSTRIES, UNKNOWN_INDUSTRY } from '../../lib/companies';
import { jitter, Seg, useSize, SidePanel, panelHeading } from './PathsAnalyzer';
import { TierGrid } from './FilterPanel';
import { useLivePhysics, HeatDefs, HeatGlow, PHYSICS_OFF } from './MapControls';
import { makeGrid, shows, gridCounts } from '../../lib/tier-grid';
import { heatBy, heatColour } from '../../lib/galaxy-lab';
import { clusterStrength } from '../../lib/map-heat';

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const LINE = '1px solid rgba(255,255,255,0.1)';
const UNSCANNED = '#3a3f55';
const MAX_BUBBLES = 400;
const ALL_INDUSTRIES = [...INDUSTRIES, UNKNOWN_INDUSTRY];
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// What a bubble's size follows.
const SIZE_BY = {
  value: { label: 'Cluster value', of: (p) => p.value, k: 2 },
  size: { label: 'Cluster size', of: (p) => p.size, k: 2.6 },
  s: { label: 'S tier inside', of: (p) => p.S, k: 6 },
};

/**
 * `top` (Paths' "Bubbles are" switch), `look` (its Colour and Physics) and the
 * `colourBy` and `physics` they set come from PathsAnalyzer, shared with the company map.
 */
export default function PeopleMap({ d1 = [], d2 = [], top = null, look = null, colourBy = 'sector', physics = PHYSICS_OFF }) {
  const router = useRouter();
  const [sizeBy, setSizeBy] = useState('value');
  const [who, setWho] = useState('scanned');          // 'scanned' | 'all'
  // Their own tier, on the same grid as Network Circle; everyone here is 1st degree.
  const [grid, setGrid] = useState(() => makeGrid([1]));
  const [hidden, setHidden] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [labels, setLabels] = useState('top');        // 'top' | 'all' | 'none'

  const model = useMemo(() => peopleMap(d1, d2), [d1, d2]);
  const counts = useMemo(() => gridCounts({ 1: model.people.filter((p) => who === 'all' || p.size > 0).map((p) => p.person) }), [model, who]);
  // Each connection's sector, from where they work (inferred, as on the company map).
  const sectorOf = useMemo(() => {
    const m = new Map();
    for (const p of model.people) m.set(p.id, industryOf(companyOf(p.person), p.person.headline));
    return m;
  }, [model]);
  const scannedCount = useMemo(() => model.people.filter((p) => p.size > 0).length, [model]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return model.people.filter((p) => (who === 'all' || p.size > 0)
      && shows(grid, p.person.tier, 1)
      && !hidden.has(sectorOf.get(p.id).key)
      && (!q || String(p.person.name || '').toLowerCase().includes(q)))
      .sort((a, b) => b.value - a.value || b.size - a.size);
  }, [model, who, grid, hidden, query, sectorOf]);

  const sectors = useMemo(() => {
    const counts = new Map();
    for (const p of model.people) {
      if (who !== 'all' && !p.size) continue;
      const k = sectorOf.get(p.id).key;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return ALL_INDUSTRIES.filter((i) => counts.get(i.key)).map((i) => ({ ...i, count: counts.get(i.key) })).sort((a, b) => b.count - a.count);
  }, [model, who, sectorOf]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <SidePanel open={panelOpen} onToggle={() => setPanelOpen((o) => !o)}>
        {top}
        <div style={panelHeading}>Filter</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 7, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13, marginBottom: 8 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Seg value={who} onChange={setWho} options={[['scanned', `Scanned (${fmt(scannedCount)})`], ['all', `All (${fmt(model.people.length)})`]]} />
        </div>
        <div style={{ marginTop: 12 }}>
          <TierGrid grid={grid} counts={counts} onChange={setGrid} mode="paths" />
        </div>
        <div style={panelHeading}>Sectors</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sectors.map((i) => {
            const off = hidden.has(i.key);
            return (
              <button key={i.key} title={off ? 'Show on the map' : 'Hide from the map'}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 14, cursor: 'pointer',
                  border: `1px solid ${i.color}55`, background: off ? 'transparent' : `${i.color}14`, color: '#cfd8d8', fontSize: 11.5, opacity: off ? 0.4 : 1 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: i.color }} />
                {i.label} <span style={{ color: '#778' }}>{fmt(i.count)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: '#667', marginTop: 6 }}>Inferred from where each connection works.</div>
        <div style={panelHeading}>Read the map</div>
        <div style={{ fontSize: 11, color: '#8b9a9a', marginBottom: 4 }}>Bubble size</div>
        <Seg value={sizeBy} onChange={setSizeBy} options={Object.entries(SIZE_BY).map(([k, v]) => [k, v.label])} />
        <div style={{ fontSize: 11, color: '#8b9a9a', margin: '10px 0 4px' }}>Names</div>
        <Seg value={labels} onChange={setLabels} options={[['top', 'Biggest'], ['all', 'All'], ['none', 'None']]} />
        {look}
      </SidePanel>
      {/* Room at the top for the notch's Map / Companies, so it never covers a label */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingTop: 40, boxSizing: 'border-box' }}>
      <Bubbles people={shown} links={model.links} sizeBy={SIZE_BY[sizeBy]} sectorOf={sectorOf} rank={model.rank} names={labels}
        colourBy={colourBy} physics={physics}
        onOpen={(id) => router.push(`/?chain=${encodeURIComponent(id)}`)} />
      </div>
    </div>
  );
}

function Bubbles({ people, links, sizeBy, sectorOf, rank, onOpen, names = 'top', colourBy = 'sector', physics = PHYSICS_OFF }) {
  const wrap = useRef(null);
  const { w, h } = useSize(wrap);
  const [hover, setHover] = useState(null);

  // Sectors on a ring, each person pulled to their sector and to the people
  // whose clusters overlap theirs, then frozen: the same as the company map.
  const layout = useMemo(() => {
    const list = people.slice(0, MAX_BUBBLES);
    const ids = new Set(list.map((p) => p.id));
    const keys = [...new Set(list.map((p) => sectorOf.get(p.id).key))];
    const R = 260;
    const anchor = new Map(keys.map((k, i) => {
      const a = (i / Math.max(1, keys.length)) * Math.PI * 2 - Math.PI / 2;
      return [k, { x: Math.cos(a) * R, y: Math.sin(a) * R }];
    }));
    const nodes = list.map((p) => {
      const at = anchor.get(sectorOf.get(p.id).key);
      return {
        id: p.id, p, sector: sectorOf.get(p.id),
        r: p.size ? 4 + Math.sqrt(Math.max(0, sizeBy.of(p))) * sizeBy.k : 3,
        x: at.x + (jitter(String(p.id)) - 0.5) * 40, y: at.y + (jitter(`${p.id}#`) - 0.5) * 40,
        ax: at.x, ay: at.y,   // where their sector sits, for live physics
      };
    });
    const edges = links.filter((l) => ids.has(l.a) && ids.has(l.b)).map((l) => ({ source: l.a, target: l.b, weight: l.shared, k: Math.min(0.25, 0.02 * l.shared) }));
    const sim = forceSimulation(nodes)
      .force('x', forceX((d) => anchor.get(d.sector.key).x).strength(0.12))
      .force('y', forceY((d) => anchor.get(d.sector.key).y).strength(0.12))
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
    const labels = keys.map((k) => {
      const ns = nodes.filter((n) => n.sector.key === k);
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
    box.h += Math.max(60, box.h * 0.1);
    return { nodes, edges, box, labels, cut: Math.max(0, people.length - list.length) };
  }, [people, links, sizeBy, sectorOf]);
  const { drag, clicked } = useLivePhysics(layout, physics);
  // Heat: how strong each cluster is, person for person; not scanned is the coldest.
  const heat = useMemo(() => heatBy(layout.nodes, (n) => clusterStrength(n.p)), [layout]);
  const hot = colourBy === 'heat';

  const hovered = hover ? layout.nodes.find((n) => n.id === hover) : null;
  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of layout.edges) {
      if (e.source.id === hover) s.add(e.target.id);
      if (e.target.id === hover) s.add(e.source.id);
    }
    return s;
  }, [hover, layout]);
  const labelled = useMemo(() => new Set(names === 'none' ? [] : layout.nodes.filter((n) => n.p.size).slice(0, names === 'all' ? Infinity : 28).map((n) => n.id)), [layout, names]);

  // Where a node is on screen (the SVG fits its box to the window, centred).
  const scale = w && h ? Math.min(w / layout.box.w, h / layout.box.h) : 1;
  const ox = (w - layout.box.w * scale) / 2;
  const oy = (h - layout.box.h * scale) / 2;
  const onScreen = (n) => ({ x: ox + (n.x - layout.box.x) * scale, y: oy + (n.y - layout.box.y) * scale, r: n.r * scale });

  return (
    <div ref={wrap} style={{ flex: 1, minHeight: 360, position: 'relative' }}>
      {w > 0 && (
        <svg width={w} height={h} viewBox={`${layout.box.x} ${layout.box.y} ${layout.box.w} ${layout.box.h}`} style={{ display: 'block', touchAction: drag ? 'none' : undefined }}>
          {hot && <HeatDefs id="pplheat" />}
          {hot && <HeatGlow id="pplheat" nodes={layout.nodes.filter((n) => n.p.size)} heat={heat} />}
          <g>
            {layout.edges.map((e, i) => {
              const on = hover && (e.source.id === hover || e.target.id === hover);
              return (
                <line key={i} x1={e.source.x} y1={e.source.y} x2={e.target.x} y2={e.target.y}
                  stroke={on ? '#FF6B35' : '#8fa6c0'} strokeOpacity={on ? 0.8 : hover ? 0.03 : 0.09}
                  strokeWidth={on ? 1 + Math.log2(1 + e.weight) : 0.4 + Math.log2(1 + e.weight) * 0.4} />
              );
            })}
          </g>
          {layout.labels.map((l) => (
            <text key={l.key} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={13} fontWeight={800} fill={l.ind.color} opacity={0.85}>
              {l.ind.label}
            </text>
          ))}
          {layout.nodes.map((n) => {
            const { p } = n;
            const dim = neighbours && !neighbours.has(n.id);
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: drag ? 'grab' : p.size ? 'pointer' : 'default' }} opacity={dim ? 0.18 : 1}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onPointerDown={drag ? (ev) => drag(ev, n) : undefined}
                onClick={() => { if (clicked() && p.size) onOpen(n.id); }}>
                <circle r={n.r} fill={!p.size ? UNSCANNED : hot ? heatColour(heat(n)) : n.sector.color} fillOpacity={p.size ? 0.92 : 0.6}
                  stroke={hover === n.id ? '#fff' : p.S ? TIER.S : 'rgba(0,0,0,0.35)'}
                  strokeWidth={hover === n.id ? 2.5 : p.S ? Math.min(4, 1 + p.S / 40) : 0.6} />
                {/* The share of their cluster only they can open, as an inner disc */}
                {p.size > 0 && p.only > 0 && <circle r={n.r * Math.sqrt(p.share) * 0.85} fill="#fff" fillOpacity={0.3} />}
                {(labelled.has(n.id) || hover === n.id) && (
                  <text y={n.r + 11} textAnchor="middle" fontSize={10} fill="#e6edf0" style={{ pointerEvents: 'none' }}
                    paintOrder="stroke" stroke="rgba(0,0,0,0.6)" strokeWidth={3}>{p.person.name}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hovered && <Card n={hovered} at={onScreen(hovered)} w={w} rank={rank(hovered.id)} />}
      <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 11, color: '#778', lineHeight: 1.6, pointerEvents: 'none' }}>
        Bubble = one of your connections, sized by {sizeBy.label.toLowerCase()} (value: S tier counts 3, A tier 2, everyone else 1){hot ? '; colour = how strong their cluster is, person for person, cold to white hot' : ''};
        white centre = the share of their cluster only they can open; gold ring = S tier inside.<br />
        A line = two of your connections whose clusters share people. Grey = not scanned yet.
        {layout.cut ? ` Showing the ${MAX_BUBBLES} largest of ${fmt(layout.cut + MAX_BUBBLES)}.` : ''}
      </div>
    </div>
  );
}

/** Someone's numbers, beside their bubble. */
function Card({ n, at, w, rank }) {
  const { p } = n;
  const width = 280;
  const left = at.x + at.r + 14 + width > w ? Math.max(8, at.x - at.r - 14 - width) : at.x + at.r + 14;
  const role = [p.person.role, companyOf(p.person)].filter(Boolean).join(' @ ') || p.person.headline || '';
  return (
    <div style={{
      position: 'absolute', left, top: Math.max(8, at.y - 70), width, pointerEvents: 'none', zIndex: 5,
      padding: '12px 14px', borderRadius: 12, background: 'rgba(8,10,22,0.96)', border: `1px solid ${n.sector.color}99`,
      boxShadow: '0 12px 40px rgba(0,0,0,0.6)', fontSize: 12, lineHeight: 1.45, color: '#ddd',
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{p.person.name}</div>
      <div style={{ fontSize: 11.5, color: '#8a8fa8' }}>
        {role}{p.person.tier ? ` · ${p.person.tier}-tier` : ''} · {n.sector.label}
      </div>
      {p.size ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', margin: '10px 0 8px' }}>
            <Stat value={fmt(p.value)} label="cluster value" color="#FFD700" />
            <Stat value={fmt(p.size)} label="people in their cluster" />
            <Stat value={`${fmt(p.S)} S · ${fmt(p.A)} A`} label="the strongest among them" color="#FFD700" />
            <Stat value={`${fmt(p.only)} (${Math.round(p.share * 100)}%)`} label="only through them" color="#00E5FF" />
          </div>
          <div style={{ fontSize: 11.5, color: '#aab' }}>
            {rank === 1 ? 'The most valuable cluster you’ve scanned. ' : rank != null ? `Worth more than ${Math.round(rank * 100)}% of the clusters you’ve scanned. ` : ''}Click to open it in Bridge Chains.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: '#aab', marginTop: 8 }}>Their circle isn’t scanned yet, so there’s no cluster to size.</div>
      )}
    </div>
  );
}

function Stat({ value, label, color = '#fff' }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10.5, color: '#8a8fa8' }}>{label}</div>
    </div>
  );
}
