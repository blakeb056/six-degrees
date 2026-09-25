'use client';

// Settings → Your sector. Up to three industries you work in; companies in them
// count for more when your scanned network is scored, like setting their scores
// by hand on Paths → Scores, but for a whole sector at once. The model is
// lib/scoring.js; the setting is lib/sector-focus.js.
//
// Before you save, the page asks the app what would change (a dry run that
// writes nothing). Saving stores the choice with your network and rescores
// everyone, the way a company score change does.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Section, Body, Status, Btn, LINE } from '../ui';
import { INDUSTRIES, industryByKey } from '../../../lib/companies';
import { MAX_SECTORS, sameFocus, focusFingerprint } from '../../../lib/sector-focus';
import { SECTOR_BONUS } from '../../../lib/scoring';
import { TIER_COLORS_CLASSIC } from '../../../lib/tiers';
import { csvNetworkSource } from '../../../lib/csv';

const STRENGTH_LABEL = { lean: 'Lean', strong: 'Strong' };
// What says the reader has taken over the page (see the jump to #sector).
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
const DEGREE = { 1: '1st', 2: '2nd', 3: '3rd' };
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "120 people move up a tier and 4 move down." (or "moved", after a save) */
function tierLine(up, down, past) {
  const [goes, go] = past ? ['moved', 'moved'] : ['moves', 'move'];
  if (!up && !down) return past ? 'No one changed tier.' : 'No one changes tier.';
  const verb = (n) => (n === 1 ? goes : go);
  if (up && down) return `${plural(up, 'person', 'people')} ${verb(up)} up a tier and ${down.toLocaleString()} ${verb(down)} down.`;
  return up ? `${plural(up, 'person', 'people')} ${verb(up)} up a tier.` : `${plural(down, 'person', 'people')} ${verb(down)} down a tier.`;
}

