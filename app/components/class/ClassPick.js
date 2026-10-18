'use client';

// S1, pick your class (spec 6.3): six emblem cards in a 2 x 3 grid, each with
// who it's for, what it hunts and its ability. Tap the corner to flip one: its
// back shows a live count from your own network, how it was counted, and the
// gap the class would fix. "Not sure?" asks what would make this month a win,
// six answers, one per class. Then S2, name your target (TargetStep).

import { useState } from 'react';
import { Emblem } from './parts';
import { WIN_QUESTION } from '../../../lib/class-presets';

export default function ClassPick({ state, selected, onSelect, busy = false }) {
  const [flipped, setFlipped] = useState(null);
  const [unsure, setUnsure] = useState(false);
  const classes = state?.classes || [];
  return (
    <div>
      <div className="cl-grid" role="radiogroup" aria-label="Your class">
        {classes.map((c) => {
          const on = selected === c.key;
          const flip = flipped === c.key;
          return (
            <div key={c.key} className={`cl-pick${on ? ' sel' : ''}${flip ? ' flipped' : ''}`} style={{ '--cl-class': c.color }} data-class={c.key}>
              <div className="cl-pick-in">
                <button type="button" className="cl-face front" role="radio" aria-checked={on} disabled={busy} onClick={() => onSelect(c.key)}
                  aria-label={`${c.name}: ${c.who}`} style={{ border: undefined, color: 'inherit', textAlign: 'left', width: '100%' }}>
                  {c.status?.saved && c.status.answers > 0 && <span className="tag">Saved build</span>}
                  <span className="nm"><Emblem cls={c.key} color={c.color} size={40} />{c.name}</span>
                  <span className="who">{c.who}</span>
                  <span className="kv"><b>Hunts</b> {c.hunts}</span>
                  <span className="kv"><b>Ability</b> {c.ability}</span>
                </button>
                <div className="cl-face back" aria-hidden={!flip}>
                  <span className="nm" style={{ fontSize: 15 }}><Emblem cls={c.key} color={c.color} size={28} />{c.name} in your network</span>
                  <span className="big">{c.back?.line}</span>
                  <span className="kv">{c.back?.how}</span>
                  <span className="kv" style={{ color: 'var(--cl-fg2)' }}>{c.back?.gap}</span>
                </div>
              </div>
              <button type="button" className="cl-btn ghost small cl-flip" onClick={() => setFlipped(flip ? null : c.key)}
                aria-pressed={flip} aria-label={flip ? `Show ${c.name}'s front` : `Flip ${c.name}: what it finds in your network`}
                style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 2, height: 28, fontSize: 12 }}>
                {flip ? 'Back' : 'Your numbers'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="cl-unsure">
        {!unsure ? (
          <button type="button" className="cl-btn ghost small" onClick={() => setUnsure(true)} style={{ paddingLeft: 0 }}>Not sure? Answer one question</button>
        ) : (
          <>
            <div className="cl-label" style={{ marginBottom: 8 }}>{WIN_QUESTION}</div>
            <div className="cl-chips">
              {classes.map((c) => (
                <button key={c.key} type="button" className="cl-chip" aria-pressed={selected === c.key} style={{ '--cl-class': c.color }}
                  onClick={() => onSelect(c.key)}>{c.win}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * S2, name your target: one class-specific question, prefilled from your data
 * (your network's main industry, your city as a guess, your Breach targets),
 * and an optional line about you.
 */
export function TargetStep({ state, cls, setup, onChange }) {
  const q = state?.questions?.target?.[cls] || {};
  const chips = state?.questions?.roles?.[cls] || [];
  const industries = state?.questions?.industries || [];
  const meta = state?.classes?.find((c) => c.key === cls);
  const set = (patch) => onChange({ ...setup, ...patch });
  const toggle = (list, key) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const [target, setTarget] = useState('');
  if (q.none) return <p className="cl-lede">{q.none}</p>;
  return (
    <div style={{ '--cl-class': meta?.color }}>
      {chips.length > 0 && (
        <div className="cl-field">
          <span className="cl-label">{q.roles}</span>
          <div className="cl-chips">
            {chips.map((c) => (
              <button key={c.key} type="button" className="cl-chip" aria-pressed={(setup.roles || []).includes(c.key)}
                onClick={() => set({ roles: toggle(setup.roles || [], c.key) })}>{c.label}</button>
            ))}
          </div>
        </div>
      )}
      {q.targets && (
        <div className="cl-field">
          <label htmlFor="cl-target">{q.targets}</label>
          <div className="cl-row">
            <input id="cl-target" className="cl-input" style={{ flex: 1, minWidth: 180 }} value={target} placeholder="A company, then Add"
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && target.trim()) { e.preventDefault(); set({ targets: [...new Set([...(setup.targets || []), target.trim()])].slice(0, 25) }); setTarget(''); } }} />
            <button type="button" className="cl-btn secondary small" disabled={!target.trim()}
              onClick={() => { set({ targets: [...new Set([...(setup.targets || []), target.trim()])].slice(0, 25) }); setTarget(''); }}>Add</button>
          </div>
          {(setup.targets || []).length > 0 && (
            <div className="cl-chips" style={{ marginTop: 6 }}>
              {setup.targets.map((t) => (
                <button key={t} type="button" className="cl-chip" aria-pressed="true" aria-label={`Remove ${t}`}
                  onClick={() => set({ targets: setup.targets.filter((x) => x !== t) })}>{t} ×</button>
              ))}
            </div>
          )}
        </div>
      )}
      {q.sectors && (
        <div className="cl-field">
          <span className="cl-label">{q.sectors}</span>
          <div className="cl-chips">
            {industries.map((g) => (
              <button key={g.key} type="button" className="cl-chip" aria-pressed={(setup.sectors || []).includes(g.key)}
                onClick={() => set({ sectors: toggle(setup.sectors || [], g.key).slice(-6) })}>{g.label}</button>
            ))}
          </div>
        </div>
      )}
      {q.city && (
        <div className="cl-field">
          <label htmlFor="cl-city">{q.city}</label>
          <input id="cl-city" className="cl-input" value={setup.city || ''} placeholder="City, Region" onChange={(e) => set({ city: e.target.value })} />
          {state?.guess?.city && setup.city === state.guess.city && <span className="cl-quiet">A guess from where most of your connections are. Change it if it’s wrong.</span>}
        </div>
      )}
      <details style={{ marginTop: 14 }}>
        <summary className="cl-quiet" style={{ cursor: 'pointer' }}>About you (optional): your role, company, school and city</summary>
        <div className="cl-row" style={{ marginTop: 8, alignItems: 'stretch' }}>
          {['role', 'company', 'school', 'city'].map((k) => (
            <input key={k} className="cl-input" style={{ flex: '1 1 140px' }} aria-label={`Your ${k}`} placeholder={`Your ${k}`}
              value={setup.about?.[k] || ''} onChange={(e) => set({ about: { ...(setup.about || {}), [k]: e.target.value } })} />
          ))}
        </div>
      </details>
    </div>
  );
}
