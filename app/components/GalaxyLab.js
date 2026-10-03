'use client';

// The Galaxy's physics, the main thing in Network Circle's Filters panel
// (Blake, 2026-10-02: "having the physics tab being the main function"):
// Obsidian-style sliders for the forces that lay the Galaxy out, and a replay
// of your network growing by the date you connected. Everything moves the
// Galaxy in place; lib/galaxy-lab.js holds the settings and the clock. It began
// as an experimental box with its own on switch; now it is always on, and sits
// flush in the panel.

import { useState, useSyncExternalStore } from 'react';
import {
  LAB_DEFAULTS, CLUSTERS, ORBIT, layoutOf, labNow, setLab, watchLab,
  clockNow, setClock, watchClock, play, pause, stopReplay,
  layoutsNow, watchLayouts, saveLayout, applyLayout, forgetLayout, milestones,
} from '../../lib/galaxy-lab';
import { savePicture, recordReplay, canRecord } from '../../lib/galaxy-export';
import { showActivity } from '../../lib/island';

const noLayouts = [];

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

/** Filter → Names: every name on the Galaxy on or off, with or without the lab. */
export function NamesSwitch() {
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>Names</div>
      <Choice value={lab.labels} options={[[true, 'On'], [false, 'Off']]} onPick={(v) => setLab({ labels: v })} />
    </div>
  );
}

const month = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

