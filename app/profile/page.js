'use client';

// Your profile, the round level button at the top right: your level, how much
// of your network is mapped, and ✦ Insights, your network ranked by power with
// the boards that read it (app/components/insights/InsightsBoards.js). Insights
// was a tab of its own until Blake, 2026-10-04: "insights that should be in the
// profile where the button already is as that makes more sense and not to add a
// tab".
//
// The same header as every page (AppHeader), and its buttons in the notch under
// it (Blake, 2026-10-04: "make sure all the uis are compliant"): Profile · ✦
// Insights, and with Insights on, its boards after a thin line: People,
// Kingmakers, Gatekeepers, Companies, Industries, Report and Health, the
// network health that was all Profile → Insights showed before. The address
// says which: /profile?view=insights&board=<board> (lib/insights-address.js).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadNetwork } from '../../lib/network';
import MappingProgress from '../components/MappingProgress';
import { IS_DEMO } from '../../lib/demo';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';
import AppHeader from '../components/AppHeader';
import useNotchTabs from '../components/useNotchTabs';
import InsightsBoards from '../components/insights/InsightsBoards';
import { fmt, useIsMobile } from '../components/insights/parts';
import { sectorByKey } from '../../lib/sector-labels';
import Link from 'next/link';
import { networkPower as powerOf, levelOf } from '../../lib/level';
import { TIER_COLORS } from '../../lib/themes';
import { CSV_USER } from '../../lib/csv';
import { BOARDS, BOARD_LABELS, DEFAULT_BOARD, boardOf, insightsHref } from '../../lib/insights-address';

const LEVEL_NAMES = {
  1: 'Observer', 11: 'Connector', 31: 'Networker', 51: 'Strategist', 76: 'Architect',
};

function getLevelName(level) {
  let name = 'Observer';
  for (const [threshold, label] of Object.entries(LEVEL_NAMES)) {
    if (level >= parseInt(threshold)) name = label;
  }
  return name;
}

export default function ProfilePage() {
  // useSearchParams (which view, which board) needs a Suspense boundary to build.
  return <Suspense fallback={null}><OnboardingGate><ProfileInner /></OnboardingGate></Suspense>;
}

