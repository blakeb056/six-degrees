'use client';

// The Galaxy's physics lab (experimental), in the Filter panel: Obsidian-style
// sliders for the forces that lay the Galaxy out, and a replay of your network
// growing by the date you connected. Everything moves the Galaxy in place;
// lib/galaxy-lab.js holds the settings and the clock.

import { useSyncExternalStore } from 'react';
import {
  LAB_DEFAULTS, CLUSTERS, labNow, setLab, watchLab,
  clockNow, setClock, watchClock, play, pause, stopReplay,
} from '../../lib/galaxy-lab';

const DAY = 86400000;

const FORCES = [
  { key: 'gravity', label: 'Gravity', min: 0, max: 3, step: 0.01, fmt: (v) => v.toFixed(2), hint: 'Pulls every dot in towards you.' },
  { key: 'rings', label: 'Rings', min: 0, max: 5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: 'How hard each tier holds its ring. At 0 the Galaxy finds its own shape.' },
  { key: 'push', label: 'Push', min: 0, max: 300, step: 1, fmt: (v) => String(v), hint: 'How hard dots push each other apart.' },
  { key: 'pull', label: 'Pull', min: 0, max: 15, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: 'How hard each person pulls the people who came through them.' },
  { key: 'distance', label: 'Distance', min: 0.05, max: 6, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, hint: 'How far out those people sit.' },
];
const DISPLAY = [
  { key: 'dotSize', label: 'Dot size', min: 0.2, max: 8, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'lines', label: 'Lines', min: 0, max: 20, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
];

const heading = { fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, margin: '12px 0 6px', textTransform: 'uppercase' };
const small = { fontSize: 10, color: '#667', lineHeight: 1.4 };

function Slider({ spec, value }) {
  return (
    <label title={spec.hint} style={{ display: 'block', marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aab' }}>
        <span>{spec.label}</span>
        <span style={{ color: value === LAB_DEFAULTS[spec.key] ? '#556' : '#cfe6f7', fontVariantNumeric: 'tabular-nums' }}>{spec.fmt(value)}</span>
      </div>
      <input
        type="range" min={spec.min} max={spec.max} step={spec.step} value={value}
        onChange={(e) => setLab({ [spec.key]: Number(e.target.value) })}
        style={{ width: '100%', accentColor: '#3498DB' }}
      />
    </label>
  );
}

function Choice({ options, value, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onPick(v)} aria-pressed={value === v} style={{
          flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
          border: value === v ? '1px solid rgba(52,152,219,0.6)' : '1px solid rgba(255,255,255,0.08)',
          background: value === v ? 'rgba(52,152,219,0.18)' : 'rgba(255,255,255,0.03)',
          color: value === v ? '#cfe6f7' : '#888',
        }}>{label}</button>
      ))}
    </div>
  );
}

const month = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function GalaxyLab() {
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  const clock = useSyncExternalStore(watchClock, clockNow, clockNow);
  const canReplay = clock.min != null && clock.max != null && clock.max > clock.min;
  const preset = FORCES.every((f) => lab[f.key] === LAB_DEFAULTS[f.key]) ? 'rings'
    : Object.entries(CLUSTERS).every(([k, v]) => lab[k] === v) ? 'clusters' : null;

  return (
    <div style={{ marginBottom: 18, padding: '10px 10px 8px', borderRadius: 8, border: '1px solid rgba(212,175,55,0.25)', background: 'rgba(212,175,55,0.04)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox" checked={lab.on}
          onChange={(e) => { if (!e.target.checked) stopReplay(); setLab({ on: e.target.checked }); }}
          style={{ accentColor: '#D4AF37' }}
        />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#e6d7a0' }}>Physics lab</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#D4AF37', border: '1px solid rgba(212,175,55,0.4)', borderRadius: 4, padding: '0 4px' }}>EXPERIMENTAL</span>
      </label>
      {!lab.on && (
        <div style={{ ...small, marginTop: 6 }}>
          Sliders for the forces that lay the Galaxy out, a branch that lights up on hover, and a replay of your
          network growing.
        </div>
      )}

      {lab.on && (
        <>
          <div style={heading}>Layout</div>
          <Choice
            value={preset}
            options={[['rings', 'Rings'], ['clusters', 'Clusters']]}
            onPick={(v) => setLab(v === 'rings' ? { ...Object.fromEntries(FORCES.map((f) => [f.key, LAB_DEFAULTS[f.key]])), sizeBy: 'power' } : CLUSTERS)}
          />
          <div style={{ ...small, marginBottom: 6 }}>
            {preset === 'clusters'
              ? 'No rings: each connection pulls their circle round them, and a dot grows with everyone behind it.'
              : 'Drag a dot to see what it pulls with it. Try Rings at 0 and Pull up.'}
          </div>

          <div style={heading}>Forces</div>
          {FORCES.map((f) => <Slider key={f.key} spec={f} value={lab[f.key]} />)}

          <div style={heading}>Display</div>
          {DISPLAY.map((f) => <Slider key={f.key} spec={f} value={lab[f.key]} />)}
          <div style={{ fontSize: 11, color: '#aab', marginBottom: 4 }}>Size dots by</div>
          <Choice value={lab.sizeBy} options={[['power', 'Power score'], ['reach', 'Who hangs off them']]} onPick={(v) => setLab({ sizeBy: v })} />
          <div style={{ fontSize: 11, color: '#aab', marginBottom: 4 }}>Names</div>
          <Choice value={lab.names} options={[['key', 'S + catalysts'], ['all', 'All 1st'], ['none', 'None']]} onPick={(v) => setLab({ names: v })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aab', cursor: 'pointer' }}>
            <input type="checkbox" checked={lab.branch} onChange={(e) => setLab({ branch: e.target.checked })} style={{ accentColor: '#3498DB' }} />
            Light up a branch on hover
          </label>

          <div style={heading}>Replay</div>
          {canReplay ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <button onClick={() => (clock.playing ? pause() : play())} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid rgba(52,152,219,0.6)', background: 'rgba(52,152,219,0.18)', color: '#cfe6f7',
                }}>{clock.playing ? '❚❚ Pause' : '▶ Replay'}</button>
                {clock.at != null && (
                  <button onClick={stopReplay} style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#aaa',
                  }}>Show all</button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#aab', fontVariantNumeric: 'tabular-nums' }}>
                  {month(clock.at ?? clock.max)}
                </span>
              </div>
              <input
                type="range" min={clock.min} max={clock.max} step={DAY} value={clock.at ?? clock.max}
                onChange={(e) => { pause(); setClock({ at: Number(e.target.value) }); }}
                style={{ width: '100%', accentColor: '#3498DB' }}
                aria-label="Time"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', ...small }}>
                <span>{month(clock.min)}</span><span>{month(clock.max)}</span>
              </div>
              <div style={{ ...small, marginTop: 4 }}>
                Your connections appear on the day you connected; their circles come with them.
              </div>
            </>
          ) : (
            <div style={small}>
              Nothing to replay: the connections on screen have no &ldquo;connected on&rdquo; dates. A LinkedIn CSV or a
              network scan has them; the sample network doesn&rsquo;t.
            </div>
          )}

          <button onClick={() => { stopReplay(); setLab(null); }} style={{
            marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#aaa',
          }}>Reset to today&rsquo;s layout</button>
        </>
      )}
    </div>
  );
}