export default function SectorSection() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // A CSV import or the sample network held in this window. This section only
  // renders in the browser (the page waits in OnboardingGate), so reading
  // sessionStorage here can't disagree with a server render.
  const [onScreen] = useState(() => (typeof window === 'undefined' ? null : csvNetworkSource()));
  const timer = useRef(null);
  const ticket = useRef(0);
  const jumped = useRef(false);

  useEffect(() => {
    let off = false;
    fetch('/api/settings')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Could not load your sector.')))))
      .then((d) => {
        if (off) return;
        const focus = d.settings?.sectorFocus || { sectors: [], strength: 'lean' };
        setSaved(focus);
        setDraft(focus);
      })
      .catch((e) => { if (!off) setLoadError(e.message); });
    return () => { off = true; clearTimeout(timer.current); };
  }, []);

  // Links to /settings#sector (the profile's card, Paths → Scores) arrive
  // before this section has loaded, so the browser's own jump to it finds
  // nothing. Jump once it's here, then keep it in place while what loads above
  // it (Updates) pushes it down: the browser only holds steady what's already
  // on screen, and that is the page's header. Following stops as soon as the
  // reader scrolls, clicks or types, and after two seconds regardless.
  useEffect(() => {
    if (jumped.current || (!draft && !loadError)) return;
    jumped.current = true;
    const el = document.getElementById('sector');
    if (window.location.hash !== '#sector' || !el) return;
    const jump = () => el.scrollIntoView({ block: 'start' });
    jump();
    const follow = new ResizeObserver(jump);
    follow.observe(document.body);
    const stop = () => {
      follow.disconnect();
      clearTimeout(done);
      for (const e of READER_INPUT) window.removeEventListener(e, stop, true);
    };
    const done = setTimeout(stop, 2000);
    for (const e of READER_INPUT) window.addEventListener(e, stop, { capture: true, passive: true });
    return stop;
  }, [draft, loadError]);

  // Every change asks for a fresh dry run, a moment after the last click.
  // Only the newest answer is kept.
  function change(next) {
    setDraft(next);
    setResult(null);
    clearTimeout(timer.current);
    const mine = ++ticket.current;
    if (sameFocus(next, saved)) { setPreview(null); return; }
    const key = focusFingerprint(next);
    setPreview({ key, loading: true });
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/settings/sector-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sectorFocus: next }),
        });
        const d = await r.json();
        if (mine !== ticket.current) return;
        setPreview(r.ok ? { key, ...d } : { key, error: d.error || 'Could not work out what would change.' });
      } catch {
        if (mine === ticket.current) setPreview({ key, error: 'Could not reach the app to work out what would change.' });
      }
    }, 250);
  }

  function toggle(key) {
    const on = draft.sectors.includes(key);
    if (!on && draft.sectors.length >= MAX_SECTORS) return;
    const sectors = on ? draft.sectors.filter((k) => k !== key) : INDUSTRIES.map((i) => i.key).filter((k) => k === key || draft.sectors.includes(k));
    change({ ...draft, sectors });
  }

  async function save() {
    setSaving(true);
    setResult(null);
    clearTimeout(timer.current);
    ticket.current++;
    try {
      const r = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { sectorFocus: draft } }),
      });
      const d = await r.json();
      if (d.settings) { setSaved(d.settings.sectorFocus); setDraft(d.settings.sectorFocus); setPreview(null); }
      if (!r.ok) { setResult({ tone: 'bad', text: d.error || 'Could not save.' }); return; }
      setResult({ tone: 'ok', text: savedLine(d.settings.sectorFocus, d.effects?.sectorFocus) });
    } catch {
      setResult({ tone: 'bad', text: 'Could not reach the app. Reload this page to see what is saved.' });
    } finally {
      setSaving(false);
    }
  }

  const changed = draft && saved && !sameFocus(draft, saved);
  const full = draft && draft.sectors.length >= MAX_SECTORS;

  return (
    <Section id="sector" title="Your sector"
      intro="Pick up to three sectors you work in. Companies in them count for more when your network is scored, so the people there rank higher.">
      {loadError && <Status tone="bad">{loadError}</Status>}
      {!draft && !loadError && <Body>Loading…</Body>}

      {draft && (
        <>
          <div role="group" aria-label="Sectors" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {INDUSTRIES.map((i) => {
              const on = draft.sectors.includes(i.key);
              const blocked = !on && full;
              return (
                <button key={i.key} type="button" aria-pressed={on} disabled={blocked || saving}
                  onClick={() => toggle(i.key)}
                  title={blocked ? `Up to ${MAX_SECTORS} sectors. Turn one off first.` : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999,
                    fontSize: 12.5, fontWeight: 600, cursor: blocked ? 'not-allowed' : 'pointer',
                    color: on ? '#fff' : blocked ? '#556' : '#b8c4c4',
                    background: on ? `${i.color}33` : 'rgba(255,255,255,0.04)',
                    border: on ? `1px solid ${i.color}` : LINE,
                  }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: i.color, opacity: blocked ? 0.4 : 1, flexShrink: 0 }} />
                  {i.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <span style={{ fontSize: 13, color: '#8b9a9a' }}>How much:</span>
            {Object.keys(SECTOR_BONUS).map((s) => (
              <button key={s} type="button" aria-pressed={draft.strength === s} disabled={saving}
                onClick={() => change({ ...draft, strength: s })}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  color: draft.strength === s ? '#fff' : '#8b9a9a',
                  background: draft.strength === s ? 'rgba(52,152,219,0.25)' : 'transparent', border: LINE,
                }}>
                {STRENGTH_LABEL[s]} · +{SECTOR_BONUS[s]}
              </button>
            ))}
          </div>
          <Body style={{ fontSize: 12.5 }}>
            Each company in your sectors gets +1 (lean) or +2 (strong) on its score out of 10, never above 10.
          </Body>

          <Preview preview={changed ? preview : null} draft={draft} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <Btn primary onClick={save} disabled={!changed || saving}>{saving ? 'Saving and rescoring…' : 'Save'}</Btn>
            {changed && !saving && <Btn onClick={() => change(saved)}>Cancel</Btn>}
            {!changed && draft.sectors.length > 0 && !saving && (
              <Btn onClick={() => change({ ...draft, sectors: [] })}>Turn off</Btn>
            )}
          </div>
          {result && <Status tone={result.tone}>{result.text}</Status>}

          <ul style={{ margin: '16px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#778', lineHeight: 1.7 }}>
            <li>Tiers rank how reachable someone is through your network, not the people themselves.</li>
            <li>A company score you set on <Link href="/paths?tab=scores" style={{ color: '#3498DB' }}>Paths → Scores</Link> always wins. Your sector never changes it.</li>
            <li>If you scan highest tier first, people in your sectors come up sooner. Scanning newest first, the default, doesn&rsquo;t go by tier.</li>
            <li>A company&rsquo;s sector comes from the app&rsquo;s list of well-known companies, else its name, else what most of its people&rsquo;s headlines say. Where that&rsquo;s unclear, the company doesn&rsquo;t change.</li>
            {onScreen && (
              <li style={{ color: '#FFD700' }}>
                {onScreen === 'sample' ? 'The sample network' : 'The CSV import'} open in this window isn&rsquo;t changed by this.
                Your sector applies to networks you&rsquo;ve scanned.
              </li>
            )}
          </ul>
        </>
      )}
    </Section>
  );
}

