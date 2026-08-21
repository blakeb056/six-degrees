'use client';

import { useState, useRef, useEffect } from 'react';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const DEGREE_COLORS = { 1: '#FFD700', 2: '#FF6B35', 3: '#3498DB', 4: '#9B59B6', 5: '#00ff88', 6: '#ff5050' };

export default function ChainView({ connections, degree2 = [], onSelect, userName }) {
  const containerRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [focusedBridge, setFocusedBridge] = useState(null);
  const [zoom, setZoom] = useState(1.3);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [isTouching, setIsTouching] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setDims({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);
    setDims({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Touch rotary dial — drag finger around circle to highlight bridges
  // Pre-compute bridge angles once (not on every touch event)
  const bridgeAnglesRef = useRef([]);
  useEffect(() => {
    const bMap = {};
    degree2.forEach(d2 => { if (d2.source_connection_id) { if (!bMap[d2.source_connection_id]) bMap[d2.source_connection_id] = []; bMap[d2.source_connection_id].push(d2); }});
    const br = connections.filter(c => bMap[c.id]).sort((a, b) => (bMap[b.id]?.length || 0) - (bMap[a.id]?.length || 0));
    bridgeAnglesRef.current = br.map((b, i) => ({ id: b.id, angle: (i / br.length) * Math.PI * 2 - Math.PI / 2 }));
  }, [connections, degree2]);

  const lastTouchRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const findNearest = (touchX, touchY) => {
      const rect = el.getBoundingClientRect();
      const cx = dims.w / 2;
      const cy = dims.h / 2;
      const tx = touchX - rect.left;
      const ty = touchY - rect.top;
      const touchAngle = Math.atan2(ty - cy, tx - cx);
      let nearest = null;
      let nearestDist = Infinity;
      bridgeAnglesRef.current.forEach(b => {
        let diff = Math.abs(touchAngle - b.angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < nearestDist) { nearestDist = diff; nearest = b.id; }
      });
      return nearest;
    };

    const onTouchStart = (e) => {
      setIsTouching(true);
      if (e.touches[0]) {
        const n = findNearest(e.touches[0].clientX, e.touches[0].clientY);
        if (n) setHovered(n);
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      // Throttle to 60fps
      const now = Date.now();
      if (now - lastTouchRef.current < 16) return;
      lastTouchRef.current = now;
      if (e.touches[0]) {
        const n = findNearest(e.touches[0].clientX, e.touches[0].clientY);
        if (n) setHovered(n);
      }
    };
    const onTouchEnd = () => {
      setIsTouching(false);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => { el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd); };
  }, [dims, zoom]);

  // Build bridge map
  const bridgeMap = {};
  degree2.forEach(d2 => {
    if (!d2.source_connection_id) return;
    if (!bridgeMap[d2.source_connection_id]) bridgeMap[d2.source_connection_id] = [];
    bridgeMap[d2.source_connection_id].push(d2);
  });

  const bridges = connections.filter(c => bridgeMap[c.id] && bridgeMap[c.id].length > 0)
    .sort((a, b) => (bridgeMap[b.id]?.length || 0) - (bridgeMap[a.id]?.length || 0));

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;

  // === FOCUSED VIEW: one bridge selected, show its D2 paths ===
  if (focusedBridge) {
    const bridge = bridges.find(b => b.id === focusedBridge);
    if (!bridge) { setFocusedBridge(null); return null; }
    const cluster = (bridgeMap[bridge.id] || [])
      .sort((a, b) => {
        const to = { S: 0, A: 1, B: 2, C: 3, D: 4 };
        return (to[a.tier] || 9) - (to[b.tier] || 9) || (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0);
      });

    const bridgeR = maxR * 0.15;
    const d2R = maxR * 0.7;

    // Touch handler for D2 ring in focused view
    const handleD2Touch = (touchX, touchY) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const tx = touchX - rect.left;
      const ty = touchY - rect.top;
      const touchAngle = Math.atan2(ty - cy, tx - cx);
      let nearest = null;
      let nearestDist = Infinity;
      cluster.forEach((d2, i) => {
        const angle = (i / cluster.length) * Math.PI * 2 - Math.PI / 2;
        let diff = Math.abs(touchAngle - angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < nearestDist) { nearestDist = diff; nearest = d2.id; }
      });
      if (nearest) setHovered(nearest);
    };

    return (
      <div ref={containerRef} style={{ flex: 1, background: '#0a0a1a', position: 'relative', overflow: 'hidden' }}
        onTouchStart={(e) => { if (e.touches[0]) handleD2Touch(e.touches[0].clientX, e.touches[0].clientY); }}
        onTouchMove={(e) => { e.preventDefault(); if (e.touches[0]) handleD2Touch(e.touches[0].clientX, e.touches[0].clientY); }}
        onTouchEnd={() => {
          // Tap to select in sidebar
          if (hovered) { const d2 = cluster.find(d => d.id === hovered); if (d2) onSelect && onSelect(d2); }
        }}>
        <svg width={dims.w} height={dims.h}>
          <defs>
            <filter id="focusGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>

          {/* D2 ring guide */}
          <circle cx={cx} cy={cy} r={d2R} fill="none" stroke={`${DEGREE_COLORS[2]}08`} strokeWidth={1} />
          {/* D3 ghost ring — outer ring around D2 */}
          {hovered && <circle cx={cx} cy={cy} r={maxR * 0.93} fill="none" stroke={`${DEGREE_COLORS[3]}10`} strokeWidth={1} strokeDasharray="3,5" />}

          {/* Lines: bridge → each D2 */}
          {cluster.map((d2, i) => {
            const angle = (i / cluster.length) * Math.PI * 2 - Math.PI / 2;
            const x2 = cx + d2R * Math.cos(angle);
            const y2 = cy + d2R * Math.sin(angle);
            const isHov = hovered === d2.id;
            return (
              <line key={'fl-' + i} x1={cx} y1={cy} x2={x2} y2={y2}
                stroke={TIER_COLORS[d2.tier] || '#555'}
                strokeWidth={isHov ? 2 : 0.5}
                strokeOpacity={isHov ? 0.8 : 0.12} />
            );
          })}

          {/* D2 nodes — check if any are D3 ready (promoted/accepted) */}
          {cluster.map((d2, i) => {
            const angle = (i / cluster.length) * Math.PI * 2 - Math.PI / 2;
            const x = cx + d2R * Math.cos(angle);
            const y = cy + d2R * Math.sin(angle);
            const isHov = hovered === d2.id;
            const nodeR = d2.tier === 'S' ? 7 : d2.tier === 'A' ? 6 : d2.tier === 'B' ? 5 : 4;
            // Check if this D2 person is D3 ready (accepted, now D1, can be bridged)
            const isD3Ready = d2.outreach_status === 'accepted' ||
              connections.some(c => c.profile_url === d2.profile_url && c.outreach_status === 'accepted');
            const d3GhostR = maxR * 0.93;

            return (
              <g key={'fn-' + i}
                onClick={() => onSelect && onSelect(d2)}
                onMouseEnter={() => setHovered(d2.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}>

                {/* D3 ready: gradient color loop + mystery dots */}
                {isD3Ready && (
                  <>
                    {/* Breathing glow */}
                    <circle cx={x} cy={y} r={nodeR + 6} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1.5} strokeOpacity={0.2}>
                      <animate attributeName="r" values={`${nodeR+4};${nodeR+9};${nodeR+4}`} dur="2s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.1;0.4;0.1" dur="2s" repeatCount="indefinite" />
                    </circle>
                    {/* Color gradient loop on the node */}
                    <circle cx={x} cy={y} r={nodeR + 1}
                      fill={DEGREE_COLORS[3]} fillOpacity={0.3} stroke="none">
                      <animate attributeName="fill" values="#3498DB;#FFD700;#FF6B35;#9B59B6;#3498DB" dur="4s" repeatCount="indefinite" />
                      <animate attributeName="fillOpacity" values="0.2;0.4;0.2" dur="2s" repeatCount="indefinite" />
                    </circle>
                    {/* D3 mystery lines + dots */}
                    {Array.from({ length: 3 }, (_, gi) => {
                      const gSpread = Math.PI * 0.25;
                      const gAngle = angle - gSpread / 2 + (gi / 2) * gSpread;
                      const gx = cx + d3GhostR * Math.cos(gAngle);
                      const gy = cy + d3GhostR * Math.sin(gAngle);
                      return (
                        <g key={'d3g-' + gi}>
                          <line x1={x} y1={y} x2={gx} y2={gy}
                            stroke={DEGREE_COLORS[3]} strokeWidth={0.6} strokeOpacity={0.1} strokeDasharray="3,4">
                            <animate attributeName="stroke-opacity" values="0.05;0.2;0.05" dur="3s" repeatCount="indefinite" />
                          </line>
                          <circle cx={gx} cy={gy} r={4}
                            fill={DEGREE_COLORS[3]} fillOpacity={0.2} stroke={DEGREE_COLORS[3]} strokeWidth={0.8} strokeOpacity={0.2}>
                            <animate attributeName="fillOpacity" values="0.1;0.35;0.1" dur="2.5s" repeatCount="indefinite" />
                            <animate attributeName="r" values="3;5;3" dur="3s" repeatCount="indefinite" />
                          </circle>
                        </g>
                      );
                    })}
                  </>
                )}

                {/* Regular glow for S/A */}
                {!isD3Ready && (d2.tier === 'S' || d2.tier === 'A') && (
                  <circle cx={x} cy={y} r={nodeR + 4} fill={`${TIER_COLORS[d2.tier]}12`} />
                )}

                {/* Main node */}
                <circle cx={x} cy={y} r={isHov ? nodeR + 2 : nodeR}
                  fill={isD3Ready ? DEGREE_COLORS[3] : (TIER_COLORS[d2.tier] || '#555')}
                  fillOpacity={isHov ? 1 : (isD3Ready ? 0.7 : 0.5)}
                  stroke={isHov ? '#fff' : (isD3Ready ? DEGREE_COLORS[3] : 'none')}
                  strokeWidth={isHov ? 2 : (isD3Ready ? 1.5 : 0)}>
                  {isD3Ready && !isHov && (
                    <animate attributeName="fill" values="#3498DB;#FFD700;#FF6B35;#3498DB" dur="4s" repeatCount="indefinite" />
                  )}
                </circle>

                {/* Hover tooltip */}
                {isHov && (
                  <g>
                    <rect x={x - 70} y={y - 36} width={140} height={28} rx={6}
                      fill="rgba(0,0,0,0.92)" stroke={isD3Ready ? DEGREE_COLORS[3] : TIER_COLORS[d2.tier]} strokeWidth={0.5} />
                    <text x={x} y={y - 20} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>
                      {d2.name?.substring(0, 22)}
                    </text>
                    <text x={x} y={y - 10} textAnchor="middle" fill={isD3Ready ? DEGREE_COLORS[3] : TIER_COLORS[d2.tier]} fontSize={8}>
                      {isD3Ready ? '⚡ Bridge to unlock D3' : `${d2.tier} · ${parseFloat(d2.power_score || 0).toFixed(1)}`}
                    </text>
                  </g>
                )}

                {/* Name for S-tier or D3 ready */}
                {(d2.tier === 'S' || isD3Ready) && !isHov && (
                  <text x={x} y={y + nodeR + 12} textAnchor="middle"
                    fill={isD3Ready ? DEGREE_COLORS[3] : '#aaa'} fontSize={8}
                    fontWeight={isD3Ready ? 700 : 400}>
                    {d2.name?.split(' ')[0]}
                  </text>
                )}
              </g>
            );
          })}

          {/* D3 ghost nodes — on the outer D3 ring, lines from hovered D2 */}
          {hovered && (() => {
            const hovIdx = cluster.findIndex(d => d.id === hovered);
            if (hovIdx === -1) return null;
            const hovAngle = (hovIdx / cluster.length) * Math.PI * 2 - Math.PI / 2;
            const hovX = cx + d2R * Math.cos(hovAngle);
            const hovY = cy + d2R * Math.sin(hovAngle);
            const d3R = maxR * 0.93;
            const ghostCount = 5;
            const spread = Math.PI * 0.35;
            return Array.from({ length: ghostCount }, (_, j) => {
              const gAngle = hovAngle - spread / 2 + (j / (ghostCount - 1)) * spread;
              const gx = cx + d3R * Math.cos(gAngle);
              const gy = cy + d3R * Math.sin(gAngle);
              return (
                <g key={'g3-' + j}>
                  <line x1={hovX} y1={hovY} x2={gx} y2={gy}
                    stroke={DEGREE_COLORS[3]} strokeWidth={0.8} strokeOpacity={0.2} strokeDasharray="3,3" />
                  <circle cx={gx} cy={gy} r={9}
                    fill="rgba(52,152,219,0.06)" stroke={DEGREE_COLORS[3]} strokeWidth={1.5} strokeOpacity={0.3} strokeDasharray="2,2" />
                  <text x={gx} y={gy + 4} textAnchor="middle" fill={DEGREE_COLORS[3]} fontSize={12} fontWeight={800} fillOpacity={0.5}>?</text>
                </g>
              );
            });
          })()}

          {/* Center: bridge node */}
          <circle cx={cx} cy={cy} r={28} fill="#0a0a1a" stroke={TIER_COLORS[bridge.tier]} strokeWidth={3} filter="url(#focusGlow)" />
          {bridge.profile_image_url ? (
            <>
              <clipPath id="focus-clip"><circle cx={cx} cy={cy} r={24} /></clipPath>
              <image href={bridge.profile_image_url} x={cx - 24} y={cy - 24} width={48} height={48} clipPath="url(#focus-clip)" />
            </>
          ) : (
            <text x={cx} y={cy + 5} textAnchor="middle" fill={TIER_COLORS[bridge.tier]} fontSize={16} fontWeight={800}>
              {bridge.name?.charAt(0)}
            </text>
          )}
          <text x={cx} y={cy + 38} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700}>{bridge.name}</text>
          <text x={cx} y={cy + 50} textAnchor="middle" fill="#888" fontSize={9}>{cluster.length} D2 connections</text>
        </svg>

        {/* Back button */}
        <button onClick={() => setFocusedBridge(null)} style={{
          position: 'absolute', top: 16, left: 16,
          padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.08)', color: '#aaa', fontSize: 12, fontWeight: 600,
        }}>← All Bridges</button>

        {/* Tier breakdown */}
        <div style={{
          position: 'absolute', bottom: 20, left: 20,
          background: 'rgba(0,0,0,0.75)', borderRadius: 10, padding: '10px 14px',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 6 }}>CLUSTER BREAKDOWN</div>
          {['S', 'A', 'B', 'C', 'D'].map(t => {
            const cnt = cluster.filter(d => d.tier === t).length;
            if (cnt === 0) return null;
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: TIER_COLORS[t] }} />
                <span style={{ fontSize: 10, color: TIER_COLORS[t], fontWeight: 600, width: 40 }}>{t}-Tier</span>
                <span style={{ fontSize: 10, color: '#888' }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // === OVERVIEW: all bridges, click to focus ===
  const r1 = maxR * 0.55;
  const promotedR = maxR * 0.82;

  const bridgePos = bridges.map((b, i) => {
    const angle = (i / bridges.length) * Math.PI * 2 - Math.PI / 2;
    return { ...b, x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle), angle, clusterSize: (bridgeMap[b.id] || []).length };
  });

  // Promoted D2→D1: accepted connections without clusters yet (D3 candidates)
  const promoted = connections.filter(c => c.outreach_status === 'accepted' && !bridgeMap[c.id]);
  const promotedPos = promoted.map((p, i) => {
    const angle = (i / Math.max(promoted.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + promotedR * Math.cos(angle), y: cy + promotedR * Math.sin(angle), angle };
  });

  const totalD2 = degree2.length;
  const d2S = degree2.filter(d => d.tier === 'S').length;
  const d2A = degree2.filter(d => d.tier === 'A').length;

  return (
    <div ref={containerRef} style={{ flex: 1, background: '#0a0a1a', position: 'relative', overflow: 'hidden' }}>
      <svg width={dims.w} height={dims.h}>
      <g transform={`translate(${cx * (1 - zoom)}, ${cy * (1 - zoom)}) scale(${zoom})`}>
        {/* Ring guide */}
        <circle cx={cx} cy={cy} r={r1} fill="none" stroke={`${DEGREE_COLORS[1]}10`} strokeWidth={1} />

        {/* D2 outer ring guide — appears on hover */}
        {hovered && <circle cx={cx} cy={cy} r={maxR * 0.88} fill="none" stroke={`${DEGREE_COLORS[2]}08`} strokeWidth={1} />}

        {/* D2 preview dots + D3 ghosts — full chain on bridge hover */}
        {hovered && (() => {
          const hovBridge = bridgePos.find(b => b.id === hovered);
          if (!hovBridge) return null;
          const cluster = (bridgeMap[hovBridge.id] || []).filter(d => d.tier === 'S' || d.tier === 'A' || d.tier === 'B');
          const d2Ring = maxR * 0.75;
          const d3Ring = maxR * 0.95;
          const spread = Math.min(Math.PI * 0.8, (cluster.length / 40) * Math.PI);
          const startAngle = hovBridge.angle - spread / 2;

          return (
            <g>
              {/* D2 ring guide */}
              <circle cx={cx} cy={cy} r={d2Ring} fill="none" stroke={`${DEGREE_COLORS[2]}06`} strokeWidth={1} />
              {/* D3 ring guide */}
              <circle cx={cx} cy={cy} r={d3Ring} fill="none" stroke={`${DEGREE_COLORS[3]}05`} strokeWidth={1} strokeDasharray="3,5" />

              {cluster.map((d2, j) => {
                const t = cluster.length > 1 ? j / (cluster.length - 1) : 0.5;
                const angle = startAngle + t * spread;
                const x2 = cx + d2Ring * Math.cos(angle);
                const y2 = cy + d2Ring * Math.sin(angle);
                const nr = d2.tier === 'S' ? 5 : d2.tier === 'A' ? 4 : 3;

                // D3 ghost for S/A tier D2 people (they'd have the best D3 networks)
                const showD3 = d2.tier === 'S' || d2.tier === 'A';
                const d3x = cx + d3Ring * Math.cos(angle);
                const d3y = cy + d3Ring * Math.sin(angle);

                return (
                  <g key={'pv-' + j}>
                    {/* Bridge → D2 line */}
                    <line x1={hovBridge.x} y1={hovBridge.y} x2={x2} y2={y2}
                      stroke={TIER_COLORS[d2.tier]} strokeWidth={0.5} strokeOpacity={0.15} />
                    {/* D2 node */}
                    <circle cx={x2} cy={y2} r={nr}
                      fill={TIER_COLORS[d2.tier]} fillOpacity={0.45}
                      stroke={TIER_COLORS[d2.tier]} strokeWidth={0.5} strokeOpacity={0.25} />
                    {d2.tier === 'S' && (
                      <text x={x2} y={y2 + nr + 10} textAnchor="middle" fill="#aaa" fontSize={7}>{d2.name?.split(' ')[0]}</text>
                    )}
                    {/* D3 ghost extending from D2 */}
                    {showD3 && (
                      <>
                        <line x1={x2} y1={y2} x2={d3x} y2={d3y}
                          stroke={DEGREE_COLORS[3]} strokeWidth={0.5} strokeOpacity={0.12} strokeDasharray="2,3" />
                        <circle cx={d3x} cy={d3y} r={6}
                          fill="rgba(52,152,219,0.04)" stroke={DEGREE_COLORS[3]}
                          strokeWidth={1} strokeOpacity={0.2} strokeDasharray="2,2" />
                        <text x={d3x} y={d3y + 3.5} textAnchor="middle" fill={DEGREE_COLORS[3]}
                          fontSize={9} fontWeight={700} fillOpacity={0.35}>?</text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Promoted D2→D1 "D3 ready" nodes — ONLY visible when hovering their parent bridge */}
        {hovered && (() => {
          // Find promoted people connected to the hovered bridge
          const hovBridge = bridgePos.find(b => b.id === hovered);
          if (!hovBridge) return null;
          const bridgePromoted = promoted.filter(p => {
            // Check if this promoted person was in this bridge's D2 cluster
            const d2Record = degree2.find(d => d.profile_url === p.profile_url && d.source_connection_id === hovBridge.id);
            return !!d2Record;
          });
          if (bridgePromoted.length === 0) return null;

          const d3ReadyR = maxR * 0.75; // Same ring as D2 dots
          const d3GhostR = maxR * 0.95;

          return bridgePromoted.map((p, pi) => {
            // Position at the END of the D2 spread (after the regular D2 dots)
            const cluster = (bridgeMap[hovBridge.id] || []).filter(d => d.tier === 'S' || d.tier === 'A' || d.tier === 'B');
            const dSpread = Math.min(Math.PI * 0.8, (cluster.length / 40) * Math.PI);
            const pAngle = hovBridge.angle + dSpread / 2 + 0.15 + pi * 0.25;
            const px = cx + d3ReadyR * Math.cos(pAngle);
            const py = cy + d3ReadyR * Math.sin(pAngle);
            const d3GhostR = maxR * 0.95;

            return (
              <g key={'promo-' + pi}>
                {/* Line from bridge → promoted (breathing) */}
                <line x1={hovBridge.x} y1={hovBridge.y} x2={px} y2={py}
                  stroke={DEGREE_COLORS[3]} strokeWidth={1.5} strokeOpacity={0.3}>
                  <animate attributeName="stroke-opacity" values="0.15;0.5;0.15" dur="2s" repeatCount="indefinite" />
                </line>

                {/* Breathing glow */}
                <circle cx={px} cy={py} r={16} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1} strokeOpacity={0.1}>
                  <animate attributeName="r" values="14;19;14" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.05;0.25;0.05" dur="2s" repeatCount="indefinite" />
                </circle>

                {/* Node — color shifts between blue and gold */}
                <circle cx={px} cy={py} r={12}
                  fill={DEGREE_COLORS[3]} fillOpacity={0.3}
                  stroke={DEGREE_COLORS[3]} strokeWidth={2}
                  onClick={() => { onSelect && onSelect(p); setFocusedBridge(hovBridge.id); }}
                  style={{ cursor: 'pointer' }}>
                  <animate attributeName="fill" values="rgba(52,152,219,0.3);rgba(255,215,0,0.3);rgba(52,152,219,0.3)" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="stroke" values="#3498DB;#FFD700;#3498DB" dur="3s" repeatCount="indefinite" />
                </circle>

                {/* Name */}
                <text x={px} y={py + 20} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={700}>
                  {p.name?.split(' ')[0]}
                </text>

                {/* D3 preview — solid dots (not question marks) */}
                {Array.from({ length: 4 }, (_, gi) => {
                  const gSpread = Math.PI * 0.3;
                  const gAngle = pAngle - gSpread / 2 + (gi / 3) * gSpread;
                  const gx = cx + d3GhostR * Math.cos(gAngle);
                  const gy = cy + d3GhostR * Math.sin(gAngle);
                  return (
                    <g key={'pg-' + gi}>
                      <line x1={px} y1={py} x2={gx} y2={gy}
                        stroke={DEGREE_COLORS[3]} strokeWidth={0.5} strokeOpacity={0.12}>
                        <animate attributeName="stroke-opacity" values="0.06;0.18;0.06" dur="2.5s" repeatCount="indefinite" />
                      </line>
                      <circle cx={gx} cy={gy} r={5}
                        fill={DEGREE_COLORS[3]} fillOpacity={0.25}
                        stroke={DEGREE_COLORS[3]} strokeWidth={1} strokeOpacity={0.2}>
                        <animate attributeName="fillOpacity" values="0.15;0.35;0.15" dur="2s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          });
        })()}

        {/* Bridge nodes — hover to preview D2, click to focus */}
        {bridgePos.map(b => {
          const isHov = hovered === b.id;
          const sCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'S').length;
          const aCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'A').length;
          const hasD3 = promoted.some(p => degree2.some(d => d.profile_url === p.profile_url && d.source_connection_id === b.id));
          return (
            <g key={'b-' + b.id}
              onClick={() => setFocusedBridge(b.id)}
              onMouseEnter={() => setHovered(b.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}>
              {/* Glow */}
              <circle cx={b.x} cy={b.y} r={isHov ? 20 : 16}
                fill={`${TIER_COLORS[b.tier]}08`}
                stroke={`${TIER_COLORS[b.tier]}${isHov ? '60' : '25'}`} strokeWidth={1} />
              {/* D3 ready ring — color cycling animation */}
              {hasD3 && (
                <circle cx={b.x} cy={b.y} r={isHov ? 22 : 18}
                  fill="none" strokeWidth={2} strokeOpacity={0.6}>
                  <animate attributeName="stroke" values="#3498DB;#FFD700;#FF6B35;#9B59B6;#3498DB" dur="4s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Node */}
              <circle cx={b.x} cy={b.y} r={isHov ? 13 : 11}
                fill={b.profile_image_url ? '#1a1a2e' : TIER_COLORS[b.tier]}
                stroke={isHov ? '#fff' : (hasD3 ? '#3498DB' : TIER_COLORS[b.tier])}
                strokeWidth={isHov ? 2.5 : 2}>
                {hasD3 && !isHov && (
                  <animate attributeName="stroke" values="#3498DB;#FFD700;#FF6B35;#9B59B6;#3498DB" dur="4s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Photo */}
              {b.profile_image_url && (
                <>
                  <clipPath id={'bc-' + b.id}><circle cx={b.x} cy={b.y} r={isHov ? 11 : 9} /></clipPath>
                  <image href={b.profile_image_url} x={b.x - (isHov ? 11 : 9)} y={b.y - (isHov ? 11 : 9)}
                    width={isHov ? 22 : 18} height={isHov ? 22 : 18} clipPath={`url(#bc-${b.id})`} />
                </>
              )}
              {!b.profile_image_url && (
                <text x={b.x} y={b.y + 4} textAnchor="middle" fill={b.tier === 'S' ? '#000' : '#fff'}
                  fontSize={11} fontWeight={700}>{b.name?.charAt(0)}</text>
              )}
              {/* Name + count */}
              <text x={b.x} y={b.y + (isHov ? 24 : 22)} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={600}>
                {b.name?.split(' ')[0]}
              </text>
              <text x={b.x} y={b.y + (isHov ? 34 : 32)} textAnchor="middle" fill="#888" fontSize={7}>
                {b.clusterSize} · {sCount > 0 ? sCount + 'S ' : ''}{aCount > 0 ? aCount + 'A' : ''}
              </text>
            </g>
          );
        })}

        {/* Center: YOU */}
        <circle cx={cx} cy={cy} r={22} fill="#0a0a1a" stroke="#FFD700" strokeWidth={3} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#FFD700" fontSize={11} fontWeight={800}>
          {userName?.split(' ')[0] || 'YOU'}
        </text>
      </g>
      </svg>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20, zIndex: 20,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <button onClick={() => setZoom(z => Math.min(3, z + 0.3))} style={{
          width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 18, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>+</button>
        <button onClick={() => setZoom(1.3)} style={{
          width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.06)', color: '#666', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⊙</button>
        <button onClick={() => setZoom(z => Math.max(0.4, z - 0.3))} style={{
          width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 18, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>−</button>
      </div>

      {/* Depth tracker */}
      <div style={{
        position: 'absolute', bottom: 16, left: 12,
        background: 'rgba(0,0,0,0.75)', borderRadius: 10, padding: '10px 14px',
        backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.06)',
        maxWidth: 'calc(100vw - 80px)',
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: 1.5, marginBottom: 8 }}>DEGREES OF SEPARATION</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6].map(d => (
            <div key={d} style={{ textAlign: 'center' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: d <= 2 ? DEGREE_COLORS[d] : 'rgba(255,255,255,0.04)',
                color: d <= 2 ? '#000' : '#333',
                border: d <= 2 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: d <= 2 ? `0 0 6px ${DEGREE_COLORS[d]}30` : 'none',
              }}>D{d}</div>
              <div style={{ fontSize: 7, color: d <= 2 ? '#aaa' : '#333', marginTop: 3 }}>
                {d === 1 ? connections.length : d === 2 ? totalD2 : '—'}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#555', marginTop: 8 }}>
          {bridges.length} bridges · {d2S} S + {d2A} A at D2
        </div>
        <div style={{ fontSize: 8, color: '#444', marginTop: 4 }}>Click a bridge to see their D2 paths</div>
      </div>
    </div>
  );
}
