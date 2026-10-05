'use client';

// Network health, Profile → ✦ Insights → Health (lib/network-health.js; it was on the Scores tab): how much of your
// 2nd degree you reach two or more ways, the effective size of your own
// network from the ties scans have kept, and your top five connections by who
// only they reach. Only your own numbers, never a percentile against others.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../UserProvider';
import { loadNetwork } from '../../../lib/network';
import { networkHealth } from '../../../lib/network-health';
import { Body, LINE } from '../ui';
import { TIER_COLORS as THEME_TIERS } from '../../../lib/themes';

const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
const pct = (x) => `${Math.round(x * 100)}%`;

/** `titled`: its own heading, or none under a board's title (the Health board). */
export default function NetworkHealthSection({ titled = true }) {
  const { userId } = useUser();
  const [health, setHealth] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    loadNetwork(userId)
      .then((net) => { if (live) setHealth(networkHealth(net)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [userId]);

  const box = { padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)' };
  return (
    <section id="health" style={{ marginTop: titled ? 20 : 0 }}>
      {titled && <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Network health</h2>}
      {failed && <Body>Couldn&rsquo;t read your network just now.</Body>}
      {!failed && !health && <Body>Reading your network…</Body>}
      {health && health.circles === 0 && (
        <Body>Scan a few of your connections&rsquo; circles (the Scan page, step 4) and this shows how your network holds together.</Body>
      )}
      {health && health.circles > 0 && (
        <>
          {health.early && (
            <div style={{ fontSize: 12.5, color: 'var(--sd-gold, #FFD700)', margin: '4px 0 10px' }}>
              An early estimate: {health.circles} {health.circles === 1 ? 'circle' : 'circles'} scanned. These get sharper as you scan more.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div style={box}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{pct(health.twoWays)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)' }}>of your 2nd degree you reach two or more ways</div>
              <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #778)', marginTop: 4 }}>Higher is safer: lose one connection and they&rsquo;re still reachable.</div>
            </div>
            <div style={box}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{Math.round(health.effective.size).toLocaleString()}</div>
              <div style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)' }}>
                effective reach of your {health.effective.n.toLocaleString()} connections ({pct(health.effective.efficiency)} non-overlapping)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #778)', marginTop: 4 }}>
                From {health.effective.ties.toLocaleString()} {health.effective.ties === 1 ? 'tie' : 'ties'} between your connections seen in circle scans so far,
                so it can only come down as you scan more.
              </div>
            </div>
          </div>
          {health.top.length > 0 && (
            <div style={{ ...box, marginTop: 10, padding: 0 }}>
              <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', borderBottom: LINE }}>Your connections who reach the most people no one else does</div>
              {health.top.map((b, k) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: k < health.top.length - 1 ? '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)' : 'none', fontSize: 13 }}>
                  <span style={{ width: 22, color: 'var(--sd-fg-4, #778)' }}>#{k + 1}</span>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[b.tier] || '#667', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{b.name}</b>{b.company ? <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}> · {b.company}</span> : null}
                  </span>
                  <span style={{ color: 'var(--sd-fg-2, #b8c4c4)', whiteSpace: 'nowrap' }}>{b.circle.toLocaleString()} in circle</span>
                  <span style={{ color: 'var(--sd-green, #00ff88)', whiteSpace: 'nowrap' }}>{b.only.toLocaleString()} only them ({pct(b.share)})</span>
                  <Link href={`/?chain=${encodeURIComponent(b.id)}`} style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Explore →</Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