/** "Saved: …. Rescored your network (N people). …" */
function savedLine(focus, effect) {
  // The labels have commas of their own ("Finance, VC & Crypto"), so a dot
  // separates them.
  const what = focus.sectors.length
    ? `Saved: ${focus.sectors.map((k) => industryByKey(k).label).join(' · ')} (${STRENGTH_LABEL[focus.strength].toLowerCase()}).`
    : 'Saved: no sector.';
  if (!effect) return what;
  if (!effect.scored) return `${what} There's no scanned network yet; it will apply when you scan.`;
  // People, once each, as the tier moves count them: someone in two circles is
  // two rows but one person.
  return `${what} Rescored your network (${plural(effect.people ?? effect.scored, 'person', 'people')}). ${tierLine(effect.up, effect.down, true)}`;
}

function Preview({ preview, draft }) {
  if (!preview) return null;
  if (preview.key !== focusFingerprint(draft)) return null;
  const box = { marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6, border: LINE, background: 'rgba(255,255,255,0.03)', color: '#cfd8d8' };
  if (preview.loading) return <div style={box} aria-live="polite">Working out what would change…</div>;
  if (preview.error) return <Status tone="bad">{preview.error}</Status>;
  if (!preview.scored) {
    return <div style={box} aria-live="polite">There&rsquo;s no scanned network yet, so nothing changes now. Your choice applies once you scan.</div>;
  }
  const scores = (n, way) => `${plural(n, 'company', 'companies')} ${n === 1 ? 'scores' : 'score'} ${way}`;
  const cos = [
    preview.companiesUp && scores(preview.companiesUp, 'higher'),
    preview.companiesDown && scores(preview.companiesDown, 'lower'),
  ].filter(Boolean).join(' and ');
  return (
    <div style={box} aria-live="polite">
      <div>
        <b style={{ color: '#fff' }}>If you save:</b> {cos ? `${cos}.` : 'No company changes score.'} {tierLine(preview.up, preview.down, false)}
      </div>
      {preview.examples?.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12.5 }}>
          {preview.examples.map((e, n) => (
            <span key={n} title={e.company || undefined}>
              {e.name}{e.degree ? <span style={{ color: '#667' }}> ({DEGREE[e.degree] || `${e.degree}th`})</span> : null}{' '}
              <b style={{ color: TIER_COLORS_CLASSIC[e.from] || '#889' }}>{e.from || '–'}</b>
              {' → '}
              <b style={{ color: TIER_COLORS_CLASSIC[e.to] || '#889' }}>{e.to}</b>
            </span>
          ))}
        </div>
      )}
      {preview.companyExamples?.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#8b9a9a' }}>
          {preview.companyExamples.slice(0, 3).map((c) => `${c.name} ${c.from} → ${c.to}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
