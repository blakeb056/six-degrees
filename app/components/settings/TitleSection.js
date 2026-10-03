'use client';

// Settings → Scores → Titles (Blake, 2026-10-02): how much each kind of title
// counts, your way. Value founders, investors, or a role you're looking for
// (outbound, hiring: "find more in that role"), and everyone with it rises.
// Saving rescores everyone and says how many changed tier, as Tiers does.
// The setting and its presets are lib/title-ranking.js; scoring applies it
// (lib/scoring.js rankedPoints).

import { useEffect, useRef, useState } from 'react';
import { Section, Body, Status, Btn, LINE } from '../ui';
import { LEVELS } from '../../../lib/scoring';
import { RANKED_LEVELS, NO_RANKING, RANKING_PRESETS, MAX_ROLES, rankingFingerprint } from '../../../lib/title-ranking';
import { saveSettings } from '../../../lib/settings-client';

const POINTS = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3, 2, 1, 0];
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const select = {
  padding: '5px 8px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer',
  border: LINE, background: 'rgba(var(--sd-shade, 0, 0, 0), 0.3)', color: 'var(--sd-fg-1, #fff)',
};

export default function TitleSection({ onSaved } = {}) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [role, setRole] = useState('');
  const [rolePoints, setRolePoints] = useState(10);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const roleBox = useRef(null);

  useEffect(() => {
    let off = false;
    fetch('/api/settings')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Could not load your title ranking.')))))
      .then((d) => { if (!off) { const r = d.settings?.titleRanking || NO_RANKING; setSaved(r); setDraft(r); } })
      .catch((e) => { if (!off) setLoadError(e.message); });
    return () => { off = true; };
  }, []);

  if (!draft) return loadError ? <Status tone="bad">{loadError}</Status> : null;

  const pointsOf = (key) => draft.points?.[key] ?? LEVELS[key].points;
  const setPoints = (key, v) => {
    const points = { ...draft.points };
    if (v === LEVELS[key].points) delete points[key]; else points[key] = v;
    setDraft({ ...draft, points });
    setResult(null);
  };
  const addRole = () => {
    const text = role.trim().toLowerCase().replace(/\s+/g, ' ');
    if (text.length < 2) return;
    const roles = [...draft.roles.filter((r) => r.text !== text), { text, points: rolePoints }];
    setDraft({ ...draft, roles: roles.slice(-MAX_ROLES) });
    setRole('');
    setResult(null);
  };
  const dropRole = (text) => { setDraft({ ...draft, roles: draft.roles.filter((r) => r.text !== text) }); setResult(null); };
  const preset = RANKING_PRESETS.find((p) => p.ranking && rankingFingerprint(p.ranking) === rankingFingerprint(draft))?.key ?? null;
  const pick = (p) => {
    setResult(null);
    if (p.ranking) setDraft({ points: { ...p.ranking.points }, roles: [...p.ranking.roles] });
    else roleBox.current?.focus();
  };
  const dirty = rankingFingerprint(draft) !== rankingFingerprint(saved);

  async function save() {
    setSaving(true);
    setResult(null);
    const { settings, effects, error } = await saveSettings({ titleRanking: draft });
    if (settings) { setSaved(settings.titleRanking); setDraft(settings.titleRanking); }
    if (error) setResult({ tone: 'bad', text: error });
    else {
      const e = effects?.titleRanking;
      setResult({ tone: 'ok', text: e ? `Saved. ${plural(e.moved, 'person', 'people')} changed tier.` : 'Saved.' });
      onSaved?.();
    }
    setSaving(false);
  }

  return (
    <Section id="titles" title="Titles" intro="How much each kind of title counts towards someone's power, out of 10. Change it if you value some people more than the app does: founders, investors, or a role you're looking for.">
      {/* Starting points */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {RANKING_PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => pick(p)} aria-pressed={preset === p.key} title={p.note} style={{
            padding: '6px 12px', borderRadius: 16, fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
            border: preset === p.key ? '1px solid rgba(155,89,182,0.7)' : LINE,
            background: preset === p.key ? 'rgba(155,89,182,0.16)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', color: preset === p.key ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #bbb)',
          }}>{p.label}</button>
        ))}
      </div>
      <Body style={{ marginBottom: 14 }}>
        {RANKING_PRESETS.find((p) => p.key === preset)?.note || 'Your own ranking. Higher points rank higher; the company someone works at still weighs it.'}
      </Body>

      {/* The ladder */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 12px', alignItems: 'center', maxWidth: 520 }}>
        {RANKED_LEVELS.map((key) => {
          const mine = draft.points?.[key] != null;
          return [
            <div key={`${key}-l`} style={{ fontSize: 13, color: mine ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #ccc)', fontWeight: mine ? 700 : 500 }}>{LEVELS[key].label}</div>,
            <select key={`${key}-s`} aria-label={`Points for ${LEVELS[key].label}`} value={pointsOf(key)} onChange={(e) => setPoints(key, Number(e.target.value))}
              style={{ ...select, borderColor: mine ? 'rgba(155,89,182,0.7)' : undefined }}>
              {POINTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>,
            <div key={`${key}-d`} style={{ fontSize: 11, color: 'var(--sd-fg-4, #667)', minWidth: 70 }}>
              {mine ? <button type="button" onClick={() => setPoints(key, LEVELS[key].points)} style={{ background: 'none', border: 'none', color: 'var(--sd-fg-3, #9b9bd0)', cursor: 'pointer', fontSize: 11, padding: 0 }}>back to {LEVELS[key].points}</button> : 'as it comes'}
            </div>,
          ];
        })}
      </div>

      {/* Roles you're looking for */}
      <div style={{ marginTop: 18, fontSize: 13.5, fontWeight: 700, color: 'var(--sd-fg-1, #eee)' }}>Roles you&rsquo;re looking for</div>
      <Body style={{ margin: '4px 0 10px' }}>
        Anyone whose title has these words counts what you give them, whatever their level: for outbound to one role, or hiring for it. &ldquo;Account executive&rdquo; at 10 puts every account executive you can reach near the top.
      </Body>
      <form onSubmit={(e) => { e.preventDefault(); addRole(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={roleBox} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. head of growth, recruiter, founder"
          maxLength={60} style={{ flex: '1 1 220px', padding: '7px 10px', borderRadius: 6, fontSize: 13, border: LINE, background: 'rgba(var(--sd-shade, 0, 0, 0), 0.3)', color: 'var(--sd-fg-1, #fff)' }} />
        <select aria-label="Points for this role" value={rolePoints} onChange={(e) => setRolePoints(Number(e.target.value))} style={select}>
          {POINTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Btn type="submit" disabled={role.trim().length < 2 || draft.roles.length >= MAX_ROLES}>Add</Btn>
      </form>
      {draft.roles.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {draft.roles.map((r) => (
            <span key={r.text} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 11px', borderRadius: 14, fontSize: 12.5,
              border: '1px solid rgba(155,89,182,0.5)', background: 'rgba(155,89,182,0.12)', color: 'var(--sd-fg-1, #eee)',
            }}>
              {r.text} <b style={{ color: 'var(--sd-fg-2, #d2b4ff)' }}>{r.points}</b>
              <button type="button" onClick={() => dropRole(r.text)} aria-label={`Remove ${r.text}`} style={{ background: 'none', border: 'none', color: 'var(--sd-fg-3, #aaa)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <Btn primary onClick={save} disabled={!dirty || saving}>{saving ? 'Rescoring…' : 'Save and rescore'}</Btn>
        {dirty && <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #999)' }}>Not saved yet. Saving rescores everyone.</span>}
      </div>
      {result && <Status tone={result.tone}>{result.text}</Status>}
    </Section>
  );
}
