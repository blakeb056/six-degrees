'use client';

// Breach's picture (Blake, 2026-10-15): the company as an orb at the centre,
// its people on seniority rings, the top seats at the top, and a line into the
// orb for everyone inside. The orb glows brighter as the breach grows. Plus the
// breach meter ("Breach 62 · highest seat VP Sales") and its milestones.
//
// Drawn from lib/breach.js breachPeople and breachScore; it only reads.

import { SEATS, ringOf, meterLine } from '../../lib/breach';

const W = 760;
const H = 430;
const CX = 440;            // the rings sit right of centre, their names in the gutter on the left
const ORB = { x: CX, y: 222, r: 30 };
const MOST_PER_RING = 44;  // more than this on one ring are counted, not drawn

/** Each ring, top seat first: an ellipse narrowing towards the top. */
const RINGS = SEATS.map((s, i) => ({ ...s, cy: 72 + i * 58, rx: 84 + i * 38, ry: (84 + i * 38) * 0.2 }));

export const BAND_COLORS = Object.freeze({
  doors: 'var(--sd-green, #00ff88)',
  climb: 'var(--sd-purple, #9B59B6)',
  summit: 'var(--sd-gold, #FFD700)',
});

const order = (p) => (p.inside ? 0 : p.requested ? 1 : p.band === 'doors' ? 2 : p.band === 'climb' ? 3 : 4);

/** Angles round an ellipse, the front (its lowest point) first, then out to either side. */
function angleAt(k, n) {
  if (n <= 1) return Math.PI / 2;
  const step = (2 * Math.PI) / n;
  const side = k % 2 ? 1 : -1;
  return Math.PI / 2 + side * Math.ceil(k / 2) * step;
}

function placed(people) {
  const rings = new Map(RINGS.map((r) => [r.key, []]));
  for (const p of people) {
    if (p.employment !== 'current') continue;
    rings.get(ringOf(p.seat.level))?.push(p);
  }
  const dots = [];
  const extra = {};
  for (const ring of RINGS) {
    const all = rings.get(ring.key).sort((a, b) => order(a) - order(b) || b.odds - a.odds);
    const shown = all.slice(0, MOST_PER_RING);
    extra[ring.key] = { total: all.length, inside: all.filter((p) => p.inside).length, hidden: all.length - shown.length };
    shown.forEach((p, k) => {
      const a = angleAt(k, shown.length);
      dots.push({ p, x: CX + ring.rx * Math.cos(a), y: ring.cy + ring.ry * Math.sin(a), front: Math.sin(a) >= 0 });
    });
  }
  return { dots, extra };
}

function Dot({ d }) {
  const { p } = d;
  const status = p.inside ? (p.accepted ? 'inside, accepted your request' : 'inside') : p.requested ? 'request out' : p.band;
  const title = `${p.name}${p.seat.title ? ` · ${p.seat.title}` : ''} · ${status}`;
  if (p.inside) {
    return <circle cx={d.x} cy={d.y} r={6} style={{ fill: BAND_COLORS.doors, stroke: 'var(--sd-page, #0b0f14)', strokeWidth: 1.5 }}><title>{title}</title></circle>;
  }
  if (p.requested) {
    return <circle cx={d.x} cy={d.y} r={4.5} style={{ fill: 'none', stroke: BAND_COLORS.summit, strokeWidth: 1.6, strokeDasharray: '2 2' }}><title>{title}</title></circle>;
  }
  return <circle cx={d.x} cy={d.y} r={3.4} style={{ fill: BAND_COLORS[p.band], opacity: d.front ? 0.75 : 0.4 }}><title>{title}</title></circle>;
}

