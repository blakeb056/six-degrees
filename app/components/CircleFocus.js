'use client';

// One of your connections, in front of Network Circle (Blake, 2026-10-16: "show
// the network circle kind of blurred, and then show their circle with the
// scanned dots and also catalysts from them who's been scanned so it shows the
// full chain ... If they don't have anything scanned then it will be more
// subtle with the blur in place but showing just the core and telling them to
// scan the circle or making it easy to back out of this"). And a bridge, in
// front of Bridge Chains, the same way (Blake, the same day: "I want the click
// UI/UX we added on the dots for Network Circle onto the bridge and make it
// just like that").
//
// The view behind (ForceGraph.js, ChainView.js) runs it with useFocus below,
// zooms and blurs its own layer with lib/circle-focus.js focusLayer, draws the
// ring that fills while the pointer rests (FocusHold), and says where the dot
// was; this draws only what comes forward: their circle as rings round them
// (lib/circle-focus.js focusLayout), each catalyst's circle chained on outward,
// and you, off to the side the map has you on. Or, with nothing scanned, just
// them and a Scan button. Esc, a click outside, Back, or scrolling or pinching
// out closes it (lib/circle-focus.js).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import useScanner from './useScanner';
import { degreeName } from '../../lib/galaxy';
import {
  HOVER_HOLD, FOCUS_OUT_MS, FADE_MS, focusDuration, focusLayout, springEasing, SPRING_FALLBACK, wheelOut, pinchOut,
  wheelIn, pinchIn, wheelGate, focusStep, diveDuration, youTether,
} from '../../lib/circle-focus';
import { tierRings } from '../../lib/chain-layout';
import { score1 } from '../../lib/separation';
import { localPhoto } from '../../lib/photos';
import { startHere, scansCircleOf, queuedFor, willQueue, busyReason } from '../../lib/scraper-client';
import { MAP_LOOK } from '../../lib/themes';
import useTies from './useTies';
import ShowTies from './ShowTies';
import { TierBands, TierDots, TierLetters, TierCounts } from './TierRings';
import { tieLines, knownThrough, knownThroughText, firstDegreeByKey, TIE_COLOUR } from '../../lib/mutual-web';
import { urlKey } from '../../lib/ties';

const GREEN = 'var(--sd-green, #00ff88)';
// Words over the blurred map: a soft halo in the page's own shade, so they read on any look.
const HALO = '0 0 3px rgba(var(--sd-shade, 0, 0, 0), 0.9), 0 1px 10px rgba(var(--sd-shade, 0, 0, 0), 0.8)';
// Their face on the page's own colour, so the map never shows through its tint.
const FACE = { display: 'flex', borderRadius: '50%', background: 'var(--sd-bg, #0a0a1a)' };

const CSS = `
.cf-ring { animation: cf-ring-in 560ms cubic-bezier(0.32, 0.72, 0, 1) both; transform-box: view-box; transform-origin: 50% 50%; }
@keyframes cf-ring-in { from { opacity: 0; transform: scale(0.93); } }
.cf-dot { transition: transform 0.15s ease-out; transform-box: fill-box; transform-origin: center; cursor: pointer; }
.cf-dot:hover { transform: scale(1.8); }
.cf-btn { font: inherit; cursor: pointer; border-radius: 999px; padding: 7px 14px; font-size: 12.5px; font-weight: 700; }
.cf-btn:focus-visible { outline: 2px solid var(--sd-accent, #3498db); outline-offset: 2px; }
.cf-btn[disabled] { cursor: default; opacity: 0.55; }
.cf-core { border-radius: 50%; cursor: zoom-in; pointer-events: auto;
  transition: transform 0.18s ease-out, box-shadow 0.18s ease-out; box-shadow: 0 0 0 0 rgba(var(--sd-ink, 255, 255, 255), 0); }
.cf-core:hover { transform: translate(-50%, -50%) scale(1.08) !important; box-shadow: 0 0 0 5px rgba(var(--sd-ink, 255, 255, 255), 0.12), 0 0 22px rgba(var(--sd-ink, 255, 255, 255), 0.18); }
.cf-core:focus-visible { outline: 2px solid var(--sd-accent, #3498db); outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { .cf-ring { animation: none; } .cf-dot, .cf-core { transition: none; } }`;

// Reduce Motion, the Mac's accessibility setting: the focus cross-fades instead of zooming.
const reducedMotion = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false;

/**
 * The focus's comings and goings, for whichever view opens it. `open(id,
 * extra)` starts it; `extra` is what the view needs to draw it (where the dot
 * is, who it is, the trail to them). `focus.phase` is 'in' for its first
 * frame, everything styled where it starts and those styles worked out now
 * (on `layerRef`, the layer that zooms), so the next frame, with everything
 * where it goes, eases there; then 'open'; then 'out' while it eases back,
 * and `onGone(id)` once it has, with the id of any focus opened meanwhile.
 * `move(patch)` changes it while it's open: the dot's new place after a
 * resize, or someone else along the chain (a function of the focus, or
 * nothing to leave it). Esc closes it. `idRef` is who it's on, null once it's
 * going.
 */
