'use client';

import { Suspense, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { scraperStatus, beginScrape, notReadyMessage, busyReason, isCircleScan, loadScanNotes, NO_SCAN_NOTES } from '../lib/scraper-client';
import useScanner from './components/useScanner';
import useRequests from './components/useRequests';
import { requestCount } from '../lib/requests-client';
import { loadNetwork } from '../lib/network';
import { VIEWS, resolveView } from './components/views';
import AutoScanButton from './components/AutoScanButton';
import { peopleByDegree, tierCountsOf } from '../lib/degrees';
import Sidebar from './components/Sidebar';
import FilterPanel from './components/FilterPanel';
import OnboardingGate from './components/OnboardingGate';
import EmptyState from './components/EmptyState';
import { useUser } from './components/UserProvider';
import { IS_DEMO, loadDemoNetwork } from '../lib/demo';
import { hasCsvNetwork, loadCsvNetwork, clearCsvNetwork } from '../lib/csv';
import Link from 'next/link';

// One shared empty list, so "no 2nd-degree data" is the same value every render.
const NO_DEGREE2 = [];

// A job that changes the network. Setting the scanner up and signing in don't.
const CHANGES_NETWORK = (job) => Boolean(job) && !['install', 'setup', 'login'].includes(job.action);

/** Counts for the header and panels, from the two lists. */
function statsFor(d1, d2) {
  const tierCounts = {};
  d1.forEach(c => { tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1; });
  const d2TierCounts = {};
  d2.forEach(c => { d2TierCounts[c.tier] = (d2TierCounts[c.tier] || 0) + 1; });
  return { total: d1.length, tiers: tierCounts, d2Total: d2.length, d2Tiers: d2TierCounts };
}

const TIER_COLORS = {
  S: '#FFD700',
  A: '#9B59B6',
  B: '#3498DB',
  C: '#95A5A6',
  D: '#BDC3C7',
};

export default function Home() {
  // Suspense because HomeInner reads the address's ?chain= (useSearchParams),
  // which Next requires to sit inside one for the page to build.
  return (
    <OnboardingGate>
      <Suspense>
        <HomeInner />
      </Suspense>
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
  // People found only by company scans: 3rd degree in Network Circle's filter.
  const [degree3, setDegree3] = useState([]);
  // Which degrees Network Circle draws: your connections alone until you pick more.
  const [degrees, setDegrees] = useState([1]);
  // Tiers switched off in Network Circle's Filter panel (C and D make a lot of noise).
  const [hiddenTiers, setHiddenTiers] = useState([]);
  const [selected, setSelected] = useState(null);
  const focusNodeRef = useRef(null);
  const [filter, setFilter] = useState('all');
  // A link to someone's circle in Bridge Chains, /?chain=<id> (the Scan page's
  // "watch it fill in"), opens Degrees on it. The router's search params rather
  // than window.location: on a click from another page the address bar only
  // changes after this page has rendered, and the map opened on the Galaxy.
  const linkedChain = useSearchParams().get('chain');
  const [chainOpen, setChainOpen] = useState(linkedChain);
  const [mode, setMode] = useState(() => (chainOpen ? 'degrees' : 'network'));
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [filterPanelCollapsed, setFilterPanelCollapsed] = useState(true);
  const [visualMode, setVisualMode] = useState(() => (chainOpen ? 'chain' : 'galaxy'));
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [csvMode, setCsvMode] = useState(false);
  const [csvSource, setCsvSource] = useState('csv');
  // What the scanner noted: hidden lists, and lists read with nothing new in
  // them. With the network, they say who is ready for a circle scan (lib/reach.js).
  const [scanNotes, setScanNotes] = useState(NO_SCAN_NOTES);
  const shapeRef = useRef('');
  // Everyone with a request out, shared with every view (lib/requests-client.js).
  const pendingCount = requestCount(useRequests());

  useEffect(() => {
    if (!userId) return;
    async function load() {
      // Demo mode: hydrate from the bundled static snapshot, no Supabase.
      // Three possible sources: the bundled demo snapshot, a CSV the visitor
      // imported in this tab (1st-degree only, never persisted), or Supabase.
      const csv = hasCsvNetwork() ? loadCsvNetwork() : null;
      if (csv) { setCsvMode(true); setCsvSource(csv.source || 'csv'); }
      const { degree1: d1, degree2: d2, degree3: d3 = [] } = IS_DEMO
        ? await loadDemoNetwork()
        : csv
        ? csv
        : await (async () => {
            return await loadNetwork(userId);
          })();

      setDegree1(d1);
      setDegree2(d2);
      setDegree3(d3 || []);
      shapeRef.current = networkShape(d1, d2);
      setStats(statsFor(d1, d2));
      setLoading(false);
    }
    load();
    if (!IS_DEMO && !hasCsvNetwork()) {
      loadScanNotes().then(setScanNotes);
      // Fetch notifications
      fetch(`/api/notifications?userId=${userId}`).then(r => r.json()).then(d => setNotifications(d.notifications || [])).catch(() => {});
    }
  }, [userId]);

  // The network again, after a scan: circles fill in while they're scanned
  // (Blake, 2026-09-28: "the d3 dots as it builds more in"). Only a real change
  // is published, because the graph views rebuild their scene whenever these
  // lists change identity (TRAPS §29).
  const reload = useCallback(async () => {
    if (IS_DEMO || hasCsvNetwork() || !userId) return;
    try {
      const [{ degree1: d1, degree2: d2, degree3: d3 = [] }, notes] = await Promise.all([loadNetwork(userId), loadScanNotes()]);
      setScanNotes((prev) => (JSON.stringify(prev) === JSON.stringify(notes) ? prev : notes));
      setDegree3((prev) => (prev.length === (d3 || []).length ? prev : d3 || []));
      const shape = networkShape(d1, d2);
      if (shape === shapeRef.current) return;
      shapeRef.current = shape;
      setDegree1(d1);
      setDegree2(d2);
      setStats(statsFor(d1, d2));
    } catch { /* the app restarting, say: keep what's on screen */ }
  }, [userId]);

  // Followed once: Bridge Chains has opened it, so leaving that view and coming
  // back, or reloading, starts from the overview.
  // A card's Insights → Separation, filtered to that person's circle ("Show them", "S only").
  const [separationPreset, setSeparationPreset] = useState(null);
  const showInSeparation = useCallback((preset) => {
    setSeparationPreset({ ...preset, id: `${preset.query}|${preset.tier || ''}|${preset.rarity || ''}|${Math.random()}` });
    setMode('degrees');
    setVisualMode('separation');
  }, []);
  // A card's Insights → that person's circle in Bridge Chains.
  const openCircle = useCallback((id) => {
    setChainOpen(id);
    setMode('degrees');
    setVisualMode('chain');
  }, []);
  const chainOpened = useCallback(() => {
    setChainOpen(null);
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* the link stays */ }
  }, []);

  const isDegreesMode = mode === 'degrees';
  const connections = degree1;

  // What the views draw. Memoised because the graph views rebuild their whole
  // scene when these change identity: computed inline, every re-render — a click,
  // the sidebar opening, notifications arriving — reset the galaxy's layout. The
  // empty list in network mode was a new [] each time, which was enough on its own.
  // Network Circle draws the degrees picked in the Filter panel, each person
  // once, at the nearest degree they're found (lib/degrees.js).
  const byDegree = useMemo(() => peopleByDegree(degree1, degree2, degree3), [degree1, degree2, degree3]);
  const networkRows = useMemo(
    () => (isDegreesMode ? connections : degrees.flatMap((d) => byDegree[d] || [])),
    [isDegreesMode, connections, degrees, byDegree],
  );
  const filtered = useMemo(() => {
    if (!isDegreesMode) return hiddenTiers.length ? networkRows.filter(c => !hiddenTiers.includes(c.tier)) : networkRows;
    return filter === 'all' ? networkRows : networkRows.filter(c => c.tier === filter);
  }, [isDegreesMode, networkRows, filter, hiddenTiers]);
  // Lookups built once per load. Every click re-renders this component, and the
  // three places below used to scan one list inside another — degree1.find per
  // 2nd-degree row, degree2.some per connection — about 16M comparisons, twice
  // a click, at 20k rows.
  const d1ById = useMemo(() => new Map(degree1.map(c => [c.id, c])), [degree1]);
  const bridgeIds = useMemo(
    () => new Set(degree2.map(d => d.source_connection_id).filter(Boolean)),
    [degree2],
  );
  const bridgeTierCounts = useMemo(() => {
    const counts = {};
    degree1.forEach(c => { if (bridgeIds.has(c.id)) counts[c.tier] = (counts[c.tier] || 0) + 1; });
    return counts;
  }, [degree1, bridgeIds]);
  const filteredD2 = useMemo(() => {
    if (!isDegreesMode) return NO_DEGREE2;
    if (filter === 'all') return degree2;
    return degree2.filter(c => d1ById.get(c.source_connection_id)?.tier === filter);
  }, [isDegreesMode, filter, d1ById, degree2]);
  const selectHandler = useCallback((node) => {
    setSelected(node);
    if (node) setSidebarCollapsed(false);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Loading Six Degrees…</div>
        <div style={{ fontSize: 14, color: '#888', marginTop: 8 }}>Mapping your LinkedIn network</div>
      </div>
    );
  }

  // Resolved once, because two places care: the renderer below, and the Orbit
  // toggle, which hides over Separation.
  const view = resolveView(visualMode, mode);
  // Scanning and the Scan page belong to your own network, not the sample or a CSV.
  const canScan = !IS_DEMO && !csvMode;

  return (
    <div data-map style={{ height: '100vh', overflow: 'hidden', background: '#0a0a1a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <header style={{ padding: isMobile ? '10px 12px' : '20px 30px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 4 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 6 : 0 }}>
          <h1 style={{ fontSize: isMobile ? 16 : 28, fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Six Degrees
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
              Degrees
            </button>

            {/* Which network you are looking at, and the way back out of it.
                Loading the sample used to be a one-way door: it lives in
                sessionStorage, and nothing in the UI cleared it. */}
            {csvMode && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginLeft: isMobile ? 4 : 10, padding: isMobile ? '4px 8px' : '5px 10px',
                borderRadius: 999, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: csvSource === 'sample' ? '#9B59B6' : '#2ecc71',
                }} />
                <span style={{ fontSize: isMobile ? 10 : 12, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap' }}>
                  {csvSource === 'sample' ? 'Sample network' : 'Your CSV'}
                </span>
                <button
                  onClick={() => { clearCsvNetwork(); window.location.href = '/'; }}
                  title={csvSource === 'sample' ? 'Leave the sample network' : 'Clear this import'}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: '#888', fontSize: isMobile ? 13 : 15, lineHeight: 1,
                    padding: '0 0 0 2px',
                  }}
                >
                  &times;
                </button>
              </div>
            )}
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
            {!IS_DEMO && <Link
              href="/social"
              title="Experimental: what your own LinkedIn data says about your relationships"
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#FFD700', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Social<span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>beta</span>
            </Link>}
            {!IS_DEMO && !csvMode && <Link
              href="/scores"
              style={{
                padding: isMobile ? '6px 10px' : '8px 16px', borderRadius: 6, border: 'none', fontSize: isMobile ? 11 : 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#FFD700', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Scores
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
            {/* Named "Scan" everywhere — nav, page title, README and docs. It is
                also the only route to 2nd-degree data, so it stays visible on
                mobile rather than being the one thing a phone user cannot find. */}
            {!IS_DEMO && !csvMode && <Link
              href="/setup"
              style={{
                padding: isMobile ? '8px 12px' : '8px 16px', borderRadius: 6, border: 'none',
                fontSize: 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', color: '#666', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              Scan
            </Link>}
            {!IS_DEMO && !csvMode && <AutoScanButton isMobile={isMobile} />}
          </div>
          {/* Settings — also in CSV/sample mode and on phones, so updates stay reachable */}
          {!IS_DEMO && <Link
            href="/settings"
            title="Settings"
            aria-label="Settings"
            style={{
              width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.06)', color: '#888', fontSize: isMobile ? 14 : 16, textDecoration: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: isMobile ? 4 : 8,
            }}
          >
            {'\u2699\uFE0E'}
          </Link>}
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
          {/* Refresh button — Check for new, once you say yes; notifies */}
          {!IS_DEMO && !csvMode && <RefreshButton isMobile={isMobile} />}
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
              const clusters = degree1.filter(c => bridgeIds.has(c.id)).length;
              const d2S = degree2.filter(c => c.tier === 'S').length;
              const np = (sCount*100)+(aCount*40)+(bCount*15)+(clusters*200)+(d2S*50)+degree1.length;
              return Math.floor(Math.sqrt(np / 10));
            })()}
          </a>
        </div>

        {/* Pending count badge — in header: everyone with a request out, once each (lib/requests-client.js) */}
        {isDegreesMode && !csvMode && pendingCount > 0 && (
          <Link href="/queue" style={{
            padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, textDecoration: 'none',
            background: 'rgba(255,107,53,0.12)', color: '#FF6B35',
            border: '1px solid rgba(255,107,53,0.25)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 10 }}>⏳</span>
            {pendingCount} Pending
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
          visualMode={view.key}
          onVisualModeChange={setVisualMode}
          tierCounts={isDegreesMode ? stats?.tiers || {} : tierCountsOf(networkRows)}
          degrees={degrees}
          onDegreesChange={setDegrees}
          hiddenTiers={hiddenTiers}
          onHiddenTiersChange={setHiddenTiers}
          degreeCounts={{ 1: byDegree[1].length, 2: byDegree[2].length, 3: byDegree[3].length }}
          bridgeTierCounts={bridgeTierCounts}
        />
        {/* Visualization — switches based on visualMode */}
        {(() => {

          // No connections at all: offer a way in rather than a black screen.
          if (degree1.length === 0) return <EmptyState />;

          // Every Degrees surface is built from 2nd-degree rows. A CSV import
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
                    Degrees need 2nd-degree data
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>
                    This view maps who <em>your connections</em>{' '}know &mdash; the people you haven&rsquo;t met yet.
                    LinkedIn&rsquo;s CSV export only covers your own 1st-degree list, so there are no circles to open here.
                  </p>
                  <p style={{ color: '#666', fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                    The local scanner maps those circles (and captures real photos).{' '}
                    <Link href="/setup" style={{ color: '#3498DB', textDecoration: 'none' }}>Set up scanning &rarr;</Link>
                  </p>
                </div>
              </div>
            );
          }

          // One props object for every view. Each destructures what it needs
          // and ignores the rest, so adding a visual is a row in views.js
          // rather than a branch here that has to agree with two other files.
          const View = view.component;
          const viewProps = {
            connections: filtered,
            degree2: view.allDegree2 ? degree2 : filteredD2,
            onSelect: selectHandler,
            mode,
            userName,
            userImage: null,
            selectedId: selected?.id ?? null,
            tierColors: TIER_COLORS,
            focusNodeRef,
            // Every row, whatever the filters: rarity counts the ways in across
            // all your scanned circles, and "already connected" needs everyone.
            fullDegree1: degree1,
            fullDegree2: degree2,
            scanNotes,
            canScan,
            chainOpen,
            onChainOpened: chainOpened,
            preset: separationPreset,
          };
          return <View {...viewProps} />;
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
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSelect={(node) => { setSelected(node || null); }}
          onSwitchMode={(newMode) => { setMode(newMode); setFilter('all'); }}
          onOpenCircle={openCircle}
          onShowInSeparation={showInSeparation}
          onFocusNode={(nodeId) => { if (focusNodeRef.current) focusNodeRef.current(nodeId); }}
          csvSource={IS_DEMO ? 'sample' : csvMode ? csvSource : null}
          scanNotes={scanNotes}
          canScan={canScan}
        />
        {canScan && <NetworkRefresh onChange={reload} live={view.key === 'chain'} />}

        {/* Orbit, one tap from Bridge Chains — bottom right, Degrees mode only.
            It used to say "Galaxy" and show Orbit: the Galaxy is a Network
            Circle view, so asking for it here fell back to Orbit. Hidden over
            Separation, where on a phone it sat on top of the score column. */}
        {isDegreesMode && view.key !== 'separation' && (
          <div style={{
            position: 'absolute', bottom: 20, right: 20, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '6px 14px',
            backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ fontSize: 10, color: '#666' }}>{VIEWS.orbit.icon} {VIEWS.orbit.label}</span>
            <div
              onClick={() => setVisualMode(view.key === 'orbit' ? 'chain' : 'orbit')}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
                background: view.key === 'orbit' ? '#FF6B35' : 'rgba(255,255,255,0.15)',
                position: 'relative', transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 2,
                left: view.key === 'orbit' ? 16 : 2,
                transition: 'left 0.2s',
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A cheap fingerprint of the network: who is in it, at which degree and in
 * whose circle, and how they're marked. Equal fingerprints mean nothing a view
 * draws has changed.
 */
function networkShape(d1, d2) {
  let h = 0x811c9dc5;
  const mix = (text) => {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  };
  for (const r of [...d1, ...d2]) {
    mix(`${r.id}|${r.degree}|${r.source_connection_id ?? ''}|${r.unlocked_from_bridge_id ?? ''}|${r.tier}|${r.power_score}|${r.unlock_status ?? ''}|${r.profile_image_url ?? ''};`);
  }
  return `${d1.length}:${d2.length}:${h >>> 0}`;
}

// Looks at the network again when a scan has changed it: once when any scan
// ends, and every 20 seconds while a circle is being scanned with Bridge Chains
// open, since the scanner saves every 10 pages and the circle fills in as it
// does. Its own component for the same reason as RefreshButton below.
function NetworkRefresh({ onChange, live }) {
  const scan = useScanner();
  const ended = scan.finished.find(CHANGES_NETWORK)?.startedAt ?? null;
  const filling = live && scan.running && isCircleScan(scan);
  useEffect(() => {
    if (ended != null) onChange();
  }, [ended, onChange]);
  useEffect(() => {
    if (!filling) return undefined;
    const timer = setInterval(onChange, 20000);
    return () => clearInterval(timer);
  }, [filling, onChange]);
  return null;
}

// Its own component so the scanner's answer, which changes every second or two
// while a scan runs, re-renders this button and not the whole map.
//
// It asks first, as a company scan does, and says what it will do and what it
// costs: one click on a small icon used to open a Chrome window on LinkedIn
// with no word of what it was about to do.
function RefreshButton({ isMobile }) {
  const scan = useScanner();
  const busy = busyReason(scan);
  return (
    <button
      onClick={async () => {
        try {
          const blocked = notReadyMessage(await scraperStatus());
          if (blocked) { alert(blocked); return; }
          const ok = window.confirm(
            'Check for new connections?\n\nThis opens a Chrome window on your LinkedIn connections ' +
            'list and reads it from the newest, stopping once it reaches people already saved. It ' +
            'usually takes under a minute. It reads your own list, not a search, so it doesn’t ' +
            'use your search budget, but like any scan it is LinkedIn traffic from your account.',
          );
          if (!ok) return;
          await beginScrape('refresh');
          alert('Checking for new connections — watch it on the Scan page.');
        } catch (e) {
          alert(e.message);
        }
      }}
      disabled={Boolean(busy)}
      title={busy ? `${busy}. One scan at a time.` : 'Check for new connections'}
      style={{
        width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', border: 'none',
        cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.4 : 1,
        background: 'rgba(255,255,255,0.06)', color: '#888', fontSize: isMobile ? 12 : 14,
        display: isMobile ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 8,
      }}
    >
      ↻
    </button>
  );
}
