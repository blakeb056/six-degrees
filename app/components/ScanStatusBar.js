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
// The daily limit (Blake, 2026-10-05: "Just a simple default limit for the day
// and a button to lift restrictions for this session"): opened while a scan
// runs, its line has the number to change; once the limit holds a scan back,
// the notch says so with "Lift limits for this session" and what that does;
// while they're lifted, a small gold "Limits lifted" and "Put limits back".
//
// The queue (lib/scan-queue.js; Blake, 2026-10-05: "have it shown in the
// notch"): "+2 queued" beside what runs, and opened, who waits and for what
// (Add, Build circle), each removable, with Clear. Stop holds the queue until
// Resume queue; so does a restart.
//
// Tucked up (Blake, 2026-10-05: "a small minimal arrow in it to put it up in
// case the user doesn't want to see it"): the ⌃ at its right end slides it up
// and away, leaving a thin pill under the header with the notch's dot in it;
// the pill, or ⌘. (Ctrl+.), brings it back. Remembered (lib/island.js). Only
// LinkedIn needing you brings it down by itself, once. It's laid over the page,
// so tucking it moves nothing, and the page keeps the room it left for it.

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  watchScanner, scannerNow, stopScrape, removeQueued, clearQueued, resumeQueue, liftLimitsForSession, putLimitsBack, setDailyLimit,
} from '../../lib/scraper-client';
import { DailyLimitInput, LiftLimits, LiftedTag } from './LinkedInLimits';
import { KIND_LABEL } from '../../lib/scan-queue';
import { watchAllDay, allDayNow } from '../../lib/experimental-client';
import { autoStatus } from '../../lib/auto-scan';
import {
  watchActivities, activitiesNow, noActivities, watchNotchTabs, notchTabsNow, noNotchTabs, setNotchShown, isCurrentTab, notchGroups,
  watchNotchTucked, notchTuckedNow, notTucked, setNotchTucked, isTuckKey, comesBackDown,
} from '../../lib/island';

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
  'read-profiles': 'Reading full profiles',
};

// Why the queue waits for you, in the notch's words.
const PAUSED = { stopped: 'Queue paused after Stop', restarted: 'Queue kept from last time' };

// The notch's small buttons in the queue's list.
const SMALL = {
  padding: '2px 9px', borderRadius: 7, fontSize: 11.5, cursor: 'pointer', font: 'inherit',
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-2, #cfd8d8)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)',
};

