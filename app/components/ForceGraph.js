'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

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

// Only paths this app itself produces, or ordinary remote images. Anything else
// (javascript:, data:, an attribute-escaping payload) renders nothing.
function safeImageUrl(url) {
  const value = String(url ?? '');
  return /^\/avatars\/[A-Za-z0-9_-]+\.(webp|png|jpe?g)$/.test(value) || /^https:\/\/[^"'\s<>]+$/.test(value)
    ? value
    : null;
}

// Builds the avatar tooltip through the DOM rather than a string, so no value
// can break out of the attribute it is written into.
function renderPhoto(sel, d, size, borderColor) {
  sel.selectAll('*').remove();
  const src = safeImageUrl(d.profile_image_url);
  if (!src) { sel.style('opacity', 0); return; }
  sel.append('img')
    .attr('src', src)
    .style('width', size + 'px').style('height', size + 'px')
    .style('border-radius', '50%').style('object-fit', 'cover')
    .style('border', `2px solid ${borderColor}`).style('display', 'block')
    .on('error', function () { this.parentElement.style.display = 'none'; });
}

export default function ForceGraph({ connections, degree2 = [], onSelect, tierColors, mode, focusNodeRef, userName }) {
  const svgRef = useRef(null);
  const zoomTransformRef = useRef(null);  // Persist zoom across re-renders
  const prevModeRef = useRef(mode);       // Track mode changes
  const zoomToClusterRef = useRef(null);  // Function to zoom into a bridge cluster
  const zoomOutRef = useRef(null);        // Function to zoom back to full view
  const [focusedCluster, setFocusedCluster] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const updateSize = () => {
      setDimensions({ width: container.clientWidth, height: container.clientHeight });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Listen for cluster focus events from D3
  useEffect(() => {
    const handler = (e) => setFocusedCluster(e.detail);
    window.addEventListener('cluster-focus', handler);
    return () => window.removeEventListener('cluster-focus', handler);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !connections.length) return;
    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Did the mode change? If so, reset zoom. Otherwise preserve it.
    const modeChanged = mode !== prevModeRef.current;
    prevModeRef.current = mode;
    const savedTransform = modeChanged ? null : zoomTransformRef.current;

    if (mode === 'degrees') {
      renderDegreesMode(svg, width, height, connections, degree2, onSelect, tierColors, savedTransform, zoomTransformRef, userName, zoomToClusterRef, zoomOutRef);
    } else {
      renderNetworkMode(svg, width, height, connections, onSelect, tierColors, focusNodeRef, savedTransform, zoomTransformRef, userName);
    }

    return () => { d3.selectAll('.graph-tooltip').remove(); };
  }, [connections, degree2, dimensions, onSelect, tierColors, mode]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} style={{ background: '#0a0a1a' }} />
      {/* Back to all clusters button — shows when zoomed into a cluster */}
      {focusedCluster && mode === 'degrees' && (
        <button onClick={() => {
          setFocusedCluster(null);
          if (zoomOutRef.current) zoomOutRef.current();
        }} style={{
          position: 'absolute', top: 16, left: 16, zIndex: 20,
          padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, fontWeight: 600,
          backdropFilter: 'blur(8px)',
        }}>← All Bridges</button>
      )}
      <div style={{ position: 'absolute', bottom: 20, left: 20, display: 'flex', gap: 12, fontSize: 11, color: '#888' }}>
        {Object.entries(tierColors).map(([tier, color]) => (
          <span key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {tier}
          </span>
        ))}
        {mode === 'degrees' && (<>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 0, border: '2px solid #00ff88', background: 'transparent', display: 'inline-block' }} />
            Mutual
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ff88', display: 'inline-block' }} />
            Catalyst
          </span>
        </>
        )}
      </div>
    </div>
  );
}

function createTooltip() {
  return d3.select('body').append('div')
    .attr('class', 'graph-tooltip')
    .style('position', 'absolute').style('background', 'rgba(0,0,0,0.92)').style('color', '#fff')
    .style('padding', '8px 12px').style('border-radius', '6px').style('font-size', '12px')
    .style('pointer-events', 'none').style('opacity', 0).style('z-index', 1000)
    .style('border', '1px solid rgba(255,255,255,0.2)').style('max-width', '280px');
}

