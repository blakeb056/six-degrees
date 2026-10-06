'use client';

// The Scan page's radar (Blake, 2026-10-02: "making the scan button more
// gamified, having the slow medium high scan option"). A round Scan button in
// the middle, the last 24 hours' searches against the budget round the edge,
// and beside it the three speeds with what each means for the rest of the
// budget. Speed only changes searches an hour (lib/scan-pace.js); the daily
// budget is still the cap.
//
// While a scan runs the Scan button is a hub and the people it finds gather
// round it as a cluster, as the map draws one (Blake, 2026-10-03: "for the
// scanner its a cluster and shows the dots building every page adds to the
// ring so it fits our theme and style"): a dot for each person each page
// found, filling the rings from the inside out, each page's batch in the next
// of the theme's gold, purple and blue (the header's dots, page for page). Only
// what the scanner has said: how many each page found, nothing about who.

import { useSyncExternalStore } from 'react';
import { PACES, PACE_NAMES, paceOf, paceSeconds, searchesPerHour, durationText } from '../../lib/scan-pace';
import { ringLayout } from '../../lib/chain-layout';
import { TIER_COLORS } from '../../lib/themes';
import { watchScanner, scannerNow, SCANNER_UNKNOWN } from '../../lib/scraper-client';

const SIZE = 236;
const C = SIZE / 2;
const CSS = `
@keyframes clusterTurn { to { transform: rotate(360deg); } }
@keyframes clusterIn { from { opacity: 0; transform: scale(0.2); } }
@keyframes clusterHub { 0%, 100% { opacity: .35; } 50% { opacity: .8; } }
.cluster-turn { transform-origin: ${C}px ${C}px; animation: clusterTurn 90s linear infinite; }
.cluster-dot { transition: transform .6s cubic-bezier(.2,.8,.2,1); transform-box: fill-box; }
.cluster-dot.fresh circle { animation: clusterIn .45s cubic-bezier(.2,.9,.3,1.3) both; transform-box: fill-box; transform-origin: center; }
.cluster-hub { animation: clusterHub 1.8s ease-in-out infinite; }
.radar-go { transition: transform .15s ease, box-shadow .2s ease; }
.radar-go:not(:disabled):hover { transform: scale(1.04); box-shadow: 0 0 34px rgba(0,255,136,.45); }
.radar-go:not(:disabled):active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) { .cluster-turn, .cluster-dot.fresh circle, .cluster-hub { animation: none; } .cluster-dot { transition: none; } }
`;

// Past this many, the newest are drawn and the count says the rest.
const MAX_DOTS = 420;
const INNER = 72;   // the first ring, just clear of the Scan button

function arc(r, from, to) {
  const p = (a) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return `M${p(from)} A${r} ${r} 0 ${large} 1 ${p(to)}`;
}

/** Where each person found so far sits round the hub, and which page found them. */
function clusterDots(found, R) {
  const total = found.reduce((a, b) => a + b, 0);
  const n = Math.min(total, MAX_DOTS);
  if (!n) return { dots: [], total };
  const page = [];
  for (let i = found.length - 1; i >= 0 && page.length < n; i--) for (let k = 0; k < found[i] && page.length < n; k++) page.push(i);
  page.reverse();   // oldest first, so they take the inner rings
  const { points } = ringLayout(n, { inner: INNER, outer: R - 8, spacing: 9, minSpacing: 3.2 });
  const last = found.length - 1;
  return { dots: points.map((pt, i) => ({ x: C + pt.x, y: C + pt.y, page: page[i], fresh: page[i] === last })), total };
}