export default function GalaxyLab() {
  const lab = useSyncExternalStore(watchLab, labNow, () => LAB_DEFAULTS);
  const clock = useSyncExternalStore(watchClock, clockNow, clockNow);
  const layouts = useSyncExternalStore(watchLayouts, layoutsNow, () => noLayouts);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);     // 'picture' | 'video' while saving
  const [note, setNote] = useState(null);
  const recordable = useSyncExternalStore(() => () => {}, canRecord, () => false);
  const marks = clock.min != null && clock.max > clock.min
    ? milestones(clock.social).filter((m) => m.t >= clock.min && m.t <= clock.max) : [];
  const run = async (what, job) => {
    setBusy(what);
    setNote(null);
    // A recording runs for the whole replay: the notch under the header shows it.
    const done = what === 'video' ? showActivity({ id: 'replay-video', label: 'Recording the replay', detail: 'The video saves when it ends' }) : () => {};
    try { await job(); } catch (e) { setNote(e.message || 'That didn’t work.'); } finally { setBusy(null); done(); }
  };
  const canReplay = clock.min != null && clock.max != null && clock.max > clock.min;
  const preset = layoutOf(lab);

  return (
    <div style={{ marginBottom: 18, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#dde' }}>Physics</div>
      <div style={{ ...small, marginTop: 3 }}>The forces that lay the Galaxy out. Everything here moves it in place.</div>

          <div style={heading}>Names</div>
          <Choice value={lab.labels} options={[[true, 'On'], [false, 'Off']]} onPick={(v) => setLab({ labels: v })} />

          <div style={heading}>Find</div>
          <input
            type="search" value={clock.find} placeholder="A name, company or role"
            onChange={(e) => setClock({ find: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') setClock({ fly: clock.fly + 1 }); }}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 6, fontSize: 11.5,
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.25)', color: '#dde',
            }}
          />
          {clock.find.trim().length >= 2 && (
            <div style={{ ...small, marginTop: 4 }}>
              {clock.found ? `${clock.found.toLocaleString()} found · Enter flies to the best one` : 'No one on screen matches.'}
            </div>
          )}

          <div style={heading}>Layout</div>
          <Choice
            value={preset}
            options={[['rings', 'Rings'], ['orbit', 'Orbit'], ['clusters', 'Clusters']]}
            onPick={(v) => setLab(v === 'rings' ? { ...Object.fromEntries(FORCES.map((f) => [f.key, LAB_DEFAULTS[f.key]])), sizeBy: 'power' } : v === 'orbit' ? ORBIT : CLUSTERS)}
          />
          <div style={{ ...small, marginBottom: 6 }}>
            {preset === 'clusters'
              ? 'No rings: each connection pulls their circle round them, and a dot grows with everyone behind it.'
              : preset === 'orbit'
                ? 'Each tier on its own orbit, S nearest you, with each connection’s circle tucked in behind them. Drag a bridge and its circle follows.'
                : 'Drag a dot to see what it pulls with it. Try Rings at 0 and Pull up.'}
          </div>

          <div style={heading}>Forces</div>
          {FORCES.map((f) => <Slider key={f.key} spec={f} value={lab[f.key]} />)}

          <div style={heading}>Display</div>
          {DISPLAY.map((f) => <Slider key={f.key} spec={f} value={lab[f.key]} />)}
          <div style={{ fontSize: 11, color: '#aab', marginBottom: 4 }}>Size dots by</div>
          <Choice value={lab.sizeBy} options={[['power', 'Power score'], ['reach', 'Who hangs off them']]} onPick={(v) => setLab({ sizeBy: v })} />
          <div style={{ fontSize: 11, color: '#aab', marginBottom: 4 }}>Colour by</div>
          <Choice
            value={lab.colourBy}
            options={[['tier', 'Tier'], ['degree', 'Degree'], ['company', 'Company'], ['warmth', 'Warmth']]}
            onPick={(v) => setLab({ colourBy: v })}
          />
          {lab.colourBy === 'warmth' && clock.social === null && (
            <div style={{ ...small, marginTop: -4, marginBottom: 8 }}>
              Warmth comes from the Social tab: import your LinkedIn export there first. Until then it&rsquo;s by tier.
            </div>
          )}
          <div style={{ fontSize: 11, color: '#aab', marginBottom: 4 }}>Which names{lab.labels ? '' : ' (Names is off)'}</div>
          <Choice value={lab.names === 'all' ? 'all' : 'key'} options={[['key', 'S + catalysts'], ['all', 'All 1st']]} onPick={(v) => setLab({ names: v })} />
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
              <div style={{ position: 'relative' }}>
                <input
                  type="range" min={clock.min} max={clock.max} step={DAY} value={clock.at ?? clock.max}
                  onChange={(e) => { pause(); setClock({ at: Number(e.target.value) }); }}
                  style={{ width: '100%', accentColor: '#3498DB' }}
                  aria-label="Time"
                />
                {/* Milestones from the Social tab: a job start (gold) or a post (blue). */}
                <div style={{ position: 'absolute', left: 7, right: 7, top: -3, height: 6, pointerEvents: 'none' }}>
                  {marks.map((m) => (
                    <span key={`${m.kind}-${m.t}`} title={`${m.label} · ${month(m.t)}`} style={{
                      position: 'absolute', left: `${((m.t - clock.min) / (clock.max - clock.min)) * 100}%`,
                      width: m.kind === 'job' ? 3 : 2, height: m.kind === 'job' ? 8 : 5, borderRadius: 1, transform: 'translateX(-50%)',
                      background: m.kind === 'job' ? '#D4AF37' : '#74B9FF', opacity: m.kind === 'job' ? 0.95 : 0.7,
                    }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...small }}>
                <span>{month(clock.min)}</span><span>{month(clock.max)}</span>
              </div>
              <div style={{ fontSize: 11, color: '#aab', margin: '8px 0 4px' }}>Length</div>
              <Choice value={lab.speed} options={[[5, '5 s'], [15, '15 s'], [30, '30 s'], [60, '1 min']]} onPick={(v) => setLab({ speed: v })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#aab', cursor: 'pointer' }}>
                <input type="checkbox" checked={lab.loop} onChange={(e) => setLab({ loop: e.target.checked })} style={{ accentColor: '#3498DB' }} />
                Loop
              </label>
              <div style={{ ...small, marginTop: 4 }}>
                Your connections appear on the day you connected; their circles come with them.
                {marks.length > 0 ? ' Gold marks are your job starts and blue ones your posts, from the Social tab.' : ''}
              </div>
              {recordable && (
                <button disabled={!!busy} onClick={() => run('video', recordReplay)} style={{
                  marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer', border: '1px solid rgba(231,76,60,0.5)',
                  background: 'rgba(231,76,60,0.12)', color: '#f5b7b1',
                }}>{busy === 'video' ? '● Recording…' : '● Record the replay as a video'}</button>
              )}
            </>
          ) : (
            <div style={small}>
              Nothing to replay: the connections on screen have no &ldquo;connected on&rdquo; dates. A LinkedIn CSV or a
              network scan has them; the sample network doesn&rsquo;t.
            </div>
          )}

          <div style={heading}>Saved layouts</div>
          {layouts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {layouts.map((l) => (
                <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 12, border: '1px solid rgba(52,152,219,0.4)', background: 'rgba(52,152,219,0.1)' }}>
                  <button onClick={() => applyLayout(l.name)} style={{ padding: '3px 4px 3px 9px', border: 'none', background: 'none', color: '#cfe6f7', fontSize: 10.5, cursor: 'pointer' }}>{l.name}</button>
                  <button onClick={() => forgetLayout(l.name)} aria-label={`Forget ${l.name}`} title="Forget this layout" style={{ padding: '3px 8px 3px 3px', border: 'none', background: 'none', color: '#667', fontSize: 11, cursor: 'pointer' }}>×</button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); saveLayout(name); setName(''); }} style={{ display: 'flex', gap: 4 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this layout" maxLength={40} style={{
              flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 6, fontSize: 11,
              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.25)', color: '#dde',
            }} />
            <button type="submit" disabled={!name.trim()} style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'default',
              border: '1px solid rgba(52,152,219,0.6)', background: 'rgba(52,152,219,0.18)', color: name.trim() ? '#cfe6f7' : '#667',
            }}>Save</button>
          </form>

          <div style={heading}>Share</div>
          <button disabled={!!busy} onClick={() => run('picture', savePicture)} style={{
            width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
            border: '1px solid rgba(52,152,219,0.6)', background: 'rgba(52,152,219,0.18)', color: '#cfe6f7',
          }}>{busy === 'picture' ? 'Saving…' : 'Save a picture of the Galaxy'}</button>
          <div style={{ ...small, marginTop: 4 }}>
            A PNG of what&rsquo;s on screen, at twice the size. It shows real names, so check it before you post it.
          </div>
          {note && <div style={{ ...small, color: '#e67e73', marginTop: 4 }}>{note}</div>}

          <button onClick={() => { stopReplay(); setClock({ find: '' }); setLab(null); }} style={{
            marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#aaa',
          }}>Reset to today&rsquo;s layout</button>
    </div>
  );
}
