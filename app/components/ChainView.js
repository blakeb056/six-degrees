'use client';

// Bridge Chains: your bridges round you, and the chains that lead on from them.
//
// - On the overview, a ring for each degree (Blake, 2026-10-15: "have degree 2
//   clusters that are now scanned … just be on the 2nd layer of the outer ring
//   and so forth for each degree 3 4 5 6"): your own bridges on the first ring,
//   as always; a circle scanned from someone you met through one of them on the
//   next ring out, at its parent's angle with a faint line back to it; theirs
//   one further; and so on (lib/chain-layout.js clusterRings, outerClusterLayout).
// - A click on a bridge, or the pointer resting on it for 3.5 s while a ring
//   fills round it, opens Network Circle's focus on them (Blake, 2026-10-16: "I
//   want the click UI/UX we added on the dots for Network Circle onto the
//   bridge and make it just like that"): the overview springs in on them and
//   blurs, and their circle comes forward sharp, every catalyst's circle
//   chained outward, rings by degree counted along the chain; with nothing
//   scanned, just them and Scan their circle. Their card opens too. Esc, Back,
//   a click outside, or scrolling or pinching out goes back. One
//   implementation for both views: app/components/CircleFocus.js and
//   lib/circle-focus.js.
// - That replaced the circle opened in place on a click, and the preview on a
//   hover. Its trail is kept, in the focus, under the circle: a bridge met
//   through another's circle reads You → that one → them, and a press on any
//   step before them brings that one's circle forward instead.
// - `/?chain=<id>` and a card's Insights open the focus on that person, with
//   the trail to them (app/page.js chainOpen). The right panel follows whose
//   circle is in front (CirclePanel.js), and it fills in as a scan saves: the
//   page looks at the network again meanwhile (app/page.js, NetworkRefresh).

import { useState, useRef, useEffect, useMemo } from 'react';
import { circleIndex, MAX_DEGREE } from '../../lib/circle';
import { localPhoto } from '../../lib/photos';
import { reachIndex, readyByCircle, scanFill, scanFillWords } from '../../lib/reach';
import { fillArcs, RING } from '../../lib/dot-rings';
import { ringLayout, previewBand, circleActivity, clusterRings, outerClusterLayout } from '../../lib/chain-layout';
import { HOVER_HOLD, canFocus, focusSubgraph, focusLook, focusLayer, hoverIntent } from '../../lib/circle-focus';
import { noteCircle } from '../../lib/notifications';
import { useUser } from './UserProvider';
import { redundancy } from '../../lib/brokerage';
import { hasRequest } from '../../lib/requests-client';
import CircleFocus, { useFocus, FocusHold } from './CircleFocus';
import useRequests from './useRequests';
import { TIER_COLORS } from '../../lib/themes';

const DEGREE_COLORS = { 1: '#FFD700', 2: '#FF6B35', 3: '#3498DB', 4: '#9B59B6', 5: '#00ff88', 6: '#ff5050' };
const TAU = Math.PI * 2;
const GREEN = '#00ff88';
const NO_TRAIL = [];
// Back's row in the focus: under the notch that holds this tab's four view
// buttons, and clear of the Filters and people panels' tabs at either edge,
// where the trail of a circle opened in place used to sit.
const UNDER_NOTCH = Object.freeze({ top: 54, side: 64 });

const firstName = (row) => String(row?.name || '').trim().split(/\s+/)[0] || 'them';
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** The trail to open for a link: the circles along the chain they came from, first to last, then them. */
function trailTo(id, rows) {
  if (!id) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(id)) return [];
  const trail = [id];
  for (let from = byId.get(id).unlocked_from_bridge_id; from != null && byId.has(from) && !trail.includes(from); from = byId.get(from).unlocked_from_bridge_id) {
    trail.unshift(from);
  }
  return trail;
}