function renderNetworkMode(svg, width, height, connections, onSelect, tierColors, focusNodeRef, savedTransform, zoomTransformRef, userName) {
  const centerNode = {
    id: 'blake', name: userName || 'You', tier: 'center', degree: 0,
    power_score: 10, fx: width / 2, fy: height / 2,
  };

  const nodes = [centerNode, ...connections.map(c => ({
    id: c.id, name: c.name, tier: c.tier, degree: 1,
    power_score: parseFloat(c.power_score) || 1,
    company: c.company, role: c.role, headline: c.headline,
    profile_url: c.profile_url, profile_image_url: c.profile_image_url,
    connected_date: c.connected_date,
    seniority_score: c.seniority_score, company_prestige_score: c.company_prestige_score,
    influence_signals: c.influence_signals,
    is_catalyst: c.is_catalyst, catalyst_score: c.catalyst_score,
    circle_power: c.circle_power, circle_s_count: c.circle_s_count, circle_a_count: c.circle_a_count,
  }))];

  const links = connections.map(c => ({ source: 'blake', target: c.id }));

  const tierRadius = (tier) => {
    switch (tier) { case 'S': return 150; case 'A': return 250; case 'B': return 350; case 'C': return 450; default: return 520; }
  };

  const nodeRadius = (d) => {
    if (d.id === 'blake') return 18;
    return Math.max(3, Math.min(12, (d.power_score || 1) * 1.3));
  };

  const g = svg.append('g');
  const zoomBehavior = d3.zoom().scaleExtent([0.3, 4]).on('zoom', (e) => {
    g.attr('transform', e.transform);
    if (zoomTransformRef) zoomTransformRef.current = e.transform;
  });
  svg.call(zoomBehavior);

  // Restore previous zoom position if available (filter changes, sidebar toggles)
  if (savedTransform) {
    svg.call(zoomBehavior.transform, savedTransform);
  }

  // Expose focusNode for search — zooms to a specific node
  if (focusNodeRef) {
    focusNodeRef.current = (nodeId) => {
      const target = nodes.find(n => n.id === nodeId);
      if (!target) return;
      const scale = 2.5;
      const tx = width / 2 - target.x * scale;
      const ty = height / 2 - target.y * scale;
      svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
      // Add selection glow
      g.selectAll('.selected-glow').remove();
      g.append('circle')
        .attr('class', 'selected-glow')
        .attr('cx', target.x).attr('cy', target.y).attr('r', nodeRadius(target) + 8)
        .attr('fill', 'none').attr('stroke', tierColors[target.tier] || '#FFD700')
        .attr('stroke-width', 2.5).attr('stroke-opacity', 0.8)
        .style('animation', 'selectedPulse 1.5s ease-in-out infinite');
    };
  }

  // On mobile: pre-compute static positions (no simulation jitter/reset on resize)
  const isMobileGraph = width < 768;
  if (isMobileGraph) {
    const tierGroups = {};
    nodes.forEach(n => { const t = n.tier || 'D'; if (!tierGroups[t]) tierGroups[t] = []; tierGroups[t].push(n); });
    Object.entries(tierGroups).forEach(([tier, group]) => {
      group.forEach((n, i) => {
        if (n.id === 'blake') { n.x = width / 2; n.y = height / 2; n.fx = n.x; n.fy = n.y; return; }
        const r = tierRadius(tier);
        const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
        n.x = width / 2 + r * Math.cos(angle);
        n.y = height / 2 + r * Math.sin(angle);
        n.fx = n.x; n.fy = n.y; // Fixed positions — no physics
      });
    });
  }

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => tierRadius(d.target.tier || 'D')).strength(isMobileGraph ? 0 : 0.1))
    .force('charge', d3.forceManyBody().strength(isMobileGraph ? 0 : (d => d.id === 'blake' ? -300 : -15)))
    .force('center', isMobileGraph ? null : d3.forceCenter(width / 2, height / 2))
    .force('collision', isMobileGraph ? null : d3.forceCollide().radius(d => nodeRadius(d) + 2))
    .force('radial', isMobileGraph ? null : d3.forceRadial(d => d.id === 'blake' ? 0 : tierRadius(d.tier), width / 2, height / 2).strength(0.3));

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', d => { const t = nodes.find(n => n.id === (d.target.id || d.target)); return tierColors[t?.tier] || '#333'; })
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
    .attr('fill', d => d.id === 'blake' ? '#fff' : tierColors[d.tier] || '#666')
    .attr('stroke', d => {
      if (d.id === 'blake') return '#FFD700';
      if (d.is_catalyst) return '#00ff88';
      return 'none';
    })
    .attr('stroke-width', d => {
      if (d.id === 'blake') return 3;
      if (d.is_catalyst) return 2.5;
      return 0;
    })
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      if (d.id === 'blake') return;
      // Remove previous selection glow
      g.selectAll('.selected-glow').remove();
      // Add breathing glow to selected node
      const r = nodeRadius(d);
      g.append('circle')
        .attr('class', 'selected-glow')
        .attr('cx', d.x).attr('cy', d.y).attr('r', r + 8)
        .attr('fill', 'none').attr('stroke', tierColors[d.tier] || '#FFD700')
        .attr('stroke-width', 2.5).attr('stroke-opacity', 0.8)
        .style('animation', 'selectedPulse 1.5s ease-in-out infinite');
      onSelect(d);
    });

  const tooltip = createTooltip();
  // Profile photo hover — shows pfp over the dot, falls back to text tooltip
  const photoTooltip = d3.select('body').append('div')
    .attr('class', 'graph-tooltip')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('z-index', 1001).style('transition', 'opacity 0.15s');

  node.on('mouseover', function (event, d) {
    d3.select(this).attr('r', nodeRadius(d) * 1.5);
    if (d.profile_image_url && d.id !== 'blake') {
      const size = Math.max(48, nodeRadius(d) * 5);
      photoTooltip.style('opacity', 1);
      renderPhoto(photoTooltip, d, size, tierColors[d.tier] || '#555');
      photoTooltip
        .style('left', (event.pageX - size / 2) + 'px')
        .style('top', (event.pageY - size - 8) + 'px');
      tooltip.style('opacity', 1)
        .html(`<strong>${esc(d.name)}</strong>`)
        .style('left', (event.pageX - 40) + 'px')
        .style('top', (event.pageY + 12) + 'px')
        .style('text-align', 'center').style('min-width', '80px');
    } else {
      tooltip.style('opacity', 1)
        .html(`<strong>${esc(d.name)}</strong>${d.company ? '<br/>' + esc(d.company) : ''}${d.tier ? '<br/>Tier: ' + esc(d.tier) : ''}`)
        .style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 10) + 'px');
    }
  }).on('mousemove', function (event, d) {
    if (d.profile_image_url && d.id !== 'blake') {
      const size = Math.max(48, nodeRadius(d) * 5);
      photoTooltip.style('left', (event.pageX - size / 2) + 'px').style('top', (event.pageY - size - 8) + 'px');
      tooltip.style('left', (event.pageX - 40) + 'px').style('top', (event.pageY + 12) + 'px');
    } else {
      tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY - 10) + 'px');
    }
  }).on('mouseout', function (event, d) {
    d3.select(this).attr('r', nodeRadius(d));
    tooltip.style('opacity', 0);
    photoTooltip.style('opacity', 0);
  });

  setupDrag(node, simulation, 'blake');

  const labels = g.append('g').selectAll('text')
    .data(nodes.filter(n => n.id === 'blake' || n.tier === 'S' || n.is_catalyst))
    .join('text')
    .text(d => d.is_catalyst && d.tier !== 'S' ? d.name + ' ⚡' : d.name)
    .attr('font-size', d => d.id === 'blake' ? 14 : 10)
    .attr('font-weight', d => d.id === 'blake' ? 700 : 500)
    .attr('fill', d => {
      if (d.id === 'blake') return '#fff';
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
    // Move selection glow with the node
    g.selectAll('.selected-glow').each(function() {
      const el = d3.select(this);
      const match = nodes.find(n => n.x && Math.abs(n.x - parseFloat(el.attr('cx'))) < 30);
      if (match) { el.attr('cx', match.x).attr('cy', match.y); }
    });

  });

  // Auto-fit zoom ONLY on small screens (mobile) where content overflows
  if (!savedTransform && width > 0 && width < 768) {
    const maxTierR = 520;
    const fitScale = Math.min(width / (maxTierR * 2.4), height / (maxTierR * 2.4));
    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(fitScale).translate(-width / 2, -height / 2);
    svg.call(zoomBehavior.transform, initialTransform);
    if (zoomTransformRef) zoomTransformRef.current = initialTransform;
  }

}

