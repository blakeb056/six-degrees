'use client';

// S3, This or That (spec 6.4 to 6.9, and Blake's answers in 17): two cards,
// pick the one you'd rather have, or say both are great, or neither. Each
// class asks its own questions: the Grower about sectors and kinds of people,
// the others about positions, seniority and companies. Cards mix real titles
// from your network with made-up ones (a small "example" dot), and never show
// a name, a photo, a tier or anything about reaching them.
//
// Keys: left and right pick a card, up both great, down neither, space skip,
// Z undo. After each answer the build bars move and a line says who moved into
// class S. "Done for now" is always there; the server says when the answers
// are enough (lib/pairwise.js shouldStop).

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextDuel, answerDuel, undoDuel } from '../../../lib/class-client';
import { BuildBars } from './parts';

const Silhouette = () => (
  <span className="sil" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg>
  </span>
);

function Card({ card, same = [], chosen, onPick, hotkey }) {
  const v = card.view;
  const dim = (k) => (same.includes(k) ? 'same' : '');
  return (
    <button type="button" className={`cl-card${chosen ? ' chosen' : ''}`} onClick={onPick} aria-label={`Pick ${v.title}${v.company ? `, ${v.company.name}` : ''}`}>
      {v.madeUp && <span className="made" title="A made-up example, where your network had no good real one"><i />example</span>}
      <Silhouette />
      <span className={`t ${dim('title')}`}>{v.title}</span>
      {v.example && <span className="ex">{v.example}</span>}
      {v.company && <span className={`co ${dim('company')}`}>{v.company.name}<small>{v.company.label}</small></span>}
      {v.reach && <span className={`co ${dim('reach')}`} style={{ fontSize: 14 }}>{v.reach}</span>}
      <span className="meta">
        {v.industry && <span className={`pill ${dim('industry')}`}>{v.industry.label}</span>}
        {v.place && <span className={dim('place')}>{v.place.label}</span>}
      </span>
      <span className="key"><span className="cl-kbd">{hotkey}</span></span>
    </button>
  );
}

/**
 * The duels for class `cls`, in `mode` ('standard', 'quick', 'deep', 'tune',
 * 'retune'). `onDone()` when they're over (stopped by the rule, the most, or
 * Done for now). `compact` for a narrow column.
 */
export default function ThisOrThat({ cls, color, mode = 'standard', onDone, compact = false }) {
  const [duel, setDuel] = useState(null);
  const [progress, setProgress] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState(null);
  const shownAt = useRef(0);
  const done = useRef(false);
  // The caller's onDone, read when it's needed: a new function on each of the
  // caller's renders must never deal the duels again.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const take = useCallback((d) => {
    if (d.error) { setError(d.error); return; }
    setError(null);
    if (d.progress) setProgress(d.progress);
    if (d.feedback) setFeedback(d.feedback);
    if (d.done || !d.pair) {
      if (!done.current) { done.current = true; onDoneRef.current?.({ reason: d.reason || 'done' }); }
      return;
    }
    setDuel(d.pair);
    setChosen(null);
    shownAt.current = performance.now();
  }, []);

  useEffect(() => {
    let off = false;
    nextDuel(cls, mode).then((d) => { if (!off) take(d); });
    return () => { off = true; };
  }, [cls, mode, take]);

  const answer = useCallback(async (choice) => {
    if (!duel || busy || done.current) return;
    const ms = Math.round(performance.now() - shownAt.current);
    // Left and right are the screen's; the cards are a and b, sides chosen at random.
    const pick = choice === 'left' ? duel.left : choice === 'right' ? (duel.left === 'a' ? 'b' : 'a') : choice;
    setBusy(true);
    setChosen(choice === 'left' || choice === 'right' ? choice : null);
    const d = await answerDuel(cls, duel, pick, ms);
    setBusy(false);
    take(d);
  }, [duel, busy, cls, take]);

  const undo = useCallback(async () => {
    if (busy || done.current) return;
    setBusy(true);
    const d = await undoDuel(cls);
    setBusy(false);
    take(d);
  }, [busy, cls, take]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'both', ArrowDown: 'neither', ' ': 'skip' };
      if (map[e.key]) { e.preventDefault(); answer(map[e.key]); }
      else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, undo]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current?.({ reason: 'done-for-now' });
  };

  if (error && !duel) return <div className="cl-error" role="alert">{error}</div>;
  if (!duel) return <div className="cl-quiet" role="status">Dealing the first pair…</div>;

  const leftCard = duel.left === 'a' ? duel.a : duel.b;
  const rightCard = duel.left === 'a' ? duel.b : duel.a;
  const asked = progress?.asked ?? duel.index;
  const max = progress?.max ?? duel.total;
  return (
    <div className={`cl${compact ? ' compact' : ''}`} style={{ '--cl-class': color }} data-duel={duel.index} data-focus={duel.focus}>
      <div className="cl-duel-head">
        <span className="cl-duel-step">Duel {asked + 1} · Round {duel.roundNo} of {duel.rounds}: {duel.round?.label}</span>
        <span className="cl-spacer" />
        <span className="cl-quiet">{asked} of up to {max}</span>
      </div>
      <div className="cl-prompt">{duel.prompt}</div>
      <div className="cl-why">{duel.round?.why}{duel.mirrorOf != null ? ' One you’ve seen before, to check the answers hold.' : ''}</div>
      <div className={`cl-cards in`} key={`${duel.index}-${duel.a.view.title}-${duel.b.view.title}`}>
        <Card card={leftCard} same={duel.same} chosen={chosen === 'left'} onPick={() => answer('left')} hotkey="←" />
        <Card card={rightCard} same={duel.same} chosen={chosen === 'right'} onPick={() => answer('right')} hotkey="→" />
      </div>
      <div className="cl-answers" role="group" aria-label="Other answers">
        <button type="button" className="cl-btn secondary small" disabled={busy} onClick={() => answer('both')}>Both great <span className="cl-kbd">↑</span></button>
        <button type="button" className="cl-btn secondary small" disabled={busy} onClick={() => answer('neither')}>Neither <span className="cl-kbd">↓</span></button>
        <button type="button" className="cl-btn ghost small" disabled={busy} onClick={() => answer('skip')}>Skip <span className="cl-kbd">Space</span></button>
        <button type="button" className="cl-btn ghost small" disabled={busy || asked === 0} onClick={undo}>Undo <span className="cl-kbd">Z</span></button>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="cl-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="cl-quiet">Calibration: how sure your build is, not how many you’ve answered</span>
          <span className="cl-quiet">{Math.round((progress?.calibration || 0) * 100)}%</span>
        </div>
        <div className="cl-meter" role="progressbar" aria-label="Calibration" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.calibration || 0) * 100)}>
          <i style={{ width: `${Math.round((progress?.calibration || 0) * 100)}%` }} />
        </div>
      </div>
      {feedback && (
        <div className="cl-live" role="status" aria-live="polite">
          <span>Class S now: <b>{feedback.classS.toLocaleString()}</b> people</span>
          {feedback.moved > 0 && <span className="cl-new">{feedback.moved} moved in with that answer</span>}
        </div>
      )}
      {feedback?.bars && !compact && <div style={{ marginTop: 10, maxWidth: 420 }}><BuildBars bars={feedback.bars} /></div>}
      {error && <div className="cl-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      <div className="cl-row" style={{ marginTop: 14 }}>
        <span className="cl-quiet">No streaks, no pressure: stop whenever you like.</span>
        <span className="cl-spacer" />
        <button type="button" className="cl-btn ghost small" onClick={finish}>Done for now</button>
      </div>
    </div>
  );
}