export default function ScanRadar({ li, running, scanning, disabled, label, sublabel, onScan, onPace }) {
  const scan = useSyncExternalStore(watchScanner, scannerNow, () => SCANNER_UNKNOWN);
  const found = running ? scan.found || [] : [];
  const pace = li?.limits?.pace || 'fast';
  const daily = li?.limits?.daily || 0;
  // Lifted for this session (lib/limits-lift.js): no limit to count against.
  const lifted = li?.lifted === true;
  const used = li?.unreadable ? daily : li?.searchesToday || 0;
  const left = daily && !lifted ? Math.max(0, daily - used) : null;
  const share = daily && !lifted ? Math.min(1, used / daily) : 0;
  const tone = share >= 0.9 ? '#ff6b6b' : share >= 0.6 ? '#FFD700' : '#00ff88';
  const top = -Math.PI / 2;
  const R = C - 10;
  const colours = [TIER_COLORS.S, TIER_COLORS.A, TIER_COLORS.B];
  const { dots, total } = clusterDots(found, R);

  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14,
      border: '1px solid rgba(0,255,136,0.18)', background: 'radial-gradient(circle at 20% 50%, rgba(0,255,136,0.06), rgba(var(--sd-ink, 255, 255, 255), 0.02) 60%)' }}>
      <style>{CSS}</style>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <radialGradient id="radarBg"><stop offset="0" stopColor="color-mix(in srgb, var(--sd-bg, #0a0a1a) 80%, #00ff88)" /><stop offset="1" stopColor="var(--sd-bg, #0a0a1a)" /></radialGradient>
            <linearGradient id="radarBeam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#00ff88" stopOpacity="0" /><stop offset="1" stopColor="#00ff88" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r={R} fill="url(#radarBg)" stroke="rgba(0,255,136,0.25)" />
          {[0.33, 0.66].map((k) => <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="rgba(0,255,136,0.14)" strokeDasharray="2 5" />)}
          <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(0,255,136,0.1)" />
          <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(0,255,136,0.1)" />
          {/* The cluster: a dot for each person each page found, round the Scan button.
              Before any, the rings it will fill. */}
          {!dots.length && [INNER, (INNER + R) / 2, R - 8].map((r) => (
            <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="rgba(0,255,136,0.13)" strokeDasharray="2 6" />
          ))}
          {running && !dots.length && <circle className="cluster-hub" cx={C} cy={C} r={INNER - 6} fill="none" stroke="#00ff88" strokeOpacity={0.6} />}
          {dots.length > 0 && (
            <g className="cluster-turn">
              {/* Every dot joined to the hub, faintly, as the map joins a circle to its connection */}
              <path d={dots.map((d) => `M${C} ${C}L${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join('')} stroke="#fff" strokeOpacity={0.05} strokeWidth={0.6} />
              {dots.map((d, i) => (
                <g key={i} className={`cluster-dot${d.fresh ? ' fresh' : ''}`} style={{ transform: `translate(${d.x}px, ${d.y}px)` }}>
                  <circle className="sd-dot" r={d.fresh ? 3 : 2.5} fill={colours[d.page % colours.length]} opacity={d.fresh ? 1 : 0.85}
                    style={d.fresh ? { filter: `drop-shadow(0 0 3px ${colours[d.page % colours.length]})` } : undefined} />
                </g>
              ))}
            </g>
          )}
          {/* The last 24 hours' searches against the budget, round the edge */}
          <path d={arc(R + 5, top, top + 2 * Math.PI - 0.001)} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.08)" strokeWidth={5} />
          {share > 0 && <path d={arc(R + 5, top, top + 2 * Math.PI * share - 0.001)} fill="none" stroke={tone} strokeWidth={5} strokeLinecap="round" />}
        </svg>
        <button type="button" className="radar-go" onClick={onScan} disabled={disabled}
          style={{
            position: 'absolute', left: C - 62, top: C - 62, width: 124, height: 124, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer',
            border: `2px solid ${disabled ? 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' : '#00ff88'}`,
            background: disabled ? 'var(--sd-card, rgba(20,24,40,0.92))' : 'radial-gradient(circle at 50% 35%, #134d3a, #0b2a22 70%)',
            color: disabled ? 'var(--sd-fg-4, #667)' : 'var(--sd-fg-1, #eafff5)', boxShadow: disabled ? 'none' : '0 0 22px rgba(0,255,136,0.25)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 8,
          }}>
          <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>{scanning ? '•••' : 'SCAN'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, lineHeight: 1.25, textAlign: 'center' }}>{label}</span>
          {sublabel && <span style={{ fontSize: 10, opacity: 0.6, textAlign: 'center', textWrap: 'balance' }}>{sublabel}</span>}
        </button>
        {running && found.length > 0 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: -18, textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--sd-fg-2, #9fe8c4)', fontVariantNumeric: 'tabular-nums' }}>
            {total.toLocaleString('en-US')} found · {found.length} page{found.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'var(--sd-fg-4, #6b7090)', textTransform: 'uppercase', marginBottom: 8 }}>Speed</div>
        <div role="radiogroup" aria-label="Scan speed" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {PACE_NAMES.map((name) => {
            const p = PACES[name];
            const on = pace === name;
            const color = name === 'slow' ? '#00E5FF' : name === 'medium' ? '#FFD700' : '#FF7043';
            return (
              <button key={name} type="button" role="radio" aria-checked={on} disabled={running || !onPace}
                onClick={() => onPace?.(name)}
                title={`${p.pagePause} s before each page, ${p.chunkCooldown / 60} min more after every 10, profiles ${p.profileGap} s apart`}
                style={{
                  padding: '10px 8px', borderRadius: 10, cursor: running ? 'not-allowed' : 'pointer', textAlign: 'left',
                  border: `1.5px solid ${on ? color : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`, background: on ? `${color}1a` : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
                  color: 'var(--sd-fg-1, #ddd)',
                }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: on ? color : 'var(--sd-fg-2, #ccd)' }}>{p.label}</div>
                <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #8a8fa8)', marginTop: 2 }}>~{searchesPerHour(name)} searches an hour</div>
                <div style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #6b7090)', marginTop: 1 }}>{p.pagePause} s between pages</div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', lineHeight: 1.6 }}>
          {!li
            ? <>Today&rsquo;s searches show here once the scanner can read them.</>
            : left == null
            ? <>Limits lifted for this session: {used} searches in the last 24 hours, and no daily limit until you quit Sixgree.</>
            // The budget counts a rolling 24 hours (lib/linkedin-limits.js usage), not since midnight.
            : <><b style={{ color: tone }}>{left}</b> of {daily} searches left, counting the last 24 hours
              {left > 0 && <> · at {paceOf(pace).label}, {durationText(paceSeconds(pace, left))} to use them</>}.</>}
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--sd-fg-4, #778)', lineHeight: 1.55 }}>
          Fast is how the scanner has always run; Medium and Slow only add waiting, so fewer searches an hour reach
          LinkedIn. Your searches a day stay the cap at every speed: slower spreads them out, it doesn&rsquo;t shrink them.
          Lifting the limits for a session keeps the speed exactly as it is.
          Slower lowers the odds of a check from LinkedIn; it can&rsquo;t promise there won&rsquo;t be one.
        </div>
      </div>
    </div>
  );
}
