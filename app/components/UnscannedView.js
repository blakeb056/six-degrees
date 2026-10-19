'use client';

// Degrees → Unscanned: your connections whose circles aren't scanned yet, round
// you the way Bridge Chains rings your bridges, and a press that builds one.
//
// Blake, 2026-10-04: "basically the same thing we have for bridges but just
// make it for unscanned clusters and when they click on the dot instead of
// showing a empty cluster make it fun by have a button in the middle of the
// core of the empty cluster and its imediatalyl aniamting ones adding into the
// cluster just to keep their attentive attentiion on. come back and fourth
// seeing the progress, it can just be time based on every dot being added."
//
// - The overview is Bridge Chains' (ChainView.js): you in the middle, the
//   people on rings round you, S nearest and strongest first, names under them,
//   hover, zoom and drag, the Filters grid's tiers. Its people are everyone whose
//   circle is still to do (lib/reach.js notScannedYet); a list the scanner has
//   already read (hidden, or read with nobody new) is left out and counted.
// - A click opens their circle as Bridge Chains opens one, empty: its core is a
//   button, Build their circle, with the cost on hover. One press starts the
//   scan there (startHere, the card's own start); a reason it didn't start is a
//   short line under it that fades (InlineNote). No question, no other page.
// - From that moment dots join the circle one after another, on a clock kept
//   to the scanner's own pace (lib/forming-circle.js): neutral "on its way"
//   dots, never more than a page ahead of what it has read, and as it saves
//   people they take those places in their tier colours. The words under the
//   core say what it has really found and saved. When it ends the leftover
//   dots fade, the circle settles into tier rings as Bridge Chains' do, and
//   the person belongs to Bridge Chains, which a link opens.
// - Everything drawn comes from the scan's start time and the scanner's counts,
//   so leaving the view, the tab or the page and coming back shows the circle
//   where it has got to. Coming back to this view while one of its circles is
//   being built opens that circle again.

import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import { circleIndex } from '../../lib/circle';
import { localPhoto } from '../../lib/photos';
import { reachIndex, reachState, circleState, notScannedYet, circleScanCost } from '../../lib/reach';
import { dotRadius, tierRings, TIER_RING } from '../../lib/chain-layout';
import { formingCount, formingSlots, formingPlan, formingSpacing, PER_PAGE } from '../../lib/forming-circle';
import { score, compareBridges } from '../../lib/separation';
import { watchScanner, scannerNow, isCircleScan, startHere, busyReason, willQueue, queuedFor } from '../../lib/scraper-client';
import { paceOf } from '../../lib/scan-pace';
import useScanner from './useScanner';
import { scanShows } from '../../lib/scanner-capabilities';
import InlineNote, { useFadingNote } from './InlineNote';
import { FormingCluster } from './ClusterSpinner';
import { Tip, ZoomButtons, HALO_TEXT } from './ChainView';
import { NodeFace, Halo, TierBands, TierDots, TierLetters, TierCounts } from './TierRings';
import { TIER_COLORS } from '../../lib/themes';

const GREEN = '#00ff88';
const NONE = [];
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const byTierThenScore = (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)
  || score(b) - score(a)
  || String(a.name || '').localeCompare(String(b.name || ''));
const firstName = (row) => String(row?.name || '').trim().split(/\s+/)[0] || 'them';

// Whose circle is being scanned now, by id: a string, so the overview re-renders
// only when it changes, not on every line of the scan's log.
const buildingNow = () => {
  const s = scannerNow();
  return s.running && isCircleScan(s) ? s.target?.id ?? null : null;
};
const buildingNone = () => null;
const watchNothing = () => () => {};

// Reduce Motion, as ChainView reads it.
const STILL = '(prefers-reduced-motion: reduce)';
function watchMotion(onChange) {
  const m = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(STILL) : null;
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}
const stillNow = () => Boolean(typeof window !== 'undefined' && window.matchMedia?.(STILL).matches);
const stillOnServer = () => true;

