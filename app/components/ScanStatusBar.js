'use client';

// The notch: a small bar hanging from the bottom of the header, under its tab
// buttons. It holds the page's own buttons (its views or sub-tabs, set through
// lib/island.js setNotchTabs) and, beside them, what the app is doing. On
// every page (Blake, 2026-09-29: "a notch ui of the thing scanning"), and every
// page has buttons there, if only its one view lit. What's running stays out of
// the way: nothing at all while nothing runs; a tiny dimmed "Auto scan"
// when the all-day mode is on but idle; while a scan runs, what it's doing and
// how far it's got. Hover or click it to open it: who, the LinkedIn budget over
// the last 24 hours (a link to Scan → LinkedIn usage), the latest line,
// Details and Stop. Stop saves what was read, and the Scan page's Resume
// carries on from that page. Other long jobs can show here too
// (lib/island.js). It only reports: the pacing and the caps live in the scanner
// (scripts/scrape.py, lib/linkedin-limits.js).
//
// The queue (lib/scan-queue.js; Blake, 2026-10-05: "have it shown in the
// notch"): "+2 queued" beside what runs, and opened, who waits and for what
// (Add, Build circle), each removable, with Clear. Stop holds the queue until
// Resume queue; so does a restart.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { watchScanner, scannerNow, stopScrape, removeQueued, clearQueued, resumeQueue } from '../../lib/scraper-client';
import { KIND_LABEL } from '../../lib/scan-queue';
import { watchAllDay, allDayNow } from '../../lib/experimental-client';
import { watchActivities, activitiesNow, noActivities, watchNotchTabs, notchTabsNow, noNotchTabs, setNotchShown, isCurrentTab, notchGroups } from '../../lib/island';

// The thin line between the page's buttons and what's running, and between two rows of choice.
const DIVIDER = { width: 1, alignSelf: 'stretch', margin: '3px 4px', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' };

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
  connect: 'Sending a connection request',
};

// Why the queue waits for you, in the notch's words.
const PAUSED = { stopped: 'Queue paused after Stop', restarted: 'Queue kept from last time' };

