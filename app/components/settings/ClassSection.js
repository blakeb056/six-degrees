'use client';

// Settings → Class (Blake, 10/17: "the class is changeable in Settings";
// "answers are saved per class"). Switch class here: a class with a saved
// build comes back exactly as it was, with no questions; one with none runs
// its questions. Retune adds a few duels to this class's answers; Retake
// clears this class's answers (its target stays) and asks again. Other
// classes keep theirs either way.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Section, Body, Status } from '../ui';
import { CLASS_CSS } from '../class/styles';
import { Emblem } from '../class/parts';
import { ClassFlowModal } from '../class/ClassFlow';
import { loadClass, pickClass, retake } from '../../../lib/class-client';

export default function ClassSection() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const d = await loadClass();
    if (d.error) setError(d.error); else setState(d);
  };
  useEffect(() => {
    let off = false;
    loadClass().then((d) => { if (!off) { if (d.error) setError(d.error); else setState(d); } });
    return () => { off = true; };
  }, []);

  async function choose(c) {
    if (busy || c.key === state.class) return;
    setBusy(c.key); setNote(null);
    const d = await pickClass(c.key);
    setBusy(null);
    if (d.error) { setNote({ tone: 'bad', text: d.error }); return; }
    setState(d.state);
    if (d.needsQuestions || d.needsTarget) {
      setModal({ cls: c.key, start: d.needsTarget ? 'target' : 'duels', steps: ['target', 'duels', 'avoid', 'reveal'], mode: 'standard' });
    } else {
      setNote({ tone: 'ok', text: `You’re a ${c.name} again: your saved build is back, as you left it (${c.status.answers} answers).` });
    }
  }

  const current = state?.classes?.find((c) => c.key === state.class);
  return (
    <Section id="class" title="Class" intro="Your class ranks the same network for what you’re after: a second lens beside the network tiers, which it never changes. Each class keeps its own answers, so switching back restores it exactly.">
      <style>{CLASS_CSS}</style>
      {error && <Status tone="bad">{error}</Status>}
      {state && (
        <div className="cl">
          <div className="cl-grid" role="radiogroup" aria-label="Your class">
            {state.classes.map((c) => {
              const on = c.key === state.class;
              return (
                <button key={c.key} type="button" role="radio" aria-checked={on} disabled={Boolean(busy)} onClick={() => choose(c)} data-class={c.key}
                  className={`cl-pick${on ? ' sel' : ''}`} style={{ '--cl-class': c.color, minHeight: 112 }}>
                  <span className="cl-face front" style={{ position: 'relative', inset: 'auto', height: '100%', padding: 14 }}>
                    {on && <span className="tag">Your class</span>}
                    <span className="nm"><Emblem cls={c.key} color={c.color} size={34} />{c.name}</span>
                    <span className="kv">{busy === c.key ? 'Switching…' : c.status?.saved && c.status.answers > 0 ? `Saved build: ${c.status.answers} answers` : c.status?.saved && c.status.skipped ? 'Saved: the preset' : 'No answers yet: switching asks its questions'}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {current && (
            <div className="cl-row" style={{ marginTop: 12 }}>
              <button type="button" className="cl-btn secondary small" onClick={() => setModal({ cls: current.key, start: 'duels', steps: ['duels', 'reveal'], mode: 'retune' })}>Retune {current.name} (8 duels)</button>
              <button type="button" className="cl-btn secondary small" onClick={() => setModal({ cls: current.key, start: 'target', steps: ['target'], mode: 'standard' })}>Edit the target</button>
              <button type="button" className="cl-btn secondary small" onClick={() => setModal({ cls: current.key, start: 'avoid', steps: ['avoid'], mode: 'standard' })}>Never show me</button>
              <button type="button" className="cl-btn ghost small" onClick={async () => {
                if (!window.confirm(`Clear your ${current.name} answers and take its questions again? Your other classes keep theirs.`)) return;
                await retake(current.key);
                setModal({ cls: current.key, start: 'target', steps: ['target', 'duels', 'avoid', 'reveal'], mode: 'standard' });
              }}>Retake</button>
              <span className="cl-spacer" />
              <Link href="/class" className="cl-btn ghost small" style={{ textDecoration: 'none' }}>Open the Class tab</Link>
            </div>
          )}
          {!state.class && <Body style={{ marginTop: 10 }}>No class yet: pick one above, and its questions follow.</Body>}
        </div>
      )}
      {note && <Status tone={note.tone}>{note.text}</Status>}
      {modal && (
        <ClassFlowModal cls={modal.cls} start={modal.start} steps={modal.steps} mode={modal.mode}
          onClose={() => { setModal(null); load(); }} onDone={() => setNote({ tone: 'ok', text: 'Saved. Your class tiers are updated.' })} />
      )}
    </Section>
  );
}
