'use client';

// One class's whole flow, wherever it's opened: the guided setup, the class
// tab, Settings → Class and the one-time offer on the map. The steps are
// S1 pick, S2 name your target, S3 This or That, S4 Never show me and S5 your
// build (the reveal), and any run can start part way: a switch to a class with
// a saved build skips straight past its questions; Retune is S3 alone.
//
// Every step saves as it goes (lib/class-client.js → /api/class), so leaving
// half way keeps what was answered; Skip falls back to the class preset.

import { useEffect, useState } from 'react';
import { CLASS_CSS } from './styles';
import ClassPick, { TargetStep } from './ClassPick';
import ThisOrThat from './ThisOrThat';
import { Emblem, BuildBars, BuildWords, Dials, PersonRow } from './parts';
import {
  loadClass, pickClass, saveTarget, skipOffer, finishDuels, skipQuestions, saveAvoid, loadReveal, react,
} from '../../../lib/class-client';
import { logExposure } from '../../../lib/learning-client';

export const FLOW_STEPS = Object.freeze(['pick', 'target', 'duels', 'avoid', 'reveal']);

/** One Never show me row: Show, Less or Never. */
function AvoidRow({ label, value, onSet }) {
  return (
    <div className="cl-avoid-row">
      <span>{label}</span>
      <span className="cl-seg" role="group" aria-label={label}>
        {['off', 'less', 'never'].map((s) => (
          <button key={s} type="button" className={s} aria-pressed={value === s} onClick={() => onSet(s)}>{s === 'off' ? 'Show' : s === 'less' ? 'Less' : 'Never'}</button>
        ))}
      </span>
    </div>
  );
}

/** S4, Never show me: chips prefilled by class, each off, Less or Never; plus industries and companies. */
export function AvoidStep({ state, cls, avoid, onChange }) {
  const chips = state?.questions?.avoid || [];
  const industries = state?.questions?.industries || [];
  const [company, setCompany] = useState('');
  const strength = (key) => avoid.find((a) => a.key === key)?.strength || 'off';
  const set = (key, s) => onChange([...avoid.filter((a) => a.key !== key), ...(s === 'off' ? [] : [{ key, strength: s }])]);
  const companies = avoid.filter((a) => a.key.startsWith('co:'));
  const meta = state?.classes?.find((c) => c.key === cls);
  return (
    <div className="cl-avoid" style={{ '--cl-class': meta?.color }}>
      {chips.map((c) => <AvoidRow key={c.key} label={c.label} value={strength(c.key)} onSet={(v) => set(c.key, v)} />)}
      <details>
        <summary className="cl-quiet" style={{ cursor: 'pointer', margin: '6px 0' }}>Sectors you’d rather not see</summary>
        <div className="cl-avoid">{industries.map((g) => <AvoidRow key={g.key} label={g.label} value={strength(`ind:${g.key}`)} onSet={(v) => set(`ind:${g.key}`, v)} />)}</div>
      </details>
      <div className="cl-field">
        <label htmlFor="cl-avoid-co">A company</label>
        <div className="cl-row">
          <input id="cl-avoid-co" className="cl-input" style={{ flex: 1, minWidth: 160 }} value={company} placeholder="A company, then Never"
            onChange={(e) => setCompany(e.target.value)} />
          <button type="button" className="cl-btn secondary small" disabled={!company.trim()} onClick={() => { set(`co:${company.trim()}`, 'never'); setCompany(''); }}>Never</button>
        </div>
      </div>
      {companies.map((a) => <AvoidRow key={a.key} label={a.key.slice(3)} value={strength(a.key)} onSet={(v) => set(a.key, v)} />)}
      <p className="cl-quiet">Less pushes people down. Never puts them in class D and off every class list; they stay on your network views.</p>
    </div>
  );
}

/** S5, your build: the bars, the strongest weights, the dials, and your new top 5 with two near the S line. */
export function BuildReveal({ reveal, color, onReact, busy }) {
  const s = reveal?.summary;
  useEffect(() => { if (reveal?.top?.length) logExposure('reveal', [...reveal.top, ...reveal.near], { sort: `class:${s?.class}` }); }, [reveal, s?.class]);
  if (!s) return <div className="cl-quiet" role="status">Building your build…</div>;
  return (
    <div style={{ '--cl-class': color }}>
      <div className="cl-two">
        <div>
          <div className="cl-label" style={{ marginBottom: 8 }}>Your build</div>
          <BuildBars bars={s.bars} />
          <BuildWords top={s.top} />
          <Dials dials={s.dials} />
        </div>
        <div>
          <div className="cl-label" style={{ marginBottom: 8 }}>Your new top 5{reveal.near?.length ? ', and two near the S line' : ''}</div>
          <div className="cl-people">
            {[...reveal.top, ...(reveal.near || [])].map((p) => (
              <PersonRow key={p.id} p={p}>
                <button type="button" className="cl-btn ghost small" disabled={busy} onClick={() => onReact(p.id, 'more')} title="Yes, more like this">More like this</button>
                <button type="button" className="cl-btn ghost small" disabled={busy} onClick={() => onReact(p.id, 'not')} title="Not this one">Not this one</button>
              </PersonRow>
            ))}
          </div>
        </div>
      </div>
      <p className="cl-lede" style={{ marginTop: 14 }}>
        Class S: <b>{reveal.reshuffle.classS.toLocaleString()}</b> people{reveal.reshuffle.wasNotS ? ` (${reveal.reshuffle.wasNotS.toLocaleString()} weren’t network S)` : ''}.
        {' '}Your network tiers are unchanged: this is a second lens.
        {reveal.disagreed ? ' A few answers disagreed with each other, which is normal; they count for less.' : ''}
      </p>
    </div>
  );
}

