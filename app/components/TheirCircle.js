'use client';

// Their circle, at the top of a profile card (Blake, 2026-09-28).
//
// The person in the middle; their scanned circle round them (D2); the people
// in it you connected with ringed in green, with their own circles fanning out
// behind them (D3), and so on out to D6. A request still out is a dotted dot.
// Each dot is coloured by its tier. Rarity (lib/rarity.js) is a filter beside
// the tier's rather than a mark on every dot (while it's counted from your
// scans, most people read as rare, and a ring on nearly everything says
// nothing): the two work together, so "S" and "Only way in" lights exactly the
// rare finds in this circle and dims the rest. Tap the map for the large one,
// where a dot opens that person's card.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { circleIndex, circleRings, circleLayout, requestedByDefault } from '../../lib/circle';
import { keyFor, routeIndex } from '../../lib/separation';
import { RARITY, rarityOf, passes, countByRarity, toggle, rarityInfo } from '../../lib/rarity';
import { scoreGuess } from '../../lib/score-guess';

const CLASSIC = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const GREEN = '#00ff88';

export default function TheirCircle({ person, connections = [], degree2 = [], tierColors = CLASSIC, onSelect, isRequested = requestedByDefault, canScan = true }) {
  const index = useMemo(() => circleIndex(connections, degree2), [connections, degree2]);
  const ways = useMemo(() => routeIndex(degree2), [degree2]);
  const { rings, totals } = useMemo(() => circleRings(person, index, { isRequested }), [person, index, isRequested]);
  const [tiers, setTiers] = useState(() => new Set());
  const [rarities, setRarities] = useState(() => new Set());
  const [big, setBig] = useState(false);

  // Each dot's tier and rarity. Your own connections have no rarity: you're
  // already in.
  const people = useMemo(() => rings.flatMap((ring) => ring.people.map((p) => {
    const yours = p.state === 'connected' || p.row.degree === 1;
    const r = yours ? null : rarityOf(p.row, ways.get(keyFor(p.row))?.size || 1);
    return { key: p.key, tier: p.row.tier, rarity: r?.key ?? null, mutuals: r };
  })), [rings, ways]);
  const facts = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const filter = useMemo(() => ({ tiers, rarities }), [tiers, rarities]);
  const shown = useMemo(() => people.filter((p) => passes(p, filter)).length, [people, filter]);

  // How complete the ways-in count is: circles scanned out of your connections.
  const scanned = useMemo(() => connections.filter((c) => index.circles.has(c.id)).length, [connections, index]);
  const fromLinkedIn = people.some((p) => p.mutuals?.from === 'linkedin');
  // A score the headline gave nothing to read for: say so, and point at the
  // scan, which is what can firm it up (lib/score-guess.js).
  const guess = useMemo(() => scoreGuess(person), [person]);

  if (!person) return null;
  // With the sample or a CSV import open there is no scan box below to point
  // at (Sidebar.js says why in its place), so this only says what is known.
  if (!rings.length) {
    const first = person.name?.split(' ')[0] || 'them';
    return (
      <div style={guess ? { ...box, borderColor: 'rgba(255,215,0,0.28)' } : box}>
        <Label>Their circle</Label>
        {guess ? (
          <>
            <div style={{ fontSize: 11.5, color: '#d8ccb0', lineHeight: 1.5, marginBottom: canScan ? 9 : 0 }}>
              <b style={{ color: '#FFD700' }}>Their score is a guess.</b> {guess.reason}
              {canScan && <> Scanning {first}&apos;s circle shows who you can reach through them, and a strong
                circle adds up to +2 to their score.</>}
            </div>
            {canScan && (
              <button type="button" onClick={toScanBox} style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                border: '1px solid rgba(255,215,0,0.4)', background: 'rgba(255,215,0,0.08)', color: '#FFD700',
              }}>
                Scan their circle ↓
              </button>
            )}
          </>
        ) : canScan ? (
          <div style={{ fontSize: 11, color: '#999', lineHeight: 1.5 }}>
            Not scanned yet. Scan {first}&apos;s circle below to see who they know, and
            everyone you reach through them after that.
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#999', lineHeight: 1.5 }}>Not scanned.</div>
        )}
      </div>
    );
  }

  const byTier = Object.fromEntries(TIERS.map((t) => [t, people.filter((p) => p.tier === t).length]));
  const byRarity = countByRarity(people);
  const filtering = tiers.size > 0 || rarities.size > 0;

  const chips = (
    <Filters
      tierColors={tierColors} byTier={byTier} byRarity={byRarity}
      tiers={tiers} rarities={rarities}
      onTier={(t) => setTiers((s) => toggle(s, t))} onRarity={(r) => setRarities((s) => toggle(s, r))}
      onClear={() => { setTiers(new Set()); setRarities(new Set()); }}
    />
  );
  const note = (
    <div style={{ fontSize: 9.5, color: '#777', lineHeight: 1.45, marginTop: 6 }}>
      Rarity is how many mutual connections lead to someone. It never changes a score.{' '}
      {fromLinkedIn
        ? 'LinkedIn’s own count where a scan saved it; otherwise the ways in from your scans.'
        : `Counted from the ${scanned} ${scanned === 1 ? 'circle' : 'circles'} you’ve scanned, so it can only go up as you scan more.`}
    </div>
  );

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Label>Their circle</Label>
        <button type="button" onClick={() => setBig(true)} style={linkButton} aria-label="Open the large map">
          Enlarge ⤢
        </button>
      </div>
      <button type="button" onClick={() => setBig(true)} aria-label={`${person.name}'s circle: open the large map`} style={{
        display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in',
      }}>
        <RingMap person={person} rings={rings} facts={facts} filter={filter} tierColors={tierColors} size={240} />
      </button>
      <RingCounts rings={rings} totals={totals} shown={filtering ? shown : null} />
      {chips}
      {note}
      {big && (
        <Enlarged onClose={() => setBig(false)} title={`${person.name}’s circle`}>
          <RingMap person={person} rings={rings} facts={facts} filter={filter} tierColors={tierColors} size={640} labels
            onPick={(row) => { setBig(false); onSelect?.(row); }} />
          <RingCounts rings={rings} totals={totals} shown={filtering ? shown : null} />
          {chips}
          <Legend />
          {note}
        </Enlarged>
      )}
    </div>
  );
}