function ProfileInner() {
  const { userId, userName, userProfile } = useUser();
  const isMobile = useIsMobile();
  // Profile, or Insights and one of its boards. Read from the address with
  // useSearchParams (TRAPS §41), and changed with history.replaceState, which
  // Next follows: a board changes at once, with nothing fetched. A link can open
  // any of them: /profile?view=insights&board=health (Settings, the old Scores
  // tab), and /insights forwards here (app/insights/page.js).
  const params = useSearchParams();
  const view = params.get('view') === 'insights' ? 'insights' : 'profile';
  const board = boardOf(params.get('board'));
  // The sample or a CSV import is open instead of your own network (lib/csv.js openNetworkSource).
  const csvMode = userId === CSV_USER.id;
  const profile = userProfile || { name: userName || 'User', headline: '', sectors: [], goals: [] };
  const [stats, setStats] = useState(null);   // null while the profile loads
  const [notifications, setNotifications] = useState([]);
  const [queueStats, setQueueStats] = useState({ total: 0, sent: 0, accepted: 0 });
  const [mapping, setMapping] = useState({ degree1: [], degree2: [], skips: [] });
  // "Your Sectors" is what you picked in Settings → Scores → Your field. (users.sectors,
  // which this card used to show, is never written by anything; the Sidebar
  // and Outlink still read it as free text.) null while it loads; a load that
  // fails says so rather than showing "none picked" (TRAPS §7).
  const [sectorFocus, setSectorFocus] = useState(null);
  // What Insights reports: how many each board ranks (for the notch), and the level.
  const [counts, setCounts] = useState(null);
  const [insightsLevel, setInsightsLevel] = useState(null);

  // The profile's numbers, once, the first time the profile itself is shown:
  // Insights reads the network on its own, and a network is a big read.
  const loaded = useRef(false);
  useEffect(() => {
    if (IS_DEMO || !userId || view !== 'profile' || loaded.current) return;
    loaded.current = true;
    async function load() {
      fetch('/api/settings')
        .then((r) => r.json().then((d) => (r.ok && d.settings ? d : Promise.reject(new Error(d.error)))))
        .then((d) => setSectorFocus(d.settings.sectorFocus || { sectors: [], strength: 'lean' }))
        .catch(() => setSectorFocus({ failed: true }));
      const net = await loadNetwork(userId);
      const d1 = net.degree1;
      const d2 = net.degree2;

      const tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
      d1.forEach(c => { tiers[c.tier] = (tiers[c.tier] || 0) + 1; });

      const d2Tiers = { S: 0, A: 0, B: 0, C: 0, D: 0 };
      d2.forEach(c => { d2Tiers[c.tier] = (d2Tiers[c.tier] || 0) + 1; });

      const clusters = [...new Set(d2.map(c => c.source_connection_id).filter(Boolean))].length;
      const catalysts = d1.filter(c => c.is_catalyst).length;

      // Company breakdown
      const companies = {};
      d1.forEach(c => { if (c.company) companies[c.company] = (companies[c.company] || 0) + 1; });
      const topCompanies = Object.entries(companies).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // Network Power, and the level the header's round button shows (lib/level.js)
      const networkPower = powerOf(d1, d2);
      const level = levelOf(networkPower);
      const currentLevelPower = level * level * 10;
      const nextLevelPower = (level + 1) * (level + 1) * 10;
      const xpProgress = ((networkPower - currentLevelPower) / (nextLevelPower - currentLevelPower)) * 100;

      setStats({
        d1Count: d1.length, d2Count: d2.length, tiers, d2Tiers,
        clusters, catalysts, networkPower, level, xpProgress,
        topCompanies, unlockedPaths: 0,
      });

      // The progress card needs the rows themselves, not just the counts.
      // Skips live with the scraper rather than in the schema, so they come
      // from its endpoint — see docs/brain/BACKLOG.md item 3.
      fetch('/api/scraper')
        .then((r) => r.json())
        .then((d) => setMapping({ degree1: d1, degree2: d2, skips: d.skips || [] }))
        .catch(() => setMapping({ degree1: d1, degree2: d2, skips: [] }));

      // Fetch notifications and queue stats
      fetch(`/api/notifications?userId=${userId}`).then(r => r.json()).then(data => setNotifications(data.notifications || [])).catch(() => {});
      fetch('/api/queue').then(r => r.json()).then(data => {
        const items = data.items || [];
        setQueueStats({
          total: items.length,
          sent: items.filter(i => i.status === 'sent').length,
          accepted: items.filter(i => i.status === 'accepted').length,
        });
      }).catch(() => {});
    }
    load();
  }, [userId, view]);

  const go = useCallback((href) => {
    try { window.history.replaceState(null, '', href); } catch { /* the address stays */ }
    window.scrollTo(0, 0);
  }, []);
  const pickBoard = useCallback((b) => go(insightsHref(b)), [go]);
  const notch = useMemo(() => ({
    items: [
      { key: 'profile', label: 'Profile' },
      { key: 'insights', label: 'Insights', icon: '✦', title: 'Your network ranked by power, and the boards that read it' },
      ...(view === 'insights' ? BOARDS.map((key, i) => ({
        key, divided: i === 0, group: 'Insights board',
        label: counts?.[key] ? <>{BOARD_LABELS[key]}<small style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 600 }}>{fmt(counts[key])}</small></> : BOARD_LABELS[key],
      })) : []),
    ],
    current: view === 'insights' ? ['insights', board] : 'profile',
    onPick: (key) => {
      if (key === 'profile') go('/profile');
      else if (key === 'insights') { if (view !== 'insights') go(insightsHref(DEFAULT_BOARD)); }
      else pickBoard(key);
    },
  }), [view, board, counts, go, pickBoard]);
  useNotchTabs(IS_DEMO ? null : notch);

  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--sd-page)', color: 'rgba(var(--sd-ink, 255, 255, 255), 0.7)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, textAlign: 'center', padding: 24,
        fontFamily: 'var(--sd-font)',
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>Not part of the demo</h2>
        <p style={{ margin: 0, fontSize: 13 }}>The public demo includes the Network Circle and Degrees views only.</p>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(var(--sd-ink, 255, 255, 255), 0.5)', textDecoration: 'none' }}>&larr; Back to the network</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
      <AppHeader active="profile" csvMode={csvMode} level={view === 'insights' ? insightsLevel : stats?.level ?? null} isMobile={isMobile} />
      {/* Room for the notch, which hangs under the header with Profile · ✦ Insights in it */}
      <main style={{ padding: isMobile ? '52px 12px 16px' : '58px 30px 32px' }}>
        {view === 'insights'
          ? <InsightsBoards board={board} onBoard={pickBoard} isMobile={isMobile} onCounts={setCounts} onLevel={setInsightsLevel} />
          : !stats
            ? <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--sd-fg-3, #888)' }}>Loading profile…</div>
            : <ProfileBody s={stats} profile={profile} mapping={mapping} queueStats={queueStats} notifications={notifications} sectorFocus={sectorFocus} />}
      </main>
    </div>
  );
}