export function useFocus({ layerRef = null, onGone } = {}) {
  const [focus, setFocus] = useState(null);
  const idRef = useRef(null);
  useEffect(() => { idRef.current = focus && focus.phase !== 'out' ? focus.id : null; }, [focus]);
  const goneRef = useRef(onGone);
  useEffect(() => { goneRef.current = onGone; });
  const open = useCallback((id, extra = {}) => {
    const ease = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)') ? springEasing() : SPRING_FALLBACK;
    idRef.current = id;
    setFocus({ ...extra, id, phase: 'in', reduced: reducedMotion(), ease, dive: null });
  }, []);
  const close = useCallback(() => setFocus((f) => (f && f.phase !== 'out' ? { ...f, phase: 'out' } : f)), []);
  // One level in or out (lib/circle-focus.js focusStep): the dive is `focus.dive`,
  // 'in' for its first frame, 'open', then 'out' while it eases back to the focus.
  const step = useCallback((event, opts) => setFocus((f) => {
    if (!f) return f;
    const level = f.phase === 'out' ? 'overview' : f.dive && f.dive !== 'out' ? 'dive' : 'focus';
    const to = focusStep(level, event, opts);
    if (to === level) return f;
    if (to === 'dive') return { ...f, dive: 'in' };
    if (to === 'focus') return { ...f, dive: 'out' };
    return { ...f, phase: 'out' };
  }), []);
  const move = useCallback((patch) => setFocus((f) => {
    if (!f || f.phase === 'out') return f;
    const next = typeof patch === 'function' ? patch(f) : patch;
    return next ? { ...f, ...next } : f;
  }), []);
  const phase = focus?.phase ?? null;
  const reduced = Boolean(focus?.reduced);
  useEffect(() => {
    if (phase !== 'in') return undefined;
    if (layerRef?.current) void getComputedStyle(layerRef.current).transform;
    // A timer too, for a window the browser isn't drawing frames for just then.
    const go = () => setFocus((f) => (f && f.phase === 'in' ? { ...f, phase: 'open' } : f));
    const frame = requestAnimationFrame(go);
    const timer = setTimeout(go, 60);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [phase, layerRef]);
  // Out: once the zoom has eased back, the map is the map again.
  useEffect(() => {
    if (phase !== 'out') return undefined;
    const timer = setTimeout(() => {
      setFocus((f) => (f && f.phase === 'out' ? null : f));
      goneRef.current?.(idRef.current);
    }, reduced ? FADE_MS : FOCUS_OUT_MS);
    return () => clearTimeout(timer);
  }, [phase, reduced]);
  // The dive, as the focus: its first frame styled where it starts, then where it goes.
  const dive = focus?.dive ?? null;
  useEffect(() => {
    if (dive !== 'in') return undefined;
    const go = () => setFocus((f) => (f && f.dive === 'in' ? { ...f, dive: 'open' } : f));
    const frame = requestAnimationFrame(go);
    const timer = setTimeout(go, 60);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [dive]);
  // Back out of it: once it has eased back, the focus is the focus again.
  useEffect(() => {
    if (dive !== 'out') return undefined;
    const timer = setTimeout(() => setFocus((f) => (f && f.dive === 'out' ? { ...f, dive: null } : f)), diveDuration({ phase: 'out', reduced }));
    return () => clearTimeout(timer);
  }, [dive, reduced]);
  const shown = phase === 'in' || phase === 'open';
  useEffect(() => {
    if (!shown) return undefined;
    // From the dive, Esc comes back to the focus; from the focus, to the map.
    const onKey = (e) => { if (e.key === 'Escape') step('back'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, step]);
  return { focus, open, close, move, step, idRef };
}

const HOLD_CSS = `
.focus-hold .track { stroke: rgba(var(--sd-ink, 255, 255, 255), 0.18); }
.focus-hold .fill { stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-box: fill-box; transform-origin: center; }
.focus-hold.run { animation: focus-hold-show var(--hold, 3.5s) linear forwards; }
.focus-hold.run .fill { animation: focus-hold-fill var(--hold, 3.5s) linear forwards; }
@keyframes focus-hold-show { 0%, 10% { opacity: 0; } 18%, 100% { opacity: 1; } }
@keyframes focus-hold-fill { to { stroke-dashoffset: 0; } }`;

/**
 * The ring that fills round a dot while the pointer rests on it, HOVER_HOLD
 * long: full, and the focus opens. The Galaxy's scene places it itself through
 * `holdRef`, a frame at a time as the map moves; Bridge Chains says where with
 * `at`, { x, y, r, colour } in px in its box, and keys it by the bridge so
 * each rest fills from empty.
 */
export function FocusHold({ holdRef, at = null }) {
  const size = at ? 2 * at.r + 6 : null;
  const ring = at ? { cx: size / 2, cy: size / 2, r: at.r } : null;
  return (
    <>
      <style>{HOLD_CSS}</style>
      <div ref={holdRef} className={at ? 'focus-hold run' : 'focus-hold'} style={{
        position: 'absolute', left: 0, top: 0, display: at ? 'block' : 'none', pointerEvents: 'none', '--hold': `${HOVER_HOLD}ms`,
        ...(at ? { transform: `translate(${at.x - size / 2}px, ${at.y - size / 2}px)` } : null),
      }}>
        <svg {...(at ? { width: size, height: size } : null)} style={{ display: 'block', overflow: 'visible' }}>
          <circle className="track" fill="none" strokeWidth={2} {...ring} />
          <circle className="fill" fill="none" strokeWidth={2.5} strokeLinecap="round" pathLength={1} {...ring}
            {...(at ? { style: { stroke: at.colour || 'var(--sd-accent, #3498db)' } } : null)} />
        </svg>
      </div>
    </>
  );
}

/**
 * `bar` is where Back's row sits, { top, side } in px: in the corner, or where
 * the row of view buttons over the top of the map is wide (Bridge Chains has
 * four), under it and clear of the panels' tabs at either edge.
 *
 * `canDive` (Bridge Chains): the focus goes one level deeper. A click on the
 * person in the middle, or scrolling or pinching in, dives into their circle
 * full size, unblurred, in tier rings (CircleDive); Back, Esc or scrolling out
 * comes back to the focus, then to the map. `dive` is the dive's phase
 * (useFocus), `onStep` takes it a level in or out. Its focus on a circle seen
 * outside the scan only is in tier rings too, and nothing is drawn dotted
 * across the circle. Network Circle's focus has none of it, as it was.
 */
export default function CircleFocus({ focus, phase, box, origin, you, look, ease, reduced, tierColors, selectedId, onSelect, onClose, onPick, canScan, bar = CORNER, degree1 = null, webOff = false,
  canDive = false, dive = null, onStep = null }) {
  const open = phase === 'open';
  // The mutual web (lib/mutual-web.js): "Known through" in each dot's note, and Show
  // ties, the lines between the people of this circle seen together.
  const web = useTies({ off: webOff });
  const [showTies, setShowTies] = useState(false);
  const mine = useMemo(() => firstDegreeByKey(degree1 || []), [degree1]);
  const d1ById = useMemo(() => new Map((degree1 || []).map((r) => [r.id, r])), [degree1]);
  // Everyone in front, by urlKey, for Show ties' lines between them (and only them).
  const lines = useMemo(() => {
    if (!showTies || !web.ready || focus.kind !== 'circle') return NO_LINES;
    const onScreen = new Map();
    for (const ring of focus.rings) {
      for (const p of ring.people) { const k = urlKey(p.row.profile_url); if (k && !onScreen.has(k)) onScreen.set(k, p.row.id); }
    }
    const k = urlKey(focus.person.profile_url);
    if (k && !onScreen.has(k)) onScreen.set(k, focus.person.id);
    return tieLines({ index: web.index, onScreen, among: new Set(onScreen.keys()) });
  }, [showTies, web, focus]);
  const dur = focusDuration({ phase, reduced });
  const { person, kind } = focus;
  const backRef = useRef(null);
  const tipRef = useRef(null);
  const wheel = useRef(null);
  const pinch = useRef(0);
  // The dive: only a circle with people in it has one.
  const diving = canDive && kind === 'circle';
  const deep = diving && (dive === 'in' || dive === 'open' || dive === 'out');
  const under = diving && dive === 'open';          // the dive in front, the focus gone on past
  const diveDur = diveDuration({ phase: dive, reduced });
  // Scrolling in: added up as scrolling out is. Once a level changes, the rest
  // of that scroll is let by (lib/circle-focus.js wheelGate), so a trackpad's
  // momentum doesn't carry straight on through the next level; so is the rest
  // of a scroll that opened it over a bridge.
  const zoomIn = useRef(null);
  const gate = useRef({ at: -Infinity, armed: false });
  const diveWheel = useRef(null);
  useEffect(() => { gate.current = { at: performance.now(), armed: false }; }, []);
  const step = (event) => {
    if (!onStep) { if (focusStep('focus', event) === 'overview') onClose(); return; }
    gate.current = { at: performance.now(), armed: false };
    wheel.current = null;
    zoomIn.current = null;
    onStep(event, { canDive: diving });
  };

  // The keyboard goes to Back once it's open, so Return or Space closes it too
  // (in the dive, comes back out of it).
  useEffect(() => { if (open) backRef.current?.focus({ preventScroll: true }); }, [open]);

  const cx = box.width / 2;
  const cy = box.height / 2;
  // The stage grows out of the dot and comes to rest in the middle; going, it
  // shrinks back into it. With Reduce Motion it only fades.
  const from = reduced ? 'none' : `translate(${origin.x - cx}px, ${origin.y - cy}px) scale(0.06)`;
  const stage = {
    position: 'absolute', left: cx, top: cy, width: 0, height: 0,
    transform: open ? 'translate(0px, 0px) scale(1)' : from,
    opacity: open ? 1 : 0,
    transition: `transform ${dur}ms ${ease}, opacity ${Math.round(dur * 0.7)}ms ease-out`,
  };
  // Diving, the focus carries on in past you and fades, as the dive comes up out of it.
  const past = {
    position: 'absolute', left: 0, top: 0, width: 0, height: 0,
    transform: under && !reduced ? 'scale(1.7)' : 'scale(1)', opacity: under ? 0 : 1,
    transition: `transform ${diveDur}ms ${ease}, opacity ${Math.round(diveDur * 0.6)}ms ease-out`,
    pointerEvents: under ? 'none' : undefined,
  };
  const two = (e) => (e.touches.length === 2 ? Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) : 0);
  // The focus's circle, how big it is on screen (FocusMap), for the dive to grow out of.
  const focusSize = Math.max(220, Math.min(box.width - 120, box.height - 200));

  const onWheel = (e) => {
    // When the wheel turned, not when it's handled: a wheel queued behind the
    // focus coming up is the tail of the scroll that opened it.
    const now = e.timeStamp || performance.now();
    if (onStep) {
      gate.current = wheelGate(gate.current, now);
      if (!gate.current.pass) return;
    }
    if (deep) { if (dive === 'open') diveWheel.current?.(e); return; }
    if (diving && e.deltaY < 0) {
      zoomIn.current = wheelIn(zoomIn.current, e, now);
      if (zoomIn.current.in) step('in');
      return;
    }
    wheel.current = wheelOut(wheel.current, e, now);
    if (wheel.current.out) { if (onStep) step('out'); else onClose(); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${person.name}’s circle`} data-focus-level={deep && dive !== 'out' ? 'dive' : 'focus'}
      onWheel={onWheel}
      onTouchStart={(e) => { pinch.current = deep ? 0 : two(e); }}
      onTouchMove={(e) => {
        if (deep || !pinch.current) return;
        const now = two(e);
        if (pinchOut(pinch.current, now)) { pinch.current = 0; if (onStep) step('out'); else onClose(); }
        else if (diving && pinchIn(pinch.current, now)) { pinch.current = 0; step('in'); }
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: phase === 'out' ? 'none' : 'auto', fontFamily: 'var(--sd-font)' }}>
      <style>{CSS}</style>
      {/* The map behind, dimmed: a click on it goes back. */}
      <div onClick={onStep ? () => step('outside') : onClose} aria-hidden="true" style={{
        position: 'absolute', inset: 0, background: `rgba(var(--sd-shade, 0, 0, 0), ${look.dim})`,
        opacity: open ? 1 : 0, transition: `opacity ${dur}ms ease-out`,
      }} />
      {/* Diving: the page's own colour over it, so nothing is blurred behind the circle. */}
      {deep && (
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, background: 'var(--sd-bg, #0a0a1a)',
          opacity: under ? 1 : 0, transition: `opacity ${diveDur}ms ease-out`,
        }} />
      )}
      <div style={stage}>
        <div style={past}>
          {/* Keyed by who's in front, so moving along a chain brings the next one in afresh. */}
          {kind === 'circle'
            ? <FocusMap key={person.id} focus={focus} box={box} origin={origin} you={you} tierColors={tierColors} selectedId={selectedId} onSelect={onSelect} tipRef={tipRef}
              web={web} mine={mine} d1ById={d1ById} lines={webOff ? NO_LINES : lines} canDive={diving} onCore={() => step('core')} />
            : <FocusCore key={person.id} person={person} box={box} tierColors={tierColors} canScan={canScan} onClose={onClose} />}
        </div>
      </div>
      {deep && (
        <CircleDive key={person.id} focus={focus} phase={dive} box={box} bar={bar} grow={focusSize * 0.42} ease={ease} reduced={reduced}
          tierColors={tierColors} selectedId={selectedId} onSelect={onSelect} onOut={() => step('out')}
          tipRef={tipRef} wheelRef={diveWheel} web={web} mine={mine} d1ById={d1ById} canScan={canScan} />
      )}
      <TopBar backRef={backRef} onClose={onStep ? () => step('back') : onClose} open={open} dur={dur} at={bar}
        hint={under ? 'Scroll to zoom · Esc or scroll out to go back' : undefined} label={under ? `Back to ${firstOf(person)}’s focus` : undefined} />
      <div style={{
        position: 'absolute', bottom: 14, left: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        pointerEvents: 'none', opacity: open && !under ? 1 : 0, transition: `opacity ${under || deep ? diveDur : dur}ms ease-out`,
        visibility: under ? 'hidden' : undefined,
      }}>
        {(kind === 'circle' || focus.trail?.length > 0) && <Chain focus={focus} onPick={onPick} />}
        {kind === 'circle' && focus.unscanned && <ScanNudge person={person} canScan={canScan} />}
        {kind === 'circle' && <Counts focus={focus} plain={diving} />}
        {kind === 'circle' && !webOff && (
          <ShowTies on={showTies} onToggle={() => setShowTies((v) => !v)} picked ready={web.ready}
            count={lines.length} style={{ pointerEvents: 'auto' }} />
        )}
      </div>
      <div ref={tipRef} style={{
        position: 'fixed', left: 0, top: 0, display: 'none', pointerEvents: 'none', zIndex: 1000, maxWidth: 260,
        padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.45, color: 'var(--sd-fg-1, #fff)',
        background: 'var(--sd-surface, rgba(10,15,30,0.92))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.14)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
      }} />
    </div>
  );
}

const CORNER = Object.freeze({ top: 12, side: 12 });
const NO_LINES = Object.freeze([]);

/**
 * Their circle holds only people seen outside the scan (the mutual web): what
 * shows is a start, and their circle is still to scan. The same scan as their
 * card's (lib/scraper-client.js startHere).
 */
function ScanNudge({ person, canScan }) {
  const scan = useScanner();
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState(null);
  const mine = scan.running && scansCircleOf(scan, person);
  const queued = queuedFor(scan, 'bridge', person);
  const busy = scan.running && !mine && !queued && !willQueue(scan, 'bridge', person) ? busyReason(scan) : null;
  const start = async () => {
    setProblem(null);
    setChecking(true);
    const why = await startHere('bridge', { name: person.name, id: person.id });
    setChecking(false);
    if (why) setProblem(why);
  };
  const first = String(person.name || 'them').split(' ')[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center', pointerEvents: 'auto',
      padding: '6px 12px', borderRadius: 12, fontSize: 12, color: 'var(--sd-fg-2, #ccc)',
      background: 'var(--sd-surface, rgba(10,15,30,0.86))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)' }}>
      <span>Seen outside the scan only: {first}&apos;s circle isn&apos;t scanned yet.</span>
      {canScan && (
        <button type="button" className="cf-btn" onClick={start} disabled={Boolean(mine || queued || busy || checking)}
          style={{ padding: '4px 12px', border: 'none', color: '#fff', background: 'linear-gradient(135deg, #9B59B6, #3498DB)' }}>
          {mine ? 'Scanning…' : queued ? queued.label : checking ? 'Checking the scanner…' : 'Scan their circle'}
        </button>
      )}
      {(problem || busy) && <span style={{ color: problem ? 'var(--sd-red, #ff6b6b)' : 'var(--sd-fg-3, #999)' }}>{problem || busy}</span>}
    </div>
  );
}

/** Back, top left; how else to go back, top right. */
function TopBar({ backRef, onClose, open, dur, at, hint = 'Esc or scroll out to go back', label = 'Back to the map' }) {
  return (
    <div style={{
      position: 'absolute', top: at.top, left: at.side, right: at.side, display: 'flex', alignItems: 'center', gap: 10,
      opacity: open ? 1 : 0, transition: `opacity ${dur}ms ease-out`, pointerEvents: 'none',
    }}>
      <button ref={backRef} type="button" className="cf-btn" onClick={onClose} aria-label={label} style={{
        pointerEvents: 'auto', color: 'var(--sd-fg-1, #fff)', background: 'var(--sd-surface, rgba(10,15,30,0.85))',
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
      }}>
        ← Back
      </button>
      <span style={{
        marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 11.5,
        color: 'var(--sd-fg-3, #999)', background: 'var(--sd-surface, rgba(10,15,30,0.7))',
      }}>{hint}</span>
    </div>
  );
}

const firstOf = (row) => String(row?.name || 'them').trim().split(/\s+/)[0] || 'them';

const PILL = {
  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap',
  color: 'var(--sd-fg-1, #fff)', background: 'var(--sd-surface, rgba(10,15,30,0.8))',
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
};

/**
 * The chain this is: you, anyone before them along it (the trail, in Bridge
 * Chains: each one brings their own circle forward with `onPick`), them, their
 * circle, its catalysts, and the people past them.
 */
function Chain({ focus, onPick }) {
  const { person, kind, circle, catalysts, beyond, trail = [], outside = 0 } = focus;
  const pill = (text, tone) => <span style={{ ...PILL, ...(tone ? { color: tone } : null) }}>{text}</span>;
  const steps = [pill('You')];
  for (const row of trail) {
    steps.push(onPick
      ? <button type="button" className="cf-btn" onClick={() => onPick(row)} title={`Bring ${row.name}’s circle forward`}
        style={{ ...PILL, pointerEvents: 'auto', color: 'var(--sd-blue, #3498DB)' }}>{row.name}</button>
      : pill(row.name));
  }
  steps.push(pill(person.name));
  if (kind === 'circle') {
    // What a scan read, and apart from it who the mutual web saw with them (lib/mutual-web.js).
    if (circle > outside) steps.push(pill(`${(circle - outside).toLocaleString('en-US')} in their circle`));
    if (outside > 0) steps.push(pill(`${outside.toLocaleString('en-US')} seen outside the scan`));
    if (catalysts.length) steps.push(pill(`${catalysts.length} ${catalysts.length === 1 ? 'catalyst' : 'catalysts'}`, GREEN));
    if (beyond > 0) steps.push(pill(`${beyond.toLocaleString('en-US')} past them`));
  }
  return (
    <div aria-label="The chain" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((step, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span aria-hidden="true" style={{ color: 'var(--sd-fg-4, #777)', fontSize: 12 }}>→</span>}
          {step}
        </span>
      ))}
    </div>
  );
}

/**
 * Under the circle: how many at each ring, and what the marks mean. `plain`
 * (Bridge Chains): someone seen outside the scan is a lighter dot, not a dotted one.
 */
function Counts({ focus, plain = false }) {
  const { rings, totals } = focus;
  const swatch = (el, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>{el}{text}</span>
  );
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11.5, color: 'var(--sd-fg-3, #999)' }}>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {rings.map((r) => `${degreeName(r.degree)} ${r.people.length.toLocaleString('en-US')}`).join(' · ')}
        {totals.connected > 0 && <span style={{ color: GREEN }}> · you added {totals.connected}</span>}
      </span>
      {swatch(<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--sd-tier-a, #9b59b6)" /></svg>, 'colour = tier')}
      {swatch(<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="var(--sd-green, #00ff88)" strokeWidth="1.6" /></svg>, 'you added them')}
      {swatch(<span aria-hidden="true" style={{ color: GREEN, fontWeight: 800 }}>⚡</span>, 'catalyst: their circle is scanned too')}
      {focus.outside > 0 && swatch(plain
        ? <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="var(--sd-tier-b, #3498db)" fillOpacity="0.45" /></svg>
        : <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="var(--sd-tier-b, #3498db)" fillOpacity="0.3" stroke="var(--sd-tier-b, #3498db)" strokeWidth="1" strokeDasharray="2 1.6" /></svg>,
        `${focus.outside.toLocaleString('en-US')} seen outside the scan${plain ? ', lighter' : ''}`)}
    </div>
  );
}

/**
 * A dot's note, in the fixed tip `el` by the pointer: who, their tier, how
 * they're tied in, and "Known through" from the mutual web. Text, never
 * markup: names come from the network file. `it` null hides it.
 */
function showTip(el, e, it, { catalyst = null, web = null, mine = null, d1ById = null } = {}) {
  if (!el) return;
  if (!it) { el.style.display = 'none'; return; }
  const r = it.row;
  const lines = [
    [r.company, r.role].filter(Boolean).join(' · ') || r.headline || '',
    `${r.tier || 'D'} tier${r.power_score != null && r.power_score !== '' ? ` · ${Number(r.power_score).toFixed(1)}` : ''}`,
    catalyst ? `Catalyst: ${catalyst.people.toLocaleString('en-US')} more through them` : it.state === 'connected' ? 'You added them' : it.state === 'requested' ? 'Request sent' : '',
    r.seen_outside ? 'Seen outside the scan' : '',
    // How you know them, through the mutual web: "Known through: A, B (seen together 3 times, last on Oct 16, 2026)".
    web?.ready && (Number(r.degree) || 2) > 1 ? knownThroughText(knownThrough(r.profile_url, { index: web.index, mine, circles: [r], d1ById })) : '',
  ].filter(Boolean);
  el.replaceChildren();
  const b = document.createElement('strong');
  b.textContent = r.name || 'Someone';
  el.append(b);
  for (const line of lines) {
    const div = document.createElement('div');
    div.style.color = 'var(--sd-fg-3, #aaa)';
    div.textContent = line;
    el.append(div);
  }
  el.style.display = 'block';
  el.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
}

// The order a circle's people take their tier's rings in: whoever you added and
// the catalysts first (nearest the core), then by score, then by name.
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const tierOrder = (cats) => (a, b) => (TIER_RANK[a.row.tier] ?? 4) - (TIER_RANK[b.row.tier] ?? 4)
  || Number(cats.has(b.row.id) || b.state === 'connected') - Number(cats.has(a.row.id) || a.state === 'connected')
  || score1(b.row) - score1(a.row)
  || String(a.row.name || '').localeCompare(String(b.row.name || ''));

/** What a dot in tier rings carries, for TierDots: a green ring for whoever you added or a catalyst, lighter if seen outside the scan. */
const tierMark = (people, cats) => (row, i) => {
  const p = people[i];
  const cat = cats.has(row.id);
  return {
    added: p.state === 'connected' || cat,
    asked: p.state === 'requested',
    seen: Boolean(row.seen_outside) && p.state !== 'requested',
    label: cat ? `${String(row.name || '').split(' ')[0]} ⚡` : null,
  };
};

/**
 * Their circle, sharp: them in the middle, their people round them, each
 * catalyst's people fanning out behind the catalyst, and you off to the side
 * the map has you on, so it reads you → them → their people → the catalyst's.
 *
 * `canDive` (Bridge Chains): the person in the middle is a button that dives
 * into their circle full size (`onCore`), your line stops at the circle's edge
 * instead of running dotted across it, and a circle seen outside the scan only
 * sits in tier rings, as the dive and Degrees' Unscanned view have them.
 */
function FocusMap({ focus, box, origin, you, tierColors, selectedId, onSelect, tipRef, web = null, mine = null, d1ById = null, lines = NO_LINES, canDive = false, onCore = null }) {
  // Room above for Back, and below for the chain and the counts.
  const size = Math.max(220, Math.min(box.width - 120, box.height - 200));
  const tiered = canDive && focus.unscanned && focus.rings.length === 1;
  const layout = useMemo(() => (tiered ? null : focusLayout(focus.rings, size)), [tiered, focus.rings, size]);
  const half = size / 2;
  const k = size / 640;
  const coreSize = Math.round(Math.max(34, 46 * k));
  const catalysts = useMemo(() => new Map(focus.catalysts.map((c) => [c.row.id, c])), [focus.catalysts]);
  // Seen outside the scan only, in Bridge Chains: their people in tier rings round them.
  const tier = useMemo(() => {
    if (!tiered) return null;
    const people = [...focus.rings[0].people].sort(tierOrder(new Set(catalysts.keys())));
    const rows = people.map((p) => p.row);
    // A hole round them for their name under them, as the focus's own rings leave.
    const rings = tierRings(rows, { inner: Math.max(coreSize / 2 + 40, half * 0.22), outer: half * 0.94, spacing: 30, maxDot: 9, labelRoom: 11 });
    return { people, rows, rings, mark: tierMark(people, new Set(catalysts.keys())) };
  }, [tiered, focus.rings, catalysts, coreSize, half]);
  // Every dot once, in ring order, so a dot's data-i finds it; and where each ring starts in that list.
  const items = useMemo(() => (tier
    ? tier.people.map((p, i) => ({ ...p, x: half + tier.rings.points[i].x, y: half + tier.rings.points[i].y }))
    : layout.rings.flatMap((ring) => ring.items.map((it) => ({ ...it, ring })))), [tier, layout, half]);
  const starts = useMemo(() => {
    const out = [];
    let n = 0;
    for (const ring of layout?.rings || []) { out.push(n); n += ring.items.length; }
    return out;
  }, [layout]);
  const at = useMemo(() => new Map(items.map((it) => [it.row.id, it])), [items]);
  // You, just outside the rings, the way the map has you from them.
  const toYou = you ? Math.atan2(you.y - origin.y, you.x - origin.x) : Math.PI / 2;
  const youAt = { x: half + (half + 2) * Math.cos(toYou), y: half + (half + 2) * Math.sin(toYou) };
  const youLeft = Math.cos(toYou) < -0.2;   // named on the side away from the circle
  // In Bridge Chains your line stops where the circle starts.
  const edge = tier ? Math.min(half, tier.rings.edge + 4)
    : layout?.rings.length ? Math.min(half, Math.max(...layout.rings.map((r) => r.edge + r.dotR)) + 4) : half;
  const tether = canDive ? youTether(youAt, half, edge) : null;
  // The chain: them to each catalyst they lead to, and each catalyst to the next.
  const chain = focus.catalysts.map((c) => {
    const it = at.get(c.row.id);
    if (!it) return null;
    const up = at.get(it.parentId);
    return { id: c.row.id, x1: up ? up.x : half, y1: up ? up.y : half, x2: it.x, y2: it.y };
  }).filter(Boolean);

  const tip = (e, it) => showTip(tipRef.current, e, it, { catalyst: it ? catalysts.get(it.row.id) : null, web, mine, d1ById });
  const itemOf = (e) => items[Number(e.target?.closest?.('[data-i]')?.dataset?.i)] ?? null;
  // Someone you added, or a catalyst: a size up from the rest of their ring.
  const big = (ring) => Math.max(ring.dotR + 2, ring.dotR * 1.45);

  return (
    <div style={{ position: 'absolute', left: -half, top: -half, width: size, height: size, pointerEvents: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible" role="img"
        aria-label={`${focus.person.name}’s circle: ${focus.totals.people.toLocaleString('en-US')} people in ${tier ? `${tier.rings.bands.length} tier ${tier.rings.bands.length === 1 ? 'ring' : 'rings'}` : `${focus.rings.length} ${focus.rings.length === 1 ? 'ring' : 'rings'}`}`}
        style={{ display: 'block', overflow: 'visible' }}>
        {/* A click inside the circle stays in it; only the dimmed map outside goes back. */}
        <circle cx={half} cy={half} r={half + 4} fill="transparent" pointerEvents="all" />
        {canDive
          ? tether && <line x1={tether.x1} y1={tether.y1} x2={tether.x2} y2={tether.y2} stroke={MAP_LOOK.you} strokeOpacity={0.4} strokeWidth={1.2} strokeLinecap="round" />
          : <line x1={youAt.x} y1={youAt.y} x2={half} y2={half} stroke={MAP_LOOK.you} strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="3 4" />}
        {tier && (
          <g className="cf-ring" style={{ animationDelay: '140ms' }}>
            <TierBands layout={tier.rings} cx={half} cy={half} />
          </g>
        )}
        {layout && layout.rings.map((ring, i) => (
          <g key={ring.degree} className="cf-ring" style={{ animationDelay: `${140 + i * 110}ms` }}>
            <circle cx={half} cy={half} r={ring.mid} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.09)" strokeWidth={Math.max(1, ring.edge - ring.radius + 2 * ring.dotR)} strokeOpacity={0.5} />
            <text x={half} y={half - ring.edge - Math.max(ring.dotR, 3) - 6} textAnchor="middle" fontSize={11} fontWeight={700}
              fill="var(--sd-fg-4, #777)">{degreeName(ring.degree)}</text>
          </g>
        ))}
        <g className="cf-ring" style={{ animationDelay: '200ms' }}>
          {(layout?.spokes || []).map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={GREEN} strokeOpacity={0.35} strokeWidth={1} />
          ))}
          {chain.map((l) => (
            <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={GREEN} strokeOpacity={0.55} strokeWidth={1.4} />
          ))}
        </g>
        {/* Show ties: the people in front seen together, thin lines under the dots (lib/mutual-web.js tieLines). */}
        {lines.length > 0 && (
          <g pointerEvents="none" aria-hidden="true">
            {lines.map((l) => {
              // A dot, or them in the middle.
              const pos = (id) => at.get(id) || (id === focus.person.id ? { x: half, y: half } : null);
              const from = pos(l.a);
              const to = pos(l.b);
              if (!from || !to) return null;
              return <line key={`${l.a}|${l.b}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={{ stroke: TIE_COLOUR }}
                strokeOpacity={0.7} strokeWidth={Math.min(2.2, 0.8 + 0.3 * Math.log2(l.n || 1))} />;
            })}
          </g>
        )}
        <g pointerEvents="visiblePainted" onPointerOver={(e) => tip(e, itemOf(e))} onPointerMove={(e) => tip(e, itemOf(e))} onPointerOut={(e) => tip(e, null)}
          onClick={(e) => { const it = itemOf(e); if (!it) return; e.stopPropagation(); onSelect?.(it.row); }}>
          {tier ? (
            <g className="cf-ring" style={{ animationDelay: '180ms', cursor: 'pointer' }}>
              <TierDots rows={tier.rows} layout={tier.rings} cx={half} cy={half} mark={tier.mark} ids={`fm-${focus.person.id}`} />
              <TierLetters layout={tier.rings} cx={half} cy={half} />
            </g>
          ) : layout.rings.map((ring, i) => (
            <g key={ring.degree} className="cf-ring" style={{ animationDelay: `${180 + i * 110}ms` }}>
              {ring.items.map((it, j) => (
                <Dot key={it.key} it={it} i={starts[i] + j} r={it.state === 'connected' || catalysts.has(it.row.id) ? big(ring) : ring.dotR}
                  colour={tierColors[it.row.tier] || '#8899aa'} picked={it.row.id === selectedId} catalyst={catalysts.has(it.row.id)} plain={canDive} />
              ))}
            </g>
          ))}
        </g>
        {/* Catalysts by name: whose circle the next ring out is. */}
        {layout && (
          <g className="cf-ring" style={{ animationDelay: '260ms' }} pointerEvents="none">
            {focus.catalysts.map((c) => {
              const it = at.get(c.row.id);
              if (!it) return null;
              return (
                <text key={c.row.id} x={it.x} y={it.y - big(it.ring) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill={GREEN}
                  paintOrder="stroke" stroke="rgba(var(--sd-shade, 0, 0, 0), 0.55)" strokeWidth={3}>
                  {String(c.row.name || '').split(' ')[0]} ⚡
                </text>
              );
            })}
          </g>
        )}
        <circle cx={youAt.x} cy={youAt.y} r={7} fill={MAP_LOOK.you} stroke="#FFD700" strokeWidth={2} />
        <text x={youAt.x + (youLeft ? -12 : 12)} y={youAt.y + 4} textAnchor={youLeft ? 'end' : 'start'} fontSize={12} fontWeight={800}
          fill="var(--sd-fg-1, #fff)" paintOrder="stroke" stroke="rgba(var(--sd-shade, 0, 0, 0), 0.6)" strokeWidth={3}>You</text>
      </svg>
      {/* Them, in the middle: their face, or their initials. In Bridge Chains, the way into their circle full size. */}
      {canDive ? (
        <button type="button" className="cf-core" onClick={onCore} aria-label={`Open ${focus.person.name}’s circle full size`}
          title="Their circle full size: click, or scroll in"
          style={{ position: 'absolute', left: half, top: half, transform: 'translate(-50%, -50%)', padding: 0, margin: 0, border: 'none', font: 'inherit', ...FACE }}>
          <Avatar person={focus.person} size={coreSize} tierColors={tierColors} />
        </button>
      ) : (
        <div style={{ position: 'absolute', left: half, top: half, transform: 'translate(-50%, -50%)', pointerEvents: 'none', ...FACE }}>
          <Avatar person={focus.person} size={coreSize} tierColors={tierColors} />
        </div>
      )}
      <div style={{
        position: 'absolute', left: half, top: half + coreSize / 2 + 8, transform: 'translateX(-50%)',
        textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--sd-fg-1, #fff)', textShadow: HALO }}>{focus.person.name}</div>
        {canDive && (
          <div style={{ marginTop: 2, fontSize: 11, fontWeight: 600, color: 'var(--sd-fg-3, #aaa)', textShadow: HALO }}>
            Click or scroll in
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ it, i, r, colour, picked, catalyst, plain = false }) {
  const common = { 'data-i': i, className: 'cf-dot' };
  // Seen outside the scan (the mutual web): lighter, with a dashed ring of its tier's colour;
  // in Bridge Chains (`plain`) just lighter, nothing dotted.
  if (it.row?.seen_outside && it.state !== 'requested') {
    if (plain) {
      return <circle {...common} cx={it.x} cy={it.y} r={r} fill={colour} fillOpacity={0.45}
        stroke={picked ? 'var(--sd-fg-1, #fff)' : 'none'} strokeWidth={picked ? 2.4 : 0} />;
    }
    return <circle {...common} cx={it.x} cy={it.y} r={r} fill={colour} fillOpacity={0.3}
      stroke={picked ? 'var(--sd-fg-1, #fff)' : colour} strokeWidth={picked ? 2.4 : Math.max(0.8, r * 0.28)}
      strokeDasharray={picked ? undefined : `${Math.max(1, r * 0.5)} ${Math.max(0.8, r * 0.35)}`} />;
  }
  if (it.state === 'requested') {
    return <circle {...common} cx={it.x} cy={it.y} r={r * 1.25} fill="transparent" stroke={colour}
      strokeWidth={Math.max(0.8, r * 0.45)} strokeDasharray={plain ? undefined : `${Math.max(1, r * 0.55)} ${Math.max(0.8, r * 0.45)}`} />;
  }
  return <circle {...common} cx={it.x} cy={it.y} r={r} fill={colour}
    stroke={picked ? 'var(--sd-fg-1, #fff)' : it.state === 'connected' || catalyst ? GREEN : 'none'}
    strokeWidth={picked ? 2.4 : Math.max(1, r * 0.3)} />;
}

// The person in the middle of the dive, as Bridge Chains' opened circles always had them.
const CORE = 28;

/**
 * The dive: their circle full size, unblurred, filling the stage, in tier
 * rings round them (lib/chain-layout.js tierRings), the chains past it gone.
 * It grows up out of the focus's circle (`grow`, its radius on screen) as the
 * focus carries on past you, so overview → focus → dive reads as one zoom.
 * Hover a dot for who they are; click it, or them in the middle, for their
 * card. Drag to move, scroll or pinch to zoom; scrolling or pinching out from
 * where it started comes back to the focus (`onOut`), as Back and Esc do.
 */
function CircleDive({ focus, phase, box, bar, grow, ease, reduced, tierColors, selectedId, onSelect, onOut, tipRef, wheelRef, web, mine, d1ById, canScan }) {
  const open = phase === 'open';
  const dur = diveDuration({ phase, reduced });
  const { person } = focus;
  const ring = focus.rings[0];
  const catalysts = useMemo(() => new Map(focus.catalysts.map((c) => [c.row.id, c])), [focus.catalysts]);
  const people = useMemo(() => {
    const cats = new Set(catalysts.keys());
    return [...(ring?.people || [])].sort(tierOrder(cats));
  }, [ring, catalysts]);
  const rows = useMemo(() => people.map((p) => p.row), [people]);
  const mark = useMemo(() => tierMark(people, new Set(catalysts.keys())), [people, catalysts]);
  // Room above for Back and the title, below for the counts.
  const cx = box.width / 2;
  const cy = box.height / 2 + 22;
  const maxR = Math.max(110, Math.min(box.width / 2 - 30, box.height / 2 - 96));
  const layout = useMemo(() => tierRings(rows, { inner: CORE + 6, outer: maxR, spacing: 34, maxDot: 11, labelRoom: 12 }), [rows, maxR]);
  // Fits the window to start with; past the smallest the rings go, zoomed out to fit.
  const fitK = Math.min(1, maxR / Math.max(1, layout.edge));
  const [viewSet, setViewSet] = useState(null);
  const view = viewSet ?? { k: fitK, x: 0, y: 0 };
  const k = view.k;
  const [hover, setHover] = useState(null);       // a dot's index, 'core', or null
  const drag = useRef(null);
  const svgRef = useRef(null);
  const out = useRef(null);
  const pinch = useRef(null);

  const zoomBy = (f, at = { x: 0, y: 0 }) => setViewSet((v) => {
    const cur = v ?? { k: fitK, x: 0, y: 0 };
    const nk = Math.max(fitK, Math.min(6, cur.k * f));
    if (nk <= fitK + 1e-6) return null;               // back where it started: fitted, in the middle
    return { k: nk, x: at.x - ((at.x - cur.x) * nk) / cur.k, y: at.y - ((at.y - cur.y) * nk) / cur.k };
  });
  // The dialog passes its wheel here while the dive is open (CircleFocus). In
  // zooms in; out zooms back to where it started, and stops there: a fresh
  // scroll out from there goes back to the focus (lib/circle-focus.js wheelGate).
  const rest = useRef({ at: -Infinity, armed: true });
  useEffect(() => {
    wheelRef.current = (e) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const now = e.timeStamp || performance.now();
      const at = { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy };
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      if (e.deltaY < 0) { out.current = null; rest.current = { at: now, armed: true }; zoomBy(f, at); return; }
      if (viewSet && viewSet.k > fitK + 1e-6) {
        out.current = null;
        // Reaching the start: the rest of this scroll stops there.
        if (viewSet.k * f <= fitK + 1e-6) rest.current = { at: now, armed: false };
        zoomBy(f, at);
        return;
      }
      rest.current = wheelGate(rest.current, now);
      if (!rest.current.pass) return;
      out.current = wheelOut(out.current, e, now);
      if (out.current.out) onOut();
    };
    return () => { wheelRef.current = null; };
  });

  const hitAt = (clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const wx = (clientX - rect.left - cx - view.x) / k;
    const wy = (clientY - rect.top - cy - view.y) / k;
    if (Math.hypot(wx, wy) <= CORE + 2) return 'core';
    let best = null;
    let bestD = Infinity;
    const pts = layout.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD && d <= Math.max(p.r * 1.5, 7 / k)) { bestD = d; best = i; }
    }
    return best;
  };
  const tipFor = (e, hit) => {
    if (hit == null) return showTip(tipRef.current, e, null);
    if (hit === 'core') return showTip(tipRef.current, e, { row: person, state: null }, { web: null });
    return showTip(tipRef.current, e, people[hit], { catalyst: catalysts.get(rows[hit].id), web, mine, d1ById });
  };
  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) { d.moved = true; tipFor(e, null); }
      if (d.moved) { setViewSet((v) => ({ ...(v ?? { k: fitK }), x: d.vx + dx, y: d.vy + dy })); return; }
    }
    const hit = hitAt(e.clientX, e.clientY);
    setHover((h) => (h === hit ? h : hit));
    tipFor(e, hit);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit === 'core') onSelect?.(person);
    else if (hit != null) onSelect?.(rows[hit]);
  };
  const two = (e) => (e.touches.length === 2 ? Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) : 0);

  // Grows up out of the focus's circle, and back down into it.
  const start = Math.max(0.25, Math.min(0.95, grow / Math.max(1, layout.edge * fitK)));
  const photo = localPhoto(person.profile_image_url);
  const picked = rows.findIndex((r) => r.id === selectedId);
  const hp = typeof hover === 'number' ? layout.points[hover] : null;
  const added = people.filter((p) => p.state === 'connected').length;
  const seen = rows.filter((r) => r.seen_outside).length;
  const first = firstOf(person);
  const degree = ring?.degree ?? 2;
  const ord = (n) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const dotAt = (i) => ({ x: layout.points[i].x, y: layout.points[i].y, r: layout.points[i].r });

  return (
    <div data-dive={phase}
      onTouchStart={(e) => { const d = two(e); pinch.current = d ? { d, k } : null; }}
      onTouchMove={(e) => {
        const p = pinch.current;
        const d = two(e);
        if (!p || !d) return;
        const nk = (p.k * d) / p.d;
        if (nk < fitK * 0.8) { pinch.current = null; onOut(); return; }
        setViewSet((v) => (nk <= fitK + 1e-6 ? null : { ...(v ?? { x: 0, y: 0 }), k: Math.min(6, nk) }));
      }}
      style={{
        position: 'absolute', inset: 0, pointerEvents: open ? 'auto' : 'none',
        transformOrigin: `${cx}px ${cy}px`, transform: open || reduced ? 'scale(1)' : `scale(${start.toFixed(3)})`,
        opacity: open ? 1 : 0, transition: `transform ${dur}ms ${ease}, opacity ${Math.round(dur * 0.8)}ms ease-out`,
      }}>
      <svg ref={svgRef} width={box.width} height={box.height}
        style={{ display: 'block', touchAction: 'none', cursor: hover != null ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={(e) => { if (!drag.current) { setHover(null); tipFor(e, null); } }}
        role="img" aria-label={`${person.name}’s circle, full size: ${rows.length.toLocaleString('en-US')} ${rows.length === 1 ? 'person' : 'people'} in ${layout.bands.length} tier ${layout.bands.length === 1 ? 'ring' : 'rings'}`}>
        <g transform={`translate(${cx + view.x} ${cy + view.y}) scale(${k})`}>
          <TierBands layout={layout} k={k} />
          <TierDots rows={rows} layout={layout} k={k} mark={mark} ids={`dv-${person.id}`} />
          <TierLetters layout={layout} k={k} />
          {/* Whose card is open, and the one under the pointer */}
          {picked >= 0 && (
            <circle cx={dotAt(picked).x} cy={dotAt(picked).y} r={dotAt(picked).r + 2.5 / k} fill="none" stroke="var(--sd-fg-1, #fff)" strokeWidth={1.6 / k} pointerEvents="none" />
          )}
          {hp && (
            <circle cx={hp.x} cy={hp.y} r={hp.r + 2 / k} fill="none" stroke="var(--sd-fg-1, #fff)" strokeOpacity={0.8} strokeWidth={1.4 / k} pointerEvents="none" />
          )}
          {/* Them, in the middle */}
          <g pointerEvents="none">
            <circle r={CORE + 8} fill={tierColors[person.tier] || '#8899aa'} fillOpacity={0.08} />
            <circle r={CORE} fill="var(--sd-bg, #0a0a1a)" stroke={tierColors[person.tier] || 'var(--sd-fg-3, #888)'} strokeWidth={hover === 'core' ? 4 : 3} />
            {photo ? (
              <>
                <clipPath id={`dive-core-${person.id}`}><circle r={CORE - 4} /></clipPath>
                <image href={photo} x={-(CORE - 4)} y={-(CORE - 4)} width={(CORE - 4) * 2} height={(CORE - 4) * 2} clipPath={`url(#dive-core-${person.id})`} />
              </>
            ) : (
              <text y={6} textAnchor="middle" fill={tierColors[person.tier] || 'var(--sd-fg-3, #888)'} fontSize={17} fontWeight={800}>
                {String(person.name || '?').split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join('')}
              </text>
            )}
          </g>
        </g>
      </svg>

      {/* Whose circle this is, under Back */}
      <div style={{ position: 'absolute', top: bar.top + 42, left: bar.side, right: bar.side, pointerEvents: 'none', textShadow: HALO }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--sd-fg-1, #fff)' }}>{person.name}</div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--sd-fg-3, #999)' }}>
          {first}’s circle · {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'person' : 'people'} · {ord(degree)} degree{focus.trail?.length ? ', counted along this chain' : ''}
          {focus.unscanned ? ' · seen outside the scan only' : ''}
        </div>
      </div>

      {/* What's in it: each tier, and what the marks mean */}
      <div style={{ position: 'absolute', bottom: 14, left: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        {focus.unscanned && <ScanNudge person={person} canScan={canScan} />}
        <TierCounts rows={rows} style={{ justifyContent: 'center', fontSize: 11.5, textShadow: HALO }} extra={(
          <>
            {added > 0 && <span style={{ color: GREEN }}>● you added {added.toLocaleString('en-US')}</span>}
            {catalysts.size > 0 && <span style={{ color: GREEN }}>⚡ {catalysts.size} {catalysts.size === 1 ? 'catalyst' : 'catalysts'}</span>}
            {seen > 0 && !focus.unscanned && <span>{seen.toLocaleString('en-US')} seen outside the scan, lighter</span>}
            <span style={{ color: 'var(--sd-fg-4, #777)' }}>Click anyone for their card · drag to move · scroll to zoom</span>
          </>
        )} />
      </div>
    </div>
  );
}

/**
 * Nothing scanned yet: just them, a faint ring where their circle will go, and
 * the way to scan it, the same scan their card's scan box starts
 * (lib/scraper-client.js startHere). Or Back.
 */
function FocusCore({ person, box, tierColors, canScan, onClose }) {
  const scan = useScanner();
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState(null);
  const first = String(person.name || 'them').split(' ')[0];
  const mine = scan.running && scansCircleOf(scan, person);
  const queued = queuedFor(scan, 'bridge', person);
  const busy = scan.running && !mine && !queued && !willQueue(scan, 'bridge', person) ? busyReason(scan) : null;
  const start = async () => {
    setProblem(null);
    setChecking(true);
    const why = await startHere('bridge', { name: person.name, id: person.id });
    setChecking(false);
    if (why) setProblem(why);
  };
  const avatar = 76;
  // Them where their dot zoomed to, unless that leaves no room under them.
  const lift = Math.max(0, avatar / 2 + 290 - box.height / 2);
  const detail = [person.role, person.company].filter(Boolean).join(' · ') || person.headline || '';
  const label = mine ? 'Scanning…' : queued ? queued.label : checking ? 'Checking the scanner…' : 'Scan their circle';
  return (
    <div style={{ position: 'absolute', left: -170, top: -avatar / 2 - lift, width: 340, textAlign: 'center', pointerEvents: 'none' }}>
      <div style={{ position: 'relative', width: avatar, height: avatar, margin: '0 auto' }}>
        {/* Where their circle will go. */}
        <div aria-hidden="true" style={{
          position: 'absolute', left: '50%', top: '50%', width: 180, height: 180, transform: 'translate(-50%, -50%)', borderRadius: '50%',
          border: '1.5px dashed rgba(var(--sd-ink, 255, 255, 255), 0.16)', pointerEvents: 'none',
        }} />
        <div style={FACE}><Avatar person={person} size={avatar} tierColors={tierColors} /></div>
      </div>
      <div style={{ marginTop: 56, fontSize: 19, fontWeight: 800, color: 'var(--sd-fg-1, #fff)', textShadow: HALO }}>{person.name}</div>
      {detail && <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--sd-fg-2, #ccc)', lineHeight: 1.4, textShadow: HALO }}>{detail}</div>}
      <div style={{
        pointerEvents: 'auto', marginTop: 16, padding: '14px 16px', borderRadius: 14, textAlign: 'center',
        background: 'var(--sd-surface, rgba(10,15,30,0.86))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--sd-fg-1, #fff)' }}>Nothing scanned for {first} yet</div>
        <div style={{ marginTop: 5, fontSize: 12, color: 'var(--sd-fg-3, #999)', lineHeight: 1.5 }}>
          {mine
            ? <>Reading {first}&apos;s circle now. It comes forward here once it&apos;s in.</>
            : canScan
            ? <>Scan their circle to see who they know, and everyone you can reach through them.</>
            : <>Scanning works on your own network, with the scanner set up on the Scan page.</>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          {canScan ? (
            <button type="button" className="cf-btn" onClick={start} disabled={Boolean(mine || queued || busy || checking)} style={{
              border: 'none', color: '#fff', background: 'linear-gradient(135deg, #9B59B6, #3498DB)',
            }}>{label}</button>
          ) : (
            <Link href="/setup" className="cf-btn" style={{
              textDecoration: 'none', color: 'var(--sd-blue, #3498DB)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.16)',
            }}>Open the Scan page</Link>
          )}
          <button type="button" className="cf-btn" onClick={onClose} style={{
            color: 'var(--sd-fg-2, #ccc)', background: 'transparent', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.16)',
          }}>Back to the map</button>
        </div>
        {busy && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sd-fg-3, #999)' }}>{busy}. One scan at a time: press again when it ends.</div>}
        {queued && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sd-fg-3, #999)' }}>It starts by itself when the scans before it finish.</div>}
        {problem && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--sd-red, #ff6b6b)' }}>{problem}</div>}
      </div>
    </div>
  );
}
