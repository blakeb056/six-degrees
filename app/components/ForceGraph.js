'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as d3 from 'd3';
import { localPhoto } from '../../lib/photos';
import { recentre } from '../../lib/galaxy';
import { reachIndex, readyByCircle, scanBars } from '../../lib/reach';
import { ringSegments, RING } from '../../lib/dot-rings';
import { LAB_DEFAULTS, FORCE_KEYS, labNow, watchLab, effectiveLab, clockNow, watchClock, setClock, stopReplay, bornTimes, reachCounts, colourScheme, findMatches, loadSocial, chapterAt, heatColour } from '../../lib/galaxy-lab';
import { registerGalaxy } from '../../lib/galaxy-export';
import { MAP_LOOK } from '../../lib/themes';
import { keyFor, routeIndex } from '../../lib/separation';

// Connection fields are attacker-reachable: /api/ingest and /api/update-images
// accept writes, and a page on any other site can POST to this app on localhost.
// Anything from the database is therefore untrusted text, never markup — these
// tooltips previously used d3's .html(), which is innerHTML, so a name
// containing <img onerror=...> executed on hover.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The id of the node at the centre, you. Not a connection's id (those come from
// the database), and never shown.
const CENTER_ID = '__center__';
const HEAT_GLOWS = 700;   // glows drawn under Colour by → Heat, hottest first

// Builds the avatar tooltip through the DOM rather than a string, so no value
// can break out of the attribute it is written into. Only a photo saved on this
// computer (lib/photos.js): not a link to LinkedIn, and never javascript:, data:
// or an attribute-escaping payload. Nodes carry nothing else, and this checks
// again.
function renderPhoto(sel, d, size, borderColor) {
  sel.selectAll('*').remove();
  const src = localPhoto(d.profile_image_url);
  if (!src) { sel.style('opacity', 0); return; }
  sel.append('img')
    .attr('src', src)
    .style('width', size + 'px').style('height', size + 'px')
    .style('border-radius', '50%').style('object-fit', 'cover')
    .style('border', `2px solid ${borderColor}`).style('display', 'block')
    .on('error', function () { this.parentElement.style.display = 'none'; });
}

// Reduce Motion, the Mac's accessibility setting. With it on, hovering and
// re-fitting change at once instead of easing, and the selection ring holds still.
function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// The selection ring pulses on an element of its own, over the graph rather
// than inside the <svg>. Animating anything inside the <svg> repaints every dot
// on every frame, which at 30,000 people keeps a processor core busy for one
// ring. Opacity and scale on a separate element are left to the compositor.
const RING_CSS = `
@keyframes galaxy-ring-pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.12); }
}
.galaxy-ring-pulse { animation: galaxy-ring-pulse 1.8s ease-in-out infinite; }
.lab-focus .gn:not(.lit), .lab-focus .gl:not(.lit) { opacity: 0.06; }
.lab-focus .gl.lit { stroke-opacity: 0.7; }
.lab-focus .dot-rings, .lab-focus .catalyst-ring { opacity: 0.15; }
.lab-find .gn:not(.found), .lab-find .gl:not(.found) { opacity: 0.07; }
.lab-find .gn.found { stroke: #fff; stroke-width: 2px; }
.far text:not(.hub) { opacity: 0; }
@media (prefers-reduced-motion: no-preference) { .far text, g:not(.far) > text { transition: opacity 0.25s; } }
@keyframes lab-pop { from { opacity: 0; } }
@media (prefers-reduced-motion: no-preference) { .lab-pop .gn, .lab-pop .gl { animation: lab-pop 0.5s ease-out; } }
@media (prefers-reduced-motion: reduce) {
  .galaxy-ring-pulse { animation: none; opacity: 0.8; }
}`;

