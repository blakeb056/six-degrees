'use client';

// A circle's people drawn in rings by tier (lib/chain-layout.js tierRings): S
// nearest the core and biggest, then A, B and C, D furthest out, small and
// muted. One drawing for every circle Bridge Chains and Degrees show this way
// (Blake, 2026-10-17: "We need to copy the original UI of how we're doing
// everything else in the bridge, it needs to be all the same"):
//
// - Bridge Chains' dive, a circle full size (CircleFocus.js CircleDive)
// - its focus on a circle seen outside the scan only (CircleFocus.js FocusMap)
// - Degrees' Unscanned overview, everyone whose circle is still to do, and a
//   circle built there once it settles (UnscannedView.js)
//
// Bridge Chains' own language: a tier-coloured dot with their photo or initial
// (NodeFace), a faint band of the tier's colour behind its rings (TierBands),
// the tier's letter in the room before its band (TierLetters), first names
// under S and A once they fit, a green ring on whoever you added. Every line
// here is solid: the dotted guide rings and the dotted line across the circle
// are gone ("those dotted lines across the circle need to go").

import { memo } from 'react';
import { localPhoto } from '../../lib/photos';
import { TIER_COLORS } from '../../lib/themes';

const GREEN = 'var(--sd-green, #00ff88)';
const NAMED = Object.freeze(['S', 'A']);
// How far apart on screen a band's dots must be before their names show under them.
export const NAME_ROOM = 34;

/**
 * A person's dot on an overview: in their tier's colour, with their photo or
 * initial. Bridge Chains draws each bridge with it, Degrees' Unscanned view
 * each connection not scanned yet, and tier rings everyone in them. `r` is its
 * radius (11 at full size, 13 hovered); `scale` shrinks everything else with
 * it, for a ring that has closed up.
 */
export function NodeFace({ row, x, y, r, hov = false, clipId, scale = 1, bare = false }) {
  // `bare`: too small for a photo or a letter to read, so just the dot.
  const photo = bare ? null : localPhoto(row.profile_image_url);
  const inset = r - 2 * scale;
  return (
    <>
      <circle className="sd-dot" cx={x} cy={y} r={r}
        fill={photo ? '#1a1a2e' : TIER_COLORS[row.tier]}
        stroke={hov ? 'var(--sd-fg-1, #fff)' : TIER_COLORS[row.tier]}
        strokeWidth={(hov ? 2.5 : 2) * scale} />
      {photo && (
        <>
          <clipPath id={clipId}><circle cx={x} cy={y} r={inset} /></clipPath>
          <image href={photo} x={x - inset} y={y - inset} width={inset * 2} height={inset * 2} clipPath={`url(#${clipId})`} />
        </>
      )}
      {!photo && !bare && (
        <text x={x} y={y + 4 * scale} textAnchor="middle" fill={row.tier === 'S' ? '#000' : 'var(--sd-fg-1, #fff)'}
          fontSize={11 * scale} fontWeight={700}>{row.name?.charAt(0)}</text>
      )}
    </>
  );
}

/** The soft breathing halo on someone ready for a circle scan. Still when Reduce Motion is on. */
export function Halo({ x, y, r, still }) {
  return (
    <circle cx={x} cy={y} r={r} fill="#00ff88" fillOpacity={0.16} stroke="#00ff88" strokeWidth={0.8} strokeOpacity={0.45} pointerEvents="none">
      {!still && <animate attributeName="fill-opacity" values="0.06;0.24;0.06" dur="2.8s" repeatCount="indefinite" />}
      {!still && <animate attributeName="stroke-opacity" values="0.25;0.7;0.25" dur="2.8s" repeatCount="indefinite" />}
    </circle>
  );
}

const first = (row) => String(row?.name || '').trim().split(/\s+/)[0] || '';
const tierOf = (row) => (TIER_COLORS[row?.tier] ? row.tier : 'D');

/**
 * Behind the dots: a faint band of each tier's colour over its rings. `k` is
 * the zoom the layer is drawn at, so the lines stay a hair wide.
 */
export function TierBands({ layout, cx = 0, cy = 0, k = 1 }) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {layout.bands.map((b) => (
        <circle key={'band-' + b.tier} cx={cx} cy={cy} r={(b.inner + b.outer) / 2} fill="none"
          stroke={TIER_COLORS[b.tier] || 'var(--sd-fg-5, #555)'} strokeOpacity={0.075 * (0.4 + 0.6 * b.fade)}
          strokeWidth={Math.max(1 / k, b.outer - b.inner + b.spacing)} />
      ))}
    </g>
  );
}

// A band's letter: its size, fitted to the room before the band and never past
// 11 px on screen at zoom `k`; and half its width with the count.
const letterSize = (b, k = 1) => Math.min(11 / k, Math.max(6, (b.inner - b.dot - b.label) * 1.5));
const letterHalf = (b, k = 1) => letterSize(b, k) * (1 + 0.62 * String(b.count).length) * 0.5 + 2;

/**
 * Over the dots: each tier's letter and how many, in the room before its band,
 * at the top, so the rings read S, A, B, C, D from the middle out. TierDots
 * keeps the names under the dots clear of them.
 */
export function TierLetters({ layout, cx = 0, cy = 0, k = 1 }) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {layout.bands.map((b) => {
        const size = letterSize(b, k);
        return (
          <text key={'letter-' + b.tier} x={cx} y={cy - b.label + size * 0.36} textAnchor="middle" fontSize={size} fontWeight={800}
            fill={TIER_COLORS[b.tier] || 'var(--sd-fg-3, #999)'} fillOpacity={0.6 + 0.4 * b.fade}
            stroke="var(--sd-bg, #0a0a1a)" strokeWidth={size * 0.36} paintOrder="stroke">
            {b.tier}<tspan fontWeight={600} fillOpacity={0.8} dx={size * 0.3}>{b.count.toLocaleString('en-US')}</tspan>
          </text>
        );
      })}
    </g>
  );
}