function RingMap({ person, rings, facts, filter, tierColors, size, labels = false, onPick }) {
  const layout = useMemo(() => circleLayout(rings, size), [rings, size]);
  const c = layout.center;
  const k = size / 240;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ display: 'block', maxWidth: size, margin: '0 auto' }}
      role="img" aria-label={`${person.name}'s circle, ${rings.length} ${rings.length === 1 ? 'ring' : 'rings'}`}>
      {layout.rings.map((ring) => (
        <g key={ring.degree}>
          <circle cx={c.x} cy={c.y} r={ring.radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.6 * k} />
          <text x={c.x} y={c.y - ring.radius - ring.dotR - 3 * k} textAnchor="middle" fontSize={6.5 * k} fill="#666" fontWeight={700}>
            D{ring.degree}
          </text>
        </g>
      ))}
      {layout.spokes.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(0,255,136,0.35)" strokeWidth={0.7 * k} />
      ))}
      {layout.rings.map((ring) => ring.items.map((it) => {
        const f = facts.get(it.key);
        const on = passes(f, filter);
        const color = tierColors[it.row.tier] || '#888';
        const r = it.state === 'connected' ? ring.dotR * 1.7 : ring.dotR;
        const tip = [
          `${it.row.name} · ${it.row.tier}-tier${it.row.power_score != null ? ` · ${Number(it.row.power_score).toFixed(1)}` : ''}`,
          it.state === 'connected' ? 'You added them' : it.state === 'requested' ? 'Request sent' : null,
          f?.mutuals ? `${rarityInfo(f.rarity)?.label}: ${f.mutuals.count} mutual${f.mutuals.count === 1 ? '' : 's'}${f.mutuals.from === 'scans' ? ' (from your scans)' : ''}` : null,
        ].filter(Boolean).join('\n');
        return (
          <g key={it.key} opacity={on ? 1 : 0.12} style={onPick ? { cursor: 'pointer' } : undefined}
            onClick={onPick ? (e) => { e.stopPropagation(); onPick(it.row); } : undefined}>
            <title>{tip}</title>
            {it.state === 'requested' ? (
              <circle cx={it.x} cy={it.y} r={r * 1.25} fill="none" stroke={color} strokeWidth={Math.max(0.5, r * 0.45)}
                strokeDasharray={`${Math.max(0.6, r * 0.55)} ${Math.max(0.5, r * 0.45)}`} />
            ) : (
              <circle cx={it.x} cy={it.y} r={r} fill={color}
                stroke={it.state === 'connected' ? GREEN : 'none'} strokeWidth={Math.max(0.6, r * 0.3)} />
            )}
            {labels && it.state === 'connected' && (
              <text x={it.x} y={it.y - r - 3} textAnchor="middle" fontSize={9} fill={GREEN} fontWeight={700}>
                {String(it.row.name || '').split(' ')[0]}
              </text>
            )}
          </g>
        );
      }))}
      <circle cx={c.x} cy={c.y} r={7 * k} fill={tierColors[person.tier] || '#888'} stroke="#fff" strokeWidth={0.8 * k} />
      <text x={c.x} y={c.y + 2.4 * k} textAnchor="middle" fontSize={6.5 * k} fontWeight={800} fill={person.tier === 'S' ? '#000' : '#fff'}>
        {String(person.name || '?').charAt(0)}
      </text>
    </svg>
  );
}