/** The profile itself: your level, how much is mapped, what you've asked, and your sectors. */
function ProfileBody({ s, profile, mapping, queueStats, notifications, sectorFocus }) {
  const tierColors = TIER_COLORS;   // the theme's (lib/themes.js)

  // Milestones
  const milestones = [
    { label: 'First S-Tier', done: s.tiers.S > 0, icon: '👑' },
    { label: '100 Connections', done: s.d1Count >= 100, icon: '🔗' },
    { label: '500 Connections', done: s.d1Count >= 500, icon: '🌐' },
    { label: 'First Cluster', done: s.clusters > 0, icon: '🔭' },
    { label: '10 Clusters', done: s.clusters >= 10, icon: '🏰' },
    { label: '50 S-Tier', done: s.tiers.S >= 50, icon: '💎' },
    { label: 'Catalyst Found', done: s.catalysts > 0, icon: '⚡' },
    { label: 'Level 25', done: s.level >= 25, icon: '🎯' },
    { label: 'Level 50', done: s.level >= 50, icon: '🚀' },
    { label: 'D2 S-Tier > 50', done: s.d2Tiers.S >= 50, icon: '🌟' },
  ];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>

      {/* === LEVEL CARD === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', borderRadius: 16, padding: 32, marginBottom: 24,
        border: '1px solid rgba(255,215,0,0.2)', textAlign: 'center',
      }}>
        {/* Level circle */}
        <div style={{
          width: 100, height: 100, borderRadius: '50%', margin: '0 auto 16px',
          background: 'linear-gradient(135deg, #FFD700, #FF6B35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 800, color: '#000',
          boxShadow: '0 0 30px rgba(255,215,0,0.3)',
        }}>
          {s.level}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{profile.name}</div>
        <div style={{ fontSize: 14, color: 'var(--sd-fg-3, #888)', marginBottom: 4 }}>{profile.headline}</div>
        <div style={{
          display: 'inline-block', padding: '4px 16px', borderRadius: 20,
          background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.3)',
          color: 'var(--sd-gold, #FFD700)', fontSize: 13, fontWeight: 700, marginBottom: 16,
        }}>
          {getLevelName(s.level)}
        </div>

        {/* XP Progress bar */}
        <div style={{ maxWidth: 300, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--sd-fg-4, #666)', marginBottom: 4 }}>
            <span>Level {s.level}</span>
            <span>Level {s.level + 1}</span>
          </div>
          <div style={{ height: 8, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', borderRadius: 4 }}>
            <div style={{
              height: '100%', width: `${Math.min(s.xpProgress, 100)}%`,
              background: 'linear-gradient(90deg, #FFD700, #FF6B35)', borderRadius: 4,
              transition: 'width 1s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--sd-fg-3, #888)', marginTop: 4 }}>
            Network Power: {s.networkPower.toLocaleString()}
          </div>
        </div>
      </div>

      {/* === 2ND-DEGREE MAPPING PROGRESS === */}
      <MappingProgress
        degree1={mapping.degree1}
        degree2={mapping.degree2}
        skips={mapping.skips}
      />

      {/* === QUEUE PROGRESS === */}
      <div style={{
        background: 'rgba(255,107,53,0.06)', borderRadius: 12, padding: 20, marginBottom: 24,
        border: '1px solid rgba(255,107,53,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--sd-orange, #FF6B35)' }}>Queue Progress</h3>
          <Link href="/queue" style={{ fontSize: 11, color: 'var(--sd-orange, #FF6B35)', textDecoration: 'none', fontWeight: 600 }}>View Queue &rarr;</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#FFA500' }}>{queueStats.total}</div>
            <div style={{ fontSize: 10, color: 'var(--sd-fg-3, #888)' }}>In Queue</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sd-blue, #3498DB)' }}>{queueStats.sent}</div>
            <div style={{ fontSize: 10, color: 'var(--sd-fg-3, #888)' }}>Sent</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sd-green, #00ff88)' }}>{queueStats.accepted}</div>
            <div style={{ fontSize: 10, color: 'var(--sd-fg-3, #888)' }}>Accepted</div>
          </div>
        </div>
      </div>

      {/* === NOTIFICATIONS === */}
      {notifications.length > 0 && (
        <div style={{
          background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
            Recent Activity ({notifications.filter(n => !n.seen).length} new)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {notifications.slice(0, 10).map(n => (
              <div key={n.id} style={{
                display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6,
                background: n.seen ? 'transparent' : 'rgba(255,215,0,0.05)',
                borderLeft: n.seen ? 'none' : '2px solid #FFD700',
              }}>
                <span style={{ fontSize: 16 }}>{n.icon || '📌'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: n.seen ? 'var(--sd-fg-3, #888)' : 'var(--sd-fg-1, #fff)' }}>{n.title}</div>
                  {n.message && <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #666)' }}>{n.message}</div>}
                </div>
                <span style={{ fontSize: 9, color: 'var(--sd-fg-5, #555)', flexShrink: 0 }}>
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === NETWORK STATS === */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24,
      }}>
        <StatCard label="Connections" value={s.d1Count} />
        <StatCard label="Degree-2 Reach" value={s.d2Count} />
        <StatCard label="Clusters" value={s.clusters} />
        <StatCard label="S-Tier" value={s.tiers.S} color="#FFD700" />
        <StatCard label="A-Tier" value={s.tiers.A} color="#9B59B6" />
        <StatCard label="Catalysts" value={s.catalysts} color="#00ff88" />
      </div>

      {/* === TIER DISTRIBUTION === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Tier Distribution</h3>
        {['S', 'A', 'B', 'C', 'D'].map(tier => {
          const count = s.tiers[tier] || 0;
          const pct = s.d1Count > 0 ? (count / s.d1Count * 100) : 0;
          return (
            <div key={tier} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ color: tierColors[tier], fontWeight: 600 }}>{tier}-Tier</span>
                <span style={{ color: 'var(--sd-fg-3, #888)' }}>{count} ({pct.toFixed(1)}%)</span>
              </div>
              <div style={{ height: 6, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: tierColors[tier], borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* === DEGREE-2 REACH === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Degree-2 Reach</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--sd-orange, #FF6B35)' }}>{s.d2Count}</div>
            <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)' }}>People reachable via bridges</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--sd-gold, #FFD700)' }}>{s.d2Tiers.S}</div>
            <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)' }}>S-Tier degree-2</div>
          </div>
        </div>
      </div>

      {/* === MILESTONES === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
          Milestones ({milestones.filter(m => m.done).length}/{milestones.length})
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {milestones.map((m, i) => (
            <div key={i} style={{
              padding: '8px 10px', borderRadius: 8, fontSize: 12,
              background: m.done ? 'rgba(255,215,0,0.08)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.02)',
              border: `1px solid ${m.done ? 'rgba(255,215,0,0.2)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.05)'}`,
              color: m.done ? 'var(--sd-gold, #FFD700)' : 'var(--sd-fg-5, #555)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 16 }}>{m.done ? m.icon : '🔒'}</span>
              <span style={{ fontWeight: m.done ? 600 : 400 }}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* === TOP COMPANIES === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Top Companies in Your Network</h3>
        {s.topCompanies.map(([company, count], i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: i < s.topCompanies.length - 1 ? '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)' : 'none',
            fontSize: 12,
          }}>
            <span>{company}</span>
            <span style={{ color: 'var(--sd-fg-3, #888)' }}>{count}</span>
          </div>
        ))}
      </div>

      {/* === SECTORS === */}
      <div style={{
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 12, padding: 20,
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Your Sectors</h3>
          <Link href="/settings#sector" style={{ fontSize: 11, color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontWeight: 600 }}>
            {sectorFocus?.sectors?.length ? 'Change' : sectorFocus && !sectorFocus.failed ? 'Pick in Settings' : 'Settings'} &rarr;
          </Link>
        </div>
        {!sectorFocus ? (
          <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #888)' }}>Loading…</div>
        ) : sectorFocus.failed ? (
          <div style={{ fontSize: 12, color: 'var(--sd-red, #ff7676)' }}>
            Couldn&rsquo;t load your sectors. Reload this page, or open Settings to see them.
          </div>
        ) : sectorFocus.sectors?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {sectorFocus.sectors.map((key) => {
              const ind = sectorByKey(key);
              return (
                <span key={key} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: `${ind.color}26`, border: `1px solid ${ind.color}66`, color: ind.color,
                }}>{ind.label}</span>
              );
            })}
            <span style={{ fontSize: 11, color: 'var(--sd-fg-3, #888)' }}>
              {sectorFocus.strength === 'strong' ? 'Strong' : 'Lean'}: companies here count for more in your scores.
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #888)' }}>
            None picked. Pick up to three in Settings and companies in them count for more in your scores.
          </div>
        )}
      </div>

    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.04)', borderRadius: 10, padding: '14px 12px',
      border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#fff' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--sd-fg-3, #888)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