export default function UnscannedView({ connections, onSelect, userName, fullDegree1, fullDegree2, scanNotes, canScan = true, onOpenCircle }) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  // Every row, whatever the tier filter: a circle being built is drawn whole.
  const all1 = fullDegree1 || connections;
  const all2 = fullDegree2 || NONE;
  const index = useMemo(() => circleIndex(all1, all2), [all1, all2]);
  const reach = useMemo(() => reachIndex(all1, all2, scanNotes), [all1, all2, scanNotes]);
  // The sample and a CSV have no scans, so nothing to ask the scanner.
  const buildingId = useSyncExternalStore(canScan ? watchScanner : watchNothing, buildingNow, buildingNone);
  const still = useSyncExternalStore(watchMotion, stillNow, stillOnServer);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    // As ChainView: hold the element, and publish only a changed size (TRAPS §29).
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Who is drawn: everyone the filter shows whose circle is still to do, and
  // whoever's circle is being built now, though its first saves make it "scanned".
  const people = useMemo(() => {
    const { todo, hidden, read } = notScannedYet(connections, reach);
    const building = buildingId != null && !todo.some((r) => r.id === buildingId)
      ? connections.find((r) => r.id === buildingId) : null;
    return { list: building ? [...todo, building].sort(compareBridges) : todo, hidden, read };
  }, [connections, reach, buildingId]);

  // Whose circle is open; null is the overview.
  const [openId, setOpenId] = useState(null);
  // A circle of this view being built opens by itself, once per scan: coming
  // back to the view finds it where it has got to.
  const [followed, setFollowed] = useState(null);
  if (buildingId && followed !== buildingId) {
    setFollowed(buildingId);
    if (openId == null && people.list.some((r) => r.id === buildingId)) setOpenId(buildingId);
  }
  const open = openId != null ? all1.find((r) => r.id === openId) ?? null : null;

  // Esc goes back to the overview, unless it's closing something else or leaving a text box.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={containerRef} style={{ flex: 1, background: 'var(--sd-page)', position: 'relative', overflow: 'hidden' }}>
      {open ? (
        <BuildCircle key={open.id} person={open} index={index} reach={reach} dims={dims} still={still} canScan={canScan}
          onBack={() => setOpenId(null)} onSelect={onSelect} onOpenCircle={onOpenCircle} />
      ) : (
        <Overview people={people} reach={reach} dims={dims} still={still} buildingId={buildingId}
          userName={userName} canScan={canScan} onOpen={setOpenId} />
      )}
    </div>
  );
}

/**
 * Where the overview rings its people: in rings by tier round you, S nearest
 * and biggest, then A, B and C, D furthest out, small and muted (Blake,
 * 2026-10-17: "for unscanned it's just a big giant circle with a bunch of
 * unscanned ones ... so they can focus on the yellow, which is more priority,
 * purple, and then blue and green, and the other ones don't really matter that
 * much so they can be further out"). The same tier rings as Bridge Chains'
 * dive (lib/chain-layout.js tierRings, TierRings.js), so the two look alike.
 * The list comes strongest first, so each tier's best sit nearest you.
 */
function overviewLayout(list, maxR) {
  return tierRings(list, { inner: 28, outer: maxR * 0.94, spacing: 40, maxDot: 11, labelRoom: 12 });
}

// A small list has the room to name everyone but D; a big one names S and A as they fit.
const NAMED_FEW = Object.freeze(['S', 'A', 'B', 'C']);
const NAMED_MANY = Object.freeze(['S', 'A']);

