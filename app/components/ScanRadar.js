'use client';

// The Scan page's radar (Blake, 2026-10-03: "making the scan button more
// gamified, having the slow medium high scan option"). A round Scan button in
// the middle of a radar: the sweep turns while a scan runs, the outer arc is
// today's searches against the budget, and beside it the three speeds with
// what each means for the rest of today's budget. Speed only changes searches
// an hour (lib/scan-pace.js); the daily budget is still the cap.

import { PACES, PACE_NAMES, paceOf, paceSeconds, searchesPerHour, durationText } from '../../lib/scan-pace';

const SIZE = 236;
const C = SIZE / 2;
const CSS = `
@keyframes radarSweep { to { transform: rotate(360deg); } }
@keyframes radarPing { 0% { opacity: .9; r: 3; } 100% { opacity: 0; r: 11; } }
.radar-sweep { transform-origin: ${C}px ${C}px; animation: radarSweep 2.6s linear infinite; }
.radar-ping { animation: radarPing 2.6s ease-out infinite; }
.radar-go { transition: transform .15s ease, box-shadow .2s ease; }
.radar-go:not(:disabled):hover { transform: scale(1.04); box-shadow: 0 0 34px rgba(0,255,136,.45); }
.radar-go:not(:disabled):active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) { .radar-sweep, .radar-ping { animation: none; } }
`;

// A few fixed blips, so the radar looks alive without inventing anything about anyone.
const BLIPS = [[0.62, 0.7], [0.38, 2.1], [0.8, 3.3], [0.5, 4.4], [0.72, 5.6]];

function arc(r, from, to) {
  const p = (a) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return `M${p(from)} A${r} ${r} 0 ${large} 1 ${p(to)}`;
}

export default function ScanRadar({ li, running, scanning, disabled, label, sublabel, onScan, onPace }) {
  const pace = li?.limits?.pace || 'fast';
  const daily = li?.limits?.daily || 0;
  const used = li?.unreadable ? daily : li?.searchesToday || 0;
  const left = daily ? Math.max(0, daily - used) : null;
  const share = daily ? Math.min(1, used / daily) : 0;
  const tone = share >= 0.9 ? '#ff6b6b' : share >= 0.6 ? '#FFD700' : '#00ff88';
  const top = -Math.PI / 2;
  const R = C - 10;

  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14,
      border: '1px solid rgba(0,255,136,0.18)', background: 'radial-gradient(circle at 20% 50%, rgba(0,255,136,0.06), rgba(255,255,255,0.02) 60%)' }}>
      <style>{CSS}</style>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <radialGradient id="radarBg"><stop offset="0" stopColor="#0f2a22" /><stop offset="1" stopColor="#0a0a1a" /></radialGradient>
            <linearGradient id="radarBeam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#00ff88" stopOpacity="0" /><stop offset="1" stopColor="#00ff88" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r={R} fill="url(#radarBg)" stroke="rgba(0,255,136,0.25)" />
          {[0.33, 0.66].map((k) => <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="rgba(0,255,136,0.14)" strokeDasharray="2 5" />)}
          <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(0,255,136,0.1)" />
          <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(0,255,136,0.1)" />
          {/* The sweep: turning while a scan runs, resting otherwise */}
          <g className={running ? 'radar-sweep' : undefined} opacity={running ? 1 : 0.35}>
            <path d={`M${C} ${C} L${C + R} ${C} A${R} ${R} 0 0 0 ${C + R * Math.cos(-0.55)} ${C + R * Math.sin(-0.55)} Z`} fill="url(#radarBeam)" />
            <line x1={C} y1={C} x2={C + R} y2={C} stroke="#00ff88" strokeOpacity={0.8} strokeWidth={1.5} />
          </g>
          {BLIPS.map(([k, a], i) => (
            <g key={i}>
              <circle cx={C + R * k * Math.cos(a)} cy={C + R * k * Math.sin(a)} r={2.4} fill="#00ff88" opacity={running ? 0.9 : 0.35} />
              {running && <circle className="radar-ping" style={{ animationDelay: `${(a / (2 * Math.PI)) * 2.6}s` }}
                cx={C + R * k * Math.cos(a)} cy={C + R * k * Math.sin(a)} r={3} fill="none" stroke="#00ff88" />}
            </g>
          ))}
          {/* Today's searches against the budget, round the edge */}
          <path d={arc(R + 5, top, top + 2 * Math.PI - 0.001)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
          {share > 0 && <path d={arc(R + 5, top, top + 2 * Math.PI * share - 0.001)} fill="none" stroke={tone} strokeWidth={5} strokeLinecap="round" />}
        </svg>
        <button type="button" className="radar-go" onClick={onScan} disabled={disabled}
          style={{
            position: 'absolute', left: C - 62, top: C - 62, width: 124, height: 124, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer',
            border: `2px solid ${disabled ? 'rgba(255,255,255,0.12)' : '#00ff88'}`,
            background: disabled ? 'rgba(20,24,40,0.92)' : 'radial-gradient(circle at 50% 35%, #134d3a, #0b2a22 70%)',
            color: disabled ? '#667' : '#eafff5', boxShadow: disabled ? 'none' : '0 0 22px rgba(0,255,136,0.25)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 8,
          }}>
          <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2 }}>{scanning ? '•••' : 'SCAN'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, lineHeight: 1.25, textAlign: 'center' }}>{label}</span>
          {sublabel && <span style={{ fontSize: 10, opacity: 0.6, textAlign: 'center' }}>{sublabel}</span>}
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#6b7090', textTransform: 'uppercase', marginBottom: 8 }}>Speed</div>
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
                  border: `1.5px solid ${on ? color : 'rgba(255,255,255,0.1)'}`, background: on ? `${color}1a` : 'rgba(255,255,255,0.03)',
                  color: '#ddd',
                }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: on ? color : '#ccd' }}>{p.label}</div>
                <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 2 }}>~{searchesPerHour(name)} searches an hour</div>
                <div style={{ fontSize: 10.5, color: '#6b7090', marginTop: 1 }}>{p.pagePause} s between pages</div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: '#b8c4c4', lineHeight: 1.6 }}>
          {!li
            ? <>Today&rsquo;s searches show here once the scanner can read them.</>
            : left == null
            ? <>No daily cap is set.</>
            : <><b style={{ color: tone }}>{left}</b> of {daily} searches left today
              {left > 0 && <> · at {paceOf(pace).label}, {durationText(paceSeconds(pace, left))} to use them</>}.</>}
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5, color: '#778', lineHeight: 1.55 }}>
          Fast is how the scanner has always run; Medium and Slow only add waiting, so fewer searches an hour reach
          LinkedIn. Your daily budget stays the cap at every speed: slower spreads it out, it doesn&rsquo;t shrink it.
          Slower lowers the odds of a check from LinkedIn; it can&rsquo;t promise there won&rsquo;t be one.
        </div>
      </div>
    </div>
  );
}