/** The picture: rings, dots, and a line into the orb for each person inside. */
export default function BreachOrb({ people = [], company, score = 0 }) {
  const { dots, extra } = placed(people);
  const glow = 0.25 + Math.min(100, Math.max(0, score)) / 100 * 0.75;
  const inside = dots.filter((d) => d.p.inside);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${company}: people by seat, ${inside.length} inside`}
      style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <radialGradient id="breach-orb" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
          <stop offset="45%" stopColor="#00ff88" stopOpacity={glow} />
          <stop offset="100%" stopColor="#0b3d2a" stopOpacity={0.9} />
        </radialGradient>
        <radialGradient id="breach-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00ff88" stopOpacity={0.35 * glow} />
          <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
        </radialGradient>
      </defs>
      {RINGS.map((ring) => {
        const e = extra[ring.key];
        return (
          <g key={ring.key}>
            <ellipse cx={CX} cy={ring.cy} rx={ring.rx} ry={ring.ry}
              style={{ fill: 'none', stroke: 'rgba(var(--sd-ink, 255, 255, 255), 0.14)', strokeWidth: 1 }} />
            <text x={8} y={ring.cy + 4} style={{ fill: 'var(--sd-fg-3, #888)', fontSize: 12, fontWeight: 600 }}>{ring.label}</text>
            <text x={8} y={ring.cy + 19} style={{ fill: 'var(--sd-fg-4, #666)', fontSize: 11 }}>
              {e.inside}/{e.total} inside{e.hidden ? ` · +${e.hidden} more` : ''}
            </text>
          </g>
        );
      })}
      {inside.map((d) => (
        <line key={`l-${d.p.key}`} x1={d.x} y1={d.y} x2={ORB.x} y2={ORB.y}
          style={{ stroke: BAND_COLORS.doors, strokeWidth: 1.3, opacity: 0.55 }} />
      ))}
      {dots.filter((d) => !d.front).map((d) => <Dot key={d.p.key} d={d} />)}
      <circle cx={ORB.x} cy={ORB.y} r={ORB.r * 2.4} fill="url(#breach-halo)" />
      <circle cx={ORB.x} cy={ORB.y} r={ORB.r} fill="url(#breach-orb)" style={{ stroke: 'rgba(0,255,136,0.6)', strokeWidth: 1.2 }} />
      <text x={ORB.x} y={ORB.y + 5} textAnchor="middle" style={{ fill: '#04130c', fontSize: 15, fontWeight: 800 }}>{score}</text>
      {dots.filter((d) => d.front).map((d) => <Dot key={d.p.key} d={d} />)}
      <text x={ORB.x} y={H - 6} textAnchor="middle" style={{ fill: 'var(--sd-fg-2, #ccc)', fontSize: 13, fontWeight: 700 }}>{company}</text>
    </svg>
  );
}

/** The breach meter: the score as a bar, and its line. */
export function BreachMeter({ s }) {
  const pct = Math.min(100, Math.max(0, s?.score ?? 0));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--sd-fg-1, #fff)' }}>{meterLine(s)}</span>
        <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #888)' }}>
          {s.inside} inside{s.accepted ? ` (${s.accepted} accepted a request)` : ''} · {s.known} more known there
        </span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Breach"
        style={{ height: 10, borderRadius: 6, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: 'linear-gradient(90deg, #00ff88, #FFD700)' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--sd-fg-4, #6f7a88)', marginTop: 5 }}>
        Mapping counts a little ({s.mapped} of 10). Each person inside counts by their seat: IC 3, manager 6, director 10,
        VP 22, C-suite or founder 34, and a second at the same seat half as much.
      </div>
    </div>
  );
}

/** First door, first director, first VP, first C-suite: lit once reached, with who reached it. */
export function Milestones({ list = [] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {list.map((m) => (
        <span key={m.key} title={m.who ? `${m.who.name}${m.who.title ? `, ${m.who.title}` : ''}` : 'Not yet'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            border: `1px solid ${m.reached ? 'rgba(0,255,136,0.45)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.14)'}`,
            color: m.reached ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-4, #6f7a88)',
            background: m.reached ? 'rgba(0,255,136,0.08)' : 'transparent',
          }}>
          <span aria-hidden="true">{m.reached ? '✓' : '○'}</span>
          {m.label}{m.who ? <span style={{ fontWeight: 500, color: 'var(--sd-fg-2, #ccc)' }}>{m.who.name}</span> : null}
        </span>
      ))}
    </div>
  );
}
