'use client';

// Settings → Your data → Learning log (lib/learning-log.js, the taxonomy in
// lib/behavior-taxonomy.js): the local record of how Sixgree is used and what
// came of it, kept so the class models and any analysis later have true data
// from day one. "Record my behaviour (local only)", on until it's turned off:
// off, only the outcomes and the send log are kept, which the models need.
// The counts per kind, Export (one JSON file), Export CSV (a zip with a CSV per
// kind) and Delete learning log. It never leaves this computer.

import { useEffect, useId, useState } from 'react';
import { Body, Btn, Status } from '../ui';
import { saveSettings } from '../../../lib/settings-client';
import { setBehaviourOn } from '../../../lib/learning-client';

function size(bytes) {
  if (!(bytes > 0)) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The kinds in plain words, in the order the page lists them.
const KIND_LABELS = [
  ['session', 'Sessions'], ['nav', 'Tabs and time on them'], ['control', 'Filters, sorts and searches'], ['focus', 'Focus and dives'],
  ['interaction', 'People opened and acted on'], ['section', 'Sections opened and seen'], ['exposure', 'Lists shown'],
  ['onboarding', 'Classes and This or That'], ['scan', 'Scans'], ['panel', 'LinkedIn panel'], ['settings', 'Settings changed'],
  ['health', 'Errors and speed'], ['outcome', 'Request outcomes'], ['load', 'LinkedIn load by the hour'], ['snapshot', 'Person snapshots'],
];

async function download(action, fallback) {
  const res = await fetch('/api/data/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The learning log could not be exported.');
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallback;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { name, bytes: blob.size };
}

export default function LearningLog() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const id = useId();
  const load = () => fetch('/api/learning?stats=1', { cache: 'no-store' }).then((r) => r.json()).then(setStats).catch(() => setStats({ events: 0, bytes: 0 }));
  useEffect(() => {
    let off = false;
    fetch('/api/learning?stats=1', { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (!off) setStats(d); }).catch(() => { if (!off) setStats({ events: 0, bytes: 0 }); });
    return () => { off = true; };
  }, []);
  const on = stats?.on !== false;

  async function exportAs(action) {
    setBusy(action); setNote(null);
    try {
      const { name, bytes } = await download(action, action === 'export' ? 'Sixgree learning log.json' : 'Sixgree learning log (CSV).zip');
      setNote({ tone: 'ok', text: `Made “${name}” (${size(bytes)}). Look for it in your Downloads folder.` });
    } catch (e) {
      setNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function record(next) {
    setBusy('switch'); setNote(null);
    setStats((s) => (s ? { ...s, on: next } : s));
    setBehaviourOn(next);
    const { settings, error } = await saveSettings({ recordBehaviour: next });
    if (error) {
      setNote({ tone: 'bad', text: error });
      setBehaviourOn(!next);
    } else if (settings) {
      setBehaviourOn(settings.recordBehaviour !== false);
    }
    setBusy(null);
    load();
  }

  async function deleteLog() {
    if (!window.confirm('Delete the learning log? Every recorded event goes, for good. Your network, requests and settings stay.')) return;
    setBusy('delete'); setNote(null);
    try {
      const res = await fetch('/api/data/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', confirm: true }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'The learning log could not be deleted.');
      setStats(d.stats);
      setNote({ tone: 'ok', text: `Deleted ${d.deleted.toLocaleString()} ${d.deleted === 1 ? 'event' : 'events'}.` });
    } catch (e) {
      setNote({ tone: 'bad', text: e.message });
      load();
    } finally {
      setBusy(null);
    }
  }

  const kinds = KIND_LABELS.filter(([k]) => stats?.byKind?.[k] > 0);
  return (
    <div id="learning-log" style={{ marginTop: 24 }} data-learning-log="">
      <h3 style={{ fontSize: 14.5, fontWeight: 650, margin: '0 0 4px' }}>Learning log</h3>
      <Body style={{ marginTop: 0 }}>
        A record kept on this computer of how you use Sixgree and what came of it: your sessions and time on each tab, the
        filters, sorts and searches you use (a search for a person keeps only its length, never the name), who was shown where,
        whose cards and profiles you opened and for how long, what you sent and how each request went, your This or That
        answers, each scan&rsquo;s pages and yield, the LinkedIn panel, settings you change, and errors and slow moments. It is
        kept until you delete it, so Sixgree can learn what works for you, and it is never sent anywhere.
      </Body>

      <div data-behaviour-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 12 }}>
        <input id={id} type="checkbox" checked={on} disabled={!stats || busy === 'switch'} onChange={(e) => record(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
        <div style={{ minWidth: 0 }}>
          <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Record my behaviour (local only)
          </label>
          <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
            {on
              ? 'On: everything above is recorded on this computer.'
              : 'Off: only your requests and how they went are kept (the send log and its outcomes), which the models need. Nothing else is recorded.'}
          </div>
        </div>
      </div>

      <Body>
        {stats ? `${stats.events.toLocaleString()} ${stats.events === 1 ? 'event' : 'events'}, about ${size(stats.bytes)}${stats.first ? `, since ${new Date(stats.first).toLocaleDateString()}` : ''}.` : 'Reading its size…'}
      </Body>
      {kinds.length > 0 && (
        <ul data-learning-kinds="" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '2px 16px', fontSize: 12.5 }}>
          {kinds.map(([k, label]) => (
            <li key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--sd-fg-2, #aab7c4)' }}>
              <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.byKind[k].toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Btn onClick={() => exportAs('export')} disabled={!!busy || !stats?.events}>{busy === 'export' ? 'Exporting…' : 'Export (JSON)'}</Btn>
        <Btn onClick={() => exportAs('export-csv')} disabled={!!busy || !stats?.events}>{busy === 'export-csv' ? 'Exporting…' : 'Export (CSV per kind)'}</Btn>
        <Btn tone="bad" onClick={deleteLog} disabled={!!busy || !stats?.events}>{busy === 'delete' ? 'Deleting…' : 'Delete learning log'}</Btn>
      </div>
      {note && <Status tone={note.tone}>{note.text}</Status>}
    </div>
  );
}
