'use client';

// Paths → Scores: the one-time offer to keep the curated list's old scores as
// your own, after the list was made neutral (lib/legacy-offer.js decides who
// sees it and what "keep" writes). It sits at the top of the Scores tab until
// it's answered, then never shows again. Not while a CSV import or the sample
// is on screen: those aren't scored on the server, so the offer isn't theirs.

import { useEffect, useState } from 'react';
import { csvNetworkSource } from '../../lib/csv';

const SHOWN = 3;   // changes named in the summary line before "and N more"

const change = (c) => `${c.name} ${c.was} → ${c.estimated ? 'estimated' : c.now}`;

function summary(companies) {
  const named = companies.slice(0, SHOWN).map(change).join(', ');
  const more = companies.length - SHOWN;
  return more > 0 ? `${named} and ${more} more` : named;
}

const button = (primary) => ({
  padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700,
  border: primary ? 'none' : '1px solid rgba(255,255,255,0.15)',
  background: primary ? 'linear-gradient(135deg, #00ff88, #3498DB)' : 'transparent',
  color: primary ? '#000' : '#cfd8d8',
});

/** `onAnswered({kept, scored, error?})` runs once the answer is saved. */
export default function LegacyScoresCard({ onAnswered }) {
  const [offer, setOffer] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (csvNetworkSource()) return;
    let off = false;
    fetch('/api/company-scores/legacy')
      .then((r) => r.json())
      .then((j) => {
        if (off || !j.offer?.companies?.length) return;
        setOffer(j.offer);
        setPicked(new Set(j.offer.companies.map((c) => c.name)));
      })
      .catch(() => { /* no card; the scores below work regardless */ });
    return () => { off = true; };
  }, []);

  if (!offer) return null;

  const answer = async (keep) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/company-scores/legacy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep }),
      });
      const j = await r.json();
      // A failed rescore after the answer was saved still answers it.
      if (!r.ok && !j.kept) throw new Error(j.error || 'Could not save your answer.');
      setOffer(null);
      onAnswered?.({ kept: j.kept || [], scored: j.scored || 0, error: r.ok ? null : j.error });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (name) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <section aria-label="Built-in scores changed" style={{
      marginBottom: 14, padding: 14, borderRadius: 10, border: '1px solid rgba(255,215,0,0.35)',
      background: 'rgba(255,215,0,0.06)', fontSize: 12.5, color: '#cfd8d8', lineHeight: 1.6,
    }}>
      <b style={{ color: '#fff' }}>Built-in scores changed in this version:</b> {summary(offer.companies)}.
      {' '}Keep any of the old ones as your own?
      <div style={{ marginTop: 4, color: '#8b9a9a' }}>
        The built-in list now holds only companies most professionals would recognise, scored the same for
        everyone; anything else is estimated from your network. A score you keep is yours, like one you set
        below, and Auto hands it back.
      </div>

      {choosing && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 4 }}>
          {offer.companies.map((c) => (
            <li key={c.name}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(c.name)} disabled={busy} onChange={() => toggle(c.name)} />
                <span>
                  <b style={{ color: '#fff' }}>{c.name}</b> {c.was} → {c.estimated ? `estimated (${c.now})` : c.now}
                  <span style={{ color: '#778' }}>
                    {` · ${c.people} ${c.people === 1 ? 'person' : 'people'} there now`}
                    {c.names.length > 1 && ` · for ${c.names.join(', ')}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {choosing ? (
          <>
            <button disabled={busy || !picked.size} onClick={() => answer([...picked])} style={{ ...button(true), opacity: busy || !picked.size ? 0.5 : 1 }}>
              Keep {picked.size} {picked.size === 1 ? 'score' : 'scores'}
            </button>
            <button disabled={busy} onClick={() => setChoosing(false)} style={button(false)}>Back</button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={() => answer(offer.companies.map((c) => c.name))} style={button(true)}>Keep all</button>
            <button disabled={busy} onClick={() => setChoosing(true)} style={button(false)}>Choose…</button>
          </>
        )}
        <button disabled={busy} onClick={() => answer([])} style={button(false)}>No thanks</button>
      </div>
      {error && <div role="alert" style={{ marginTop: 8, color: '#e74c3c' }}>{error}</div>}
    </section>
  );
}
