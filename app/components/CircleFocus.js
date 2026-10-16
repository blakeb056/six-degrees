'use client';

// One of your connections, in front of Network Circle (Blake, 2026-10-16: "show
// the network circle kind of blurred, and then show their circle with the
// scanned dots and also catalysts from them who's been scanned so it shows the
// full chain ... If they don't have anything scanned then it will be more
// subtle with the blur in place but showing just the core and telling them to
// scan the circle or making it easy to back out of this").
//
// The Galaxy (ForceGraph.js) zooms and blurs its own layer behind this and
// says where the dot was; this draws only what comes forward: their circle as
// rings round them (lib/circle-focus.js focusLayout), each catalyst's circle chained
// on outward, and you, off to the side the map has you on. Or, with nothing
// scanned, just them and a Scan button. Esc, a click outside, Back, or
// scrolling or pinching out closes it (lib/circle-focus.js).

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import useScanner from './useScanner';
import { degreeName } from '../../lib/galaxy';
import { FOCUS_IN_MS, FOCUS_OUT_MS, FADE_MS, focusLayout, wheelOut, pinchOut } from '../../lib/circle-focus';
import { startHere, scansCircleOf, queuedFor, willQueue, busyReason } from '../../lib/scraper-client';
import { MAP_LOOK } from '../../lib/themes';

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
@media (prefers-reduced-motion: reduce) { .cf-ring { animation: none; } .cf-dot { transition: none; } }`;

export default function CircleFocus({ focus, phase, box, origin, you, look, ease, reduced, tierColors, selectedId, onSelect, onClose, canScan }) {
  const open = phase === 'open';
  const dur = reduced ? FADE_MS : open ? FOCUS_IN_MS : FOCUS_OUT_MS;
  const { person, kind } = focus;
  const backRef = useRef(null);
  const tipRef = useRef(null);
  const wheel = useRef(null);
  const pinch = useRef(0);

  // The keyboard goes to Back once it's open, so Return or Space closes it too.
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
  const two = (e) => (e.touches.length === 2 ? Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) : 0);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${person.name}’s circle`}
      onWheel={(e) => { wheel.current = wheelOut(wheel.current, e, performance.now()); if (wheel.current.out) onClose(); }}
      onTouchStart={(e) => { pinch.current = two(e); }}
      onTouchMove={(e) => { if (pinchOut(pinch.current, two(e))) { pinch.current = 0; onClose(); } }}
      style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: phase === 'out' ? 'none' : 'auto', fontFamily: 'var(--sd-font)' }}>
      <style>{CSS}</style>
      {/* The map behind, dimmed: a click on it goes back. */}
      <div onClick={onClose} aria-hidden="true" style={{
        position: 'absolute', inset: 0, background: `rgba(var(--sd-shade, 0, 0, 0), ${look.dim})`,
        opacity: open ? 1 : 0, transition: `opacity ${dur}ms ease-out`,
      }} />
      <div style={stage}>
        {kind === 'circle'
          ? <FocusMap focus={focus} box={box} origin={origin} you={you} tierColors={tierColors} selectedId={selectedId} onSelect={onSelect} tipRef={tipRef} />
          : <FocusCore person={person} box={box} tierColors={tierColors} canScan={canScan} onClose={onClose} />}
      </div>
      <TopBar backRef={backRef} onClose={onClose} open={open} dur={dur} />
      <div style={{
        position: 'absolute', bottom: 14, left: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        pointerEvents: 'none', opacity: open ? 1 : 0, transition: `opacity ${dur}ms ease-out`,
      }}>
        {kind === 'circle' && <Chain focus={focus} />}
        {kind === 'circle' && <Counts focus={focus} />}
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

/** Back, top left; how else to go back, top right. */
function TopBar({ backRef, onClose, open, dur }) {
  return (
    <div style={{
      position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 10,
      opacity: open ? 1 : 0, transition: `opacity ${dur}ms ease-out`, pointerEvents: 'none',
    }}>
      <button ref={backRef} type="button" className="cf-btn" onClick={onClose} aria-label="Back to the map" style={{
        pointerEvents: 'auto', color: 'var(--sd-fg-1, #fff)', background: 'var(--sd-surface, rgba(10,15,30,0.85))',
        border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
      }}>
        ← Back
      </button>
      <span style={{
        marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 11.5,
        color: 'var(--sd-fg-3, #999)', background: 'var(--sd-surface, rgba(10,15,30,0.7))',
      }}>Esc or scroll out to go back</span>
    </div>
  );
}

