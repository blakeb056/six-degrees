'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { localPhoto } from '../../lib/photos';
import { recentre } from '../../lib/galaxy';

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
@media (prefers-reduced-motion: reduce) {
  .galaxy-ring-pulse { animation: none; opacity: 0.8; }
}`;

export default function ForceGraph({ connections, onSelect, tierColors, focusNodeRef, userName, selectedId = null }) {
  const svgRef = useRef(null);
  const ringRef = useRef(null);
  const sceneRef = useRef(null);  // The scene on screen: { resize, select }
  // The view, kept across rebuilds: the zoom, and the size of box it was set for.
  const viewRef = useRef({ transform: null, size: null });
  const sizeRef = useRef(null);
  const [dimensions, setDimensions] = useState(null);

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
    const scene = renderNetworkMode(svg, ringRef.current, size, connections, select, tierColors, focusNodeRef, saved, viewRef, userName);
    sceneRef.current = scene;
    scene.select(selectedIdRef.current);

    return () => {
      // Stop the force simulation this render started.
      //
      // It used to be left running. Every rebuild — and the scene used to
      // rebuild on any resize — added another simulation still ticking over
      // the same nodes, so they fought each other and the graph shook.
      // Refreshing made it worse because nothing ever stopped the old ones.
      scene.simulation.stop();
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
  }, [connections, tierColors, measured]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <style>{RING_CSS}</style>
      <svg ref={svgRef} width={dimensions?.width ?? 800} height={dimensions?.height ?? 600} style={{ background: '#0a0a1a' }} />
      {/* The selection ring. The scene places it over the selected dot. */}
      <div ref={ringRef} className="galaxy-ring" style={{
        position: 'absolute', left: 0, top: 0, display: 'none',
        pointerEvents: 'none', transformOrigin: '0 0',
      }}>
        <div className="galaxy-ring-pulse" style={{ boxSizing: 'border-box', border: '2.5px solid', borderRadius: '50%' }} />
      </div>
      <div style={{ position: 'absolute', bottom: 20, left: 20, display: 'flex', gap: 12, fontSize: 11, color: '#888' }}>
        {Object.entries(tierColors).map(([tier, color]) => (
          <span key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {tier}
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
    .style('border', '1px solid rgba(255,255,255,0.2)').style('max-width', '280px');
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
function renderNetworkMode(svg, ring, box, connections, onSelect, tierColors, focusNodeRef, savedTransform, viewRef, userName) {
  const centerNode = {
    id: CENTER_ID, name: userName || 'You', tier: 'center', degree: 0,
    power_score: 10, fx: 0, fy: 0,
  };

  const nodes = [centerNode, ...connections.map(c => ({
    id: c.id, name: c.name, tier: c.tier, degree: 1,
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

  const links = connections.map(c => ({ source: CENTER_ID, target: c.id }));

  const tierRadius = (tier) => {
    switch (tier) { case 'S': return 150; case 'A': return 250; case 'B': return 350; case 'C': return 450; default: return 520; }
  };

  const nodeRadius = (d) => {
    if (d.id === CENTER_ID) return 18;
    return Math.max(3, Math.min(12, (d.power_score || 1) * 1.3));
  };

  // A phone. Judged by the window, as the page judges it, not by the graph's
  // own box: that narrowed whenever a panel opened on a laptop.
  const isMobileGraph = window.innerWidth < 768;

  const g = svg.append('g');
  // Where the view is going while a transition takes it there. A resize part-way
  // through re-fits the destination, and a rebuild starts from it, rather than
  // from a point along the way.
  let heading = null;
  const zoomBehavior = d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => {
    g.attr('transform', e.transform);
    viewRef.current = { transform: heading ?? e.transform, size: box };
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
    pulse.style.borderColor = tierColors[ringNode.tier] || '#FFD700';
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

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => tierRadius(d.target.tier || 'D')).strength(isMobileGraph ? 0 : 0.1))
    .force('charge', d3.forceManyBody().strength(isMobileGraph ? 0 : (d => d.id === CENTER_ID ? -300 : -15)))
    .force('center', isMobileGraph ? null : d3.forceCenter(0, 0))
    .force('collision', isMobileGraph ? null : d3.forceCollide().radius(d => nodeRadius(d) + 2))
    .force('radial', isMobileGraph ? null : d3.forceRadial(d => d.id === CENTER_ID ? 0 : tierRadius(d.tier), 0, 0).strength(0.3));

  // forceLink has already swapped each link's ids for the nodes themselves, so
  // the colour is one step away. It used to search every node for every link:
  // about 1.8 s at 30,000 people.
  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', d => tierColors[d.target.tier] || '#333')
    .attr('stroke-opacity', 0.15).attr('stroke-width', 0.5);

  // Catalyst outer glow rings (rendered behind the nodes)
  const catalysts = nodes.filter(n => n.is_catalyst);
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

  const node = g.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('r', nodeRadius)
    .attr('fill', d => d.id === CENTER_ID ? '#fff' : tierColors[d.tier] || '#666')
    .attr('stroke', d => {
      if (d.id === CENTER_ID) return '#FFD700';
      if (d.is_catalyst) return '#00ff88';
      return 'none';
    })
    .attr('stroke-width', d => {
      if (d.id === CENTER_ID) return 3;
      if (d.is_catalyst) return 2.5;
      return 0;
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

  node.on('mouseover', function (event, d) {
    easeRadius(this, nodeRadius(d) * 1.5);
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
    tooltip.style('opacity', 0);
    photoTooltip.style('opacity', 0);
  });

  setupDrag(node, simulation, CENTER_ID);

  const labels = g.append('g').selectAll('text')
    .data(nodes.filter(n => n.id === CENTER_ID || n.tier === 'S' || n.is_catalyst))
    .join('text')
    .text(d => d.is_catalyst && d.tier !== 'S' ? d.name + ' ⚡' : d.name)
    .attr('font-size', d => d.id === CENTER_ID ? 14 : 10)
    .attr('font-weight', d => d.id === CENTER_ID ? 700 : 500)
    .attr('fill', d => {
      if (d.id === CENTER_ID) return '#fff';
      if (d.is_catalyst) return '#00ff88';
      return tierColors[d.tier];
    })
    .attr('text-anchor', 'middle').attr('dy', d => nodeRadius(d) + 14)
    .style('pointer-events', 'none');

  const catalystRings = g.selectAll('.catalyst-ring');

  simulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('cx', d => d.x).attr('cy', d => d.y);
    catalystRings.attr('cx', d => d.x).attr('cy', d => d.y);
    labels.attr('x', d => d.x).attr('y', d => d.y);
    placeRing();
  });

  return { simulation, resize, select };
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
