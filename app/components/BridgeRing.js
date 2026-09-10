'use client';

/**
 * BridgeRing — the rotary dial, ported from the v2 build.
 *
 * Your highest-leverage connections sit on a ring around you. Drag anywhere to
 * spin it (1:1, no snapping while the pointer is down); release and the nearest
 * bridge snaps to the top slot. That bridge's known 2nd-degree circle fans
 * outward from the top inside a soft, deformable boundary, revealed node by
 * node.
 *
 * Rotation is fully imperative: the angle lives in a ref and positions are
 * written through d3-selection each frame, so React never re-renders during a
 * drag or a tween. It re-renders only when a selection is committed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3';
import { TIER_COLORS, initialsFor } from '../../lib/tiers';

export const MAX_BRIDGES = 12;
const MAX_CLUSTER_NODES = 24;
const TOP = -Math.PI / 2;
const SNAP_MS = 350;
const CLICK_SLOP_PX = 6;
const HULL_PAD_PX = 18;

function normalizeAngle(a) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** Andrew's monotone chain convex hull. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Closed Catmull-Rom spline through the points, emitted as cubic beziers. */
function catmullRomClosed(points) {
  const n = points.length;
  if (n < 3) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

function shortName(name) {
  const s = String(name || '');
  if (s.length <= 16) return s;
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return `${s.slice(0, 15)}…`;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
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

export default function BridgeRing({ connections = [], degree2 = [], onSelect, userName = 'You', userImage = null }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const offsetRef = useRef(0);
  const tweenRef = useRef(null);
  const interactedRef = useRef(false);
  const cbRef = useRef({ onSelect });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const isMobile = useIsMobile();

  useEffect(() => { cbRef.current = { onSelect }; }, [onSelect]);

  // The dial is about circles you have actually mapped, so bridges with a known
  // 2nd degree come first. Without any, it still renders your strongest people
  // rather than an empty ring that reads as broken.
  const { bridges, clusters } = useMemo(() => {
    const byBridge = new Map();
    for (const c of degree2) {
      const key = c.source_connection_id;
      if (!key) continue;
      const list = byBridge.get(key);
      if (list) list.push(c);
      else byBridge.set(key, [c]);
    }
    const withCircle = connections
      .filter((c) => byBridge.has(c.id))
      .sort((a, b) => (Number(b.circle_power) || 0) - (Number(a.circle_power) || 0));
    const chosen = withCircle.length
      ? withCircle
      : [...connections].sort((a, b) => (Number(b.power_score) || 0) - (Number(a.power_score) || 0));
    return { bridges: chosen.slice(0, MAX_BRIDGES), clusters: byBridge };
  }, [connections, degree2]);

  // Depend on content, not array identity — the parent rebuilds these arrays on
  // every render, and rebuilding the dial mid-drag would fight the pointer.
  const signature = useMemo(
    () => `${bridges.map((b) => b.id).join(',')}|${degree2.length}`,
    [bridges, degree2]
  );
  const dataRef = useRef({ bridges, clusters });
  useEffect(() => { dataRef.current = { bridges, clusters }; }, [bridges, clusters]);

  useEffect(() => {
    if (!selectedId && bridges.length) setSelectedId(bridges[0].id);
  }, [selectedId, bridges]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    // Synchronous first measure — first paint must not wait on ResizeObserver.
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

  useEffect(() => {
    const svgEl = svgRef.current;
    const { w, h } = size;
    if (!svgEl || w < 80 || h < 80) return undefined;
    const { bridges: ringAll, clusters: clusterMap } = dataRef.current;
    const ring = ringAll.slice(0, MAX_BRIDGES);
    const n = ring.length;
    if (n === 0) return undefined;

    const svg = select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${w} ${h}`);
    svgEl.style.cursor = 'grab';

    // ---- geometry --------------------------------------------------------
    const step = (Math.PI * 2) / n;
    const slot = (i) => TOP + i * step;
    let selIndex = ring.findIndex((b) => b.id === selectedId);
    if (selIndex < 0) selIndex = 0;
    const selected = ring[selIndex];

    const baseR = isMobile ? 150 : 230;
    const panelW = isMobile ? 0 : 372;
    const bandBase = isMobile ? 56 : 70;
    const bandGap = isMobile ? 32 : 40;
    const bandSpan = bandBase + 2 * bandGap;
    const R = Math.max(90, Math.min(baseR, (h - bandSpan - 84) / 2, (w - panelW) / 2 - 56));
    const cx = isMobile ? w / 2 : Math.max(R + 60, (w - panelW) / 2);
    const cy = Math.max(R + bandSpan + 38, Math.min(h - R - 46, h * (isMobile ? 0.42 : 0.55)));

    const defs = svg.append('defs');
    defs.append('filter').attr('id', 'bridge-cloud-blur')
      .attr('x', '-40%').attr('y', '-40%').attr('width', '180%').attr('height', '180%')
      .append('feGaussianBlur').attr('stdDeviation', 5);
    const nebula = defs.append('radialGradient').attr('id', 'bridge-nebula')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    nebula.append('stop').attr('offset', '0%').attr('stop-color', 'currentColor').attr('stop-opacity', 0.22);
    nebula.append('stop').attr('offset', '60%').attr('stop-color', 'currentColor').attr('stop-opacity', 0.06);
    nebula.append('stop').attr('offset', '100%').attr('stop-color', 'currentColor').attr('stop-opacity', 0);

    // Initials always render; an image draws on top and hides itself on error,
    // so a dead avatar is never a broken-image glyph.
    function avatar(g, opts) {
      g.append('circle').attr('r', opts.r).attr('fill', opts.fill)
        .attr('stroke', 'rgba(255,255,255,0.25)').attr('stroke-width', 1);
      if (opts.showInitials) {
        g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
          .attr('font-size', Math.max(6.5, opts.r * 0.72)).attr('font-weight', 700)
          .attr('fill', opts.textFill ?? 'rgba(8,10,25,0.92)')
          .attr('pointer-events', 'none').text(initialsFor(opts.name));
      }
      if (opts.imageUrl) {
        const clipId = `bridgering-clip-${String(opts.key).replace(/[^\w-]/g, '_')}`;
        defs.append('clipPath').attr('id', clipId).append('circle').attr('r', opts.r);
        g.append('image').attr('href', opts.imageUrl)
          .attr('x', -opts.r).attr('y', -opts.r)
          .attr('width', opts.r * 2).attr('height', opts.r * 2)
          .attr('clip-path', `url(#${clipId})`)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('pointer-events', 'none')
          .on('error', (event) => { select(event.currentTarget).attr('display', 'none'); });
      }
    }

    // ---- static furniture -------------------------------------------------
    svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', R)
      .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.06)')
      .attr('stroke-width', 1.5).attr('stroke-dasharray', '2 7');

    const centerLine = svg.append('line').attr('x1', cx).attr('y1', cy)
      .attr('stroke', 'rgba(255,255,255,0.15)').attr('stroke-width', 1);

    // ---- the selected bridge's circle, fanned from the top ---------------
    const clusterOuter = svg.append('g').attr('transform', `translate(${cx}, ${cy - R})`);
    const clusterInner = clusterOuter.append('g')
      .attr('transform', 'scale(0.88)').style('opacity', 0)
      .style('transition', 'opacity 260ms ease');

    let scaleRaf = null;
    let scaleTimeout = null;
    const setClusterScale = (s) => clusterInner.attr('transform', `scale(${s})`);
    function tweenClusterScale(from, to, ms) {
      if (scaleRaf !== null) cancelAnimationFrame(scaleRaf);
      if (scaleTimeout !== null) clearTimeout(scaleTimeout);
      const t0 = performance.now();
      const frame = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - p, 3);
        setClusterScale(from + (to - from) * e);
        if (p < 1) scaleRaf = requestAnimationFrame(frame);
        else scaleRaf = null;
      };
      scaleRaf = requestAnimationFrame(frame);
      // No animation frames arrive in a hidden tab; land the final scale anyway
      // rather than leaving the circle stuck at its entry size.
      scaleTimeout = setTimeout(() => { setClusterScale(to); scaleTimeout = null; }, ms + 120);
    }
    function hideCluster() { clusterInner.style('opacity', 0); setClusterScale(0.92); }
    function showCluster() {
      clusterInner.style('opacity', 1);
      // Each node carries its own transition delay — flipping opacity here is
      // what produces the node-by-node "scan" reveal.
      clusterInner.selectAll('.cluster-node, .cluster-chip').style('opacity', 1);
      tweenClusterScale(0.9, 1, 300);
    }

    let suppressClick = false;

    const clusterAll = clusterMap.get(selected.id) ?? [];
    const clusterNodes = [...clusterAll]
      .sort((a, b) => (Number(b.power_score) || 0) - (Number(a.power_score) || 0))
      .slice(0, MAX_CLUSTER_NODES);

    if (clusterNodes.length > 0) {
      const bandCount = clusterNodes.length <= 6 ? 2 : 3;
      const spread = (100 * Math.PI) / 180;
      const perBand = Array.from({ length: bandCount }, () => []);
      clusterNodes.forEach((_, i) => perBand[i % bandCount].push(i));
      const placed = [];
      perBand.forEach((idxs, band) => {
        const rb = R + bandBase + band * bandGap;
        idxs.forEach((nodeIdx, j) => {
          const a = idxs.length === 1 ? TOP : TOP - spread / 2 + (spread * j) / (idxs.length - 1);
          const c = clusterNodes[nodeIdx];
          placed.push({
            c,
            x: rb * Math.cos(a),
            y: rb * Math.sin(a) + R,
            r: Math.max(5, Math.min(9, 5 + ((Number(c.power_score) || 0) / 13) * 4)),
          });
        });
      });

      // Deformable boundary: padded convex hull, smoothed and softly blurred.
      const padPoints = [];
      placed.forEach((p) => {
        for (let s = 0; s < 8; s++) {
          const a = (s / 8) * Math.PI * 2;
          padPoints.push({
            x: p.x + (p.r + HULL_PAD_PX) * Math.cos(a),
            y: p.y + (p.r + HULL_PAD_PX) * Math.sin(a),
          });
        }
      });
      const boundary = catmullRomClosed(convexHull(padPoints));
      const tierColor = TIER_COLORS[selected.tier] || TIER_COLORS.D;

      const cx0 = placed.reduce((s, p) => s + p.x, 0) / placed.length;
      const cy0 = placed.reduce((s, p) => s + p.y, 0) / placed.length;
      const nebulaR = Math.max(...placed.map((p) => Math.hypot(p.x - cx0, p.y - cy0))) + 40;
      clusterInner.append('circle').attr('cx', cx0).attr('cy', cy0).attr('r', nebulaR)
        .style('color', tierColor).attr('fill', 'url(#bridge-nebula)');

      if (boundary) {
        clusterInner.append('path').attr('d', boundary).attr('fill', tierColor)
          .attr('fill-opacity', 0.07).attr('filter', 'url(#bridge-cloud-blur)');
        clusterInner.append('path').attr('d', boundary).attr('fill', 'none')
          .attr('stroke', tierColor).attr('stroke-opacity', 0.2).attr('stroke-width', 1);
      }

      placed.forEach((p) => {
        clusterInner.append('line').attr('x1', 0).attr('y1', 0).attr('x2', p.x).attr('y2', p.y)
          .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 1);
      });

      placed.forEach((p, i) => {
        const g = clusterInner.append('g').attr('class', 'cluster-node')
          .attr('transform', `translate(${p.x}, ${p.y})`)
          .style('cursor', 'pointer').style('opacity', 0)
          .style('transition', `opacity 200ms ease ${i * 16}ms`);
        avatar(g, {
          key: `c-${p.c.id}`, r: p.r,
          fill: TIER_COLORS[p.c.tier] || TIER_COLORS.D,
          name: p.c.name, imageUrl: p.c.profile_image_url, showInitials: p.r >= 8,
        });
        g.append('title').text(p.c.headline ? `${p.c.name} — ${p.c.headline}` : p.c.name);
        g.on('click', (event) => {
          event.stopPropagation();
          if (suppressClick) { suppressClick = false; return; }
          cbRef.current.onSelect?.(p.c);
        });
      });

      const chipY = Math.min(...placed.map((p) => p.y - p.r)) - 22;
      const sCount = selected.circle_s_count ?? 0;
      const aCount = selected.circle_a_count ?? 0;
      const label = selected.is_catalyst
        ? `⚡ catalyst circle · ${placed.length} people`
        : `circle unlocked · ${placed.length} people · ${sCount}S ${aCount}A`;
      const chip = clusterInner.append('g').attr('class', 'cluster-chip')
        .attr('transform', `translate(${cx0}, ${chipY})`)
        .style('opacity', 0)
        .style('transition', `opacity 240ms ease ${placed.length * 16 + 80}ms`);
      const chipText = chip.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 11).attr('font-weight', 600)
        .attr('fill', selected.is_catalyst ? TIER_COLORS.S : '#e2e8f0')
        .text(label);
      const tw = (chipText.node()?.getComputedTextLength() ?? label.length * 6) + 20;
      chip.insert('rect', 'text')
        .attr('x', -tw / 2).attr('y', -11).attr('width', tw).attr('height', 22).attr('rx', 11)
        .attr('fill', 'rgba(10,10,25,0.75)')
        .attr('stroke', selected.is_catalyst ? TIER_COLORS.S : 'rgba(255,255,255,0.15)')
        .attr('stroke-opacity', selected.is_catalyst ? 0.6 : 1)
        .attr('stroke-width', 1);
    }

    // ---- bridge nodes on the dial ----------------------------------------
    const bridgesG = svg.append('g');
    const bridgeGroups = ring.map((b, i) => {
      const r = Math.min(26, 14 + (Number(b.power_score) || 0));
      const isSel = i === selIndex;
      const g = bridgesG.append('g').style('cursor', 'pointer').attr('opacity', isSel ? 1 : 0.6);
      if (b.is_catalyst) {
        g.append('circle').attr('r', r + 4).attr('fill', 'none')
          .attr('stroke', TIER_COLORS.S).attr('stroke-opacity', 0.85).attr('stroke-width', 1.5);
      }
      if (isSel) {
        g.append('circle').attr('r', r + (b.is_catalyst ? 8 : 5)).attr('fill', 'none')
          .attr('stroke', 'rgba(255,255,255,0.35)').attr('stroke-width', 1);
      }
      avatar(g, {
        key: `b-${b.id}`, r, fill: TIER_COLORS[b.tier] || TIER_COLORS.D,
        name: b.name, imageUrl: b.profile_image_url, showInitials: true,
      });
      const labels = g.append('g')
        .attr('opacity', isSel ? 1 : isMobile ? 0.15 : 0.7)
        .attr('pointer-events', 'none');
      labels.append('text').attr('text-anchor', 'middle').attr('y', r + 15)
        .attr('font-size', 11).attr('font-weight', isSel ? 700 : 500)
        .attr('fill', isSel ? '#f8fafc' : '#94a3b8').text(shortName(b.name));
      labels.append('text').attr('text-anchor', 'middle').attr('y', r + 28)
        .attr('font-size', 9.5).attr('fill', TIER_COLORS[b.tier] || TIER_COLORS.D)
        .attr('fill-opacity', 0.9)
        .text(`${(Number(b.circle_power) || 0).toFixed(1)} circle power`);
      g.append('title').text(b.headline ? `${b.name} — ${b.headline}` : b.name);
      g.on('click', (event) => {
        event.stopPropagation();
        if (suppressClick) { suppressClick = false; return; }
        fadeHint();
        rotateToSlot(i);
      });
      return g;
    });

    // ---- you, fixed at the centre ----------------------------------------
    const centerG = svg.append('g').attr('transform', `translate(${cx}, ${cy})`);
    const uR = isMobile ? 22 : 28;
    centerG.append('circle').attr('r', uR + 6).attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.08)').attr('stroke-width', 1);
    avatar(centerG, {
      key: 'user', r: uR, fill: '#1c1c42', textFill: '#e2e8f0',
      name: userName, imageUrl: userImage, showInitials: true,
    });
    centerG.append('text').attr('text-anchor', 'middle').attr('y', uR + 17)
      .attr('font-size', 11).attr('font-weight', 600).attr('fill', '#cbd5e1')
      .text(shortName(userName));
    centerG.append('text').attr('text-anchor', 'middle').attr('y', uR + 30)
      .attr('font-size', 9).attr('fill', '#64748b').text('you');

    // ---- affordance, fades after the first interaction --------------------
    const hint = interactedRef.current ? null : svg.append('text')
      .attr('x', cx)
      .attr('y', Math.min(isMobile ? h * 0.54 - 12 : h - 12, cy + R + (isMobile ? 42 : 54)))
      .attr('text-anchor', 'middle').attr('font-size', 11)
      .attr('fill', 'rgba(255,255,255,0.3)').attr('letter-spacing', '0.08em')
      .attr('pointer-events', 'none').style('transition', 'opacity 600ms ease')
      .text('drag to rotate · release to snap');

    function fadeHint() {
      if (interactedRef.current) return;
      interactedRef.current = true;
      hint?.style('opacity', 0);
    }

    // ---- rotation core ----------------------------------------------------
    function layout() {
      const off = offsetRef.current;
      bridgeGroups.forEach((g, i) => {
        const a = slot(i) + off;
        g.attr('transform', `translate(${cx + R * Math.cos(a)}, ${cy + R * Math.sin(a)})`);
      });
      const sa = slot(selIndex) + off;
      centerLine.attr('x2', cx + R * Math.cos(sa)).attr('y2', cy + R * Math.sin(sa));
    }

    let tweenTimeout = null;

    function cancelTween() {
      if (tweenRef.current !== null) {
        cancelAnimationFrame(tweenRef.current);
        tweenRef.current = null;
      }
      if (tweenTimeout !== null) {
        clearTimeout(tweenTimeout);
        tweenTimeout = null;
      }
    }

    function tweenTo(target, done) {
      cancelTween();
      const from = offsetRef.current;
      const delta = normalizeAngle(target - from);
      const t0 = performance.now();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cancelTween();
        offsetRef.current = from + delta;
        layout();
        done?.();
      };
      const frame = (t) => {
        const p = Math.min(1, (t - t0) / SNAP_MS);
        const e = 1 - Math.pow(1 - p, 3);
        offsetRef.current = from + delta * e;
        layout();
        if (p < 1) tweenRef.current = requestAnimationFrame(frame);
        else { tweenRef.current = null; finish(); }
      };
      tweenRef.current = requestAnimationFrame(frame);
      // The animation rides on requestAnimationFrame, which does not run in a
      // hidden or background tab — and the SELECTION is committed in the
      // callback. Without this, clicking a bridge in a background tab changes
      // nothing at all. Land the state even when no frame ever arrives.
      tweenTimeout = setTimeout(finish, SNAP_MS + 120);
    }

    function rotateToSlot(i) {
      const target = offsetRef.current + normalizeAngle(TOP - slot(i) - offsetRef.current);
      const id = ring[i].id;
      if (id !== selectedId) hideCluster();
      tweenTo(target, () => {
        if (id !== selectedId) setSelectedId(id);
        else showCluster();
      });
    }

    // ---- pointer handling (mouse + touch) ---------------------------------
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let lastPointerAngle = 0;

    const svgPoint = (e) => {
      const rect = svgEl.getBoundingClientRect();
      return {
        x: rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * w : 0,
        y: rect.height > 0 ? ((e.clientY - rect.top) / rect.height) * h : 0,
      };
    };

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelTween();
      dragging = true;
      moved = false;
      suppressClick = false;
      startX = e.clientX;
      startY = e.clientY;
      const p = svgPoint(e);
      lastPointerAngle = Math.atan2(p.y - cy, p.x - cx);
      try { svgEl.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    }

    function onPointerMove(e) {
      if (!dragging) return;
      if (!moved) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < CLICK_SLOP_PX) return;
        moved = true;
        suppressClick = true;
        svgEl.style.cursor = 'grabbing';
        hideCluster();
        fadeHint();
      }
      const p = svgPoint(e);
      const ang = Math.atan2(p.y - cy, p.x - cx);
      offsetRef.current += normalizeAngle(ang - lastPointerAngle);
      lastPointerAngle = ang;
      layout();   // 1:1 while the pointer is down; snapping happens on release
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      svgEl.style.cursor = 'grab';
      try { svgEl.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (!moved) return;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(normalizeAngle(slot(i) + offsetRef.current - TOP));
        if (d < bestDist) { bestDist = d; best = i; }
      }
      rotateToSlot(best);
    }

    function onSvgClick() {
      if (suppressClick) { suppressClick = false; return; }
      cbRef.current.onSelect?.(null);
    }

    // The dial must be operable without a pointer.
    function onKeyDown(e) {
      let delta = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -1;
      else return;
      e.preventDefault();
      fadeHint();
      rotateToSlot((selIndex + delta + n) % n);
    }

    svgEl.addEventListener('pointerdown', onPointerDown);
    svgEl.addEventListener('pointermove', onPointerMove);
    svgEl.addEventListener('pointerup', onPointerUp);
    svgEl.addEventListener('pointercancel', onPointerUp);
    svgEl.addEventListener('click', onSvgClick);
    svgEl.addEventListener('keydown', onKeyDown);

    // Canonical offset puts the selected bridge exactly at the top slot.
    offsetRef.current = normalizeAngle(-selIndex * step);
    layout();

    // Double rAF so the hidden state paints before the transition begins —
    // with a timeout behind it, because a background tab gets no frames and the
    // circle would simply never appear.
    const fadeRafs = [];
    let revealed = false;
    const reveal = () => { if (revealed) return; revealed = true; showCluster(); };
    fadeRafs.push(requestAnimationFrame(() => {
      fadeRafs.push(requestAnimationFrame(reveal));
    }));
    const revealTimeout = setTimeout(reveal, 200);

    return () => {
      cancelTween();
      if (scaleRaf !== null) cancelAnimationFrame(scaleRaf);
      if (scaleTimeout !== null) clearTimeout(scaleTimeout);
      clearTimeout(revealTimeout);
      fadeRafs.forEach((id) => cancelAnimationFrame(id));
      svgEl.removeEventListener('pointerdown', onPointerDown);
      svgEl.removeEventListener('pointermove', onPointerMove);
      svgEl.removeEventListener('pointerup', onPointerUp);
      svgEl.removeEventListener('pointercancel', onPointerUp);
      svgEl.removeEventListener('click', onSvgClick);
      svgEl.removeEventListener('keydown', onKeyDown);
      svg.selectAll('*').remove();
    };
  }, [signature, selectedId, isMobile, size, userName, userImage]);

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
        tabIndex={0}
        role="application"
        aria-label="Bridge dial. Drag to rotate, or use the arrow keys to select the previous or next bridge; the selected bridge sits at the top with their known circle fanned above."
        style={{ height: '100%', width: '100%', userSelect: 'none', touchAction: 'none', borderRadius: 12, outline: 'none' }}
      />
    </div>
  );
}