// The tuck's chevron: up in the notch, down in the pill.
const Chevron = ({ down = false }) => (
  <svg aria-hidden="true" width="10" height="6" viewBox="0 0 10 6" style={{ display: 'block', transform: down ? 'rotate(180deg)' : undefined }}>
    <path d="M1 5 5 1.2 9 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The shortcut as this computer writes it. Only drawn after the first frame
// (the notch waits to be measured), so it can't differ from the server's.
const tuckKeyName = () => (typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent || '') ? '⌘.' : 'Ctrl+.');

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
  const tucked = useSyncExternalStore(watchNotchTucked, notchTuckedNow, notTucked);
  // The daily limit holding a scan back opens the notch by itself, once each
  // time, so the lift is a click away from the press that was refused.
  const heldRef = useRef(false);
  useEffect(() => watchScanner(() => {
    const now = scannerNow();
    setJob(now);
    if (!now.running) setStopping(false);
    const held = !now.running && now.limits?.reached === true;
    if (held && !heldRef.current) setPinned(true);
    heldRef.current = held;
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
  const pillRef = useRef(null);
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
      // Straight onto the bar (and the tucked pill) too, so a scroll moves it in the frame it scrolls in.
      if (at != null) for (const el of [barRef.current, pillRef.current]) if (el) el.style.top = `${at}px`;
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
  // The daily limit held a scan back (and nothing else is going on), or it's lifted for this session.
  const limits = job?.limits || {};
  const lifted = limits.lifted === true;
  const limitHeld = !running && limits.reached === true;
  const status = running || other || allDay || queued.length > 0 || limitHeld || lifted;
  // Pages with a heading at the top leave room for the notch while it's showing.
  const showing = Boolean(status || tabs);
  useEffect(() => {
    setNotchShown(showing);
    return () => setNotchShown(false);
  }, [showing]);

  // ⌘. (Ctrl+.) tucks it and brings it back, wherever the focus is; only while
  // there's a notch to tuck.
  useEffect(() => {
    if (!showing) return undefined;
    const onKey = (e) => {
      if (!isTuckKey(e) || e.defaultPrevented) return;
      e.preventDefault();
      setNotchTucked(!notchTuckedNow());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showing]);

  // LinkedIn needing you brings it down by itself, once each time it starts.
  const needsNow = running ? job.needsYou || null : null;
  const neededRef = useRef(null);
  useEffect(() => {
    if (comesBackDown(neededRef.current, needsNow)) setNotchTucked(false);
    neededRef.current = needsNow;
  }, [needsNow]);

  // The focus follows the button you pressed: tucked from the ⌃, it lands on
  // the pill; back from the pill, on the ⌃. (Not from the shortcut: the focus
  // stays where you were working.)
  const tuckRef = useRef(null);
  const handOff = useRef(false);
  useEffect(() => {
    if (!handOff.current) return;
    handOff.current = false;
    (tucked ? pillRef : tuckRef).current?.focus();
  }, [tucked]);
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
    : queueOnly ? (queue.paused || !waiting ? '#FFD700' : '#00ff88') : limitHeld || lifted ? '#FFD700' : '#556';
  // Auto scan (lib/auto-scan.js): its sitting is called that, and between sittings it says what it waits for.
  const auto = job?.auto?.on ? autoStatus(job.auto) : null;
  const sitting = running && job.auto?.phase === 'running';
  const label = needs ? 'LinkedIn needs you' : running ? (sitting ? 'Auto scan' : WHAT[job.action] || 'Scanning') : other ? other.label
    : queueOnly ? (!waiting ? 'Queue: skipped' : queue.paused ? 'Queue paused' : 'Up next')
    : limitHeld ? 'Daily limit reached' : auto ? 'Auto scan' : lifted ? 'Limits lifted' : 'Auto scan';
  const short = needs ? needs.replace(/\.$/, '') : running ? step : other ? other.detail
    : queueOnly ? (!waiting ? `${queued.length} couldn’t start` : queue.paused ? `${waiting} waiting` : nextName || null)
    : limitHeld && limits.daily ? `${limits.searches ?? limits.daily} of ${limits.daily} today`
    : auto ? auto.text.toLowerCase() : null;
  // "Limits lifted" beside whatever else it says, when that isn't already what it says.
  const liftedTag = lifted && label !== 'Limits lifted';
  const idle = !running && !other && !queueOnly && !limitHeld && !lifted && !auto;
  // "+2 queued" beside what runs.
  const more = (running || other) && waiting > 0 ? `+${waiting} queued` : null;

  // Kept inside the window: centred under the tab buttons, but never off an edge.
  const left = centre != null ? `clamp(170px, ${centre}px, calc(100vw - 170px))` : '50%';

  return (
    <>
      {tucked && (
        <button
          ref={pillRef} type="button" className="notch-pill notch-in" data-notch-pill=""
          aria-label={status ? `Show the bar: ${label}${short ? `, ${short}` : ''}` : 'Show the bar'}
          title={`Show the bar (${tuckKeyName()})`}
          onClick={() => { handOff.current = true; setNotchTucked(false); }}
          style={{ left, top }}
        >
          {/* Drawn as the notch is in each look (globals.css [data-glass-panel]) */}
          <span
            className="notch-pill-tab" data-glass-panel="bar"
            style={{ borderColor: needs ? 'rgba(255,215,0,0.55)' : running ? 'rgba(0,255,136,0.3)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.2)' }}
          >
            {/* The notch's own dot, so what runs is never out of sight: green, gold when LinkedIn needs you */}
            {status && dot !== '#556' && (
              <span data-pill-dot="" className={running ? 'notch-pulse' : undefined} style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />
            )}
            <span className="notch-pill-chev"><Chevron down /></span>
          </span>
        </button>
      )}
      <div
        ref={barRef}
        data-glass-panel="bar"
        data-notch=""
        data-tucked={tucked ? '' : undefined}
        inert={tucked}
        className="notch-in"
        onMouseLeave={() => setOpen(false)}
        style={{
          // Tucked, it lifts a little as it fades (globals.css; not with reduced motion).
          position: 'fixed', left, top, transform: 'translate(-50%, var(--notch-lift, 0px))', zIndex: 60,
          maxWidth: 'calc(100vw - 16px)',
          padding: expanded && status ? '4px 6px 10px' : '4px 6px 5px',
          // Width, style and colour apart: the colour changes while it shows (gold when
          // LinkedIn needs you), and React warns about a shorthand beside borderTop.
          borderRadius: '0 0 14px 14px', borderStyle: 'solid', borderWidth: '0 1px 1px',
          borderColor: needs ? 'rgba(255,215,0,0.5)' : running ? 'rgba(0,255,136,0.25)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)',
          background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)', fontSize: 12,
          opacity: tucked ? 0 : tabs || running || other || expanded || queued.length || limitHeld || lifted ? 1 : 0.55,
          boxShadow: running ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', minWidth: 0 }}>
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
                  {liftedTag && <LiftedTag small />}
                </span>
                {idle && expanded && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>off · open Auto scan beside Scan to start it</span>}
              </button>
            )}
          </div>
          {/* Tuck it up out of the way: faint until you're on it (globals.css .notch-tuck) */}
          <button
            ref={tuckRef} type="button" className="notch-tuck"
            aria-label="Hide the bar" title={`Hide the bar (${tuckKeyName()})`}
            onClick={() => { handOff.current = true; setOpen(false); setPinned(false); setNotchTucked(true); }}
          >
            <Chevron />
          </button>
        </div>
        {status && fraction != null && (
          <div style={{ height: 2, margin: '3px 6px 0', borderRadius: 2, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(fraction * 100)}%`, height: '100%', background: running ? '#00ff88' : '#3498DB', transition: 'width 0.4s ease' }} />
          </div>
        )}
        {expanded && running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 8px 0', flexWrap: 'wrap' }}>
            {job.target?.name && <span>{job.target.name}</span>}
            {/* A rolling 24 hours, as the limit counts them (lib/linkedin-limits.js usage), not
                since midnight, with the number to change; the words open Scan → LinkedIn usage. */}
            {b && (b.lifted ? (
              <span data-notch-budget="" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Link href="/setup#usage" style={{ color: 'var(--sd-fg-2, #cfd8d8)', textDecoration: 'none' }} title="Open LinkedIn usage">
                  {b.searches} searches in the last 24 hours
                </Link>
                <button type="button" onClick={() => putLimitsBack().catch(() => {})} style={SMALL} title="The daily limit and the cooldown come back on now">Put limits back</button>
              </span>
            ) : (
              <span data-notch-budget="" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: tone(b.searches, b.cap) }}>
                {b.searches} of
                <DailyLimitInput small value={b.cap} onSave={(n) => setDailyLimit(n).catch(() => {})} />
                <Link href="/setup#usage" style={{ color: 'inherit', textDecoration: 'none' }} title="Searches on your LinkedIn account in the last 24 hours, and your searches a day. Open LinkedIn usage">
                  searches in the last 24 hours
                </Link>
              </span>
            ))}
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
        {/* The daily limit held a scan back: what's used, the number, and the lift, in a click. */}
        {expanded && limitHeld && (
          <div data-notch-limit="" style={{ margin: '8px 8px 6px', width: 340, maxWidth: 'calc(100vw - 48px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'var(--sd-fg-2, #cfd8d8)', lineHeight: 1.5 }}>
              Today&rsquo;s searches are used: {limits.searches ?? limits.daily} in the last 24 hours.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sd-fg-3, #8b9a9a)' }}>
              Searches a day
              <DailyLimitInput small value={limits.daily} onSave={(n) => setDailyLimit(n).catch(() => {})} />
            </div>
            <LiftLimits small lifted={false} onLift={() => liftLimitsForSession().catch(() => {})} />
          </div>
        )}
        {/* Lifted, and nothing running: what that means, and the way back. */}
        {expanded && lifted && !running && !limitHeld && (
          <div style={{ margin: '8px 8px 6px', width: 340, maxWidth: 'calc(100vw - 48px)' }}>
            <LiftLimits small lifted onPutBack={() => putLimitsBack().catch(() => {})} />
          </div>
        )}
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
    </>
  );
}
