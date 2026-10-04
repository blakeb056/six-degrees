'use client';

// Bridge Chains: your bridges round you. Click one for their circle, and any
// dot in it for that person's circle in turn, as far as your scans reach.
//
// The overview is stacked by tier (Blake, 2026-10-04), and shows the
// connections whose circle isn't scanned yet beyond each tier's bridges: a
// click on one scans it in place. BridgeRings below says how.
//
// Blake, 2026-09-28: "for bridges when i scan someone and have a lot of 2nd
// degree its almost a solid line and needs to expand more and we need to be
// able to click on the actual 2nd degree within the bridge so we can see the
// extended cluster for the d3 dots as it builds more in".
//
// - A circle's dots fill rings from the inside out, as many as its count needs
//   (lib/chain-layout.js), so 800 people spread out instead of piling into one
//   line. Drag to move, scroll or +/− to zoom.
// - Any dot opens that person's own circle in place: the people found in
//   THEIR circle once you connected and scanned it (3rd degree, counted along
//   the chain), from the two facts lib/circle.js reads. With none yet it says
//   why, and what gets them. The trail at the top, and Esc, go back. The page
//   looks at the network again while a circle is being scanned, so an open
//   circle fills in as the scanner saves (app/page.js, NetworkRefresh). A dot
//   ready for a scan goes to the Scan page with them picked instead: their
//   circle is empty until it's scanned.
// - Chains are drawn inside an opened circle (Blake, 2026-10-02: "once they
//   are clicked on and can view the cluster i want any scanned d2,3,4 or
//   whatever to be show inside with lines out of the d1 leading to the d2s").
//   Anyone you met through this circle whose own circle has been scanned sits
//   outside the tier bands with their cluster round them and a line from the
//   person in the middle; anyone met through *their* circle sits a step beyond,
//   and so on (lib/chain-layout.js chainTree). They aren't bridges on the
//   overview: that shows the people you connected with yourself, and says how
//   many chains lead on from each.

import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { circleIndex, MAX_DEGREE } from '../../lib/circle';
import { localPhoto } from '../../lib/photos';
import { reachIndex, reachState, circleState, readyByCircle, circleScanCost, scanBars, notScannedYet } from '../../lib/reach';
import { stoppedLine } from '../../lib/in-progress';
import { reachSegments, RING } from '../../lib/dot-rings';
import { ringLayout, chainTree, dotRadius, previewBand, tierBandLayout, circleActivity, bridgeGroups, overviewRings } from '../../lib/chain-layout';
import { noteCircle, acceptedNote } from '../../lib/notifications';
import { useUser } from './UserProvider';
import { redundancy } from '../../lib/brokerage';
import { keyFor, score } from '../../lib/separation';
import { hasRequest } from '../../lib/requests-client';
import { watchScanner, scannerNow, isCircleScan, beginScrape, scraperStatus, notReadyMessage, busyReason, resumePoint } from '../../lib/scraper-client';
import useRequests from './useRequests';
import useScanner from './useScanner';
import { FormingCluster } from './ClusterSpinner';
import { TIER_COLORS } from '../../lib/themes';

const DEGREE_COLORS = { 1: '#FFD700', 2: '#FF6B35', 3: '#3498DB', 4: '#9B59B6', 5: '#00ff88', 6: '#ff5050' };
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const GREEN = '#00ff88';
const HIDDEN = '#5a5a66';

const byTierThenScore = (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)
  || score(b) - score(a)
  || String(a.name || '').localeCompare(String(b.name || ''));
const firstName = (row) => String(row?.name || '').trim().split(/\s+/)[0] || 'them';
// The Scan page with them picked; nothing starts until it's confirmed there.
const scanPageFor = (row) => `/setup?scan=${encodeURIComponent(row.id)}`;
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// Whose circle is being scanned now, by id: a string, so the view re-renders
// only when it changes, not on every line of the scan's log.
const scanningNow = () => {
  const s = scannerNow();
  return s.running && isCircleScan(s) ? s.target?.id ?? null : null;
};
const scanningNone = () => null;
const watchNothing = () => () => {};

// Reduce Motion: the halo breathes only when it's off.
const STILL = '(prefers-reduced-motion: reduce)';
function watchMotion(onChange) {
  const m = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(STILL) : null;
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}
const stillNow = () => Boolean(typeof window !== 'undefined' && window.matchMedia?.(STILL).matches);
const stillOnServer = () => true;