/**
 * The dots of a tier-ring layout, centred on (cx, cy), and their names.
 * `rows[i]` sits at `layout.points[i]`. `mark(row, i)` says what else a dot
 * carries: { added } a green ring (you added them, or their circle is scanned
 * too), { seen } drawn lighter (seen outside the scan), { asked } hollow (a
 * request is out), { glow } the soft green halo (ready to scan; still with
 * `still`), { label } a name to show whatever the room. Names go under S and
 * A once their band has the room at zoom `k`, at a size that reads there, and
 * under everyone zoomed in further. Each dot is a group with `data-i`, for a
 * pointer handler on a parent. The dots don't depend on the zoom, so zooming
 * redraws only the names (a thousand dots, each with a face, stay put).
 */
export function TierDots({ rows, layout, cx = 0, cy = 0, k = 1, mark = null, named = NAMED, ids = 'tr', still = false }) {
  return (
    <g>
      <DotLayer rows={rows} layout={layout} cx={cx} cy={cy} mark={mark} ids={ids} still={still} />
      <NameLayer rows={rows} layout={layout} cx={cx} cy={cy} k={k} mark={mark} named={named} />
    </g>
  );
}

const DotLayer = memo(function DotLayer({ rows, layout, cx, cy, mark, ids, still }) {
  const fade = new Map(layout.bands.map((b) => [b.tier, b.fade]));
  return (
    <g>
      {rows.map((row, i) => {
        const p = layout.points[i];
        if (!p) return null;
        const m = mark ? mark(row, i) || {} : {};
        const x = cx + p.x;
        const y = cy + p.y;
        const r = p.r;
        const colour = TIER_COLORS[row.tier] || '#8899aa';
        const bare = r < 6;
        return (
          <g key={row.id ?? i} data-i={i} opacity={(fade.get(p.tier) ?? 1) * (m.seen ? 0.55 : 1)}>
            {m.glow && <Halo x={x} y={y} r={r * 2.1} still={still} />}
            {!bare && <circle cx={x} cy={y} r={r * 1.6} fill={colour} fillOpacity={0.06} pointerEvents="none" />}
            {m.asked ? (
              <circle className="sd-dot" cx={x} cy={y} r={r} fill="var(--sd-bg, #0a0a1a)" fillOpacity={0.6} stroke={colour} strokeWidth={Math.max(1, r * 0.34)} />
            ) : (
              <NodeFace row={row} x={x} y={y} r={r} scale={r / 11} clipId={`${ids}-${i}`} bare={bare} />
            )}
            {m.added && <circle cx={x} cy={y} r={r + Math.max(1.4, r * 0.22)} fill="none" stroke={GREEN} strokeWidth={Math.max(1, r * 0.2)} pointerEvents="none" />}
          </g>
        );
      })}
    </g>
  );
});

const NameLayer = memo(function NameLayer({ rows, layout, cx, cy, k, mark, named }) {
  // S and A named once they fit; zoomed in far enough, everyone.
  const roomy = new Set(layout.bands.filter((b) => b.spacing * k >= (named.includes(b.tier) ? NAME_ROOM : NAME_ROOM * 2)).map((b) => b.tier));
  const band = new Map(layout.bands.map((b) => [b.tier, b]));
  // A name under a dot at the top of its band's first ring would sit on the
  // band's letter (TierLetters): left off, or, a catalyst's, put above the dot.
  const underLetter = (p, name) => {
    const b = band.get(p.tier);
    return Boolean(b) && p.y < 0 && Math.abs(Math.hypot(p.x, p.y) - b.inner) < 0.5
      && Math.abs(p.x) < letterHalf(b, k) + (name.length * 5.4) / k / 2 + 2;
  };
  const names = [];
  rows.forEach((row, i) => {
    const p = layout.points[i];
    if (!p) return;
    const m = mark ? mark(row, i) || {} : {};
    const said = m.label || (roomy.has(tierOf(row)) ? first(row) : '');
    if (!said) return;
    const clash = underLetter(p, said);
    if (clash && !m.label) return;
    const x = cx + p.x;
    const y = cy + p.y;
    names.push(
      <text key={row.id ?? i} x={x} y={clash ? y - p.r - 4 / k : y + p.r + 10 / k} textAnchor="middle" fontSize={9 / k} fontWeight={m.label ? 700 : 600}
        fill={m.added ? GREEN : 'var(--sd-fg-1, #fff)'} fillOpacity={m.seen ? 0.7 : 1} stroke="var(--sd-bg, #0a0a1a)" strokeWidth={2.4 / k} paintOrder="stroke">
        {said}
      </text>,
    );
  });
  return <g pointerEvents="none">{names}</g>;
});

/** Under a tier-ring circle: each tier's dot, letter and count, as the rest of Bridge Chains says them. */
export function TierCounts({ rows, extra = null, style }) {
  const counts = ['S', 'A', 'B', 'C', 'D'].map((t) => [t, rows.filter((r) => tierOf(r) === t).length]).filter(([, n]) => n);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 10.5, color: 'var(--sd-fg-3, #aab)', ...style }}>
      {counts.map(([t, n]) => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLORS[t], boxShadow: `0 0 6px ${TIER_COLORS[t]}66`, opacity: t === 'D' ? 0.6 : 1 }} />
          <span style={{ color: TIER_COLORS[t], fontWeight: 700 }}>{t}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('en-US')}</span>
        </span>
      ))}
      {extra}
    </div>
  );
}
