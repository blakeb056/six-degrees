'use client';

// The tour (lib/help.js): offered once, on the map, after the guided setup,
// and replayed from Settings → Help (/?tour=replay). A film to start, then a
// few steps, each a ring round the real thing in the app (the tabs, the map,
// the ⚙ button) and a card beside it with Back, Next and Skip. Esc skips.
//
// The rest of the window is dimmed and takes no clicks while it's open, and
// Sixgree's own browser steps aside for it (usePanelCover). The first time,
// it's never offered while a scan runs: that visit passes, and the next time
// the map opens with nothing running, it's offered then (tourOpens).

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import useScanner from '../useScanner';
import usePanelCover from '../usePanelCover';
import useFeature from '../useFeature';
import { useLinkedInPanel } from '../linkedInPanelState';
import { LINKEDIN_BROWSER } from '../../../lib/linkedin-browser';
import { IS_DEMO } from '../../../lib/demo';
import {
  TOUR_FILM, TOUR_PARAM, hasFilm, tourSteps, tourMove, tourCount, readTour, rememberTour, tourOpens, withKeys, isMac,
  placeCard, spotlight, setTouring, watchHelp, tourRawNow, nothingStored,
} from '../../../lib/help';
import { HELP_CSS } from './styles';

const FOCUSABLE = 'button:not([disabled]), [href], video[controls], [tabindex]:not([tabindex="-1"])';
const noWindow = () => () => {};
const isClient = () => true;
const isServer = () => false;

/**
 * @param {{ own?: boolean, scanner?: boolean, replay?: boolean }} props
 *   `own`: your own network (not the sample or a CSV), whose pages get their
 *   steps; `scanner`: a scanner plugin is installed; `replay`: the address
 *   asked for it (Settings → Help's Replay the tour).
 */
export default function Tour({ own = false, scanner = false, replay = false }) {
  const scan = useScanner();
  const browserOn = useFeature(LINKEDIN_BROWSER);
  const panel = useLinkedInPanel();
  const linkedin = own && browserOn && Boolean(panel?.available);
  const steps = useMemo(() => tourSteps({ own, scanner: own && scanner, linkedin }), [own, scanner, linkedin]);
  // What this window remembers, read as a store so it's never read on the server.
  const raw = useSyncExternalStore(watchHelp, tourRawNow, nothingStored);
  const client = useSyncExternalStore(noWindow, isClient, isServer);

  // Decided once a visit to the map: open for a replay; the first time, once
  // the scanner has said nothing is running. Decided while drawing, as the
  // guided setup decides its first step, so nothing flashes first.
  const [tour, setTour] = useState({ decided: false, open: false, how: null, at: 0 });
  if (client && !tour.decided) {
    const memory = readTour({ getItem: () => raw });
    const scanning = scan.running || scan.pending;
    if (replay || memory.seen || IS_DEMO || scan.known) {
      const how = tourOpens({ memory, demo: IS_DEMO, replay, scanKnown: scan.known, scanning });
      setTour({ decided: true, open: Boolean(how), how, at: 0 });
    }
  }
  const open = tour.open;
  const count = steps.length;
  const at = Math.min(tour.at, count - 1);
  const step = steps[at];

  // Shown: remembered as seen (so it's offered once), no hint over it, and
  // Sixgree's own browser out of its way.
  usePanelCover(open);
  useEffect(() => {
    if (!open) return undefined;
    rememberTour({ seen: true });
    setTouring(true);
    return () => setTouring(false);
  }, [open]);
  // A replay leaves the address as it was, without ?tour=, so a reload doesn't open it again.
  useEffect(() => {
    if (!open || tour.how !== 'replay') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(TOUR_PARAM);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* the address keeps it: a reload offers it again, nothing worse */ }
  }, [open, tour.how]);

  // Back, Next, Skip and Esc. Ended (Done, Skip or Esc), how is remembered with the seen.
  const move = useCallback((action) => {
    const next = tourMove(at, action, count);
    if (next.end) rememberTour({ seen: true, ended: next.end });
    setTour((t) => (next.end ? { ...t, open: false } : { ...t, at: next.at }));
  }, [at, count]);

  if (!open || !step) return null;
  return createPortal(<TourCard step={step} at={at} count={count} move={move} />, document.body);
}

