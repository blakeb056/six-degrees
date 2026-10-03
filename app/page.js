'use client';

import { Suspense, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { isCircleScan, loadScanNotes, NO_SCAN_NOTES } from '../lib/scraper-client';
import useScanner from './components/useScanner';
import useRequests from './components/useRequests';
import { requestCount } from '../lib/requests-client';
import { loadNetwork } from '../lib/network';
import { resolveView } from './components/views';
import { peopleByDegree } from '../lib/degrees';
import { NETWORK_GRID, DEGREES_GRID, shows, gridCounts } from '../lib/tier-grid';
import Sidebar from './components/Sidebar';
import FilterPanel from './components/FilterPanel';
import { viewsForMode } from './components/views';
import { setNotchTabs } from '../lib/island';
import OnboardingGate from './components/OnboardingGate';
import EmptyState from './components/EmptyState';
import { useUser } from './components/UserProvider';
import { IS_DEMO, loadDemoNetwork } from '../lib/demo';
import { loadCsvNetwork, closeCsvNetwork } from '../lib/csv';
import Link from 'next/link';
import AppHeader from './components/AppHeader';
import { networkLevel } from '../lib/level';
import { TIER_COLORS } from '../lib/themes';   // the theme's dot colours, filled before anything draws

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
  // The Filters panel's grid, one for each tab: which tiers show, at which
  // degrees (lib/tier-grid.js). Network Circle starts with your connections
  // alone; Degrees with everything it has.
  const [grids, setGrids] = useState({ network: NETWORK_GRID, degrees: DEGREES_GRID });
  const [selected, setSelected] = useState(null);
  const focusNodeRef = useRef(null);
  // A link to someone's circle in Bridge Chains, /?chain=<id> (the Scan page's
  // "watch it fill in"), opens Degrees on it. The router's search params rather
  // than window.location: on a click from another page the address bar only
  // changes after this page has rendered, and the map opened on the Galaxy.
  const params = useSearchParams();
  const linkedChain = params.get('chain');
  // Another page's tab row links back here with the tab named: /?mode=separation (app/components/AppTabs.js).
  const linkedMode = ['network', 'degrees', 'separation'].includes(params.get('mode')) ? params.get('mode') : null;
  const [chainOpen, setChainOpen] = useState(linkedChain);
  // Whose circle is open in Bridge Chains right now: the right panel follows it.
  const [chainIn, setChainIn] = useState(null);
  const [mode, setMode] = useState(() => (chainOpen ? 'degrees' : linkedMode || 'network'));
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [filterPanelCollapsed, setFilterPanelCollapsed] = useState(true);
  const [visualMode, setVisualMode] = useState(() => (chainOpen ? 'chain' : linkedMode === 'degrees' ? 'chain' : linkedMode === 'separation' ? 'separation' : 'galaxy'));
  // A notification opened in the right panel (app/components/NoteDetail.js);
  // one picked on another page arrives as /?note=<id> (app/components/AppHeader.js).
  const [openNote, setOpenNote] = useState(null);
  const linkedNote = params.get('note');
  const openNoteHere = useCallback((n) => { setOpenNote(n); setSidebarCollapsed(false); }, []);
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
      // Three possible sources: the bundled demo snapshot (demo mode), the
      // sample opened in this tab or a CSV import kept in the data folder
      // (1st degree only, never in the database), or the database.
      const csv = await loadCsvNetwork();
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
      if (!IS_DEMO && !csv) loadScanNotes().then(setScanNotes);
    }
    load();
  }, [userId]);

  // The network again, after a scan: circles fill in while they're scanned
  // (Blake, 2026-09-28: "the d3 dots as it builds more in"). Only a real change
  // is published, because the graph views rebuild their scene whenever these
  // lists change identity (TRAPS §29).
  const reload = useCallback(async () => {
    if (IS_DEMO || csvMode || !userId) return;
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
  }, [userId, csvMode]);

  // Followed once: Bridge Chains has opened it, so leaving that view and coming
  // back, or reloading, starts from the overview.
  // A card's Insights → Separation, filtered to that person's circle ("Show them", "S only").
  const [separationPreset, setSeparationPreset] = useState(null);
  const showInSeparation = useCallback((preset) => {
    setSeparationPreset({ ...preset, id: `${preset.query}|${preset.tier || ''}|${preset.rarity || ''}|${Math.random()}` });
    setMode('separation');
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

  // Separation is its own tab, built on the same rows as Degrees: your bridges and their circles.
  const isDegreesMode = mode === 'degrees' || mode === 'separation';
  const connections = degree1;

  // What the views draw. Memoised because the graph views rebuild their whole
  // scene when these change identity: computed inline, every re-render — a click,
  // the sidebar opening, a notification arriving — reset the galaxy's layout. The
  // empty list in network mode was a new [] each time, which was enough on its own.
  // Network Circle draws the degrees picked in the Filter panel, each person
  // once, at the nearest degree they're found (lib/degrees.js).
  const byDegree = useMemo(() => peopleByDegree(degree1, degree2, degree3), [degree1, degree2, degree3]);
  const grid = isDegreesMode ? grids.degrees : grids.network;
  // Degrees draws your connections (the bridges among them) and their circles;
  // Network Circle draws whoever the grid shows, at any degree.
  // Separation ranks the people two steps away, and every connection is a way
  // in to them whatever its tier, so there the tiers pick who's ranked and never
  // which connections lead to them (Blake, 2026-10-03: hiding a tier took the
  // purple A-tier mutuals off the map; "the filter should only apply to the output").
  const isSeparation = mode === 'separation';
  const filtered = useMemo(() => {
    if (isSeparation) return connections;
    if (isDegreesMode) return connections.filter((c) => shows(grid, c.tier, 1));
    return [1, 2, 3].flatMap((d) => (byDegree[d] || []).filter((c) => shows(grid, c.tier, d)));
  }, [isSeparation, isDegreesMode, connections, byDegree, grid]);
  // Lookups built once per load. Every click re-renders this component, and the
  // three places below used to scan one list inside another — degree1.find per
  // 2nd-degree row, degree2.some per connection — about 16M comparisons, twice
  // a click, at 20k rows.
  const d1ById = useMemo(() => new Map(degree1.map(c => [c.id, c])), [degree1]);
  // Your level, in the round button at the top right (lib/level.js).
  const level = useMemo(() => networkLevel(degree1, degree2), [degree1, degree2]);
  const bridgeIds = useMemo(
    () => new Set(degree2.map(d => d.source_connection_id).filter(Boolean)),
    [degree2],
  );
  // A 2nd-degree row shows when its own tier does at 2nd degree, and (in
  // Degrees, not Separation) the bridge it came through shows at 1st.
  const filteredD2 = useMemo(() => {
    if (!isDegreesMode) return NO_DEGREE2;
    if (isSeparation) return degree2.filter((c) => shows(grid, c.tier, 2));
    return degree2.filter((c) => shows(grid, c.tier, 2) && shows(grid, d1ById.get(c.source_connection_id)?.tier, 1));
  }, [isDegreesMode, isSeparation, grid, d1ById, degree2]);
  // How many people stand behind each dot of the grid. In Degrees, 1st degree
  // counts the bridges, since those are the connections it draws; Separation
  // only ranks the 2nd.
  const panelCounts = useMemo(() => gridCounts(isSeparation
    ? { 2: byDegree[2] }
    : isDegreesMode
      ? { 1: degree1.filter((c) => bridgeIds.has(c.id)), 2: byDegree[2] }
      : byDegree), [isSeparation, isDegreesMode, degree1, bridgeIds, byDegree]);
  const selectHandler = useCallback((node) => {
    setSelected(node);
    if (node) { setSidebarCollapsed(false); setOpenNote(null); }
  }, []);

  // Resolved once: the renderer below and the notch's buttons both need it.
  // (Above the loading screen's early return, because the effect is a hook.)
  const view = resolveView(visualMode, mode);

  // This tab's views live in the notch under the header (app/components/ScanStatusBar.js);
  // the Filters panel only filters.
  const hasNetwork = degree1.length > 0;
  useEffect(() => {
    if (!hasNetwork) return undefined;
    setNotchTabs({
      items: viewsForMode(mode).map((v) => ({ key: v.key, label: v.label, icon: v.icon, title: v.desc })),
      current: view.key,
      onPick: setVisualMode,
    });
    return () => setNotchTabs(null);
  }, [mode, view.key, hasNetwork]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Loading Six Degrees…</div>
        <div style={{ fontSize: 14, color: 'var(--sd-fg-3, #888)', marginTop: 8 }}>Mapping your LinkedIn network</div>
      </div>
    );
  }

  // Scanning and the Scan page belong to your own network, not the sample or a CSV.
  const canScan = !IS_DEMO && !csvMode;

  return (
    <div data-map style={{ height: '100vh', overflow: 'hidden', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
      <AppHeader
        active={mode}
        isMobile={isMobile}
        csvMode={csvMode}
        onMode={(m) => { setMode(m); setSelected(null); setVisualMode(m === 'network' ? 'galaxy' : m === 'degrees' ? 'chain' : 'separation'); }}
        level={level}
        onOpenNote={openNoteHere}
        openNoteId={linkedNote}
        // Which network you are looking at, and the way back out of it. Loading
        // the sample used to be a one-way door: it lives in sessionStorage, and
        // nothing in the UI cleared it. A CSV import is kept in the data folder
        // now, so × is how it's removed for good, and it asks first, as every
        // delete of something kept on this computer does.
        chips={csvMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginLeft: isMobile ? 4 : 10, padding: isMobile ? '4px 8px' : '5px 10px',
            borderRadius: 999, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)',
            border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: csvSource === 'sample' ? '#9B59B6' : '#2ecc71',
            }} />
            <span style={{ fontSize: isMobile ? 10 : 12, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.65)', whiteSpace: 'nowrap' }}>
              {csvSource === 'sample' ? 'Sample network' : 'Your CSV'}
            </span>
            <button
              onClick={async () => {
                if (csvSource !== 'sample' && !window.confirm('Remove this CSV import from this computer? Your Connections.csv file isn’t touched, so you can import it again.')) return;
                const closed = await closeCsvNetwork(csvSource);
                if (!closed.ok) { alert(closed.error); return; }
                window.location.href = '/';
              }}
              title={csvSource === 'sample' ? 'Leave the sample network' : 'Remove this import from this computer'}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--sd-fg-3, #888)', fontSize: isMobile ? 13 : 15, lineHeight: 1,
                padding: '0 0 0 2px',
              }}
            >
              &times;
            </button>
          </div>
        )}
      >
        {/* Pending count badge — in header: everyone with a request out, once each (lib/requests-client.js) */}
        {isDegreesMode && !csvMode && pendingCount > 0 && (
          <Link href="/queue" style={{
            padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600, textDecoration: 'none',
            background: 'rgba(255,107,53,0.12)', color: 'var(--sd-orange, #FF6B35)',
            border: '1px solid rgba(255,107,53,0.25)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 10 }}>⏳</span>
            {pendingCount} Pending
          </Link>
        )}
      </AppHeader>

      <div style={{ display: 'flex', height: isMobile ? 'calc(100vh - 70px)' : 'calc(100vh - 130px)', position: 'relative' }}>
        <FilterPanel
          collapsed={filterPanelCollapsed}
          onToggle={() => setFilterPanelCollapsed(!filterPanelCollapsed)}
          mode={isSeparation ? 'separation' : isDegreesMode ? 'degrees' : 'network'}
          visualMode={view.key}
          grid={grid}
          gridCounts={panelCounts}
          onGridChange={(next) => setGrids((g) => ({ ...g, [isDegreesMode ? 'degrees' : 'network']: next }))}
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
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px', color: 'var(--sd-fg-1, #fff)' }}>
                    Degrees need 2nd-degree data
                  </h2>
                  <p style={{ color: 'rgba(var(--sd-ink, 255, 255, 255), 0.45)', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>
                    This view maps who <em>your connections</em>{' '}know: the people you haven&rsquo;t met yet.
                    LinkedIn&rsquo;s CSV export only covers your own 1st-degree list, so there are no circles to open here.
                  </p>
                  <p style={{ color: 'var(--sd-fg-4, #666)', fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                    The local scanner maps those circles (and captures real photos).{' '}
                    <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Set up scanning &rarr;</Link>
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
            onCircle: setChainIn,
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
          mode={isDegreesMode ? 'degrees' : 'network'}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSelect={(node) => { setSelected(node || null); }}
          onSwitchMode={(newMode) => { setMode(newMode); }}
          note={openNote}
          onCloseNote={() => setOpenNote(null)}
          circle={view.key === 'chain' ? chainIn : null}
          onOpenCircle={openCircle}
          onShowInSeparation={showInSeparation}
          onFocusNode={(nodeId) => { if (focusNodeRef.current) focusNodeRef.current(nodeId); }}
          csvSource={IS_DEMO ? 'sample' : csvMode ? csvSource : null}
          scanNotes={scanNotes}
          canScan={canScan}
        />
        {canScan && <NetworkRefresh onChange={reload} live={view.key === 'chain'} />}

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
// does. Its own component so the scanner's answer, which changes every second or
// two while a scan runs, re-renders it and not the whole map.
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

