'use client';

import { TIER_COLORS_CLASSIC as TIER_COLORS } from '../../lib/tiers';

// How much of your 1st degree has had its circle opened.
//
// Three states, not two — and the distinction is the whole point. "Hidden"
// means that person keeps their connections private, so it will never move.
// Counting them as incomplete would mean the bar can never reach the end and
// would push someone to keep scraping at a network that has nothing left to
// give. A network whose every reachable circle is open reads as done here.

const BATCH = 25;

const BAR = { height: 10, borderRadius: 6 };
const CARD = {
  background: 'rgba(52,152,219,0.06)', borderRadius: 12, padding: 20, marginBottom: 24,
  border: '1px solid rgba(52,152,219,0.2)',
};

export function computeMapping(degree1 = [], degree2 = [], skips = []) {
  const mappedIds = new Set(degree2.map((c) => c.source_connection_id).filter(Boolean));
  const hiddenUrls = new Set(skips.map((s) => s.profileUrl).filter(Boolean));

  const state = (c) => {
    if (mappedIds.has(c.id)) return 'mapped';
    if (c.profile_url && hiddenUrls.has(c.profile_url)) return 'hidden';
    return 'todo';
  };

  const counts = { mapped: 0, hidden: 0, todo: 0 };
  const byTier = {};
  for (const c of degree1) {
    const s = state(c);
    counts[s] += 1;
    const t = c.tier || 'D';
    byTier[t] = byTier[t] || { mapped: 0, hidden: 0, todo: 0, total: 0 };
    byTier[t][s] += 1;
    byTier[t].total += 1;
  }

  const total = degree1.length;
  // Hidden is not failure, so it counts as resolved. Otherwise the bar can
  // never fill on any real network.
  const resolved = counts.mapped + counts.hidden;
  return {
    ...counts,
    total,
    resolved,
    percent: total ? Math.round((resolved / total) * 100) : 0,
    batches: Math.ceil(counts.todo / BATCH),
    byTier,
  };
}

export default function MappingProgress({ degree1 = [], degree2 = [], skips = [] }) {
  const m = computeMapping(degree1, degree2, skips);
  if (!m.total) return null;

  const pct = (n) => (m.total ? (n / m.total) * 100 : 0);
  const done = m.todo === 0;

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#3498DB' }}>
          2nd-degree mapping
        </h3>
        <span style={{ fontSize: 12, color: done ? '#00ff88' : '#8b9a9a', fontWeight: 600 }}>
          {done ? 'Everything reachable is mapped' : `${m.percent}%`}
        </span>
      </div>

      <div style={{ ...BAR, display: 'flex', overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct(m.mapped)}%`, background: '#00ff88' }} />
        <div style={{ width: `${pct(m.hidden)}%`, background: 'rgba(255,255,255,0.22)' }} />
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
        <Key color="#00ff88" label="mapped" value={m.mapped} />
        <Key color="rgba(255,255,255,0.35)" label="hidden" value={m.hidden} />
        <Key color="rgba(255,255,255,0.12)" label="to go" value={m.todo} />
        <span style={{ color: '#667', marginLeft: 'auto' }}>of {m.total}</span>
      </div>

      {m.hidden > 0 && (
        <p style={{ fontSize: 11.5, color: '#667', margin: '10px 0 0', lineHeight: 1.6 }}>
          Hidden means they keep their connections private — that will not change, and it
          does not count against you.
        </p>
      )}

      {!done && (
        <p style={{ fontSize: 11.5, color: '#8b9a9a', margin: '10px 0 0', lineHeight: 1.6 }}>
          {m.todo} left — about <b>{m.batches} {m.batches === 1 ? 'batch' : 'batches'}</b> of {BATCH}.
          Run one, leave it a while, run another. Long unbroken runs are what gets an
          account restricted.
        </p>
      )}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {['S', 'A', 'B', 'C', 'D']
          .filter((t) => m.byTier[t]?.total)
          .map((t) => {
            const row = m.byTier[t];
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                <span style={{ width: 14, color: TIER_COLORS[t], fontWeight: 700 }}>{t}</span>
                <div style={{
                  flex: 1, height: 5, borderRadius: 3, display: 'flex',
                  overflow: 'hidden', background: 'rgba(255,255,255,0.06)',
                }}>
                  <div style={{ width: `${(row.mapped / row.total) * 100}%`, background: TIER_COLORS[t] }} />
                  <div style={{ width: `${(row.hidden / row.total) * 100}%`, background: 'rgba(255,255,255,0.22)' }} />
                </div>
                <span style={{ color: '#667', width: 62, textAlign: 'right' }}>
                  {row.mapped}/{row.total}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function Key({ color, label, value }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b9a9a' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <b style={{ color: '#e2e8f0' }}>{value}</b> {label}
    </span>
  );
}
