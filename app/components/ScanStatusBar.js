'use client';

// The notch: a small bar hanging from the bottom of the header, under its tab
// buttons. It holds the page's own buttons (its views or sub-tabs, set through
// lib/island.js setNotchTabs) and, beside them, what the app is doing. On
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
import { watchActivities, activitiesNow, noActivities, watchNotchTabs, notchTabsNow, noNotchTabs, setNotchShown } from '../../lib/island';

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
  // The page's own buttons (its views or sub-tabs), when it has any.
  const tabs = useSyncExternalStore(watchNotchTabs, notchTabsNow, noNotchTabs);
  useEffect(() => watchScanner(() => {
    const now = scannerNow();
    setJob(now);
    if (!now.running) setStopping(false);
  }), []);

  // Hangs from the header's bottom edge, measured: the header can load late,
  // be swapped for a new one, or wrap to two rows.
  const pathname = usePathname();
  const [top, setTop] = useState(null);
  const [centre, setCentre] = useState(null);
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
      // Under the header's tab buttons when the page has them, else the window's middle.
      const group = document.getElementById('main-tabs')?.getBoundingClientRect();
      const mid = group && group.width ? Math.round(group.left + group.width / 2) : null;
      setCentre((was) => (was === mid ? was : mid));
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
  const status = running || other || allDay;
  // Pages with a heading at the top leave room for the notch while it's showing.
  const showing = Boolean(status || tabs);
  useEffect(() => {
    setNotchShown(showing);
    return () => setNotchShown(false);
  }, [showing]);
  if (!status && !tabs) return null;

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

  // Kept inside the window: centred under the tab buttons, but never off an edge.
  const left = centre != null ? `clamp(170px, ${centre}px, calc(100vw - 170px))` : '50%';

  return (
    <div
      data-glass-panel="bar"
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'fixed', left, top: top ?? 'var(--scan-bar-top, 94px)', transform: 'translateX(-50%)', zIndex: 60,
        maxWidth: 'calc(100vw - 16px)',
        padding: expanded && status ? '4px 6px 10px' : '4px 6px 5px',
        borderRadius: '0 0 14px 14px', border: `1px solid ${running ? 'rgba(0,255,136,0.25)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)'}`, borderTop: 'none',
        background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)', fontSize: 12,
        opacity: tabs || running || other || expanded ? 1 : 0.55,
        boxShadow: running ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
        transition: 'padding 0.18s ease, opacity 0.18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
        {tabs && (
          <div role="tablist" aria-label="View" style={{ display: 'flex', gap: 2 }}>
            {tabs.items.map((t) => {
              const on = t.key === tabs.current;
              return (
                <button
                  key={t.key} role="tab" aria-selected={on} title={t.title}
                  onClick={() => tabs.onPick(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 8, border: 'none',
                    cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
                    background: on ? 'rgba(52,152,219,0.22)' : 'transparent', color: on ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-3, #8b9aa8)',
                  }}
                >
                  {t.icon && <span aria-hidden="true">{t.icon}</span>}
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
        {tabs && status && <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', margin: '3px 4px', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' }} />}
        {status && (
          <button
            onMouseEnter={() => setOpen(true)}
            onClick={() => setPinned((v) => !v)}
            aria-expanded={expanded}
            title={expanded ? 'Close' : 'Open'}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: '5px 8px', whiteSpace: 'nowrap' }}
          >
            <span className={running ? 'notch-pulse' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
            <span role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ color: running || other ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)', fontWeight: 600 }}>{label}</b>
              {short && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>{short}</span>}
            </span>
            {!running && !other && expanded && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>ready · press Auto scan beside Scan to start</span>}
          </button>
        )}
      </div>
      {status && fraction != null && (
        <div style={{ height: 2, margin: '3px 6px 0', borderRadius: 2, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(fraction * 100)}%`, height: '100%', background: running ? '#00ff88' : '#3498DB', transition: 'width 0.4s ease' }} />
        </div>
      )}
      {expanded && running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 8px 0', flexWrap: 'wrap' }}>
          {job.target?.name && <span>{job.target.name}</span>}
          {b && (
            <span style={{ color: tone(b.searches, b.cap) }} title="Searches on your LinkedIn account in the last 24 hours, and your daily budget">
              {b.searches}{b.cap ? ` of ${b.cap}` : ''} searches today
            </span>
          )}
          {last && (
            <span style={{ color: 'var(--sd-fg-4, #667)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={last}>{last}</span>
          )}
          <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Details</Link>
          <button
            onClick={async () => { setStopping(true); try { await stopScrape(); } catch { setStopping(false); } }}
            disabled={stopping}
            title="Stops after saving what's been read; Resume on the Scan page carries on from the same page"
            style={{
              padding: '3px 10px', borderRadius: 8, fontSize: 12, cursor: stopping ? 'default' : 'pointer',
              background: 'rgba(255,107,107,0.12)', color: 'var(--sd-fg-2, #ff9b9b)', border: '1px solid rgba(255,107,107,0.35)',
            }}
          >{stopping ? 'Stopping…' : 'Stop'}</button>
        </div>
      )}
      {expanded && !running && other?.detail && <div style={{ margin: '6px 8px 0', color: 'var(--sd-fg-3, #8b9a9a)' }}>{other.detail}</div>}
    </div>
  );
}
