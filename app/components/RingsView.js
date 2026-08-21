'use client';

import { useState } from 'react';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const TIERS = ['S', 'A', 'B', 'C', 'D'];

// Pyramid View — S-tier crown at top, tiers cascade down
// Bridges mode: each bridge is a commander with D2 cluster below
export default function RingsView({ connections, degree2 = [], onSelect, mode }) {
  const [hoveredId, setHoveredId] = useState(null);
  const isDegreesMode = mode === 'degrees';

  // === BRIDGES PYRAMID ===
  if (isDegreesMode && degree2.length > 0) {
    // Build bridge clusters sorted by value
    const bridgeMap = {};
    degree2.forEach(d2 => {
      if (!d2.source_connection_id) return;
      if (!bridgeMap[d2.source_connection_id]) bridgeMap[d2.source_connection_id] = [];
      bridgeMap[d2.source_connection_id].push(d2);
    });

    const clusters = Object.entries(bridgeMap).map(([bridgeId, members]) => {
      const bridge = connections.find(c => c.id === bridgeId);
      if (!bridge) return null;
      const sCount = members.filter(m => m.tier === 'S').length;
      const aCount = members.filter(m => m.tier === 'A').length;
      return { bridge, members, sCount, aCount, total: members.length, value: sCount * 3 + aCount * 2 + members.length };
    }).filter(Boolean).sort((a, b) => b.value - a.value);

    const nodeSize = { S: 36, A: 28, B: 22, C: 16, D: 12 };

    return (
      <div style={{ flex: 1, overflow: 'auto', background: '#0a0a1a', padding: '20px 10px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {clusters.map((cl, ci) => {
            // Group D2 by tier
            const tierGroups = {};
            TIERS.forEach(t => { tierGroups[t] = []; });
            cl.members.forEach(m => { (tierGroups[m.tier] || tierGroups.D).push(m); });
            TIERS.forEach(t => { tierGroups[t].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0)); });

            return (
              <div key={cl.bridge.id} style={{ marginBottom: 30 }}>
                {/* Commander — the bridge person */}
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div
                    onClick={() => onSelect && onSelect(cl.bridge)}
                    onMouseEnter={() => setHoveredId(cl.bridge.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ display: 'inline-block', cursor: 'pointer', position: 'relative' }}
                  >
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', margin: '0 auto',
                      border: `3px solid ${TIER_COLORS[cl.bridge.tier]}`,
                      overflow: 'hidden', background: '#1a1a2e',
                      boxShadow: hoveredId === cl.bridge.id ? `0 0 20px ${TIER_COLORS[cl.bridge.tier]}60` : `0 0 10px ${TIER_COLORS[cl.bridge.tier]}20`,
                      transition: 'box-shadow 0.2s',
                    }}>
                      {cl.bridge.profile_image_url ? (
                        <img src={cl.bridge.profile_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: TIER_COLORS[cl.bridge.tier], color: cl.bridge.tier === 'S' ? '#000' : '#fff', fontSize: 20, fontWeight: 800 }}>
                          {cl.bridge.name?.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginTop: 4 }}>{cl.bridge.name}</div>
                    <div style={{ fontSize: 9, color: TIER_COLORS[cl.bridge.tier], fontWeight: 600 }}>
                      {cl.bridge.tier}-Tier · {cl.total} connections · {cl.sCount > 0 ? cl.sCount + 'S ' : ''}{cl.aCount > 0 ? cl.aCount + 'A' : ''}
                    </div>
                  </div>
                </div>

                {/* D2 tiers cascading down */}
                {TIERS.map(tier => {
                  const people = tierGroups[tier];
                  if (people.length === 0) return null;
                  const size = nodeSize[tier];
                  const gap = tier === 'S' ? 10 : tier === 'A' ? 6 : 4;
                  return (
                    <div key={tier} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: gap }}>
                        {people.map(p => {
                          const isHov = hoveredId === p.id;
                          return (
                            <div key={p.id}
                              onClick={() => onSelect && onSelect(p)}
                              onMouseEnter={() => setHoveredId(p.id)}
                              onMouseLeave={() => setHoveredId(null)}
                              style={{ position: 'relative', cursor: 'pointer' }}
                            >
                              <div style={{
                                width: size, height: size, borderRadius: '50%',
                                border: `2px solid ${TIER_COLORS[tier]}`,
                                overflow: 'hidden', background: p.profile_image_url ? '#111' : TIER_COLORS[tier],
                                transition: 'transform 0.15s, box-shadow 0.15s',
                                transform: isHov ? 'scale(1.3)' : 'scale(1)',
                                boxShadow: isHov ? `0 0 12px ${TIER_COLORS[tier]}60` : 'none',
                              }}>
                                {p.profile_image_url ? (
                                  <img src={p.profile_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    onError={e => { e.target.style.display = 'none'; e.target.parentElement.style.background = TIER_COLORS[tier]; }} />
                                ) : (
                                  <span style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center',
                                    fontSize: size * 0.4, fontWeight: 700, color: tier === 'S' ? '#000' : '#fff' }}>
                                    {p.name?.charAt(0)}
                                  </span>
                                )}
                              </div>
                              {(tier === 'S' || isHov) && (
                                <div style={{
                                  position: 'absolute', top: size + 2, left: '50%', transform: 'translateX(-50%)',
                                  whiteSpace: 'nowrap', textAlign: 'center', zIndex: 20, pointerEvents: 'none',
                                }}>
                                  <div style={{
                                    fontSize: isHov ? 10 : 8, fontWeight: 600,
                                    color: isHov ? '#fff' : '#aaa',
                                    background: isHov ? 'rgba(0,0,0,0.85)' : 'transparent',
                                    padding: isHov ? '3px 8px' : 0, borderRadius: 4,
                                  }}>
                                    {p.name?.split(' ')[0]}
                                    {isHov && <span style={{ color: TIER_COLORS[tier], marginLeft: 4 }}>{parseFloat(p.power_score || 0).toFixed(1)}</span>}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Divider */}
                      <div style={{
                        height: 1, margin: '6px auto 0',
                        width: `${40 + TIERS.indexOf(tier) * 10}%`,
                        background: `linear-gradient(90deg, transparent, ${TIER_COLORS[tier]}20, transparent)`,
                      }} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Group by tier
  const tierGroups = {};
  TIERS.forEach(t => { tierGroups[t] = []; });
  connections.forEach(c => {
    const t = c.tier || 'D';
    if (tierGroups[t]) tierGroups[t].push(c);
  });
  TIERS.forEach(t => {
    tierGroups[t].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));
  });

  // Node sizes per tier
  const nodeSize = { S: 44, A: 34, B: 26, C: 20, D: 16 };

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#0a0a1a', padding: '20px 10px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {TIERS.map((tier, tierIdx) => {
          const people = tierGroups[tier];
          if (people.length === 0) return null;
          const size = nodeSize[tier];
          const gap = tier === 'S' ? 12 : tier === 'A' ? 8 : tier === 'B' ? 6 : 4;

          return (
            <div key={tier} style={{ marginBottom: tier === 'S' ? 20 : tier === 'A' ? 16 : 10 }}>
              {/* Tier label */}
              <div style={{
                textAlign: 'center', marginBottom: 8,
                fontSize: tier === 'S' ? 14 : 11, fontWeight: 700,
                color: TIER_COLORS[tier],
                opacity: tier === 'S' ? 1 : 0.7,
              }}>
                {tier === 'S' && '👑 '}{tier}-Tier ({people.length})
              </div>

              {/* Dots row — centered, wrapping */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                gap: gap, padding: '0 20px',
              }}>
                {people.map(c => {
                  const isHovered = hoveredId === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => onSelect && onSelect(c)}
                      onMouseEnter={() => setHoveredId(c.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{ position: 'relative', cursor: 'pointer' }}
                    >
                      {/* Node */}
                      <div style={{
                        width: size, height: size, borderRadius: '50%',
                        border: `2px solid ${TIER_COLORS[tier]}`,
                        overflow: 'hidden',
                        background: c.profile_image_url ? '#111' : TIER_COLORS[tier],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                        transform: isHovered ? 'scale(1.3)' : 'scale(1)',
                        boxShadow: isHovered ? `0 0 16px ${TIER_COLORS[tier]}60` : 'none',
                        zIndex: isHovered ? 10 : 1,
                        position: 'relative',
                      }}>
                        {c.profile_image_url ? (
                          <img src={c.profile_image_url} alt="" style={{
                            width: '100%', height: '100%', objectFit: 'cover',
                          }} onError={e => {
                            e.target.style.display = 'none';
                            e.target.parentElement.style.background = TIER_COLORS[tier];
                          }} />
                        ) : (
                          <span style={{
                            fontSize: size * 0.4, fontWeight: 700,
                            color: tier === 'S' ? '#000' : '#fff',
                          }}>{c.name?.charAt(0)}</span>
                        )}
                      </div>

                      {/* Name label for S-tier always, others on hover */}
                      {(tier === 'S' || isHovered) && (
                        <div style={{
                          position: 'absolute', top: size + 4, left: '50%', transform: 'translateX(-50%)',
                          whiteSpace: 'nowrap', textAlign: 'center', zIndex: 20,
                          pointerEvents: 'none',
                        }}>
                          <div style={{
                            fontSize: tier === 'S' ? 9 : 10, fontWeight: 600,
                            color: isHovered ? '#fff' : '#aaa',
                            background: isHovered ? 'rgba(0,0,0,0.85)' : 'transparent',
                            padding: isHovered ? '3px 8px' : 0,
                            borderRadius: 4,
                          }}>
                            {c.name?.split(' ')[0]}
                            {isHovered && (
                              <span style={{ color: TIER_COLORS[tier], marginLeft: 4, fontWeight: 800 }}>
                                {parseFloat(c.power_score || 0).toFixed(1)}
                              </span>
                            )}
                          </div>
                          {isHovered && c.headline && (
                            <div style={{
                              fontSize: 8, color: '#888', marginTop: 2,
                              background: 'rgba(0,0,0,0.85)', padding: '2px 6px', borderRadius: 3,
                              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>{c.headline.substring(0, 40)}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Divider line between tiers */}
              {tierIdx < TIERS.length - 1 && (
                <div style={{
                  height: 1, margin: '12px auto 0',
                  width: `${50 + tierIdx * 12}%`,
                  background: `linear-gradient(90deg, transparent, ${TIER_COLORS[tier]}30, transparent)`,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