function Overview({ people, reach, dims, still, buildingId, userName, canScan, onOpen }) {
  const [hovered, setHovered] = useState(null);     // a person's id
  // null until it's zoomed or moved: the home view below.
  const [viewSet, setViewSet] = useState(null);
  const drag = useRef(null);
  const svgRef = useRef(null);
  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;
  const list = people.list;
  const layout = useMemo(() => overviewLayout(list, maxR), [list, maxR]);
  // The whole circle in the window, clear of the view buttons over its top.
  const homeZoom = Math.max(0.6, Math.min(1.3, Math.min(cx, cy - 40) / (layout.edge + 16)));
  const view = viewSet ?? { k: homeZoom, x: 0, y: 0 };
  const k = view.k;
  const setView = (next) => setViewSet((v) => (typeof next === 'function' ? next(v ?? { k: homeZoom, x: 0, y: 0 }) : next));

  const dots = useMemo(() => list.map((row, i) => {
    const p = layout.points[i];
    return { row, x: cx + p.x, y: cy + p.y, r: p.r, ready: reachState(row, reach) === 'ready' };
  }), [list, layout, cx, cy, reach]);
  const byId = useMemo(() => new Map(dots.map((d) => [d.row.id, d])), [dots]);
  // Ready to scan: the soft green halo, as before.
  const mark = useMemo(() => (row, i) => (dots[i]?.ready ? { glow: true } : null), [dots]);
  const named = list.length <= 60 ? NAMED_FEW : NAMED_MANY;

  const hitAt = (clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const wx = (clientX - rect.left - cx - view.x) / k + cx;
    const wy = (clientY - rect.top - cy - view.y) / k + cy;
    let best = null;
    let bestD = Infinity;
    for (const d of dots) {
      const dist = Math.hypot(d.x - wx, d.y - wy);
      if (dist < bestD && dist <= Math.max(d.r * 1.8, 9 / k)) { bestD = dist; best = d; }
    }
    return best;
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
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      if (d.moved) {
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        return;
      }
    }
    const hit = hitAt(e.clientX, e.clientY)?.row.id ?? null;
    setHovered((h) => (h === hit ? h : hit));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) { setHovered(null); onOpen(hit.row.id); }
  };
  const zoomBy = (f, at = { x: 0, y: 0 }) => setView((v) => {
    const nk = Math.max(0.4, Math.min(6, v.k * f));
    return { k: nk, x: at.x - ((at.x - v.x) * nk) / v.k, y: at.y - ((at.y - v.y) * nk) / v.k };
  });
  const onWheel = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy });
  };

  const hov = hovered != null ? byId.get(hovered) : null;
  const building = buildingId != null ? byId.get(buildingId) : null;
  const toScreen = (d) => ({ x: (d.x - cx) * k + cx + view.x, y: (d.y - cy) * k + cy + view.y });
  const left = people.hidden + people.read;
  const r0 = 11;

  return (
    <>
      <svg ref={svgRef} width={dims.w} height={dims.h}
        style={{ display: 'block', touchAction: 'none', cursor: hov ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) setHovered(null); }} onWheel={onWheel}
        role="img" aria-label={`${list.length} ${list.length === 1 ? 'connection' : 'connections'} whose circle isn’t scanned yet, in rings by tier`}>
        <g transform={`translate(${cx * (1 - k) + view.x}, ${cy * (1 - k) + view.y}) scale(${k})`}>
          {/* A faint band behind each tier, and its letter over the dots, as Bridge Chains' circles have them */}
          <TierBands layout={layout} cx={cx} cy={cy} k={k} />
          <TierDots rows={list} layout={layout} cx={cx} cy={cy} k={k} mark={mark} still={still} named={named} ids="un" />
          <TierLetters layout={layout} cx={cx} cy={cy} k={k} />
          {/* The one under the pointer, on top, bigger and named */}
          {hov && hov !== building && (() => {
            const hr = Math.max((hov.r * 13) / 11, 6 / k);
            return (
              <g pointerEvents="none">
                <circle cx={hov.x} cy={hov.y} r={(hr * 21) / 13} fill={`${TIER_COLORS[hov.row.tier] || '#555'}14`} />
                <NodeFace row={hov.row} x={hov.x} y={hov.y} r={hr} hov scale={hr / 13} clipId={'unh-' + hov.row.id} />
                <text x={hov.x} y={hov.y + hr + 12 / k} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={10 / k} fontWeight={700}
                  stroke="var(--sd-bg)" strokeWidth={2.6 / k} paintOrder="stroke">{hov.row.name}</text>
              </g>
            );
          })()}
          {/* Whose circle is being built: the cluster forming on their dot, to find it again */}
          {building && (
            <g pointerEvents="none">
              <FormingCluster x={building.x} y={building.y} r={34 / k} hub={Math.max(building.r, 9 / k)} still={still} />
              <NodeFace row={building.row} x={building.x} y={building.y} r={Math.max(building.r * 1.2, 9 / k)} hov scale={Math.max(building.r * 1.2, 9 / k) / 13} clipId={'unb-' + building.row.id} />
              <text x={building.x} y={building.y + 34 / k * 1.24 + 13 / k} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={10 / k} fontWeight={700}
                stroke="var(--sd-bg)" strokeWidth={2.6 / k} paintOrder="stroke">Building {firstName(building.row)}’s circle</text>
            </g>
          )}
          {/* Center: YOU */}
          <circle cx={cx} cy={cy} r={22} fill="var(--sd-bg)" stroke="#FFD700" strokeWidth={3} pointerEvents="none" />
          <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--sd-gold, #FFD700)" fontSize={11} fontWeight={800} pointerEvents="none">
            {userName?.split(' ')[0] || 'YOU'}
          </text>
        </g>
        {hov && (() => {
          const at = toScreen(hov);
          const status = hov.row.id === buildingId ? 'Their circle is being built now'
            : hov.ready ? `Ready to scan · met through ${firstName({ name: hov.row.unlocked_from_name })}’s circle`
            : 'Their circle isn’t scanned yet';
          return (
            <Tip x={at.x} y={at.y - Math.max((hov.r || r0) * k, 6) - 4} w={dims.w} accent={hov.ready ? GREEN : TIER_COLORS[hov.row.tier]}
              lines={[hov.row.name, `${hov.row.tier}-tier · ${score(hov.row).toFixed(1)}`, status,
                canScan ? 'Click to open it and build it' : 'Click to open it']} />
          );
        })()}
      </svg>

      {list.length === 0 && (
        <div role="status" style={{
          position: 'absolute', left: '50%', top: cy + 48, transform: 'translateX(-50%)', width: 'min(360px, calc(100% - 32px))',
          textAlign: 'center', fontSize: 12, lineHeight: 1.55, color: 'var(--sd-fg-3, #9aa)', textShadow: HALO_TEXT,
        }}>
          Everyone the filter shows has a circle scanned{left > 0 ? ', or a list the scanner has already read' : ''}. Bridge Chains has them.
        </div>
      )}

      <ZoomButtons onIn={() => zoomBy(1.3)} onReset={() => setViewSet(null)} onOut={() => zoomBy(1 / 1.3)} />

      {/* How many, by tier, as Bridge Chains' circles count them: words over the map, no box */}
      {list.length > 0 && (
        <div title={[
          `${list.length.toLocaleString('en-US')} of your connections the filter shows have no circle scanned yet`,
          left > 0 ? `${left.toLocaleString('en-US')} more are left out: the scanner has read their list (${[people.hidden ? `${people.hidden} hidden` : null, people.read ? `${people.read} read with nobody new` : null].filter(Boolean).join(', ')})` : null,
          'In rings by tier: S nearest you, strongest first. Click anyone to open their circle and build it',
        ].filter(Boolean).join('\n')}
        style={{ position: 'absolute', bottom: 18, left: 18, maxWidth: 'calc(100% - 110px)', textShadow: HALO_TEXT }}>
          <TierCounts rows={list} extra={(
            <>
              <span><b style={{ color: 'var(--sd-fg-1, #fff)', fontVariantNumeric: 'tabular-nums' }}>{list.length.toLocaleString('en-US')}</b> not scanned yet</span>
              {left > 0 && <span>{left.toLocaleString('en-US')} already read, left out</span>}
            </>
          )} />
        </div>
      )}
    </>
  );
}