function renderDegreesMode(svg, width, height, allD1, degree2, onSelect, tierColors, savedTransform, zoomTransformRef, userName, zoomToClusterRef, zoomOutRef) {
  const d1Urls = new Set(allD1.map(c => c.profile_url));
  const bridgeIds = [...new Set(degree2.map(d => d.source_connection_id).filter(Boolean))];
  const bridges = allD1.filter(c => bridgeIds.includes(c.id));
  const numBridges = Math.max(bridges.length, 1);
  const cx = width / 2, cy = height / 2;

  // Per-tier orbit distance from Blake — S closest, A further, etc.
  const bridgeTierOrbit = { S: 350, A: 600, B: 820, C: 1000, D: 1150 };
  const tierRing = { S: 40, A: 70, B: 100, C: 125, D: 145 };
  const tierOrder = ['S', 'A', 'B', 'C', 'D'];

  // --- Build nodes ---
  const centerNode = {
    id: 'blake', name: userName || 'You', tier: 'center', degree: 0,
    power_score: 10, nodeType: 'center', fx: cx, fy: cy,
  };

  // Group bridges by tier so same-tier bridges are spaced around their ring
  const tierCounts = {};
  const tierIndex = {};
  bridges.forEach(c => {
    const t = c.tier || 'D';
    tierCounts[t] = (tierCounts[t] || 0) + 1;
    tierIndex[c.id] = (tierIndex[c.id] || 0);
  });
  const tierCounter = {};
  const bridgeNodes = bridges.map((c) => {
    const t = c.tier || 'D';
    const count = tierCounts[t] || 1;
    const idx = tierCounter[t] || 0;
    tierCounter[t] = idx + 1;
    const orbitR = bridgeTierOrbit[t] || 600;
    const angleOffset = { S: 0, A: Math.PI / 7, B: Math.PI / 4, C: Math.PI / 3, D: Math.PI / 2.5 };
    const angle = (2 * Math.PI * idx) / count + (angleOffset[t] || 0);
    return {
      id: c.id, name: c.name, tier: c.tier, degree: 1, nodeType: 'bridge',
      power_score: parseFloat(c.power_score) || 1,
      company: c.company, role: c.role, headline: c.headline,
      profile_url: c.profile_url, profile_image_url: c.profile_image_url,
      seniority_score: c.seniority_score,
      company_prestige_score: c.company_prestige_score,
      is_catalyst: c.is_catalyst, catalyst_score: c.catalyst_score,
      circle_power: c.circle_power, circle_s_count: c.circle_s_count, circle_a_count: c.circle_a_count,
      unlocked_from_bridge_id: c.unlocked_from_bridge_id,
      unlocked_from_name: c.unlocked_from_name,
      _orbitRadius: orbitR,
      x: cx + Math.cos(angle) * orbitR,
      y: cy + Math.sin(angle) * orbitR,
    };
  });

  const d2Nodes = [];
  bridgeNodes.forEach(bridge => {
    const myD2 = degree2.filter(c => c.source_connection_id === bridge.id);
    const byTier = {};
    tierOrder.forEach(t => { byTier[t] = []; });
    myD2.forEach(c => { (byTier[c.tier] || byTier['D']).push(c); });
    tierOrder.forEach(tier => {
      const group = byTier[tier];
      const ring = tierRing[tier];
      group.forEach((c, i) => {
        const angle = (2 * Math.PI * i) / Math.max(group.length, 1) - Math.PI / 2;
        const isMutual = d1Urls.has(c.profile_url);
        d2Nodes.push({
          id: c.id, name: c.name, tier: c.tier, degree: 2, nodeType: 'degree2',
          power_score: parseFloat(c.power_score) || 1,
          company: c.company, role: c.role, headline: c.headline,
          profile_url: c.profile_url, profile_image_url: c.profile_image_url,
          source_connection_id: c.source_connection_id,
          seniority_score: c.seniority_score, company_prestige_score: c.company_prestige_score,
          isMutual, unlock_status: c.unlock_status,
          x: bridge.x + Math.cos(angle) * ring,
          y: bridge.y + Math.sin(angle) * ring,
        });
      });
    });
  });

  const nodes = [centerNode, ...bridgeNodes, ...d2Nodes];
  const links = [
    ...bridgeNodes.map(b => ({ source: 'blake', target: b.id, linkType: 'bridge' })),
    ...d2Nodes.map(d => ({ source: d.source_connection_id, target: d.id, linkType: 'degree2' })),
  ];

  // Index for fast lookup in forces
  const bridgeById = {};
  bridgeNodes.forEach(b => { bridgeById[b.id] = b; });

  const nodeRadius = (d) => {
    if (d.nodeType === 'center') return 24;
    if (d.nodeType === 'bridge') return 16;
    return Math.max(4, Math.min(10, (d.power_score || 1) * 1.1));
  };

  // --- SVG setup ---
  const g = svg.append('g');
  const zoomBehavior = d3.zoom().scaleExtent([0.15, 5]).on('zoom', (e) => {
    g.attr('transform', e.transform);
    if (zoomTransformRef) zoomTransformRef.current = e.transform;
  });
  svg.call(zoomBehavior);

  // Restore previous zoom position if available
  if (savedTransform) {
    svg.call(zoomBehavior.transform, savedTransform);
  }

  // Expose zoom-to-cluster: smoothly zoom into a bridge node's position
  if (zoomToClusterRef) {
    zoomToClusterRef.current = (bridgeNode) => {
      const scale = 2.5;
      const tx = width / 2 - bridgeNode.x * scale;
      const ty = height / 2 - bridgeNode.y * scale;
      svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    };
  }

  // Expose zoom-out: return to the auto-fit view
  if (zoomOutRef) {
    zoomOutRef.current = () => {
      const maxOrbit = bridgeNodes.length > 0 ? Math.max(...bridgeNodes.map(b => b._orbitRadius || 500)) : 500;
      const fitR = maxOrbit + 200;
      const fitScale = Math.min(width / (fitR * 2.2), height / (fitR * 2.2), 0.85);
      svg.transition().duration(750).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(fitScale).translate(-cx, -cy)
      );
    };
  }

  // --- Defs: gradients, glows, filters ---
  const defs = svg.append('defs');
  const baseClusterColors = ['#FFD700', '#FF6B35', '#9B59B6', '#3498DB'];
  let colorIdx = 0;
  const CATALYST_COLOR = '#00ff88';
  bridgeNodes.forEach((bridge, bi) => {
    const color = bridge.is_catalyst ? CATALYST_COLOR : baseClusterColors[colorIdx++ % baseClusterColors.length];
    bridge._clusterColor = color;
    const grad = defs.append('radialGradient').attr('id', `nebula-${bi}`);
    grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.08);
    grad.append('stop').attr('offset', '40%').attr('stop-color', color).attr('stop-opacity', 0.03);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
  });
  const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
  glowFilter.append('feMerge').html('<feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/>');
  const bridgeGlowF = defs.append('filter').attr('id', 'bridge-glow').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
  bridgeGlowF.append('feGaussianBlur').attr('stdDeviation', '8').attr('result', 'blur');
  bridgeGlowF.append('feMerge').html('<feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/>');
  defs.append('style').text(`
    @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
    @keyframes selectedPulse { 0%,100% { stroke-opacity: 0.4; r: attr(r); } 50% { stroke-opacity: 1; } }
    .bridge-pulse { animation: pulse 2s ease-in-out infinite; }
    @keyframes boundary-breathe { 0%,100% { stroke-opacity: 0.5; } 50% { stroke-opacity: 0.75; } }
    .boundary-ring { animation: boundary-breathe 3s ease-in-out infinite; }
  `);
  const boundaryGlow = defs.append('filter').attr('id', 'boundary-glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
  boundaryGlow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  boundaryGlow.append('feMerge').html('<feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/>');

  // --- Cluster decoration groups (move as a unit on tick) ---
  const clusterGroups = bridgeNodes.map((bridge, bi) => {
    const cg = g.append('g');
    const color = bridge._clusterColor;
    const d2Count = d2Nodes.filter(n => n.source_connection_id === bridge.id).length;
    const sCount = d2Nodes.filter(n => n.source_connection_id === bridge.id && n.tier === 'S').length;

    // Nebula background
    cg.append('circle').attr('r', 200).attr('fill', `url(#nebula-${bi})`);
    // Tier band separators — filled rings between each tier for visual layering
    const tierBands = [
      { inner: 0, outer: 55, color: tierColors['S'], opacity: 0.06 },   // S zone (innermost)
      { inner: 55, outer: 85, color: tierColors['A'], opacity: 0.05 },  // A zone
      { inner: 85, outer: 112, color: tierColors['B'], opacity: 0.04 }, // B zone
      { inner: 112, outer: 137, color: tierColors['C'], opacity: 0.03 },// C zone
      { inner: 137, outer: 165, color: tierColors['D'], opacity: 0.02 },// D zone (outermost)
    ];
    tierBands.forEach(band => {
      // Filled band
      const arc = d3.arc().innerRadius(band.inner).outerRadius(band.outer).startAngle(0).endAngle(2 * Math.PI);
      cg.append('path').attr('d', arc()).attr('fill', band.color).attr('opacity', band.opacity);
    });
    // Tier ring lines — colored per tier
    const ringDefs = [
      { r: 40, color: tierColors['S'], w: 1.5, dash: 'none' },
      { r: 70, color: tierColors['A'], w: 0.8, dash: '4,4' },
      { r: 100, color: tierColors['B'], w: 0.8, dash: '4,4' },
      { r: 125, color: tierColors['C'], w: 0.6, dash: '3,5' },
      { r: 145, color: tierColors['D'], w: 0.6, dash: '3,5' },
    ];
    ringDefs.forEach(rd => {
      cg.append('circle').attr('r', rd.r).attr('fill', 'none')
        .attr('stroke', rd.color).attr('stroke-opacity', 0.2)
        .attr('stroke-width', rd.w).attr('stroke-dasharray', rd.dash);
    });
    // Glow halo
    cg.append('circle').attr('r', 25).attr('fill', color).attr('opacity', 0.15).attr('class', 'bridge-pulse');
    // Catalyst badge
    if (bridge.is_catalyst) {
      cg.append('rect').attr('x', -40).attr('y', -185).attr('width', 80).attr('height', 18)
        .attr('rx', 9).attr('fill', CATALYST_COLOR).attr('opacity', 0.9);
      cg.append('text').attr('y', -172).text('CATALYST').attr('fill', '#000').attr('font-size', 9)
        .attr('font-weight', 800).attr('text-anchor', 'middle').attr('letter-spacing', 1);
    }
    // Title
    cg.append('text').attr('y', bridge.is_catalyst ? -160 : -170)
      .text(bridge.name + (bridge.company ? ' · ' + bridge.company : ''))
      .attr('fill', color).attr('font-size', 10).attr('font-weight', 600)
      .attr('text-anchor', 'middle').attr('opacity', 0.8);
    cg.append('text').attr('y', bridge.is_catalyst ? -148 : -158)
      .text(d2Count + ' connections · ' + sCount + ' S-tier')
      .attr('fill', 'rgba(255,255,255,0.35)').attr('font-size', 8).attr('text-anchor', 'middle');

    return cg;
  });

  // --- Animated cluster boundaries ---
  // Each cluster gets a solid glowing ring that NEVER overlaps another cluster.
  // Where two clusters are close, both boundaries flatten at the exact midpoint.
  const boundaryR = 170;
  const boundaryPoints = 64;
  const boundaryPaths = bridgeNodes.map((bridge, bi) => {
    // Boundary color follows the outermost tier (D) — creates the "containment" feel
    // Inner tiers glow their own color, outer boundary is neutral
    return g.append('path')
      .attr('fill', 'none')
      .attr('stroke', tierColors['D'])
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('filter', 'url(#boundary-glow)')
      .attr('class', 'boundary-ring');
  });

  function updateBoundaries() {
    bridgeNodes.forEach((bridge, bi) => {
      const pts = [];
      for (let p = 0; p < boundaryPoints; p++) {
        const angle = (2 * Math.PI * p) / boundaryPoints;
        let r = boundaryR;

        // Soft deform: boundary bends smoothly toward nearby clusters, never crossing midpoint
        for (let oi = 0; oi < bridgeNodes.length; oi++) {
          if (bi === oi) continue;
          const other = bridgeNodes[oi];
          const dx = other.x - bridge.x, dy = other.y - bridge.y;
          const distBetween = Math.sqrt(dx * dx + dy * dy);
          if (distBetween < boundaryR * 2.5) {
            const angleToOther = Math.atan2(dy, dx);
            let angleDiff = Math.abs(angle - angleToOther);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            if (angleDiff < Math.PI / 1.5) {
              const maxR = (distBetween / 2) - 6;
              // Smooth cosine blend — creates a gentle dent, not a hard flat
              const influence = Math.pow(Math.cos(angleDiff * 1.5 / Math.PI * (Math.PI / 2)), 2);
              const targetR = Math.max(maxR, 35);
              if (targetR < r) {
                r = r * (1 - influence) + targetR * influence;
              }
            }
          }
        }
        pts.push([bridge.x + Math.cos(angle) * r, bridge.y + Math.sin(angle) * r]);
      }
      boundaryPaths[bi].attr('d', d3.line().curve(d3.curveCardinalClosed.tension(0.3))(pts));
    });
  }

  // --- Bridge connecting lines ---
  const bridgeLines = g.append('g').selectAll('line').data(bridgeNodes).join('line')
    .attr('stroke', d => d._clusterColor).attr('stroke-opacity', 0.4).attr('stroke-width', 2.5);

  // --- Discovery chain lines ---
  const chainData = bridgeNodes.filter(b => b.unlocked_from_bridge_id && bridgeById[b.unlocked_from_bridge_id]);
  const chainLines = g.append('g').selectAll('line').data(chainData).join('line')
    .attr('stroke', '#FF6B35').attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,4').attr('stroke-opacity', 0.5);
  const chainLabels = g.append('g').selectAll('text').data(chainData).join('text')
    .text(d => 'unlocked via ' + (d.unlocked_from_name || bridgeById[d.unlocked_from_bridge_id]?.name || ''))
    .attr('fill', 'rgba(255,107,53,0.5)').attr('font-size', 8)
    .attr('text-anchor', 'middle').style('pointer-events', 'none');

  // --- D2 links (subtle, rendered after settle) ---
  let d2LinkGroup = null;

  // --- Nodes ---
  const node = g.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('r', nodeRadius)
    .attr('fill', d => {
      if (d.nodeType === 'center') return '#fff';
      if (d.nodeType === 'bridge') return tierColors[d.tier] || '#FFD700';
      return tierColors[d.tier] || '#666';
    })
    .attr('stroke', d => {
      if (d.nodeType === 'center') return '#FFD700';
      if (d.nodeType === 'bridge') return '#fff';
      if (d.isMutual) return '#00ff88';
      if (d.tier === 'S') return 'rgba(255,215,0,0.5)';
      return 'none';
    })
    .attr('stroke-width', d => {
      if (d.nodeType === 'center') return 3;
      if (d.nodeType === 'bridge') return 3;
      if (d.isMutual) return 2.5;
      if (d.tier === 'S') return 1.5;
      return 0;
    })
    .attr('filter', d => (d.nodeType === 'bridge') ? 'url(#bridge-glow)' : (d.tier === 'S' ? 'url(#glow)' : null))
    .style('cursor', 'pointer');

  // --- Labels ---
  const labelNodes = nodes.filter(n =>
    n.nodeType === 'center' || n.nodeType === 'bridge' || (n.degree === 2 && n.power_score >= 7)
  );
  const labels = g.append('g').selectAll('text').data(labelNodes).join('text')
    .text(d => d.name)
    .attr('font-size', d => d.nodeType === 'center' ? 15 : d.nodeType === 'bridge' ? 13 : 9)
    .attr('font-weight', d => d.nodeType === 'center' || d.nodeType === 'bridge' ? 700 : 600)
    .attr('fill', d => {
      if (d.nodeType === 'center') return '#fff';
      if (d.nodeType === 'bridge') return '#fff';
      return tierColors[d.tier] || '#FF6B35';
    })
    .attr('text-anchor', 'middle')
    .attr('dy', d => nodeRadius(d) + (d.nodeType === 'bridge' ? 24 : 15))
    .style('pointer-events', 'none')
    .style('text-shadow', d => d.nodeType === 'bridge' ? '0 0 10px rgba(0,0,0,0.8)' : 'none');

  // --- Force simulation ---
  // Bridges: positioned by physics (orbit + charge)
  // D2 nodes: positioned by computed angles (no physics fighting)
  const bridgeLinks = links.filter(l => l.linkType === 'bridge');

  // Pre-compute even angular positions for every d2 node per tier per cluster
  const nodeTargets = new Map();
  const clustersByBridge = {};
  d2Nodes.forEach(n => {
    const cid = n.source_connection_id;
    if (!clustersByBridge[cid]) clustersByBridge[cid] = {};
    const tier = n.tier || 'D';
    if (!clustersByBridge[cid][tier]) clustersByBridge[cid][tier] = [];
    clustersByBridge[cid][tier].push(n);
  });
  // Offset each tier's starting angle so rings don't stack on top of each other
  const tierOffset = { S: 0, A: Math.PI / 5, B: Math.PI / 3, C: Math.PI / 2.2, D: Math.PI / 1.7 };
  // Max radius is inside the boundary line
  const maxNodeRadius = 160;
  for (const cid in clustersByBridge) {
    for (const tier in clustersByBridge[cid]) {
      const group = clustersByBridge[cid][tier];
      const radius = Math.min(tierRing[tier] || 130, maxNodeRadius);
      const offset = tierOffset[tier] || 0;
      group.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / group.length + offset;
        nodeTargets.set(n.id, { angle, radius, bridgeId: cid });
      });
    }
  }

  const simulation = d3.forceSimulation(nodes)
    .force('charge', d3.forceManyBody().strength(d => {
      if (d.nodeType === 'center') return 0;
      if (d.nodeType === 'bridge') return -400;
      return 0;  // d2 has NO charge — positions are computed, not physics-driven
    }))
    .force('bridgeOrbit', (() => {
      let _nodes, _blake;
      const force = (alpha) => {
        if (!_blake) return;
        const bx = _blake.fx ?? _blake.x, by = _blake.fy ?? _blake.y;
        for (const n of _nodes) {
          if (n.nodeType !== 'bridge') continue;
          const targetR = n._orbitRadius || 500;
          const dx = n.x - bx, dy = n.y - by;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const diff = dist - targetR;
          n.vx -= (dx / dist) * diff * alpha * 0.4;
          n.vy -= (dy / dist) * diff * alpha * 0.4;
        }
      };
      force.initialize = (n) => { _nodes = n; _blake = n.find(x => x.id === 'blake'); };
      return force;
    })())
    .force('clusterPositioning', (() => {
      // Each d2 node has a pre-computed angle + radius relative to its bridge.
      // This force pulls it to that exact spot. No charge needed, no bunching possible.
      // Nodes form perfect evenly-spaced circles on each tier ring.
      let _nodes;
      const force = (alpha) => {
        for (const n of _nodes) {
          if (n.nodeType !== 'degree2') continue;
          const target = nodeTargets.get(n.id);
          if (!target) continue;
          const bridge = bridgeById[target.bridgeId];
          if (!bridge) continue;
          let r = target.radius;
          // Match boundary deformation exactly — dots must stay inside
          // Uses the SAME math as updateBoundaries() so they track together
          for (let oi = 0; oi < bridgeNodes.length; oi++) {
            const other = bridgeNodes[oi];
            if (other.id === target.bridgeId) continue;
            const dx = other.x - bridge.x, dy = other.y - bridge.y;
            const distBetween = Math.sqrt(dx * dx + dy * dy);
            if (distBetween < boundaryR * 2.5) {
              const angleToOther = Math.atan2(dy, dx);
              let angleDiff = Math.abs(target.angle - angleToOther);
              if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
              if (angleDiff < Math.PI / 1.5) {
                // Boundary sits at (distBetween/2 - 6), dots need margin inside that
                const boundaryAtAngle = (distBetween / 2) - 6;
                const dotMax = boundaryAtAngle - 12;  // 12px inside boundary
                const influence = Math.pow(Math.cos(angleDiff * 1.5 / Math.PI * (Math.PI / 2)), 2);
                const targetR = Math.max(dotMax, 25);
                if (targetR < r) {
                  r = r * (1 - influence) + targetR * influence;
                }
              }
            }
          }
          const tx = bridge.x + Math.cos(target.angle) * r;
          const ty = bridge.y + Math.sin(target.angle) * r;
          n.vx += (tx - n.x) * alpha * 0.6;
          n.vy += (ty - n.y) * alpha * 0.6;
        }
      };
      force.initialize = (n) => { _nodes = n; };
      return force;
    })())
    .force('collision', d3.forceCollide().radius(d => d.nodeType === 'bridge' ? 20 : 0))
    .force('link', d3.forceLink(bridgeLinks).id(d => d.id)
      .distance(d => d.target?._orbitRadius || 500).strength(0.01)
    )
    .alphaDecay(0.02)
    .velocityDecay(0.4);

  // --- Tick: update all positions ---
  let settled = false;
  simulation.on('tick', () => {
    // Nodes
    node.attr('cx', d => d.x).attr('cy', d => d.y);
    labels.attr('x', d => d.x).attr('y', d => d.y);
    // Cluster decorations follow their bridge
    clusterGroups.forEach((cg, i) => {
      cg.attr('transform', `translate(${bridgeNodes[i].x},${bridgeNodes[i].y})`);
    });
    // Animated boundaries — deform where clusters overlap
    updateBoundaries();
    // Bridge connecting lines
    const blakeX = centerNode.fx ?? centerNode.x, blakeY = centerNode.fy ?? centerNode.y;
    bridgeLines.attr('x1', blakeX).attr('y1', blakeY)
      .attr('x2', d => d.x).attr('y2', d => d.y);
    // Discovery chain lines
    chainLines
      .attr('x1', d => bridgeById[d.unlocked_from_bridge_id]?.x || 0)
      .attr('y1', d => bridgeById[d.unlocked_from_bridge_id]?.y || 0)
      .attr('x2', d => d.x).attr('y2', d => d.y);
    chainLabels
      .attr('x', d => ((bridgeById[d.unlocked_from_bridge_id]?.x || 0) + d.x) / 2)
      .attr('y', d => ((bridgeById[d.unlocked_from_bridge_id]?.y || 0) + d.y) / 2 - 8);
    // D2 links — render once after simulation settles
    if (!settled && simulation.alpha() < 0.05) {
      settled = true;
      const d2Links = links.filter(l => l.linkType === 'degree2');
      d2LinkGroup = g.insert('g', ':first-child').selectAll('line').data(d2Links).join('line')
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
        .attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 0.3);
    }
    if (d2LinkGroup) {
      d2LinkGroup.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    }
  });

  // --- Drag ---
  setupDrag(node, simulation, 'blake');

  // --- Tooltip + Photo Hover (same as Network Map) ---
  const tooltip = createTooltip();
  const photoTooltip = d3.select('body').append('div')
    .attr('class', 'graph-tooltip')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('z-index', 1001).style('transition', 'opacity 0.15s');

  node.on('mouseover', function (event, d) {
    d3.select(this).attr('r', nodeRadius(d) * 1.5).attr('filter', 'url(#glow)');

    // Photo hover
    if (d.profile_image_url && d.id !== 'blake') {
      const size = Math.max(48, nodeRadius(d) * 4);
      photoTooltip.style('opacity', 1);
      renderPhoto(photoTooltip, d, size, tierColors[d.tier] || '#555');
      photoTooltip
        .style('left', (event.pageX - size / 2) + 'px')
        .style('top', (event.pageY - size - 8) + 'px');
    }

    // Text tooltip below
    const bridgeFor = d.nodeType === 'bridge'
      ? d2Nodes.filter(n => n.source_connection_id === d.id).length + ' connections' : null;
    const viaBridge = d.nodeType === 'degree2'
      ? bridgeNodes.find(b => b.id === d.source_connection_id)?.name : null;
    tooltip.style('opacity', 1)
      .html([
        `<strong>${esc(d.name)}</strong>`,
        d.role ? esc(d.role.substring(0, 60)) : '',
        d.company ? `<span style="color:${tierColors[d.tier] || '#888'}">@ ${esc(d.company)}</span>` : '',
        d.tier && d.tier !== 'center' ? `Tier ${esc(d.tier)} · Score: ${parseFloat(d.power_score).toFixed(1)}` : '',
        bridgeFor ? `<span style="color:#FFD700">${esc(bridgeFor)}</span>` : '',
        viaBridge ? `<span style="color:#FF6B35">via ${esc(viaBridge)}</span>` : '',
        d.isMutual ? '<span style="color:#00ff88">Mutual connection</span>' : '',
      ].filter(Boolean).join('<br/>'))
      .style('left', (event.pageX + 12) + 'px').style('top', (event.pageY + 12) + 'px');
  }).on('mousemove', function (event, d) {
    if (d.profile_image_url && d.id !== 'blake') {
      const size = Math.max(48, nodeRadius(d) * 4);
      photoTooltip.style('left', (event.pageX - size / 2) + 'px').style('top', (event.pageY - size - 8) + 'px');
    }
    tooltip.style('left', (event.pageX + 12) + 'px').style('top', (event.pageY + 12) + 'px');
  }).on('mouseout', function (event, d) {
    d3.select(this).attr('r', nodeRadius(d))
      .attr('filter', (d.nodeType === 'bridge') ? 'url(#bridge-glow)' : (d.tier === 'S' ? 'url(#glow)' : null));
    tooltip.style('opacity', 0);
    photoTooltip.style('opacity', 0);
  });

  // --- Click: select + Connect to Unlock overlay ---
  node.on('click', (event, d) => {
    if (d.id === 'blake') return;
    // Selection glow
    g.selectAll('.selected-glow').remove();
    g.append('circle')
      .attr('class', 'selected-glow')
      .attr('cx', d.x).attr('cy', d.y).attr('r', nodeRadius(d) + 8)
      .attr('fill', 'none').attr('stroke', tierColors[d.tier] || '#FFD700')
      .attr('stroke-width', 2.5).attr('stroke-opacity', 0.8)
      .style('animation', 'selectedPulse 1.5s ease-in-out infinite');
    onSelect(d);
    // Bridge click: zoom into this cluster
    if (d.nodeType === 'bridge' && zoomToClusterRef?.current) {
      zoomToClusterRef.current(d);
      // Update React state via a custom event
      window.dispatchEvent(new CustomEvent('cluster-focus', { detail: { id: d.id, name: d.name } }));
    }
    g.selectAll('.unlock-overlay').remove();
    if (d.nodeType === 'degree2' && (d.tier === 'S' || d.tier === 'A') && d.unlock_status !== 'unlocked') {
      simulation.stop();
      const ox = d.x, oy = d.y;
      const overlay = g.append('g').attr('class', 'unlock-overlay');
      // Dim non-path nodes
      node.transition().duration(300)
        .attr('opacity', n => (n.id === d.id || n.id === 'blake' || n.id === d.source_connection_id) ? 1 : 0.2);
      labels.transition().duration(300)
        .attr('opacity', n => (n.id === d.id || n.id === 'blake' || n.id === d.source_connection_id) ? 1 : 0.1);
      // Phantom cluster
      [30, 55, 80].forEach(r => {
        overlay.append('circle').attr('cx', ox).attr('cy', oy).attr('r', r)
          .attr('fill', 'none').attr('stroke', 'rgba(255,215,0,0.12)')
          .attr('stroke-dasharray', '4,4').attr('stroke-width', 0.8);
      });
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8, r = 30 + Math.random() * 50;
        overlay.append('circle').attr('cx', ox + Math.cos(a)*r).attr('cy', oy + Math.sin(a)*r)
          .attr('r', 3 + Math.random()*3).attr('fill', 'rgba(255,255,255,0.06)')
          .attr('stroke', 'rgba(255,255,255,0.08)').attr('stroke-width', 0.5);
      }
      // Path highlight
      const bridge = bridgeById[d.source_connection_id];
      const blake = centerNode;
      if (blake && bridge) {
        overlay.append('line').attr('x1', blake.x).attr('y1', blake.y).attr('x2', bridge.x).attr('y2', bridge.y)
          .attr('stroke', '#FFD700').attr('stroke-width', 2).attr('stroke-opacity', 0.6);
        overlay.append('line').attr('x1', bridge.x).attr('y1', bridge.y).attr('x2', ox).attr('y2', oy)
          .attr('stroke', '#FF6B35').attr('stroke-width', 2).attr('stroke-opacity', 0.6);
      }
      // Status card
      const isPending = d.unlock_status === 'pending';
      overlay.append('rect').attr('x', ox-70).attr('y', oy-115).attr('width', 140).attr('height', isPending ? 40 : 55)
        .attr('rx', 8).attr('fill', 'rgba(0,0,0,0.92)')
        .attr('stroke', isPending ? 'rgba(255,165,0,0.5)' : 'rgba(255,215,0,0.4)').attr('stroke-width', 1);
      overlay.append('text').attr('x', ox).attr('y', oy-97)
        .text(isPending ? 'PENDING...' : 'LOCKED PATH')
        .attr('fill', isPending ? '#FFA500' : '#FFD700').attr('font-size', 9).attr('font-weight', 800)
        .attr('text-anchor', 'middle').attr('letter-spacing', 1);
      if (!isPending) {
        overlay.append('rect').attr('x', ox-60).attr('y', oy-84).attr('width', 120).attr('height', 24).attr('rx', 6)
          .attr('fill', '#FFD700').style('cursor', 'pointer')
          .on('click', (e) => {
            e.stopPropagation();
            const bridgeNode = bridgeById[d.source_connection_id];
            fetch('/api/unlock', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({connectionId:d.id, bridgeId:d.source_connection_id, bridgeName:bridgeNode?.name||''}) }).catch(()=>{});
            window.open(d.profile_url, '_blank');
            overlay.select('text').text('PENDING...');
          });
        overlay.append('text').attr('x', ox).attr('y', oy-68).text('Connect to Unlock')
          .attr('fill', '#000').attr('font-size', 10).attr('font-weight', 700).attr('text-anchor', 'middle').style('pointer-events', 'none');
      } else {
        overlay.append('text').attr('x', ox).attr('y', oy-82).text('Run scraper to check')
          .attr('fill', '#888').attr('font-size', 9).attr('text-anchor', 'middle');
      }
      event.stopPropagation();
      svg.on('click.unlock', () => {
        node.transition().duration(300).attr('opacity', 1);
        labels.transition().duration(300).attr('opacity', 1);
        g.selectAll('.unlock-overlay').remove();
        svg.on('click.unlock', null);
        simulation.alpha(0.1).restart();
      });
    }
  });

  // --- Auto-zoom to fit the layout (only on first render, not when restoring zoom) ---
  if (!savedTransform) {
    const maxOrbit = bridgeNodes.length > 0 ? Math.max(...bridgeNodes.map(b => b._orbitRadius || 500)) : 500;
    const fitR = maxOrbit + 200;
    const fitScale = Math.min(width / (fitR * 2.2), height / (fitR * 2.2), 0.85);
    const initialTransform = d3.zoomIdentity.translate(width/2, height/2).scale(fitScale).translate(-cx, -cy);
    svg.call(zoomBehavior.transform, initialTransform);
    if (zoomTransformRef) zoomTransformRef.current = initialTransform;
  }
}

function setupDrag(node, simulation, fixedId) {
  node.call(d3.drag()
    .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      if (d.id !== fixedId && d.nodeType !== 'bridge') { d.fx = null; d.fy = null; }
    }));
}