function RingCounts({ rings, totals, shown }) {
  return (
    <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 6, lineHeight: 1.5 }}>
      {rings.map((r) => `D${r.degree} ${r.people.length.toLocaleString('en-US')}`).join(' · ')}
      {totals.connected > 0 && <span style={{ color: GREEN }}> · you added {totals.connected}</span>}
      {totals.requested > 0 && <span style={{ color: '#FFD700' }}> · {totals.requested} {totals.requested === 1 ? 'request' : 'requests'} out</span>}
      {shown != null && <span style={{ color: '#fff' }}> · {shown.toLocaleString('en-US')} shown</span>}
    </div>
  );
}

function Filters({ tierColors, byTier, byRarity, tiers, rarities, onTier, onRarity, onClear }) {
  const chip = (on, color) => ({
    height: 22, padding: '0 7px', borderRadius: 11, cursor: 'pointer', fontSize: 10, fontWeight: 700,
    whiteSpace: 'nowrap', border: `1px solid ${on ? color : 'rgba(255,255,255,0.1)'}`,
    background: on ? `${color}22` : 'rgba(255,255,255,0.03)', color: on ? color : '#999',
  });
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <span style={rowLabel}>Tier</span>
        {TIERS.map((t) => (
          <button key={t} type="button" aria-pressed={tiers.has(t)} onClick={() => onTier(t)} style={chip(tiers.has(t), tierColors[t] || '#888')}>
            {t} <span style={{ fontWeight: 500, opacity: 0.8 }}>{byTier[t]}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <span style={rowLabel}>Rarity</span>
        {RARITY.map((r) => (
          <button key={r.key} type="button" aria-pressed={rarities.has(r.key)} onClick={() => onRarity(r.key)}
            title={`${r.label}: ${r.range} mutual connection${r.range === '1' ? '' : 's'}`} style={chip(rarities.has(r.key), r.color)}>
            {r.label} <span style={{ fontWeight: 500, opacity: 0.8 }}>{byRarity[r.key]}</span>
          </button>
        ))}
        {(tiers.size > 0 || rarities.size > 0) && (
          <button type="button" onClick={onClear} style={linkButton}>Clear</button>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const item = (swatch, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 12, whiteSpace: 'nowrap' }}>{swatch}{text}</span>
  );
  return (
    <div style={{ fontSize: 10.5, color: '#999', marginTop: 8, lineHeight: 1.8 }}>
      {item(<svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#FFD700" /></svg>, 'colour = tier')}
      {item(<svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="#9B59B6" stroke={GREEN} strokeWidth="1.5" /></svg>, 'you added them')}
      {item(<svg width="12" height="12"><circle cx="6" cy="6" r="4.2" fill="none" stroke="#3498DB" strokeWidth="1.4" strokeDasharray="2 1.6" /></svg>, 'request sent')}
    </div>
  );
}

// Rendered into <body>, not the card: the side panel's backdrop blur makes it
// the containing block for anything position: fixed inside it, so an overlay
// there only ever covered the panel. Fixed, so it can't change the page's
// size (TRAPS §29).
function Enlarged({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(720px, 100%)', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
        background: '#0f0c05', border: '1px solid rgba(255,215,0,0.18)', borderRadius: 14, padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{title}</div>
          <button type="button" onClick={onClose} style={{ ...linkButton, fontSize: 12 }}>Close ✕</button>
        </div>
        <div style={{ fontSize: 10.5, color: '#888', marginBottom: 8 }}>Click a dot to open that person.</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The card's scan box (Sidebar.js CreateClusterCard, id "scan-box"): bring it
// into view, flash it, and put the keyboard on its button.
function toScanBox() {
  const scanBox = document.getElementById('scan-box');
  if (!scanBox) return;
  scanBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  scanBox.animate?.([{ boxShadow: '0 0 0 3px rgba(255,215,0,0.75)' }, { boxShadow: '0 0 0 0 rgba(255,215,0,0)' }], { duration: 1600 });
  scanBox.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}

function Label({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: '#FF6B35', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{children}</div>;
}

const box = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 10, padding: 10, marginBottom: 16,
};
const rowLabel = { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, width: 38, flexShrink: 0 };
const linkButton = { background: 'none', border: 'none', color: '#888', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', padding: 0 };
