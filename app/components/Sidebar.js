'use client';

import { useState, useEffect } from 'react';
import { useUser } from './UserProvider';

export default function Sidebar({ selected, stats, tierColors, connections, degree2 = [], mode, collapsed, filter, pending = [], onToggle, onSelect, onSwitchMode, onFocusNode, onMarkSent, onUndoPending }) {
  const isDegreesMode = mode === 'degrees';
  const { userId, userProfile: ctxProfile } = useUser();
  const userProfile = ctxProfile || { name: 'User', sectors: [], goals: [] };
  const [searchQuery, setSearchQuery] = useState('');

  const bridgeMap = {};
  degree2.forEach(d2 => {
    if (!d2.source_connection_id) return;
    if (!bridgeMap[d2.source_connection_id]) bridgeMap[d2.source_connection_id] = [];
    bridgeMap[d2.source_connection_id].push(d2);
  });

  const bridgeName = (id) => connections.find(c => c.id === id)?.name || 'Unknown';

  const topD2 = [...degree2].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0)).slice(0, 25);

  if (selected) {
    const isBridge = selected.degree === 1 && bridgeMap[selected.id];
    const bridgeConnections = bridgeMap[selected.id] || [];
    const viaConnection = selected.degree === 2 ? connections.find(c => c.id === selected.source_connection_id) : null;

    return (
      <SidebarWrapper collapsed={collapsed} onToggle={onToggle}>
        {/* Back to list button */}
        <button
          onClick={() => onSelect && onSelect(null)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            color: '#888', fontSize: 12, cursor: 'pointer', padding: '0 0 10px', fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 16 }}>&larr;</span> Back to list
        </button>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          {selected.degree === 2 ? 'Degree 2 Connection' : 'Degree 1 Connection'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{
            background: selected.degree === 2 ? '#FF6B35' : tierColors[selected.tier],
            color: '#000', display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
          }}>
            {selected.degree === 2 ? `DEGREE 2 · TIER ${selected.tier}` : `TIER ${selected.tier}`}
          </div>
          {selected.is_catalyst && (
            <div style={{
              background: '#00ff88', color: '#000', display: 'inline-block',
              padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
            }}>
              CATALYST
            </div>
          )}
        </div>
        {/* Profile photo + name */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          {selected.profile_image_url ? (
            <img
              src={selected.profile_image_url}
              alt={selected.name}
              style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${tierColors[selected.tier] || '#555'}`, flexShrink: 0 }}
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
            />
          ) : null}
          <div style={{
            width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
            background: tierColors[selected.tier] || '#555',
            display: selected.profile_image_url ? 'none' : 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: selected.tier === 'S' ? '#000' : '#fff',
          }}>
            {selected.name?.charAt(0)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{selected.name}</h2>
            <p style={{ color: '#aaa', fontSize: 11, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.headline?.substring(0, 60)}</p>
            {selected.profile_url && (
              <a href={selected.profile_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#0077B5', textDecoration: 'none', fontWeight: 600 }}>
                View on LinkedIn
              </a>
            )}
          </div>
        </div>

        {selected.is_catalyst && (
          <div style={{
            background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.3)',
            borderRadius: 8, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, color: '#00ff88', fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>CATALYST NODE</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>
              This person&apos;s network power exceeds their own tier. They connect to{' '}
              <strong style={{ color: '#00ff88' }}>{selected.catalyst_score} S+A tier</strong>{' '}
              people — making them a high-value stepping stone to reach elite connections.
            </div>
          </div>
        )}

        {selected.degree === 2 && viaConnection && (
          <div style={{
            background: 'rgba(255,107,53,0.1)', border: '1px solid rgba(255,107,53,0.3)',
            borderRadius: 8, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, color: '#FF6B35', fontWeight: 600, marginBottom: 4 }}>PATH TO THIS PERSON</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>Blake</span>
              <Arrow />
              <span style={{ color: tierColors[viaConnection.tier], fontWeight: 600 }}>{viaConnection.name}</span>
              <Arrow />
              <span style={{ color: '#FF6B35', fontWeight: 600 }}>{selected.name}</span>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Via: {viaConnection.role}{viaConnection.company ? ` @ ${viaConnection.company}` : ''}
            </div>
          </div>
        )}

        {/* === SCORE CARD === */}
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Score</span>
            <span style={{ fontSize: 28, fontWeight: 800, color: tierColors[selected.tier] || '#fff' }}>
              {parseFloat(selected.power_score).toFixed(1)}
            </span>
          </div>
          {/* Job Power bar */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginBottom: 2 }}>
              <span>Seniority</span><span>{selected.seniority_score || 0}/10</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${(selected.seniority_score || 0) * 10}%`, background: tierColors[selected.tier] || '#FFD700', borderRadius: 2 }} />
            </div>
          </div>
          {/* Status Power bar */}
          <div style={{ marginBottom: selected.circle_power > 0 ? 6 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginBottom: 2 }}>
              <span>Company Prestige</span><span>{selected.company_prestige_score || 0}/10</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${(selected.company_prestige_score || 0) * 10}%`, background: '#3498DB', borderRadius: 2 }} />
            </div>
          </div>
          {/* Circle Power bar — only shows for bridges with clusters */}
          {selected.circle_power > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginBottom: 2 }}>
                <span>Circle Power</span>
                <span style={{ color: '#FF6B35' }}>{selected.circle_s_count || 0}S · {selected.circle_a_count || 0}A</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${Math.min(parseFloat(selected.circle_power) / 70 * 100, 100)}%`, background: '#FF6B35', borderRadius: 2 }} />
              </div>
            </div>
          )}
        </div>

        {/* === WHY THIS MATTERS === */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#FFD700', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>
            Why This Matters
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#ccc' }}>
            {generateInsights(selected, userProfile, connections, degree2).map((insight, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: insight.color || '#888', fontSize: 13, lineHeight: 1 }}>{insight.icon}</span>
                <span>{insight.text}</span>
              </div>
            ))}
          </div>
        </div>

        {selected.company && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#666', fontSize: 10 }}>Company</div>
            <div style={{ fontWeight: 600, fontSize: 12 }}>{selected.company}</div>
          </div>
        )}
        {selected.role && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#666', fontSize: 10 }}>Role</div>
            <div style={{ fontSize: 12 }}>{selected.role}</div>
          </div>
        )}

        {/* === CLUSTER OVERVIEW (when bridge is selected) === */}
        {isBridge && bridgeConnections.length > 0 && (() => {
          const sTier = bridgeConnections.filter(m => m.tier === 'S');
          const aTier = bridgeConnections.filter(m => m.tier === 'A');
          const topPeople = [...bridgeConnections].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0)).slice(0, 8);
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#FF6B35', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
                Cluster Overview — {bridgeConnections.length} connections
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 10 }}>
                {sTier.length > 0 && <span style={{ color: '#FFD700', fontWeight: 600 }}>{sTier.length} S-tier</span>}
                {aTier.length > 0 && <span style={{ color: '#9B59B6', fontWeight: 600 }}>{aTier.length} A-tier</span>}
              </div>
              {/* Outlink Bridge button */}
              <a href={`/queue?bridge=${selected.id}&groupBy=bridge`} style={{
                display: 'block', textAlign: 'center', padding: '8px 12px', marginBottom: 10,
                background: 'linear-gradient(135deg, #FF6B35, #FFD700)', color: '#000',
                borderRadius: 6, textDecoration: 'none', fontWeight: 700, fontSize: 11,
              }}>
                Outlink Bridge → Add {bridgeConnections.filter(m => m.tier === 'S' || m.tier === 'A' || m.tier === 'B').length} People
              </a>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 8 }}>Most valuable in this cluster:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {topPeople.map(m => (
                  <div key={m.id}
                    onClick={() => onSelect && onSelect(m)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                      borderRadius: 4, cursor: 'pointer', borderLeft: `2px solid ${tierColors[m.tier] || '#555'}`,
                      background: 'rgba(255,255,255,0.03)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  >
                    {m.profile_image_url ? (
                      <img src={m.profile_image_url} alt="" style={{
                        width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                        border: `1px solid ${tierColors[m.tier] || '#555'}`,
                      }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                    ) : null}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0, fontSize: 9, fontWeight: 700,
                      background: tierColors[m.tier] || '#555', color: m.tier === 'S' ? '#000' : '#fff',
                      display: m.profile_image_url ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{m.name?.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      <div style={{ fontSize: 8, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.headline?.substring(0, 40)}</div>
                    </div>
                    <span style={{ fontSize: 9, color: tierColors[m.tier], fontWeight: 600, flexShrink: 0 }}>{parseFloat(m.power_score).toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {isBridge && bridgeConnections.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#FF6B35', marginBottom: 8 }}>
              Gateway to {bridgeConnections.length} degree-2 connections:
            </div>
            {bridgeConnections.sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0)).slice(0, 10).map(c => (
              <div key={c.id} style={{
                padding: '6px 8px', background: 'rgba(255,107,53,0.08)', borderRadius: 6,
                borderLeft: '3px solid #FF6B35', marginBottom: 4, fontSize: 12,
              }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: '#888', fontSize: 11 }}>{c.role}{c.company ? ` @ ${c.company}` : ''}</div>
                <div style={{ color: '#FF6B35', fontSize: 10 }}>Score: {parseFloat(c.power_score).toFixed(1)}</div>
              </div>
            ))}
          </div>
        )}

        {/* View Bridge — switch to Bridges mode to see their cluster */}
        {!isDegreesMode && isBridge && bridgeConnections.length > 0 && onSwitchMode && (
          <button
            onClick={() => { onSwitchMode('degrees'); }}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #FF6B35, #FFD700)',
              color: '#000', fontWeight: 700, fontSize: 13, marginTop: 12,
            }}
          >
            View Bridge → {bridgeConnections.length} connections
          </button>
        )}

        {/* Connect to Unlock — for ALL degree-2 connections */}
        {(selected.degree === 2 || selected.source_connection_id) && selected.degree !== 1 && selected.unlock_status !== 'unlocked' && (
          <div style={{
            background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.25)',
            borderRadius: 10, padding: 16, marginTop: 16, textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: '#FFD700', fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
              {selected.unlock_status === 'pending' ? 'CONNECTION PENDING' : 'LOCKED PATH'}
            </div>
            <div style={{ fontSize: 13, color: '#ccc', marginBottom: 12 }}>
              {selected.unlock_status === 'pending'
                ? `Waiting for ${selected.name} to accept. Run the scraper to check.`
                : `Connect with ${selected.name} to unlock their network and extend your 6 degrees.`
              }
            </div>
            <div style={{
              width: '100%', height: 60, background: 'rgba(255,255,255,0.03)',
              borderRadius: 8, border: '1px dashed rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#444', marginBottom: 12,
            }}>
              {selected.unlock_status === 'pending' ? '[ Cluster Pending... ]' : '[ Hidden Network ]'}
            </div>
            {selected.unlock_status !== 'pending' && (
              <a href={selected.profile_url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'block', padding: '10px 16px',
                  background: 'linear-gradient(135deg, #FFD700, #FF6B35)',
                  color: '#000', borderRadius: 8, textDecoration: 'none',
                  fontWeight: 700, fontSize: 13,
                }}
                onClick={() => {
                  // Mark as pending in unlock system
                  fetch('/api/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connectionId: selected.id }),
                  }).catch(() => {});
                  // Sync to outreach/pending system (Outlink)
                  fetch('/api/outreach', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'mark-sent', connectionId: selected.id, profileUrl: selected.profile_url, userId }),
                  }).catch(() => {});
                }}
              >
                Connect to Unlock Path
              </a>
            )}
          </div>
        )}

        {/* Create Cluster — for D1 connections OR accepted D2 (promoted, ready to bridge for D3) */}
        {(selected.degree === 1 || selected.outreach_status === 'accepted') && (
          <CreateClusterCard selected={selected} degree2={degree2} />
        )}

        {selected.profile_url && (
          <a href={selected.profile_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block', textAlign: 'center', padding: 10, marginTop: 16,
              background: '#0077B5', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 13,
            }}>
            View LinkedIn Profile
          </a>
        )}
      </SidebarWrapper>
    );
  }

  if (isDegreesMode) {
    return (
      <SidebarWrapper collapsed={collapsed} onToggle={onToggle}>
        <button
          onClick={onToggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            color: '#888', fontSize: 12, cursor: 'pointer', padding: '0 0 10px', fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 16 }}>&larr;</span> Close
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, color: '#FF6B35' }}>Bridges</h3>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Your bridge connections and who they unlock.
        </p>

        {/* Auto-Bridge button */}
        <AutoBridgeButton connections={connections} degree2={degree2} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <StatBox label="Degree-2 Found" value={degree2.length} />
          <StatBox label="D2 S-Tier" value={stats?.d2Tiers?.S || 0} />
          <StatBox label="D2 A-Tier" value={stats?.d2Tiers?.A || 0} />
          <StatBox label="Bridges Used" value={Object.keys(bridgeMap).length} />
        </div>

        {/* Search bar for bridges */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search bridges or d2..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12,
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
              color: '#fff', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {searchQuery.length >= 2 && (() => {
            const q = searchQuery.toLowerCase();
            const bridgeMatches = connections.filter(c =>
              degree2.some(d => d.source_connection_id === c.id) &&
              c.name.toLowerCase().includes(q)
            ).slice(0, 5);
            const d2Matches = degree2.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 5);
            const allMatches = [
              ...bridgeMatches.map(m => ({ ...m, _matchType: 'bridge' })),
              ...d2Matches.map(m => ({ ...m, _matchType: 'd2' })),
            ];
            if (allMatches.length === 0) return null;
            return (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'rgba(10,10,26,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, overflow: 'hidden', maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {allMatches.map(m => (
                  <div key={m.id} onClick={() => {
                    onSelect(m);
                    setSearchQuery('');
                    if (onFocusNode && m._matchType === 'bridge') onFocusNode(m.id);
                  }} style={{
                    padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {m.profile_image_url ? (
                      <img src={m.profile_image_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: tierColors[m.tier] || '#555', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{m.name?.charAt(0)}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      <div style={{ fontSize: 8, color: '#666' }}>{m._matchType === 'bridge' ? 'Bridge' : 'Degree-2'}</div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: tierColors[m.tier] }}>{m.tier}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Pending Requests View */}
        {filter === 'pending' && pending.length > 0 && (
          <>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: '#FF6B35', marginBottom: 8 }}>
              ⏳ Pending Requests ({pending.length})
            </h4>
            <p style={{ fontSize: 10, color: '#666', marginBottom: 10, lineHeight: 1.4 }}>
              Friend requests you&apos;ve sent. When accepted, their cluster unlocks for bridging.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {pending.map(p => {
                const bridge = p.degree === 2 ? connections.find(c => c.id === p.source_connection_id) : null;
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: 'rgba(255,107,53,0.06)', borderRadius: 8,
                    border: '1px solid rgba(255,107,53,0.12)',
                  }}>
                    {/* Photo */}
                    {p.profile_image_url ? (
                      <img src={p.profile_image_url} alt="" style={{
                        width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                        border: `2px solid ${tierColors[p.tier] || '#555'}`,
                      }} onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0, fontSize: 12, fontWeight: 700,
                        background: tierColors[p.tier] || '#555', color: p.tier === 'S' ? '#000' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{p.name?.charAt(0)}</div>
                    )}

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 8, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.headline?.substring(0, 40)}
                      </div>
                      {bridge && (
                        <div style={{ fontSize: 8, color: '#FF6B35', marginTop: 1 }}>
                          via {bridge.name?.split(' ')[0]}
                        </div>
                      )}
                    </div>

                    {/* Tier + Score */}
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: tierColors[p.tier] || '#888' }}>
                        {p.tier}
                      </div>
                      <div style={{ fontSize: 8, color: '#666' }}>
                        {parseFloat(p.power_score || 0).toFixed(1)}
                      </div>
                    </div>

                    {/* Undo button */}
                    <button
                      onClick={() => onUndoPending && onUndoPending(p)}
                      title="Remove from pending"
                      style={{
                        background: 'none', border: 'none', color: '#555', cursor: 'pointer',
                        fontSize: 12, padding: 2, flexShrink: 0,
                      }}
                    >✕</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Clusters View (hidden when viewing pending) */}
        {filter !== 'pending' && (<>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: '#FF6B35', marginBottom: 8 }}>Most Valuable Clusters</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(() => {
            const clusterStats = Object.entries(bridgeMap).map(([bridgeId, members]) => {
              const bridge = connections.find(c => c.id === bridgeId);
              if (!bridge) return null;
              const total = members.length;
              if (total === 0) return null;

              const sTier = members.filter(m => m.tier === 'S');
              const aTier = members.filter(m => m.tier === 'A');
              const bTier = members.filter(m => m.tier === 'B');
              const sCount = sTier.length;
              const aCount = aTier.length;
              const bCount = bTier.length;

              // S-tier quality: count × average S power (normalized to 7.0 baseline)
              const sAvgPower = sCount > 0 ? sTier.reduce((s, m) => s + (parseFloat(m.power_score) || 0), 0) / sCount : 0;
              const sImpact = sCount * (sAvgPower / 7.0) * 15;

              // A-tier quality: count × average A power (normalized to 5.5 baseline)
              const aAvgPower = aCount > 0 ? aTier.reduce((s, m) => s + (parseFloat(m.power_score) || 0), 0) / aCount : 0;
              const aImpact = aCount * (aAvgPower / 5.5) * 6;

              // Rising stars: B-tiers with power > 5.0 (approaching A threshold)
              const risingCount = bTier.filter(m => (parseFloat(m.power_score) || 0) >= 5.0).length;
              const risingImpact = risingCount * 3;

              // Elite density: what % of cluster is S+A tier (higher = more concentrated power)
              const elitePct = (sCount + aCount) / total;
              const densityBonus = elitePct * 25;

              // Cluster depth: log scale (100 connections ≠ 10× better than 10)
              const depthBonus = Math.log2(total + 1) * 2;

              // Catalyst bonus: bridge punches above their weight
              const catalystBonus = bridge.is_catalyst ? 10 : 0;

              const clusterValue = sImpact + aImpact + risingImpact + densityBonus + depthBonus + catalystBonus;
              const avgPower = members.reduce((s, m) => s + (parseFloat(m.power_score) || 0), 0) / total;

              // Keep the raw member lists for the expandable view
              const topMembers = [...members].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));

              return {
                bridge, members: total, sCount, aCount, bCount, risingCount,
                sAvgPower, avgPower, elitePct, clusterValue,
                sTier, aTier, topMembers,
              };
            }).filter(Boolean).sort((a, b) => b.clusterValue - a.clusterValue);

            return clusterStats.map((cs, i) => (
              <ClusterCard key={cs.bridge.id} cs={cs} rank={i + 1} tierColors={tierColors} onSelect={onSelect} />
            ));
          })()}
        </div>
        </>)}
      </SidebarWrapper>
    );
  }

  // All connections sorted by power score — full scrollable ranked list
  const allRanked = [...(connections || [])].sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));
  const searchResults = searchQuery.length >= 2
    ? allRanked.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8)
    : [];

  return (
    <SidebarWrapper collapsed={collapsed} onToggle={onToggle}>
      {/* Close button */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, color: '#aaa', fontSize: 12, cursor: 'pointer',
          padding: '6px 12px', marginBottom: 12, fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 16 }}>&larr;</span> Close
      </button>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 0 }}>Network Circle</h3>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <StatBox label="Total Connections" value={stats.total} />
          <StatBox label="S-Tier" value={stats.tiers?.S || 0} />
          <StatBox label="A-Tier" value={stats.tiers?.A || 0} />
          <StatBox label="B-Tier" value={stats.tiers?.B || 0} />
        </div>
      )}

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search connections..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8, boxSizing: 'border-box',
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)',
            color: '#fff', fontSize: 12, outline: 'none',
          }}
        />
        {searchResults.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: 'rgba(10,10,26,0.98)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, marginTop: 4, overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            {searchResults.map(c => (
              <div
                key={c.id}
                onClick={() => {
                  onSelect && onSelect(c);
                  onFocusNode && onFocusNode(c.id);
                  setSearchQuery('');
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {c.profile_image_url ? (
                  <img src={c.profile_image_url} alt="" style={{
                    width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                    border: `1.5px solid ${tierColors[c.tier] || '#555'}`,
                  }} onError={e => { e.target.style.display = 'none'; }} />
                ) : (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0, fontSize: 10, fontWeight: 700,
                    background: tierColors[c.tier] || '#555', color: c.tier === 'S' ? '#000' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{c.name?.charAt(0)}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 9, color: '#666' }}>{c.headline?.substring(0, 35)}</div>
                </div>
                <span style={{ fontSize: 10, color: tierColors[c.tier], fontWeight: 700 }}>{c.tier}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <h4 style={{ fontSize: 13, fontWeight: 600, color: '#FFD700', marginBottom: 8 }}>
        Power Rankings ({allRanked.length})
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {(() => {
          // Track per-tier rank numbering
          const tierRankCounter = {};
          return allRanked.map((c, i) => {
          const prevTier = i > 0 ? allRanked[i - 1].tier : null;
          const showHeader = c.tier !== prevTier;
          if (showHeader) tierRankCounter[c.tier] = 0;
          tierRankCounter[c.tier] = (tierRankCounter[c.tier] || 0) + 1;
          const tierRank = tierRankCounter[c.tier];
          const tierNames = { S: 'S-Tier — Elite', A: 'A-Tier — High Value', B: 'B-Tier — Notable', C: 'C-Tier — Standard', D: 'D-Tier — Entry' };
          const tierCounts = {};
          allRanked.forEach(r => { tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1; });
          return (
          <div key={c.id}>
            {showHeader && (
              <div style={{
                padding: '8px 10px', marginTop: i > 0 ? 8 : 0, marginBottom: 4,
                background: `${tierColors[c.tier] || '#555'}15`,
                borderLeft: `3px solid ${tierColors[c.tier] || '#555'}`,
                borderRadius: 4, fontSize: 11, fontWeight: 700,
                color: tierColors[c.tier] || '#888',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{tierNames[c.tier] || c.tier}</span>
                <span style={{ fontWeight: 400, opacity: 0.7 }}>{tierCounts[c.tier] || 0}</span>
              </div>
            )}
            <div
              onClick={() => { onSelect && onSelect(c); onFocusNode && onFocusNode(c.id); }}
              style={{
                padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6,
                borderLeft: `3px solid ${tierColors[c.tier] || '#555'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
            {/* Rank number — per tier */}
            <span style={{ color: '#555', fontSize: 10, fontWeight: 600, minWidth: 22, textAlign: 'right' }}>
              #{tierRank}
            </span>
            {/* Profile photo or initial */}
            {c.profile_image_url ? (
              <img
                src={c.profile_image_url}
                alt=""
                style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                  border: `1.5px solid ${tierColors[c.tier] || '#555'}` }}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: tierColors[c.tier] || '#555',
              display: c.profile_image_url ? 'none' : 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: c.tier === 'S' ? '#000' : '#fff',
            }}>
              {c.name?.charAt(0)}
            </div>
            {/* Name + info */}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
              </div>
              <div style={{ fontSize: 9, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.headline?.substring(0, 45)}
              </div>
            </div>
            {/* Score + tier */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: tierColors[c.tier] || '#555' }}>
                {parseFloat(c.power_score).toFixed(1)}
              </div>
              <div style={{ fontSize: 8, color: '#555' }}>{c.tier}</div>
            </div>
          </div>
          </div>
          );
        });
        })()}
      </div>
    </SidebarWrapper>
  );
}

function SidebarWrapper({ children, collapsed, onToggle }) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => { const c = () => setIsMobile(window.innerWidth < 768); c(); window.addEventListener('resize', c); return () => window.removeEventListener('resize', c); }, []);
  if (collapsed) {
    // When collapsed: floating button with hover label
    return (
      <div
        onClick={onToggle}
        style={{
          position: 'fixed', right: 16, top: 140, zIndex: 30, cursor: 'pointer',
          display: 'flex', alignItems: 'center', flexDirection: 'row-reverse', gap: 0,
          height: 36, borderRadius: 18,
          background: 'rgba(255,215,0,0.15)', border: '2px solid rgba(255,215,0,0.5)',
          color: '#FFD700', fontWeight: 700,
          boxShadow: '0 0 12px rgba(255,215,0,0.3)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          overflow: 'hidden', transition: 'width 0.25s ease',
          width: 36,
          padding: '0 10px',
        }}
        onMouseEnter={e => { e.currentTarget.style.width = '120px'; }}
        onMouseLeave={e => { e.currentTarget.style.width = '36px'; }}
      >
        <span style={{ fontSize: 18, flexShrink: 0, width: 16, textAlign: 'center' }}>‹</span>
        <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginRight: 6, opacity: 0.9 }}>Details</span>
      </div>
    );
  }

  return (
    <div style={isMobile ? {
      position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 100,
      width: '100vw', pointerEvents: 'auto',
    } : { flexShrink: 0, height: '100%' }}>
      {isMobile && <div onClick={onToggle} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />}
      <div style={{
        width: isMobile ? '80vw' : 320, minWidth: isMobile ? 0 : 320, maxWidth: isMobile ? 300 : 320, height: '100%',
        borderLeft: '1px solid rgba(255,215,0,0.12)',
        padding: isMobile ? '12px 10px' : '16px 16px',
        overflowY: 'auto', overflowX: 'hidden',
        background: isMobile ? 'rgba(15,12,5,0.98)' : 'rgba(15,12,5,0.65)', fontSize: 13,
        backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
        boxShadow: 'inset 0 0 60px rgba(255,215,0,0.03), -4px 0 24px rgba(0,0,0,0.3)',
        marginLeft: isMobile ? 'auto' : 0,
      }}>
        {children}
      </div>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 12px', borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Arrow() {
  return <span style={{ color: '#555', fontSize: 16 }}>&rarr;</span>;
}

function CreateClusterCard({ selected, degree2 }) {
  const { userId } = useUser();
  const [status, setStatus] = useState('idle'); // idle, checking, scraping, done, error, offline
  const [log, setLog] = useState([]);
  const hasCluster = degree2?.some(d => d.source_connection_id === selected.id);
  const clusterCount = degree2?.filter(d => d.source_connection_id === selected.id).length || 0;

  if (hasCluster && status === 'idle') {
    return (
      <div style={{
        background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.2)',
        borderRadius: 10, padding: 16, marginTop: 16, textAlign: 'center',
      }}>
        <div style={{ fontSize: 10, color: '#00ff88', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
          CLUSTER ACTIVE
        </div>
        <div style={{ fontSize: 13, color: '#aaa' }}>
          {clusterCount} connections mapped in 6 Degrees
        </div>
        <button
          onClick={startScrape}
          style={{
            marginTop: 10, padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'rgba(0,255,136,0.12)', color: '#00ff88', fontWeight: 600, fontSize: 11,
          }}
        >
          Rescan Cluster
        </button>
      </div>
    );
  }

  async function startScrape() {
    setStatus('checking');
    setLog(['Checking scraper server...']);
    try {
      const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
      const data = await ping.json();
      if (!data.ok) throw new Error('Server not ready');
    } catch {
      setStatus('offline');
      setLog(['Scraper server is offline. Double-click "Start Scraper" on your Desktop first.']);
      return;
    }

    setStatus('scraping');
    setLog(['Starting bridge scrape for ' + selected.name + '...']);

    try {
      await fetch('http://localhost:5555/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bridge', bridge: selected.name, userId }),
      });

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const r = await fetch('http://localhost:5555/status');
          const s = await r.json();
          setLog(s.log || []);
          if (!s.running && s.result) {
            clearInterval(pollInterval);
            if (s.result.status === 'error') {
              setStatus('error');
            } else {
              setStatus('done');
              setLog(prev => [...prev, `Done! ${s.result.found || 0} connections found. Refresh to see the cluster.`]);
            }
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch {
      setStatus('error');
      setLog(['Failed to start scrape']);
    }
  }

  return (
    <div style={{
      background: 'rgba(155,89,182,0.08)', border: '1px solid rgba(155,89,182,0.3)',
      borderRadius: 10, padding: 16, marginTop: 16,
    }}>
      <div style={{ fontSize: 10, color: '#9B59B6', fontWeight: 700, letterSpacing: 1, marginBottom: 6, textAlign: 'center' }}>
        CREATE CLUSTER
      </div>
      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 12, textAlign: 'center' }}>
        Scrape {selected.name}&apos;s connections to map their network
      </div>

      {status === 'idle' && (
        <button
          onClick={startScrape}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #9B59B6, #3498DB)',
            color: '#fff', fontWeight: 700, fontSize: 14,
          }}
        >
          Scan {selected.name}&apos;s Network
        </button>
      )}

      {status === 'offline' && (
        <>
          <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
            Scraper server offline
          </div>
          <div style={{ fontSize: 10, color: '#888', textAlign: 'center', marginBottom: 8 }}>
            Double-click <strong>Start Scraper</strong> on your Desktop, then try again
          </div>
          <button onClick={() => { setStatus('idle'); }} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
          }}>
            Retry
          </button>
        </>
      )}

      {(status === 'checking' || status === 'scraping') && (
        <div>
          <div style={{
            padding: '10px', borderRadius: 8, background: 'rgba(155,89,182,0.1)',
            border: '1px solid rgba(155,89,182,0.3)', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9B59B6', animation: 'pulse 1s infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9B59B6' }}>Scanning...</span>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#888', maxHeight: 100, overflow: 'auto' }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div style={{
          padding: '10px', borderRadius: 8, background: 'rgba(0,255,136,0.1)',
          border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88', fontSize: 12, fontWeight: 600, textAlign: 'center',
        }}>
          Cluster created! Refresh the page to see it.
        </div>
      )}

      {status === 'error' && (
        <>
          <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
            Scrape failed — connections may be private
          </div>
          <button onClick={() => { setStatus('idle'); setLog([]); }} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
          }}>
            Try Again
          </button>
        </>
      )}
    </div>
  );
}

function ClusterCard({ cs, rank, tierColors, onSelect }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)', borderRadius: 6,
      borderLeft: `3px solid ${tierColors[cs.bridge.tier] || '#FF6B35'}`,
      overflow: 'hidden',
    }}>
      {/* Main card — bridge name clickable to view full profile */}
      <div style={{ padding: '10px 10px' }}>
        <div
          onClick={() => onSelect && onSelect(cs.bridge)}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {cs.bridge.profile_image_url ? (
              <img src={cs.bridge.profile_image_url} alt="" style={{
                width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                border: `1.5px solid ${tierColors[cs.bridge.tier] || '#555'}`,
              }} onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0, fontSize: 11, fontWeight: 700,
                background: tierColors[cs.bridge.tier] || '#555', color: cs.bridge.tier === 'S' ? '#000' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{cs.bridge.name?.charAt(0)}</div>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 12 }}>
                <span style={{ color: '#555', marginRight: 4 }}>#{rank}</span>{cs.bridge.name}
              </div>
              <div style={{ fontSize: 9, color: '#666' }}>{cs.bridge.headline?.substring(0, 40)}</div>
            </div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: tierColors[cs.bridge.tier], color: cs.bridge.tier === 'S' ? '#000' : '#fff',
          }}>{cs.bridge.tier}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 10 }}>
          {cs.sCount > 0 && <span style={{ color: '#FFD700', fontWeight: 600 }}>{cs.sCount}S{cs.sAvgPower > 0 ? ` (${cs.sAvgPower.toFixed(1)})` : ''}</span>}
          {cs.aCount > 0 && <span style={{ color: '#9B59B6', fontWeight: 600 }}>{cs.aCount}A</span>}
          {cs.bCount > 0 && <span style={{ color: '#3498DB' }}>{cs.bCount}B</span>}
          {cs.risingCount > 0 && <span style={{ color: '#2ECC71' }}>{cs.risingCount} rising</span>}
          <span style={{ color: '#555' }}>{cs.members} total</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: 10 }}>
          <span style={{ color: '#666' }}>
            Elite: {(cs.elitePct * 100).toFixed(0)}% · Avg: {cs.avgPower.toFixed(1)}
          </span>
          <span style={{ color: '#FF6B35', fontWeight: 700 }}>
            {cs.clusterValue.toFixed(1)}
          </span>
        </div>

        {/* Top mutuals preview — always show top 3 S/A tier faces */}
        {(cs.sTier.length > 0 || cs.aTier.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            {[...cs.sTier, ...cs.aTier].slice(0, 4).map(m => (
              m.profile_image_url ? (
                <img key={m.id} src={m.profile_image_url} alt={m.name}
                  style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover',
                    border: `1.5px solid ${tierColors[m.tier] || '#555'}` }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                  title={m.name}
                />
              ) : (
                <div key={m.id} style={{
                  width: 22, height: 22, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                  background: tierColors[m.tier] || '#555', color: m.tier === 'S' ? '#000' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} title={m.name}>{m.name?.charAt(0)}</div>
              )
            ))}
            {(cs.sCount + cs.aCount) > 4 && (
              <span style={{ fontSize: 9, color: '#666' }}>+{cs.sCount + cs.aCount - 4} more</span>
            )}
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 6, background: 'none', border: 'none', color: '#888',
            fontSize: 10, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <span style={{ fontSize: 12 }}>{expanded ? '▾' : '▸'}</span>
          {expanded ? 'Hide members' : `View all ${cs.members} members`}
        </button>
      </div>

      {/* Expanded member list */}
      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '6px 10px 10px', maxHeight: 250, overflowY: 'auto',
        }}>
          {cs.topMembers.map(m => (
            <div
              key={m.id}
              onClick={() => onSelect && onSelect(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px',
                cursor: 'pointer', borderRadius: 4,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {m.profile_image_url ? (
                <img src={m.profile_image_url} alt="" style={{
                  width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                  border: `1px solid ${tierColors[m.tier] || '#555'}`,
                }} onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              ) : null}
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0, fontSize: 8, fontWeight: 700,
                background: tierColors[m.tier] || '#555', color: m.tier === 'S' ? '#000' : '#fff',
                display: m.profile_image_url ? 'none' : 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>{m.name?.charAt(0)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </div>
              </div>
              <span style={{ fontSize: 9, color: tierColors[m.tier] || '#555', fontWeight: 600, flexShrink: 0 }}>
                {m.tier} {parseFloat(m.power_score).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Rule-based insight generator — no AI, just data logic
function generateInsights(person, user, allConnections, degree2) {
  const insights = [];
  const headline = (person.headline || '').toLowerCase();
  const role = (person.role || '').toLowerCase();
  const company = (person.company || '').toLowerCase();
  const userSectors = user.sectors.map(s => s.toLowerCase());

  // 1. Title leverage
  if (role.match(/ceo|chief|founder|president|chairman/i)) {
    insights.push({ icon: '👑', text: `${person.role} — C-suite executive, highest leverage contact`, color: '#FFD700' });
  } else if (role.match(/vp|vice president|svp|evp|managing director/i)) {
    insights.push({ icon: '⚡', text: `${person.role} — VP-level, strong decision-making authority`, color: '#FFD700' });
  } else if (role.match(/director|head of|senior director/i)) {
    insights.push({ icon: '🎯', text: `${person.role} — Senior leadership, controls team/budget`, color: '#FF6B35' });
  } else if (role.match(/manager|lead|principal/i)) {
    insights.push({ icon: '📊', text: `${person.role} — Mid-senior, operational influence`, color: '#3498DB' });
  }

  // 2. Company prestige
  const prestigeCompanies = ['snap', 'google', 'meta', 'apple', 'amazon', 'microsoft', 'netflix', 'tesla', 'spotify', 'tiktok', 'bytedance', 'coca-cola', 'nike', 'disney', 'palantir', 'stripe', 'coinbase', 'polymarket', 'pinterest', 'whatnot', 'blackrock'];
  const atPrestige = prestigeCompanies.find(c => company.includes(c) || headline.includes(c));
  if (atPrestige) {
    insights.push({ icon: '🏢', text: `At ${atPrestige.charAt(0).toUpperCase() + atPrestige.slice(1)} — top-tier company network access`, color: '#9B59B6' });
  }

  // 3. Former prestige companies in headline
  const formerMatch = headline.match(/(?:former|ex|prev)[- ]?(snap|google|meta|apple|amazon|microsoft|blackrock|goldman|mckinsey|stripe|palantir)/i);
  if (formerMatch) {
    insights.push({ icon: '📜', text: `Former ${formerMatch[1]} — carries network from previous role`, color: '#95A5A6' });
  }

  // 4. Sector overlap with user
  const matchingSectors = userSectors.filter(s => headline.includes(s) || company.includes(s));
  if (matchingSectors.length > 0) {
    insights.push({ icon: '🔗', text: `Shared sector: ${matchingSectors.join(', ')} — direct industry relevance to you`, color: '#2ECC71' });
  }

  // 5. Bridge / gateway value
  const bridgeCount = degree2.filter(d => d.source_connection_id === person.id).length;
  if (bridgeCount > 0) {
    const bridgeSCount = degree2.filter(d => d.source_connection_id === person.id && d.tier === 'S').length;
    insights.push({ icon: '🌐', text: `Gateway to ${bridgeCount} degree-2 connections${bridgeSCount > 0 ? ` (${bridgeSCount} S-tier)` : ''}`, color: '#FF6B35' });
  }

  // 6. Catalyst
  if (person.is_catalyst) {
    insights.push({ icon: '⚡', text: `Catalyst — network power exceeds personal tier, high stepping-stone value`, color: '#00ff88' });
  }

  // 7. Mutual connection density (degree 2)
  if (person.degree === 2 && person.source_connection_id) {
    const bridge = allConnections.find(c => c.id === person.source_connection_id);
    if (bridge) {
      insights.push({ icon: '🤝', text: `Reachable via ${bridge.name} (${bridge.tier}-tier) — ${bridge.degree === 1 ? 'direct' : 'indirect'} path`, color: '#3498DB' });
    }
  }

  // Fallback if no insights generated
  if (insights.length === 0) {
    insights.push({ icon: '📌', text: `${person.tier}-tier connection with ${parseFloat(person.power_score).toFixed(1)} power score`, color: '#888' });
  }

  return insights.slice(0, 5); // Max 5 insights
}

function AutoBridgeButton({ connections, degree2 }) {
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState([]);
  const [target, setTarget] = useState(null);

  // Find the top S-tier person without a cluster
  const bridgedIds = new Set(degree2.map(d => d.source_connection_id).filter(Boolean));
  const unbridged = (connections || [])
    .filter(c => (c.tier === 'S' || c.tier === 'A') && !bridgedIds.has(c.id))
    .sort((a, b) => (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));

  if (unbridged.length === 0 && status === 'idle') {
    return (
      <div style={{
        padding: '10px', borderRadius: 8, marginBottom: 16,
        background: 'rgba(0,255,136,0.06)', border: '1px solid rgba(0,255,136,0.2)',
        color: '#00ff88', fontSize: 11, fontWeight: 600, textAlign: 'center',
      }}>
        All S/A-tier bridges mapped
      </div>
    );
  }

  async function startAutoBridge() {
    const next = unbridged[0];
    if (!next) return;
    setTarget(next);
    setStatus('checking');
    setLog([`Scanning ${next.name}'s network...`]);

    try {
      const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
      if (!(await ping.json()).ok) throw new Error();
    } catch {
      setStatus('offline');
      setLog(['Scraper server offline. Start it first.']);
      return;
    }

    setStatus('scraping');
    try {
      await fetch('http://localhost:5555/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bridge', bridge: next.name, userId }),
      });
      const poll = setInterval(async () => {
        try {
          const r = await fetch('http://localhost:5555/status');
          const d = await r.json();
          setLog(d.log || []);
          if (!d.running && d.result) {
            clearInterval(poll);
            setStatus(d.result.status === 'error' ? 'error' : 'done');
          }
        } catch {}
      }, 2000);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{
      background: 'rgba(155,89,182,0.08)', border: '1px solid rgba(155,89,182,0.2)',
      borderRadius: 10, padding: 14, marginBottom: 16,
    }}>
      {status === 'idle' && (
        <>
          <div style={{ fontSize: 11, color: '#9B59B6', fontWeight: 700, marginBottom: 6 }}>
            {unbridged.length} bridges unmapped
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>
            Next: <strong>{unbridged[0]?.name}</strong> ({unbridged[0]?.tier}-tier, {parseFloat(unbridged[0]?.power_score).toFixed(1)})
          </div>
          <button onClick={startAutoBridge} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #9B59B6, #FF6B35)',
            color: '#fff', fontWeight: 700, fontSize: 13,
          }}>
            Auto-Bridge Next
          </button>
        </>
      )}

      {status === 'offline' && (
        <>
          <div style={{ padding: '8px', borderRadius: 6, background: 'rgba(255,80,80,0.1)', color: '#ff5050', fontSize: 11, marginBottom: 6, textAlign: 'center' }}>
            Scraper offline
          </div>
          <button onClick={() => setStatus('idle')} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontSize: 11,
          }}>Retry</button>
        </>
      )}

      {(status === 'checking' || status === 'scraping') && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#9B59B6', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#9B59B6' }}>Scanning {target?.name}...</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#777', maxHeight: 80, overflow: 'auto' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {status === 'done' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ padding: '8px', borderRadius: 6, background: 'rgba(0,255,136,0.1)', color: '#00ff88', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
            {target?.name}&rsquo;s bridge mapped! Refresh to see.
          </div>
          <button onClick={() => { setStatus('idle'); setTarget(null); setLog([]); }} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #9B59B6, #FF6B35)',
            color: '#fff', fontWeight: 600, fontSize: 11,
          }}>Bridge Next</button>
        </div>
      )}

      {status === 'error' && (
        <>
          <div style={{ padding: '8px', borderRadius: 6, background: 'rgba(255,80,80,0.1)', color: '#ff5050', fontSize: 11, marginBottom: 6, textAlign: 'center' }}>
            Failed — connections may be private
          </div>
          <button onClick={() => { setStatus('idle'); setTarget(null); setLog([]); }} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontSize: 11,
          }}>Try Next</button>
        </>
      )}
    </div>
  );
}
