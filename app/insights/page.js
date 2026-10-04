'use client';

// Insights: your network ranked by power, and the boards that read it
// (Blake, 2026-10-03: "stats and insights … data and insights based off their
// circles … almost no moral tie to the person … base it off value like
// richest person or highest power people … an intro perspective look at the
// data of what we have"). Mock-up B, "The Power Index", is the page; mock-up
// C, the scrolling report, is its Report view.
//
// Its views sit in the notch under the header, as every page's do
// (lib/island.js setNotchTabs): People, Kingmakers, Gatekeepers, Companies,
// Industries and Report. Every number comes from lib/insights-board.js, which
// says where each came from; nothing here is estimated and nothing is about
// money.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '../components/AppHeader';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';
import useRequests from '../components/useRequests';
import { setNotchTabs } from '../../lib/island';
import { loadNetwork } from '../../lib/network';
import { loadCsvNetwork } from '../../lib/csv';
import { loadScanNotes, NO_SCAN_NOTES } from '../../lib/scraper-client';
import { hasRequest } from '../../lib/requests-client';
import { networkLevel } from '../../lib/level';
import { IS_DEMO } from '../../lib/demo';
import {
  boardBase, powerIndex, kingmakers, gatekeepers, hiddenGiants, tierByRarity, untapped,
  companyPower, industries, titleLadder, coverage, howSure, reachSummary,
} from '../../lib/insights-board';
import PeopleView from '../components/insights/PeopleView';
import { KingmakersBoard, GatekeepersBoard, CompaniesBoard, IndustriesBoard } from '../components/insights/Boards';
import Report from '../components/insights/Report';
import { fmt, useIsMobile, TITLE } from '../components/insights/parts';

const VIEWS = ['people', 'kingmakers', 'gatekeepers', 'companies', 'industries', 'report'];
const LABELS = { people: 'People', kingmakers: 'Kingmakers', gatekeepers: 'Gatekeepers', companies: 'Companies', industries: 'Industries', report: 'Report' };

export default function InsightsPage() {
  // Suspense because the page reads the address's ?view= (useSearchParams),
  // which Next requires to sit inside one for the page to build (TRAPS §41).
  return <OnboardingGate><Suspense><InsightsInner /></Suspense></OnboardingGate>;
}

