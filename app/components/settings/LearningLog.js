'use client';

// Settings → Your data → Learning log (lib/learning-log.js): the local record
// of who was shown where, what you opened, sent and skipped, how requests went,
// each scan's yield, each This or That answer and the account's load, kept so
// the class models have labels from day one. Its size, Export (one JSON file)
// and Delete learning log. It never leaves this computer.

import { useEffect, useState } from 'react';
import { Body, Btn, Status } from '../ui';

function size(bytes) {
  if (!(bytes > 0)) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function LearningLog() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const load = () => fetch('/api/learning?stats=1', { cache: 'no-store' }).then((r) => r.json()).then(setStats).catch(() => setStats({ events: 0, bytes: 0 }));
  useEffect(() => {
    let off = false;
    fetch('/api/learning?stats=1', { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (!off) setStats(d); }).catch(() => { if (!off) setStats({ events: 0, bytes: 0 }); });
    return () => { off = true; };
  }, []);

  async function exportLog() {
    setBusy('export'); setNote(null);
    try {
      const res = await fetch('/api/data/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export' }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The learning log could not be exported.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Sixgree learning log.json';
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
      setNote({ tone: 'ok', text: `Made “${name}” (${size(blob.size)}). Look for it in your Downloads folder.` });
    } catch (e) {
      setNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
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

  return (
    <div id="learning-log" style={{ marginTop: 24 }} data-learning-log="">
      <h3 style={{ fontSize: 14.5, fontWeight: 650, margin: '0 0 4px' }}>Learning log</h3>
      <Body style={{ marginTop: 0 }}>
        A record kept on this computer of who was shown where, what you opened, sent and skipped, how each request went, each
        scan’s yield, your This or That answers and LinkedIn’s load by the hour, so Sixgree can learn what works for you. It is
        never sent anywhere.
      </Body>
      <Body>
        {stats ? `${stats.events.toLocaleString()} ${stats.events === 1 ? 'event' : 'events'}, about ${size(stats.bytes)}${stats.first ? `, since ${new Date(stats.first).toLocaleDateString()}` : ''}.` : 'Reading its size…'}
      </Body>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Btn onClick={exportLog} disabled={!!busy || !stats?.events}>{busy === 'export' ? 'Exporting…' : 'Export (JSON)'}</Btn>
        <Btn tone="bad" onClick={deleteLog} disabled={!!busy || !stats?.events}>{busy === 'delete' ? 'Deleting…' : 'Delete learning log'}</Btn>
      </div>
      {note && <Status tone={note.tone}>{note.text}</Status>}
    </div>
  );
}