/** Who sits in `person`'s circle: the people you reached through it first, then everyone its scan found. */
function membersOf(person, index) {
  const seen = new Set([keyFor(person)]);
  const take = (rows) => {
    const out = [];
    for (const row of rows || []) {
      const key = keyFor(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out.sort(byTierThenScore);
  };
  return [...take(index.introduced.get(person.id)), ...take(index.circles.get(person.id))];
}

/**
 * The chains that lead on from `person`: everyone you met through their circle
 * whose own circle has been scanned, then the same from each of those, biggest
 * circle first. `parent` is an index into the list, or -1 for `person`; `step`
 * is how many links out. Nobody already on the trail, nobody twice.
 */
function chainsFrom(person, index, skip = [], maxStep = MAX_DEGREE) {
  const out = [];
  const seen = new Set([person.id, ...skip]);
  const size = (row) => (index.circles.get(row.id)?.length || 0) + (index.introduced.get(row.id)?.length || 0);
  const walk = (from, parent, step) => {
    if (step > maxStep) return;
    const next = (index.introduced.get(from.id) || []).filter((row) => size(row) > 0 && !seen.has(row.id))
      .sort((a, b) => size(b) - size(a) || String(a.name || '').localeCompare(String(b.name || '')));
    next.forEach((row) => seen.add(row.id));
    for (const row of next) {
      out.push({ row, parent, step });
      walk(row, out.length - 1, step + 1);
    }
  };
  walk(person, -1, 1);
  return out;
}

/** The trail to open for a link: the circle they came from, then them. */
function trailTo(id, rows) {
  if (!id) return [];
  const row = rows.find((r) => r.id === id);
  if (!row) return [];
  const from = row.unlocked_from_bridge_id;
  return from != null && rows.some((r) => r.id === from) ? [from, id] : [id];
}

export default function ChainView({ connections, degree2 = [], onSelect, userName, fullDegree1, fullDegree2, scanNotes, canScan = true, chainOpen = null, onChainOpened, onCircle }) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  // Every row, whatever the tier filter: a circle opened from a bridge the
  // filter shows is drawn whole, and so is anyone's circle opened from it.
  const all1 = fullDegree1 || connections;
  const all2 = fullDegree2 || degree2;
  // The circles opened, outermost last: [bridge id, person id, …]; [] is the overview.
  const [path, setPath] = useState(() => trailTo(chainOpen, all1));
  // A link is followed once: coming back to this view later starts from the overview.
  // One asked for while this view is already showing (a card's Insights) opens too.
  const [openedFor, setOpenedFor] = useState(chainOpen);
  if (chainOpen && chainOpen !== openedFor) {
    setOpenedFor(chainOpen);
    const trail = trailTo(chainOpen, all1);
    if (trail.length) setPath(trail);
  }
  useEffect(() => {
    if (chainOpen) onChainOpened?.();
  }, [chainOpen, onChainOpened]);
  // The sample and a CSV have no scans, so nothing to ask the scanner.
  const scanningId = useSyncExternalStore(canScan ? watchScanner : watchNothing, scanningNow, scanningNone);
  const still = useSyncExternalStore(watchMotion, stillNow, stillOnServer);
  const requests = useRequests();

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
      .then((d) => { if (live) setNotes((d.notifications || []).map((n) => ({ circle: noteCircle(n), seen: !!n.seen, accepted: acceptedNote(n) }))); })
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
  // The trail as rows. Anyone no longer on file ends it there.
  const trail = [];
  for (const id of path) {
    const row = rowById.get(id);
    if (!row) break;
    trail.push(row);
  }
  const focused = trail.length > 0;
  // Whose circle is open, for the right panel (page.js → Sidebar → CirclePanel).
  const inCircle = trail.length ? trail[trail.length - 1] : null;
  useEffect(() => { onCircle?.(inCircle); }, [inCircle, onCircle]);
  useEffect(() => () => onCircle?.(null), [onCircle]);

  // Esc goes back one circle, unless it's closing something else (the card's
  // large map) or leaving a text box.
  useEffect(() => {
    if (!focused) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setPath((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused]);

  // === ONE CIRCLE: a bridge's, or anyone's in it, opened in place ===
  if (focused) {
    return (
      <div ref={containerRef} style={{ flex: 1, background: 'var(--sd-page)', position: 'relative', overflow: 'hidden' }}>
        <CircleFocus
          key={trail.map((r) => r.id).join('>')}
          trail={trail} index={index} reach={reach} dims={dims} requests={requests}
          scanningId={scanningId} still={still} canScan={canScan}
          onOpen={(ids) => setPath(trail.map((r) => r.id).concat(ids))}
          onBack={(depth) => setPath(trail.slice(0, depth).map((r) => r.id))}
          onSelect={onSelect}
        />
      </div>
    );
  }

  // === OVERVIEW: every circle round you, stacked by tier, and everyone not scanned yet ===
  return (
    <div ref={containerRef} style={{ flex: 1, background: 'var(--sd-page)', position: 'relative', overflow: 'hidden' }}>
      <BridgeRings
        connections={connections} degree2={degree2} index={index} reach={reach} readyCount={readyCount}
        notes={notes} twoWays={twoWays} dims={dims} still={still} scanningId={scanningId} canScan={canScan}
        userName={userName} onOpen={(id) => setPath([id])} onSelect={onSelect}
      />
    </div>
  );
}

/**
 * The overview: you in the middle, and round you, from the middle out (Blake,
 * 2026-10-04: "we should have the inner most ring people who have new people to
 * scan and accepted, the out s ring will just be more people in the ring then if
 * that fills up too much another s ring or if not then have the unscanned
 * bridges for s shown"):
 *
 *   1. the circles with something new to act on, whatever their tier: people in
 *      them ready for a scan, or an accepted request you haven't seen
 *      (lib/chain-layout.js circleActivity `fresh`);
 *   2. then each tier the Filters grid shows, S first, as a band of its own like
 *      Network Circle's orbits ("we need to have the rings separated by tier they
 *      cant be all together"): its scanned circles, on more rings only when one
 *      would crowd, then its connections whose circle isn't scanned yet, hollow.
 *
 * Everyone once (bridgeGroups), and all of it inside the window at the home
 * zoom: the rings start further in, reach out and then close up, dots and all,
 * rather than grow past the edge (lib/chain-layout.js overviewRings).
 *
 * A click on a circle opens it, as before. A click on someone not scanned yet
 * starts the scan of their circle there and then, the way their card's Scan
 * does (lib/scraper-client.js beginScrape), with no question and no trip to the
 * Scan page, and opens their card. While it runs they become the hub of a big
 * forming cluster (ClusterSpinner.js FormingCluster). When it can't start (the
 * scanner busy or not set up) a small note by the dot says why; the scanner
 * keeps its own rules, and when it refuses (LinkedIn's budget used) the line at
 * the top says what it said, as it does for every end. People the scanner has already
 * read (a hidden list, one read with nobody new) aren't drawn: a hollow dot
 * always means "click to scan", and the depth tracker says how many were left out.
 */
function BridgeRings({ connections, degree2, index, reach, readyCount, notes, twoWays, dims, still, scanningId, canScan, userName, onOpen, onSelect }) {
  const [hovered, setHovered] = useState(null);     // a dot's id
  // The view: null until it's zoomed or moved, which means the home view (homeZoom below).
  const [viewSet, setViewSet] = useState(null);
  const [problem, setProblem] = useState(null);     // why a click didn't start a scan: { id, text, setup }
  const [starting, setStarting] = useState(null);   // whose scan is being asked for, before the scanner has it
  // Whose scan just ended, for the line at the top: kept while the next render works it out.
  const [watched, setWatched] = useState({ id: null, ended: null });
  if (scanningId && watched.id !== scanningId) setWatched({ id: scanningId, ended: null });
  else if (!scanningId && watched.id) setWatched({ id: null, ended: watched.id });
  const drag = useRef(null);
  const svgRef = useRef(null);

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;

  // Each circle's people as the filter shows them: the counts under a name, and the preview's sprouts.
  const shownIn = useMemo(() => {
    const m = new Map();
    for (const d2 of degree2) {
      if (!d2.source_connection_id) continue;
      let list = m.get(d2.source_connection_id);
      if (!list) m.set(d2.source_connection_id, (list = []));
      list.push(d2);
    }
    return m;
  }, [degree2]);

  const model = useMemo(() => {
    // A bridge is someone whose circle has been scanned: anyone in it is saved,
    // whatever the filter shows of it (their circle opens whole).
    const size = (row) => index.circles.get(row.id)?.length || 0;
    const bridges = connections.filter((c) => size(c) > 0);
    // Someone met through another bridge's circle isn't a bridge of their own
    // here: they're a link in that bridge's chain, shown inside its circle.
    const withCircle = new Set(bridges.map((b) => b.id));
    const chained = new Map();
    for (const b of bridges) {
      if (withCircle.has(b.unlocked_from_bridge_id)) chained.set(b.unlocked_from_bridge_id, (chained.get(b.unlocked_from_bridge_id) || 0) + 1);
    }
    // (A loop in who-introduced-whom shouldn't happen; if one does, they all stay here.)
    const bridgeById = new Map(bridges.map((b) => [b.id, b]));
    const linked = (b) => {
      const seen = new Set([b.id]);
      for (let from = b.unlocked_from_bridge_id; withCircle.has(from); from = bridgeById.get(from).unlocked_from_bridge_id) {
        if (seen.has(from)) return false;
        seen.add(from);
      }
      return withCircle.has(b.unlocked_from_bridge_id);
    };
    // Most going on first (lib/chain-layout.js circleActivity), then the biggest.
    const activity = circleActivity(bridges, { notes, ready: readyCount, chained });
    const roots = bridges.filter((b) => !linked(b))
      .sort((a, b) => activity.get(b.id).score - activity.get(a.id).score || size(b) - size(a));
    const { todo, hidden, read } = notScannedYet(connections, reach);
    const groups = bridgeGroups(roots, todo, (b) => activity.get(b.id).fresh);
    const layout = overviewRings(groups, maxR);
    const dots = [];
    groups.forEach((g, gi) => {
      const lg = layout.groups[gi];
      g.rows.forEach((row, i) => {
        const p = lg.points[i];
        const own = shownIn.get(row.id) || [];
        const ring = layout.rings[p.ring];
        dots.push({
          ...row, x: cx + p.x, y: cy + p.y, angle: p.angle, dotR: lg.dot, dotKind: g.kind === 'unscanned' ? 'unscanned' : 'bridge',
          arc: (2 * Math.PI * ring.radius) / ring.count,   // the room round its ring for each dot
          clusterSize: size(row), sCount: own.filter((d) => d.tier === 'S').length, aCount: own.filter((d) => d.tier === 'A').length,
          chains: chained.get(row.id) || 0, activity: activity.get(row.id), ready: readyCount.get(row.id) || 0,
          bars: g.kind === 'unscanned' ? null : scanBars(row, reach), reached: g.kind === 'unscanned' ? reachState(row, reach) : null,
        });
      });
    });
    // More than one ring of circles: the counts under each name wait for a hover, as they always did.
    const circleRings = layout.rings.filter((r) => groups[r.group].kind !== 'unscanned').length;
    return { groups, layout, dots, byId: new Map(dots.map((d) => [d.id, d])), roots, bridges, todo, hidden, read, circleRings };
  }, [connections, index, reach, notes, readyCount, shownIn, maxR, cx, cy]);

  // Where a hovered circle is previewed, beyond every ring, and the zoom at which that still fits the window.
  const band = previewBand(maxR, model.layout.rings);
  const reachesTo = model.roots.length ? band.outer : model.layout.edge + 24;
  const homeZoom = Math.max(0.6, Math.min(1.3, Math.min(cx, cy) / (reachesTo + 8)));
  const view = viewSet ?? { k: homeZoom, x: 0, y: 0 };
  const k = view.k;
  const setView = (next) => setViewSet((v) => (typeof next === 'function' ? next(v ?? { k: homeZoom, x: 0, y: 0 }) : next));
  // World → screen, and back.
  const toScreen = (d) => ({ x: (d.x - cx) * k + cx + view.x, y: (d.y - cy) * k + cy + view.y });

  // The dots, drawn once per layout and zoom; hovering only draws on top of them.
  // A circle's name sits under it while the layout kept room for names; where it
  // didn't (many sparse rings: a small network with every tier showing), a name
  // still shows on a ring with room round each dot for it, with a halo where it
  // crosses a ring.
  const named = model.layout.named;
  const counted = named && model.circleRings <= 1;
  const layer = useMemo(() => model.dots.map((d) => (d.dotKind === 'bridge'
    ? <BridgeDot key={d.id} d={d} named={named || (d.arc * k >= 48 && d.dotR * k >= 5)} halo={!named} counted={counted} />
    : <UnscannedDot key={d.id} d={d} still={still} />)), [model, named, counted, still, k]);

  // The person a scan is being asked for or running on: the hub of the forming cluster.
  const hubId = scanningId ?? starting;
  const hub = hubId != null ? model.byId.get(hubId) : null;
  const clusterR = 64 / k;

  // Pointer → the dot under it (nearest within reach); the forming cluster takes clicks for its hub.
  const hitAt = (clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const wx = (clientX - rect.left - cx - view.x) / k + cx;
    const wy = (clientY - rect.top - cy - view.y) / k + cy;
    if (hub && Math.hypot(hub.x - wx, hub.y - wy) <= clusterR * 1.24) return hub;
    let best = null;
    let bestD = Infinity;
    for (const d of model.dots) {
      const dist = Math.hypot(d.x - wx, d.y - wy);
      if (dist < bestD && dist <= Math.max(d.dotR * 1.8, 8 / k)) { bestD = dist; best = d; }
    }
    return best;
  };

  // A scan of their circle, here and now: the card's own checks and start
  // (Sidebar.js CreateClusterCard). Every refusal is said by the dot.
  async function scanHere(person) {
    setProblem(null);
    const busy = busyReason(scannerNow());
    if (busy) {
      setProblem({ id: person.id, text: `${busy}. One scan at a time: this one can start when it finishes.` });
      return;
    }
    setStarting(person.id);
    const blocked = notReadyMessage(await scraperStatus().catch(() => null));
    if (blocked) {
      setStarting(null);
      setProblem({ id: person.id, text: blocked, setup: true });
      return;
    }
    try {
      await beginScrape('bridge', { name: person.name, id: person.id });
    } catch (e) {
      const d = e.details || {};
      setProblem({ id: person.id, text: e.message || 'Could not start the scan.', setup: Boolean(d.needsRiskAcceptance || d.needsChrome) });
    } finally {
      setStarting(null);
    }
  }

  const pick = (d) => {
    if (!d) return;
    setProblem(null);
    if (d.dotKind === 'bridge') {
      setHovered(null);
      onOpen(d.id);
      return;
    }
    onSelect?.(d);
    if (canScan && d.id !== hubId) scanHere(d);
  };

  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, touch: e.pointerType === 'touch' };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      // A mouse drags the map; a finger dragged round it picks whoever it passes.
      if (d.moved && !d.touch) {
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        return;
      }
    }
    const hit = hitAt(e.clientX, e.clientY);
    setHovered((h) => (h === (hit?.id ?? null) ? h : hit?.id ?? null));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || (d.moved && !d.touch)) return;
    pick(hitAt(e.clientX, e.clientY));
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

  const hov = hovered != null ? model.byId.get(hovered) : null;
  const hovBridge = hov?.dotKind === 'bridge' ? hov : null;
  const problemAt = problem ? model.byId.get(problem.id) : null;
  // Whoever it was, wherever they sit now (a circle met through another one is inside it).
  const endedRow = watched.ended != null ? connections.find((c) => c.id === watched.ended) ?? null : null;

  // The depth tracker's numbers.
  const totalD2 = degree2.length;
  const { d2S, d2A } = useMemo(() => ({
    d2S: degree2.filter((d) => d.tier === 'S').length, d2A: degree2.filter((d) => d.tier === 'A').length,
  }), [degree2]);
  const left = model.hidden + model.read;

  return (
    <>
      <svg ref={svgRef} width={dims.w} height={dims.h}
        style={{ display: 'block', touchAction: 'none', cursor: hov ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) setHovered(null); }} onWheel={onWheel}
        role="img" aria-label={`Your circles: ${model.roots.length} scanned, ${model.todo.length} not scanned yet`}>
        <g transform={`translate(${cx * (1 - k) + view.x}, ${cy * (1 - k) + view.y}) scale(${k})`}>
          {/* Each band, faintly, in its tier's colour: the circles with something new in green */}
          {model.layout.bands.map((b) => {
            const span = b.outer - b.inner;
            return (
              <circle key={'band-' + b.band} cx={cx} cy={cy} r={(b.inner + b.outer) / 2} fill="none" pointerEvents="none"
                stroke={b.band === 'new' ? GREEN : TIER_COLORS[b.band] || 'var(--sd-fg-5, #555)'} strokeOpacity={0.05}
                strokeWidth={span + Math.max(10, model.layout.groups[0]?.spacing || 10) * 0.7} />
            );
          })}
          {/* A guide line for every ring of circles */}
          {model.layout.rings.filter((r) => model.groups[r.group].kind !== 'unscanned').map((ring) => (
            <circle key={'ring-' + ring.radius} cx={cx} cy={cy} r={ring.radius} fill="none" pointerEvents="none"
              stroke={`${DEGREE_COLORS[1]}10`} strokeWidth={1} />
          ))}

          {/* Their circle, previewed on hover, in a wedge that grows rows as it fills */}
          {hovBridge && (
            <CirclePreview key={hovBridge.id} bridge={hovBridge} members={membersOf(hovBridge, index)} reach={reach}
              cx={cx} cy={cy} maxR={maxR} still={still} band={band} circleOf={(id) => shownIn.get(id) || []} />
          )}

          {layer}

          {/* The one under the pointer, on top, with its name */}
          {hov && hov.id !== hub?.id && (hov.dotKind === 'bridge'
            ? <BridgeDot d={hov} hov k={k} named counted idPrefix="bch-" />
            : <UnscannedDot d={hov} hov k={k} still={still} />)}

          {/* A scan running here: they're the hub, and their cluster forms round them */}
          {hub && (
            <g>
              <FormingCluster x={hub.x} y={hub.y} r={clusterR} hub={Math.max(hub.dotR * 1.5, 12 / k)} still={still} />
              <Hub d={hub} r={Math.max(hub.dotR * 1.5, 12 / k)} />
              <ClusterLabel x={hub.x} y={hub.y + clusterR * 1.24 + 14 / k} k={k} person={hub} asked={starting === hub.id} />
            </g>
          )}

          {/* Center: YOU */}
          <circle cx={cx} cy={cy} r={22} fill="var(--sd-bg)" stroke="#FFD700" strokeWidth={3} pointerEvents="none" />
          <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--sd-gold, #FFD700)" fontSize={11} fontWeight={800} pointerEvents="none">
            {userName?.split(' ')[0] || 'YOU'}
          </text>
        </g>
        {hov?.dotKind === 'unscanned' && (() => {
          const at = toScreen(hov);
          return (
            <Tip x={at.x} y={at.y - hov.dotR * k * 1.6} w={dims.w}
              lines={unscannedTip(hov, { hubId, canScan, busy: busyReason(scannerNow()), via: hov.unlocked_from_name })}
              accent={hov.reached === 'ready' ? GREEN : TIER_COLORS[hov.tier]} />
          );
        })()}
      </svg>

      {/* Why a click didn't start a scan, by the dot it was on. Never a dialog. */}
      {problem && problemAt && (() => {
        const at = toScreen(problemAt);
        return (
          <div role="status" style={{
            position: 'absolute', left: Math.max(12, Math.min(dims.w - 292, at.x - 140)), top: Math.min(dims.h - 90, at.y + problemAt.dotR * k + 12),
            width: 280, ...note, borderColor: problem.setup ? 'rgba(255,128,128,0.45)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.22)',
            color: 'var(--sd-fg-1, #e6e6ee)', lineHeight: 1.45, display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <span style={{ flex: 1 }}>
              {problem.text}
              {problem.setup && <> <Link href="/setup" style={{ color: 'var(--sd-blue, #3498DB)', fontWeight: 700, textDecoration: 'none' }}>Open Scan →</Link></>}
            </span>
            <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" style={dismiss}>×</button>
          </div>
        );
      })()}

      {/* How a scan started here ended, once it has */}
      {endedRow && (
        <div style={{ position: 'absolute', top: 54, left: 64, right: 64, pointerEvents: 'none', display: 'flex' }}>
          <ScanEnded person={endedRow} size={index.circles.get(endedRow.id)?.length || 0} onMap={model.byId.has(endedRow.id)}
            onOpen={() => onOpen(endedRow.id)} onClose={() => setWatched({ id: null, ended: null })} />
        </div>
      )}

      <ZoomButtons onIn={() => zoomBy(1.3)} onReset={() => setViewSet(null)} onOut={() => zoomBy(1 / 1.3)} />

      {/* Depth tracker: just the dots, no box (Blake, 2026-10-03: the box grew with
          a theme's font and stopped fitting; "just have the dots there instead so
          its more clean looking"). What they add up to is the tooltip. Beside it,
          what the two kinds of dot mean. */}
      <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', alignItems: 'flex-end', gap: 18 }}>
        <div
          title={[
            `${model.roots.length} circles scanned${model.bridges.length > model.roots.length ? ` + ${model.bridges.length - model.roots.length} along their chains` : ''} · ${d2S} S + ${d2A} A at 2nd degree`,
            twoWays > 0 ? `${Math.round(twoWays * 100)}% of your 2nd degree you reach two or more ways` : null,
            'The inner ring: circles with something new (people ready to scan, requests accepted)',
            'Then each tier, S first: its scanned circles, then the people whose circle isn’t scanned yet (hollow)',
            left > 0 ? `${left} left out, already read by the scanner: ${[model.hidden ? `${model.hidden} hidden ${model.hidden === 1 ? 'list' : 'lists'}` : null, model.read ? `${model.read} read with nobody new` : null].filter(Boolean).join(', ')}` : null,
            'Click a circle to open it, or a hollow dot to scan theirs',
          ].filter(Boolean).join('\n')}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6].map((d) => {
            const lit = d <= 2;
            const n = d === 1 ? connections.length : d === 2 ? totalD2 : null;
            return (
              <div key={d} title={lit ? `${d === 1 ? '1st degree: your connections' : '2nd degree: the people in their circles'} (${n.toLocaleString('en-US')})` : `${d}th degree: further along a chain, as your scans reach it`}
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
        {model.todo.length > 0 && (
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--sd-fg-3, #99a)', textShadow: HALO_TEXT, paddingBottom: 1 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="sd-dot-html" style={{ width: 9, height: 9, borderRadius: '50%', background: TIER_COLORS.S }} />scanned
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', border: `1.5px solid ${TIER_COLORS.S}` }} />
              not scanned yet{canScan ? ': click to scan' : ''}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * A scanned circle on the overview, as it has always been drawn at full size
 * (r 11): its glow, the ring of bars for the people added through it, the dot
 * with their photo or initial, the badge for news, and the name and counts
 * under it. Everything scales with `d.dotR` once the rings close up. `hov`: the
 * one under the pointer, a little bigger, named at a size that reads at zoom `k`.
 */
function BridgeDot({ d, hov = false, k = 1, named, halo = false, counted, idPrefix = 'bc-' }) {
  const s = d.dotR / 11;
  const r = hov ? (d.dotR * 13) / 11 : d.dotR;
  const tier = TIER_COLORS[d.tier] || '#555';
  const photo = r >= 5 ? localPhoto(d.profile_image_url) : null;
  const ringR = r + 3.6 * s;
  const ready = d.ready;
  const news = (d.activity?.unread || 0) + ready;
  const tone = d.activity?.unread ? 'var(--sd-gold, #FFD700)' : 'var(--sd-green, #00ff88)';   // deeper on a light look
  // The name: 9 as it always was; on a hovered dot in a crowded stack, big enough to read.
  const font = hov ? Math.max(9 * Math.min(1, s), 9.5 / k) : 9;
  return (
    <g data-person={d.id}>
      {!hov && <title>{bridgeTitle(d, ready, d.bars)}</title>}
      {/* Glow */}
      <circle className="sd-dot" cx={d.x} cy={d.y} r={(hov ? 21 : 18) * s} fill={`${tier}${hov ? '14' : '08'}`} />
      {/* The ring, tight on the dot: one bar for each person you added through
          this circle. Orange: scanned since, with a cluster of their own.
          Green: ready for a scan. Nobody yet: one faint line. */}
      <g transform={`translate(${d.x} ${d.y})`} pointerEvents="none">
        {d.chains + ready === 0 && (
          <circle r={ringR} fill="none" stroke={RING.empty} strokeWidth={Math.max(0.5, s)} />
        )}
        {reachSegments(ringR, { formed: d.chains, ready }).map((seg, i) => (
          <path key={i} d={seg.d} fill="none" strokeLinecap="round" strokeWidth={Math.max(0.8, 2 * s)}
            stroke={seg.kind === 'ready' ? GREEN : DEGREE_COLORS[2]} />
        ))}
      </g>
      {/* Node */}
      <circle className="sd-dot" cx={d.x} cy={d.y} r={r}
        fill={photo ? '#1a1a2e' : tier}
        stroke={hov ? 'var(--sd-fg-1, #fff)' : tier}
        strokeWidth={(hov ? 2.5 : 2) * s} />
      {/* Photo */}
      {photo && (
        <>
          <clipPath id={idPrefix + d.id}><circle cx={d.x} cy={d.y} r={r - 2 * s} /></clipPath>
          <image href={photo} x={d.x - (r - 2 * s)} y={d.y - (r - 2 * s)}
            width={2 * (r - 2 * s)} height={2 * (r - 2 * s)} clipPath={`url(#${idPrefix}${d.id})`} />
        </>
      )}
      {!photo && r >= 5 && (
        <text x={d.x} y={d.y + 4 * s} textAnchor="middle" fill={d.tier === 'S' ? '#000' : 'var(--sd-fg-1, #fff)'}
          fontSize={11 * s} fontWeight={700} pointerEvents="none">{d.name?.charAt(0)}</text>
      )}
      {/* The circle's notifications, top right (Blake, 2026-10-02: "the circle degree
          outline on the top right with the number of notifications for that cluster"):
          new notifications about it and the people in it ready to scan. Gold when
          there's news, green when it's only people ready. */}
      {news > 0 && r >= 4 && (
        <g pointerEvents="none">
          <circle cx={d.x + 14 * s} cy={d.y - 14 * s} r={6 * s} fill="var(--sd-bg)" stroke={tone} strokeWidth={1.2 * s} />
          <text x={d.x + 14 * s} y={d.y - 11.4 * s} textAnchor="middle" fill={tone} fontSize={(news > 9 ? 6 : 7) * s} fontWeight={800}>{news > 99 ? '99+' : news}</text>
        </g>
      )}
      {/* Name + count */}
      {named && (
        <text x={d.x} y={d.y + r + font * 1.25} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={font} fontWeight={600}
          pointerEvents="none" stroke={hov || halo ? 'var(--sd-bg)' : undefined} strokeWidth={hov || halo ? font * 0.28 : undefined} paintOrder="stroke">
          {hov ? d.name : d.name?.split(' ')[0]}
        </text>
      )}
      {counted && (
        <text x={d.x} y={d.y + r + font * 2.35} textAnchor="middle" fill={hov ? 'var(--sd-fg-2, #bbb)' : 'var(--sd-fg-3, #888)'} fontSize={font * 0.78}
          pointerEvents="none" stroke={hov ? 'var(--sd-bg)' : undefined} strokeWidth={hov ? font * 0.24 : undefined} paintOrder="stroke">
          {d.clusterSize.toLocaleString('en-US')} · {d.sCount > 0 ? d.sCount + 'S ' : ''}{d.aCount > 0 ? d.aCount + 'A' : ''}
        </text>
      )}
    </g>
  );
}

/**
 * One of your connections whose circle isn't scanned yet: a hollow dot in their
 * tier's colour (just a dim one when it's too small to be hollow), with the
 * breathing halo when they came through a circle and are ready for a scan.
 */
function UnscannedDot({ d, hov = false, k = 1, still }) {
  const tier = TIER_COLORS[d.tier] || '#555';
  const r = hov ? Math.max(d.dotR * 1.5, 4.5 / k) : d.dotR;
  const ready = d.reached === 'ready';
  const ring = hov || r >= 2.4;
  return (
    <g data-person={d.id}>
      {ready && !hov && <Halo x={d.x} y={d.y} r={r * 2.2} still={still} />}
      {ring ? (
        <circle cx={d.x} cy={d.y} r={r} fill="var(--sd-bg)" fillOpacity={0.75}
          stroke={hov ? 'var(--sd-fg-1, #fff)' : ready ? GREEN : tier} strokeWidth={Math.max(0.6, r * (hov ? 0.3 : 0.34))} strokeOpacity={hov ? 1 : 0.9} />
      ) : (
        <circle cx={d.x} cy={d.y} r={r} fill={ready ? GREEN : tier} fillOpacity={0.42} />
      )}
      {hov && <circle cx={d.x} cy={d.y} r={r * 0.45} fill={tier} pointerEvents="none" />}
    </g>
  );
}

/** The person at the middle of a forming cluster: their dot, bigger, with photo or initial. */
function Hub({ d, r }) {
  const tier = TIER_COLORS[d.tier] || '#555';
  const photo = localPhoto(d.profile_image_url);
  return (
    <g pointerEvents="none">
      <circle cx={d.x} cy={d.y} r={r} fill={photo ? '#1a1a2e' : tier} stroke="var(--sd-fg-1, #fff)" strokeWidth={r * 0.14} />
      {photo ? (
        <>
          <clipPath id={'hub-' + d.id}><circle cx={d.x} cy={d.y} r={r * 0.86} /></clipPath>
          <image href={photo} x={d.x - r * 0.86} y={d.y - r * 0.86} width={r * 1.72} height={r * 1.72} clipPath={`url(#hub-${d.id})`} />
        </>
      ) : (
        <text x={d.x} y={d.y + r * 0.36} textAnchor="middle" fill={d.tier === 'S' ? '#000' : 'var(--sd-fg-1, #fff)'} fontSize={r} fontWeight={800}>
          {d.name?.charAt(0)}
        </text>
      )}
    </g>
  );
}

/**
 * Under a forming cluster: whose circle, and how far the scan has got, from the
 * scanner's own answer (lib/scraper-client.js). Its own component, so the
 * answer changing every second or two redraws these two lines, not the map.
 */
function ClusterLabel({ x, y, k, person, asked }) {
  const scan = useScanner();
  const mine = scan.running && scan.target?.id === person.id;
  const found = mine ? scan.found.reduce((a, b) => a + b, 0) : 0;
  const how = !mine || scan.pending
    ? (asked ? 'Asking the scanner…' : 'Starting…')
    : scan.pages > 0 ? `page ${scan.pages} · ${found.toLocaleString('en-US')} found` : 'Opening their profile…';
  return (
    <g pointerEvents="none">
      <text x={x} y={y} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={11 / k} fontWeight={700}
        stroke="var(--sd-bg)" strokeWidth={3 / k} paintOrder="stroke">
        Scanning {firstName(person)}’s circle
      </text>
      <text x={x} y={y + 13 / k} textAnchor="middle" fill="var(--sd-fg-3, #aab)" fontSize={9.5 / k}
        stroke="var(--sd-bg)" strokeWidth={3 / k} paintOrder="stroke">
        {how}
      </text>
    </g>
  );
}

/** The lines of a hollow dot's tooltip: who, and what a click does and costs. */
function unscannedTip(row, { hubId, canScan, busy, via }) {
  const cost = circleScanCost();
  const status = row.id === hubId ? 'Their circle is being scanned now'
    : row.reached === 'ready' ? `Ready to scan · met through ${via ? firstName({ name: via }) : 'a circle'}`
    : 'Their circle isn’t scanned yet';
  const next = row.id === hubId ? ['Click to open their card']
    : !canScan ? ['Scanning needs your own network']
    : busy ? [`${busy}:`, 'one scan at a time']
    : ['Click to scan their circle here', `${cost.profileViews} profile view, ≤${cost.searches} searches, ~${cost.minutes} min`];
  return [row.name, `${row.tier}-tier · ${score(row).toFixed(1)}`, status, ...next];
}

/**
 * The line at the top once a scan of someone on the overview has ended: their
 * circle is in (and where), or why it isn't. Read from what the network now
 * holds and what the scanner said, never guessed: a scan whose saves haven't
 * reached the map yet says how many it saved, not "nobody".
 */
function ScanEnded({ person, size, onMap, onOpen, onClose }) {
  const scan = useScanner();
  const job = scan.finished.find((j) => j.target?.id === person.id);
  const first = firstName(person);
  const saved = savedIn(job?.log || []);
  let text;
  let open = false;
  if (size > 0) {
    // Where they are now: with the scanned circles, or, met through someone's
    // circle, a link in that circle's chain, drawn inside it.
    const where = onMap ? ` ${first} sits with your scanned circles now.`
      : person.unlocked_from_name ? ` It’s on the chain from ${firstName({ name: person.unlocked_from_name })}’s circle.` : '';
    text = `${first}’s circle is in: ${size.toLocaleString('en-US')} ${size === 1 ? 'person' : 'people'}.${where}`;
    open = true;
  } else if (saved > 0) {
    text = `${first}’s scan saved ${saved.toLocaleString('en-US')} ${saved === 1 ? 'person' : 'people'}. They’ll be on the map in a moment.`;
  } else if (!job) {
    text = `${first}’s scan has ended.`;
  } else if ((job.log || []).includes('Stopped.')) {
    // Stopped by hand (the Scan page's Stop, or Stop scanning on the bar).
    text = `${first}’s scan was stopped before anyone new was saved.`;
  } else if (job.failure?.length) {
    text = `${first}’s scan stopped: ${job.failure[job.failure.length - 1]}`;
  } else if (job.exitCode != null && job.exitCode !== 0) {
    text = `${first}’s scan stopped (exit ${job.exitCode}).`;
  } else {
    text = lastSaid(job.log) || `${first}’s scan ended with nobody new saved.`;
  }
  return (
    <div role="status" style={{ ...note, pointerEvents: 'auto', borderColor: open ? 'rgba(0,255,136,0.4)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.2)', color: 'var(--sd-fg-1, #e6e6ee)', display: 'flex', gap: 10, alignItems: 'center', maxWidth: 560 }}>
      <span>{text}</span>
      {open && <button type="button" onClick={onOpen} style={{ ...crumb, color: 'var(--sd-green, #00ff88)', whiteSpace: 'nowrap' }}>Open it →</button>}
      <button type="button" onClick={onClose} aria-label="Dismiss" style={dismiss}>×</button>
    </div>
  );
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

/** The last thing a scan said that explains how it ended (a used budget, a hidden list), not "Finished.". */
function lastSaid(log) {
  const skip = /^(Finished\.|Stopped\.|Stopping…|Stopped \(exit|Speed:|Made today|Today’s backup couldn|Mapping the circle behind)/;
  for (let i = log.length - 1; i >= 0; i--) {
    const line = String(log[i]).trim();
    if (line && !skip.test(line)) return line;
  }
  return null;
}

/** What a bridge's ring and number mean, in words, for its tooltip. */
function bridgeTitle(b, ready, bars) {
  const parts = [];
  const notes = b.activity?.notes || 0;
  if (notes) parts.push(`${notes} notification${notes === 1 ? '' : 's'} about their circle${b.activity.unread ? `, ${b.activity.unread} new` : ''}`);
  if (ready) parts.push(`${ready} in ${firstName(b)}’s circle ${ready === 1 ? 'is' : 'are'} ready for a scan`);
  if (b.chains) parts.push(`${b.chains} scanned since, with ${b.chains === 1 ? 'a cluster' : 'clusters'} of their own`);
  if (bars != null) parts.push(bars === 5 ? 'their whole list is scanned' : `about ${bars * 20}% of their list is scanned`);
  return parts.length ? parts.join(' · ') : `${firstName(b)}’s circle`;
}

/** A bridge's circle on hover: the people you reached through it first, then their S, A and B. */
// The preview grows out of the bridge when you hover it (Blake, 2026-10-03: "the
// d2,3,4 clusters emerging out of the circle in the preview to show the grow but
// make it quick and snappy"): their circle's people shoot out to their places,
// then anyone among them whose own circle is scanned sprouts it (3rd degree),
// then theirs (4th). Under half a second in all; still with Reduce Motion.
const PREVIEW_CSS = `
@keyframes pvEmerge { from { transform: translate(var(--fx), var(--fy)) scale(0.2); opacity: 0; } 55% { opacity: 1; } to { transform: none; opacity: 1; } }
@keyframes pvFade { from { opacity: 0; } }
.pv-dot { transform-box: fill-box; transform-origin: center; animation: pvEmerge .24s cubic-bezier(.2,.9,.3,1.25) both; animation-delay: var(--d, 0ms); }
.pv-d3 { animation-duration: .22s; animation-delay: calc(150ms + var(--d, 0ms)); }
.pv-d4 { animation-duration: .2s; animation-delay: calc(270ms + var(--d, 0ms)); }
.pv-line { animation: pvFade .3s ease-out both; animation-delay: var(--d, 0ms); }
@media (prefers-reduced-motion: reduce) { .pv-dot, .pv-line { animation: none; } }
`;
const SPROUT = 14;   // the most of a circle's own circle drawn round them
const SPROUT_4 = 8;

/** Where someone's own circle sprouts round their dot: an arc facing away from the middle. */
function sprout(n, x, y, cx, cy, r) {
  const out = Math.atan2(y - cy, x - cx);
  const spread = Math.min(Math.PI * 1.1, 0.5 + n * 0.16);
  return Array.from({ length: n }, (_, i) => {
    const a = out - spread / 2 + (n === 1 ? spread / 2 : (i * spread) / (n - 1));
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
  });
}

function CirclePreview({ bridge, members, reach, cx, cy, maxR, still, band, circleOf = () => [] }) {
  const shown = members.filter((m) => m.degree === 1 || m.tier === 'S' || m.tier === 'A' || m.tier === 'B');
  // Beyond every ring of bridges (lib/chain-layout.js previewBand).
  const { inner, outer } = band;
  const sweep = Math.min(Math.PI * 0.9, Math.max(Math.PI * 0.2, (shown.length * 11) / inner));
  const layout = ringLayout(shown.length, {
    inner, outer, spacing: 11, minSpacing: 3.5, start: bridge.angle - sweep / 2, sweep,
  });
  // Spread the start of each dot over a tenth of a second, wherever it sits.
  const stagger = (j) => `${Math.round((j / Math.max(1, shown.length)) * 110)}ms`;
  const from = (x, y, ox, oy) => ({ '--fx': `${(ox - x).toFixed(1)}px`, '--fy': `${(oy - y).toFixed(1)}px` });
  return (
    <g>
      <style>{PREVIEW_CSS}</style>
      <circle cx={cx} cy={cy} r={inner} fill="none" stroke={`${DEGREE_COLORS[2]}06`} strokeWidth={1} />
      {shown.map((d2, j) => {
        const p = layout.points[j];
        const x2 = cx + p.x;
        const y2 = cy + p.y;
        const state = reachState(d2, reach);
        const nr = Math.min(dotRadius(layout.spacing, d2.tier), 5) * (state ? 1.3 : 1);
        const color = state === 'hidden' ? HIDDEN : TIER_COLORS[d2.tier] || '#555';
        // Their own circle, if it's scanned: the 3rd degree, and inside it the 4th.
        const own = d2.degree === 1 ? circleOf(d2.id) : [];
        const third = own.slice(0, SPROUT);
        const thirdAt = sprout(third.length, x2, y2, cx, cy, nr + 9);
        return (
          <g key={'pv-' + d2.id}>
            {(state || shown.length <= 40) && (
              <line className="pv-line" style={{ '--d': stagger(j) }} x1={bridge.x} y1={bridge.y} x2={x2} y2={y2}
                stroke={state ? GREEN : color} strokeWidth={0.5} strokeOpacity={state ? 0.35 : 0.15} />
            )}
            <g className="pv-dot" style={{ '--d': stagger(j), ...from(x2, y2, bridge.x, bridge.y) }}>
              {state === 'ready' && <Halo x={x2} y={y2} r={nr * 2.3} still={still} />}
              <circle className="sd-dot" cx={x2} cy={y2} r={nr}
                fill={color} fillOpacity={state ? 0.95 : 0.45}
                stroke={state && state !== 'hidden' ? GREEN : color} strokeWidth={state ? 1 : 0.5} strokeOpacity={state ? 1 : 0.25} />
              {(d2.tier === 'S' || state) && shown.length <= 60 && (
                <text x={x2} y={y2 + nr + 9} textAnchor="middle" fill={state && state !== 'hidden' ? GREEN : 'var(--sd-fg-3, #aaa)'} fontSize={7}>
                  {firstName(d2)}
                </text>
              )}
            </g>
            {third.map((k, i) => {
              const t = thirdAt[i];
              const fourth = k.degree === 1 ? circleOf(k.id).slice(0, SPROUT_4) : [];
              const fourthAt = sprout(fourth.length, t.x, t.y, x2, y2, 6);
              return (
                <g key={'p3-' + k.id}>
                  <line className="pv-line" style={{ '--d': `calc(150ms + ${stagger(j)})` }} x1={x2} y1={y2} x2={t.x} y2={t.y}
                    stroke={TIER_COLORS[k.tier] || '#555'} strokeWidth={0.4} strokeOpacity={0.3} />
                  <circle className="pv-dot pv-d3" style={{ '--d': `${i * 8}ms`, ...from(t.x, t.y, x2, y2) }}
                    cx={t.x} cy={t.y} r={1.8} fill={TIER_COLORS[k.tier] || '#555'} fillOpacity={0.85} />
                  {fourth.map((f, q) => (
                    <circle key={'p4-' + f.id} className="pv-dot pv-d4" style={{ '--d': `${q * 6}ms`, ...from(fourthAt[q].x, fourthAt[q].y, t.x, t.y) }}
                      cx={fourthAt[q].x} cy={fourthAt[q].y} r={1.1} fill={TIER_COLORS[f.tier] || '#555'} fillOpacity={0.75} />
                  ))}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** The soft breathing halo on someone ready for a circle scan. Still when Reduce Motion is on. */
function Halo({ x, y, r, still }) {
  return (
    <circle cx={x} cy={y} r={r} fill={GREEN} fillOpacity={0.16} stroke={GREEN} strokeWidth={0.8} strokeOpacity={0.45} pointerEvents="none">
      {!still && <animate attributeName="fill-opacity" values="0.06;0.24;0.06" dur="2.8s" repeatCount="indefinite" />}
      {!still && <animate attributeName="stroke-opacity" values="0.25;0.7;0.25" dur="2.8s" repeatCount="indefinite" />}
    </circle>
  );
}

/** A small lock, drawn inside a greyed dot whose list is hidden. */
function Lock({ x, y, s }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} pointerEvents="none">
      <path d="M-1.9 -0.6 V-1.8 A1.9 1.9 0 0 1 1.9 -1.8 V-0.6" fill="none" stroke="#d6d6de" strokeWidth={0.9} />
      <rect x={-2.6} y={-0.7} width={5.2} height={3.9} rx={0.8} fill="var(--sd-fg-2, #d6d6de)" />
    </g>
  );
}

function ZoomButtons({ onIn, onReset, onOut }) {
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

/**
 * One person's circle, round them: a bridge's, or that of anyone in a circle
 * opened before. `trail` is how you got here, the person last; their people
 * are one degree further out along the chain than they are.
 */
function CircleFocus({ trail, index, reach, dims, requests, scanningId, still, canScan, onOpen, onBack, onSelect }) {
  const person = trail[trail.length - 1];
  const depth = trail.length;               // the person's degree along the chain: a bridge is 1
  const members = useMemo(() => membersOf(person, index), [person, index]);
  // The chains that lead on from here. Each link stays a dot in the circle it
  // was met through; the cluster their scan formed sits outside, joined to
  // that dot, so you can see where each path came from.
  const trailKey = trail.map((r) => r.id).join('>');
  const links = useMemo(
    () => chainsFrom(person, index, trailKey.split('>'), Math.max(0, MAX_DEGREE - 1 - depth)),
    [person, index, trailKey, depth],
  );
  const [hover, setHover] = useState(null); // a member's index, 'center', 'L' + a link's index, or null
  // null until it's moved or zoomed: the fit worked out below.
  const [viewSet, setViewSet] = useState(null);
  const drag = useRef(null);
  const svgRef = useRef(null);
  const router = useRouter();

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const maxR = Math.min(cx, cy) - 30;
  // Chains fan out to the side on a wide window, below on a tall one; the people
  // you added sit on that side of the circle, so each line is short.
  const toward = dims.w >= dims.h ? 0 : Math.PI / 2;
  const hasChains = links.length > 0;
  // Tier bands round them, S nearest, like Network Circle's orbits; with chains
  // to draw, the bands leave the outside of the circle for them.
  const layout = useMemo(() => tierBandLayout(members, {
    inner: Math.max(62, maxR * 0.3), outer: maxR * (hasChains ? 0.72 : 0.94),
    spacing: Math.max(14, Math.min(24, maxR * 0.085)), minSpacing: 4, gap: Math.max(10, maxR * 0.04),
    start: hasChains ? toward : -Math.PI / 2,
  }), [members, maxR, hasChains, toward]);

  // Each link's people (anyone met through their circle first, so the next
  // links of the chain are among the dots drawn) and the disc they need. The
  // same size of dot for all of them, so a bigger circle is a bigger disc.
  const sizes = useMemo(() => links.map(({ row }) => {
    const people = membersOf(row, index);
    const l = ringLayout(Math.min(people.length, LINK_DOTS), CLUSTER);
    return { people, radius: (l.rings[l.rings.length - 1]?.radius || LINK_INNER) + 6 };
  }), [links, index]);
  // Where each cluster sits: straight out from its person's dot in the circle;
  // further along a chain, straight out from the cluster before.
  const tree = useMemo(() => {
    if (!links.length) return null;
    const widest = Math.max(...sizes.map((c) => c.radius));
    const at = new Map(members.map((row, i) => [row.id, i]));
    return chainTree(links.map((l) => l.parent), {
      from: layout.edge + layout.spacing + widest + 22, hop: widest * 2 + 46, spacing: widest * 2 + 26, toward,
      angles: links.map((l) => (l.parent < 0 ? layout.points[at.get(l.row.id)]?.angle : undefined)),
    });
  }, [links, sizes, members, layout, toward]);
  // The dots of each cluster, its first ring starting on the side that faces
  // outwards, where the next link of the chain will be.
  const clusters = useMemo(() => sizes.map((c, j) => ({
    ...c,
    points: ringLayout(Math.min(c.people.length, LINK_DOTS), { ...CLUSTER, start: tree.points[j].angle }).points,
  })), [sizes, tree]);
  // The dot each path comes from: the link's own dot, in the big circle or in
  // the cluster of whoever you met them through. `back` is who that was.
  const origins = useMemo(() => {
    const at = new Map(members.map((row, i) => [row.id, i]));
    return links.map((link) => {
      if (link.parent < 0) {
        const p = layout.points[at.get(link.row.id)];
        return p ? { x: p.x, y: p.y, r: dotRadius(layout.spacing, link.row.tier) * 1.4, back: { x: 0, y: 0, r: 30 } } : { x: 0, y: 0, r: 30, back: null };
      }
      const hub = tree.points[link.parent];
      const i = clusters[link.parent].people.findIndex((row) => row.id === link.row.id);
      const pt = clusters[link.parent].points[i] || { x: 0, y: 0 };
      return { x: hub.x + pt.x, y: hub.y + pt.y, r: KID_DOT, inCluster: true, back: { x: hub.x, y: hub.y, r: LINK_HUB } };
    });
  }, [links, members, layout, tree, clusters]);
  // Fit the bands and every chain in the window to start with.
  const fit = useMemo(() => {
    if (!tree) return { k: 1, x: 0, y: 0 };
    const box = { l: -layout.edge, r: layout.edge, t: -layout.edge, b: layout.edge };
    tree.points.forEach((p, j) => {
      const r = clusters[j].radius;
      box.l = Math.min(box.l, p.x - r - 30); box.r = Math.max(box.r, p.x + r + 30);
      box.t = Math.min(box.t, p.y - r - 8); box.b = Math.max(box.b, p.y + r + 30);
    });
    // Room at the top for the trail, and a little at every other edge.
    const pad = { side: 70, top: 96, bottom: 30 };
    const k = Math.max(0.35, Math.min(1, (dims.w - pad.side * 2) / (box.r - box.l), (dims.h - pad.top - pad.bottom) / (box.b - box.t)));
    return { k, x: (-(box.l + box.r) / 2) * k, y: (-(box.t + box.b) / 2) * k + (pad.top - pad.bottom) / 2 };
  }, [tree, clusters, layout, dims.w, dims.h]);
  const view = viewSet ?? fit;
  const setView = (next) => setViewSet((v) => (typeof next === 'function' ? next(v ?? fit) : next));

  // What each dot is: someone you reached (ready, hidden, scanned) or a
  // 2nd-degree row, maybe with a request out; and how big their own circle is.
  const facts = useMemo(() => members.map((row) => {
    const reached = reachState(row, reach);
    return {
      reached,
      requested: !reached && row.degree === 2 && hasRequest(row, requests),
      own: row.degree === 1 ? (index.circles.get(row.id)?.length || 0) + (index.introduced.get(row.id)?.length || 0) : 0,
    };
  }), [members, reach, requests, index]);
  // Someone ready for a scan has nobody in their circle yet, so a click on them
  // goes to the Scan page with them picked (backlog 2.4, pick 3). Everyone else
  // opens in place, and so do they while their circle is scanned, to watch it fill in.
  const goesToScan = (i) => canScan && facts[i].reached === 'ready' && members[i].id !== scanningId;

  const k = view.k;
  // The dots, drawn once per layout and zoom; hovering only draws on top of them.
  const dots = useMemo(() => {
    const few = members.length <= 60;
    const roomy = layout.spacing * k >= 26;
    // The people you added sit side by side, so their names take turns above and below.
    let named = 0;
    return members.map((row, i) => {
      const p = layout.points[i];
      const f = facts[i];
      const r = dotRadius(layout.spacing, row.tier) * (f.reached ? 1.4 : 1);
      const color = f.reached === 'hidden' ? HIDDEN : TIER_COLORS[row.tier] || '#555';
      const above = f.reached ? named++ % 2 === 1 : false;
      return (
        <g key={row.id}>
          {(few || f.reached) && (
            <line x1={0} y1={0} x2={p.x} y2={p.y} stroke={f.reached ? GREEN : color}
              strokeWidth={0.6 / k} strokeOpacity={f.reached ? 0.3 : 0.12} />
          )}
          {f.reached === 'ready' && <Halo x={p.x} y={p.y} r={r * 2.3} still={still} />}
          {f.requested ? (
            <circle cx={p.x} cy={p.y} r={r * 1.2} fill="none" stroke={color} strokeWidth={Math.max(0.6, r * 0.45)}
              strokeDasharray={`${Math.max(0.8, r * 0.55)} ${Math.max(0.6, r * 0.45)}`} />
          ) : (
            <circle className="sd-dot" cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={f.reached ? 1 : 0.85}
              stroke={f.reached && f.reached !== 'hidden' ? GREEN : 'none'} strokeWidth={f.reached ? Math.max(0.8, r * 0.3) : 0} />
          )}
          {f.reached === 'hidden' && <Lock x={p.x} y={p.y - r * 0.1} s={r / 4.2} />}
          {row.id === scanningId && (
            <circle cx={p.x} cy={p.y} r={r * 2} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1 / k} strokeDasharray={`${3 / k} ${2 / k}`} />
          )}
          {(f.reached || (roomy && row.tier === 'S')) && (
            <text x={p.x} y={above ? p.y - r - 4 / k : p.y + r + 10 / k} textAnchor="middle" fontSize={8.5 / k} fontWeight={f.reached ? 700 : 400}
              fill={f.reached === 'hidden' ? 'var(--sd-fg-3, #999)' : f.reached ? GREEN : 'var(--sd-fg-3, #aaa)'} pointerEvents="none"
              stroke="var(--sd-bg)" strokeWidth={2.4 / k} paintOrder="stroke">
              {firstName(row)}
            </text>
          )}
        </g>
      );
    });
  }, [members, layout, facts, k, still, scanningId]);

  // Pointer → the member under it (nearest within reach), or the person in the middle.
  const hitAt = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const wx = (clientX - rect.left - cx - view.x) / k;
    const wy = (clientY - rect.top - cy - view.y) / k;
    if (Math.hypot(wx, wy) <= 30) return 'center';
    if (tree) {
      const j = tree.points.findIndex((p, i) => Math.hypot(p.x - wx, p.y - wy) <= Math.max(16, clusters[i].radius));
      if (j >= 0) return 'L' + j;
    }
    const near = Math.max(layout.spacing * 0.6, 10 / k);
    let best = null;
    let bestD = near;
    layout.points.forEach((p, i) => {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) { bestD = d; best = i; }
    });
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
    setHover((h) => (h === hit ? h : hit));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit === 'center') onSelect?.(person);
    else if (typeof hit === 'string') onOpen(chainTo(Number(hit.slice(1))));
    else if (hit != null && goesToScan(hit)) router.push(scanPageFor(members[hit]));
    else if (hit != null) onOpen(members[hit].id);
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

  // From the person in the middle out to link j: the ids to open, nearest first.
  const chainTo = (j) => {
    const ids = [];
    for (let i = j; i >= 0; i = links[i].parent) ids.unshift(links[i].row.id);
    return ids;
  };
  const hovLink = typeof hover === 'string' && hover[0] === 'L' ? Number(hover.slice(1)) : -1;
  const litLinks = hovLink >= 0 ? new Set(chainTo(hovLink)) : null;

  const ready = facts.filter((f) => f.reached === 'ready').length;
  const hidden = facts.filter((f) => f.reached === 'hidden').length;
  const added = facts.filter((f) => f.reached).length;
  const asked = facts.filter((f) => f.requested).length;
  const byTier = ['S', 'A', 'B', 'C', 'D'].map((t) => [t, members.filter((m) => m.tier === t).length]).filter(([, n]) => n);
  const scanningThem = scanningId != null && scanningId === person.id;
  const hovered = typeof hover === 'number' ? members[hover] : null;
  const hp = typeof hover === 'number' ? layout.points[hover] : null;

  return (
    <>
      <svg ref={svgRef} width={dims.w} height={dims.h}
        style={{ display: 'block', touchAction: 'none', cursor: hover != null ? 'pointer' : 'grab' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!drag.current) setHover(null); }} onWheel={onWheel}
        role="img" aria-label={`${person.name}’s circle: ${members.length} ${members.length === 1 ? 'person' : 'people'}`}>
        <defs>
          <filter id="focusGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g transform={`translate(${cx + view.x} ${cy + view.y}) scale(${k})`}>
          {/* A faint band behind each tier's dots, in its colour */}
          {layout.bands.map((band) => (
            <circle key={band.tier} r={(band.inner + band.outer) / 2} fill="none"
              stroke={TIER_COLORS[band.tier] || 'var(--sd-fg-5, #555)'} strokeOpacity={0.07}
              strokeWidth={Math.max(1 / k, band.outer - band.inner + layout.spacing)} pointerEvents="none" />
          ))}
          {dots}
          {/* The chains that lead on from here. Every cluster is the circle of one
              person you added and then scanned; the line to it starts at that
              person's own dot, so you can see where the path came from. */}
          {tree && links.map((link, j) => {
            const p = tree.points[j];
            const c = clusters[j];
            const row = link.row;
            const lit = litLinks?.has(row.id);
            const color = DEGREE_COLORS[depth + link.step] || DEGREE_COLORS[6];
            return (
              <g key={'lk-' + row.id} transform={`translate(${p.x} ${p.y})`} pointerEvents="none"
                opacity={litLinks && !lit ? 0.45 : 1}>
                <circle r={c.radius} fill="var(--sd-bg)" fillOpacity={0.9} stroke={color} strokeOpacity={lit ? 0.7 : 0.25} strokeWidth={1 / k} />
                {/* Their people, each joined to the middle of the cluster */}
                {clusterPaths(c).map(([tier, { spokes }]) => (
                  <path key={'s' + tier} d={spokes} fill="none" stroke={TIER_COLORS[tier] || 'var(--sd-fg-5, #555)'}
                    strokeWidth={0.7} strokeOpacity={lit ? 0.6 : 0.38} />
                ))}
                {clusterPaths(c).map(([tier, { dots: d }]) => (
                  <path className="sd-dot" key={tier} d={d} fill={TIER_COLORS[tier] || 'var(--sd-fg-5, #555)'} fillOpacity={lit ? 1 : 0.9} />
                ))}
                <circle className="sd-dot" r={LINK_HUB} fill={color} stroke={hovLink === j ? 'var(--sd-fg-1, #fff)' : 'var(--sd-bg)'} strokeWidth={1.5} />
                {row.id === scanningId && (
                  <circle r={c.radius + 4} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1 / k} strokeDasharray={`${3 / k} ${2 / k}`} />
                )}
                <text y={c.radius + 12 / k} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={10 / k} fontWeight={700}
                  stroke="var(--sd-bg)" strokeWidth={2.4 / k} paintOrder="stroke">{firstName(row)}’s circle</text>
                <text y={c.radius + 23 / k} textAnchor="middle" fill={color} fontSize={8 / k}
                  stroke="var(--sd-bg)" strokeWidth={2.4 / k} paintOrder="stroke">
                  {c.people.length.toLocaleString('en-US')} · {ordinal(depth + link.step + 1)} degree
                </text>
              </g>
            );
          })}
          {/* The paths, on top of the clusters they cross: from whoever you met
              them through, to their own dot, and on out to the cluster their scan formed. */}
          {tree && links.map((link, j) => {
            const o = origins[j];
            const p = tree.points[j];
            const lit = litLinks?.has(link.row.id);
            const color = DEGREE_COLORS[depth + link.step] || DEGREE_COLORS[6];
            const seg = (a, ra, b, rb, key) => {
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              if (len <= ra + rb) return null;
              const ux = (b.x - a.x) / len;
              const uy = (b.y - a.y) / len;
              return (
                <line key={key} x1={a.x + ux * ra} y1={a.y + uy * ra} x2={b.x - ux * rb} y2={b.y - uy * rb}
                  stroke={color} strokeLinecap="round" strokeWidth={(lit ? 2.6 : 1.8) / k}
                  strokeOpacity={litLinks && !lit ? 0.3 : lit ? 1 : 0.85} />
              );
            };
            return (
              <g key={'ln-' + link.row.id} pointerEvents="none">
                {o.back && seg(o.back, o.back.r, o, o.r + 1, 'a')}
                {seg(o, o.r + 1, p, LINK_HUB + 1, 'b')}
                {/* Their own dot inside the cluster they were met through */}
                {o.inCluster && (
                  <circle className="sd-dot" cx={o.x} cy={o.y} r={o.r} fill={TIER_COLORS[link.row.tier] || 'var(--sd-fg-5, #555)'} stroke={GREEN} strokeWidth={1.4} />
                )}
              </g>
            );
          })}
          {/* The one under the pointer, on top */}
          {hp && (
            <>
              <line x1={0} y1={0} x2={hp.x} y2={hp.y} stroke={TIER_COLORS[hovered.tier] || 'var(--sd-fg-3, #888)'} strokeWidth={1.6 / k} strokeOpacity={0.8} />
              <circle cx={hp.x} cy={hp.y} r={dotRadius(layout.spacing, hovered.tier) * (facts[hover].reached ? 1.4 : 1) + 2 / k}
                fill="none" stroke="#fff" strokeWidth={1.6 / k} />
            </>
          )}
          {/* The person in the middle, with the halo if their own circle is ready to scan */}
          {reachState(person, reach) === 'ready' && <Halo x={0} y={0} r={40} still={still} />}
          <circle r={28} fill="var(--sd-bg)" stroke={TIER_COLORS[person.tier] || 'var(--sd-fg-3, #888)'} strokeWidth={hover === 'center' ? 4 : 3} filter="url(#focusGlow)" />
          {localPhoto(person.profile_image_url) ? (
            <>
              <clipPath id="focus-clip"><circle r={24} /></clipPath>
              <image href={localPhoto(person.profile_image_url)} x={-24} y={-24} width={48} height={48} clipPath="url(#focus-clip)" />
            </>
          ) : (
            <text y={5} textAnchor="middle" fill={TIER_COLORS[person.tier] || 'var(--sd-fg-3, #888)'} fontSize={16} fontWeight={800}>
              {person.name?.charAt(0)}
            </text>
          )}
          <text y={40} textAnchor="middle" fill="var(--sd-fg-1, #fff)" fontSize={11} fontWeight={700} pointerEvents="none">{person.name}</text>
        </g>
        {hovered && (
          <Tip x={cx + view.x + hp.x * k} y={cy + view.y + hp.y * k} w={dims.w}
            lines={tipFor(hovered, facts[hover], scanningId, depth, goesToScan(hover))} accent={facts[hover].reached ? GREEN : TIER_COLORS[hovered.tier]} />
        )}
        {hovLink >= 0 && (
          <Tip x={cx + view.x + tree.points[hovLink].x * k} y={cy + view.y + (tree.points[hovLink].y - clusters[hovLink].radius) * k} w={dims.w}
            lines={[`${links[hovLink].row.name}’s circle`,
              `${clusters[hovLink].people.length.toLocaleString('en-US')} people · ${ordinal(depth + links[hovLink].step + 1)} degree`,
              `You met ${firstName(links[hovLink].row)} through ${firstName(links[hovLink].parent >= 0 ? links[links[hovLink].parent].row : person)}’s circle, then scanned`,
              'Click to open it']}
            accent={DEGREE_COLORS[depth + links[hovLink].step] || DEGREE_COLORS[6]} />
        )}
        {hover === 'center' && (
          <Tip x={cx + view.x} y={cy + view.y - 28 * k} w={dims.w} lines={[person.name, 'Open their card']} accent={TIER_COLORS[person.tier]} />
        )}
      </svg>

      {/* The way back: one circle at a time, or straight to any on the trail.
          Clear of the Filters tab at the left edge, and under the notch that
          holds the view buttons at the top of the map. */}
      <div style={{ position: 'absolute', top: 54, left: 64, right: 64, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', pointerEvents: 'auto' }}>
          <button type="button" onClick={() => onBack(depth - 1)} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)', color: 'var(--sd-fg-1, #ddd)', fontSize: 12, fontWeight: 700,
          }}>
            ← {depth === 1 ? 'All bridges' : `${firstName(trail[depth - 2])}’s circle`}
          </button>
          <nav aria-label="Trail" style={{ fontSize: 11, color: 'var(--sd-fg-4, #777)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => onBack(0)} style={crumb}>All bridges</button>
            {trail.map((row, i) => (
              <span key={row.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span aria-hidden="true">›</span>
                {i === depth - 1
                  ? <span style={{ color: 'var(--sd-fg-1, #fff)', fontWeight: 700 }}>{row.name}</span>
                  : <button type="button" onClick={() => onBack(i + 1)} style={crumb}>{row.name}</button>}
              </span>
            ))}
          </nav>
        </div>
        <div style={{ fontSize: 11, color: 'var(--sd-fg-3, #999)' }}>
          {firstName(person)}’s circle · {members.length.toLocaleString('en-US')} {members.length === 1 ? 'person' : 'people'}
          {' · '}{ordinal(depth + 1)} degree{depth > 1 ? ', counted along this chain' : ''}
        </div>
        {scanningThem && members.length > 0 && (
          <div role="status" style={{ ...note, borderColor: 'rgba(52,152,219,0.4)', color: 'var(--sd-fg-1, #cfe6f7)' }}>
            Scanning {firstName(person)}’s circle now. More people appear here as it saves, every 10 pages.
          </div>
        )}
      </div>

      {members.length === 0 && (
        <EmptyCircle person={person} depth={depth} reach={reach} requests={requests}
          scanning={scanningThem} canScan={canScan} onSelect={onSelect} top={cy + 64} />
      )}

      {/* What's in this circle: dots and counts, no box, as the depth tracker */}
      {members.length > 0 && (
        <div title={`Click anyone for their circle${ready > 0 && canScan ? ', or someone ready to scan theirs' : ''} · drag to move · scroll to zoom`}
          style={{
            position: 'absolute', bottom: 18, left: 18, maxWidth: 'calc(100% - 110px)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px',
            fontSize: 10.5, color: 'var(--sd-fg-3, #aab)', textShadow: HALO_TEXT,
          }}>
          {byTier.map(([t, n]) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLORS[t], boxShadow: `0 0 6px ${TIER_COLORS[t]}66` }} />
              <span style={{ color: TIER_COLORS[t], fontWeight: 700 }}>{t}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('en-US')}</span>
            </span>
          ))}
          {added > 0 && <span><span style={{ color: GREEN }}>●</span> you added {added}{ready ? `, ${ready} ready to scan` : ''}{hidden ? `, ${hidden} hidden` : ''}</span>}
          {asked > 0 && <span><span style={{ color: 'var(--sd-gold, #FFD700)' }}>◌</span> {asked} {asked === 1 ? 'request' : 'requests'} out</span>}
        </div>
      )}

      <ZoomButtons onIn={() => zoomBy(1.35)} onReset={() => setViewSet(null)} onOut={() => zoomBy(1 / 1.35)} />
    </>
  );
}

// Words over the map without a box: a soft halo in the theme's background (lib/themes.js).
const HALO_TEXT = '0 0 3px var(--sd-bg), 0 0 6px var(--sd-bg), 0 0 1px var(--sd-bg)';

// A link's cluster draws at most this many of their people; the count beside it is the whole circle.
const LINK_DOTS = 290;
// The middle of a cluster, where its first ring starts, and a link's own dot inside one.
const LINK_HUB = 5;
const LINK_INNER = 15;
const KID_DOT = 4.6;
const CLUSTER = { inner: LINK_INNER, outer: Infinity, spacing: 7.5, minSpacing: 7.5 };

/**
 * A cluster as two paths per tier, however many people: the dots, and a line
 * from the middle of the cluster out to each of them.
 */
function clusterPaths(cluster) {
  const paths = {};
  cluster.points.forEach((pt, i) => {
    const tier = cluster.people[i]?.tier || 'D';
    const q = tier === 'S' ? 3.1 : tier === 'A' ? 2.8 : 2.5;
    const len = Math.hypot(pt.x, pt.y) || 1;
    const at = (paths[tier] ||= { dots: '', spokes: '' });
    at.dots += `M${(pt.x - q).toFixed(1)},${pt.y.toFixed(1)}a${q},${q} 0 1,0 ${2 * q},0a${q},${q} 0 1,0 ${-2 * q},0`;
    at.spokes += `M${((pt.x / len) * LINK_HUB).toFixed(1)},${((pt.y / len) * LINK_HUB).toFixed(1)}L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  });
  return Object.entries(paths);
}

/** The lines of a dot's tooltip. `toScan`: a click goes to the Scan page with them picked. */
function tipFor(row, f, scanningId, depth, toScan) {
  const first = firstName(row);
  const status = row.id === scanningId ? 'Their circle is being scanned now'
    : f.reached === 'ready' ? 'You added them · their circle is ready to scan'
    : f.reached === 'hidden' ? 'You added them · their list is hidden'
    : f.reached === 'scanned' ? `You added them · ${f.own.toLocaleString('en-US')} in their circle`
    : f.requested ? 'Request sent'
    : 'Not connected yet';
  const next = toScan ? `Click to scan ${first}’s circle on the Scan page`
    : f.own > 0 ? `Click to open ${first}’s circle (${ordinal(depth + 2)} degree)` : `Click to open ${first}’s circle`;
  return [row.name, `${row.tier}-tier · ${score(row).toFixed(1)}`, status, next];
}

/** A tooltip in screen space, above the point, kept inside the window. */
function Tip({ x, y, w, lines, accent }) {
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

/**
 * An empty circle, and why: nobody's in it until you're connected and it's
 * been scanned, so say which of those is missing and what gets it.
 */
function EmptyCircle({ person, depth, reach, requests, scanning, canScan, onSelect, top }) {
  const first = firstName(person);
  const next = ordinal(depth + 1);
  const yours = person.degree === 1;
  const state = yours ? circleState(person, reach) : null;
  // Read partway with nothing saved yet (everyone on those pages was already
  // yours): that isn't a list that has been read, so it says it stopped, with
  // the card's Resume (Blake, 2026-10-03: "the ones they stopped and would like
  // to resume"). Where it stopped is the card's own answer, asked of the server
  // (GET /api/scraper?resume=<id>): the map's scan notes don't say how far a
  // list got. Undefined while it's asked.
  const stopped = useStoppedAt(state === 'scanned' && !scanning ? person.id : null);
  // Why Resume didn't start, kept here: a start greys this to "Scanning…" for a
  // moment even when it's refused, and the button's own state would go with it.
  const [problem, setProblem] = useState(null);
  if (state === 'scanned' && !scanning && stopped === undefined) return null;   // never "has been read" by mistake
  const cost = circleScanCost();
  let title;
  let body;
  let action = null;
  if (scanning) {
    title = `Scanning ${first}’s circle now`;
    body = 'Their people appear here as the scan saves them, every 10 pages.';
  } else if (stopped) {
    title = `${first}’s scan stopped partway`;
    body = `${stoppedLine(stopped)}. Everyone on those pages was already one of your connections, so nobody new is here yet. Resume carries on from page ${stopped.nextPage}.`;
    if (canScan) action = <ResumeHere person={person} stopped={stopped} problem={problem} setProblem={setProblem} />;
  } else if (state === 'hidden') {
    title = `${first} keeps their connections hidden`;
    body = 'LinkedIn doesn’t show their list, so there is no circle to scan.';
  } else if (state === 'scanned') {
    title = `${first}’s list has been read`;
    body = 'Everyone on it was already one of your connections, so nobody new is here.';
  } else if (yours) {
    title = `${first}’s circle isn’t scanned yet`;
    body = `${first} is your connection, so their circle can be scanned. That brings in the people they know: ${next} degree${depth > 1 ? ', counted along this chain' : ''}.`;
    if (canScan) {
      action = (
        <>
          <Link href={scanPageFor(person)} style={primary}>Scan {first}’s circle →</Link>
          <div style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #888)', marginTop: 8 }}>
            {cost.profileViews} profile view, then one LinkedIn search per page of their list (up to {cost.searches}, about {cost.minutes} min).
            It starts only once you confirm it on the Scan page.
          </div>
        </>
      );
    }
  } else if (hasRequest(person, requests)) {
    title = `Request sent to ${first}`;
    body = `Once ${first} accepts, ↻ Check for new brings them into your connections. Then their circle can be scanned, and the people they know fill in here: ${next} degree.`;
  } else {
    title = `Nobody from ${first}’s circle yet`;
    body = `LinkedIn only shows the connections of people you’re connected to. Connect with ${first}; once they accept and their circle is scanned, the people they know fill in here: ${next} degree.`;
    action = <button type="button" onClick={() => onSelect?.(person)} style={secondary}>Open {first}’s card</button>;
  }
  return (
    <div role="status" style={{
      position: 'absolute', left: '50%', top, transform: 'translateX(-50%)', width: 'min(360px, calc(100% - 32px))',
      background: 'color-mix(in srgb, var(--sd-bg) 94%, transparent)', border: `1px solid ${state === 'hidden' ? 'rgba(var(--sd-ink, 255, 255, 255), 0.12)' : stopped && !scanning ? 'rgba(255,215,0,0.4)' : 'rgba(0,255,136,0.25)'}`,
      borderRadius: 12, padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: state === 'hidden' ? 'var(--sd-fg-3, #aaa)' : 'var(--sd-fg-1, #fff)', marginBottom: 6 }}>
        {state === 'hidden' && <span aria-hidden="true">🔒 </span>}{title}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #9aa)', lineHeight: 1.55, marginBottom: action ? 12 : 0 }}>{body}</div>
      {action}
    </div>
  );
}

/**
 * Where Resume would carry on with one of your connections ({ nextPage,
 * pagesRead }), null when there's nothing to carry on with, undefined while
 * it's asked; and never asked for null. Asked again whenever `id` comes back,
 * as it does when a scan of theirs ends.
 */
function useStoppedAt(id) {
  const [got, setGot] = useState({ id: null, resume: undefined });
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    resumePoint(id).then((r) => { if (live) setGot({ id, resume: r }); }, () => { if (live) setGot({ id, resume: null }); });
    return () => { live = false; };
  }, [id]);
  if (!id) return null;
  return got.id === id ? got.resume : undefined;
}

/**
 * Resume for a circle that stopped partway, from the map: what the card's
 * Resume does (Sidebar.js CreateClusterCard), the same check first, carrying on
 * from the page it stopped at, never page 1 again. Once it starts, the empty
 * circle says it's being scanned. Greyed out, saying why, while another scan runs.
 */
function ResumeHere({ person, stopped, problem, setProblem }) {
  const busy = useSyncExternalStore(watchScanner, () => busyReason(scannerNow()), () => null);
  const [checking, setChecking] = useState(false);
  async function go() {
    setProblem(null);
    setChecking(true);
    const blocked = notReadyMessage(await scraperStatus().catch(() => null));
    setChecking(false);
    if (blocked) {
      setProblem(`${blocked} Open the Scan page to finish setting the scanner up.`);
      return;
    }
    try {
      await beginScrape('resume', { id: person.id });
    } catch (e) {
      setProblem(e.message || 'Could not start the scan.');
    }
  }
  const off = Boolean(busy) || checking;
  return (
    <>
      <button type="button" onClick={go} disabled={off} style={{
        ...primary, border: 'none', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.45 : 1,
      }}>Resume from page {stopped.nextPage}</button>
      {(busy || problem) && (
        <div style={{ fontSize: 10.5, color: problem ? '#ff8080' : 'var(--sd-fg-3, #888)', marginTop: 8 }}>
          {problem || `${busy}. One scan at a time: this one can start when it finishes.`}
        </div>
      )}
    </>
  );
}

const crumb = { background: 'none', border: 'none', color: '#8fb8d6', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 };
const dismiss = { background: 'none', border: 'none', color: 'var(--sd-fg-3, #999)', fontSize: 15, lineHeight: 1, cursor: 'pointer', padding: '0 2px' };
const note = {
  fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid', background: 'rgba(var(--sd-shade, 0, 0, 0), 0.6)', pointerEvents: 'auto',
};
const primary = {
  display: 'inline-block', padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 12.5, fontWeight: 800,
  color: '#0a0a1a', background: 'linear-gradient(135deg, #00ff88, #3498DB)',
};
const secondary = {
  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
  border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-1, #ddd)',
};