// The notch's small buttons in the queue's list.
const SMALL = {
  padding: '2px 9px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', font: 'inherit',
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-2, #cfd8d8)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)',
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
  // be swapped for a new one, or wrap to two rows. On a page that scrolls
  // (Settings, Profile, Scan) it follows the header up and then waits at the
  // window's top edge, so the page's buttons stay in reach. It used to be
  // measured only when something on the page changed: scrolled, it stayed
  // where it was, over the page, until any change sent it off the top with the
  // header, and scrolling back left it there.
  const pathname = usePathname();
  const [top, setTop] = useState(null);
  const barRef = useRef(null);
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
      const at = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : null;
      // Straight onto the bar too, so a scroll moves it in the frame it scrolls in.
      if (barRef.current && at != null) barRef.current.style.top = `${at}px`;
      setTop((was) => (was === at ? was : at));
      // Under the header's tab buttons when the page has them, else the window's middle.
      const group = document.getElementById('main-tabs')?.getBoundingClientRect();
      const mid = group && group.width ? Math.round(group.left + group.width / 2) : null;
      setCentre((was) => (was === mid ? was : mid));
    };
    const later = () => { if (!queued) queued = requestAnimationFrame(measure); };
    later();
    // Measuring waits for the next frame, which drew the notch once over the
    // blank page: hidden here, before that frame is painted, the moment the
    // header goes (and shown again the moment it's back).
    const mo = new MutationObserver(() => {
      if (barRef.current) barRef.current.style.visibility = document.querySelector('header') ? '' : 'hidden';
      later();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', later);
    // At once, not on the next frame: a scroll is drawn in the frame it happens.
    const onScroll = () => { cancelAnimationFrame(queued); measure(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(queued); ro?.disconnect(); mo.disconnect();
      window.removeEventListener('resize', later); window.removeEventListener('scroll', onScroll);
    };
  }, [pathname]);

  const running = !!job?.running;
  const other = others[others.length - 1] || null;
  const queue = job?.queue;
  const queued = queue?.items || [];
  const waiting = queue?.waiting || 0;
  const status = running || other || allDay || queued.length > 0;
  // Pages with a heading at the top leave room for the notch while it's showing.
  const showing = Boolean(status || tabs);
  useEffect(() => {
    setNotchShown(showing);
    return () => setNotchShown(false);
  }, [showing]);
  if (!status && !tabs) return null;
  // Only with a page under it: between tabs the next page has no header until
  // it has loaded, and the notch would hang over a blank screen (Blake,
  // 2026-10-03: "the notch is seen the whole time as the screen blanks out
  // loading to the next … have it appear with the section"). It fades in with it.
  if (top == null) return null;

  const p = job?.progress;
  const step = p?.kind === 'batch' && p.total ? `${p.current || p.done || 0} of ${p.total}`
    : p?.kind === 'walk' && p.total ? `${(p.done || 0).toLocaleString()} of ${p.total.toLocaleString()}`
    : p?.kind === 'saving' ? 'saving' : null;
  const fraction = p?.total ? Math.min(1, (p.current || p.done || 0) / p.total) : other?.progress ?? null;
  const b = job?.budget;
  const last = running ? [...(job.log || [])].reverse().find((l) => l && l.trim())?.trim() : null;
  const expanded = open || pinned;

  // The scanner's Chrome stays out of sight and comes forward only when LinkedIn
  // needs you (signing in, a security check): then the notch says so, in gold,
  // on every page (Blake, 2026-10-04: no pop-ups, no windows unless needed).
  const needs = running ? job.needsYou : null;
  // What the pill says, smallest first.
  // Nothing running but someone queued: the queue waits for you (paused), or
  // the next one starts in a moment.
  const queueOnly = !running && !other && queued.length > 0;
  const nextName = queued.find((i) => i.status === 'waiting')?.target?.name;
  const dot = needs ? '#FFD700' : running ? '#00ff88' : other ? (other.tone === 'warn' ? '#FFD700' : '#3498DB')
    : queueOnly ? (queue.paused || !waiting ? '#FFD700' : '#00ff88') : '#556';
  const label = needs ? 'LinkedIn needs you' : running ? (WHAT[job.action] || 'Scanning') : other ? other.label
    : queueOnly ? (!waiting ? 'Queue: skipped' : queue.paused ? 'Queue paused' : 'Up next') : 'Auto scan';
  const short = needs ? needs.replace(/\.$/, '') : running ? step : other ? other.detail
    : queueOnly ? (!waiting ? `${queued.length} couldn’t start` : queue.paused ? `${waiting} waiting` : nextName || null) : null;
  // "+2 queued" beside what runs.
  const more = (running || other) && waiting > 0 ? `+${waiting} queued` : null;

  // Kept inside the window: centred under the tab buttons, but never off an edge.
  const left = centre != null ? `clamp(170px, ${centre}px, calc(100vw - 170px))` : '50%';

  return (
    <div
      ref={barRef}
      data-glass-panel="bar"
      data-notch=""
      className="notch-in"
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'fixed', left, top, transform: 'translateX(-50%)', zIndex: 60,
        maxWidth: 'calc(100vw - 16px)',
        padding: expanded && status ? '4px 6px 10px' : '4px 6px 5px',
        // Width, style and colour apart: the colour changes while it shows (gold when
        // LinkedIn needs you), and React warns about a shorthand beside borderTop.
        borderRadius: '0 0 14px 14px', borderStyle: 'solid', borderWidth: '0 1px 1px',
        borderColor: needs ? 'rgba(255,215,0,0.5)' : running ? 'rgba(0,255,136,0.25)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)',
        background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)', fontSize: 12,
        opacity: tabs || running || other || expanded || queued.length ? 1 : 0.55,
        boxShadow: running ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
        transition: 'padding 0.18s ease, opacity 0.18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
        {/* One row of tabs, or two after a thin line (lib/island.js `divided`), each with its own lit tab */}
        {tabs && notchGroups(tabs.items).map((group, g) => (
          <Fragment key={group[0].key}>
            {g > 0 && <span aria-hidden="true" style={DIVIDER} />}
            <div role="tablist" aria-label={group[0].group || 'View'} style={{ display: 'flex', gap: 2 }}>
              {group.map((t) => {
                const on = isCurrentTab(tabs, t.key);
                return (
                  <button
                    key={t.key} role="tab" aria-selected={on} title={t.title}
                    onClick={() => tabs.onPick(t.key)}
                    className="sd-tab sd-subtab"
                    style={{ gap: 6, padding: '5px 11px', whiteSpace: 'nowrap', fontSize: 12 }}
                  >
                    {t.icon && <span aria-hidden="true">{t.icon}</span>}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
        {tabs && status && <span aria-hidden="true" style={DIVIDER} />}
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
              {more && (
                <span data-queue-count style={{
                  padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                  background: 'rgba(52,152,219,0.18)', color: 'var(--sd-fg-1, #cfe6f7)',
                }}>{more}</span>
              )}
            </span>
            {!running && !other && !queueOnly && expanded && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>ready · press Auto scan beside Scan to start</span>}
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
          {/* A rolling 24 hours, as the budget counts them (lib/linkedin-limits.js usage), not
              since midnight; it opens Scan → LinkedIn usage for the rest. */}
          {b && (
            <Link href="/setup#usage" style={{ color: tone(b.searches, b.cap), textDecoration: 'none' }} title="Searches on your LinkedIn account in the last 24 hours, and your daily budget. Open LinkedIn usage">
              {b.searches}{b.cap ? ` of ${b.cap}` : ''} searches in the last 24 hours
            </Link>
          )}
          {last && (
            <span style={{ color: 'var(--sd-fg-4, #667)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={last}>{last}</span>
          )}
          <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Details</Link>
          <button
            onClick={async () => { setStopping(true); try { await stopScrape(); } catch { setStopping(false); } }}
            disabled={stopping}
            title={waiting ? "Stops after saving what's been read, and holds the queue until you resume it" : "Stops after saving what's been read; Resume on the Scan page carries on from the same page"}
            style={{
              padding: '3px 10px', borderRadius: 8, fontSize: 12, cursor: stopping ? 'default' : 'pointer',
              background: 'rgba(255,107,107,0.12)', color: 'var(--sd-fg-2, #ff9b9b)', border: '1px solid rgba(255,107,107,0.35)',
            }}
          >{stopping ? 'Stopping…' : 'Stop'}</button>
        </div>
      )}
      {expanded && !running && other?.detail && <div style={{ margin: '6px 8px 0', color: 'var(--sd-fg-3, #8b9a9a)' }}>{other.detail}</div>}
      {expanded && queued.length > 0 && (
        <div data-queue="" style={{ margin: '8px 8px 0', minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: running || other ? 8 : 0, borderTop: running || other ? '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)' : 'none' }}>
            <span style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {waiting ? `Queued · ${waiting}` : 'Queue'}
            </span>
            {queue.paused && waiting > 0 && <span style={{ color: 'var(--sd-gold, #FFD700)', fontSize: 11.5 }}>{PAUSED[queue.paused] || 'Queue paused'}</span>}
            <span style={{ flex: 1 }} />
            {queue.paused && waiting > 0 && (
              <button type="button" onClick={() => resumeQueue().catch(() => {})} style={{ ...SMALL, color: 'var(--sd-green, #00ff88)', borderColor: 'rgba(0,255,136,0.35)' }}
                title={running ? 'The next one starts when this one finishes' : 'Start the next one now'}>Resume queue</button>
            )}
            <button type="button" onClick={() => clearQueued().catch(() => {})} style={SMALL} title="Take everyone out of the queue">Clear</button>
          </div>
          <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {queued.map((it, i) => (
              <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 16, textAlign: 'right', color: 'var(--sd-fg-4, #667)', fontVariantNumeric: 'tabular-nums' }}>
                  {it.status === 'waiting' ? i + 1 : '–'}
                </span>
                <span style={{ color: it.status === 'waiting' ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-3, #8b9a9a)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.target?.name || 'Someone'}
                </span>
                <span style={{
                  padding: '0 6px', borderRadius: 5, fontSize: 10.5, fontWeight: 700,
                  background: it.kind === 'add' ? 'rgba(255,165,0,0.16)' : 'rgba(0,255,136,0.12)',
                  color: it.kind === 'add' ? 'var(--sd-gold, #FFB347)' : 'var(--sd-green, #00ff88)',
                }}>{KIND_LABEL[it.kind] || it.kind}</span>
                {it.status === 'skipped' && (
                  <span title={it.reason || undefined} style={{ color: 'var(--sd-red, #ff8a7a)', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Skipped: {it.reason}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" aria-label={`Remove ${it.target?.name || 'this one'} from the queue`} title="Remove from the queue"
                  onClick={() => removeQueued(it.id).catch(() => {})}
                  style={{ ...SMALL, padding: '0 7px', lineHeight: '18px', fontSize: 13 }}>×</button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