/** One step: the ring round its target, and the card. */
function TourCard({ step, at, count, move }) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const target = useTargetBox(step.target);
  const view = useWindowSize();
  const [size, setSize] = useState(null);
  const mac = useSyncExternalStore(noWindow, () => isMac(), isServer);

  // The card's own size, for placing it: measured as it's drawn, and again if its words wrap differently.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s && s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step.key]);

  // Where you were, given back when the tour closes; the step's main button has the keyboard meanwhile.
  useEffect(() => {
    const before = document.activeElement;
    return () => { if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { nextRef.current?.focus({ preventScroll: true }); }, [step.key]);

  // Esc skips, wherever the keyboard is, and goes no further (a person's circle
  // on the map closes on Esc too). Tab stays inside the card.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        move('esc');
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      const items = card ? [...card.querySelectorAll(FOCUSABLE)] : [];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = card.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [move]);

  const ring = spotlight(target, view);
  const place = size && view ? placeCard(target, size, view) : null;
  const last = at === count - 1;
  const cls = ['sdh-card', step.film ? 'film' : '', place?.side === 'sheet' ? 'sheet' : '', place ? '' : 'measuring'].filter(Boolean).join(' ');

  return (
    <div className="sdh sdh-tour" data-tour-open={step.key}>
      <style>{HELP_CSS}</style>
      {/* Takes the clicks meant for the app behind, so the tour can't be lost under them */}
      <div className="sdh-catch" aria-hidden="true" />
      {ring ? <div className="sdh-ring" aria-hidden="true" style={ring} /> : <div className="sdh-dim" aria-hidden="true" />}
      <div ref={cardRef} className={cls} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        data-glass-panel="" tabIndex={-1} style={place ? { top: place.top, left: place.left } : { top: 0, left: 0 }}>
        <div className="sdh-head">
          <div className="sdh-eyebrow">Tour · {tourCount(at, count)}</div>
          <div className="sdh-steps" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => <i key={i} className={i === at ? 'now' : i < at ? 'done' : ''} />)}
          </div>
        </div>
        <h2 id={titleId} className="sdh-title">{step.title}</h2>
        {step.film && <Film />}
        <p id={bodyId} className="sdh-body">{withKeys(step.body, mac)}</p>
        <div className="sdh-foot">
          {!last && <button type="button" className="sdh-btn quiet" onClick={() => move('skip')}>Skip tour</button>}
          <span className="sdh-spacer" />
          {at > 0 && <button type="button" className="sdh-btn" onClick={() => move('back')}>Back</button>}
          <button ref={nextRef} type="button" className="sdh-btn primary" onClick={() => move('next')}>
            {last ? 'Done' : at === 0 ? 'Start the tour' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// The empty slot's picture: you, and your connections on rings by tier. Fixed
// positions, so it draws the same every time.
const SLOT_DOTS = (() => {
  const rings = [[18, 7, 's'], [30, 11, 'a'], [42, 15, 'b'], [54, 19, 'c'], [66, 23, 'd']];
  const dots = [];
  for (const [r, n, tier] of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r / 9;
      dots.push({ x: 160 + Math.cos(a) * r * 1.55, y: 90 + Math.sin(a) * r, tier, size: 3.6 - rings.findIndex((g) => g[2] === tier) * 0.45 });
    }
  }
  return dots;
})();

/**
 * The film at the start (lib/help.js TOUR_FILM), from the app's own files.
 * There isn't one yet: the slot is drawn, marked, for a later release to fill.
 */
function Film() {
  if (hasFilm()) {
    return (
      <div className="sdh-film">
        <video controls muted playsInline preload="metadata" src={TOUR_FILM.src} poster={TOUR_FILM.poster || undefined} aria-label={TOUR_FILM.label} />
      </div>
    );
  }
  return (
    <div className="sdh-film" data-film-slot="empty" role="img" aria-label="A place for the tour's film, coming in a later release">
      <svg viewBox="0 0 320 180" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        {SLOT_DOTS.map((d, i) => (
          <circle key={i} className="sd-dot" cx={d.x} cy={d.y} r={d.size} fill={`var(--sd-tier-${d.tier}, #8899aa)`} opacity={0.85} />
        ))}
        <circle cx={160} cy={90} r={6} fill="var(--sd-fg-1, #fff)" />
      </svg>
      <span className="sdh-film-tag">Film coming in a later release</span>
    </div>
  );
}

/** The window's size, kept up to date. */
function useWindowSize() {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      setSize((s) => (s && s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(read); };
    later();
    window.addEventListener('resize', later);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', later); };
  }, []);
  return size;
}

/**
 * Where [data-tour="<key>"] is on screen, or null with no key or nothing
 * there. Looked at again on a resize or a scroll, and twice a second, since
 * the header settles as the plugins answer.
 */
function useTargetBox(key) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = key ? document.querySelector(`[data-tour="${key}"]`) : null;
      const r = el?.getBoundingClientRect();
      const next = r && (r.width || r.height) ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setBox((b) => (b === next || (b && next && b.top === next.top && b.left === next.left && b.width === next.width && b.height === next.height) ? b : next));
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(read); };
    later();
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    const timer = setInterval(later, 500);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
    };
  }, [key]);
  return box;
}
