'use client';

// "Auto scan" in the header, beside Scan, while the Scan page's experimental
// switch is on (lib/experimental-client.js). Blake, 1.2.0: "it doesn't even
// work, and when I hover over it there's no animation of it flowing to extend,
// and it doesn't let them pick the tier they want to scan. We can have it there
// as experimental but it needs a slow / med / fast and the colour dots to pick
// which tiers."
//
// So it's a tab like the others with a small Beta mark. Hovering or focusing it
// lets it flow out to say how it's set or what it's doing; hovering a moment,
// or clicking, drops a compact panel from it in the notch's frosted glass (no
// pop-up, no box over the page): Slow / Medium / Fast with a line of what that
// means, the tier dots S to D (S and A to start with), Start or Stop, and the
// state in words: running, resting until 14:05, outside hours, limit reached,
// nothing left. The sittings, rests and hours are the server's
// (app/api/scraper/route.js, lib/auto-scan.js); the pace and tiers are kept in
// this browser beside the switch. Reduce Motion: nothing flows or builds, the
// panel fades. The map's Physics switch is the map's own, so it isn't read here.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { watchScanner, scannerNow } from '../../lib/scraper-client';
import {
  watchAllDay, allDayNow, autoSettingsNow, rememberAutoSettings, startAutoScan, stopAutoScan, updateAutoScan,
} from '../../lib/experimental-client';
import { AUTO_DEFAULTS, AUTO_HOURS, AUTO_PACES, PACE_KEYS, TIER_KEYS, autoStatus, cleanTiers, paceLine, tierList } from '../../lib/auto-scan';
import { useEdgePanel } from './EdgeToggle';
import InlineNote, { useFadingNote } from './InlineNote';

const TONE = {
  running: 'var(--sd-green, #00ff88)', rest: 'var(--sd-blue, #3498db)', hours: 'var(--sd-fg-4, #8b9a9a)',
  waiting: 'var(--sd-blue, #3498db)', limit: 'var(--sd-gold, #ffd700)', done: 'var(--sd-fg-3, #8b9a9a)',
  stopped: 'var(--sd-fg-4, #8b9a9a)', off: 'rgba(var(--sd-ink, 255, 255, 255), 0.3)',
};
const TIER_VAR = { S: 'var(--sd-tier-s, #ffd700)', A: 'var(--sd-tier-a, #9b59b6)', B: 'var(--sd-tier-b, #3498db)', C: 'var(--sd-tier-c, #2ecc71)', D: 'var(--sd-tier-d, #95a5a6)' };
const OPEN_AFTER = 160;    // ms of hover before the panel drops
const CLOSE_AFTER = 280;   // ms after the pointer leaves, so it can cross the gap

export default function AutoScanButton({ isMobile = false }) {
  const on = useSyncExternalStore(watchAllDay, allDayNow, () => false);
  const [job, setJob] = useState(() => scannerNow());
  useEffect(() => watchScanner(() => setJob(scannerNow())), []);
  // Nothing is drawn until the switch is read in the browser (`on` is false on
  // the server and while hydrating), so reading this browser's choices here
  // can't make the first drawing differ.
  const [picked, setPicked] = useState(() => (typeof window === 'undefined'
    ? { pace: AUTO_DEFAULTS.pace, tiers: [...AUTO_DEFAULTS.tiers] } : autoSettingsNow()));
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState(null);
  const [note, say] = useFadingNote(9000);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const timer = useRef(null);
  const shown = open || pinned;
  const { shown: mounted, closing } = useEdgePanel(shown);

  const view = job?.auto || null;
  const live = Boolean(view?.on);
  const status = autoStatus(view);
  // While it runs, what the server runs with; otherwise what was last picked here.
  const pace = live && view.pace ? view.pace : picked.pace;
  const tiers = live && view.tiers?.length ? view.tiers : picked.tiers;

  const hover = (want) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(want), want ? OPEN_AFTER : CLOSE_AFTER);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // The day's limit, for the pace line: asked once each time the panel opens.
  useEffect(() => {
    if (!shown) return;
    let gone = false;
    fetch('/api/scraper?usage=1').then((r) => (r.ok ? r.json() : null))
      .then((u) => { if (!gone && u?.limits) setDaily(Number(u.limits.daily) || null); })
      .catch(() => {});
    return () => { gone = true; };
  }, [shown]);

  // Esc closes it and leaves the focus on the button; a click elsewhere closes a pinned one.
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const here = document.activeElement;
      if (!(btnRef.current?.contains(here) || panelRef.current?.contains(here)) && !open) return;
      e.preventDefault();
      setOpen(false); setPinned(false);
      btnRef.current?.focus();
    };
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false); setPinned(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }, [shown, open]);

  const choose = useCallback((next) => {
    setPicked(next);
    rememberAutoSettings(next);
    if (live && next.tiers.length) updateAutoScan(next).catch(() => {});
  }, [live]);

  if (!on) return null;

  const start = async () => {
    say(null);
    if (!tiers.length) { say('Pick at least one tier.'); return; }
    setBusy(true);
    try { await startAutoScan({ pace, tiers }); } catch (e) { say(e?.message || 'Auto scan could not start.'); }
    setBusy(false);
  };
  const stop = async () => {
    setBusy(true);
    try { await stopAutoScan(); } catch (e) { say(e?.message || 'Auto scan could not be stopped.'); }
    setBusy(false);
  };

  const dot = TONE[status.phase] || TONE.off;
  // What it flows out to say on hover: how it's set while off, what it's doing while on.
  const peek = live ? status.text : `${AUTO_PACES[pace].label} · ${tiers.join(' ') || 'no tier'}`;

  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button
        ref={btnRef}
        type="button"
        className={`sd-tab sd-auto${shown ? ' is-open' : ''}`}
        aria-expanded={shown}
        aria-controls={mounted ? 'sd-auto-panel' : undefined}
        aria-label={`Auto scan, experimental: ${status.text}`}
        title={`Auto scan (experimental): ${live ? status.text : 'off'}. Scans your connections’ circles in small sittings with rests, ${AUTO_HOURS[0]}:00 to ${AUTO_HOURS[1]}:00, while Sixgree is open.`}
        // A click keeps it open (hover alone lets it go); a second click closes it.
        onClick={() => {
          clearTimeout(timer.current);
          if (pinned) { setPinned(false); setOpen(false); } else setPinned(true);
        }}
        style={{ padding: isMobile ? '6px 10px' : '8px 14px', fontSize: isMobile ? 11 : 13, gap: 6, whiteSpace: 'nowrap' }}
      >
        <span className={status.phase === 'running' ? 'notch-pulse' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        Auto scan
        <span className="sd-auto-beta" aria-hidden="true">Beta</span>
        <span className="sd-auto-peek" aria-hidden="true">{peek}</span>
      </button>
      <InlineNote note={note} float align="right" />
      {mounted && <AutoPanel
        anchor={btnRef} panelRef={panelRef} closing={closing}
        onEnter={() => hover(true)} onLeave={() => { if (!pinned) hover(false); }}
        status={status} live={live} pace={pace} tiers={tiers} daily={daily} busy={busy}
        onPace={(p) => choose({ pace: p, tiers })}
        onTier={(t) => choose({ pace, tiers: tiers.includes(t) ? tiers.filter((x) => x !== t) : cleanTiers([...tiers, t]) })}
        onStart={start} onStop={stop}
      />}
    </div>
  );
}