export default function ChainView({ connections, degree2 = [], onSelect, userName, fullDegree1, fullDegree2, scanNotes, canScan = true, chainOpen = null, onChainOpened, onCircle, selectedId = null, tierColors = TIER_COLORS }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  // The overview's zoom: null until it's changed, which means "fit" (homeZoom below).
  const [zoomSet, setZoom] = useState(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  // Every row, whatever the tier filter: a circle brought forward from a
  // bridge the filter shows is drawn whole.
  const all1 = fullDegree1 || connections;
  const all2 = fullDegree2 || degree2;
  const requests = useRequests();
  // The focus (app/components/CircleFocus.js): { id, node, trail, phase, reduced, ease },
  // `trail` the ids before them along the chain. The overview's <svg> is the layer that zooms and blurs.
  const { focus, open: startFocus, close: closeFocus, move: moveFocus, idRef: focusIdRef } = useFocus({ layerRef: svgRef });
  // The bridge the pointer rests on, its ring filling.
  const [holding, setHolding] = useState(null);
  const intentRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    // Hold the element rather than reading the ref inside the callback. React
    // clears the ref on unmount, and a ResizeObserver can still fire once
    // afterwards, so reading containerRef.current there threw when leaving the
    // Bridges view. Publishing only a changed size also stops a fresh object
    // rebuilding the scene on every observation.
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

  const index = useMemo(() => circleIndex(all1, all2), [all1, all2]);
  const reach = useMemo(() => reachIndex(all1, all2, scanNotes), [all1, all2, scanNotes]);
  const readyCount = useMemo(() => readyByCircle(reach), [reach]);
  // The notifications, by the circle each is about: the busiest circles go on the inner ring.
  const { userId } = useUser();
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    fetch(`/api/notifications?userId=${encodeURIComponent(userId)}`).then((r) => r.json())
      .then((d) => { if (live) setNotes((d.notifications || []).map((n) => ({ circle: noteCircle(n), seen: !!n.seen }))); })
      .catch(() => {});
    return () => { live = false; };
  }, [userId]);
  const twoWays = useMemo(() => redundancy(fullDegree2 || degree2, fullDegree1 || connections), [fullDegree2, degree2, fullDegree1, connections]);
  const rowById = useMemo(() => {
    const m = new Map();
    for (const r of all2) m.set(r.id, r);
    for (const r of all1) m.set(r.id, r);
    return m;
  }, [all1, all2]);

  // Build bridge map
  const bridgeMap = {};
  degree2.forEach(d2 => {
    if (!d2.source_connection_id) return;
    if (!bridgeMap[d2.source_connection_id]) bridgeMap[d2.source_connection_id] = [];
    bridgeMap[d2.source_connection_id].push(d2);
  });

  const bridges = connections.filter(c => bridgeMap[c.id] && bridgeMap[c.id].length > 0)
    .sort((a, b) => (bridgeMap[b.id]?.length || 0) - (bridgeMap[a.id]?.length || 0));

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;

  // Who introduced whom, over everyone on file whatever the filters, so the
  // ring a cluster sits on is how far along its chain it is (clusterRings).
  const introducedBy = useMemo(() => {
    const on = new Set(all1.map((r) => r.id));
    const m = new Map();
    for (const r of all1) {
      const from = r.unlocked_from_bridge_id;
      if (from != null && from !== r.id && on.has(from)) m.set(r.id, from);
    }
    return m;
  }, [all1]);
  const withCircle = new Set(bridges.map((b) => b.id));
  // How many clusters have formed one step on from each: the inner ring's order, and its tooltip.
  const chained = new Map();
  for (const b of bridges) {
    if (withCircle.has(b.unlocked_from_bridge_id)) chained.set(b.unlocked_from_bridge_id, (chained.get(b.unlocked_from_bridge_id) || 0) + 1);
  }
  const ringOf = clusterRings(bridges.map((b) => b.id), introducedBy, { maxRing: MAX_DEGREE - 1 });
  // The inner ring holds the circles with the most going on (lib/chain-layout.js
  // circleActivity): notifications about them, people in them ready to scan,
  // clusters formed from them since. The biggest first among the rest.
  const activity = circleActivity(bridges, { notes, ready: readyCount, chained });
  const roots = bridges.filter((b) => ringOf.get(b.id).ring === 1)
    .sort((a, b) => activity.get(b.id).score - activity.get(a.id).score);
  // Bridges round you: one ring while they fit, more once there are many, each
  // ring far enough from the last for the names under it.
  const bridgeLayout = ringLayout(roots.length, {
    inner: maxR * 0.55, innerMin: maxR * 0.4, outer: maxR * 0.62, spacing: 46, minSpacing: 20, ringGap: 62,
  });
  const rootPos = roots.map((b, i) => {
    const p = bridgeLayout.points[i];
    return { ...b, x: cx + p.x, y: cy + p.y, angle: p.angle, ring: 1, anchor: null, clusterSize: (bridgeMap[b.id] || []).length, chains: chained.get(b.id) || 0, activity: activity.get(b.id) };
  });
  // The clusters further along a chain, a ring out for each step, each beside the one it came from.
  const outerLayout = outerClusterLayout(
    bridges.filter((b) => ringOf.get(b.id).ring > 1)
      .sort((a, b) => (bridgeMap[b.id]?.length || 0) - (bridgeMap[a.id]?.length || 0) || String(a.name || '').localeCompare(String(b.name || '')))
      .map((b) => ({ id: b.id, ring: ringOf.get(b.id).ring, anchor: ringOf.get(b.id).anchor })),
    new Map(rootPos.map((b) => [b.id, b.angle])),
    { edge: Math.max(maxR * 0.55, ...bridgeLayout.rings.map((r) => r.radius)), hop: 62, spacing: 46 },
  );
  const outerPos = bridges.filter((b) => outerLayout.points.has(b.id)).map((b) => {
    const p = outerLayout.points.get(b.id);
    return { ...b, x: cx + p.x, y: cy + p.y, angle: p.angle, ring: p.ring, anchor: p.anchor, clusterSize: (bridgeMap[b.id] || []).length, chains: chained.get(b.id) || 0, activity: activity.get(b.id) };
  });
  const bridgePos = [...rootPos, ...outerPos];
  // Each outer ring's name, in the widest gap between its clusters, so it never sits under one.
  const ringLabelAt = (ring) => {
    const at = outerPos.filter((b) => b.ring === ring).map((b) => ((b.angle % TAU) + TAU) % TAU).sort((a, b) => a - b);
    if (at.length < 2) return (at[0] ?? 0) + Math.PI;
    let best = 0;
    let mid = 0;
    at.forEach((a, i) => {
      const next = i + 1 < at.length ? at[i + 1] : at[0] + TAU;
      if (next - a > best) { best = next - a; mid = a + (next - a) / 2; }
    });
    return mid;
  };
  const posById = new Map(bridgePos.map((b) => [b.id, b]));
  // More than one ring: the counts under each name wait for a hover.
  const crowded = bridgeLayout.rings.length > 1;
  // The zoom that fits the rings and the band beyond them a hovered circle was
  // previewed in, kept so the overview is the size it was, and the size
  // Unscanned's is (UnscannedView.js).
  const band = previewBand(maxR, [...bridgeLayout.rings, ...outerLayout.rings]);
  const homeZoom = Math.max(outerLayout.rings.length ? 0.3 : 0.6, Math.min(1.3, Math.min(cx, cy) / (band.outer + 8)));
  const zoom = zoomSet ?? homeZoom;

  // === THE FOCUS: a bridge's circle in front of the overview ===
  // Where a point of the overview is on screen: it's drawn at `zoom` about the middle.
  const onScreen = (p) => ({ x: cx + (p.x - cx) * zoom, y: cy + (p.y - cy) * zoom });
  // Bring `row`'s circle forward; `before` the ids along the chain to them, nearest you first.
  const bringForward = (row, before) => {
    setHovered(null);
    setHolding(null);
    intentRef.current?.stop();
    startFocus(row.id, { node: row, trail: before });
  };
  // A bridge, by a click or a rest on it: their card opens too, as a dot's does in Network Circle.
  const openBridge = (id) => {
    const row = rowById.get(id);
    if (!canFocus(row) || focusIdRef.current != null) return;
    onSelect?.(row);
    bringForward(row, (ringOf.get(id)?.trail || [id]).slice(0, -1));
  };
  // Resting on a bridge opens it as a click does. A mouse or a pen only: a
  // finger has no hover, and taps instead. Nothing starts while a focus is
  // in front, or easing back.
  const rest = (e, id) => {
    setHovered(id);
    if (focus || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (intentRef.current?.start(id)) setHolding(id);
  };
  const leave = (id) => {
    setHovered((h) => (h === id ? null : h));
    intentRef.current?.stop(id);
    setHolding((h) => (h === id ? null : h));
  };
  const fireRef = useRef(null);
  useEffect(() => { fireRef.current = (id) => { setHolding(null); openBridge(id); }; });
  useEffect(() => {
    const intent = hoverIntent((id) => fireRef.current?.(id));
    intentRef.current = intent;
    return () => { intent.stop(); intentRef.current = null; };
  }, []);
  // A link to someone's circle (a card's Insights, /?chain=<id>): followed
  // once, so coming back to this view later starts from the overview. Their
  // trail is the chain they came from, whether or not it's drawn.
  const linkRef = useRef(null);
  useEffect(() => {
    linkRef.current = (id) => {
      const trail = trailTo(id, all1);
      const row = trail.length ? rowById.get(trail[trail.length - 1]) : null;
      if (row) bringForward(row, trail.slice(0, -1));
    };
  });
  useEffect(() => {
    if (!chainOpen) return;
    linkRef.current?.(chainOpen);
    onChainOpened?.();
  }, [chainOpen, onChainOpened]);
  // What comes forward: their circle and every catalyst's, from every row on file whatever the filters.
  const focusId = focus?.id ?? null;
  const focusNode = focus?.node ?? null;
  const focusTrail = focus?.trail ?? NO_TRAIL;
  const focused = useMemo(() => {
    if (focusId == null) return null;
    const person = rowById.get(focusId) ?? focusNode;
    if (!person) return null;
    const before = focusTrail.map((id) => rowById.get(id)).filter(Boolean);
    return focusSubgraph(person, index, { trail: before, isRequested: (row) => hasRequest(row, requests) });
  }, [focusId, focusNode, focusTrail, rowById, index, requests]);
  // A step back along the trail: that one's circle forward instead, and their card.
  const pick = (row) => {
    const at = focusTrail.indexOf(row.id);
    if (at < 0) return;
    onSelect?.(row);
    moveFocus({ id: row.id, node: row, trail: focusTrail.slice(0, at) });
  };
  // Whose circle is in front, for the right panel (page.js → Sidebar → CirclePanel).
  const inFront = focus && focus.phase !== 'out' ? focused?.person ?? null : null;
  useEffect(() => { onCircle?.(inFront); }, [inFront, onCircle]);
  useEffect(() => () => onCircle?.(null), [onCircle]);
  // The overview behind: zoomed to their bridge (the middle, for someone not
  // drawn on it) and blurred while it's open, back as it was while it goes.
  const box = { width: dims.w, height: dims.h };
  const focusDot = focus ? (posById.has(focus.id) ? onScreen(posById.get(focus.id)) : { x: cx, y: cy }) : null;
  const look = focused ? focusLook(focused.kind, { reduced: focus.reduced }) : null;
  const layer = focused ? focusLayer({ ...focus, dot: focusDot }, box, look) : null;
  // The ring filling round the bridge the pointer rests on, just clear of its glow.
  const held = holding != null && !focus ? posById.get(holding) : null;
  const holdAt = held ? { ...onScreen(held), r: 21 * zoom + 3, colour: TIER_COLORS[held.tier] } : null;
  // What sits over the overview fades while a focus is in front, as the Galaxy's does.
  const chrome = { opacity: focus ? 0 : 1, transition: 'opacity 0.3s', pointerEvents: focus ? 'none' : undefined };

  // Touch rotary dial on the overview: drag a finger round the circle to pick a bridge.
  const bridgeAnglesRef = useRef([]);
  useEffect(() => {
    bridgeAnglesRef.current = bridgePos.map((b) => ({ id: b.id, angle: b.angle, r: Math.hypot(b.x - cx, b.y - cy), outer: b.ring > 1 }));
  });
  const lastTouchRef = useRef(0);

  const focusOn = focus != null;
  useEffect(() => {
    const el = containerRef.current;
    // Off while a focus is in front: a pinch there is the focus's own.
    if (!el || focusOn) return undefined;

    const findNearest = (touchX, touchY) => {
      const rect = el.getBoundingClientRect();
      const tx = touchX - rect.left;
      const ty = touchY - rect.top;
      const touchAngle = Math.atan2(ty - dims.h / 2, tx - dims.w / 2);
      // With rings past the first, the ring nearest the finger first, then round it.
      const all = bridgeAnglesRef.current;
      let pool = all;
      if (all.some((b) => b.outer)) {
        const tr = Math.hypot(tx - dims.w / 2, ty - dims.h / 2) / (zoom || 1);
        const best = Math.min(...all.map((b) => Math.abs(b.r - tr)));
        pool = all.filter((b) => Math.abs(b.r - tr) <= best + 1);
      }
      let nearest = null;
      let nearestDist = Infinity;
      pool.forEach(b => {
        let diff = Math.abs(touchAngle - b.angle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < nearestDist) { nearestDist = diff; nearest = b.id; }
      });
      return nearest;
    };

    const onTouchStart = (e) => {
      if (e.touches[0]) {
        const n = findNearest(e.touches[0].clientX, e.touches[0].clientY);
        if (n) setHovered(n);
      }
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      // Throttle to 60fps
      const now = Date.now();
      if (now - lastTouchRef.current < 16) return;
      lastTouchRef.current = now;
      if (e.touches[0]) {
        const n = findNearest(e.touches[0].clientX, e.touches[0].clientY);
        if (n) setHovered(n);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => { el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove); };
  }, [dims, zoom, focusOn]);

  // === OVERVIEW: all bridges, click or rest on one to bring it forward ===
  const totalD2 = degree2.length;
  // The people in the clusters on each ring past the first, by their degree: a ring-2 cluster holds the 3rd.
  const peopleAt = new Map();
  for (const b of outerPos) peopleAt.set(b.ring + 1, (peopleAt.get(b.ring + 1) || 0) + b.clusterSize);
  const deeper = [...peopleAt.values()].reduce((a, b) => a + b, 0);
  const d2S = degree2.filter(d => d.tier === 'S').length;
  const d2A = degree2.filter(d => d.tier === 'A').length;

  return (
    <div ref={containerRef} style={{ flex: 1, background: 'var(--sd-page)', position: 'relative', overflow: 'hidden' }}>
      <svg ref={svgRef} width={dims.w} height={dims.h} style={{ display: 'block', ...layer }}>
      <g transform={`translate(${cx * (1 - zoom)}, ${cy * (1 - zoom)}) scale(${zoom})`}>
        {/* A guide line for every ring of bridges */}
        {bridgeLayout.rings.map((ring) => (
          <circle key={'ring-' + ring.radius} cx={cx} cy={cy} r={ring.radius} fill="none" stroke={`${DEGREE_COLORS[1]}10`} strokeWidth={1} />
        ))}
        {/* A ring for each step further along a chain, named for the degree of the people in its clusters */}
        {outerLayout.rings.map((ring) => (
          <g key={'outer-' + ring.ring} pointerEvents="none">
            <circle cx={cx} cy={cy} r={ring.radius} fill="none" stroke={`${DEGREE_COLORS[ring.ring] || '#8899aa'}26`} strokeWidth={1} strokeDasharray="2 5" />
            <text x={cx + (ring.radius + 8) * Math.cos(ringLabelAt(ring.ring))} y={cy + (ring.radius + 8) * Math.sin(ringLabelAt(ring.ring)) + 3} textAnchor="middle" fill={DEGREE_COLORS[ring.ring] || '#8899aa'} fillOpacity={0.6} fontSize={8} fontWeight={700}>
              {ordinal(ring.ring + 1)} degree clusters
            </text>
          </g>
        ))}
        {/* A faint line from each of those back to the cluster it came from */}
        {outerPos.map((b) => {
          const from = posById.get(b.anchor);
          if (!from) return null;
          const lit = hovered === b.id || hovered === from.id;
          return (
            <line key={'chain-' + b.id} x1={from.x} y1={from.y} x2={b.x} y2={b.y} pointerEvents="none"
              stroke={DEGREE_COLORS[b.ring] || '#8899aa'} strokeWidth={lit ? 1.4 : 1} strokeOpacity={lit ? 0.7 : 0.35} />
          );
        })}

        {/* Bridge nodes: click one, or rest the pointer on it, to bring their circle forward */}
        {bridgePos.map(b => {
          const isHov = hovered === b.id;
          const sCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'S').length;
          const aCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'A').length;
          const ready = readyCount.get(b.id) || 0;
          const fill = scanFill(b, reach);
          const arcs = fillArcs((isHov ? 13 : 11) + 3.6, fill);
          return (
            <g key={'b-' + b.id}
              onClick={() => openBridge(b.id)}
              onPointerEnter={(e) => rest(e, b.id)}
              onPointerLeave={() => leave(b.id)}
              onPointerDown={() => { intentRef.current?.stop(); setHolding(null); }}
              style={{ cursor: 'pointer' }}>
              <title>{bridgeTitle(b, ready, fill)}</title>
              {/* Glow */}
              <circle className="sd-dot" cx={b.x} cy={b.y} r={isHov ? 21 : 18} fill={`${TIER_COLORS[b.tier]}${isHov ? '14' : '08'}`} />
              {/* The ring, tight on the dot: how much of their list is scanned (Blake,
                  2026-10-12: "the circle line around each dot in the bridge so it will
                  tell the user how scanned through this person is"). Read solid, the
                  rest faint, the unknown band dashed (lib/reach.js scanFill). It used
                  to be a bar for each person added through this circle (reachSegments,
                  2026-10-02); who is ready is the number top right, and who was
                  scanned since is in the tooltip and chained outward in their focus. */}
              <g transform={`translate(${b.x} ${b.y})`} pointerEvents="none">
                {!fill && (
                  <circle r={(isHov ? 13 : 11) + 3.6} fill="none" stroke={RING.rest} strokeWidth={1} />
                )}
                {arcs.rest && <path d={arcs.rest} fill="none" strokeWidth={2} stroke={RING.rest} />}
                {arcs.unknown && <path d={arcs.unknown} fill="none" strokeWidth={2} stroke={RING.unknown} strokeDasharray={RING.dash} />}
                {arcs.read && <path d={arcs.read} fill="none" strokeLinecap="round" strokeWidth={2} stroke={RING.filled} />}
              </g>
              {/* Node, with their photo or initial */}
              <NodeFace row={b} x={b.x} y={b.y} r={isHov ? 13 : 11} hov={isHov} clipId={'bc-' + b.id} />
              {/* The circle's notifications, top right (Blake, 2026-10-02: "the circle degree
                  outline on the top right with the number of notifications for that cluster"):
                  new notifications about it and the people in it ready to scan. Gold when
                  there's news, green when it's only people ready. */}
              {(() => {
                const news = (b.activity?.unread || 0) + ready;
                if (!news) return null;
                const tone = b.activity?.unread ? 'var(--sd-gold, #FFD700)' : 'var(--sd-green, #00ff88)';   // deeper on a light look
                return (
                  <g pointerEvents="none">
                    <circle cx={b.x + 14} cy={b.y - 14} r={6} fill="var(--sd-bg)" stroke={tone} strokeWidth={1.2} />
                    <text x={b.x + 14} y={b.y - 11.4} textAnchor="middle" fill={tone} fontSize={news > 9 ? 6 : 7} fontWeight={800}>{news > 99 ? '99+' : news}</text>
                  </g>
                );
              })()}
              {/* Name + count */}
              <text x={b.x} y={b.y + (isHov ? 24 : 22)} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={9} fontWeight={600}>
                {b.name?.split(' ')[0]}
              </text>
              {(!crowded || isHov) && (
                <text x={b.x} y={b.y + (isHov ? 34 : 32)} textAnchor="middle" fill={isHov ? 'var(--sd-fg-2, #bbb)' : 'var(--sd-fg-3, #888)'} fontSize={7}>
                  {b.clusterSize} · {sCount > 0 ? sCount + 'S ' : ''}{aCount > 0 ? aCount + 'A' : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* Center: YOU */}
        <circle cx={cx} cy={cy} r={22} fill="var(--sd-bg)" stroke="#FFD700" strokeWidth={3} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--sd-gold, #FFD700)" fontSize={11} fontWeight={800}>
          {userName?.split(' ')[0] || 'YOU'}
        </text>
      </g>
      </svg>

      {/* The ring that fills while the pointer rests on a bridge: full, and their circle comes forward. */}
      <FocusHold key={holding ?? ''} at={holdAt} />

      {/* Zoom controls, clear of the Galaxy switch below them */}
      <div style={chrome}>
        <ZoomButtons
          onIn={() => setZoom(z => Math.min(3, (z ?? homeZoom) + 0.3))}
          onReset={() => setZoom(null)}
          onOut={() => setZoom(z => Math.max(0.4, (z ?? homeZoom) - 0.3))}
        />
      </div>

      {/* Depth tracker: just the dots, no box (Blake, 2026-10-03: the box grew with
          a theme's font and stopped fitting; "just have the dots there instead so
          its more clean looking"). What they add up to is the tooltip. */}
      <div
        title={[
          `${roots.length} bridges${bridges.length > roots.length ? ` + ${bridges.length - roots.length} along their chains` : ''} · ${d2S} S + ${d2A} A at 2nd degree`,
          twoWays > 0 ? `${Math.round(twoWays * 100)}% of your 2nd degree you reach two or more ways` : null,
          'The inner ring: the circles with the most going on (notifications, people ready to scan, clusters formed since)',
          `Click a bridge, or rest the pointer on it for ${HOVER_HOLD / 1000} s, to bring their circle forward`,
        ].filter(Boolean).join('\n')}
        style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', alignItems: 'flex-end', gap: 12, ...chrome }}>
        {[1, 2, 3, 4, 5, 6].map((d) => {
          // Past the 2nd, the people in the clusters on the rings further out.
          const n = d === 1 ? connections.length : d === 2 ? totalD2 - deeper : peopleAt.get(d) || 0;
          const lit = d <= 2 || n > 0;
          return (
            <div key={d} title={lit ? `${d === 1 ? '1st degree: your bridges' : d === 2 ? '2nd degree: the people in their circles' : `${ordinal(d)} degree: the people in the clusters on the ring for it`} (${n.toLocaleString('en-US')})` : `${ordinal(d)} degree: further along a chain, as your scans reach it`}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span className={lit ? 'sd-dot-html' : undefined} style={{
                width: 11, height: 11, borderRadius: '50%',
                background: lit ? DEGREE_COLORS[d] : 'transparent',
                border: lit ? 'none' : '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.22)',
                boxShadow: lit ? `0 0 8px ${DEGREE_COLORS[d]}80` : 'none',
              }} />
              <span style={{ fontSize: 9.5, fontWeight: 700, color: lit ? 'var(--sd-fg-2, #c8cdd8)' : 'var(--sd-fg-5, #556)', fontVariantNumeric: 'tabular-nums', textShadow: HALO_TEXT }}>
                {lit ? n.toLocaleString('en-US') : `D${d}`}
              </span>
            </div>
          );
        })}
      </div>

      {focused && (
        <CircleFocus focus={focused} phase={focus.phase} box={box} origin={focusDot} you={{ x: cx, y: cy }} look={look}
          ease={focus.ease} reduced={focus.reduced} tierColors={tierColors} selectedId={selectedId}
          onSelect={onSelect} onClose={closeFocus} onPick={pick} canScan={canScan} bar={UNDER_NOTCH} />
      )}
    </div>
  );
}

/**
 * A person's dot on an overview: in their tier's colour, with their photo or
 * initial. Bridge Chains draws each bridge with it, and Degrees' Unscanned view
 * each connection not scanned yet (UnscannedView.js). `r` is its radius (11 at
 * full size, 13 hovered); `scale` shrinks everything else with it, for a ring
 * that has closed up.
 */
export function NodeFace({ row, x, y, r, hov = false, clipId, scale = 1, bare = false }) {
  // `bare`: too small for a photo or a letter to read, so just the dot.
  const photo = bare ? null : localPhoto(row.profile_image_url);
  const inset = r - 2 * scale;
  return (
    <>
      <circle className="sd-dot" cx={x} cy={y} r={r}
        fill={photo ? '#1a1a2e' : TIER_COLORS[row.tier]}
        stroke={hov ? 'var(--sd-fg-1, #fff)' : TIER_COLORS[row.tier]}
        strokeWidth={(hov ? 2.5 : 2) * scale} />
      {photo && (
        <>
          <clipPath id={clipId}><circle cx={x} cy={y} r={inset} /></clipPath>
          <image href={photo} x={x - inset} y={y - inset} width={inset * 2} height={inset * 2} clipPath={`url(#${clipId})`} />
        </>
      )}
      {!photo && !bare && (
        <text x={x} y={y + 4 * scale} textAnchor="middle" fill={row.tier === 'S' ? '#000' : 'var(--sd-fg-1, #fff)'}
          fontSize={11 * scale} fontWeight={700}>{row.name?.charAt(0)}</text>
      )}
    </>
  );
}

/** What a bridge's ring and number mean, in words, for its tooltip. */
function bridgeTitle(b, ready, fill) {
  const parts = [];
  const notes = b.activity?.notes || 0;
  if (notes) parts.push(`${notes} notification${notes === 1 ? '' : 's'} about their circle${b.activity.unread ? `, ${b.activity.unread} new` : ''}`);
  if (ready) parts.push(`${ready} in ${firstName(b)}’s circle ${ready === 1 ? 'is' : 'are'} ready for a scan`);
  if (b.chains) parts.push(`${b.chains} scanned since, with ${b.chains === 1 ? 'a cluster' : 'clusters'} of their own`);
  if (fill) parts.push(scanFillWords(fill));
  return parts.length ? parts.join(' · ') : `${firstName(b)}’s circle`;
}

/** The soft breathing halo on someone ready for a circle scan. Still when Reduce Motion is on. */
export function Halo({ x, y, r, still }) {
  return (
    <circle cx={x} cy={y} r={r} fill={GREEN} fillOpacity={0.16} stroke={GREEN} strokeWidth={0.8} strokeOpacity={0.45} pointerEvents="none">
      {!still && <animate attributeName="fill-opacity" values="0.06;0.24;0.06" dur="2.8s" repeatCount="indefinite" />}
      {!still && <animate attributeName="stroke-opacity" values="0.25;0.7;0.25" dur="2.8s" repeatCount="indefinite" />}
    </circle>
  );
}

export function ZoomButtons({ onIn, onReset, onOut }) {
  const round = (dim) => ({
    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: dim ? 'rgba(var(--sd-ink, 255, 255, 255), 0.06)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', color: dim ? 'var(--sd-fg-4, #666)' : 'var(--sd-fg-1, #fff)',
    fontSize: dim ? 10 : 18, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)',
  });
  return (
    <div style={{ position: 'absolute', bottom: 64, right: 20, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button type="button" onClick={onIn} aria-label="Zoom in" style={round(false)}>+</button>
      <button type="button" onClick={onReset} aria-label="Fit to the window" style={round(true)}>⊙</button>
      <button type="button" onClick={onOut} aria-label="Zoom out" style={round(false)}>−</button>
    </div>
  );
}

// Words over the map without a box: a soft halo in the theme's background (lib/themes.js).
export const HALO_TEXT = '0 0 3px var(--sd-bg), 0 0 6px var(--sd-bg), 0 0 1px var(--sd-bg)';

/** A tooltip in screen space, above the point, kept inside the window. */
export function Tip({ x, y, w, lines, accent }) {
  const width = Math.max(150, Math.min(240, Math.max(...lines.map((l) => String(l).length)) * 5.6 + 20));
  const height = 12 + lines.length * 12;
  const left = Math.max(6, Math.min(w - width - 6, x - width / 2));
  const top = Math.max(6, y - height - 12);
  return (
    <g pointerEvents="none">
      <rect x={left} y={top} width={width} height={height} rx={6} fill="var(--sd-surface, rgba(0,0,0,0.92))" stroke={accent || 'var(--sd-fg-5, #555)'} strokeWidth={0.6} />
      {lines.map((line, i) => (
        <text key={i} x={left + width / 2} y={top + 16 + i * 12} textAnchor="middle"
          fill={i === 0 ? 'var(--sd-fg-1, #fff)' : i === 2 ? accent || 'var(--sd-fg-3, #aaa)' : 'var(--sd-fg-3, #999)'} fontSize={i === 0 ? 10.5 : 9} fontWeight={i === 0 ? 700 : 400}>
          {line}
        </text>
      ))}
    </g>
  );
}
