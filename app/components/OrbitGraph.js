'use client';

/**
 * Orbit — the galaxy from the v2 build, ported.
 *
 * Different from the original Galaxy view in three ways that matter:
 *  - Tiers are *orbits*. Higher leverage sits closer to you, so distance from
 *    the centre means something rather than being wherever the force settled.
 *  - Second-degree people render as small dots fanned in an arc just outside
 *    the connection who leads to them, so a bridge with a big circle behind it
 *    reads as a cluster at a glance.
 *  - Drag a 1st-degree node and it stays where you drop it if it is a bridge;
 *    leaves re-settle. Double-click releases it.
 *
 * Imperative D3 over a ref'd <svg>: React renders the shell, d3-selection owns
 * everything inside it, so the simulation mutates positions without React churn.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  drag,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  select,
  zoom,
  zoomIdentity,
  zoomTransform,
} from 'd3';
import { TIER_COLORS, TIER_ORDER, TIER_RING_RADIUS, initialsFor } from '../../lib/tiers';

const GOLDEN_ANGLE = 2.399963;
const LABEL_ZOOM_THRESHOLD = 1.1;
const USER_RADIUS = 26;
const HUB_FALLBACK = 14;      // hubs to show when no circle has been mapped yet
const STANDARD_RADIUS = 4.5;  // context nodes: one circle each, nothing more

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Every string here came from a scraped web page. TRAPS §11.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

const OrbitGraph = forwardRef(function OrbitGraph(
  { connections = [], degree2 = [], onSelect, userName = 'You', userImage = null, selectedId = null },
  ref
) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const zoomKRef = useRef(1);
  const savedTransformRef = useRef(null);
  const applySelectionRef = useRef(() => {});
  const focusNodeRef = useRef(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const isMobile = useIsMobile();

  // The parent recomputes these arrays on every render, so depending on their
  // identity rebuilds the whole scene constantly — and a rebuild that happens
  // before the simulation's first frame means it never ticks at all. With a
  // small network that settled in the gaps and looked fine; at 749 nodes and
  // 598 links every node stayed at 0,0. Depend on what is actually in them.
  const signature = useMemo(
    () => `${connections.length}:${degree2.length}:` +
          `${connections.map((c) => c.id).join(',')}|${degree2.map((c) => c.id).join(',')}`,
    [connections, degree2]
  );
  const dataRef = useRef({ connections, degree2 });

  useImperativeHandle(ref, () => ({ focusNode: (id) => focusNodeRef.current(id) }), []);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // Declared before the scene effect so it has already run when that rebuilds.
  useEffect(() => { dataRef.current = { connections, degree2 }; }, [connections, degree2]);

  // Measure synchronously first — first paint must not wait on ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Selection restyles existing nodes; it never rebuilds the simulation.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    applySelectionRef.current(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || size.w < 40 || size.h < 40) return undefined;

    const width = size.w;
    const height = size.h;

    // ---- nodes & links ---------------------------------------------------
    const { connections: liveConnections, degree2: liveDegree2 } = dataRef.current;
    const visibleD1 = liveConnections;
    const d1ById = new Map(visibleD1.map((c) => [c.id, c]));
    const visibleD2 = liveDegree2.filter(
      (c) => c.source_connection_id && d1ById.has(c.source_connection_id)
    );

    // Only draw rings for tiers actually on screen — the filter lives upstream.
    const activeTiers = new Set(visibleD1.map((c) => c.tier).filter(Boolean));

    // Three weights, not one.
    //
    // Drawing all 754 connections at full weight — glow, avatar, clip path,
    // label — is both the lag and the mess: nothing stands out because
    // everything is equally loud. The people whose circle you have opened are
    // the subject; everyone else is context. A hub is someone with a mapped
    // circle, falling back to the strongest people when nothing is mapped yet,
    // so the view is never empty of structure on a fresh network.
    const bridgeIds = new Set(liveDegree2.map((c) => c.source_connection_id).filter(Boolean));
    const hubIds = bridgeIds.size
      ? new Set(visibleD1.filter((c) => bridgeIds.has(c.id)).map((c) => c.id))
      : new Set(
          [...visibleD1]
            .sort((a, b) => (Number(b.power_score) || 0) - (Number(a.power_score) || 0))
            .slice(0, HUB_FALLBACK)
            .map((c) => c.id)
        );

    const userNode = {
      id: '__user__', kind: 'user', tier: null, r: USER_RADIUS,
      targetRadius: 0, connection: null, x: 0, y: 0, fx: 0, fy: 0,
    };

    const tierIndex = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    const d1Nodes = [];
    const d1NodeById = new Map();
    const d1AngleById = new Map();
    for (const c of visibleD1) {
      const tier = c.tier || 'D';
      const angle = (tierIndex[tier] = (tierIndex[tier] || 0) + 1, (tierIndex[tier] - 1) * GOLDEN_ANGLE);
      const ring = TIER_RING_RADIUS[tier] || TIER_RING_RADIUS.D;
      const isHub = hubIds.has(c.id);
      const n = {
        id: c.id, kind: 'd1', hub: isHub, tier,
        r: isHub ? 7 + Number(c.power_score || 0) * 1.1 : STANDARD_RADIUS,
        targetRadius: ring, connection: c,
        x: Math.cos(angle) * ring, y: Math.sin(angle) * ring,
      };
      d1Nodes.push(n);
      d1NodeById.set(c.id, n);
      d1AngleById.set(c.id, angle);
    }

    // Group each bridge's circle so it can be fanned beside them.
    const clusters = new Map();
    for (const c of visibleD2) {
      const key = c.source_connection_id;
      const list = clusters.get(key);
      if (list) list.push(c);
      else clusters.set(key, [c]);
    }

    const d2Nodes = [];
    const links = [];
    for (const [bridgeId, cluster] of clusters) {
      const bridgeNode = d1NodeById.get(bridgeId);
      if (!bridgeNode) continue;
      const baseAngle = d1AngleById.get(bridgeId) ?? 0;
      const ring = bridgeNode.targetRadius;
      const fanStep = Math.min(0.15, 1.5 / Math.max(1, cluster.length));
      cluster.forEach((c, j) => {
        const angle = baseAngle + (j - (cluster.length - 1) / 2) * fanStep;
        const radius = ring + 46 + (j % 3) * 13;
        const n = {
          id: c.id, kind: 'd2', tier: c.tier || 'D', r: 3.5,
          targetRadius: ring + 60, connection: c,
          x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
        };
        d2Nodes.push(n);
        links.push({ source: n, target: bridgeNode });
      });
    }

    const simNodes = [userNode, ...d1Nodes, ...d2Nodes];
    // Paint order: faint D2 first, then D1, the user on top.
    const renderNodes = [...d2Nodes, ...d1Nodes, userNode];

    // ---- static scene ----------------------------------------------------
    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const grad = defs.append('radialGradient').attr('id', 'og-user-grad');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#f8fafc');
    grad.append('stop').attr('offset', '55%').attr('stop-color', '#c7d2fe');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#818cf8');
    defs.append('filter').attr('id', 'og-blur')
      .attr('x', '-75%').attr('y', '-75%').attr('width', '250%').attr('height', '250%')
      .append('feGaussianBlur').attr('stdDeviation', 6);

    const viewport = svg.append('g').attr('class', 'viewport');
    const ringsLayer = viewport.append('g');
    const spokesLayer = viewport.append('g');
    const linksLayer = viewport.append('g');
    const nodesLayer = viewport.append('g');

    const hubNodes = d1Nodes.filter((d) => d.hub);
    const spoke = spokesLayer.selectAll('line').data(hubNodes, (d) => d.id).join('line')
      .attr('stroke', (d) => TIER_COLORS[d.tier] || TIER_COLORS.D)
      .attr('stroke-opacity', 0.09)
      .attr('stroke-width', 0.5);

    for (const tier of TIER_ORDER) {
      if (!activeTiers.has(tier)) continue;
      ringsLayer.append('circle')
        .attr('r', TIER_RING_RADIUS[tier])
        .attr('fill', 'none')
        .attr('stroke', TIER_COLORS[tier])
        .attr('stroke-opacity', 0.14)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 7');
    }

    const link = linksLayer.selectAll('line').data(links).join('line')
      .attr('stroke', 'rgba(255,255,255,0.08)').attr('stroke-width', 1);

    const node = nodesLayer.selectAll('g').data(renderNodes, (d) => d.id).join('g')
      .attr('cursor', 'pointer');

    node.each(function build(d) {
      const g = select(this);

      if (d.kind === 'd2') {
        g.attr('opacity', 0.55);
        g.append('circle').attr('class', 'og-base').attr('r', d.r)
          .attr('fill', TIER_COLORS[d.tier] || TIER_COLORS.D);
        return;   // selection ring is created on demand, see applySelection
      }

      const isUser = d.kind === 'user';
      const conn = d.connection;
      const color = isUser ? '#818cf8' : (TIER_COLORS[d.tier] || TIER_COLORS.D);

      // Context: one circle, no avatar, no initials, no label. Hovering or
      // selecting promotes it — the tooltip carries the detail, so nothing is
      // hidden, it is just not all shouted at once.
      if (!isUser && !d.hub) {
        g.attr('opacity', 0.75);
        g.append('circle').attr('class', 'og-base').attr('r', d.r).attr('fill', color);
        return;   // selection ring is created on demand, see applySelection
      }

      if (isUser || d.tier === 'S' || d.tier === 'A') {
        g.append('circle').attr('r', d.r * 1.8).attr('fill', color)
          .attr('opacity', 0.25).attr('filter', 'url(#og-blur)');
      }

      if (conn && conn.is_catalyst) {
        g.append('circle').attr('r', d.r + 3).attr('fill', 'none')
          .attr('stroke', TIER_COLORS.S).attr('stroke-width', 1).attr('stroke-opacity', 0.9);
        g.append('text').text('⚡').attr('x', d.r * 0.85).attr('y', -d.r * 0.7)
          .attr('font-size', 9).attr('text-anchor', 'middle').style('pointer-events', 'none');
      }

      // Initials always render; an avatar draws on top and removes itself on
      // error, so a dead image never leaves an empty circle.
      g.append('circle').attr('class', 'og-base').attr('r', d.r)
        .attr('fill', isUser ? 'url(#og-user-grad)' : color);

      const name = isUser ? userName : (conn?.name ?? '');
      g.append('text').attr('class', 'og-initials').text(initialsFor(name))
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', d.r * 0.8).attr('font-weight', 700)
        .attr('fill', '#0b0b16').style('pointer-events', 'none');

      const imageUrl = isUser ? userImage : (conn?.profile_image_url ?? null);
      if (imageUrl) {
        const clipId = `og-clip-${safeId(d.id)}`;
        defs.append('clipPath').attr('id', clipId).append('circle').attr('r', d.r);
        g.append('image')
          .attr('href', imageUrl)
          .attr('x', -d.r).attr('y', -d.r)
          .attr('width', d.r * 2).attr('height', d.r * 2)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .on('error', function onErr() { select(this).remove(); });
      }

      g.append('circle').attr('class', 'og-sel').attr('r', d.r + 5)
        .attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', 1.5)
        .style('opacity', 0);

      if (isUser) {
        g.append('text').text(userName).attr('y', d.r + 18)
          .attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 600)
          .attr('fill', '#e2e8f0').attr('paint-order', 'stroke')
          .attr('stroke', 'rgba(5,5,16,0.85)').attr('stroke-width', 3)
          .style('pointer-events', 'none');
      } else {
        g.append('text').attr('class', 'og-label').text(conn?.name ?? '')
          .attr('y', d.r + 13).attr('text-anchor', 'middle').attr('font-size', 10)
          .attr('fill', '#cbd5e1').attr('paint-order', 'stroke')
          .attr('stroke', 'rgba(5,5,16,0.8)').attr('stroke-width', 3)
          .style('pointer-events', 'none').style('opacity', 0)
          .style('transition', 'opacity 160ms ease');
      }
    });

    // ---- labels ----------------------------------------------------------
    const labels = node.select('text.og-label');
    let hoveredId = null;
    // S-tier and catalysts stay labelled so the map is scannable zoomed out.
    // Hubs carry their name; context nodes have no label element at all, which
    // is most of what was removed.
    const alwaysLabeled = (d) => d.hub === true;
    const refreshLabels = () => {
      labels.style('opacity', (d) =>
        alwaysLabeled(d) ||
        zoomKRef.current > LABEL_ZOOM_THRESHOLD ||
        d.id === hoveredId ||
        d.id === selectedIdRef.current ? 1 : 0
      );
    };

    // ---- interaction -----------------------------------------------------
    node.on('click', (event, d) => {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      onSelectRef.current?.(d.connection);
    });
    svg.on('click', () => onSelectRef.current?.(null));

    const tip = tooltipRef.current;
    const moveTip = (event) => {
      const el = containerRef.current;
      if (!tip || !el) return;
      const rect = el.getBoundingClientRect();
      tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 190)}px`;
      tip.style.top = `${Math.max(event.clientY - rect.top - 8, 8)}px`;
    };
    const showTip = (event, d) => {
      if (!tip || !d.connection) return;
      const c = d.connection;
      const meta = [c.role || c.headline, c.company].filter(Boolean).map(String);
      tip.innerHTML =
        `<div style="font-weight:600;color:#f1f5f9">${escapeHtml(c.name)}</div>` +
        (meta.length ? `<div style="color:#94a3b8;margin-top:1px">${escapeHtml(meta.join(' · '))}</div>` : '') +
        `<div style="margin-top:3px;color:${TIER_COLORS[c.tier] || TIER_COLORS.D}">` +
        `${escapeHtml(c.tier || '?')} · power ${Number(c.power_score || 0).toFixed(1)}` +
        `${c.is_catalyst ? ' · ⚡ catalyst' : ''}</div>`;
      tip.style.opacity = '1';
      moveTip(event);
    };
    const hideTip = () => { if (tip) tip.style.opacity = '0'; };

    if (!isMobile) {
      node
        .on('mouseenter', (event, d) => { hoveredId = d.id; refreshLabels(); showTip(event, d); })
        .on('mousemove', (event) => moveTip(event))
        .on('mouseleave', () => { hoveredId = null; refreshLabels(); hideTip(); });
    }

    // ---- positions -------------------------------------------------------
    const ticked = () => {
      link
        .attr('x1', (l) => l.source.x ?? 0).attr('y1', (l) => l.source.y ?? 0)
        .attr('x2', (l) => l.target.x ?? 0).attr('y2', (l) => l.target.y ?? 0);
      spoke
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', (d) => d.x ?? 0).attr('y2', (d) => d.y ?? 0);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };

    let sim = null;
    if (isMobile) {
      ticked();      // static golden-angle layout; no simulation on phones
    } else {
      const simulation = forceSimulation(simNodes)
        // A 2nd-degree person belongs to their bridge, not to a ring. Giving
        // them their own radial target fought the link holding them to that
        // bridge, and the result was dots strewn across everyone else's space.
        // Zero here lets the link force gather each circle around its own hub.
        .force('radial', forceRadial((d) => d.targetRadius, 0, 0)
          .strength((d) => (d.kind === 'd1' ? 0.9 : 0)))
        .force('collide', forceCollide((d) => d.r + 2.5))
        .force('charge', forceManyBody().strength(-18))
        .on('tick', ticked);
      if (links.length > 0) {
        simulation.force('link', forceLink(links).distance(26).strength(0.7));
      }
      sim = simulation;

      // Place everyone at their computed starting positions right away. The
      // simulation ticks on requestAnimationFrame, which does not run in a
      // background or hidden tab — without this the whole graph sits stacked at
      // the origin until the tab is looked at.
      ticked();

      const dragBehavior = drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          // Bridges stay where you drop them; leaves re-settle.
          const isBridge = d.connection?.circle_power !== null && d.connection?.circle_power !== undefined;
          if (!isBridge) { d.fx = null; d.fy = null; }
        });
      node.filter((d) => d.kind === 'd1').call(dragBehavior);
      node.on('dblclick', (event, d) => {
        if (d.kind !== 'd1') return;
        event.stopPropagation();
        d.fx = null; d.fy = null;
        simulation.alphaTarget(0.2).restart();
        window.setTimeout(() => simulation.alphaTarget(0), 400);
      });
    }

    // ---- zoom & pan ------------------------------------------------------
    const zoomBehavior = zoom().scaleExtent([0.3, 3]).on('zoom', (event) => {
      viewport.attr('transform', event.transform.toString());
      // Persist only user-driven camera moves; saving the programmatic initial
      // transform would pin the view to stale dimensions across resizes.
      if (event.sourceEvent) savedTransformRef.current = event.transform;
      if (event.transform.k !== zoomKRef.current) {
        zoomKRef.current = event.transform.k;
        refreshLabels();
      }
    });
    svg.call(zoomBehavior).on('dblclick.zoom', null);

    const fitK = Math.max(0.3, Math.min(3, Math.min(width, height) / ((TIER_RING_RADIUS.B + 70) * 2)));
    const initialTransform =
      savedTransformRef.current ?? zoomIdentity.translate(width / 2, height / 2).scale(fitK);
    svg.call(zoomBehavior.transform, initialTransform);

    // ---- selection -------------------------------------------------------
    applySelectionRef.current = (id) => {
      // Hubs keep a permanent ring; everyone else gets one only while selected.
      // Creating 1,400 invisible rings up front was most of the element count.
      nodesLayer.selectAll('circle.og-sel-temp').remove();
      node.select('circle.og-sel').style('opacity', (d) => (d.id === id ? 1 : 0));
      node.select('circle.og-base').attr('r', (d) => (d.id === id && d.kind !== 'user' ? d.r + 1.5 : d.r));
      if (id) {
        node.filter((d) => d.id === id && !d.hub && d.kind !== 'user')
          .append('circle')
          .attr('class', 'og-sel-temp')
          .attr('r', (d) => d.r + 3)
          .attr('fill', 'none')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.2);
      }
      refreshLabels();
    };
    applySelectionRef.current(selectedIdRef.current);

    // ---- fly-to ----------------------------------------------------------
    const nodeById = new Map(renderNodes.map((n) => [n.id, n]));
    focusNodeRef.current = (id) => {
      const target = nodeById.get(id);
      if (!target) return;
      const tx = target.x ?? 0;
      const ty = target.y ?? 0;
      const start = zoomTransform(svgEl);
      const end = zoomIdentity.translate(width / 2, height / 2).scale(2.5).translate(-tx, -ty);
      const t0 = performance.now();
      const flyDur = 650;
      const fly = (t) => {
        const p = Math.min(1, (t - t0) / flyDur);
        const e = 1 - Math.pow(1 - p, 3);
        zoomBehavior.transform(svg, zoomIdentity
          .translate(start.x + (end.x - start.x) * e, start.y + (end.y - start.y) * e)
          .scale(start.k + (end.k - start.k) * e));
        if (p < 1) requestAnimationFrame(fly);
      };
      requestAnimationFrame(fly);
      // rAF is throttled in background tabs; make sure the camera still lands.
      window.setTimeout(() => zoomBehavior.transform(svg, end), flyDur + 80);

      onSelectRef.current?.(target.connection);
      selectedIdRef.current = id;
      applySelectionRef.current(id);

      const pulse = nodesLayer.append('circle')
        .attr('cx', tx).attr('cy', ty).attr('r', target.r + 2)
        .attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', 2)
        .attr('opacity', 0.9);
      const p0 = performance.now();
      const pulseDur = 700;
      const puls = (t) => {
        const p = Math.min(1, (t - p0) / pulseDur);
        pulse.attr('r', target.r + 2 + 26 * p).attr('opacity', 0.9 * (1 - p));
        if (p < 1) requestAnimationFrame(puls);
        else pulse.remove();
      };
      requestAnimationFrame(puls);
      window.setTimeout(() => pulse.remove(), pulseDur + 100);
    };

    return () => {
      sim?.stop();
      applySelectionRef.current = () => {};
      focusNodeRef.current = () => {};
      svg.on('.zoom', null);
      svg.on('click', null);
      svg.selectAll('*').remove();
    };
  }, [signature, userName, userImage, isMobile, size]);

  return (
    <div
      ref={containerRef}
      // The view area is a flex column, so a percentage height resolves
      // against nothing and collapses to zero. Flex into the space instead,
      // the way the other views do.
      style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%' }}
    >
      <svg
        ref={svgRef}
        style={{ display: 'block', height: '100%', width: '100%', touchAction: 'none', userSelect: 'none' }}
        role="img"
        aria-label="Your network as an orbital galaxy — closer orbits are higher-leverage tiers"
      />
      <div
        ref={tooltipRef}
        aria-hidden
        style={{
          position: 'absolute', zIndex: 20, maxWidth: 190, pointerEvents: 'none',
          padding: '6px 10px', fontSize: 11.5, lineHeight: 1.45, borderRadius: 8,
          background: 'rgba(10,10,26,0.92)', border: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(8px)', opacity: 0, transition: 'opacity 150ms ease',
          left: 0, top: 0,
        }}
      />
    </div>
  );
});

export default OrbitGraph;
