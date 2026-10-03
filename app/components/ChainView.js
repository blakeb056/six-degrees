'use client';

// Bridge Chains: your bridges round you. Click one for their circle, and any
// dot in it for that person's circle in turn, as far as your scans reach.
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
import { reachIndex, reachState, circleState, readyByCircle, circleScanCost, scanBars } from '../../lib/reach';
import { reachSegments, RING } from '../../lib/dot-rings';
import { ringLayout, chainTree, dotRadius, previewBand, tierBandLayout, circleActivity } from '../../lib/chain-layout';
import { noteCircle } from '../../lib/notifications';
import { useUser } from './UserProvider';
import { redundancy } from '../../lib/brokerage';
import { keyFor, score } from '../../lib/separation';
import { hasRequest } from '../../lib/requests-client';
import { watchScanner, scannerNow, isCircleScan } from '../../lib/scraper-client';
import useRequests from './useRequests';
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
  const [hovered, setHovered] = useState(null);
  // The overview's zoom: null until it's changed, which means "fit" (homeZoom below).
  const [zoomSet, setZoom] = useState(null);
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
  // The inner ring holds the circles with the most going on (lib/chain-layout.js
  // circleActivity): notifications about them, people in them ready to scan,
  // clusters formed from them since. The biggest first among the rest.
  const activity = circleActivity(bridges, { notes, ready: readyCount, chained });
  const roots = bridges.filter((b) => !linked(b))
    .sort((a, b) => activity.get(b.id).score - activity.get(a.id).score);
  // Bridges round you: one ring while they fit, more once there are many, each
  // ring far enough from the last for the names under it.
  const bridgeLayout = ringLayout(roots.length, {
    inner: maxR * 0.55, innerMin: maxR * 0.4, outer: maxR * 0.62, spacing: 46, minSpacing: 20, ringGap: 62,
  });
  const bridgePos = roots.map((b, i) => {
    const p = bridgeLayout.points[i];
    return { ...b, x: cx + p.x, y: cy + p.y, angle: p.angle, clusterSize: (bridgeMap[b.id] || []).length, chains: chained.get(b.id) || 0, activity: activity.get(b.id) };
  });
  // More than one ring: the counts under each name wait for a hover.
  const crowded = bridgeLayout.rings.length > 1;
  // Where a hovered circle is previewed, and the zoom at which that still fits the window.
  const band = previewBand(maxR, bridgeLayout.rings);
  const homeZoom = Math.max(0.6, Math.min(1.3, Math.min(cx, cy) / (band.outer + 8)));
  const zoom = zoomSet ?? homeZoom;

  // Touch rotary dial on the overview: drag a finger round the circle to pick a bridge.
  const bridgeAnglesRef = useRef([]);
  useEffect(() => {
    bridgeAnglesRef.current = bridgePos.map((b) => ({ id: b.id, angle: b.angle }));
  });
  const lastTouchRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || focused) return undefined;

    const findNearest = (touchX, touchY) => {
      const rect = el.getBoundingClientRect();
      const tx = touchX - rect.left;
      const ty = touchY - rect.top;
      const touchAngle = Math.atan2(ty - dims.h / 2, tx - dims.w / 2);
      let nearest = null;
      let nearestDist = Infinity;
      bridgeAnglesRef.current.forEach(b => {
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
  }, [dims, zoom, focused]);

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

  // === OVERVIEW: all bridges, click to open one ===
  const totalD2 = degree2.length;
  const d2S = degree2.filter(d => d.tier === 'S').length;
  const d2A = degree2.filter(d => d.tier === 'A').length;
  const hovBridge = hovered ? bridgePos.find(b => b.id === hovered) : null;

  return (
    <div ref={containerRef} style={{ flex: 1, background: 'var(--sd-page)', position: 'relative', overflow: 'hidden' }}>
      <svg width={dims.w} height={dims.h}>
      <g transform={`translate(${cx * (1 - zoom)}, ${cy * (1 - zoom)}) scale(${zoom})`}>
        {/* A guide line for every ring of bridges */}
        {bridgeLayout.rings.map((ring) => (
          <circle key={'ring-' + ring.radius} cx={cx} cy={cy} r={ring.radius} fill="none" stroke={`${DEGREE_COLORS[1]}10`} strokeWidth={1} />
        ))}

        {/* Their circle, previewed on hover, in a wedge that grows rows as it fills */}
        {hovBridge && (
          <CirclePreview bridge={hovBridge} members={membersOf(hovBridge, index)} reach={reach}
            cx={cx} cy={cy} maxR={maxR} still={still} band={band} />
        )}

        {/* Bridge nodes — hover to preview their circle, click to open it */}
        {bridgePos.map(b => {
          const isHov = hovered === b.id;
          const sCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'S').length;
          const aCount = (bridgeMap[b.id] || []).filter(d => d.tier === 'A').length;
          const ready = readyCount.get(b.id) || 0;
          return (
            <g key={'b-' + b.id}
              onClick={() => { setHovered(null); setPath([b.id]); }}
              onMouseEnter={() => setHovered(b.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}>
              <title>{bridgeTitle(b, ready, scanBars(b, reach))}</title>
              {/* Glow */}
              <circle cx={b.x} cy={b.y} r={isHov ? 21 : 18} fill={`${TIER_COLORS[b.tier]}${isHov ? '14' : '08'}`} />
              {/* The ring, tight on the dot: one bar for each person you added through
                  this circle. Orange: scanned since, with a cluster of their own.
                  Green: ready for a scan. Nobody yet: one faint line. */}
              <g transform={`translate(${b.x} ${b.y})`} pointerEvents="none">
                {b.chains + ready === 0 && (
                  <circle r={(isHov ? 13 : 11) + 3.6} fill="none" stroke={RING.empty} strokeWidth={1} />
                )}
                {reachSegments((isHov ? 13 : 11) + 3.6, { formed: b.chains, ready }).map((seg, i) => (
                  <path key={i} d={seg.d} fill="none" strokeLinecap="round" strokeWidth={2}
                    stroke={seg.kind === 'ready' ? GREEN : DEGREE_COLORS[2]} />
                ))}
              </g>
              {/* Node */}
              <circle cx={b.x} cy={b.y} r={isHov ? 13 : 11}
                fill={localPhoto(b.profile_image_url) ? '#1a1a2e' : TIER_COLORS[b.tier]}
                stroke={isHov ? '#fff' : TIER_COLORS[b.tier]}
                strokeWidth={isHov ? 2.5 : 2} />
              {/* Photo */}
              {localPhoto(b.profile_image_url) && (
                <>
                  <clipPath id={'bc-' + b.id}><circle cx={b.x} cy={b.y} r={isHov ? 11 : 9} /></clipPath>
                  <image href={localPhoto(b.profile_image_url)} x={b.x - (isHov ? 11 : 9)} y={b.y - (isHov ? 11 : 9)}
                    width={isHov ? 22 : 18} height={isHov ? 22 : 18} clipPath={`url(#bc-${b.id})`} />
                </>
              )}
              {!localPhoto(b.profile_image_url) && (
                <text x={b.x} y={b.y + 4} textAnchor="middle" fill={b.tier === 'S' ? '#000' : '#fff'}
                  fontSize={11} fontWeight={700}>{b.name?.charAt(0)}</text>
              )}
              {/* How many in their circle are waiting for a scan: a small outlined number, top right */}
              {ready > 0 && (
                <g pointerEvents="none">
                  <circle cx={b.x + 14} cy={b.y - 14} r={6} fill="var(--sd-bg)" stroke={GREEN} strokeWidth={1.2} />
                  <text x={b.x + 14} y={b.y - 11.4} textAnchor="middle" fill={GREEN} fontSize={ready > 9 ? 6 : 7} fontWeight={800}>{ready > 99 ? '99+' : ready}</text>
                </g>
              )}
              {/* Name + count */}
              <text x={b.x} y={b.y + (isHov ? 24 : 22)} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={600}>
                {b.name?.split(' ')[0]}
              </text>
              {(!crowded || isHov) && (
                <text x={b.x} y={b.y + (isHov ? 34 : 32)} textAnchor="middle" fill={isHov ? '#bbb' : '#888'} fontSize={7}>
                  {b.clusterSize} · {sCount > 0 ? sCount + 'S ' : ''}{aCount > 0 ? aCount + 'A' : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* Center: YOU */}
        <circle cx={cx} cy={cy} r={22} fill="var(--sd-bg)" stroke="#FFD700" strokeWidth={3} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#FFD700" fontSize={11} fontWeight={800}>
          {userName?.split(' ')[0] || 'YOU'}
        </text>
      </g>
      </svg>

      {/* Zoom controls, clear of the Galaxy switch below them */}
      <ZoomButtons
        onIn={() => setZoom(z => Math.min(3, (z ?? homeZoom) + 0.3))}
        onReset={() => setZoom(null)}
        onOut={() => setZoom(z => Math.max(0.4, (z ?? homeZoom) - 0.3))}
      />

      {/* Depth tracker */}
      <div style={{
        position: 'absolute', bottom: 16, left: 12,
        background: 'rgba(0,0,0,0.75)', borderRadius: 10, padding: '10px 14px',
        backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.06)',
        maxWidth: 'calc(100vw - 80px)',
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: 1.5, marginBottom: 8 }}>DEGREES OF SEPARATION</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6].map(d => (
            <div key={d} style={{ textAlign: 'center' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: d <= 2 ? DEGREE_COLORS[d] : 'rgba(255,255,255,0.04)',
                color: d <= 2 ? '#000' : '#333',
                border: d <= 2 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: d <= 2 ? `0 0 6px ${DEGREE_COLORS[d]}30` : 'none',
              }}>D{d}</div>
              <div style={{ fontSize: 7, color: d <= 2 ? '#aaa' : '#333', marginTop: 3 }}>
                {d === 1 ? connections.length : d === 2 ? totalD2 : '—'}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#555', marginTop: 8 }}>
          {roots.length} bridges{bridges.length > roots.length ? ` + ${bridges.length - roots.length} along their chains` : ''} · {d2S} S + {d2A} A at 2nd degree
        </div>
        {twoWays > 0 && (
          <div style={{ fontSize: 9, color: '#555', marginTop: 4 }}
            title="The share of everyone you reach through a circle that more than one of your connections reaches">
            {Math.round(twoWays * 100)}% of your 2nd degree you reach two or more ways
          </div>
        )}
        <div style={{ fontSize: 8, color: '#444', marginTop: 4 }}>Click a bridge to open their circle, then anyone in it to open theirs</div>
      </div>
    </div>
  );
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
function CirclePreview({ bridge, members, reach, cx, cy, maxR, still, band }) {
  const shown = members.filter((m) => m.degree === 1 || m.tier === 'S' || m.tier === 'A' || m.tier === 'B');
  // Beyond every ring of bridges (lib/chain-layout.js previewBand).
  const { inner, outer } = band;
  const sweep = Math.min(Math.PI * 0.9, Math.max(Math.PI * 0.2, (shown.length * 11) / inner));
  const layout = ringLayout(shown.length, {
    inner, outer, spacing: 11, minSpacing: 3.5, start: bridge.angle - sweep / 2, sweep,
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={inner} fill="none" stroke={`${DEGREE_COLORS[2]}06`} strokeWidth={1} />
      {shown.map((d2, j) => {
        const p = layout.points[j];
        const x2 = cx + p.x;
        const y2 = cy + p.y;
        const state = reachState(d2, reach);
        const nr = Math.min(dotRadius(layout.spacing, d2.tier), 5) * (state ? 1.3 : 1);
        const color = state === 'hidden' ? HIDDEN : TIER_COLORS[d2.tier] || '#555';
        return (
          <g key={'pv-' + d2.id}>
            {(state || shown.length <= 40) && (
              <line x1={bridge.x} y1={bridge.y} x2={x2} y2={y2}
                stroke={state ? GREEN : color} strokeWidth={0.5} strokeOpacity={state ? 0.35 : 0.15} />
            )}
            {state === 'ready' && <Halo x={x2} y={y2} r={nr * 2.3} still={still} />}
            <circle cx={x2} cy={y2} r={nr}
              fill={color} fillOpacity={state ? 0.95 : 0.45}
              stroke={state && state !== 'hidden' ? GREEN : color} strokeWidth={state ? 1 : 0.5} strokeOpacity={state ? 1 : 0.25} />
            {(d2.tier === 'S' || state) && shown.length <= 60 && (
              <text x={x2} y={y2 + nr + 9} textAnchor="middle" fill={state && state !== 'hidden' ? GREEN : '#aaa'} fontSize={7}>
                {firstName(d2)}
              </text>
            )}
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
      <rect x={-2.6} y={-0.7} width={5.2} height={3.9} rx={0.8} fill="#d6d6de" />
    </g>
  );
}

function ZoomButtons({ onIn, onReset, onOut }) {
  const round = (dim) => ({
    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: dim ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)', color: dim ? '#666' : '#fff',
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
            <circle cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={f.reached ? 1 : 0.85}
              stroke={f.reached && f.reached !== 'hidden' ? GREEN : 'none'} strokeWidth={f.reached ? Math.max(0.8, r * 0.3) : 0} />
          )}
          {f.reached === 'hidden' && <Lock x={p.x} y={p.y - r * 0.1} s={r / 4.2} />}
          {row.id === scanningId && (
            <circle cx={p.x} cy={p.y} r={r * 2} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1 / k} strokeDasharray={`${3 / k} ${2 / k}`} />
          )}
          {(f.reached || (roomy && row.tier === 'S')) && (
            <text x={p.x} y={above ? p.y - r - 4 / k : p.y + r + 10 / k} textAnchor="middle" fontSize={8.5 / k} fontWeight={f.reached ? 700 : 400}
              fill={f.reached === 'hidden' ? '#999' : f.reached ? GREEN : '#aaa'} pointerEvents="none"
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
              stroke={TIER_COLORS[band.tier] || '#555'} strokeOpacity={0.07}
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
                  <path key={'s' + tier} d={spokes} fill="none" stroke={TIER_COLORS[tier] || '#555'}
                    strokeWidth={0.7} strokeOpacity={lit ? 0.6 : 0.38} />
                ))}
                {clusterPaths(c).map(([tier, { dots: d }]) => (
                  <path key={tier} d={d} fill={TIER_COLORS[tier] || '#555'} fillOpacity={lit ? 1 : 0.9} />
                ))}
                <circle r={LINK_HUB} fill={color} stroke={hovLink === j ? '#fff' : 'var(--sd-bg)'} strokeWidth={1.5} />
                {row.id === scanningId && (
                  <circle r={c.radius + 4} fill="none" stroke={DEGREE_COLORS[3]} strokeWidth={1 / k} strokeDasharray={`${3 / k} ${2 / k}`} />
                )}
                <text y={c.radius + 12 / k} textAnchor="middle" fill="#fff" fontSize={10 / k} fontWeight={700}
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
                  <circle cx={o.x} cy={o.y} r={o.r} fill={TIER_COLORS[link.row.tier] || '#555'} stroke={GREEN} strokeWidth={1.4} />
                )}
              </g>
            );
          })}
          {/* The one under the pointer, on top */}
          {hp && (
            <>
              <line x1={0} y1={0} x2={hp.x} y2={hp.y} stroke={TIER_COLORS[hovered.tier] || '#888'} strokeWidth={1.6 / k} strokeOpacity={0.8} />
              <circle cx={hp.x} cy={hp.y} r={dotRadius(layout.spacing, hovered.tier) * (facts[hover].reached ? 1.4 : 1) + 2 / k}
                fill="none" stroke="#fff" strokeWidth={1.6 / k} />
            </>
          )}
          {/* The person in the middle, with the halo if their own circle is ready to scan */}
          {reachState(person, reach) === 'ready' && <Halo x={0} y={0} r={40} still={still} />}
          <circle r={28} fill="var(--sd-bg)" stroke={TIER_COLORS[person.tier] || '#888'} strokeWidth={hover === 'center' ? 4 : 3} filter="url(#focusGlow)" />
          {localPhoto(person.profile_image_url) ? (
            <>
              <clipPath id="focus-clip"><circle r={24} /></clipPath>
              <image href={localPhoto(person.profile_image_url)} x={-24} y={-24} width={48} height={48} clipPath="url(#focus-clip)" />
            </>
          ) : (
            <text y={5} textAnchor="middle" fill={TIER_COLORS[person.tier] || '#888'} fontSize={16} fontWeight={800}>
              {person.name?.charAt(0)}
            </text>
          )}
          <text y={40} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700} pointerEvents="none">{person.name}</text>
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
            background: 'rgba(255,255,255,0.1)', color: '#ddd', fontSize: 12, fontWeight: 700,
          }}>
            ← {depth === 1 ? 'All bridges' : `${firstName(trail[depth - 2])}’s circle`}
          </button>
          <nav aria-label="Trail" style={{ fontSize: 11, color: '#777', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => onBack(0)} style={crumb}>All bridges</button>
            {trail.map((row, i) => (
              <span key={row.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span aria-hidden="true">›</span>
                {i === depth - 1
                  ? <span style={{ color: '#fff', fontWeight: 700 }}>{row.name}</span>
                  : <button type="button" onClick={() => onBack(i + 1)} style={crumb}>{row.name}</button>}
              </span>
            ))}
          </nav>
        </div>
        <div style={{ fontSize: 11, color: '#999' }}>
          {firstName(person)}’s circle · {members.length.toLocaleString('en-US')} {members.length === 1 ? 'person' : 'people'}
          {' · '}{ordinal(depth + 1)} degree{depth > 1 ? ', counted along this chain' : ''}
        </div>
        {scanningThem && members.length > 0 && (
          <div role="status" style={{ ...note, borderColor: 'rgba(52,152,219,0.4)', color: '#cfe6f7' }}>
            Scanning {firstName(person)}’s circle now. More people appear here as it saves, every 10 pages.
          </div>
        )}
      </div>

      {members.length === 0 && (
        <EmptyCircle person={person} depth={depth} reach={reach} requests={requests}
          scanning={scanningThem} canScan={canScan} onSelect={onSelect} top={cy + 64} />
      )}

      {/* What's in this circle */}
      {members.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20, maxWidth: 'calc(100% - 110px)',
          background: 'rgba(0,0,0,0.75)', borderRadius: 10, padding: '10px 14px',
          backdropFilter: 'blur(8px)', fontSize: 10, color: '#888', lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 6 }}>IN THIS CIRCLE</div>
          {byTier.map(([t, n]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: TIER_COLORS[t] }} />
              <span style={{ color: TIER_COLORS[t], fontWeight: 600, width: 40 }}>{t}-Tier</span>
              <span>{n.toLocaleString('en-US')}</span>
            </div>
          ))}
          {(added > 0 || asked > 0) && (
            <div style={{ marginTop: 6 }}>
              {added > 0 && <div><span style={{ color: GREEN }}>● </span>you added {added}{ready ? `, ${ready} ready to scan` : ''}{hidden ? `, ${hidden} hidden` : ''}</div>}
              {asked > 0 && <div><span style={{ color: '#FFD700' }}>◌ </span>{asked} {asked === 1 ? 'request' : 'requests'} out</div>}
            </div>
          )}
          <div style={{ marginTop: 6, color: '#555' }}>
            Click anyone for their circle{ready > 0 && canScan ? ', or someone ready to scan theirs' : ''} · drag to move · scroll to zoom
          </div>
        </div>
      )}

      <ZoomButtons onIn={() => zoomBy(1.35)} onReset={() => setViewSet(null)} onOut={() => zoomBy(1 / 1.35)} />
    </>
  );
}

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
      <rect x={left} y={top} width={width} height={height} rx={6} fill="rgba(0,0,0,0.92)" stroke={accent || '#555'} strokeWidth={0.6} />
      {lines.map((line, i) => (
        <text key={i} x={left + width / 2} y={top + 16 + i * 12} textAnchor="middle"
          fill={i === 0 ? '#fff' : i === 2 ? accent || '#aaa' : '#999'} fontSize={i === 0 ? 10.5 : 9} fontWeight={i === 0 ? 700 : 400}>
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
  const cost = circleScanCost();
  let title;
  let body;
  let action = null;
  if (scanning) {
    title = `Scanning ${first}’s circle now`;
    body = 'Their people appear here as the scan saves them, every 10 pages.';
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
          <div style={{ fontSize: 10.5, color: '#888', marginTop: 8 }}>
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
      background: 'color-mix(in srgb, var(--sd-bg) 94%, transparent)', border: `1px solid ${state === 'hidden' ? 'rgba(255,255,255,0.12)' : 'rgba(0,255,136,0.25)'}`,
      borderRadius: 12, padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: state === 'hidden' ? '#aaa' : '#fff', marginBottom: 6 }}>
        {state === 'hidden' && <span aria-hidden="true">🔒 </span>}{title}
      </div>
      <div style={{ fontSize: 11.5, color: '#9aa', lineHeight: 1.55, marginBottom: action ? 12 : 0 }}>{body}</div>
      {action}
    </div>
  );
}

const crumb = { background: 'none', border: 'none', color: '#8fb8d6', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 };
const note = {
  fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid', background: 'rgba(0,0,0,0.6)', pointerEvents: 'auto',
};
const primary = {
  display: 'inline-block', padding: '9px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 12.5, fontWeight: 800,
  color: '#0a0a1a', background: 'linear-gradient(135deg, #00ff88, #3498DB)',
};
const secondary = {
  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
  border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#ddd',
};
