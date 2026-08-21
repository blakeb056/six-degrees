'use client';

import { useEffect, useState, useRef } from 'react';
import { loadNetwork } from '../lib/network';
import ForceGraph from './components/ForceGraph';
import GridView from './components/GridView';
import ListView from './components/ListView';
import RingsView from './components/RingsView';
import ChainView from './components/ChainView';
import Sidebar from './components/Sidebar';
import FilterPanel from './components/FilterPanel';
import OnboardingGate from './components/OnboardingGate';
import { useUser } from './components/UserProvider';
import { IS_DEMO, loadDemoNetwork } from '../lib/demo';
import { hasCsvNetwork, loadCsvNetwork, clearCsvNetwork } from '../lib/csv';
import Link from 'next/link';

const TIER_COLORS = {
  S: '#FFD700',
  A: '#9B59B6',
  B: '#3498DB',
  C: '#95A5A6',
  D: '#BDC3C7',
};

export default function Home() {
  return (
    <OnboardingGate>
      <HomeInner />
    </OnboardingGate>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function HomeInner() {
  const { userId, userName } = useUser();
  const isMobile = useIsMobile();
  const [degree1, setDegree1] = useState([]);
  const [degree2, setDegree2] = useState([]);
  const [selected, setSelected] = useState(null);
  const focusNodeRef = useRef(null);
  const [filter, setFilter] = useState('all');
  const [mode, setMode] = useState('network');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [filterPanelCollapsed, setFilterPanelCollapsed] = useState(true);
  const [visualMode, setVisualMode] = useState('galaxy');
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [pending, setPending] = useState([]);
  const [csvMode, setCsvMode] = useState(false);

  useEffect(() => {
    if (!userId) return;
    async function load() {
      // Demo mode: hydrate from the bundled static snapshot, no Supabase.
      // Three possible sources: the bundled demo snapshot, a CSV the visitor
      // imported in this tab (1st-degree only, never persisted), or Supabase.
      const csv = hasCsvNetwork() ? loadCsvNetwork() : null;
      if (csv) setCsvMode(true);
      const { degree1: d1, degree2: d2 } = IS_DEMO
        ? await loadDemoNetwork()
        : csv
        ? csv
        : await (async () => {
            return await loadNetwork(userId);
          })();

      setDegree1(d1);
      setDegree2(d2);

      const tierCounts = {};
      d1.forEach(c => { tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1; });
      const d2TierCounts = {};
      d2.forEach(c => { d2TierCounts[c.tier] = (d2TierCounts[c.tier] || 0) + 1; });
      setStats({ total: d1.length, tiers: tierCounts, d2Total: d2.length, d2Tiers: d2TierCounts });
      setLoading(false);
    }
    load();
    if (!IS_DEMO && !hasCsvNetwork()) {
      // Fetch notifications
      fetch(`/api/notifications?userId=${userId}`).then(r => r.json()).then(d => setNotifications(d.notifications || [])).catch(() => {});
      // Fetch pending outreach
      fetch(`/api/outreach?userId=${userId}`).then(r => r.json()).then(d => setPending(d.pending || [])).catch(() => {});
    }
  }, [userId]);

  const isDegreesMode = mode === 'degrees';
  const connections = degree1;
  const filtered = filter === 'all' ? connections : connections.filter(c => c.tier === filter);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Loading 6 Degrees of Separation...</div>
        <div style={{ fontSize: 14, color: '#888', marginTop: 8 }}>Mapping your LinkedIn network</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <header style={{ padding: isMobile ? '10px 12px' : '20px 30px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 4 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 6 : 0 }}>
          <h1 style={{ fontSize: isMobile ? 16 : 28, fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            6 Degrees
          </h1>
          <div style={{ display: 'flex', gap: isMobile ? 2 : 4, background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: isMobile ? 2 : 3, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <button
              onClick={() => { setMode('network'); setSelected(null); setFilter('all'); setVisualMode('galaxy'); }}
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600, cursor: 'pointer',
                background: mode === 'network' ? '#fff' : 'transparent',
                color: mode === 'network' ? '#000' : '#888',
              }}
            >
              {isMobile ? 'Circle' : 'Network Circle'}
            </button>
            <button
              onClick={() => { setMode('degrees'); setSelected(null); setFilter('all'); setVisualMode('chain'); }}
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600, cursor: 'pointer',
                background: mode === 'degrees' ? 'linear-gradient(135deg, #FFD700, #FF6B35)' : 'rgba(255,255,255,0.12)',
                color: mode === 'degrees' ? '#000' : '#fff',
              }}
            >
              Bridges
            </button>
            {!IS_DEMO && <Link
              href="/paths"
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#00ff88', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Paths
            </Link>}
            {!IS_DEMO && !csvMode && <Link
              href="/queue"
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#FF6B35', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Outlink
            </Link>}
            {!IS_DEMO && !csvMode && !isMobile && <Link
              href="/setup"
              style={{
                padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#666', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Setup
            </Link>}
          </div>
          {/* Notification bell */}
          {!IS_DEMO && !csvMode && <div style={{ position: 'relative', marginLeft: isMobile ? 4 : 8 }}>
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              style={{
                width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', color: '#888', fontSize: isMobile ? 12 : 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
              }}
            >
              🔔
              {notifications.filter(n => !n.seen).length > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: '50%',
                  background: '#ff5050', color: '#fff', fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {notifications.filter(n => !n.seen).length}
                </span>
              )}
            </button>
            {showNotifs && (
              <div style={{
                position: 'absolute', top: 40, right: 0, width: 320, maxHeight: 400,
                background: 'rgba(10,10,26,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, overflow: 'hidden', zIndex: 100,
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
                  {notifications.filter(n => !n.seen).length > 0 && (
                    <button onClick={() => {
                      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-all-seen' }) });
                      setNotifications(prev => prev.map(n => ({ ...n, seen: true })));
                    }} style={{ background: 'none', border: 'none', color: '#3498DB', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 12 }}>No notifications yet</div>
                  ) : notifications.slice(0, 20).map(n => (
                    <div key={n.id} style={{
                      padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: n.seen ? 'transparent' : 'rgba(255,215,0,0.04)',
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 16 }}>{n.icon || '📌'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: n.seen ? '#888' : '#fff' }}>{n.title}</div>
                          {n.message && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{n.message}</div>}
                          <div style={{ fontSize: 9, color: '#444', marginTop: 3 }}>{new Date(n.created_at).toLocaleDateString()}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>}
          {/* Refresh button — checks connections + notifies */}
          {!IS_DEMO && !csvMode && <button
            onClick={async () => {
              try {
                const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
                if (!(await ping.json()).ok) throw new Error();
                await fetch('http://localhost:5555/scrape', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'connections', userId }),
                });
                alert('Refreshing connections + checking for new bridges...');
              } catch {
                alert('Scraper offline — double-click "Start Scraper" on your Desktop.');
              }
            }}
            title="Refresh connections + bridges"
            style={{
              width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', color: '#888', fontSize: isMobile ? 12 : 14,
              display: isMobile ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 8,
            }}
          >
            ↻
          </button>}
          {/* Profile icon — top right */}
          <a href={IS_DEMO ? '/launch' : csvMode ? '/import' : '/profile'} style={{
            width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000', fontWeight: 800, fontSize: isMobile ? 11 : 14,
            textDecoration: 'none', marginLeft: isMobile ? 6 : 12, flexShrink: 0,
          }}>
            {(() => {
              const sCount = degree1.filter(c => c.tier === 'S').length;
              const aCount = degree1.filter(c => c.tier === 'A').length;
              const bCount = degree1.filter(c => c.tier === 'B').length;
              const clusters = degree1.filter(c => degree2.some(d => d.source_connection_id === c.id)).length;
              const d2S = degree2.filter(c => c.tier === 'S').length;
              const np = (sCount*100)+(aCount*40)+(bCount*15)+(clusters*200)+(d2S*50)+degree1.length;
              return Math.floor(Math.sqrt(np / 10));
            })()}
          </a>
        </div>

        {/* Pending count badge — in header */}
        {isDegreesMode && pending.length > 0 && (
          <Link href="/queue" style={{
            padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, textDecoration: 'none',
            background: 'rgba(255,107,53,0.12)', color: '#FF6B35',
            border: '1px solid rgba(255,107,53,0.25)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 10 }}>⏳</span>
            {pending.length} Pending
          </Link>
        )}
      </header>

      <div style={{ display: 'flex', height: isMobile ? 'calc(100vh - 70px)' : 'calc(100vh - 130px)', position: 'relative' }}>
        <FilterPanel
          collapsed={filterPanelCollapsed}
          onToggle={() => setFilterPanelCollapsed(!filterPanelCollapsed)}
          mode={mode}
          filter={filter}
          onFilterChange={setFilter}
          visualMode={visualMode}
          onVisualModeChange={setVisualMode}
          tierCounts={stats?.tiers || {}}
          bridgeTierCounts={(() => {
            const counts = {};
            degree1.filter(c => degree2.some(d => d.source_connection_id === c.id))
              .forEach(c => { counts[c.tier] = (counts[c.tier] || 0) + 1; });
            return counts;
          })()}
        />
        {/* Visualization — switches based on visualMode */}
        {(() => {
          const filteredD2 = isDegreesMode ? (filter === 'all'
            ? degree2
            : degree2.filter(c => {
                const bridge = degree1.find(d1 => d1.id === c.source_connection_id);
                return bridge && bridge.tier === filter;
              })
          ) : [];
          const selectHandler = (node) => { setSelected(node); if (node) setSidebarCollapsed(false); };

          // Every Bridges surface is built from 2nd-degree rows. A CSV import
          // has none, so say why instead of rendering an empty canvas.
          if (isDegreesMode && degree2.length === 0) {
            return (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 24, textAlign: 'center',
              }}>
                <div style={{ maxWidth: 440 }}>
                  <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.5 }}>&#128279;</div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px', color: '#fff' }}>
                    Bridges need 2nd-degree data
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>
                    This view maps who <em>your connections</em>{' '}know &mdash; the people you haven&rsquo;t met yet.
                    LinkedIn&rsquo;s CSV export only covers your own 1st-degree list, so there are no circles to open here.
                  </p>
                  <p style={{ color: '#666', fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                    The local scraper maps those circles (and captures real photos).{' '}
                    <Link href="/setup" style={{ color: '#3498DB', textDecoration: 'none' }}>See setup &rarr;</Link>
                  </p>
                </div>
              </div>
            );
          }

          if (visualMode === 'chain' && isDegreesMode) {
            return <ChainView connections={filtered} degree2={filteredD2} onSelect={selectHandler} userName={userName} />;
          }
          if (visualMode === 'grid') {
            return <GridView connections={filtered} degree2={filteredD2} onSelect={selectHandler} mode={mode} />;
          }
          if (visualMode === 'list') {
            return <ListView connections={filtered} degree2={filteredD2} onSelect={selectHandler} mode={mode} />;
          }
          if (visualMode === 'rings') {
            return <RingsView connections={filtered} degree2={filteredD2} onSelect={selectHandler} mode={mode} />;
          }
          // Default: Galaxy (ForceGraph)
          return (
            <ForceGraph
              connections={filtered}
              degree2={filteredD2}
              onSelect={selectHandler}
              tierColors={TIER_COLORS}
              mode={mode}
              focusNodeRef={focusNodeRef}
              userName={userName}
            />
          );
        })()}
        <Sidebar
          selected={selected}
          stats={stats}
          tierColors={TIER_COLORS}
          connections={degree1}
          degree2={degree2}
          mode={mode}
          collapsed={sidebarCollapsed}
          filter={filter}
          pending={pending}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSelect={(node) => { setSelected(node || null); }}
          onSwitchMode={(newMode) => { setMode(newMode); setFilter('all'); }}
          onFocusNode={(nodeId) => { if (focusNodeRef.current) focusNodeRef.current(nodeId); }}
          onMarkSent={async (person) => {
            if (IS_DEMO) return;
            const id = person.id;
            const url = person.profile_url;
            await fetch('/api/outreach', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'mark-sent', connectionId: id, profileUrl: url }),
            });
            setPending(prev => [...prev, person]);
          }}
          onUndoPending={async (person) => {
            if (IS_DEMO) return;
            const id = person.id;
            await fetch('/api/outreach', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'undo', connectionId: id }),
            });
            setPending(prev => prev.filter(p => p.id !== id));
          }}
        />

        {/* Galaxy experimental toggle — bottom right, Bridges mode only */}
        {isDegreesMode && (
          <div style={{
            position: 'absolute', bottom: 20, right: 20, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '6px 14px',
            backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ fontSize: 10, color: '#666' }}>🧪 Galaxy</span>
            <div
              onClick={() => setVisualMode(visualMode === 'galaxy' ? 'chain' : 'galaxy')}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
                background: visualMode === 'galaxy' ? '#FF6B35' : 'rgba(255,255,255,0.15)',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 2,
                left: visualMode === 'galaxy' ? 16 : 2,
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