export default function ForceGraph({ connections, onSelect, tierColors, focusNodeRef, userName, selectedId = null, scanNotes, fullDegree1, fullDegree2 }) {
  // The ring round a connection's dot (design C): how much of their circle is
  // scanned, and how many in it are ready to scan (lib/reach.js).
  const marks = useMemo(() => {
    const reach = reachIndex(fullDegree1 || connections, fullDegree2 || [], scanNotes || {});
    const ready = readyByCircle(reach);
    const out = new Map();
    for (const c of connections) {
      if ((c.degree || 1) !== 1) continue;
      const bars = scanBars(c, reach);
      const r = ready.get(c.id) || 0;
      if (bars != null || r) out.set(c.id, { bars, ready: r });
    }
    return out;
  }, [connections, fullDegree1, fullDegree2, scanNotes]);
  // Every circle each person two steps away is in, from every circle scanned:
  // the Galaxy links them to each of those connections, not only the one their
  // row came through, so a shared person sits between the hubs they join.
  const routes = useMemo(() => routeIndex(fullDegree2 || []), [fullDegree2]);
  const svgRef = useRef(null);
  const ringRef = useRef(null);
  const sceneRef = useRef(null);  // The scene on screen: { resize, select }
  // The view, kept across rebuilds: the zoom, and the size of box it was set for.
  const viewRef = useRef({ transform: null, size: null });
  const sizeRef = useRef(null);
  const [dimensions, setDimensions] = useState(null);
  const stampRef = useRef(null);

  // The physics lab (lib/galaxy-lab.js): a slider moves the layout in place,
  // and the replay's clock hides whoever wasn't there yet. Neither rebuilds.
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  const labRef = useRef(lab);
  useEffect(() => {
    labRef.current = lab;
    sceneRef.current?.setLab(effectiveLab(lab));
    const c = clockNow();
    sceneRef.current?.setFind(c.find, c.fly);
    if (lab.on) loadSocial();
  }, [lab]);
  useEffect(() => watchClock(() => {
    const c = clockNow();
    sceneRef.current?.setTime(c.at);
    sceneRef.current?.setFind(c.find, c.fly);
    sceneRef.current?.setFit(c.fit);
  }), []);
  useEffect(() => () => stopReplay(), []);

  // The dots' colours (Colour by, in the lab): tier as always, or degree,
  // company or warmth. A new scheme recolours in place.
  const social = useSyncExternalStore(watchClock, () => clockNow().social, () => undefined);
  const colourBy = effectiveLab(lab).colourBy;
  const scheme = useMemo(() => colourScheme(colourBy, connections, tierColors, social), [colourBy, connections, tierColors, social]);
  const schemeRef = useRef(scheme);
  useEffect(() => {
    schemeRef.current = scheme;
    sceneRef.current?.setColours(scheme);
  }, [scheme]);

  // The scene is rebuilt from scratch whenever its inputs change, so only real
  // changes should count. A parent re-rendering hands over a new onSelect every
  // time; reading it through a ref keeps the scene from resetting on every click.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const updateSize = () => {
      // Only publish a genuinely new size. A fresh object every observation is
      // never Object.is-equal, so React re-rendered on every callback —
      // including the sub-pixel churn a scrollbar appearing and disappearing
      // produces.
      const width = Math.round(container.clientWidth);
      const height = Math.round(container.clientHeight);
      sizeRef.current = { width, height };
      setDimensions((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    updateSize();
    // A resize only re-fits the view (below), so it no longer waits to settle.
    // It used to rebuild the whole scene, and a rebuild that itself changed the
    // size never stopped (TRAPS §29).
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Selection moves the ring; it never rebuilds the scene.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    sceneRef.current?.select(selectedId);
  }, [selectedId]);

  // Nor does a new size. Opening the side panel or the Filter panel used to
  // rebuild the Galaxy: the layout started over, the selection ring was
  // erased, and at 30,000 people the page stalled. Now the view slides over,
  // at the same zoom, so what was in the middle stays in the middle.
  useEffect(() => {
    if (dimensions) sceneRef.current?.resize(dimensions);
  }, [dimensions]);

  const measured = dimensions !== null;
  useEffect(() => {
    if (!measured || !svgRef.current || !connections.length) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // The view as it was, moved for any change of size since it was set.
    const size = sizeRef.current;
    const { transform, size: setFor } = viewRef.current;
    const saved = transform ? recentre(transform, setFor, size) : null;

    const select = (d) => onSelectRef.current?.(d);
    const scene = renderNetworkMode(svg, ringRef.current, size, connections, select, tierColors, focusNodeRef, saved, viewRef, userName, marks, effectiveLab(labRef.current), stampRef.current, schemeRef.current, routes);
    sceneRef.current = scene;
    scene.select(selectedIdRef.current);
    setClock({ min: scene.range.min, max: scene.range.max, of: scene.range.of });
    scene.setTime(clockNow().at);
    scene.setFind(clockNow().find, clockNow().fly);
    // Save picture and Record replay (lib/galaxy-export.js) draw from this <svg>.
    const unregister = registerGalaxy({
      svg: svgRef.current,
      stamp: () => (stampRef.current?.style.display === 'block' ? stampRef.current.textContent : null),
      legend: () => schemeRef.current.legend,
    });

    return () => {
      // Stop the force simulation this render started.
      //
      // It used to be left running. Every rebuild — and the scene used to
      // rebuild on any resize — added another simulation still ticking over
      // the same nodes, so they fought each other and the graph shook.
      // Refreshing made it worse because nothing ever stopped the old ones.
      scene.simulation.stop();
      scene.dispose();
      unregister();
      // And any glide or fly-to still under way, which would otherwise go on
      // moving the next scene's view. viewRef already holds where it was going.
      svg.interrupt();
      sceneRef.current = null;
      d3.selectAll('.graph-tooltip').remove();
    };
    // focusNodeRef and userName are read at build time on purpose; see above for
    // why onSelect is not a dependency. The size is read through sizeRef: a new
    // size re-fits the view rather than rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, tierColors, measured, marks, routes]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <style>{RING_CSS}</style>
      <svg ref={svgRef} width={dimensions?.width ?? 800} height={dimensions?.height ?? 600} style={{ background: 'transparent' }} />
      {/* The selection ring. The scene places it over the selected dot. */}
      <div ref={ringRef} className="galaxy-ring" style={{
        position: 'absolute', left: 0, top: 0, display: 'none',
        pointerEvents: 'none', transformOrigin: '0 0',
      }}>
        <div className="galaxy-ring-pulse" style={{ boxSizing: 'border-box', border: '2.5px solid', borderRadius: '50%' }} />
      </div>
      {/* The replay's date, written by the scene as it plays. */}
      <div ref={stampRef} style={{
        position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)', display: 'none',
        padding: '6px 14px', borderRadius: 16, background: 'var(--sd-surface, rgba(10,15,30,0.8))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
        color: 'var(--sd-fg-1, #e6edf5)', fontSize: 13, fontWeight: 600, pointerEvents: 'none', fontVariantNumeric: 'tabular-nums',
      }} />
      <div style={{ position: 'absolute', bottom: 20, left: 20, right: 20, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--sd-fg-3, #888)', pointerEvents: 'none' }}>
        {scheme.legend.map(([label, color]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Tooltips are fixed to the window, never part of the page's layout.
//
// They used to be position:absolute with no top/left until the first hover, so
// an invisible one sat at the bottom of the page and made it 18px taller than the
// window. On a Mac with visible scrollbars that was a scrollbar, and the graph was
// 6px narrower. Hovering moved the tooltip, the scrollbar went, the graph widened,
// the resize rebuilt the scene, the rebuild put fresh tooltips back at the bottom,
// the scrollbar returned — and so on, hundreds of rebuilds a second for as long as
// the mouse stayed on a dot. TRAPS §29. Fixed elements cannot resize the page.
function createTooltip() {
  return d3.select('body').append('div')
    .attr('class', 'graph-tooltip')
    .style('position', 'fixed').style('top', '0px').style('left', '0px')
    .style('background', 'rgba(0,0,0,0.92)').style('color', '#fff')
    .style('padding', '8px 12px').style('border-radius', '6px').style('font-size', '12px')
    .style('pointer-events', 'none').style('opacity', 0).style('z-index', 1000)
    .style('border', '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.2)').style('max-width', '280px');
}

// A hovered dot eases up to 1.5 times its size and back, rather than jumping.
// The transition is named, so it never cuts off another one on the same dot.
function easeRadius(el, r) {
  const dot = d3.select(el);
  if (reducedMotion()) dot.interrupt('hover').attr('r', r);
  else dot.transition('hover').duration(150).ease(d3.easeCubicOut).attr('r', r);
}

// Graph coordinates put you at 0,0, whatever the size of the box; the zoom
// transform places that in the box. So a new size only moves the view, and a
// rebuild can start from the view as it was.
function renderNetworkMode(svg, ring, box, connections, onSelect, tierColors, focusNodeRef, savedTransform, viewRef, userName, marks = new Map(), lab = LAB_DEFAULTS, stamp = null, scheme = null, routes = new Map()) {
  let colourOf = scheme?.of ?? ((d) => tierColors[d.tier] || '#666');
  const centerNode = {
    id: CENTER_ID, name: userName || 'You', tier: 'center', degree: 0,
    power_score: 10, fx: 0, fy: 0,
  };

  const nodes = [centerNode, ...connections.map(c => ({
    id: c.id, name: c.name, tier: c.tier, degree: c.degree || 1, source_connection_id: c.source_connection_id,
    unlocked_from_bridge_id: c.unlocked_from_bridge_id,
    power_score: parseFloat(c.power_score) || 1,
    company: c.company, role: c.role, headline: c.headline,
    profile_url: c.profile_url, profile_image_url: localPhoto(c.profile_image_url),
    connected_date: c.connected_date,
    seniority_score: c.seniority_score, company_prestige_score: c.company_prestige_score,
    influence_signals: c.influence_signals,
    is_catalyst: c.is_catalyst, catalyst_score: c.catalyst_score,
    circle_power: c.circle_power, circle_s_count: c.circle_s_count, circle_a_count: c.circle_a_count,
  }))];
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Who hangs off whom. Your connections hang off you; someone in a circle off
  // the connection whose circle it is, when that one is drawn too; and with
  // more than your connections drawn (Filter → Degree), someone you added
  // through a circle off the one they came from, so a chain reads as a chain.
  const drawnD1 = new Set(connections.filter(c => (c.degree || 1) === 1).map(c => c.id));
  const multi = connections.some(c => (c.degree || 1) > 1);
  const parentOf = new Map();
  for (const n of nodes) {
    if (n.id === CENTER_ID) continue;
    const from = n.unlocked_from_bridge_id;
    if (n.degree === 1 && multi && from != null && from !== n.id && drawnD1.has(from)) parentOf.set(n.id, from);
    else if (n.degree === 2 && drawnD1.has(n.source_connection_id)) parentOf.set(n.id, n.source_connection_id);
  }
  // How far along the chain: 1 for your connections, one more past each person
  // you came through, to 6.
  const bandMemo = new Map();
  const bandOf = (n, seen = new Set()) => {
    if (n.id === CENTER_ID) return 0;
    if (bandMemo.has(n.id)) return bandMemo.get(n.id);
    const p = parentOf.get(n.id);
    let b = n.degree >= 3 ? 3 : n.degree;
    if (p != null && !seen.has(n.id)) { seen.add(n.id); b = bandOf(nodeById.get(p), seen) + 1; }
    b = Math.min(b, 6);
    bandMemo.set(n.id, b);
    return b;
  };
  const links = connections.map(c => {
    const via = parentOf.get(c.id) ?? CENTER_ID;
    return { source: via, target: c.id, near: via !== CENTER_ID };
  });
  // Every other way in, for someone two steps away who is in more than one
  // circle on screen: a line to each of those connections too, so they sit
  // between the hubs they join and tie them together, as a note linked from
  // two others does in Obsidian. After the first lines, so links[i] stays
  // connections[i] for the replay.
  const alsoVia = new Map();   // id → the other connections they're reached through
  for (const n of nodes) {
    if (n.degree !== 2 || !parentOf.has(n.id)) continue;
    const ways = routes.get(keyFor(n));
    if (!ways || ways.size < 2) continue;
    const others = [...ways].filter((id) => id != null && id !== parentOf.get(n.id) && drawnD1.has(id));
    if (others.length) alsoVia.set(n.id, others);
  }
  for (const [id, others] of alsoVia) for (const via of others) links.push({ source: via, target: id, near: true, also: true });
  // How many lines meet at each dot (Size by → Links, as Obsidian sizes a note),
  // and who has a circle on screen (a hub).
  const linkCount = new Map();
  for (const l of links) {
    linkCount.set(l.source, (linkCount.get(l.source) || 0) + 1);
    linkCount.set(l.target, (linkCount.get(l.target) || 0) + 1);
  }
  const hubs = new Set(parentOf.values());
  const circleOf = new Map();   // hub → how many hang off them
  for (const p of parentOf.values()) circleOf.set(p, (circleOf.get(p) || 0) + 1);

  const tierRadius = (tier) => {
    switch (tier) { case 'S': return 150; case 'A': return 250; case 'B': return 350; case 'C': return 450; default: return 520; }
  };
  // More than one band drawn: a band for each step along the chain, the first
  // (your connections) a tighter ring, each sorted by tier with S nearest, close
  // enough to read as layers and far enough apart not to clump. One band alone
  // keeps the roomier tier rings.
  const TIERS = ['S', 'A', 'B', 'C', 'D'];
  const SLOTS = [[115, 135, 155, 175, 192], [265, 300, 335, 370, 398], [465, 500, 535, 565, 590], [660, 690, 720, 745, 765]];
  const bands = [...new Set(nodes.filter(n => n.id !== CENTER_ID).map(n => bandOf(n)))].sort((a, b) => a - b);
  const layered = multi && bands.length > 1;
  const radiusOf = (d) => {
    if (!layered) return tierRadius(d.tier);
    const slot = Math.min(bands.indexOf(bandOf(d)), SLOTS.length - 1);
    const t = TIERS.indexOf(d.tier);
    return SLOTS[slot][t < 0 ? 4 : t];
  };

  // A phone. Judged by the window, as the page judges it, not by the graph's
  // own box: that narrowed whenever a panel opened on a laptop.
  const isMobileGraph = window.innerWidth < 768;

  // The physics lab's settings (lib/galaxy-lab.js); today's layout when it's
  // off, and always on a phone, whose layout has no physics.
  let L = isMobileGraph ? { ...LAB_DEFAULTS, labels: lab.labels } : lab;
  const reach = reachCounts(nodes, parentOf);

  const nodeRadius = (d) => {
    if (d.id === CENTER_ID) return L.sizeBy === 'links' ? 24 : 18;
    // Sized by links, a dot grows with the lines that meet at it: a connection
    // with a scanned circle is a big hub, someone in three circles a little
    // bigger than someone in one.
    if (L.sizeBy === 'links') return Math.min(44, 3.5 + 2.1 * Math.sqrt(linkCount.get(d.id) || 1)) * L.dotSize;
    // Sized by reach, a dot grows with everyone who hangs off it: a 2nd-degree
    // person with a full circle behind them next to one with nobody.
    if (L.sizeBy === 'reach') return Math.min(28, 2.5 + 1.6 * Math.sqrt(reach.get(d.id) || 0)) * L.dotSize;
    const r = Math.max(3, Math.min(12, (d.power_score || 1) * 1.3));
    return (d.degree > 1 ? Math.max(2.5, r * 0.75) : r) * L.dotSize;   // further out, a little smaller
  };

  const g = svg.append('g');

  // Faint S–D guide rings where each tier settles (the radial force below), so
  // the tier bands read at a glance. Not on a phone, whose layout has no rings.
  // Once the layout settles they move to where each tier's dots actually sit
  // (the median distance out), which the other forces push past that radius.
  const guideRings = new Map();
  let guidesG = null;
  if (!isMobileGraph && layered) {
    // In bands: a faint ring and a label for each step along the chain instead.
    const guides = guidesG = g.append('g').attr('class', 'degree-guides').style('pointer-events', 'none');
    const names = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];
    bands.slice(0, SLOTS.length).forEach((b, slot) => {
      const r = SLOTS[slot][2];
      guides.append('circle').attr('r', r).attr('fill', 'none').attr('stroke', '#8899aa')
        .attr('stroke-opacity', 0.12).attr('stroke-width', 1).attr('stroke-dasharray', '2 4');
      guides.append('text').attr('x', 0).attr('y', -SLOTS[slot][4] - 8).attr('text-anchor', 'middle')
        .attr('font-size', 10).attr('font-weight', 700).attr('fill', '#8899aa').attr('fill-opacity', 0.55)
        .text(names[b] || `${b}th`);
    });
  } else if (!isMobileGraph) {
    const guides = guidesG = g.append('g').attr('class', 'tier-guides').style('pointer-events', 'none');
    for (const tier of ['S', 'A', 'B', 'C', 'D']) {
      const r = tierRadius(tier);
      const ring = guides.append('circle').attr('r', r).attr('fill', 'none')
        .attr('stroke', tierColors[tier] || '#666').attr('stroke-opacity', 0.16).attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 4');
      const label = guides.append('text').attr('x', 0).attr('y', -r - 4).attr('text-anchor', 'middle')
        .attr('font-size', 10).attr('font-weight', 700).attr('fill', tierColors[tier] || '#666').attr('fill-opacity', 0.5)
        .text(tier);
      guideRings.set(tier, { ring, label });
    }
  }
  // Where the view is going while a transition takes it there. A resize part-way
  // through re-fits the destination, and a rebuild starts from it, rather than
  // from a point along the way.
  let heading = null;
  // Names fade out zoomed out, as Obsidian's text does, all but the hubs'.
  let labelsG = null;
  const FAR = 0.85;
  const zoomBehavior = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => {
    g.attr('transform', e.transform);
    viewRef.current = { transform: heading ?? e.transform, size: box };
    labelsG?.classed('far', e.transform.k < FAR);
    placeRing();
  });
  svg.call(zoomBehavior);

  const moveView = (to, duration) => {
    if (reducedMotion()) {
      heading = null;
      svg.interrupt().call(zoomBehavior.transform, to);
      return;
    }
    heading = to;
    viewRef.current = { transform: to, size: box };
    // Stopped before its first frame, by a wheel or a click at that moment, a
    // slide reports "cancel" rather than "interrupt". Missing that left heading
    // set, and every zoom after it was saved as this destination. A scroll
    // already under way doesn't stop a slide, which lands here all the same.
    svg.transition().duration(duration).call(zoomBehavior.transform, to)
      .on('end interrupt cancel', () => { if (heading === to) heading = null; });
  };

  // The selection ring, tied to the selected person's dot. It is drawn again
  // after any rebuild, and hidden while they are filtered out.
  const pulse = ring.firstChild;
  let ringNode = null;
  const placeRing = () => {
    if (!ringNode) return;
    const t = d3.zoomTransform(svg.node());
    ring.style.transform = `translate(${t.applyX(ringNode.x)}px, ${t.applyY(ringNode.y)}px) scale(${t.k})`;
  };
  const select = (id) => {
    ringNode = id != null && id !== CENTER_ID ? nodeById.get(id) ?? null : null;
    ring.style.display = ringNode ? 'block' : 'none';
    if (!ringNode) return;
    // The ring the <svg> used to draw: 8 past the dot, 2.5 wide.
    const r = nodeRadius(ringNode) + 8;
    pulse.style.width = pulse.style.height = `${2 * r + 2.5}px`;
    pulse.style.margin = `${-(r + 1.25)}px`;
    pulse.style.borderColor = colourOf(ringNode) || '#FFD700';
    placeRing();
  };

  // A new size: the view slides by half the change, at the same zoom.
  const resize = (next) => {
    const t = recentre(heading ?? d3.zoomTransform(svg.node()), box, next);
    box = next;
    moveView(d3.zoomIdentity.translate(t.x, t.y).scale(t.k), 250);
  };

  // Restore the previous view if there is one (filter changes); otherwise put
  // you in the middle of the box. A phone starts zoomed out to fit, since the
  // outer tiers reach past its edges.
  if (savedTransform) {
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(savedTransform.x, savedTransform.y).scale(savedTransform.k));
  } else {
    const maxTierR = 520;
    const fitScale = isMobileGraph && box.width > 0 && box.height > 0
      ? Math.min(box.width / (maxTierR * 2.4), box.height / (maxTierR * 2.4)) : 1;
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(box.width / 2, box.height / 2).scale(fitScale));
  }

  // Expose focusNode for search — zooms to a specific node
  if (focusNodeRef) {
    focusNodeRef.current = (nodeId) => {
      const target = nodeById.get(nodeId);
      if (!target) return;
      const scale = 2.5;
      moveView(d3.zoomIdentity.translate(box.width / 2 - target.x * scale, box.height / 2 - target.y * scale).scale(scale), 750);
      select(nodeId);
    };
  }

  // On mobile: pre-compute static positions (no simulation jitter/reset on resize)
  if (isMobileGraph) {
    const tierGroups = {};
    nodes.forEach(n => { const t = n.tier || 'D'; if (!tierGroups[t]) tierGroups[t] = []; tierGroups[t].push(n); });
    Object.entries(tierGroups).forEach(([tier, group]) => {
      group.forEach((n, i) => {
        if (n.id === CENTER_ID) { n.x = 0; n.y = 0; n.fx = n.x; n.fy = n.y; return; }
        const r = tierRadius(tier);
        const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
        n.x = r * Math.cos(angle);
        n.y = r * Math.sin(angle);
        n.fx = n.x; n.fy = n.y; // Fixed positions — no physics
      });
    });
  }

  // Each force is today's value times its slider in the lab (1 when it's off).
  const linkBase = isMobileGraph ? 0 : layered ? 0.06 : 0.1;
  const radialBase = layered ? 0.45 : 0.3;
  const linkDistance = (d) => {
    const base = (d.near ? Math.max(40, radiusOf(d.target) - radiusOf(d.source)) : radiusOf(d.target)) * L.distance;
    if (L.sizeBy !== 'links') return base;
    // Sized by links a hub is big, so its circle starts at its edge rather than
    // under it; and a hub sits as far from you as its circle is wide, so the
    // circles go round you like petals instead of piling up in the middle.
    const petal = d.source.id === CENTER_ID ? 7 * Math.sqrt(circleOf.get(d.target.id) || 0) : 0;
    return base + nodeRadius(d.source) + nodeRadius(d.target) + petal;
  };
  const charge = d => (d.id === CENTER_ID ? -20 : -1) * L.push;
  // The center force pulls you, your connections and every hub; someone in a
  // circle mostly follows their hub, so each circle holds together round it
  // rather than being drawn into one even disc with all the others.
  const gravity = d => 0.15 * L.gravity * (hubs.has(d.id) ? 0.5 : d.degree >= 2 ? 0.2 : 1);
  // Thicker lines show more of themselves too, so a cluster's links read at a distance.
  // On a light page lines need more of themselves to read.
  const lineOpacity = () => (MAP_LOOK.light ? Math.min(0.7, 0.22 + 0.08 * L.lines) : Math.min(0.45, 0.1 + 0.05 * L.lines));
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(linkDistance).strength(Math.min(1, linkBase * L.pull)))
    .force('charge', d3.forceManyBody().strength(isMobileGraph ? 0 : charge))
    .force('center', isMobileGraph ? null : d3.forceCenter(0, 0))
    .force('gravityX', isMobileGraph ? null : d3.forceX(0).strength(gravity))
    .force('gravityY', isMobileGraph ? null : d3.forceY(0).strength(gravity))
    .force('collision', isMobileGraph ? null : d3.forceCollide().radius(d => nodeRadius(d) + 2))
    .force('radial', isMobileGraph ? null : d3.forceRadial(d => d.id === CENTER_ID ? 0 : radiusOf(d), 0, 0).strength(radialBase * L.rings));
  guidesG?.attr('opacity', Math.min(1, L.rings));
  simulation.on('end.guides', () => {
    for (const [tier, { ring, label }] of guideRings) {
      const out = nodes.filter((n) => n.tier === tier && n.id !== CENTER_ID).map((n) => Math.hypot(n.x || 0, n.y || 0)).sort((x, y) => x - y);
      if (!out.length) { ring.attr('opacity', 0); label.attr('opacity', 0); continue; }
      const r = out[Math.floor(out.length / 2)];
      ring.attr('r', r).attr('opacity', 1);
      label.attr('y', -r - 4).attr('opacity', 1);
    }
  });

  // Heat (Colour by → Heat): a soft glow behind the hotter dots, screen-blended
  // so the glows add up where powerful people cluster, like a thermal camera.
  // The hottest HEAT_GLOWS only, so a big network stays smooth.
  let heatFn = scheme?.heat || null;
  const heatDefs = svg.select('defs').size() ? svg.select('defs') : svg.append('defs');
  for (let k = 0; k <= 5; k++) {
    if (heatDefs.select(`#heat-glow-${k}`).size()) continue;
    const grad = heatDefs.append('radialGradient').attr('id', `heat-glow-${k}`);
    grad.append('stop').attr('offset', '0').attr('stop-color', heatColour(k / 5)).attr('stop-opacity', 0.14 + 0.06 * k);
    grad.append('stop').attr('offset', '1').attr('stop-color', heatColour(k / 5)).attr('stop-opacity', 0);
  }
  const heatG = g.append('g').attr('class', 'heat-glow').style('pointer-events', 'none').style('mix-blend-mode', 'screen');
  let heatDots = heatG.selectAll('circle');
  const drawHeat = () => {
    const hot = heatFn
      ? nodes.filter(n => n.id !== CENTER_ID && heatFn(n) >= 0.5).sort((a, b) => heatFn(b) - heatFn(a)).slice(0, HEAT_GLOWS)
      : [];
    heatDots = heatG.selectAll('circle').data(hot, d => d.id).join('circle')
      .attr('r', d => nodeRadius(d) * 2.5 + 12 + 30 * heatFn(d))
      .attr('fill', d => `url(#heat-glow-${Math.round(heatFn(d) * 5)})`)
      .attr('cx', d => d.x || 0).attr('cy', d => d.y || 0)
      .style('display', d => (clockAt == null || bornById.get(d.id) <= clockAt ? null : 'none'));
  };

  // forceLink has already swapped each link's ids for the nodes themselves, so
  // the colour is one step away. It used to search every node for every link:
  // about 1.8 s at 30,000 people.
  // The theme says whether a line takes the colour of the person it leads to, or one colour for all (lib/themes.js).
  const lineColour = (d) => (MAP_LOOK.lines === 'one' ? MAP_LOOK.line : colourOf(d.target) || '#333');
  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('class', 'gl')
    .attr('stroke', lineColour)
    .attr('stroke-opacity', lineOpacity()).attr('stroke-width', 0.5 * L.lines);

  // Catalyst outer glow rings (rendered behind the nodes)
  // A catalyst is the green outline on their dot (design C, with the scan
  // bars round it); the dashed glow ring that used to sit here hid the bars,
  // so it's only drawn for a catalyst with no bars.
  const catalysts = nodes.filter(n => n.is_catalyst && marks.get(n.id)?.bars == null);
  if (catalysts.length) {
    const defs = svg.select('defs').size() ? svg.select('defs') : svg.append('defs');
    if (!defs.select('#catalyst-glow-nm').size()) {
      const gf = defs.append('filter').attr('id', 'catalyst-glow-nm').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
      gf.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
      gf.append('feMerge').html('<feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/>');
    }
    g.append('g').selectAll('circle').data(catalysts).join('circle')
      .attr('r', d => nodeRadius(d) + 6)
      .attr('fill', 'none').attr('stroke', '#00ff88').attr('stroke-width', 2)
      .attr('stroke-dasharray', '3,3')
      .attr('filter', 'url(#catalyst-glow-nm)')
      .attr('cx', d => d.x || 0).attr('cy', d => d.y || 0)
      .attr('class', 'catalyst-ring');
  }

  // Design C round a connection's dot: five thin bars for how much of their
  // circle is scanned, and a small badge for how many in it are ready to scan.
  const ringed = nodes.filter((n) => marks.has(n.id));
  const dotRings = g.append('g').attr('class', 'dot-rings').style('pointer-events', 'none')
    .selectAll('g').data(ringed).join('g')
    .attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
  function drawDotRing(d) {
    const { bars, ready } = marks.get(d.id);
    const r = nodeRadius(d) + 3.5;
    const el = d3.select(this);
    el.selectAll('*').remove();
    if (bars != null) {
      for (const seg of ringSegments(r)) {
        el.append('path').attr('d', seg.d).attr('fill', 'none').attr('stroke-linecap', 'round')
          .attr('stroke-width', 1.6).attr('stroke', seg.i < bars ? RING.filled : RING.empty);
      }
    }
    if (ready > 0) {
      const at = r * 0.72;
      el.append('circle').attr('cx', at).attr('cy', at).attr('r', 5.5).attr('fill', RING.badge);
      el.append('text').attr('x', at).attr('y', at + 2.5).attr('text-anchor', 'middle')
        .attr('font-size', 7).attr('font-weight', 700).attr('fill', '#fff').text(ready > 9 ? '9+' : ready);
    }
  }
  dotRings.each(drawDotRing);

  // How the theme draws a dot (lib/themes.js DOTS). Droplet: a drop of glass,
  // lit from the top left and clear at the rim, with a fine edge (Glass).
  // Flat: one plain fill and quiet names, as Obsidian draws its notes. Glow: a
  // soft light round each (Space, Synthwave; up to 6,000 dots). Solid otherwise.
  const dotStyle = MAP_LOOK.dots;
  const defs = svg.select('defs').size() ? svg.select('defs') : svg.append('defs');
  const drops = new Map();
  const dotFill = (colour) => {
    if (dotStyle !== 'droplet' || !colour || !/^#[0-9a-f]{6}$/i.test(colour)) return colour;
    if (!drops.has(colour)) {
      if (drops.size >= 64) return colour;   // a map with more colours than that (Heat): plain fills
      const id = `drop-${drops.size}`;
      const grad = defs.append('radialGradient').attr('id', id).attr('cx', '50%').attr('cy', '50%').attr('r', '50%').attr('fx', '34%').attr('fy', '30%');
      grad.append('stop').attr('offset', '0').attr('stop-color', '#ffffff').attr('stop-opacity', 0.95);
      grad.append('stop').attr('offset', '0.22').attr('stop-color', colour).attr('stop-opacity', 0.9);
      grad.append('stop').attr('offset', '0.72').attr('stop-color', colour).attr('stop-opacity', 0.5);
      grad.append('stop').attr('offset', '1').attr('stop-color', colour).attr('stop-opacity', 0.12);
      drops.set(colour, `url(#${id})`);
    }
    return drops.get(colour);
  };
  const nodeG = g.append('g');
  if (dotStyle === 'glow' && nodes.length <= 6000) {
    if (!defs.select('#dot-glow').size()) {
      const f = defs.append('filter').attr('id', 'dot-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      f.append('feGaussianBlur').attr('stdDeviation', 2.2).attr('result', 'b');
      f.append('feMerge').html('<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>');
    }
    nodeG.attr('filter', 'url(#dot-glow)');
  }
  const node = nodeG.selectAll('circle').data(nodes).join('circle')
    .attr('class', 'gn')
    .attr('r', nodeRadius)
    .attr('fill', d => d.id === CENTER_ID ? MAP_LOOK.you : dotFill(colourOf(d)))
    .attr('fill-opacity', d => (dotStyle === 'droplet' || dotStyle === 'plain' ? 1 : d.degree >= 3 ? 0.55 : d.degree === 2 ? 0.75 : 1))
    .attr('stroke', d => {
      if (d.id === CENTER_ID) return '#FFD700';
      if (d.is_catalyst) return '#00ff88';
      // Plain: an analysis tool's node, a solid dot with a thin dark ring.
      return dotStyle === 'droplet' ? colourOf(d) : dotStyle === 'plain' ? '#2b2b2b' : 'none';
    })
    .attr('stroke-opacity', d => (d.id === CENTER_ID || d.is_catalyst ? 1 : dotStyle === 'droplet' ? 0.45 : dotStyle === 'plain' ? 0.75 : 1))
    .attr('stroke-width', d => {
      if (d.id === CENTER_ID) return 3;
      if (d.is_catalyst) return 2.5;
      return dotStyle === 'droplet' ? 0.7 : dotStyle === 'plain' ? 0.8 : 0;
    })
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      if (d.id === CENTER_ID) return;
      select(d.id);
      onSelect(d);
    });

  const tooltip = createTooltip();
  // Profile photo hover — shows pfp over the dot, falls back to text tooltip
  const photoTooltip = d3.select('body').append('div')
    .attr('class', 'graph-tooltip')
    .style('position', 'fixed').style('top', '0px').style('left', '0px')
    .style('pointer-events', 'none').style('opacity', 0)
    .style('z-index', 1001).style('transition', 'opacity 0.15s');

  // Their branch: everyone who hangs off them, all the way down, and the chain
  // back to you. Hovering lights it up in the lab, like Obsidian's graph.
  const kids = new Map();
  for (const [child, parent] of parentOf) {
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(child);
  }
  const lightBranch = (d) => {
    const lit = new Set([CENTER_ID, d.id]);
    const stack = [d.id];
    while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!lit.has(k)) { lit.add(k); stack.push(k); }
    for (let p = parentOf.get(d.id), hops = 0; p != null && hops < 7; p = parentOf.get(p), hops++) lit.add(p);
    node.classed('lit', n => lit.has(n.id));
    link.classed('lit', l => lit.has(l.source.id) && lit.has(l.target.id));
    g.classed('lab-focus', true);
  };

  // Moving from one dot to the next shouldn't flash the whole Galaxy back on in
  // between: the dimming lifts a moment after the pointer leaves, unless it lands on another.
  let unlight = null;
  node.on('mouseover', function (event, d) {
    easeRadius(this, nodeRadius(d) * 1.5);
    clearTimeout(unlight);
    if (L.on && L.branch && d.id !== CENTER_ID) lightBranch(d);
    if (d.profile_image_url && d.id !== CENTER_ID) {
      const size = Math.max(48, nodeRadius(d) * 5);
      photoTooltip.style('opacity', 1);
      renderPhoto(photoTooltip, d, size, tierColors[d.tier] || '#555');
      photoTooltip
        .style('left', (event.clientX - size / 2) + 'px')
        .style('top', (event.clientY - size - 8) + 'px');
      tooltip.style('opacity', 1)
        .html(`<strong>${esc(d.name)}</strong>`)
        .style('left', (event.clientX - 40) + 'px')
        .style('top', (event.clientY + 12) + 'px')
        .style('text-align', 'center').style('min-width', '80px');
    } else {
      tooltip.style('opacity', 1)
        .html(`<strong>${esc(d.name)}</strong>${d.company ? '<br/>' + esc(d.company) : ''}${d.tier ? '<br/>Tier: ' + esc(d.tier) : ''}`)
        .style('left', (event.clientX + 12) + 'px').style('top', (event.clientY - 10) + 'px');
    }
  }).on('mousemove', function (event, d) {
    if (d.profile_image_url && d.id !== CENTER_ID) {
      const size = Math.max(48, nodeRadius(d) * 5);
      photoTooltip.style('left', (event.clientX - size / 2) + 'px').style('top', (event.clientY - size - 8) + 'px');
      tooltip.style('left', (event.clientX - 40) + 'px').style('top', (event.clientY + 12) + 'px');
    } else {
      tooltip.style('left', (event.clientX + 12) + 'px').style('top', (event.clientY - 10) + 'px');
    }
  }).on('mouseout', function (event, d) {
    easeRadius(this, nodeRadius(d));
    clearTimeout(unlight);
    unlight = setTimeout(() => g.classed('lab-focus', false), 120);
    tooltip.style('opacity', 0);
    photoTooltip.style('opacity', 0);
  });

  setupDrag(node, simulation, CENTER_ID);

  // Names for you, your S-tier connections and catalysts; further out (the
  // Degree filter) only on hover, or hundreds of S-tier names pile up. The lab
  // can show all your connections' names, or none.
  // Filter → Names turns them all off; whoever Find matches (40 or fewer) is
  // named either way.
  let findHit = null;
  const labelled = (n) => {
    if (findHit && findHit.size <= 40 && findHit.has(n.id)) return true;
    if (!L.labels) return false;
    return n.id === CENTER_ID || (n.degree === 1 && (L.names === 'all' || n.tier === 'S' || n.is_catalyst || hubs.has(n.id)));
  };
  labelsG = g.append('g').classed('far', d3.zoomTransform(svg.node()).k < FAR);
  let labels = labelsG.selectAll('text');
  const drawLabels = () => {
    labels = labelsG.selectAll('text').data(nodes.filter(labelled), d => d.id).join('text')
      .text(d => d.is_catalyst && d.tier !== 'S' ? d.name + ' ⚡' : d.name)
      .attr('class', d => (d.id === CENTER_ID || hubs.has(d.id) ? 'hub' : null))
      // A hub's name grows with its dot, so it still reads with everyone on screen.
      .attr('font-size', d => d.id === CENTER_ID ? 14 : hubs.has(d.id) ? Math.max(12, Math.min(22, nodeRadius(d) * 0.5)) : 10)
      .attr('font-weight', d => d.id === CENTER_ID || hubs.has(d.id) ? 700 : 500)
      .attr('fill', d => {
        if (d.id === CENTER_ID) return MAP_LOOK.text;
        if (dotStyle === 'flat') return MAP_LOOK.light ? '#4d5566' : '#b9bec8';   // Obsidian's grey names
        if (dotStyle === 'plain') return MAP_LOOK.text;                          // an analysis tool's black labels
        if (d.is_catalyst) return MAP_LOOK.light ? '#0b7a47' : '#00ff88';
        return colourOf(d);
      })
      .attr('text-anchor', 'middle').attr('dy', d => nodeRadius(d) + 14)
      .attr('x', d => d.x || 0).attr('y', d => d.y || 0)
      .style('pointer-events', 'none');
  };
  drawLabels();

  const catalystRings = g.selectAll('.catalyst-ring');

  const paint = () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('cx', d => d.x).attr('cy', d => d.y);
    catalystRings.attr('cx', d => d.x).attr('cy', d => d.y);
    dotRings.attr('transform', d => `translate(${d.x},${d.y})`);
    labels.attr('x', d => d.x).attr('y', d => d.y);
    if (heatFn) heatDots.attr('cx', d => d.x).attr('cy', d => d.y);
    placeRing();
  };
  let tickedAt = 0;
  simulation.on('tick', () => {
    tickedAt = performance.now();
    paint();
    if (fitArmed && simulation.alpha() < SETTLED) { fitArmed = false; fitView(); }
  });

  // Fit: everyone on screen, once the layout has settled (a layout picked in
  // the lab, or its Fit button). Asked for through the clock's `fit` count.
  const SETTLED = 0.06;
  let fitArmed = false;
  let lastFit = clockNow().fit;
  const fitView = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach((n, i) => {
      if (!shown[i]) return;
      const r = nodeRadius(n);
      x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r); x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r);
    });
    if (!Number.isFinite(x0) || !box.width || !box.height) return;
    const k = Math.max(0.1, Math.min(2, Math.min(box.width / (x1 - x0 + 80), box.height / (y1 - y0 + 80))));
    moveView(d3.zoomIdentity.translate(box.width / 2 - ((x0 + x1) / 2) * k, box.height / 2 - ((y0 + y1) / 2) * k).scale(k), 750);
  };
  let fitCheck = null;
  const setFit = (fit) => {
    if (fit === lastFit) return;
    lastFit = fit;
    fitArmed = true;
    // A layout just picked restarts the forces a moment later; a settled one fits now.
    clearTimeout(fitCheck);
    fitCheck = setTimeout(() => {
      if (fitArmed && simulation.alpha() < SETTLED && performance.now() - tickedAt > 100) { fitArmed = false; fitView(); }
    }, 150);
  };

  // Orbit (the lab's slider): the whole map turns round you, everyone at once,
  // so nothing moves against anything else and the layout keeps its shape
  // (each circle spinning on its own hub was tried: while the forces were still
  // settling it dragged every circle off its hub). Moved in place every frame
  // rather than by the forces, so it costs a repaint; a big network repaints
  // every second or third frame, at the same speed. Never with Reduce Motion,
  // nor on a phone (whose layout has no physics).
  const every = nodes.length > 12000 ? 3 : nodes.length > 3000 ? 2 : 1;
  let orbitTimer = null;
  let lastT = 0;
  let frame = 0;
  const turn = (elapsed) => {
    if (++frame % every) return;
    const dt = Math.min(0.1, (elapsed - lastT) / 1000);
    lastT = elapsed;
    if (dt <= 0) return;
    const a = 0.1 * L.orbit * dt;   // radians this frame
    const c = Math.cos(a), sn = Math.sin(a);
    for (const n of nodes) {
      if (n.fx != null) continue;   // you, and anyone being dragged
      const { x, y } = n;
      n.x = x * c - y * sn;
      n.y = x * sn + y * c;
      // Its momentum turns with it, or while the forces settle it drifts the old way.
      if (n.vx) { const vx = n.vx; n.vx = vx * c - n.vy * sn; n.vy = vx * sn + n.vy * c; }
    }
    // While the forces run, their tick paints.
    if (performance.now() - tickedAt > 50) paint();
  };
  const setOrbit = () => {
    const on = !isMobileGraph && L.orbit > 0 && !reducedMotion();
    if (on && !orbitTimer) { lastT = 0; frame = 0; orbitTimer = d3.timer(turn); }
    if (!on && orbitTimer) { orbitTimer.stop(); orbitTimer = null; }
  };

  // A slider moved: change the running layout in place and let it settle again.
  const setLab = (next) => {
    if (isMobileGraph) {
      if (next.labels !== L.labels) { L = { ...L, labels: next.labels }; drawLabels(); showBorn(); }
      return;
    }
    const prev = L;
    L = next;
    const sized = prev.dotSize !== L.dotSize || prev.sizeBy !== L.sizeBy;
    if (sized) {
      node.attr('r', nodeRadius);
      catalystRings.attr('r', d => nodeRadius(d) + 6);
      dotRings.each(drawDotRing);
      simulation.force('collision').radius(d => nodeRadius(d) + 2);
      if (ringNode) select(ringNode.id);
    }
    if (prev.lines !== L.lines) link.attr('stroke-width', 0.5 * L.lines).attr('stroke-opacity', lineOpacity());
    if (sized || prev.names !== L.names || prev.labels !== L.labels) { drawLabels(); showBorn(); }
    if (!L.on || !L.branch) g.classed('lab-focus', false);
    g.classed('lab-pop', L.on && nodes.length < 5000);
    if (prev.orbit !== L.orbit) setOrbit();
    const forces = FORCE_KEYS.some(k => prev[k] !== L[k]);
    if (!forces && !sized) return;
    simulation.force('link').distance(linkDistance).strength(Math.min(1, linkBase * L.pull));
    simulation.force('charge').strength(charge);
    simulation.force('gravityX').strength(gravity);
    simulation.force('gravityY').strength(gravity);
    simulation.force('radial').strength(radialBase * L.rings);
    guidesG?.attr('opacity', Math.min(1, L.rings));
    simulation.alpha(Math.max(simulation.alpha(), 0.5)).restart();
  };
  g.classed('lab-pop', L.on && nodes.length < 5000);

  // The replay: whoever wasn't there yet at the clock's time is hidden. Only the
  // dots that change are touched, so a frame costs little at 30,000 people.
  const born = bornTimes(nodes, parentOf);
  const bornById = new Map(nodes.map((n, i) => [n.id, born[i]]));
  const nodeEls = node.nodes();
  const linkEls = link.nodes();   // links[i] is connections[i], which is nodes[i + 1]
  const extraEls = new Map();
  dotRings.each(function (d) { extraEls.set(d.id, [this]); });
  catalystRings.each(function (d) { extraEls.set(d.id, [...(extraEls.get(d.id) || []), this]); });
  const shown = new Uint8Array(nodes.length).fill(1);
  const idxOf = new Map(nodes.map((n, i) => [n.id, i]));
  const d1 = nodes.filter(n => n.degree === 1);
  const dated = d1.map(n => bornById.get(n.id)).filter(Number.isFinite);
  const range = { min: dated.length ? dated.reduce((m, t) => Math.min(m, t)) : null, max: dated.length ? dated.reduce((m, t) => Math.max(m, t)) : null, of: d1.length };
  let clockAt = null;
  const showBorn = () => {
    const born = d => (clockAt == null || bornById.get(d.id) <= clockAt ? null : 'none');
    labels.style('display', born);
    if (heatFn) heatDots.style('display', born);
  };
  drawHeat();
  const setTime = (at) => {
    if (!L.on) at = null;
    clockAt = at;
    let n1 = 0;
    for (let i = 1; i < nodes.length; i++) {
      const vis = at == null || born[i] <= at ? 1 : 0;
      if (vis && nodes[i].degree === 1) n1++;
      if (vis === shown[i]) continue;
      shown[i] = vis;
      const display = vis ? '' : 'none';
      nodeEls[i].style.display = display;
      if (linkEls[i - 1]) linkEls[i - 1].style.display = display;
      for (const el of extraEls.get(nodes[i].id) || []) el.style.display = display;
    }
    // A line to another way in shows while both its ends do.
    for (let j = connections.length; j < links.length; j++) {
      const vis = shown[idxOf.get(links[j].source.id)] && shown[idxOf.get(links[j].target.id)];
      linkEls[j].style.display = vis ? '' : 'none';
    }
    showBorn();
    if (!stamp) return;
    stamp.style.display = at == null ? 'none' : 'block';
    if (at != null) {
      const when = new Date(at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      const job = chapterAt(clockNow().social, at);
      stamp.textContent = `${when} · ${n1.toLocaleString()} of ${range.of.toLocaleString()} connections${job ? ` · at ${job.company}` : ''}`;
    }
  };

  // A new colour scheme (Colour by): recolour the dots, lines and names in place.
  const setColours = (next) => {
    colourOf = next.of;
    heatFn = next.heat || null;
    drawHeat();
    node.attr('fill', d => d.id === CENTER_ID ? MAP_LOOK.you : dotFill(colourOf(d)));
    link.attr('stroke', lineColour);
    drawLabels();
    showBorn();
    if (ringNode) select(ringNode.id);
  };

  // Find: whoever matches stays lit and the rest dim; each Enter (a new `fly`)
  // flies to the best-scored match and opens their card.
  let lastFind = '';
  let lastFly = clockNow().fly;
  const setFind = (query, fly) => {
    const q = L.on ? String(query || '') : '';
    if (q !== lastFind) {
      lastFind = q;
      findHit = findMatches(nodes.filter(n => n.id !== CENTER_ID), q);
      node.classed('found', n => !!findHit?.has(n.id));
      link.classed('found', l => !!findHit?.has(l.target.id));
      g.classed('lab-find', !!findHit);
      drawLabels();
      showBorn();
      setClock({ found: findHit ? findHit.size : 0 });
    }
    if (fly !== lastFly) {
      lastFly = fly;
      const best = findHit && nodes.filter(n => findHit.has(n.id)).sort((a, b) => (b.power_score || 0) - (a.power_score || 0))[0];
      if (best) {
        const k = 2.5;
        moveView(d3.zoomIdentity.translate(box.width / 2 - best.x * k, box.height / 2 - best.y * k).scale(k), 750);
        select(best.id);
        onSelect(best);
      }
    }
  };

  setOrbit();
  const dispose = () => { orbitTimer?.stop(); orbitTimer = null; clearTimeout(fitCheck); };
  return { simulation, resize, select, setLab, setTime, setColours, setFind, setFit, dispose, range };
}

function setupDrag(node, simulation, fixedId) {
  node.call(d3.drag()
    .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      if (d.id !== fixedId) { d.fx = null; d.fy = null; }
    }));
}
