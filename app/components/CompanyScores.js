'use client';

// Paths → Scores: every company in your network, the score it carries into
// people's power, where that score comes from, and a control to set your own.
// Setting a score rescores everyone (app/api/company-scores → lib/scoring.js).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import LegacyScoresCard from './LegacyScoresCard';

const LINE = '1px solid rgba(255,255,255,0.1)';
const SOURCE = {
  yours: { label: 'your score', color: '#00ff88' },
  known: { label: 'known list', color: '#3498DB' },
  network: { label: 'estimated: many of your people', color: '#FF6B35' },
  default: { label: 'unknown company', color: '#778' },
};

async function fetchScores() {
  const r = await fetch('/api/company-scores');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Could not load company scores');
  return j.companies;
}

export function useCompanyScores() {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let off = false;
    fetchScores().then((c) => { if (!off) setCompanies(c); }).catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, []);
  const setScore = useCallback(async (name, score) => {
    const r = await fetch('/api/company-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, score }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Could not save');
    setCompanies(await fetchScores());
    return j;
  }, []);
  const reload = useCallback(async () => setCompanies(await fetchScores()), []);
  return { companies, error, setScore, reload };
}

/** A 1–10 picker; "auto" hands the score back to the list or the estimate. */
export function ScorePicker({ company, onSet, compact }) {
  const [busy, setBusy] = useState(false);
  const pick = async (v) => {
    setBusy(true);
    try { await onSet(company.name, v === 'auto' ? null : Number(v)); } finally { setBusy(false); }
  };
  return (
    <select disabled={busy} value={company.source === 'yours' ? String(company.score) : 'auto'} onChange={(e) => pick(e.target.value)}
      title="Set this company's score. Auto uses the known list or an estimate."
      style={{ padding: compact ? '2px 4px' : '4px 6px', borderRadius: 6, border: LINE, background: '#11131c', color: '#dfe6e9', fontSize: 12 }}>
      <option value="auto">Auto ({company.source === 'yours' ? (company.suggested ?? 'est.') : company.score})</option>
      {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

export default function CompanyScores({ onRescored }) {
  const { companies, error, setScore, reload } = useCompanyScores();
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState('all');
  const [limit, setLimit] = useState(150);
  const [toast, setToast] = useState(null);

  const say = (text) => {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
  };

  const set = async (name, score) => {
    const r = await setScore(name, score);
    say(`${name}: ${score == null ? 'back to auto' : `set to ${score}`} · rescored ${r.scored} people`);
    onRescored?.();
  };

  // The one-time "keep the old scores" card, answered: kept scores are yours
  // now, so the list and the network reload.
  const legacyAnswered = async ({ kept, scored, error: failed }) => {
    if (!kept.length) return say('Keeping the new built-in scores.');
    say(failed || `Kept ${kept.length} old ${kept.length === 1 ? 'score' : 'scores'} as your own · rescored ${scored} people`);
    await reload().catch(() => {});
    onRescored?.();
  };

  const shown = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    return companies.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (only === 'all' || c.source === only));
  }, [companies, query, only]);

  if (error) return <div style={{ padding: 24, color: '#e74c3c' }}>{error}</div>;
  if (!companies) return <div style={{ padding: 24, color: '#778' }}>Loading companies…</div>;

  const count = (src) => companies.filter((c) => c.source === src).length;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <LegacyScoresCard onAnswered={legacyAnswered} />
        <div style={{ padding: 14, borderRadius: 10, border: LINE, background: 'rgba(255,255,255,0.03)', fontSize: 12.5, color: '#cfd8d8', lineHeight: 1.6 }}>
          <b style={{ color: '#fff' }}>How a power score works.</b> power = <b>title</b> × <b>company weight</b> + bonus.
          The title (student 1 … founder or C-suite 10) comes from someone&rsquo;s current role, with former roles at 70%.
          The company weight runs from 0.615 (no company found) to 1.0 (a company scored 10), so seniority counts for more at a bigger company.
          The bonus is at most +1.5, for investor, YC or an audience in the millions, and counts half at an unknown company.
          A 1st-degree person whose circle is unusually strong gets up to +1 more.
          S ≥ 7.5 · A ≥ 5.5 · B ≥ 4 · C ≥ 2.5.
          <div style={{ marginTop: 6, color: '#8b9a9a' }}>
            So a VP at a 10 scores 9.0, a founder at an unknown company 6.7, a director at an unknown company 5.0, and an intern at a 10 scores 2.0.
            Set a company&rsquo;s score below and everyone there is rescored.
            Companies in the sectors you pick in <Link href="/settings#sector" style={{ color: '#3498DB' }}>Settings</Link> get +1 or +2; a score you set is never changed.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 10px' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a company"
            style={{ padding: '6px 10px', borderRadius: 7, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 13, minWidth: 180 }} />
          {[['all', `All ${companies.length}`], ['known', `Known list ${count('known')}`], ['yours', `Yours ${count('yours')}`], ['network', `Estimated ${count('network')}`], ['default', `Unknown ${count('default')}`]].map(([k, l]) => (
            <button key={k} onClick={() => setOnly(k)} style={{
              padding: '5px 10px', borderRadius: 7, border: LINE, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
              background: only === k ? 'rgba(52,152,219,0.25)' : 'transparent', color: only === k ? '#cfe6f7' : '#8b9a9a',
            }}>{l}</button>
          ))}
        </div>

        <div style={{ borderRadius: 10, border: LINE, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 70px 60px 180px 110px', gap: 8, padding: '8px 12px', fontSize: 10.5, letterSpacing: 0.6, color: '#8b9a9a', background: 'rgba(255,255,255,0.04)' }}>
            <span>COMPANY</span><span style={{ textAlign: 'right' }}>PEOPLE</span><span style={{ textAlign: 'right' }}>YOU KNOW</span><span style={{ textAlign: 'right' }}>DIRECTOR+</span>
            <span style={{ textAlign: 'right' }}>SCORE</span><span>SOURCE</span><span>SET</span>
          </div>
          {shown.slice(0, limit).map((c) => (
            <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 70px 60px 180px 110px', gap: 8, padding: '7px 12px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12.5 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span title={`${c.industry.label} (inferred)`} style={{ width: 8, height: 8, borderRadius: '50%', background: c.industry.color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </span>
              <span style={{ textAlign: 'right' }}>{c.people}</span>
              <span style={{ textAlign: 'right', color: c.d1 ? '#00ff88' : '#556' }}>{c.d1}</span>
              <span style={{ textAlign: 'right', color: c.senior ? '#FFD700' : '#556' }}>{c.senior}</span>
              <b style={{ textAlign: 'right', fontSize: 15 }}>{c.score}</b>
              <span style={{ fontSize: 11, color: SOURCE[c.source]?.color }}>
                {SOURCE[c.source]?.label}
                {c.sectorBonus > 0 && <span style={{ color: '#00ff88' }}> + {c.sectorBonus} your sector</span>}
              </span>
              <ScorePicker company={c} onSet={set} compact />
            </div>
          ))}
        </div>
        {shown.length > limit && (
          <button onClick={() => setLimit((n) => n + 300)} style={{ marginTop: 10, padding: '7px 14px', borderRadius: 8, border: LINE, background: 'rgba(255,255,255,0.05)', color: '#dfe6e9', cursor: 'pointer', fontSize: 12 }}>
            Show more ({shown.length - limit} left)
          </button>
        )}
      </div>
      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: 24, background: 'linear-gradient(135deg, #00ff88, #3498DB)', color: '#000', fontWeight: 800, fontSize: 13, zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
