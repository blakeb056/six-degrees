'use client';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };

export default function ListView({ connections, degree2 = [], onSelect, mode }) {
  const isDegreesMode = mode === 'degrees';

  if (isDegreesMode) {
    // Bridge clusters ranked list
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
      const value = sCount * 3 + aCount * 2 + members.length;
      return { bridge, members, sCount, aCount, total: members.length, value };
    }).filter(Boolean).sort((a, b) => b.value - a.value);

    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px', background: '#0a0a1a' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 50px 50px 50px 80px',
            gap: 8, padding: '8px 12px', fontSize: 9, fontWeight: 700, color: '#555',
            borderBottom: '1px solid rgba(255,255,255,0.1)', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            <span>#</span><span>Bridge</span><span>S</span><span>A</span><span>Total</span><span>Value</span>
          </div>
          {clusters.map((cl, i) => (
            <div key={cl.bridge.id} onClick={() => onSelect && onSelect(cl.bridge)}
              style={{
                display: 'grid', gridTemplateColumns: '40px 1fr 50px 50px 50px 80px',
                gap: 8, padding: '10px 12px', alignItems: 'center', cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: '#444' }}>{i + 1}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {cl.bridge.profile_image_url ? (
                  <img src={cl.bridge.profile_image_url} alt="" style={{
                    width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                    border: `2px solid ${TIER_COLORS[cl.bridge.tier]}`,
                  }} onError={e => { e.target.style.display = 'none'; }} />
                ) : (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0, fontSize: 10, fontWeight: 700,
                    background: TIER_COLORS[cl.bridge.tier], color: '#000',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{cl.bridge.name?.charAt(0)}</div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cl.bridge.name}
                  </div>
                  <div style={{ fontSize: 9, color: TIER_COLORS[cl.bridge.tier], fontWeight: 600 }}>{cl.bridge.tier}-Tier</div>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#FFD700' }}>{cl.sCount}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#9B59B6' }}>{cl.aCount}</span>
              <span style={{ fontSize: 12, color: '#888' }}>{cl.total}</span>
              <div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    background: `linear-gradient(90deg, ${TIER_COLORS[cl.bridge.tier]}, #FF6B35)`,
                    width: `${Math.min(100, (cl.value / Math.max(clusters[0]?.value || 1, 1)) * 100)}%`,
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Network Circle — ranked power list
  const sorted = [...connections].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));
  const maxScore = parseFloat(sorted[0]?.power_score) || 10;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px', background: '#0a0a1a' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 36px 1fr 60px 120px',
          gap: 8, padding: '8px 12px', fontSize: 9, fontWeight: 700, color: '#555',
          borderBottom: '1px solid rgba(255,255,255,0.1)', textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          <span>#</span><span></span><span>Name</span><span>Score</span><span>Power</span>
        </div>
        {sorted.map((c, i) => (
          <div key={c.id} onClick={() => onSelect && onSelect(c)}
            style={{
              display: 'grid', gridTemplateColumns: '40px 36px 1fr 60px 120px',
              gap: 8, padding: '8px 12px', alignItems: 'center', cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: i < 3 ? `${TIER_COLORS[c.tier]}08` : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = i < 3 ? `${TIER_COLORS[c.tier]}08` : 'transparent'}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: i < 3 ? TIER_COLORS[c.tier] : '#444' }}>{i + 1}</span>
            {c.profile_image_url ? (
              <img src={c.profile_image_url} alt="" style={{
                width: 28, height: 28, borderRadius: '50%', objectFit: 'cover',
                border: `2px solid ${TIER_COLORS[c.tier]}`,
              }} onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                background: TIER_COLORS[c.tier], color: c.tier === 'S' ? '#000' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{c.name?.charAt(0)}</div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
              <div style={{ fontSize: 9, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.headline?.substring(0, 45)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: TIER_COLORS[c.tier] }}>{parseFloat(c.power_score || 0).toFixed(1)}</span>
              <div style={{ fontSize: 8, color: '#555' }}>{c.tier}</div>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: TIER_COLORS[c.tier],
                width: `${(parseFloat(c.power_score || 0) / maxScore) * 100}%`,
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