// How a forming circle moves. A dot that joins flies out of the core to its
// place; a saved person pops in where an "on its way" dot was; whatever's left
// over when the scan ends fades; the next place breathes, or draws its ring
// round as the clock runs to it. Nothing moves with Reduce Motion: dots appear.
const FORM_CSS = `
@keyframes fmJoin { from { transform: translate(var(--fx), var(--fy)) scale(0.25); opacity: 0; } 55% { opacity: 1; } to { transform: none; opacity: 1; } }
@keyframes fmReveal { from { transform: scale(0.3); opacity: 0.25; } 60% { transform: scale(1.35); opacity: 1; } to { transform: none; opacity: 1; } }
@keyframes fmFade { to { transform: scale(0.4); opacity: 0; } }
@keyframes fmNext { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes fmWait { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.5; } }
@keyframes fmSpoke { from { opacity: 0.7; } to { opacity: 0.08; } }
@keyframes fmCore { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.6; } }
@keyframes fmPress { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,255,136,0.35), 0 8px 26px rgba(0,0,0,0.35); } 50% { box-shadow: 0 0 0 12px rgba(0,255,136,0), 0 8px 26px rgba(0,0,0,0.35); } }
.fm-slot { transition: transform 0.8s cubic-bezier(.2,.8,.2,1); }
.fm-join { transform-box: fill-box; transform-origin: center; animation: fmJoin 0.6s cubic-bezier(.2,.9,.3,1.15) both; animation-delay: var(--d, 0ms); }
.fm-real { transform-box: fill-box; transform-origin: center; animation: fmReveal 0.5s ease-out both; animation-delay: var(--d, 0ms); }
.fm-fade { transform-box: fill-box; transform-origin: center; animation: fmFade 1.4s ease-in forwards; animation-delay: var(--d, 0ms); }
.fm-next { animation: fmNext var(--t) linear both; animation-delay: var(--d, 0ms); }
.fm-wait { animation: fmWait 1.6s ease-in-out infinite; }
.fm-spoke { animation: fmSpoke 2.4s ease-out forwards; }
.fm-core { animation: fmCore 2.4s ease-in-out infinite; }
.fm-press { animation: fmPress 2.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .fm-slot { transition: none; }
  .fm-join, .fm-real, .fm-next, .fm-wait, .fm-spoke, .fm-core, .fm-press { animation: none; }
  .fm-fade { animation: none; opacity: 0; }
}
`;

/**
 * One person's circle, being built or ready to be: the core in the middle (a
 * button until the scan starts), and round it the dots joining on the clock.
 */
