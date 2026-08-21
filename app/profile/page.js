'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { IS_DEMO } from '../../lib/demo';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';

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
  return <OnboardingGate><ProfileInner /></OnboardingGate>;
}

function ProfileInner() {
  const { userId, userName, userProfile } = useUser();
  const profile = userProfile || { name: userName || 'User', headline: '', sectors: [], goals: [] };
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [queueStats, setQueueStats] = useState({ total: 0, sent: 0, accepted: 0 });
  const [setupStatus, setSetupStatus] = useState('idle');
  const [setupLog, setSetupLog] = useState([]);
  const [bridgeStatus, setBridgeStatus] = useState('idle');
  const [bridgeLog, setBridgeLog] = useState([]);

  useEffect(() => {
    if (IS_DEMO) return;
    if (!userId) return;
    async function load() {
      const [d1Res, d2Res] = await Promise.all([
        supabase.from('linkedin_connections').select('tier,power_score,company,is_catalyst').eq('degree', 1).eq('user_id', userId),
        supabase.from('linkedin_connections').select('tier,power_score,source_connection_id').eq('degree', 2).eq('user_id', userId),
      ]);
      const d1 = d1Res.data || [];
      const d2 = d2Res.data || [];

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

      // Network Power
      const networkPower = (tiers.S * 100) + (tiers.A * 40) + (tiers.B * 15) + (tiers.C * 5) + (tiers.D * 1)
        + (clusters * 200) + (catalysts * 150) + (d2Tiers.S * 50) + d1.length;
      const level = Math.floor(Math.sqrt(networkPower / 10));
      const currentLevelPower = level * level * 10;
      const nextLevelPower = (level + 1) * (level + 1) * 10;
      const xpProgress = ((networkPower - currentLevelPower) / (nextLevelPower - currentLevelPower)) * 100;

      setStats({
        d1Count: d1.length, d2Count: d2.length, tiers, d2Tiers,
        clusters, catalysts, networkPower, level, xpProgress,
        topCompanies, unlockedPaths: 0,
      });

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

      setLoading(false);
    }
    load();
  }, [userId]);

  if (IS_DEMO) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a1a', color: 'rgba(255,255,255,0.7)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 12, textAlign: 'center', padding: 24,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>Not part of the demo</h2>
        <p style={{ margin: 0, fontSize: 13 }}>The public demo includes the Network Circle and Bridges views only.</p>
        <a href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>&larr; Back to the network</a>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a1a', color: '#fff' }}>
        Loading profile...
      </div>
    );
  }

  const tierColors = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
  const s = stats;

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
    <div style={{
      height: '100vh', background: '#0a0a1a', color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <a href="/" style={{
          display: 'flex', alignItems: 'center', gap: 6, color: '#888', textDecoration: 'none',
          fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ fontSize: 16 }}>&larr;</span> Back to Map
        </a>
        <h1 style={{
          fontSize: 22, fontWeight: 700, margin: 0,
          background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Profile</h1>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '30px 20px' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>

        {/* === LEVEL CARD === */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 32, marginBottom: 24,
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
          <div style={{ fontSize: 14, color: '#888', marginBottom: 4 }}>{profile.headline}</div>
          <div style={{
            display: 'inline-block', padding: '4px 16px', borderRadius: 20,
            background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.3)',
            color: '#FFD700', fontSize: 13, fontWeight: 700, marginBottom: 16,
          }}>
            {getLevelName(s.level)}
          </div>

          {/* XP Progress bar */}
          <div style={{ maxWidth: 300, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666', marginBottom: 4 }}>
              <span>Level {s.level}</span>
              <span>Level {s.level + 1}</span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>
              <div style={{
                height: '100%', width: `${Math.min(s.xpProgress, 100)}%`,
                background: 'linear-gradient(90deg, #FFD700, #FF6B35)', borderRadius: 4,
                transition: 'width 1s ease',
              }} />
            </div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
              Network Power: {s.networkPower.toLocaleString()}
            </div>
          </div>
        </div>

        {/* === SET UP ACCOUNT === */}
        <SetupScrapeCard status={setupStatus} log={setupLog} onStart={async () => {
          setSetupStatus('running');
          setSetupLog(['Checking scraper server...']);
          try {
            const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
            if (!(await ping.json()).ok) throw new Error();
          } catch {
            setSetupStatus('offline');
            setSetupLog(['Scraper server offline. Double-click "Start Scraper" on your Desktop.']);
            return;
          }
          setSetupLog(['Starting full account scrape...']);
          try {
            await fetch('http://localhost:5555/scrape', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'full-scrape', userId }),
            });
            const poll = setInterval(async () => {
              try {
                const r = await fetch('http://localhost:5555/status');
                const d = await r.json();
                setSetupLog(d.log || []);
                if (!d.running && d.result) {
                  clearInterval(poll);
                  setSetupStatus(d.result.status === 'error' ? 'error' : 'done');
                }
              } catch {}
            }, 2000);
          } catch { setSetupStatus('error'); }
        }} onRetry={() => { setSetupStatus('idle'); setSetupLog([]); }} />

        {/* === AUTO-BRIDGE ALL === */}
        <div style={{
          background: 'rgba(155,89,182,0.06)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(155,89,182,0.2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#9B59B6' }}>Auto-Bridge All</h3>
            {bridgeStatus === 'done' && <span style={{ fontSize: 10, color: '#00ff88', fontWeight: 600 }}>Complete</span>}
          </div>
          <p style={{ fontSize: 11, color: '#888', margin: '0 0 12px' }}>
            Scan every connection&apos;s network. S-tier first → D-tier last. 2 min cooldown between each.
          </p>

          {bridgeStatus === 'idle' && (
            <button onClick={async () => {
              setBridgeStatus('running');
              setBridgeLog(['Checking scraper server...']);
              try {
                const ping = await fetch('http://localhost:5555/ping', { signal: AbortSignal.timeout(2000) });
                if (!(await ping.json()).ok) throw new Error();
              } catch {
                setBridgeStatus('offline');
                setBridgeLog(['Scraper server offline.']);
                return;
              }
              setBridgeLog(['Starting auto-bridge (S-tier first)...']);
              try {
                await fetch('http://localhost:5555/scrape', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'auto-bridge', userId }),
                });
                const poll = setInterval(async () => {
                  try {
                    const r = await fetch('http://localhost:5555/status');
                    const d = await r.json();
                    setBridgeLog(d.log || []);
                    if (!d.running && d.result) {
                      clearInterval(poll);
                      setBridgeStatus(d.result.status === 'error' ? 'error' : 'done');
                    }
                  } catch {}
                }, 3000);
              } catch { setBridgeStatus('error'); }
            }} style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #9B59B6, #FF6B35)',
              color: '#fff', fontWeight: 700, fontSize: 14,
            }}>
              Auto-Bridge All Connections
            </button>
          )}

          {bridgeStatus === 'offline' && (
            <div>
              <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
                Scraper offline — start it first
              </div>
              <button onClick={() => setBridgeStatus('idle')} style={{
                width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
              }}>Retry</button>
            </div>
          )}

          {bridgeStatus === 'running' && (
            <div style={{
              padding: '10px', borderRadius: 8, background: 'rgba(155,89,182,0.1)',
              border: '1px solid rgba(155,89,182,0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9B59B6', animation: 'pulse 1s infinite' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#9B59B6' }}>Bridging...</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#777', maxHeight: 150, overflow: 'auto' }}>
                {bridgeLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          )}

          {bridgeStatus === 'done' && (
            <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
              All bridges mapped! Refresh the app.
            </div>
          )}

          {bridgeStatus === 'error' && (
            <div>
              <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
                Something went wrong
              </div>
              <button onClick={() => { setBridgeStatus('idle'); setBridgeLog([]); }} style={{
                width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
              }}>Try Again</button>
            </div>
          )}
        </div>

        {/* === QUEUE PROGRESS === */}
        <div style={{
          background: 'rgba(255,107,53,0.06)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(255,107,53,0.2)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#FF6B35' }}>Queue Progress</h3>
            <a href="/queue" style={{ fontSize: 11, color: '#FF6B35', textDecoration: 'none', fontWeight: 600 }}>View Queue &rarr;</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#FFA500' }}>{queueStats.total}</div>
              <div style={{ fontSize: 10, color: '#888' }}>In Queue</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#3498DB' }}>{queueStats.sent}</div>
              <div style={{ fontSize: 10, color: '#888' }}>Sent</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#00ff88' }}>{queueStats.accepted}</div>
              <div style={{ fontSize: 10, color: '#888' }}>Accepted</div>
            </div>
          </div>
        </div>

        {/* === NOTIFICATIONS === */}
        {notifications.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
            border: '1px solid rgba(255,255,255,0.08)',
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
                    <div style={{ fontSize: 12, fontWeight: 600, color: n.seen ? '#888' : '#fff' }}>{n.title}</div>
                    {n.message && <div style={{ fontSize: 10, color: '#666' }}>{n.message}</div>}
                  </div>
                  <span style={{ fontSize: 9, color: '#555', flexShrink: 0 }}>
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
          background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Tier Distribution</h3>
          {['S', 'A', 'B', 'C', 'D'].map(tier => {
            const count = s.tiers[tier] || 0;
            const pct = s.d1Count > 0 ? (count / s.d1Count * 100) : 0;
            return (
              <div key={tier} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span style={{ color: tierColors[tier], fontWeight: 600 }}>{tier}-Tier</span>
                  <span style={{ color: '#888' }}>{count} ({pct.toFixed(1)}%)</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: tierColors[tier], borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* === DEGREE-2 REACH === */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Degree-2 Reach</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#FF6B35' }}>{s.d2Count}</div>
              <div style={{ fontSize: 11, color: '#888' }}>People reachable via bridges</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#FFD700' }}>{s.d2Tiers.S}</div>
              <div style={{ fontSize: 11, color: '#888' }}>S-Tier degree-2</div>
            </div>
          </div>
        </div>

        {/* === MILESTONES === */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
            Milestones ({milestones.filter(m => m.done).length}/{milestones.length})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {milestones.map((m, i) => (
              <div key={i} style={{
                padding: '8px 10px', borderRadius: 8, fontSize: 12,
                background: m.done ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${m.done ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)'}`,
                color: m.done ? '#FFD700' : '#555',
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
          background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20, marginBottom: 24,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Top Companies in Your Network</h3>
          {s.topCompanies.map(([company, count], i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 0',
              borderBottom: i < s.topCompanies.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              fontSize: 12,
            }}>
              <span>{company}</span>
              <span style={{ color: '#888' }}>{count}</span>
            </div>
          ))}
        </div>

        {/* === SECTORS === */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 20,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>Your Sectors</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {profile.sectors.map((s, i) => (
              <span key={i} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: 'rgba(52,152,219,0.15)', border: '1px solid rgba(52,152,219,0.3)', color: '#3498DB',
              }}>{s}</span>
            ))}
          </div>
        </div>

      </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '14px 12px',
      border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#fff' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function SetupScrapeCard({ status, log, onStart, onRetry }) {
  return (
    <div style={{
      background: 'rgba(52,152,219,0.06)', borderRadius: 12, padding: 20, marginBottom: 24,
      border: '1px solid rgba(52,152,219,0.2)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#3498DB' }}>Account Setup</h3>
        {status === 'done' && <span style={{ fontSize: 10, color: '#00ff88', fontWeight: 600 }}>Complete</span>}
      </div>
      <p style={{ fontSize: 11, color: '#888', margin: '0 0 12px' }}>
        Full scrape of all your LinkedIn connections with profile photos. Takes 3-5 minutes.
      </p>

      {status === 'idle' && (
        <button onClick={onStart} style={{
          width: '100%', padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #3498DB, #9B59B6)',
          color: '#fff', fontWeight: 700, fontSize: 14,
        }}>
          Set Up Account — Full Scrape
        </button>
      )}

      {status === 'offline' && (
        <div>
          <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>
            Scraper server offline
          </div>
          <p style={{ fontSize: 10, color: '#888', textAlign: 'center', marginBottom: 8 }}>
            Double-click <strong>Start Scraper</strong> on your Desktop first
          </p>
          <button onClick={onRetry} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
          }}>Retry</button>
        </div>
      )}

      {status === 'running' && (
        <div style={{
          padding: '10px', borderRadius: 8, background: 'rgba(52,152,219,0.1)',
          border: '1px solid rgba(52,152,219,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3498DB', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#3498DB' }}>Scanning all connections...</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#888', maxHeight: 120, overflow: 'auto' }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {status === 'done' && (
        <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
          All connections scraped with images! Refresh the app to see your network.
        </div>
      )}

      {status === 'error' && (
        <div>
          <div style={{ padding: '10px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff5050', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
            Something went wrong
          </div>
          <button onClick={onRetry} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)', color: '#aaa', fontWeight: 600, fontSize: 12,
          }}>Try Again</button>
        </div>
      )}
    </div>
  );
}
