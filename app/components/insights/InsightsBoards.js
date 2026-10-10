'use client';

// Profile → ✦ Insights: your network ranked by power, and the boards that read
// it (Blake, 2026-10-03: "stats and insights … data and insights based off
// their circles … almost no moral tie to the person … base it off value like
// richest person or highest power people … an intro perspective look at the
// data of what we have"). Mock-up B, "The Power Index", is the People board;
// mock-up C, the scrolling report, is Report; Health is the network health
// Profile → Insights already showed.
//
// It was a tab of its own, /insights, until Blake, 2026-10-04: "insights that
// should be in the profile where the button already is as that makes more
// sense and not to add a tab". The page around it is app/profile/page.js, which
// puts the boards in its notch after Profile · ✦ Insights, with the counts this
// reports (onCounts); the address is lib/insights-address.js's.
//
// Every number comes from lib/insights-board.js, which says where each came
// from; nothing here is estimated and nothing is about money.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../UserProvider';
import useRequests from '../useRequests';
import { loadNetwork } from '../../../lib/network';
import { loadCsvNetwork } from '../../../lib/csv';
import { loadScanNotes, NO_SCAN_NOTES } from '../../../lib/scraper-client';
import { hasRequest } from '../../../lib/requests-client';
import { networkLevel } from '../../../lib/level';
import {
  boardBase, powerIndex, kingmakers, gatekeepers, hiddenGiants, tierByRarity, untapped,
  companyPower, industries, titleLadder, coverage, howSure, reachSummary,
} from '../../../lib/insights-board';
import PeopleView from './PeopleView';
import { KingmakersBoard, GatekeepersBoard, CompaniesBoard, IndustriesBoard } from './Boards';
import Report from './Report';
import { fmt, Hero, TITLE } from './parts';
import NetworkHealthSection from '../settings/NetworkHealthSection';

/**
 * @param {{ board: string, onBoard: (board: string) => void, isMobile?: boolean,
 *   onCounts?: (counts: object | null) => void, onLevel?: (level: number) => void }} props
 *   `onCounts` hears how many each board ranks once they're known (null: nothing
 *   to rank), for the notch; `onLevel` the network's level, for the header.
 */
export default function InsightsBoards({ board, onBoard, isMobile = false, onCounts, onLevel }) {
  const { userId } = useUser();
  const [net, setNet] = useState(null);   // { degree1, degree2, degree3, notes, source, budget }
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
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

  // How many each board ranks, for the notch: none until the network is read,
  // and none at all when there is no one to rank.
  useEffect(() => {
    if (!onCounts) return;
    if (!data || data.index.total === 0) { onCounts(null); return; }
    onCounts({
      people: data.index.total, kingmakers: data.kings.scanned, gatekeepers: data.gates.list.length,
      companies: heavy?.companies.count, industries: heavy?.industries.list.length,
    });
  }, [data, heavy, onCounts]);

  useEffect(() => {
    if (net && onLevel) onLevel(networkLevel(net.degree1, net.degree2));
  }, [net, onLevel]);

  const shared = { data, heavy, open, net, source: net?.source, isMobile, onView: onBoard };
  return (
    <div style={{ maxWidth: board === 'report' || board === 'health' ? 920 : 1400, margin: '0 auto' }}>
      {board === 'health' ? <HealthBoard isMobile={isMobile} />
        : failed ? <Message title="The network couldn’t be loaded" body={failed} />
        : !data ? <Message title="Reading your network…" />
        : data.index.total === 0 ? <Empty source={net.source} />
        : board === 'people' ? <PeopleView {...shared} requests={requests} />
        : board === 'kingmakers' ? <KingmakersBoard {...shared} />
        : board === 'gatekeepers' ? <GatekeepersBoard {...shared} />
        : board === 'companies' ? <CompaniesBoard {...shared} />
        : board === 'industries' ? <IndustriesBoard {...shared} />
        : <Report {...shared} />}
      <Footer net={net} data={data} isMobile={isMobile} />
    </div>
  );
}

/** Health: how your network holds together (lib/network-health.js), as Profile → Insights showed it before the boards came. */
function HealthBoard({ isMobile }) {
  return (
    <>
      <Hero title="Network health" isMobile={isMobile}>
        How your network holds together, from the circles you&rsquo;ve scanned. Only your own numbers, never a
        comparison with anyone else&rsquo;s.
      </Hero>
      <NetworkHealthSection titled={false} />
    </>
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
      {/* The CSV import first, as on the welcome screen; scanning is the opt-in. */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/import" style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, textDecoration: 'none', color: '#000', background: 'linear-gradient(135deg, #00ff88, #1abc9c)' }}>
          Import a CSV →
        </Link>
        {source === 'own' && (
          <Link href="/setup" style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, textDecoration: 'none', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.2)' }}>
            Scan your connections
          </Link>
        )}
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
