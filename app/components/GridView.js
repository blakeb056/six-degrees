'use client';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const TIERS = ['S', 'A', 'B', 'C', 'D'];

export default function GridView({ connections, degree2 = [], onSelect, mode }) {
  const isDegreesMode = mode === 'degrees';

  if (isDegreesMode) {
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
      return { bridge, members, sCount, aCount, total: members.length };
    }).filter(Boolean).sort((a, b) => (b.sCount * 3 + b.aCount * 2 + b.total) - (a.sCount * 3 + a.aCount * 2 + a.total));

    return (
      <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#0a0a1a' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, maxWidth: 1200, margin: '0 auto' }}>
          {clusters.map(cl => (
            <div key={cl.bridge.id} onClick={() => onSelect && onSelect(cl.bridge)}
              style={{
                padding: 16, borderRadius: 12, cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${TIER_COLORS[cl.bridge.tier] || '#333'}30`,
                borderLeft: `4px solid ${TIER_COLORS[cl.bridge.tier] || '#555'}`,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {cl.bridge.profile_image_url ? (
                  <img src={cl.bridge.profile_image_url} alt="" style={{
                    width: 40, height: 40, borderRadius: '50%', objectFit: 'cover',
                    border: `2px solid ${TIER_COLORS[cl.bridge.tier]}`,
                  }} onError={e => { e.target.style.display = 'none'; }} />
                ) : (
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', fontSize: 16, fontWeight: 700,
                    background: TIER_COLORS[cl.bridge.tier], color: '#000',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{cl.bridge.name?.charAt(0)}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{cl.bridge.name}</div>
                  <div style={{ fontSize: 9, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cl.bridge.headline?.substring(0, 40)}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: TIER_COLORS[cl.bridge.tier] }}>{cl.bridge.tier}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
                {cl.sCount > 0 && <span style={{ color: '#FFD700', fontWeight: 600 }}>{cl.sCount}S</span>}
                {cl.aCount > 0 && <span style={{ color: '#9B59B6', fontWeight: 600 }}>{cl.aCount}A</span>}
                <span style={{ color: '#666' }}>{cl.total} total</span>
              </div>
              <div style={{ display: 'flex', marginTop: 8 }}>
                {cl.members.slice(0, 8).map((m, i) => (
                  <div key={m.id} style={{
                    width: 22, height: 22, borderRadius: '50%', fontSize: 8, fontWeight: 700,
                    background: m.profile_image_url ? 'transparent' : (TIER_COLORS[m.tier] || '#333'),
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #0a0a1a', marginLeft: i > 0 ? -6 : 0, position: 'relative', zIndex: 8 - i,
                    overflow: 'hidden',
                  }}>
                    {m.profile_image_url ? (
                      <img src={m.profile_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : m.name?.charAt(0)}
                  </div>
                ))}
                {cl.total > 8 && <span style={{ fontSize: 9, color: '#555', marginLeft: 4, alignSelf: 'center' }}>+{cl.total - 8}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Network Circle — group by tier, render as sections with grid cards
  const tierGroups = {};
  TIERS.forEach(t => { tierGroups[t] = []; });
  connections.forEach(c => {
    const t = c.tier || 'D';
    if (tierGroups[t]) tierGroups[t].push(c);
  });
  // Sort each group by power score
  TIERS.forEach(t => {
    tierGroups[t].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));
  });

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#0a0a1a' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {TIERS.map(tier => {
          const people = tierGroups[tier];
          if (people.length === 0) return null;
          return (
            <div key={tier} style={{ marginBottom: 24 }}>
              {/* Tier header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 10px',
                borderBottom: `2px solid ${TIER_COLORS[tier]}30`, marginBottom: 10,
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: TIER_COLORS[tier],
                }} />
                <span style={{ fontSize: 15, fontWeight: 800, color: TIER_COLORS[tier] }}>{tier}-Tier</span>
                <span style={{ fontSize: 12, color: '#555' }}>{people.length}</span>
              </div>
              {/* Cards grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {people.map(c => (
                  <div key={c.id} onClick={() => onSelect && onSelect(c)}
                    style={{
                      padding: 10, borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${TIER_COLORS[tier]}20`,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.profile_image_url ? (
                        <img src={c.profile_image_url} alt="" style={{
                          width: 32, height: 32, borderRadius: '50%', objectFit: 'cover',
                          border: `2px solid ${TIER_COLORS[tier]}`,
                        }} onError={e => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', fontSize: 12, fontWeight: 700,
                          background: TIER_COLORS[tier], color: tier === 'S' ? '#000' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{c.name?.charAt(0)}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                        <div style={{ fontSize: 8, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.headline?.substring(0, 30)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[tier] }}>{parseFloat(c.power_score || 0).toFixed(1)}</span>
                      <div style={{ flex: 1, marginLeft: 8, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: TIER_COLORS[tier], width: `${Math.min(100, (parseFloat(c.power_score) || 0) * 10)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
