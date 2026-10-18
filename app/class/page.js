'use client';

// The Class tab (spec section 8, the Phase 1 skeleton): your class and its
// build, read-only bars and dials, the class-ranked list, and the quadrant of
// class worth against network worth. Class tiers are a second, labelled lens:
// every row says "Class S" on the class's hexagon and "Network A" on the
// network's dot, and nothing here changes a network tier.
//
// With no class yet, the tab is the class pick. ?start=1 opens the flow.
// Later phases add the abilities (Pipeline board first), ranks and milestones.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppHeader from '../components/AppHeader';
import OnboardingGate from '../components/OnboardingGate';
import useNotchTabs from '../components/useNotchTabs';
import useRequests from '../components/useRequests';
import { CLASS_CSS } from '../components/class/styles';
import ClassFlow, { ClassFlowModal } from '../components/class/ClassFlow';
import { Emblem, BuildBars, BuildWords, Dials, PersonRow } from '../components/class/parts';
import { AskButton } from '../components/insights/parts';
import { loadClass, retake } from '../../lib/class-client';
import { logExposure } from '../../lib/learning-client';
import { hasRequest } from '../../lib/requests-client';
import { IS_DEMO } from '../../lib/demo';

export default function ClassPage() {
  return <OnboardingGate><Suspense><ClassInner /></Suspense></OnboardingGate>;
}

const TIER_FILL = { S: 'var(--sd-tier-s, #f6c344)', A: 'var(--sd-tier-a, #a78bfa)', B: 'var(--sd-tier-b, #60a5fa)', C: 'var(--sd-tier-c, #4caf63)', D: 'var(--sd-tier-d, #6b7280)' };

/** Class worth (up) against network worth (across), each as a percentile of your pool. */
function Quadrant({ quadrant }) {
  const pts = quadrant?.points || [];
  const z = quadrant?.zones || {};
  return (
    <div>
      <div className="cl-quad" role="img" aria-label={`Class worth against network worth: ${z.act || 0} act first, ${z.destinations || 0} destinations, ${z.bridges || 0} bridges, ${z.background || 0} background`}>
        <svg viewBox="0 0 125 100" preserveAspectRatio="none" aria-hidden="true">
          <rect x="62.5" y="0" width="62.5" height="50" fill="color-mix(in srgb, var(--sd-tier-s, #f6c344) 10%, transparent)" />
          <line x1="62.5" y1="0" x2="62.5" y2="100" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.18)" strokeWidth="0.3" />
          <line x1="0" y1="50" x2="125" y2="50" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.18)" strokeWidth="0.3" />
          {pts.map(([x, y, ct], i) => (
            <circle key={i} cx={2 + x * 121} cy={98 - y * 96} r={ct === 'S' ? 1.1 : ct === 'A' ? 0.85 : 0.55} fill={TIER_FILL[ct] || TIER_FILL.D} opacity={ct === 'S' || ct === 'A' ? 0.95 : 0.45} />
          ))}
        </svg>
        <span className="cl-zone" style={{ right: 0, top: 0, textAlign: 'right' }}>Act first<small>{(z.act || 0).toLocaleString()} high on both</small></span>
        <span className="cl-zone" style={{ left: 0, top: 0 }}>Destinations<small>{(z.destinations || 0).toLocaleString()} high class, low network</small></span>
        <span className="cl-zone" style={{ right: 0, bottom: 0, textAlign: 'right' }}>Bridges<small>{(z.bridges || 0).toLocaleString()} high network, low class</small></span>
        <span className="cl-zone" style={{ left: 0, bottom: 0 }}>Background<small>{(z.background || 0).toLocaleString()}</small></span>
      </div>
      <div className="cl-row cl-quiet" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span>Across: network worth (power score)</span><span>Up: class worth (your build)</span>
      </div>
    </div>
  );
}

