'use client';

// The notch: a small pill hanging from the bottom of the header, centred, on
// every page (Blake, 2026-09-29: "a notch ui of the thing scanning"). It stays
// out of the way: nothing at all while nothing runs; a tiny dimmed "Auto scan"
// when the all-day mode is on but idle; while a scan runs, what it's doing and
// how far it's got. Hover or click it to open it: who, today's LinkedIn budget,
// the latest line, Details and Stop. Stop saves what was read, and the Scan
// page's Resume carries on from that page. Other long jobs can show here too
// (lib/island.js). It only reports: the pacing and the caps live in the scanner
// (scripts/scrape.py, lib/linkedin-limits.js).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { watchScanner, scannerNow, stopScrape } from '../../lib/scraper-client';
import { watchAllDay, allDayNow } from '../../lib/experimental-client';
import { watchActivities, activitiesNow, noActivities } from '../../lib/island';

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
  messages: 'Reading your messages list',
  'messages-full': 'Reading your whole messages history',
};

// Green while there's plenty left, amber past 60%, red past 90%.
const tone = (used, cap) => (!cap ? '#8b9a9a' : used / cap >= 0.9 ? '#ff6b6b' : used / cap >= 0.6 ? '#FFD700' : '#00ff88');

export default function ScanStatusBar() {
  const [job, setJob] = useState(() => scannerNow());
  const [stopping, setStopping] = useState(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const allDay = useSyncExternalStore(watchAllDay, allDayNow, () => false);
  const others = useSyncExternalStore(watchActivities, activitiesNow, noActivities);
  useEffect(() => watchScanner(() => {
    const now = scannerNow();
    setJob(now);
    if (!now.running) setStopping(false);
  }), []);

  // Hangs from the header's bottom edge, measured: the header can load late,
  // be swapped for a new one, or wrap to two rows.
  const pathname = usePathname();
  const [top, setTop] = useState(null);
  useEffect(() => {
    let header = null;
    let ro = null;
    let queued = 0;
    const measure = () => {
      queued = 0;
      const now = document.querySelector('header');
      if (now !== header) {
        ro?.disconnect();
        ro = null;
        header = now;
        if (header) { ro = new ResizeObserver(later); ro.observe(header); }
      }
      const at = header ? Math.round(header.getBoundingClientRect().bottom) : null;
      setTop((was) => (was === at ? was : at));
    };
    const later = () => { if (!queued) queued = requestAnimationFrame(measure); };
    later();
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', later);
    return () => { cancelAnimationFrame(queued); ro?.disconnect(); mo.disconnect(); window.removeEventListener('resize', later); };
  }, [pathname]);

  const running = !!job?.running;
  const other = others[others.length - 1] || null;
  if (!running && !other && !allDay) return null;

  const p = job?.progress;
  const step = p?.kind === 'batch' && p.total ? `${p.current || p.done || 0} of ${p.total}`
    : p?.kind === 'walk' && p.total ? `${(p.done || 0).toLocaleString()} of ${p.total.toLocaleString()}`
    : p?.kind === 'saving' ? 'saving' : null;
  const fraction = p?.total ? Math.min(1, (p.current || p.done || 0) / p.total) : other?.progress ?? null;
  const b = job?.budget;
  const last = running ? [...(job.log || [])].reverse().find((l) => l && l.trim())?.trim() : null;
  const expanded = open || pinned;

  // What the pill says, smallest first.
  const dot = running ? '#00ff88' : other ? (other.tone === 'warn' ? '#FFD700' : '#3498DB') : '#556';
  const label = running ? (WHAT[job.action] || 'Scanning') : other ? other.label : 'Auto scan';
  const short = running ? step : other ? other.detail : null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'fixed', left: '50%', top: top ?? 'var(--scan-bar-top, 94px)', transform: 'translateX(-50%)', zIndex: 60,
        maxWidth: 'calc(100vw - 32px)', minWidth: running || other ? 180 : 0,
        padding: expanded ? '8px 14px 10px' : '4px 12px 6px',
        borderRadius: '0 0 16px 16px', borderTop: 'none',
        border: `1px solid ${running ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.1)'}`,
        background: 'rgba(8,10,22,0.96)', color: '#cfd8d8', fontSize: 12,
        opacity: running || other || expanded ? 1 : 0.55,
        boxShadow: running ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
        transition: 'padding 0.18s ease, opacity 0.18s ease',
      }}
    >
      <button
        onClick={() => setPinned((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Close' : 'Open'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}
      >
        <span className={running ? 'notch-pulse' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <b style={{ color: running || other ? '#fff' : '#b8c4c4', fontWeight: 600 }}>{label}</b>
        {short && <span style={{ color: '#8b9a9a' }}>{short}</span>}
        {!running && !other && expanded && <span style={{ color: '#8b9a9a' }}>ready · press Auto scan beside Scan to start</span>}
      </button>
      {fraction != null && (
        <div style={{ height: 2, marginTop: 5, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(fraction * 100)}%`, height: '100%', background: running ? '#00ff88' : '#3498DB', transition: 'width 0.4s ease' }} />
        </div>
      )}
      {expanded && running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {job.target?.name && <span>{job.target.name}</span>}
          {b && (
            <span style={{ color: tone(b.searches, b.cap) }} title="Searches on your LinkedIn account in the last 24 hours, and your daily budget">
              {b.searches}{b.cap ? ` of ${b.cap}` : ''} searches today
            </span>
          )}
          {last && (
            <span style={{ color: '#667', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={last}>{last}</span>
          )}
          <Link href="/setup" style={{ color: '#3498DB', textDecoration: 'none' }}>Details</Link>
          <button
            onClick={async () => { setStopping(true); try { await stopScrape(); } catch { setStopping(false); } }}
            disabled={stopping}
            title="Stops after saving what's been read; Resume on the Scan page carries on from the same page"
            style={{
              padding: '3px 10px', borderRadius: 8, fontSize: 12, cursor: stopping ? 'default' : 'pointer',
              background: 'rgba(255,107,107,0.12)', color: '#ff9b9b', border: '1px solid rgba(255,107,107,0.35)',
            }}
          >{stopping ? 'Stopping…' : 'Stop'}</button>
        </div>
      )}
      {expanded && !running && other?.detail && <div style={{ marginTop: 6, color: '#8b9a9a' }}>{other.detail}</div>}
    </div>
  );
}