/** The chain this is: you, them, their circle, its catalysts, and the people past them. */
function Chain({ focus }) {
  const { person, kind, circle, catalysts, beyond } = focus;
  const pill = (text, tone) => (
    <span style={{
      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap',
      color: tone || 'var(--sd-fg-1, #fff)', background: 'var(--sd-surface, rgba(10,15,30,0.8))',
      border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
    }}>{text}</span>
  );
  const steps = [pill('You'), pill(person.name)];
  if (kind === 'circle') {
    steps.push(pill(`${circle.toLocaleString('en-US')} in their circle`));
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

/** Under the circle: how many at each ring, and what the marks mean. */
function Counts({ focus }) {
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
    </div>
  );
}

/**
 * Their circle, sharp: them in the middle, their people round them, each
 * catalyst's people fanning out behind the catalyst, and you off to the side
 * the map has you on, so it reads you → them → their people → the catalyst's.
 */
function FocusMap({ focus, box, origin, you, tierColors, selectedId, onSelect, tipRef }) {
  // Room above for Back, and below for the chain and the counts.
  const size = Math.max(220, Math.min(box.width - 120, box.height - 200));
  const layout = useMemo(() => focusLayout(focus.rings, size), [focus.rings, size]);
  const half = size / 2;
  const k = size / 640;
  const catalysts = useMemo(() => new Map(focus.catalysts.map((c) => [c.row.id, c])), [focus.catalysts]);
  // Every dot once, in ring order, so a dot's data-i finds it; and where each ring starts in that list.
  const items = useMemo(() => layout.rings.flatMap((ring) => ring.items.map((it) => ({ ...it, ring }))), [layout]);
  const starts = useMemo(() => {
    const out = [];
    let n = 0;
    for (const ring of layout.rings) { out.push(n); n += ring.items.length; }
    return out;
  }, [layout]);
  const at = useMemo(() => new Map(items.map((it) => [it.row.id, it])), [items]);
  // You, just outside the rings, the way the map has you from them.
  const toYou = you ? Math.atan2(you.y - origin.y, you.x - origin.x) : Math.PI / 2;
  const youAt = { x: half + (half + 2) * Math.cos(toYou), y: half + (half + 2) * Math.sin(toYou) };
  const youLeft = Math.cos(toYou) < -0.2;   // named on the side away from the circle
  // The chain: them to each catalyst they lead to, and each catalyst to the next.
  const chain = focus.catalysts.map((c) => {
    const it = at.get(c.row.id);
    if (!it) return null;
    const up = at.get(it.parentId);
    return { id: c.row.id, x1: up ? up.x : half, y1: up ? up.y : half, x2: it.x, y2: it.y };
  }).filter(Boolean);

  const tip = (e, it) => {
    const el = tipRef.current;
    if (!el) return;
    if (!it) { el.style.display = 'none'; return; }
    const r = it.row;
    const c = catalysts.get(r.id);
    const lines = [
      [r.company, r.role].filter(Boolean).join(' · ') || r.headline || '',
      `${r.tier || 'D'} tier${r.power_score != null && r.power_score !== '' ? ` · ${Number(r.power_score).toFixed(1)}` : ''}`,
      c ? `Catalyst: ${c.people.toLocaleString('en-US')} more through them` : it.state === 'connected' ? 'You added them' : it.state === 'requested' ? 'Request sent' : '',
    ].filter(Boolean);
    // Text, never markup: names come from the network file.
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
  };
  const itemOf = (e) => items[Number(e.target?.dataset?.i)] ?? null;
  // Someone you added, or a catalyst: a size up from the rest of their ring.
  const big = (ring) => Math.max(ring.dotR + 2, ring.dotR * 1.45);

  return (
    <div style={{ position: 'absolute', left: -half, top: -half, width: size, height: size, pointerEvents: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible" role="img"
        aria-label={`${focus.person.name}’s circle: ${focus.totals.people.toLocaleString('en-US')} people in ${focus.rings.length} ${focus.rings.length === 1 ? 'ring' : 'rings'}`}
        style={{ display: 'block', overflow: 'visible' }}>
        {/* A click inside the circle stays in it; only the dimmed map outside goes back. */}
        <circle cx={half} cy={half} r={half + 4} fill="transparent" pointerEvents="all" />
        <line x1={youAt.x} y1={youAt.y} x2={half} y2={half} stroke={MAP_LOOK.you} strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="3 4" />
        {layout.rings.map((ring, i) => (
          <g key={ring.degree} className="cf-ring" style={{ animationDelay: `${140 + i * 110}ms` }}>
            <circle cx={half} cy={half} r={ring.mid} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.09)" strokeWidth={Math.max(1, ring.edge - ring.radius + 2 * ring.dotR)} strokeOpacity={0.5} />
            <text x={half} y={half - ring.edge - Math.max(ring.dotR, 3) - 6} textAnchor="middle" fontSize={11} fontWeight={700}
              fill="var(--sd-fg-4, #777)">{degreeName(ring.degree)}</text>
          </g>
        ))}
        <g className="cf-ring" style={{ animationDelay: '200ms' }}>
          {layout.spokes.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={GREEN} strokeOpacity={0.35} strokeWidth={1} />
          ))}
          {chain.map((l) => (
            <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={GREEN} strokeOpacity={0.55} strokeWidth={1.4} />
          ))}
        </g>
        <g pointerEvents="visiblePainted" onPointerOver={(e) => tip(e, itemOf(e))} onPointerMove={(e) => tip(e, itemOf(e))} onPointerOut={(e) => tip(e, null)}
          onClick={(e) => { const it = itemOf(e); if (!it) return; e.stopPropagation(); onSelect?.(it.row); }}>
          {layout.rings.map((ring, i) => (
            <g key={ring.degree} className="cf-ring" style={{ animationDelay: `${180 + i * 110}ms` }}>
              {ring.items.map((it, j) => (
                <Dot key={it.key} it={it} i={starts[i] + j} r={it.state === 'connected' || catalysts.has(it.row.id) ? big(ring) : ring.dotR}
                  colour={tierColors[it.row.tier] || '#8899aa'} picked={it.row.id === selectedId} catalyst={catalysts.has(it.row.id)} />
              ))}
            </g>
          ))}
        </g>
        {/* Catalysts by name: whose circle the next ring out is. */}
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
        <circle cx={youAt.x} cy={youAt.y} r={7} fill={MAP_LOOK.you} stroke="#FFD700" strokeWidth={2} />
        <text x={youAt.x + (youLeft ? -12 : 12)} y={youAt.y + 4} textAnchor={youLeft ? 'end' : 'start'} fontSize={12} fontWeight={800}
          fill="var(--sd-fg-1, #fff)" paintOrder="stroke" stroke="rgba(var(--sd-shade, 0, 0, 0), 0.6)" strokeWidth={3}>You</text>
      </svg>
      {/* Them, in the middle: their face, or their initials. */}
      <div style={{ position: 'absolute', left: half, top: half, transform: 'translate(-50%, -50%)', pointerEvents: 'none', ...FACE }}>
        <Avatar person={focus.person} size={Math.round(Math.max(34, 46 * k))} tierColors={tierColors} />
      </div>
      <div style={{
        position: 'absolute', left: half, top: half + Math.max(34, 46 * k) / 2 + 8, transform: 'translateX(-50%)',
        textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--sd-fg-1, #fff)', textShadow: HALO }}>{focus.person.name}</div>
      </div>
    </div>
  );
}

function Dot({ it, i, r, colour, picked, catalyst }) {
  const common = { 'data-i': i, className: 'cf-dot' };
  if (it.state === 'requested') {
    return <circle {...common} cx={it.x} cy={it.y} r={r * 1.25} fill="transparent" stroke={colour}
      strokeWidth={Math.max(0.8, r * 0.45)} strokeDasharray={`${Math.max(1, r * 0.55)} ${Math.max(0.8, r * 0.45)}`} />;
  }
  return <circle {...common} cx={it.x} cy={it.y} r={r} fill={colour}
    stroke={picked ? 'var(--sd-fg-1, #fff)' : it.state === 'connected' || catalyst ? GREEN : 'none'}
    strokeWidth={picked ? 2.4 : Math.max(1, r * 0.3)} />;
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