/** The panel, anchored under the button and laid over the page (a portal: the header's glass would clip it). */
function AutoPanel({ anchor, panelRef, closing, onEnter, onLeave, status, live, pace, tiers, daily, busy, onPace, onTier, onStart, onStop }) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(320, window.innerWidth - 32);
      // Under the button, its right edge on the button's, inside a 16 px gutter.
      const left = Math.max(16, Math.min(r.right - width, window.innerWidth - 16 - width));
      setPos({ top: r.bottom + 10, left, width, origin: `${Math.round(r.left + r.width / 2 - left)}px 0` });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  if (!pos) return null;
  const tone = TONE[status.phase] || TONE.off;
  return createPortal(
    <div
      ref={panelRef}
      id="sd-auto-panel"
      role="group"
      aria-label="Auto scan"
      data-glass-panel="pop"
      className={`sd-auto-panel${closing ? ' is-closing' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, transformOrigin: pos.origin, zIndex: 70 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ color: 'var(--sd-fg-1, #fff)', fontSize: 13 }}>Auto scan</b>
        <span className="sd-auto-beta is-full">Experimental</span>
      </div>
      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--sd-fg-1, #fff)' }}>
        <span className={status.phase === 'running' ? 'notch-pulse' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 }} />
        {status.text}
      </div>

      <div className="sd-auto-row">
        <span className="sd-auto-label" id="sd-auto-pace">Pace</span>
        <div role="radiogroup" aria-labelledby="sd-auto-pace" className="sd-auto-seg">
          {PACE_KEYS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={pace === k} onClick={() => onPace(k)}
              style={{ background: 'transparent' }}>{AUTO_PACES[k].label}</button>
          ))}
        </div>
      </div>
      <p className="sd-auto-line">{paceLine(pace, daily)}</p>

      <div className="sd-auto-row">
        <span className="sd-auto-label" id="sd-auto-tiers">Tiers</span>
        <div role="group" aria-labelledby="sd-auto-tiers" className="sd-auto-tiers">
          {TIER_KEYS.map((t, i) => (
            <button key={t} type="button" aria-pressed={tiers.includes(t)} onClick={() => onTier(t)}
              aria-label={`${t} tier`} title={`${t} tier: ${tiers.includes(t) ? 'scanned' : 'not scanned'}`}
              className="sd-auto-tier" style={{ background: 'transparent', '--tier': TIER_VAR[t], '--i': i }}>
              <span className="sd-auto-tier-dot" />
              <span className="sd-auto-tier-name">{t}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="sd-auto-line">
        {tiers.length
          ? <>Scans the circles of your {tierList(tiers)} connections, highest power first.</>
          : <>Pick at least one tier.</>}
      </p>

      {status.detail && <p className="sd-auto-line" style={{ color: 'var(--sd-fg-2, #cfd8d8)' }}>{status.detail}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        {live ? (
          <button type="button" onClick={onStop} disabled={busy} className="sd-auto-go is-stop">{busy ? 'Stopping…' : 'Stop'}</button>
        ) : (
          <button type="button" onClick={onStart} disabled={busy || !tiers.length} className="sd-auto-go">{busy ? 'Starting…' : 'Start'}</button>
        )}
        <span style={{ flex: 1 }} />
        <Link href="/setup#usage" style={{ fontSize: 11.5, color: 'var(--sd-blue, #3498db)', textDecoration: 'none' }}>LinkedIn usage</Link>
      </div>
      <p className="sd-auto-line" style={{ marginTop: 8 }}>
        Experimental. {AUTO_HOURS[0]}:00 to {AUTO_HOURS[1]}:00, only while Sixgree is open, and it stops at your daily limit.
        Anything you queue goes first.
      </p>
    </div>,
    document.body,
  );
}
