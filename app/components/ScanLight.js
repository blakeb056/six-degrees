'use client';

// The scan light: a small light at the header's top right, beside Settings,
// that says what a running scan needs from you without reading a log or
// hearing a chime (Blake, 2026-10-14: "if they have sound turned off and need
// to know when the system is ready to go to the next page so it could be green
// yellow and red"). Scanning by hand: green, click Next; yellow, it's reading
// or waiting for you to scroll; red, don't click yet, go back, or stopped. A
// scan that runs by itself: green while it reads, yellow while it rests, red
// once it has stopped. The words and the colour come from lib/scan-light.js,
// which reads the scanner's own lines.
//
// Each colour has its own shape too (an arrow, three dots, a square) and its
// words in the tooltip and for a screen reader, so it never says anything by
// colour alone. By hand, a change to green pulses once, gently, and not at all
// with Reduce Motion.
//
// Click it for the panel: by hand, the instruction in large type, whose list
// and which page, people found and the last few lines; by itself, a briefing
// that updates as it goes: whose circle, page N of about M, people found this
// run, their ring's fill, today's searches, about how long is left, and Stop.
// Esc or a click outside closes it.
//
// It reads the job answer every Scan button and the notch already share
// (useScanner, lib/scraper-client.js), so it adds no asking of its own. Shown
// only while a scan runs, Auto scan rests between sittings, or for
// LIGHT_LINGER_MS after a scan ends.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import useScanner from './useScanner';
import { stopScrape } from '../../lib/scraper-client';
import { stopAutoScan } from '../../lib/experimental-client';
import { scanLight, endedLight, lightLabel, timeLeftText, LIGHT_LINGER_MS, LIGHT_WORDS } from '../../lib/scan-light';

// The light's colours, the theme's own where it has them (Daylight's are deeper, to read on white).
const COLOR = {
  green: 'var(--sd-green, #00ff88)',
  yellow: 'var(--sd-gold, #FFD700)',
  red: 'var(--sd-red, #ff6b6b)',
};

const CSS = `
@keyframes scan-light-pulse { 0% { box-shadow: 0 0 0 0 var(--scan-light-ring); } 100% { box-shadow: 0 0 0 9px transparent; } }
.scan-light-ring { display: block; border-radius: 50%; }
@media (prefers-reduced-motion: no-preference) {
  .scan-light-ring.is-new-green { animation: scan-light-pulse 0.9s ease-out 2; }
  .scan-light-panel { animation: notch-in 0.18s ease-out; }
}`;

// Read by a screen reader, not drawn.
const UNSEEN = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

/** The light's shape for its colour: an arrow (go on), three dots (working), a square (hold on). */
function Shape({ color, size }) {
  const fill = COLOR[color];
  const shape = LIGHT_WORDS[color]?.shape;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block' }}>
      <circle cx="8" cy="8" r="7.5" fill={fill} opacity="0.22" />
      {shape === 'arrow' && <path d="M5 4.2 11.6 8 5 11.8Z" fill={fill} />}
      {shape === 'dots' && [4.5, 8, 11.5].map((x) => <circle key={x} cx={x} cy="8" r="1.5" fill={fill} />)}
      {shape === 'square' && <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2" fill={fill} />}
    </svg>
  );
}

/** The ring round a dot, as far as this run has read it: the read part, then the unknown band (lib/reach.js scanFill). */
function FillRing({ fill, size = 34 }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const read = Math.max(0, Math.min(1, fill.read));
  const unknown = Math.max(0, Math.min(1 - read, fill.unknown || 0));
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.1)" strokeWidth="4" />
      {unknown > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(var(--sd-ink, 255, 255, 255), 0.28)" strokeWidth="4"
          strokeDasharray={`${unknown * c} ${c}`} strokeDashoffset={-read * c} />
      )}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sd-green, #00ff88)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${read * c} ${c}`} />
    </svg>
  );
}

/** One line of the panel: a label and its value. */
function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5, lineHeight: 1.45 }}>
      <span style={{ width: 92, flexShrink: 0, color: 'var(--sd-fg-4, #8b9a9a)' }}>{label}</span>
      <span style={{ color: 'var(--sd-fg-1, #fff)', minWidth: 0 }}>{children}</span>
    </div>
  );
}

const n = (v) => Number(v).toLocaleString('en-US');

