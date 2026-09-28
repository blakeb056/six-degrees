'use client';

// Settings → Tiers. How the S to D rings are drawn: on your network's curve
// (your top 3% are S, and so on down), or on the fixed scale, the same lines
// for everyone. The curve only lifts, so a network full of companies the
// curated list knows keeps its tiers. The model is lib/scoring.js (CURVE,
// curvedTier); saving rescores everyone, as a new sector focus does, and says
// how many people changed tier (lib/settings-effects.js).

import { useEffect, useState } from 'react';
import { Section, Body, Status, LINE } from '../ui';
import { CURVE, CURVE_FLOOR } from '../../../lib/scoring';
import { csvNetworkSource } from '../../../lib/csv';

const pct = (x) => `${Math.round(x * 100)}%`;
const [S, A, B] = CURVE.map(([, share]) => share);
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const OPTIONS = [
  {
    key: 'curve',
    label: "On your network's curve",
    note: `Your top ${pct(S)} are S, the next ${pct(A - S)} A and the next ${pct(B - A)} B, so any network has a top, even one full of companies the app doesn't know. It only lifts: nobody drops a tier because their network is strong, and nobody under ${CURVE_FLOOR} is lifted into S or A.`,
  },
  {
    key: 'fixed',
    label: 'On the fixed scale',
    note: 'The same lines for everyone: S from 7.5, A from 5.5, B from 4, C from 2.5. Easy to compare from one network to another, but a network outside well-known companies has almost nobody in S or A.',
  },
];

export default function TierSection() {
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // A CSV import or the sample network held in this window: neither is changed
  // by this (a CSV is always graded on its own curve; the sample keeps its
  // tiers). This section only renders in the browser (OnboardingGate), so
  // reading sessionStorage here can't disagree with a server render.
  const [onScreen] = useState(() => (typeof window === 'undefined' ? null : csvNetworkSource()));

  useEffect(() => {
    let off = false;
    fetch('/api/settings')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Could not load how tiers are graded.')))))
      .then((d) => { if (!off) setSaved(d.settings?.tierScale || 'curve'); })
      .catch((e) => { if (!off) setLoadError(e.message); });
    return () => { off = true; };
  }, []);

  async function choose(key) {
    if (saving || key === saved) return;
    setSaving(true);
    setResult(null);
    try {
      const r = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { tierScale: key } }),
      });
      const d = await r.json();
      if (d.settings) setSaved(d.settings.tierScale);
      if (!r.ok) { setResult({ tone: 'bad', text: d.error || 'Could not save.' }); return; }
      const e = d.effects?.tierScale;
      setResult({ tone: 'ok', text: e ? `Saved. ${plural(e.moved, 'person', 'people')} changed tier.` : 'Saved.' });
    } catch {
      setResult({ tone: 'bad', text: 'Could not reach the app. Reload this page to see what is saved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section id="tiers" title="Tiers" intro="How the S to D rings are drawn. A tier says where someone sits in your network, not what they're worth.">
      {loadError && <Status tone="bad">{loadError}</Status>}
      {saved && (
        <div role="radiogroup" aria-label="How tiers are graded" style={{ display: 'grid', gap: 8 }}>
          {OPTIONS.map((o) => {
            const on = saved === o.key;
            return (
              <button key={o.key} type="button" role="radio" aria-checked={on} disabled={saving} onClick={() => choose(o.key)} style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 8, cursor: saving ? 'wait' : on ? 'default' : 'pointer', color: '#fff',
                background: on ? 'rgba(155,89,182,0.14)' : 'rgba(255,255,255,0.03)',
                border: on ? '1px solid rgba(155,89,182,0.6)' : LINE,
              }}>
                <div style={{ fontSize: 14, fontWeight: 650 }}>{on ? '● ' : '○ '}{o.label}{o.key === 'curve' ? ' (recommended)' : ''}</div>
                <Body style={{ marginTop: 4 }}>{o.note}</Body>
              </button>
            );
          })}
        </div>
      )}
      {onScreen && (
        <Body style={{ color: '#FFD700', marginTop: 10 }}>
          {onScreen === 'sample'
            ? 'The sample network open in this window keeps its own tiers (they’re the same either way).'
            : 'The CSV import open in this window is always graded on its own curve.'}{' '}
          This applies to networks you&rsquo;ve scanned.
        </Body>
      )}
      {result && <Status tone={result.tone}>{result.text}</Status>}
    </Section>
  );
}