/**
 * The flow. `start`: the first step ('pick' unless a class is known). `cls`:
 * the class, when known. `steps`: which steps run (default all). `mode`: This
 * or That's mode. `onDone({ cls, skipped })` at the end; `onSkip()` when the
 * pick itself is skipped. `chrome`: false leaves the heading and buttons to the caller.
 */
export default function ClassFlow({ start = 'pick', cls: initialCls = null, steps = FLOW_STEPS, mode = 'standard', onDone, onSkip, offer = false, compact = false, afterPick = null }) {
  const [state, setState] = useState(null);
  const [step, setStep] = useState(start);
  const [cls, setCls] = useState(initialCls);
  const [setup, setSetup] = useState(null);
  const [avoid, setAvoid] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let off = false;
    loadClass().then((d) => {
      if (off) return;
      if (d.error) { setError(d.error); return; }
      setState(d);
      if (!initialCls && d.class && start === 'pick') setCls(d.class);
    });
    return () => { off = true; };
  }, [initialCls, start]);

  const meta = state?.classes?.find((c) => c.key === cls);
  const build = state?.build?.class === cls ? state.build : null;
  const has = (s) => steps.includes(s);
  const after = (s) => steps[steps.indexOf(s) + 1] || null;

  // The target's and the avoid list's values: what you changed here, else what the build has saved.
  const setupNow = setup ?? build?.setup ?? {};
  const avoidNow = avoid ?? build?.avoid ?? [];

  useEffect(() => {
    if (step !== 'reveal' || !cls) return undefined;
    let off = false;
    loadReveal(cls).then((d) => { if (!off) { if (d.error) setError(d.error); else setReveal(d); } });
    return () => { off = true; };
  }, [step, cls]);

  const refresh = async () => { const d = await loadClass(); if (!d.error) setState(d); return d; };
  const finish = (extra = {}) => onDone?.({ cls, ...extra });

  async function confirmPick() {
    if (!cls) return;
    setBusy(true); setError(null);
    const d = await pickClass(cls);
    setBusy(false);
    if (d.error) { setError(d.error); return; }
    setState(d.state);
    const b = d.state?.build;
    setSetup(b?.setup || {});
    setAvoid(b?.avoid || []);
    // A caller that runs the rest elsewhere (the setup, during the first scan).
    if (afterPick) { const go = afterPick({ cls, needsQuestions: d.needsQuestions, needsTarget: d.needsTarget }); if (go === false) return; }
    if (d.needsTarget && has('target')) setStep('target');
    else if (d.needsQuestions && has('duels')) setStep('duels');
    else if (!d.needsQuestions && d.restored) finish({ restored: true });
    else setStep(after('target') || after('pick') || 'reveal');
  }

  async function skipPick() {
    setBusy(true);
    if (offer || !state?.offer) await skipOffer();
    setBusy(false);
    onSkip?.();
  }

  async function confirmTarget() {
    setBusy(true); setError(null);
    const d = await saveTarget(cls, setupNow);
    setBusy(false);
    if (d.error) { setError(d.error); return; }
    setState(d.state);
    if (afterPick && !has('duels')) { finish(); return; }
    setStep(after('target') || 'reveal');
    if (!after('target')) finish();
  }

  async function duelsDone() {
    setBusy(true);
    await finishDuels(cls);
    await refresh();
    setBusy(false);
    const next = after('duels');
    if (next) setStep(next); else finish();
  }

  async function skipDuels() {
    setBusy(true);
    await skipQuestions(cls);
    await refresh();
    setBusy(false);
    const next = after('duels');
    if (next) setStep(next); else finish({ skipped: true });
  }

  async function confirmAvoid() {
    setBusy(true); setError(null);
    const d = await saveAvoid(cls, avoidNow);
    setBusy(false);
    if (d.error) { setError(d.error); return; }
    setState(d.state);
    const next = after('avoid');
    if (next) setStep(next); else finish();
  }

  async function onReact(personId, verdict) {
    setBusy(true);
    const d = await react(cls, personId, verdict);
    setBusy(false);
    if (d.error) setError(d.error); else setReveal(d);
  }

  if (error && !state) return <div className="cl"><style>{CLASS_CSS}</style><div className="cl-error" role="alert">{error}</div></div>;
  if (!state) return <div className="cl"><style>{CLASS_CSS}</style><div className="cl-quiet" role="status">Loading the classes…</div></div>;

  const head = (eyebrow, title, lede) => (
    <div style={{ marginBottom: 14 }}>
      <div className="cl-row" style={{ gap: 12 }}>
        {meta && step !== 'pick' && <Emblem cls={cls} color={meta.color} size={38} title={meta.name} />}
        <div>
          <div className="cl-eyebrow">{eyebrow}</div>
          <h2 className="cl-h1" style={{ margin: '4px 0 0' }}>{title}</h2>
        </div>
      </div>
      {lede && <p className="cl-lede" style={{ marginTop: 10 }}>{lede}</p>}
    </div>
  );

  return (
    <div className={`cl${compact ? ' compact' : ''}`} data-class-flow={step} style={{ '--cl-class': meta?.color }}>
      <style>{CLASS_CSS}</style>
      {step === 'pick' && (
        <>
          {head('Your class', 'Pick your class', 'Your class ranks the same network for what you’re after. Your network tiers stay as they are: a class is a second lens, and you can switch any time in Settings.')}
          <ClassPick state={state} selected={cls} onSelect={setCls} busy={busy} />
          {error && <div className="cl-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div className="cl-row" style={{ marginTop: 16 }}>
            {onSkip && <button type="button" className="cl-btn ghost" onClick={skipPick} disabled={busy}>Skip for now</button>}
            <span className="cl-spacer" />
            <button type="button" className="cl-btn primary" id="cl-pick-go" disabled={!cls || busy} onClick={confirmPick}>
              {busy ? 'Saving…' : meta ? `Be a ${meta.name}` : 'Pick a class'}
            </button>
          </div>
        </>
      )}
      {step === 'target' && (
        <>
          {head(`${meta?.name || 'Your class'} · your target`, state.questions.target[cls]?.title || 'Your target')}
          <TargetStep state={state} cls={cls} setup={setupNow} onChange={setSetup} />
          {error && <div className="cl-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div className="cl-row" style={{ marginTop: 18 }}>
            <span className="cl-spacer" />
            <button type="button" className="cl-btn primary" disabled={busy} onClick={confirmTarget}>{busy ? 'Saving…' : 'Continue'}</button>
          </div>
        </>
      )}
      {step === 'duels' && (
        <>
          {!compact && head(`${meta?.name || 'Your class'} · This or That`, 'This or That', 'Pick the one you’d rather have. About a minute or two; it learns what you weigh, so your class ranks people your way.')}
          <ThisOrThat cls={cls} color={meta?.color} mode={mode} onDone={duelsDone} compact={compact} />
          <div className="cl-row" style={{ marginTop: 6 }}>
            <button type="button" className="cl-btn ghost small" onClick={skipDuels} disabled={busy} style={{ paddingLeft: 0 }}>Skip: use the {meta?.name} preset</button>
          </div>
        </>
      )}
      {step === 'avoid' && (
        <>
          {head(`${meta?.name || 'Your class'} · never show me`, 'Never show me', 'Who you’d rather not have ranked for you. Prefilled for your class.')}
          <AvoidStep state={state} cls={cls} avoid={avoidNow} onChange={setAvoid} />
          {error && <div className="cl-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div className="cl-row" style={{ marginTop: 18 }}>
            <span className="cl-spacer" />
            <button type="button" className="cl-btn primary" disabled={busy} onClick={confirmAvoid}>{busy ? 'Saving…' : 'See your build'}</button>
          </div>
        </>
      )}
      {step === 'reveal' && (
        <>
          {head(`${meta?.name || 'Your class'} · your build`, 'Your build', 'What your answers weigh, and who it ranks at the top now. Tell it when it’s wrong: each tap teaches it.')}
          <BuildReveal reveal={reveal} color={meta?.color} onReact={onReact} busy={busy} />
          {error && <div className="cl-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div className="cl-row" style={{ marginTop: 18 }}>
            <span className="cl-spacer" />
            <button type="button" className="cl-btn primary" id="cl-done" onClick={() => finish()}>Done</button>
          </div>
        </>
      )}
    </div>
  );
}

/** The flow in a window over the page (Settings → Class, the class tab's Retune, the offer on the map). */
export function ClassFlowModal({ onClose, ...props }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cl cl-modal" role="dialog" aria-modal="true" aria-label="Your class">
      <style>{CLASS_CSS}</style>
      <div className="cl-modal-in">
        <div className="cl-row" style={{ justifyContent: 'flex-end', marginBottom: -8 }}>
          <button type="button" className="cl-btn ghost small" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <ClassFlow {...props} onDone={(r) => { props.onDone?.(r); onClose?.(); }} onSkip={props.onSkip ? () => { props.onSkip(); onClose?.(); } : undefined} />
      </div>
    </div>
  );
}
