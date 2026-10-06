'use client';

// Settings → Experimental: switches for things still being tried, each off
// until you turn it on, and kept in this browser (lib/strategy-client.js).
// The first is the strategy engine (lib/strategy-engine.js): a separate lens
// on your network that never changes a score, tier or ring.

import { useId, useSyncExternalStore } from 'react';
import { Section } from '../ui';
import { watchStrategy, strategyOnNow, strategyOnServer, setStrategyOn } from '../../../lib/strategy-client';

export default function ExperimentalSection() {
  const on = useSyncExternalStore(watchStrategy, strategyOnNow, strategyOnServer);
  const id = useId();
  return (
    <Section id="experimental" title="Experimental">
      <div data-strategy-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
        <input id={id} type="checkbox" checked={on} onChange={(e) => setStrategyOn(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
        <div style={{ minWidth: 0 }}>
          <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Strategy engine (experimental)
          </label>
          <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
            {/* Blake's hint, with brackets for its dashes (tests/no-em-dash.test.mjs) */}
            Ranks people by their position in your network (who gatekeeps whom), not just title and company. Experimental.
          </div>
          {on && (
            <div style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, marginTop: 6 }}>
              On: Degrees → Separation has a Gatekeepers list, and a connection&rsquo;s card says where they stand.
              Power, tiers, rings and dot sizes stay exactly as they are. Someone whose circle isn&rsquo;t scanned
              shows &ldquo;not enough data&rdquo;, never a low score.
            </div>
          )}
          <details style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.6, marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--sd-fg-2, #aab7c4)', fontWeight: 600 }}>How it ranks</summary>
            <div style={{ marginTop: 4, maxWidth: 640 }}>
              It draws your network as a graph from what scans already read: you to each connection, each connection to
              the people in their circle, and two of your connections who know each other. For each person it counts
              who you can reach only through them (take them away and those people are cut off), how often they sit
              on the shortest path between two others (betweenness), and how many industries and companies their
              circle spans. Leverage, 0 to 100, blends the three. Tier plays no part, so someone low-tier who is the
              only way to a whole company ranks high. Nothing is sent anywhere and no extra LinkedIn page is read.
            </div>
          </details>
        </div>
      </div>
    </Section>
  );
}
