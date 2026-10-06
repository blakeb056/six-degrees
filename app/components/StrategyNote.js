'use client';

// The strategy engine's line on a profile card (experimental): where this
// person stands in your network, and why, in one or two lines. Nothing at all
// while the engine is off. Someone with no measured position says not enough
// data, never a low number (TRAPS §7).

import useStrategy from './useStrategy';
import { keyFor } from '../../lib/separation';
import { whyLine, gatekeeperLine } from '../../lib/strategy-engine';
import { GATE } from './GatekeeperList';

export default function StrategyNote({ person }) {
  const strategy = useStrategy();
  if (!strategy.on || !person) return null;
  const box = {
    border: `1px solid ${GATE}40`, background: `${GATE}0d`, borderRadius: 8, padding: '9px 11px', marginBottom: 14,
    fontSize: 11.5, lineHeight: 1.5, color: 'var(--sd-fg-2, #ccd)',
  };
  const head = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: GATE }}>POSITION</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--sd-gold, #FFD700)' }}>Experimental</span>
    </div>
  );
  if (strategy.error) return <div data-strategy-note="" style={box}>{head}The strategy engine couldn&rsquo;t read your network: {strategy.error}</div>;
  if (strategy.loading) return <div data-strategy-note="" style={box}>{head}Working out where they stand…</div>;
  const e = strategy.people?.[keyFor(person)];
  const gate = gatekeeperLine(e);
  return (
    <div data-strategy-note="" style={box}>
      {head}
      {gate && <div style={{ fontWeight: 700, color: GATE }}>{gate}</div>}
      <div>{whyLine(e)}</div>
      {e?.status === 'measured' && (
        <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--sd-fg-4, #889)' }}>
          Leverage <b style={{ color: GATE }}>{e.leverage}</b> of 100 · #{e.rank.toLocaleString('en-US')} of {strategy.measured.toLocaleString('en-US')} ranked · position only, power unchanged
        </div>
      )}
    </div>
  );
}