export default function ScanLight({ isMobile = false }) {
  const job = useScanner();
  const [opened, setOpen] = useState(false);
  // Stop pressed: for which job (its start time), or 'auto' for Auto scan between sittings.
  const [stopFor, setStopFor] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [at, setAt] = useState(null);   // where the panel hangs: under the button, kept in the window

  // The light for this answer: worked out once per answer, which changes every
  // 1.5 s while a scan runs, so the time left moves on with it.
  const live = useMemo(() => scanLight(job), [job]);

  // What it follows from one answer to the next, kept as each answer comes in
  // (while drawing, as React has it for state that follows a prop):
  //   run     the last light a running scan showed, and whose scan it was;
  //   ending  that scan's end, shown for LIGHT_LINGER_MS once the answer says it's over;
  //   color   the colour last shown, and `pulse`, how many times it has turned green;
  //   said    what a screen reader was last told.
  const [seen, setSeen] = useState({ job: null, run: null, ending: null, color: null, pulse: 0, sayKey: '', said: '' });
  if (seen.job !== job) {
    let { run, ending } = seen;
    if (live.color && job.running) {
      run = { light: live, startedAt: job.startedAt };
      ending = null;
    } else if (run && !live.color) {
      // How it ended, from the job answer's `recent`: a job this page watched end.
      const ended = run.startedAt != null ? (job.recent || []).find((j) => j?.startedAt === run.startedAt) : null;
      if (ended) ending = endedLight(ended, run.light);
      run = null;
    }
    const light = live.color ? live : ending;
    const color = light?.color || null;
    // By hand, each new instruction is said; otherwise only a change of colour,
    // so a scan that runs by itself isn't read out page by page.
    const sayKey = color ? `${color}|${light.mode === 'manual' ? light.headline : ''}` : '';
    setSeen({
      job, run, ending, color,
      // A change to green pulses the light once (not with Reduce Motion), and only by
      // hand, where green means "click Next": a scan that runs by itself turns green
      // at every page it reads, and nothing is asked of you then.
      pulse: color === 'green' && light.mode === 'manual' && seen.color && seen.color !== 'green' ? seen.pulse + 1 : seen.pulse,
      sayKey,
      said: sayKey === seen.sayKey ? seen.said : color ? `${LIGHT_WORDS[color].word}: ${light.headline}` : '',
    });
  }
  // The end shown, then gone.
  useEffect(() => {
    if (!seen.ending) return undefined;
    const timer = setTimeout(() => setSeen((was) => ({ ...was, ending: null })), LIGHT_LINGER_MS);
    return () => clearTimeout(timer);
  }, [seen.ending]);

  const light = live.color ? live : seen.ending;
  const color = light?.color || null;
  // Gone with the scan: nothing left to open.
  const open = opened && Boolean(color);
  const resting = !job.running && job.auto?.on === true;
  const stopping = stopFor != null && (resting ? stopFor === 'auto' : job.running && stopFor === job.startedAt);

  // Esc closes it, the focus back on the light; a click anywhere else closes it.
  // It hangs under the light, measured as it opens and as the window changes.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(340, window.innerWidth - 24);
      setAt({ top: Math.round(r.bottom + 8), left: Math.round(Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))), width });
    };
    const frame = requestAnimationFrame(place);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [open]);

  if (!color) return null;
  const label = lightLabel(light);
  const s = light.stats || {};
  const manual = light.mode === 'manual';
  const size = isMobile ? 28 : 32;
  const pulsing = color === 'green' && manual && seen.pulse > 0;
  // The scanner's last few lines, less the one already said in full above.
  const said = (light.detail || '').toLowerCase();
  const lines = (s.lines || []).filter((l) => l.replace(/^LinkedIn needs you: |^\((?:waiting: )?|\)$/g, '').toLowerCase() !== said).slice(-4);

  const stop = async () => {
    setStopFor(resting ? 'auto' : job.startedAt);
    try {
      // Between Auto scan's sittings nothing runs: Stop ends Auto scan itself.
      if (resting) await stopAutoScan();
      else await stopScrape();
    } catch {
      setStopFor(null);
    }
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }} data-scan-light={color}>
      <style>{CSS}</style>
      <button
        ref={btnRef} type="button"
        className="scan-light"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Scan light. ${label}. ${open ? 'Close' : 'Open'} what the scan is doing`}
        title={label}
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)',
          border: `1px solid color-mix(in srgb, ${COLOR[color]} 55%, transparent)`,
        }}
      >
        {/* Drawn afresh each time it turns green, so the pulse plays once each time */}
        <span key={seen.pulse} className={pulsing ? 'scan-light-ring is-new-green' : 'scan-light-ring'} style={{ '--scan-light-ring': COLOR[color] }}>
          <Shape color={color} size={isMobile ? 16 : 18} />
        </span>
      </button>
      <span role="status" aria-live="polite" style={UNSEEN}>{seen.said}</span>
      {/* On the page itself, not in the header: the header's frosted glass would
          hold it under the notch, and blur nothing behind it. */}
      {open && at && createPortal((
        <div
          ref={panelRef} role="dialog" aria-label="What the scan is doing" data-glass-panel="pop" className="scan-light-panel"
          style={{
            position: 'fixed', top: at.top, left: at.left, width: at.width, zIndex: 100,
            maxHeight: 'calc(100vh - 90px)', overflowY: 'auto',
            background: 'var(--sd-surface, rgba(8,10,22,0.96))', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.12)',
            borderRadius: 14, padding: 16, color: 'var(--sd-fg-2, #cfd8d8)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ marginTop: 3 }}><Shape color={color} size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: COLOR[color] }}>
                {LIGHT_WORDS[color].word} · {manual ? 'Scanning by hand' : resting ? 'Auto scan' : s.sitting ? 'Auto scan' : 'Scanning'}
              </div>
              <div data-scan-light-headline="" style={{ fontSize: manual ? 21 : 17, fontWeight: 800, lineHeight: 1.25, color: 'var(--sd-fg-1, #fff)', marginTop: 2 }}>
                {light.headline}
              </div>
              {light.detail && <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4 }}>{light.detail}</div>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {s.who && <Row label={manual ? 'List' : 'Circle'}>{`${s.who}'s connections`}{s.batch?.total ? ` · ${s.batch.current} of ${s.batch.total}` : ''}</Row>}
            {s.page != null && (
              <Row label="Page">
                {s.page}{!manual && s.pages ? ` of about ${s.pages}` : ''}
                {manual && s.lastRead && s.lastRead !== s.page ? ` · read up to ${s.lastRead}` : ''}
              </Row>
            )}
            {s.pagesRead > 0 && (
              <Row label={manual ? 'People found' : 'Found this run'}>
                {n(s.found)} {s.found === 1 ? 'person' : 'people'}{s.foundInList != null && s.foundInList !== s.found ? ` · ${n(s.foundInList)} in this list` : ''}
              </Row>
            )}
            {!manual && s.fill && (
              <Row label="Their ring">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <FillRing fill={s.fill} size={28} />
                  <span style={{ color: 'var(--sd-fg-2, #cfd8d8)' }}>{sentenceCase(s.fill.words)}</span>
                </span>
              </Row>
            )}
            {s.searches && (
              <Row label="Searches today">
                {s.searches.limit != null
                  ? `${n(s.searches.used)} of ${n(s.searches.limit)} used, ${n(s.searches.left)} left${s.searches.dev ? ' (Dev mode’s ceiling)' : ''}`
                  : `${n(s.searches.used)} used, no daily limit this session`}
              </Row>
            )}
            {!manual && (s.secondsLeft != null || s.wait) && (
              <Row label={resting ? 'Next sitting' : 'Time left'}>
                {resting ? (s.secondsLeft ? timeLeftText(s.secondsLeft).replace(/ left$/, '') : 'soon') : timeLeftText(s.secondsLeft) || `this rest: ${s.wait}`}
                {!resting && s.secondsLeft != null && s.pages ? ' on this list' : ''}
              </Row>
            )}
          </div>

          {manual && lines.length > 0 && (
            <ol aria-label="The scanner's last lines" style={{
              listStyle: 'none', margin: 0, padding: '8px 10px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 3,
              background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, lineHeight: 1.4,
              color: 'var(--sd-fg-3, #8b9a9a)',
            }}>
              {lines.map((l, i) => <li key={`${i}-${l}`} style={{ overflowWrap: 'anywhere' }}>{l}</li>)}
            </ol>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/setup" onClick={() => setOpen(false)} style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontSize: 12.5 }}>Details</Link>
            <span style={{ flex: 1 }} />
            {(job.running || resting) && !light.ended && (
              <button
                type="button" onClick={stop} disabled={stopping}
                title={resting ? 'Stop Auto scan: no more sittings until you start it again' : 'Stops after saving what’s been read; Resume on the Scan page carries on from the same page'}
                style={{
                  padding: '5px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: stopping ? 'default' : 'pointer', font: 'inherit',
                  background: 'rgba(255,107,107,0.12)', color: 'var(--sd-red, #ff8a8a)', border: '1px solid rgba(255,107,107,0.4)',
                }}
              >{stopping ? 'Stopping…' : resting ? 'Stop Auto scan' : 'Stop'}</button>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

const sentenceCase = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