function BuildCircle({ person, index, reach, dims, still, canScan, onBack, onSelect, onOpenCircle }) {
  const scan = useScanner();
  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;
  const first = firstName(person);
  const mine = scan.running && isCircleScan(scan) && scan.target?.id === person.id;
  // While something else runs, a press waits its turn in the queue (lib/scan-queue.js)
  // and the button says where ("Queued · 2nd").
  const queued = queuedFor(scan, 'bridge', person);
  const busy = scan.running && !mine && !queued && !willQueue(scan, 'bridge', person) ? busyReason(scan) : null;
  // The people the scanner has saved from their circle, strongest first, so S sit nearest the core.
  const real = useMemo(() => [...(index.circles.get(person.id) || NONE)].sort(byTierThenScore), [index, person.id]);
  const found = mine ? scan.found.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const pace = scan.budget?.pace || 'fast';
  const [now, setNow] = useState(() => Date.now());
  const count = formingCount({ startedAt: mine && !scan.pending ? scan.startedAt : null, now, pace, found, saved: real.length, running: mine });
  // The clock: a look again when its next dot is due. Only the moment comes
  // from here; what's drawn is worked out from the scan's own start (TRAPS §17:
  // a timer may say when, never what).
  useEffect(() => {
    if (!mine || count.nextIn == null) return undefined;
    const wait = Math.max(40, count.nextIn - (Date.now() - now) + 30);
    const t = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(t);
  }, [mine, count.nextIn, now]);

  // Which dots were already there when this opened (they don't join again:
  // nothing restarts on coming back), and where the count was before it last
  // grew (the dots that join together set off one after another from there).
  const [atOpen] = useState(() => ({ shown: count.shown, ids: new Set(real.map((r) => r.id)) }));
  const [last, setLast] = useState({ mine, shown: count.shown, from: count.shown, ended: false });
  if (mine && count.shown !== last.shown) setLast({ mine: true, shown: count.shown, from: Math.min(last.shown, count.shown), ended: false });
  else if (mine !== last.mine) setLast({ mine, shown: mine ? count.shown : last.shown, from: last.from, ended: !mine });

  // Places while it forms: fixed, so a dot stays where it landed (lib/forming-circle.js).
  const inner = Math.max(62, maxR * 0.3);
  const outer = maxR * 0.94;
  const want = Math.max(count.shown + 1, last.ended ? last.shown : 0);
  const spacing = formingSpacing(formingPlan(want), { inner, outer });
  const slots = useMemo(() => formingSlots(want, { inner, spacing }), [want, inner, spacing]);
  // Once it's over, the circle settles into tier rings round them, S nearest, as
  // Bridge Chains' dive and this view's overview have them (lib/chain-layout.js tierRings).
  const bands = useMemo(() => (mine || !real.length ? null : tierRings(real, {
    inner: 34, outer, spacing: 34, maxDot: 11, labelRoom: 12,
  })), [mine, real, outer]);
  const ghostR = Math.max(1.4, Math.min(5.5, spacing * 0.3));
  const shown = count.shown;
  const { ended: lastEnded, shown: lastShown, from: lastFrom } = last;

  const [hover, setHover] = useState(null);         // { kind: 'real'|'ghost', i }
  const [viewSet, setViewSet] = useState(null);
  const view = viewSet ?? { k: 1, x: 0, y: 0 };
  const k = view.k;
  const setView = (next) => setViewSet((v) => (typeof next === 'function' ? next(v ?? { k: 1, x: 0, y: 0 }) : next));
  const drag = useRef(null);
  const svgRef = useRef(null);
  const [problem, say] = useFadingNote(9000);
  const [pressed, setPressed] = useState(false);
  const [costShown, setCostShown] = useState(false);   // the button's tip: what a press costs

  const placeOf = (j) => (bands ? bands.points[j] : slots[j]);
  const realR = (j) => (bands ? bands.points[j].r : dotRadius(spacing, real[j].tier));

  const dots = useMemo(() => {
    const out = [];
    real.forEach((row, j) => {
      const p = bands ? bands.points[j] : slots[j];
      if (!p) return;
      const fresh = !atOpen.ids.has(row.id);
      out.push(
        <g key={row.id} className="fm-slot" style={{ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)` }}>
          <circle className={fresh ? 'sd-dot fm-real' : 'sd-dot'} style={fresh ? { '--d': `${Math.min(700, j * 7)}ms` } : undefined}
            r={bands ? p.r : dotRadius(spacing, row.tier)} fill={TIER_COLORS[row.tier] || '#555'} fillOpacity={0.92 * (bands ? TIER_RING[p.tier].fade : 1)} />
        </g>,
      );
    });
    // On its way: the places past the people saved, up to the count; once it's
    // over, what was left of them, fading.
    const upTo = mine ? shown : lastEnded ? lastShown : 0;
    for (let j = real.length; j < upTo; j++) {
      const p = slots[j];
      if (!p) break;
      const joins = mine && j >= atOpen.shown;
      const cls = !mine ? 'fm-fade' : joins ? 'fm-join' : undefined;
      const delay = !mine ? (j - real.length) * 4 : Math.max(0, j - lastFrom) * 90;
      out.push(
        <g key={'g' + j} className="fm-slot" style={{ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)` }}>
          <circle className={cls} style={{ '--fx': `${(-p.x).toFixed(1)}px`, '--fy': `${(-p.y).toFixed(1)}px`, '--d': `${Math.min(1400, delay)}ms` }}
            r={ghostR} fill="var(--sd-bg)" fillOpacity={0.6} stroke="rgba(var(--sd-ink, 255, 255, 255), 0.6)" strokeWidth={Math.max(0.6, ghostR * 0.32)} />
        </g>,
      );
    }
    return out;
  }, [real, bands, slots, spacing, atOpen, mine, shown, lastEnded, lastShown, lastFrom, ghostR]);

  // The next place: its ring draws round while the clock runs to it, or it
  // breathes while the clock waits for the scanner.
  const next = mine && count.shown >= 0 ? slots[count.shown] : null;
  const newest = mine && count.shown > 0 ? slots[count.shown - 1] : null;

  async function build() {
    say(null);
    setPressed(true);
    const why = await startHere('bridge', { name: person.name, id: person.id });
    setPressed(false);
    if (why) say(why);
  }

  // Pointer → a dot (nearest within reach), for its tooltip and its card.
  const hitAt = (clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const wx = (clientX - rect.left - cx - view.x) / k;
    const wy = (clientY - rect.top - cy - view.y) / k;
    let best = null;
    let bestD = Infinity;
    // Within reach of a dot: its own size once settled, the forming spacing while it forms.
    const reach = (p) => Math.max(8 / k, bands && p.r ? p.r * 1.6 : spacing * 0.6);
    real.forEach((row, j) => {
      const p = placeOf(j);
      if (!p) return;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD && d <= reach(p)) { bestD = d; best = { kind: 'real', i: j }; }
    });
    if (mine) {
      for (let j = real.length; j < count.shown; j++) {
        const p = slots[j];
        if (!p) break;
        const d = Math.hypot(p.x - wx, p.y - wy);
        if (d < bestD && d <= Math.max(8 / k, spacing * 0.6)) { bestD = d; best = { kind: 'ghost', i: j }; }
      }
    }
    return best;
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
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      if (d.moved) {
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        return;
      }
    }
    const hit = hitAt(e.clientX, e.clientY);
    setHover((h) => (h?.kind === hit?.kind && h?.i === hit?.i ? h : hit));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit?.kind === 'real') onSelect?.(real[hit.i]);
  };
  const zoomBy = (f, at = { x: 0, y: 0 }) => setView((v) => {
    const nk = Math.max(0.5, Math.min(6, v.k * f));
    return { k: nk, x: at.x - ((at.x - v.x) * nk) / v.k, y: at.y - ((at.y - v.y) * nk) / v.k };
  });
  const onWheel = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - rect.left - cx, y: e.clientY - rect.top - cy });
  };

  const state = circleState(person, reach);
  const ready = reachState(person, reach) === 'ready';
  const job = scan.finished.find((j) => j.target?.id === person.id) || null;
  const starting = (mine && scan.pending) || pressed;
  // The button shows until a scan of theirs starts, and again if one ends with
  // their circle still to do (a refusal, a stop before anything was read).
  const offerBuild = canScan && !mine && !pressed && real.length === 0 && state === 'todo';
  const cost = circleScanCost(100, pace);
  const costLine = `${cost.profileViews} profile view, then one LinkedIn search per page of their list: up to ${cost.searches}, about ${cost.minutes} min at ${paceOf(pace).label}. Their people join here as it reads.`;
  const core = { x: cx + view.x, y: cy + view.y };
  const hovReal = hover?.kind === 'real' ? real[hover.i] : null;
  const hovAt = hover ? placeOf(hover.i) : null;
  const byTier = ['S', 'A', 'B', 'C', 'D'].map((t) => [t, real.filter((m) => (m.tier || 'D') === t).length]).filter(([, n]) => n);
  const ghosts = mine ? count.ghosts : 0;
  const pages = mine ? scan.pages : 0;

  return (
    <>
      <style>{FORM_CSS}</style>
      <svg ref={svgRef} width={dims.w} height={dims.h}
        style={{ display: 'block', touchAction: 'none', cursor: hover?.kind === 'real' ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) setHover(null); }} onWheel={onWheel}
        role="img" aria-label={`${person.name}’s circle: ${real.length} saved${mine ? `, ${found} found so far` : ''}`}>
        <g transform={`translate(${cx + view.x} ${cy + view.y}) scale(${k})`}>
          {/* Where the circle forms: faint solid rings, until someone is in it (nothing dotted across it) */}
          {real.length === 0 && count.shown === 0 && [0, 1, 2].map((i) => (
            <circle key={'guide' + i} r={inner + i * 26} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.05)"
              strokeWidth={1 / k} pointerEvents="none" />
          ))}
          {/* Once it has settled: a faint band behind each tier and its letter, as Bridge Chains' circles have */}
          {bands && <TierBands layout={bands} k={k} />}
          {/* The newest dot, joined to the core */}
          {newest && (
            <line key={'spoke' + count.shown} className={still ? undefined : 'fm-spoke'} x1={0} y1={0} x2={newest.x} y2={newest.y}
              stroke={count.shown <= real.length ? TIER_COLORS[real[count.shown - 1]?.tier] || GREEN : 'rgba(var(--sd-ink, 255, 255, 255), 0.5)'}
              strokeWidth={0.8 / k} strokeOpacity={still ? 0.25 : undefined} pointerEvents="none" />
          )}
          <g pointerEvents="none">{dots}</g>
          {bands && <TierLetters layout={bands} k={k} />}
          {/* The next place */}
          {next && (count.nextIn != null ? (
            <circle key={'next' + count.shown} className="fm-next" cx={next.x} cy={next.y} r={ghostR + 1.5 / k} fill="none"
              stroke={GREEN} strokeOpacity={0.7} strokeWidth={1 / k} pathLength={1} strokeDasharray="1 1"
              style={{ '--t': `${Math.round(count.interval)}ms`, '--d': `${Math.round(count.nextIn - count.interval)}ms` }}
              transform={`rotate(-90 ${next.x} ${next.y})`} pointerEvents="none" />
          ) : (
            <circle key="wait" className="fm-wait" cx={next.x} cy={next.y} r={ghostR} fill="none"
              stroke="rgba(var(--sd-ink, 255, 255, 255), 0.6)" strokeWidth={0.8 / k} strokeOpacity={still ? 0.3 : undefined} pointerEvents="none" />
          ))}
          {/* The one under the pointer */}
          {hovAt && (
            <circle cx={hovAt.x} cy={hovAt.y} r={(hover.kind === 'real' ? realR(hover.i) : ghostR) + 2 / k} fill="none" stroke="var(--sd-fg-1, #fff)" strokeWidth={1.4 / k} pointerEvents="none" />
          )}
          {/* The core: the person, glowing while their circle is built */}
          {(mine || starting) && (
            <circle className={still ? undefined : 'fm-core'} r={40} fill="none" stroke={TIER_COLORS.S} strokeWidth={2} strokeOpacity={still ? 0.35 : undefined} pointerEvents="none" />
          )}
          {!offerBuild && (
            <g pointerEvents="none">
              {ready && !mine && real.length === 0 && <Halo x={0} y={0} r={40} still={still} />}
              <circle r={28} fill="var(--sd-bg)" stroke={TIER_COLORS[person.tier] || 'var(--sd-fg-3, #888)'} strokeWidth={3} />
              {localPhoto(person.profile_image_url) ? (
                <>
                  <clipPath id="build-core"><circle r={24} /></clipPath>
                  <image href={localPhoto(person.profile_image_url)} x={-24} y={-24} width={48} height={48} clipPath="url(#build-core)" />
                </>
              ) : (
                <text y={5} textAnchor="middle" fill={TIER_COLORS[person.tier] || 'var(--sd-fg-3, #888)'} fontSize={16} fontWeight={800}>
                  {person.name?.charAt(0)}
                </text>
              )}
            </g>
          )}
        </g>
        {hover && hovAt && (
          <Tip x={core.x + hovAt.x * k} y={core.y + hovAt.y * k - 6} w={dims.w}
            accent={hover.kind === 'real' ? TIER_COLORS[hovReal.tier] : 'var(--sd-fg-4, #777)'}
            lines={hover.kind === 'real'
              ? [hovReal.name, `${hovReal.tier}-tier · ${score(hovReal).toFixed(1)}`, `In ${first}’s circle`, 'Click to open their card']
              : ['On its way', `The scanner has read ${found.toLocaleString('en-US')} so far`, 'Who they are shows once it saves them', `(every ${PER_PAGE} pages)`]} />
        )}
      </svg>

      {/* The core's button, while there's a circle to build */}
      {offerBuild && (
        <button type="button" onClick={build} disabled={Boolean(busy) || Boolean(queued)} aria-describedby="build-cost"
          onMouseEnter={() => setCostShown(true)} onMouseLeave={() => setCostShown(false)}
          onFocus={() => setCostShown(true)} onBlur={() => setCostShown(false)}
          className={busy || queued || still ? undefined : 'fm-press'}
          style={{
            position: 'absolute', left: core.x - 58, top: core.y - 58, width: 116, height: 116, borderRadius: '50%',
            border: `3px solid ${TIER_COLORS[person.tier] || '#888'}`, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
            background: 'linear-gradient(135deg, #00ff88, #3498DB)', color: '#0a0a1a', padding: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
            font: 'inherit', fontSize: 12, fontWeight: 800, lineHeight: 1.15,
          }}>
          <span aria-hidden="true" style={{
            width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            background: 'rgba(10,10,26,0.85)', color: TIER_COLORS[person.tier] || '#fff', fontSize: 14, fontWeight: 800,
          }}>
            {localPhoto(person.profile_image_url)
              ? <img src={localPhoto(person.profile_image_url)} alt="" width={30} height={30} style={{ objectFit: 'cover' }} />
              : person.name?.charAt(0)}
          </span>
          <span>{queued ? <>Queued<br />{queued.label.split(' · ')[1]}</> : <>Build their<br />circle</>}</span>
        </button>
      )}
      {offerBuild && (
        <div id="build-cost" role="tooltip" style={{
          position: 'absolute', left: core.x - 150, width: 300, top: core.y - 58 - 76, display: costShown ? 'block' : 'none',
          padding: '8px 11px', borderRadius: 8, fontSize: 11, lineHeight: 1.45, textAlign: 'center', pointerEvents: 'none',
          background: 'var(--sd-surface, rgba(8,10,22,0.96))', border: '1px solid rgba(0,255,136,0.35)', color: 'var(--sd-fg-2, #cfd8d8)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        }}>
          {busy ? `${busy}. One scan at a time.` : costLine}
        </div>
      )}

      {/* Under the core: who (their card), and before it starts, why the button is there */}
      <div style={{
        position: 'absolute', left: core.x - 160, width: 320, top: core.y + (offerBuild ? 66 : 38), pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, textAlign: 'center', textShadow: HALO_TEXT,
      }}>
        <button type="button" onClick={() => onSelect?.(person)} title="Open their card"
          style={{ pointerEvents: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--sd-fg-1, #fff)' }}>
          {person.name}
        </button>
        {offerBuild && (
          <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #aab)', lineHeight: 1.5 }}>
            {busy ? `${busy}. One scan at a time: this one can start when it finishes.`
              : queued ? `${queued.label}: it starts by itself when the scans before it finish.`
              : scan.running && !mine ? `${busyReason(scan)}. Pressing the button queues ${first}’s circle next.`
              : job ? <span role="status" style={{ color: 'var(--sd-fg-2, #dde)' }}>{endedLine(first, job, state)}</span>
              : `${first}’s circle isn’t scanned yet. Hover the button for what it costs.`}
          </div>
        )}
        <InlineNote note={problem} style={{ pointerEvents: 'auto', maxWidth: 300 }} />
      </div>

      {/* The way back, as an opened circle in Bridge Chains has it, and how the
          build is going, in what the scanner really says */}
      <div style={{ position: 'absolute', top: 54, left: 64, right: 64, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', pointerEvents: 'auto' }}>
          <button type="button" onClick={onBack} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', color: 'var(--sd-fg-1, #ddd)', fontSize: 12, fontWeight: 700,
          }}>
            ← Unscanned
          </button>
          <nav aria-label="Trail" style={{ fontSize: 11, color: 'var(--sd-fg-4, #777)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" onClick={onBack} style={crumb}>Unscanned</button>
            <span aria-hidden="true">›</span>
            <span style={{ color: 'var(--sd-fg-1, #fff)', fontWeight: 700 }}>{person.name}</span>
          </nav>
        </div>
        <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #999)' }}>
          {first}’s circle · 2nd degree
        </div>
        {(() => {
          const line = starting ? 'Starting the scan of their circle…'
            : mine ? (pages > 0
              ? <>Building {first}’s circle: page {pages} · <b>{found.toLocaleString('en-US')} found</b> · {real.length.toLocaleString('en-US')} saved</>
              : <>Building {first}’s circle: opening their profile…</>)
            : real.length > 0 ? <>{first}’s circle: <b>{real.length.toLocaleString('en-US')} {real.length === 1 ? 'person' : 'people'}</b></>
            : offerBuild ? null
            : job ? endedLine(first, job, state)
            : state === 'hidden' ? `${first} keeps their connections hidden, so there is no circle to build.`
            : state === 'scanned' ? `${first}’s list has been read, and everyone on it was already one of your connections.`
            // The sample or a CSV, not a copy with no scanner at all (lib/scanner-capabilities.js), which offers no scan.
            : !canScan && scanShows(scan.capabilities).scan ? 'Scanning needs your own network.'
            : null;
          if (!line) return null;
          const live = mine || starting;
          return (
            <div role="status" style={{
              ...note, maxWidth: 440, lineHeight: 1.5, color: 'var(--sd-fg-1, #e6e6ee)',
              borderColor: live ? 'rgba(52,152,219,0.45)' : real.length ? 'rgba(0,255,136,0.4)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.2)',
            }}>
              <div>{line}</div>
              {mine && ghosts > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #99a)', marginTop: 2 }}>
                  The hollow dots are on their way: who they are shows as the scanner saves them, every {PER_PAGE} pages. Stop is in the notch above, and keeps what was read.
                </div>
              )}
              {!live && real.length > 0 && onOpenCircle && (
                <button type="button" onClick={() => onOpenCircle(person.id)} style={{
                  marginTop: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
                  fontSize: 11.5, fontWeight: 700, color: 'var(--sd-green, #00ff88)',
                }}>
                  {first} is in Bridge Chains now: open it there →
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* What's in it so far: dots and counts, no box, as an opened circle has */}
      {(real.length > 0 || ghosts > 0) && (
        <div style={{
          position: 'absolute', bottom: 18, left: 18, maxWidth: 'calc(100% - 110px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          gap: '6px 14px', fontSize: 10.5, color: 'var(--sd-fg-3, #aab)', textShadow: HALO_TEXT,
        }}>
          {byTier.map(([t, n]) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLORS[t], boxShadow: `0 0 6px ${TIER_COLORS[t]}66` }} />
              <span style={{ color: TIER_COLORS[t], fontWeight: 700 }}>{t}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('en-US')}</span>
            </span>
          ))}
          {ghosts > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid rgba(var(--sd-ink, 255, 255, 255), 0.6)' }} />
              {ghosts.toLocaleString('en-US')} on their way
            </span>
          )}
        </div>
      )}

      <ZoomButtons onIn={() => zoomBy(1.35)} onReset={() => setViewSet(null)} onOut={() => zoomBy(1 / 1.35)} />
    </>
  );
}

/** How a scan of theirs this page followed ended with nobody saved: what the scanner said, never "nobody" by guess. */
function endedLine(first, job, state) {
  const log = job.log || [];
  const saved = savedIn(log);
  if (saved > 0) return `${first}’s scan saved ${saved.toLocaleString('en-US')}. They’ll be here in a moment.`;
  if (log.includes('Stopped.')) return `${first}’s scan was stopped before anyone new was saved.`;
  if (state === 'hidden') return `${first} keeps their connections hidden, so there is no circle to build.`;
  if (job.failure?.length) return `${first}’s scan stopped: ${job.failure[job.failure.length - 1]}`;
  if (job.exitCode != null && job.exitCode !== 0) return `${first}’s scan stopped (exit ${job.exitCode}).`;
  return lastSaid(log) || `${first}’s scan ended with nobody new saved.`;
}

/** How many people a scan's log says it saved: its "Sent N → M new" lines. */
function savedIn(log) {
  let n = 0;
  for (const line of log) {
    const m = /→\s*(\d+)\s+new/.exec(String(line));
    if (m) n += Number(m[1]);
  }
  return n;
}

/** The last thing a scan said that explains how it ended (a used budget, say), not "Finished.". */
function lastSaid(log) {
  const skip = /^(Finished\.|Stopped\.|Stopping…|Stopped \(exit|Speed:|Made today|Today’s backup couldn|Mapping the circle behind|Search budget:|Searches: \d|Limits lifted for this session)/;
  for (let i = log.length - 1; i >= 0; i--) {
    const line = String(log[i]).trim();
    if (line && !skip.test(line)) return line;
  }
  return null;
}

const crumb = { background: 'none', border: 'none', color: '#8fb8d6', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 };
const note = {
  fontSize: 11.5, padding: '7px 11px', borderRadius: 8, border: '1px solid', background: 'rgba(var(--sd-shade, 0, 0, 0), 0.6)', pointerEvents: 'auto',
};
