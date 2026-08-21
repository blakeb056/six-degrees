'use client';

import { useEffect, useState } from 'react';
import { loadNetwork } from '../../lib/network';
import { IS_DEMO } from '../../lib/demo';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';
import Link from 'next/link';

const TIER_COLORS = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const PRESTIGE = ['snap', 'google', 'meta', 'apple', 'amazon', 'microsoft', 'netflix', 'tesla', 'spotify', 'tiktok', 'coca-cola', 'nike', 'disney', 'palantir', 'stripe', 'coinbase', 'polymarket', 'pinterest', 'whatnot', 'blackrock', 'anduril'];

function calculatePriority(person, sectors) {
  let score = parseFloat(person.power_score) || 0;
  const hl = (person.headline || '').toLowerCase();
  PRESTIGE.forEach(c => { if (hl.includes(c)) score += 1; });
  (sectors || []).forEach(s => { if (hl.includes(s.toLowerCase())) score += 0.5; });
  if (person.tier === 'S') score *= 1.5;
  else if (person.tier === 'A') score *= 1.2;
  return score;
}

export default function QueuePage() {
  return <OnboardingGate><QueueInner /></OnboardingGate>;
}

function QueueInner() {
  const { userId, userProfile: ctxProfile } = useUser();
  const sectors = ctxProfile?.sectors || [];
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [sentIds, setSentIds] = useState(new Set());
  const [pendingList, setPendingList] = useState([]);
  const [view, setView] = useState('recs'); // recs | pending
  const [bridgeFilter, setBridgeFilter] = useState(null);

  // Default to bridge view — shows D1 person → their D2 people
  const [groupBy, setGroupBy] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('groupBy')) return params.get('groupBy');
    }
    return 'bridge';
  });

  // Set bridge filter from URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const b = params.get('bridge');
      if (b) setBridgeFilter(b);
    }
  }, []);

  useEffect(() => {
    if (IS_DEMO) return;
    if (!userId) return;
    async function load() {
      const [net, pendingRes] = await Promise.all([
        loadNetwork(userId),
        fetch(`/api/outreach?userId=${userId}`).then(r => r.json()).catch(() => ({ pending: [] })),
      ]);
      const d1 = net.degree1;
      const d2 = net.degree2;
      const d1Urls = new Set(d1.map(c => c.profile_url));
      const bridgeById = {};
      d1.forEach(c => { bridgeById[c.id] = c; });

      // Pre-load sent IDs
      const sentSet = new Set((pendingRes.pending || []).map(p => p.id));
      setSentIds(sentSet);
      setPendingList((pendingRes.pending || []).map(p => ({
        ...p,
        bridge: bridgeById[p.source_connection_id] || null,
      })));

      const recommendations = d2
        .filter(c => (c.tier === 'S' || c.tier === 'A' || c.tier === 'B') && !d1Urls.has(c.profile_url))
        .map(c => {
          const bridge = bridgeById[c.source_connection_id];
          const priority = calculatePriority(c, sectors);
          const xp = c.tier === 'S' ? 50 : c.tier === 'A' ? 25 : 10;
          return { ...c, bridge, priority, xp };
        })
        .sort((a, b) => b.priority - a.priority);

      setRecs(recommendations);
      setLoading(false);
    }
    load();
  }, [userId]);

  // Demo builds: this page is excluded from the public demo
  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a1a', color: 'rgba(255,255,255,0.7)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        textAlign: 'center', padding: 24,
      }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>Not part of the demo</h2>
        <div style={{ fontSize: 13 }}>The public demo includes the Network Circle and Bridges views only.</div>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  let filtered = filter === 'all' ? recs : recs.filter(r => r.tier === filter);
  if (bridgeFilter) filtered = filtered.filter(r => r.bridge?.id === bridgeFilter);
  const tierCounts = { S: 0, A: 0, B: 0 };
  recs.forEach(r => { if (tierCounts[r.tier] !== undefined) tierCounts[r.tier]++; });

  // Group by tier, company, or bridge
  const grouped = {};
  filtered.forEach(r => {
    let key;
    if (groupBy === 'bridge') {
      key = r.bridge?.id || 'unknown';
    } else if (groupBy === 'company') {
      key = (r.company || 'Unknown').trim() || 'Unknown';
    } else {
      key = r.tier;
    }
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  // Sort groups
  const tierOrder = { S: 0, A: 1, B: 2 };
  const sortedGroups = Object.entries(grouped).sort((a, b) => {
    if (groupBy === 'tier') return (tierOrder[a[0]] || 9) - (tierOrder[b[0]] || 9);
    if (groupBy === 'bridge') {
      // Sort by bridge tier then cluster value
      const aB = a[1][0]?.bridge;
      const bB = b[1][0]?.bridge;
      const aTier = tierOrder[aB?.tier] ?? 9;
      const bTier = tierOrder[bB?.tier] ?? 9;
      if (aTier !== bTier) return aTier - bTier;
      return b[1].length - a[1].length;
    }
    return b[1].length - a[1].length;
  });

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.id)));
  }

  function openSelected() {
    const toOpen = filtered.filter(r => selected.has(r.id));
    if (toOpen.length === 0) return;
    if (toOpen.length === 1) {
      window.open(toOpen[0].profile_url, '_blank');
      return;
    }
    // Open a launcher page with all links as clickable buttons
    const html = `<!DOCTYPE html><html><head><title>Outlink — ${toOpen.length} profiles</title>
    <style>body{background:#0a0a1a;color:#fff;font-family:-apple-system,sans-serif;padding:24px;margin:0}
    h2{color:#FFD700;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:16px}
    .btn{display:block;padding:12px 16px;margin-bottom:6px;background:rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;text-decoration:none;
    font-size:13px;transition:background 0.15s}.btn:hover{background:rgba(0,119,181,0.2)}
    .name{font-weight:700}.tier{font-size:11px;margin-left:8px;font-weight:600}
    .open-all{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#FFD700,#FF6B35);
    color:#000;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;border:none;margin-bottom:20px}</style></head>
    <body><h2>Open ${toOpen.length} Profiles</h2>
    <p>Click each link or use the button below to open all at once.</p>
    <button class="open-all" onclick="document.querySelectorAll('.btn').forEach((a,i)=>setTimeout(()=>a.click(),i*300))">
    Open All (${toOpen.length})</button>
    ${toOpen.map(r => {
      const tierColor = r.tier === 'S' ? '#FFD700' : r.tier === 'A' ? '#9B59B6' : '#3498DB';
      return '<a class="btn" href="' + r.profile_url + '" target="_blank"><span class="name">' +
        (r.name || '') + '</span><span class="tier" style="color:' + tierColor + '">' + r.tier +
        ' · ' + parseFloat(r.power_score || 0).toFixed(1) + '</span><br><span style="color:#666;font-size:11px">' +
        (r.headline || '').substring(0, 60) + '</span></a>';
    }).join('')}
    </body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>Loading...</div>;
  }

  return (
    <div style={{
      height: '100vh', background: '#0a0a1a', color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{ padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <Link href="/" style={{
            display: 'flex', alignItems: 'center', gap: 6, color: '#888', textDecoration: 'none',
            fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          }}><span style={{ fontSize: 16 }}>&larr;</span> Map</Link>
          <h1 style={{
            fontSize: 20, fontWeight: 700, margin: 0,
            background: 'linear-gradient(135deg, #FF6B35, #FFD700)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Outlink</h1>
          {/* View toggle: Recommendations vs Pending */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: 2 }}>
            <button onClick={() => setView('recs')} style={{
              padding: '5px 12px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: view === 'recs' ? '#fff' : 'transparent', color: view === 'recs' ? '#000' : '#888',
            }}>To Add ({recs.length})</button>
            <button onClick={() => setView('pending')} style={{
              padding: '5px 12px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: view === 'pending' ? 'linear-gradient(135deg, #FF6B35, #FFD700)' : 'transparent',
              color: view === 'pending' ? '#000' : '#FF6B35',
            }}>Pending ({pendingList.length})</button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {view === 'recs' && (<>
              <button onClick={() => setGroupBy('tier')} style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: groupBy === 'tier' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', color: groupBy === 'tier' ? '#fff' : '#666',
              }}>By Tier</button>
              <button onClick={() => setGroupBy('bridge')} style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: groupBy === 'bridge' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', color: groupBy === 'bridge' ? '#fff' : '#666',
              }}>By Bridge</button>
              <button onClick={() => setGroupBy('company')} style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: groupBy === 'company' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)', color: groupBy === 'company' ? '#fff' : '#666',
              }}>By Company</button>
            </>)}
          </div>
        </div>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { k: 'all', l: `All (${recs.length})` },
            { k: 'S', l: `S (${tierCounts.S})`, c: TIER_COLORS.S },
            { k: 'A', l: `A (${tierCounts.A})`, c: TIER_COLORS.A },
            { k: 'B', l: `B (${tierCounts.B})`, c: TIER_COLORS.B },
          ].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)} style={{
              padding: '4px 12px', borderRadius: 16, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: filter === f.k ? (f.c || '#fff') : 'rgba(255,255,255,0.06)',
              color: filter === f.k ? '#000' : (f.c || '#888'),
            }}>{f.l}</button>
          ))}
        </div>
      </header>

      {/* Batch action bar — recs view only */}
      {view === 'recs' && selected.size > 0 && (
        <div style={{
          padding: '10px 24px', background: 'rgba(255,215,0,0.08)',
          borderBottom: '1px solid rgba(255,215,0,0.2)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#FFD700', fontWeight: 600 }}>{selected.size} selected</span>
          <button onClick={openSelected} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#0077B5', color: '#fff', fontWeight: 700, fontSize: 12,
          }}>
            Open {selected.size} on LinkedIn
          </button>
          <span style={{ fontSize: 10, color: '#888' }}>+{filtered.filter(r => selected.has(r.id)).reduce((s, r) => s + r.xp, 0)} XP potential</span>
          <button onClick={() => setSelected(new Set())} style={{
            marginLeft: 'auto', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11,
          }}>Clear</button>
        </div>
      )}

      {/* Scrollable list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>

          {/* === PENDING VIEW === */}
          {view === 'pending' && (
            <>
              {pendingList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>No pending requests</div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>Click &quot;Add&quot; on someone to track your outreach</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 12 }}>
                    Waiting for response. When they accept, their cluster unlocks for bridging.
                  </div>
                  {pendingList.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 4,
                      background: 'rgba(255,107,53,0.04)', borderRadius: 8,
                      border: '1px solid rgba(255,107,53,0.1)',
                    }}>
                      {/* Photo */}
                      {p.profile_image_url ? (
                        <img src={p.profile_image_url} alt="" style={{
                          width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                          border: `2px solid ${TIER_COLORS[p.tier] || '#555'}`,
                        }} onError={e => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', flexShrink: 0, fontSize: 14, fontWeight: 700,
                          background: TIER_COLORS[p.tier] || '#555', color: p.tier === 'S' ? '#000' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{p.name?.charAt(0)}</div>
                      )}

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.headline?.substring(0, 55)}
                        </div>
                        {p.bridge && (
                          <div style={{ fontSize: 9, color: '#FF6B35', marginTop: 2 }}>
                            via {p.bridge.name?.split(' ')[0]} &middot; unlocks bridge cluster
                          </div>
                        )}
                      </div>

                      {/* Tier + status */}
                      <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 800, color: TIER_COLORS[p.tier],
                          padding: '2px 8px', borderRadius: 4,
                          background: `${TIER_COLORS[p.tier] || '#555'}15`,
                        }}>{p.tier}</div>
                        <div style={{ fontSize: 8, color: '#FF6B35', marginTop: 2, fontWeight: 600 }}>PENDING</div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <a href={p.profile_url} target="_blank" rel="noopener noreferrer"
                          style={{ padding: '4px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: '#0077B5', color: '#fff', textDecoration: 'none' }}>
                          View
                        </a>
                        <button onClick={async () => {
                          await fetch('/api/outreach', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'undo', connectionId: p.id }),
                          });
                          setPendingList(prev => prev.filter(x => x.id !== p.id));
                          setSentIds(prev => { const next = new Set(prev); next.delete(p.id); return next; });
                        }} style={{
                          padding: '4px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                          background: 'rgba(255,255,255,0.06)', color: '#666', border: 'none', cursor: 'pointer',
                        }}>Undo</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* === RECOMMENDATIONS VIEW === */}
          {view === 'recs' && (<>
          {/* Select all */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll} style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: 10, color: '#666' }}>Select all ({filtered.length})</span>
          </div>

          {sortedGroups.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 16 }}>
              {/* Group header */}
              {groupBy === 'bridge' ? (() => {
                const bridge = items[0]?.bridge;
                if (!bridge) return null;
                const sCount = items.filter(r => r.tier === 'S').length;
                const aCount = items.filter(r => r.tier === 'A').length;
                const bCount = items.filter(r => r.tier === 'B').length;
                const clusterPower = sCount * 3 + aCount * 2 + bCount;
                const maxPower = 30;
                return (
                  <div style={{
                    padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                    background: `${TIER_COLORS[bridge.tier] || '#555'}08`,
                    border: `1px solid ${TIER_COLORS[bridge.tier] || '#555'}20`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {bridge.profile_image_url ? (
                        <img src={bridge.profile_image_url} alt="" style={{
                          width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
                          border: `2px solid ${TIER_COLORS[bridge.tier]}`,
                        }} onError={e => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', fontSize: 14, fontWeight: 700,
                          background: TIER_COLORS[bridge.tier], color: bridge.tier === 'S' ? '#000' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{bridge.name?.charAt(0)}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{bridge.name}</div>
                        <div style={{ fontSize: 9, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bridge.headline?.substring(0, 50)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: TIER_COLORS[bridge.tier] }}>{bridge.tier}</div>
                        <div style={{ fontSize: 8, color: '#666' }}>{items.length} to add</div>
                      </div>
                    </div>
                    {/* Cluster power pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 4, fontSize: 9 }}>
                        {sCount > 0 && <span style={{ color: '#FFD700', fontWeight: 700 }}>{sCount}S</span>}
                        {aCount > 0 && <span style={{ color: '#9B59B6', fontWeight: 700 }}>{aCount}A</span>}
                        {bCount > 0 && <span style={{ color: '#3498DB', fontWeight: 700 }}>{bCount}B</span>}
                      </div>
                      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${Math.min(100, (clusterPower / maxPower) * 100)}%`,
                          background: `linear-gradient(90deg, ${TIER_COLORS[bridge.tier]}, #FF6B35)`,
                        }} />
                      </div>
                      <button onClick={() => {
                        const urls = items.map(r => r.profile_url);
                        if (urls.length === 1) { window.open(urls[0], '_blank'); return; }
                        const bh = `<!DOCTYPE html><html><head><title>Top ${Math.min(10,urls.length)}</title>
                        <style>body{background:#0a0a1a;color:#fff;font-family:-apple-system,sans-serif;padding:24px}
                        .btn{display:block;padding:10px 14px;margin-bottom:4px;background:rgba(255,255,255,0.06);
                        border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;text-decoration:none;font-size:12px}
                        .btn:hover{background:rgba(0,119,181,0.2)}
                        .oa{display:inline-block;padding:10px 20px;background:#0077B5;color:#fff;border-radius:6px;
                        font-weight:700;font-size:13px;cursor:pointer;border:none;margin-bottom:16px}</style></head>
                        <body><h3 style="color:#FF6B35">Top ${Math.min(10,urls.length)} to connect</h3>
                        <button class="oa" onclick="document.querySelectorAll('.btn').forEach((a,i)=>setTimeout(()=>a.click(),i*300))">
                        Open All</button>${urls.slice(0,10).map(u => '<a class="btn" href="' + u + '" target="_blank">' + u.split('/in/')[1]?.replace('/','') + '</a>').join('')}</body></html>`;
                        window.open(URL.createObjectURL(new Blob([bh], {type:'text/html'})), '_blank');
                      }} style={{
                        padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: '#0077B5', color: '#fff', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
                      }}>Open Top {Math.min(10, items.length)}</button>
                    </div>
                  </div>
                );
              })() : (
                <div style={{
                  padding: '6px 10px', marginBottom: 4,
                  background: groupBy === 'tier' ? `${TIER_COLORS[group] || '#555'}15` : 'rgba(255,255,255,0.04)',
                  borderLeft: `3px solid ${groupBy === 'tier' ? (TIER_COLORS[group] || '#555') : '#FF6B35'}`,
                  borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: groupBy === 'tier' ? (TIER_COLORS[group] || '#888') : '#FF6B35' }}>
                    {groupBy === 'tier' ? `${group}-Tier` : group}
                  </span>
                  <span style={{ fontSize: 10, color: '#666' }}>{items.length}</span>
                </div>
              )}

              {/* Items — sub-grouped by tier when in bridge mode */}
              {groupBy === 'bridge' ? ['S', 'A', 'B'].map(tier => {
                const tierItems = items.filter(r => r.tier === tier);
                if (tierItems.length === 0) return null;
                return (
                  <div key={tier} style={{ marginBottom: 6 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', marginBottom: 2,
                      borderLeft: `2px solid ${TIER_COLORS[tier]}`,
                    }}>
                      <input type="checkbox"
                        checked={tierItems.every(r => selected.has(r.id))}
                        onChange={() => {
                          const allSelected = tierItems.every(r => selected.has(r.id));
                          setSelected(prev => {
                            const next = new Set(prev);
                            tierItems.forEach(r => { allSelected ? next.delete(r.id) : next.add(r.id); });
                            return next;
                          });
                        }}
                        style={{ cursor: 'pointer', flexShrink: 0 }} />
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: TIER_COLORS[tier] }} />
                      <span style={{ fontSize: 9, fontWeight: 700, color: TIER_COLORS[tier] }}>{tier}-Tier</span>
                      <span style={{ fontSize: 8, color: '#555' }}>{tierItems.length}</span>
                      <button onClick={() => {
                        if (tierItems.length === 1) { window.open(tierItems[0].profile_url, '_blank'); return; }
                        const h2 = `<!DOCTYPE html><html><head><title>${tier}-Tier — ${tierItems.length}</title>
                        <style>body{background:#0a0a1a;color:#fff;font-family:-apple-system,sans-serif;padding:24px}
                        .btn{display:block;padding:10px 14px;margin-bottom:4px;background:rgba(255,255,255,0.06);
                        border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;text-decoration:none;font-size:12px}
                        .btn:hover{background:rgba(0,119,181,0.2)}
                        .oa{display:inline-block;padding:10px 20px;background:#0077B5;color:#fff;border-radius:6px;
                        font-weight:700;font-size:13px;cursor:pointer;border:none;margin-bottom:16px}</style></head>
                        <body><h3 style="color:${TIER_COLORS[tier]}">${tier}-Tier (${tierItems.length})</h3>
                        <button class="oa" onclick="document.querySelectorAll('.btn').forEach((a,i)=>setTimeout(()=>a.click(),i*300))">
                        Open All</button>${tierItems.map(r => '<a class="btn" href="' + r.profile_url + '" target="_blank">' + r.name + ' · ' + parseFloat(r.power_score||0).toFixed(1) + '</a>').join('')}</body></html>`;
                        window.open(URL.createObjectURL(new Blob([h2], {type:'text/html'})), '_blank');
                      }} style={{
                        marginLeft: 'auto', padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                        background: '#0077B5', color: '#fff', fontSize: 8, fontWeight: 700,
                      }}>Open All {tier}</button>
                    </div>
                    {tierItems.map(r => (
                      <div key={r.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 5px 16px',
                        borderBottom: '1px solid rgba(255,255,255,0.02)',
                        background: selected.has(r.id) ? 'rgba(255,215,0,0.05)' : 'transparent',
                        cursor: 'pointer',
                      }}
                        onMouseEnter={e => { if (!selected.has(r.id)) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseLeave={e => { if (!selected.has(r.id)) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <input type="checkbox" checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)} onClick={e => e.stopPropagation()}
                          style={{ cursor: 'pointer', flexShrink: 0 }} />
                        {r.profile_image_url ? (
                          <img src={r.profile_image_url} alt="" style={{
                            width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                            border: `1.5px solid ${TIER_COLORS[r.tier] || '#555'}`,
                          }} onError={e => { e.target.style.display = 'none'; }} />
                        ) : (
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0, fontSize: 10, fontWeight: 700,
                            background: TIER_COLORS[r.tier] || '#555', color: r.tier === 'S' ? '#000' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{r.name?.charAt(0)}</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }} onClick={() => toggleSelect(r.id)}>
                          <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                          <div style={{ fontSize: 8, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.headline?.substring(0, 45)}</div>
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: TIER_COLORS[r.tier], flexShrink: 0 }}>{parseFloat(r.power_score || 0).toFixed(1)}</span>
                        {sentIds.has(r.id) ? (
                          <span style={{ padding: '3px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: 'rgba(255,107,53,0.15)', color: '#FF6B35', flexShrink: 0 }}>Sent</span>
                        ) : (
                          <a href={r.profile_url} target="_blank" rel="noopener noreferrer"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await fetch('/api/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'mark-sent', connectionId: r.id, profileUrl: r.profile_url }) });
                                setSentIds(prev => new Set([...prev, r.id]));
                              } catch {}
                            }}
                            style={{ padding: '3px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: '#0077B5', color: '#fff', textDecoration: 'none', flexShrink: 0 }}>Add</a>
                        )}
                      </div>
                    ))}
                  </div>
                );
              }) : items.map(r => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: selected.has(r.id) ? 'rgba(255,215,0,0.05)' : 'transparent',
                  cursor: 'pointer',
                }}
                  onMouseEnter={e => { if (!selected.has(r.id)) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!selected.has(r.id)) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Checkbox */}
                  <input type="checkbox" checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)} onClick={e => e.stopPropagation()}
                    style={{ cursor: 'pointer', flexShrink: 0 }} />

                  {/* Photo */}
                  {r.profile_image_url ? (
                    <img src={r.profile_image_url} alt="" style={{
                      width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                      border: `1.5px solid ${TIER_COLORS[r.tier] || '#555'}`,
                    }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                  ) : null}
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0, fontSize: 12, fontWeight: 700,
                    background: TIER_COLORS[r.tier] || '#555', color: r.tier === 'S' ? '#000' : '#fff',
                    display: r.profile_image_url ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{r.name?.charAt(0)}</div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }} onClick={() => toggleSelect(r.id)}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </div>
                    <div style={{ fontSize: 9, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.headline?.substring(0, 50)}
                    </div>
                  </div>

                  {/* Bridge via */}
                  {r.bridge && (
                    <span style={{ fontSize: 8, color: '#555', flexShrink: 0, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      via {r.bridge.name?.split(' ')[0]}
                    </span>
                  )}

                  {/* Score + tier */}
                  <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 32 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: TIER_COLORS[r.tier] }}>
                      {parseFloat(r.power_score).toFixed(1)}
                    </div>
                  </div>

                  {/* Quick add + mark sent */}
                  {sentIds.has(r.id) ? (
                    <span style={{
                      padding: '4px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                      background: 'rgba(255,107,53,0.15)', color: '#FF6B35', flexShrink: 0,
                    }}>⏳ Sent</span>
                  ) : (
                    <a href={r.profile_url} target="_blank" rel="noopener noreferrer"
                      onClick={async (e) => {
                        e.stopPropagation();
                        // Mark as sent in DB after opening LinkedIn
                        try {
                          await fetch('/api/outreach', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'mark-sent', connectionId: r.id, profileUrl: r.profile_url }),
                          });
                          setSentIds(prev => new Set([...prev, r.id]));
                        } catch {}
                      }}
                      style={{
                        padding: '4px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                        background: '#0077B5', color: '#fff', textDecoration: 'none', flexShrink: 0,
                      }}>
                      Add
                    </a>
                  )}
                </div>
              ))}
            </div>
          ))}
          </>)}
        </div>
      </div>
    </div>
  );
}