function Meters({ meters }) {
  if (!meters) return null;
  return (
    <div className="cl-meters">
      <div><b>Taste</b>{meters.duels} {meters.duels === 1 ? 'duel' : 'duels'} + {meters.sends.toLocaleString()} {meters.sends === 1 ? 'send' : 'sends'} logged</div>
      <div><b>Acceptance</b>Learning: {Math.min(meters.timed, 30)} of 30 timed accepts</div>
      <div><b>Warmth</b>{meters.timed} timed {meters.timed === 1 ? 'accept' : 'accepts'}{meters.timed ? '' : ' yet'}</div>
      <div><b>Send time</b>0 of 150 timed sends (needs time zones)</div>
    </div>
  );
}

function ClassInner() {
  const params = useSearchParams();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [list, setList] = useState('reach');
  const [modal, setModal] = useState(null);
  const [more, setMore] = useState(20);
  const [flow, setFlow] = useState(() => params.get('start') === '1');
  const requests = useRequests();
  useNotchTabs(null);

  const load = useCallback(async () => {
    const d = await loadClass({ people: true });
    if (d.error) setError(d.error); else { setState(d); setError(null); }
  }, []);
  useEffect(() => {
    let off = false;
    loadClass({ people: true }).then((d) => { if (off) return; if (d.error) setError(d.error); else setState(d); });
    return () => { off = true; };
  }, []);

  const meta = state?.classes?.find((c) => c.key === state.class);
  const b = state?.build;
  const people = state?.people;
  const shownList = list === 'reach' && people?.reach?.length ? 'reach' : people?.yours?.length ? (list === 'reach' && !people?.reach?.length ? 'yours' : list) : list;
  const rows = useMemo(() => (shownList === 'reach' ? people?.reach : people?.yours) || [], [people, shownList]);
  // The learning log: who the class list shows, in order, as drawn.
  useEffect(() => { if (rows.length && state?.class) logExposure('class', rows.slice(0, more), { sort: `class:${state.class}`, context: shownList }); }, [rows, more, state?.class, shownList]);

  if (IS_DEMO) {
    return <div className="cl" style={{ padding: 40, textAlign: 'center' }}><style>{CLASS_CSS}</style>Classes are part of the app, not the public demo.</div>;
  }

  const ids = rows.map((r) => r.id);
  const body = !state ? (
    <div className="cl-quiet" role="status">{error || 'Loading your class…'}</div>
  ) : (!state.class || flow) ? (
    <div className="cl-panel">
      <ClassFlow start="pick" onDone={async () => { setFlow(false); await load(); }} onSkip={state.class ? () => setFlow(false) : undefined} />
    </div>
  ) : (
    <>
      <div className="cl-panel cl-hero" style={{ '--cl-class': meta?.color }}>
        <Emblem cls={state.class} color={meta?.color} size={64} title={meta?.name} />
        <div className="meta">
          <div className="cl-eyebrow">Your class</div>
          <h1 className="cl-h1" style={{ margin: '2px 0 4px' }}>{meta?.name}</h1>
          <div className="cl-quiet">{meta?.who} Hunts: {meta?.hunts}. Ability: {meta?.ability} (coming).</div>
          <div className="cl-quiet" style={{ marginTop: 4 }}>Class tiers are a second lens. Your network tiers are unchanged.</div>
        </div>
        <div className="cl-row">
          <button type="button" className="cl-btn secondary small" onClick={() => setModal({ steps: ['duels'], mode: 'tune', start: 'duels' })}>Tune (30 s)</button>
          <button type="button" className="cl-btn secondary small" onClick={() => setModal({ steps: ['duels', 'reveal'], mode: 'retune', start: 'duels' })}>Retune</button>
          <button type="button" className="cl-btn ghost small" onClick={async () => {
            if (!window.confirm(`Clear your ${meta?.name} answers and take its questions again? Your other classes keep theirs.`)) return;
            await retake(state.class);
            setModal({ steps: ['target', 'duels', 'avoid', 'reveal'], mode: 'standard', start: 'target' });
          }}>Retake</button>
          <Link href="/settings#class" className="cl-btn ghost small" style={{ textDecoration: 'none' }}>Respec</Link>
        </div>
      </div>

      <div className="cl-two">
        <div className="cl-panel" style={{ '--cl-class': meta?.color }}>
          <div className="cl-row" style={{ marginBottom: 10 }}>
            <h2 className="cl-h2" style={{ margin: 0 }}>Your build</h2>
            <span className="cl-spacer" />
            <span className="cl-quiet">{b?.answers ? `${b.answers} answers · calibration ${Math.round((b.calibration || 0) * 100)}%` : b?.skipped ? 'The preset, as it comes' : 'No answers yet'}</span>
          </div>
          <BuildBars bars={b?.bars || []} />
          <BuildWords top={b?.top || []} />
          <Dials dials={b?.dials} />
          {b && (
            <div className="cl-quiet" style={{ marginTop: 10 }}>
              Class S {b.counts.S.toLocaleString()} · A {b.counts.A.toLocaleString()} (network S {b.network.S.toLocaleString()} · A {b.network.A.toLocaleString()})
              {b.setup?.sectors?.length ? ` · sectors: ${b.setup.sectors.map((k) => state.questions.industries.find((g) => g.key === k)?.label || k).join(', ')}` : ''}
              {b.home ? ` · your city: ${b.home}` : ''}
              {b.floors ? ' · floors on: S must beat “nobody”' : ''}
            </div>
          )}
        </div>
        <div className="cl-panel">
          <h2 className="cl-h2">Class worth against network worth</h2>
          <Quadrant quadrant={people?.quadrant} />
        </div>
      </div>

      <div className="cl-panel">
        <div className="cl-row" style={{ marginBottom: 12 }}>
          <h2 className="cl-h2" style={{ margin: 0 }}>Ranked by your class</h2>
          <span className="cl-spacer" />
          <span className="cl-tabs" role="group" aria-label="Which people">
            <button type="button" aria-pressed={shownList === 'reach'} onClick={() => { setList('reach'); setMore(20); }} disabled={!people?.reach?.length}>People you could add</button>
            <button type="button" aria-pressed={shownList === 'yours'} onClick={() => { setList('yours'); setMore(20); }}>Your connections</button>
          </span>
        </div>
        {!rows.length ? <div className="cl-quiet">Nobody to rank here yet.</div> : (
          <div className="cl-people">
            {rows.slice(0, more).map((p, i) => (
              <PersonRow key={p.id} p={p}>
                {p.degree === 2 && (
                  <AskButton row={p} bridgeId={p.source_connection_id} compact asked={p.requested || hasRequest(p, requests)}
                    exposure={{ list: `class:${state.class}`, rank: i + 1, sort: 'class', shown: ids.slice(0, 50) }} />
                )}
              </PersonRow>
            ))}
          </div>
        )}
        {rows.length > more && (
          <div className="cl-row" style={{ marginTop: 10 }}>
            <button type="button" className="cl-btn ghost small" onClick={() => setMore(more + 20)}>Show {Math.min(20, rows.length - more)} more</button>
          </div>
        )}
        {people?.nevers ? <div className="cl-quiet" style={{ marginTop: 8 }}>{people.nevers} vetoed with Not this one or Never stay off this list.</div> : null}
      </div>

      <div className="cl-panel">
        <h2 className="cl-h2">What each prediction rests on</h2>
        <Meters meters={state.meters} />
        {state.meters?.warmth && (
          <div className="cl-row" style={{ marginTop: 12, gap: 8 }}>
            {state.meters.warmth.map((w) => (
              <span key={w.key} className="cl-word">{w.label}{w.within != null ? ` (within ${w.within} ${w.within === 1 ? 'day' : 'days'})` : ''}: {w.n}</span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'var(--sd-font)' }}>
      <AppHeader active="class" />
      <style>{CLASS_CSS}</style>
      <main className="cl cl-tab" data-class-tab={state?.class || 'none'}>{body}</main>
      {modal && state?.class && (
        <ClassFlowModal cls={state.class} start={modal.start} steps={modal.steps} mode={modal.mode}
          onClose={() => setModal(null)} onDone={() => load()} />
      )}
    </div>
  );
}
