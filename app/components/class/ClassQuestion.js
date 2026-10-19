'use client';

// The Scan page's one question, once your connections are in (where the field
// question was: app/components/FieldStep.js). Now it's your class: pick one,
// name your target and answer This or That, which also writes your field when
// none was picked (lib/class-store.js finishDuels). Skip for now is kept, as
// the field question's was. Someone who skipped the class pick before still
// gets the field question (`fallback`).

import { useEffect, useState } from 'react';
import { CLASS_CSS } from './styles';
import { Emblem } from './parts';
import { ClassFlowModal } from './ClassFlow';
import { loadClass, skipOffer } from '../../../lib/class-client';
import { skipField } from '../FieldStep';

export default function ClassQuestion({ onDone, fallback = null }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    loadClass().then((d) => { if (!off) setState(d.error ? { error: d.error } : d); });
    return () => { off = true; };
  }, []);
  if (!state) return null;
  if (state.error) return fallback;
  // A class already picked: its This or That wrote (or will write) your field.
  if (state.class) return null;
  // The class pick skipped before: the field question, as it was.
  if (state.offer) return fallback;
  const done = async () => {
    const r = await fetch('/api/settings').then((x) => x.json()).catch(() => null);
    onDone?.(r?.settings?.sectorFocus?.sectors || []);
  };
  return (
    <section className="cl" aria-labelledby="class-question" data-class-question="" style={{ margin: '8px 0 0', padding: '18px 20px', borderRadius: 12, border: '1px solid var(--cl-line)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)' }}>
      <style>{CLASS_CSS}</style>
      <div className="cl-eyebrow">One question · optional</div>
      <div className="cl-row" style={{ marginTop: 8, alignItems: 'center' }}>
        <span style={{ display: 'flex' }}>{state.classes.slice(0, 6).map((c) => <Emblem key={c.key} cls={c.key} color={c.color} size={28} />)}</span>
        <h2 id="class-question" className="cl-h2" style={{ margin: 0 }}>What are you after? Pick your class</h2>
      </div>
      <p className="cl-lede" style={{ marginTop: 8 }}>Your class ranks your network for your goal, beside the network tiers. A minute or two of This or That tunes it, and sets your field too.</p>
      <div className="cl-row">
        <button type="button" className="cl-btn primary small" onClick={() => setOpen(true)}>Pick your class</button>
        <button type="button" className="cl-btn ghost small" disabled={busy} onClick={async () => { setBusy(true); await skipOffer(); await skipField(); onDone?.([]); }}>Skip for now</button>
      </div>
      {open && <ClassFlowModal start="pick" offer onClose={() => setOpen(false)} onDone={done} onSkip={async () => { await skipField(); onDone?.([]); }} />}
    </section>
  );
}