function InsightsInner() {
  const { userId } = useUser();
  const isMobile = useIsMobile();
  const asked = useSearchParams().get('view');
  const [view, setView] = useState(() => (VIEWS.includes(asked) ? asked : 'people'));
  const [net, setNet] = useState(null);   // { degree1, degree2, degree3, notes, source, budget }
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (IS_DEMO || !userId) return;
    let live = true;
    (async () => {
      try {
        // The sample (this window) or a kept CSV import, else your own network:
        // lib/csv.js openNetworkSource, the one rule every page opens on.
        const local = await loadCsvNetwork();
        if (local) {
          if (live) setNet({ degree1: local.degree1 || [], degree2: local.degree2 || [], degree3: [], notes: NO_SCAN_NOTES, source: local.source || 'csv', budget: null });
          return;
        }
        // Your daily search budget and speed, for what scanning the next circles would take:
        // ?usage only reads the scanner's files (no checks, no Python, nothing written).
        const usage = fetch('/api/scraper?usage').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const [n, notes, used] = await Promise.all([loadNetwork(userId), loadScanNotes(), usage]);
        const limits = used?.limits;
        if (live) setNet({ ...n, notes, source: 'own', budget: limits ? { daily: limits.daily, pace: limits.pace } : null });
      } catch (e) {
        if (live) setFailed(e.message || 'The network couldn’t be loaded.');
      }
    })();
    return () => { live = false; };
  }, [userId]);

  // The quick part first: the ranking and the boards that read circles.
  const base = useMemo(() => (net ? boardBase(net) : null), [net]);
  const data = useMemo(() => {
    if (!base) return null;
    const index = powerIndex(base);
    return {
      index, reach: reachSummary(base), kings: kingmakers(base), gates: gatekeepers(base), hidden: hiddenGiants(base),
      grid: tierByRarity(base), cover: coverage(base, net.budget || {}), sure: howSure(index),
    };
  }, [base, net]);
  // Companies and titles read every headline (about half a second on 7,000
  // people), so they follow once the table is on screen.
  const [slow, setSlow] = useState(null);
  useEffect(() => {
    if (!base) return undefined;
    const t = setTimeout(() => {
      const companies = companyPower(base);
      setSlow({ base, companies, industries: industries(companies), ladder: titleLadder(base) });
    }, 30);
    return () => clearTimeout(t);
  }, [base]);
  const heavy = slow && slow.base === base ? slow : null;

  const requests = useRequests();
  const isAsked = useCallback((row) => hasRequest(row, requests), [requests]);
  const open = useMemo(() => (base ? untapped(base, isAsked) : null), [base, isAsked]);

  const pick = useCallback((v) => {
    setView(v);
    try {
      const u = new URL(window.location.href);
      if (v === 'people') u.searchParams.delete('view'); else u.searchParams.set('view', v);
      window.history.replaceState(null, '', u.pathname + u.search);
    } catch { /* the address stays */ }
    window.scrollTo(0, 0);
  }, []);

  // The views in the notch, with how many each ranks.
  useEffect(() => {
    if (!data || data.index.total === 0) { setNotchTabs(null); return undefined; }
    const count = {
      people: data.index.total, kingmakers: data.kings.scanned, gatekeepers: data.gates.list.length,
      companies: heavy?.companies.count, industries: heavy?.industries.list.length,
    };
    setNotchTabs({
      items: VIEWS.map((key) => ({
        key,
        label: count[key] ? <>{LABELS[key]}<small style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 600 }}>{fmt(count[key])}</small></> : LABELS[key],
      })),
      current: view, onPick: pick,
    });
    return () => setNotchTabs(null);
  }, [data, heavy, view, pick]);

  const level = useMemo(() => (net ? networkLevel(net.degree1, net.degree2) : null), [net]);
  const csvMode = Boolean(net && net.source !== 'own');

  if (IS_DEMO) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--sd-fg-2, #ccc)', fontFamily: 'var(--sd-font)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--sd-fg-1, #fff)' }}>Not part of the demo</h1>
        <p style={{ fontSize: 13, margin: 0 }}>The public demo includes the Network Circle and Degrees views only.</p>
        <Link href="/" style={{ fontSize: 13, color: 'var(--sd-fg-3, #888)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  const shared = { data, heavy, open, net, source: net?.source, isMobile, onView: pick };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
      <AppHeader active="insights" csvMode={csvMode} level={level} isMobile={isMobile} />
      {/* Room for the notch, which hangs under the header with the views in it */}
      <main style={{ maxWidth: view === 'report' ? 920 : 1400, margin: '0 auto', padding: isMobile ? '52px 12px 0' : '58px 30px 0' }}>
        {failed ? <Message title="The network couldn’t be loaded" body={failed} />
          : !data ? <Message title="Reading your network…" />
          : data.index.total === 0 ? <Empty source={net.source} />
          : view === 'people' ? <PeopleView {...shared} requests={requests} />
          : view === 'kingmakers' ? <KingmakersBoard {...shared} />
          : view === 'gatekeepers' ? <GatekeepersBoard {...shared} />
          : view === 'companies' ? <CompaniesBoard {...shared} />
          : view === 'industries' ? <IndustriesBoard {...shared} />
          : <Report {...shared} />}
        <Footer net={net} data={data} isMobile={isMobile} />
      </main>
    </div>
  );
}

function Message({ title, body }) {
  return (
    <div style={{ padding: '80px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: 'var(--sd-fg-3, #888)', marginTop: 8 }}>{body}</div>}
    </div>
  );
}

/** No one to rank yet: where people come from. */
function Empty({ source }) {
  return (
    <div style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center' }}>
      <h1 style={TITLE}>The Power Index</h1>
      <p style={{ fontSize: 15, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.6, margin: '12px 0 22px' }}>
        Nothing to rank yet. Once your connections are in, everyone within two steps of you shows here, ranked by power,
        with who holds the doors and what’s still closed.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {source === 'own' && (
          <Link href="/setup" style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, textDecoration: 'none', color: '#000', background: 'linear-gradient(135deg, #00ff88, #1abc9c)' }}>
            Scan your connections →
          </Link>
        )}
        <Link href="/import" style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, textDecoration: 'none', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.2)' }}>
          Import a CSV
        </Link>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--sd-fg-4, #6f7a88)', marginTop: 18 }}>
        Or look around first: the <Link href="/" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>map’s welcome screen</Link> opens a sample network where every person is invented.
      </p>
    </div>
  );
}

/** The rule every screen with a tier says, and which network this is. */
function Footer({ net, data, isMobile }) {
  const what = !net || !data?.index.total ? null
    : net.source === 'sample' ? 'The sample network: every person in it is invented.'
    : net.source === 'csv' ? `Your CSV import: ${fmt(data?.reach.d1)} connections, no circles.`
    : data ? `Counted from your ${fmt(data.reach.d1)} connections and the ${fmt(data.reach.circles)} circle${data.reach.circles === 1 ? '' : 's'} you’ve scanned.` : null;
  return (
    <footer style={{
      margin: '36px 0 0', padding: '18px 0 34px', borderTop: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', gap: isMobile ? 8 : 20,
      color: 'var(--sd-fg-4, #6f7a88)', fontSize: 11.5, lineHeight: 1.5,
    }}>
      <div><b style={{ color: 'var(--sd-fg-2, #b8c4c4)' }}>Power ranks reachability, not people.</b> A tier is a statement about network position, not human worth.</div>
      {what && <div>{what}</div>}
    </footer>
  );
}
