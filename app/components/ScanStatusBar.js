'use client';

// The scan status bar: while a scan runs, every page shows what it's doing,
// for whom, how far it's got, and today's LinkedIn budget, with Stop. Stop
// saves what was read, and the Scan page's Resume carries on from that page.
// It sits just under the header's tabs (Network Circle, Degrees…), on every
// page, the Scan page too (Blake, 2026-09-29). It only reports: the
// pacing and the caps live in the scanner (scripts/scrape.py, lib/linkedin-limits.js).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { watchScanner, scannerNow, stopScrape } from '../../lib/scraper-client';

const WHAT = {
  full: 'Scanning your network',
  refresh: 'Checking for new connections',
  bridge: 'Scanning a circle',
  resume: 'Carrying on with a circle',
  'resume-all': 'Carrying on with circles',
  'auto-bridge': 'Auto-Bridge',
  'auto-bridge-retry': 'Auto-Bridge',
  rescrape: 'Re-scanning a circle',
  login: 'Signing in to LinkedIn',
  setup: 'Setting up the scanner',
  company: 'Scanning a company',
  photos: 'Saving photos',
};

// Green while there's plenty left, amber past 60%, red past 90%.
const tone = (used, cap) => (!cap ? '#8b9a9a' : used / cap >= 0.9 ? '#ff6b6b' : used / cap >= 0.6 ? '#FFD700' : '#00ff88');

export default function ScanStatusBar() {
  const [job, setJob] = useState(() => scannerNow());
  const [stopping, setStopping] = useState(false);
  useEffect(() => watchScanner(() => {
    const now = scannerNow();
    setJob(now);
    if (!now.running) setStopping(false);
  }), []);
  if (!job?.running) return null;

  const p = job.progress;
  const step = p?.kind === 'batch' && p.total ? `${p.current || p.done || 0} of ${p.total}`
    : p?.kind === 'walk' && p.total ? `${(p.done || 0).toLocaleString()} of ${p.total.toLocaleString()} read`
    : p?.kind === 'saving' ? 'saving' : null;
  const b = job.budget;
  const last = [...(job.log || [])].reverse().find((l) => l && l.trim())?.trim();

  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', left: '50%', top: 'var(--scan-bar-top, 94px)', transform: 'translateX(-50%)', zIndex: 60,
      maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', whiteSpace: 'nowrap',
      padding: '8px 12px', borderRadius: 12, fontSize: 12, color: '#cfd8d8',
      background: 'rgba(14,16,32,0.94)', border: '1px solid rgba(0,255,136,0.25)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ff88', flexShrink: 0 }} />
      <b style={{ color: '#fff' }}>{WHAT[job.action] || 'Scanning'}</b>
      {job.target?.name && <span>{job.target.name}</span>}
      {step && <span style={{ color: '#8b9a9a' }}>{step}</span>}
      {b && (
        <span style={{ color: tone(b.searches, b.cap) }} title="Searches on your LinkedIn account in the last 24 hours, and your daily budget">
          {b.searches}{b.cap ? ` of ${b.cap}` : ''} searches today
        </span>
      )}
      {last && (
        <span style={{ color: '#667', flex: '0 1 240px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={last}>
          {last}
        </span>
      )}
      <Link href="/setup" style={{ color: '#3498DB', textDecoration: 'none' }}>Details</Link>
      <button
        onClick={async () => { setStopping(true); try { await stopScrape(); } catch { setStopping(false); } }}
        disabled={stopping}
        title="Stops after saving what's been read; Resume on the Scan page carries on from the same page"
        style={{
          padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: stopping ? 'default' : 'pointer',
          background: 'rgba(255,107,107,0.12)', color: '#ff9b9b', border: '1px solid rgba(255,107,107,0.35)',
        }}
      >{stopping ? 'Stopping…' : 'Stop'}</button>
    </div>
  );
}
