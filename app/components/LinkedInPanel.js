'use client';

// Sixgree's own browser, from the page's side (lib/linkedin-panel.js). In the
// desktop app with a scanner installed, LinkedIn shows in a panel of the
// window (desktop/main.mjs), under the header, so the tabs, the notch and the
// scan light stay in sight and in use (Blake, 2026-10-15: "I want it embedded
// in the sixgree screen with maybe the top ui tab visible with the notch").
//
// The panel is drawn by the shell, over the page; the page only says where it
// starts and when it shows. While it shows, a thin bar under the header says
// what LinkedIn is doing there, with Back to Sixgree. Hidden, a small Show
// LinkedIn brings it back while a scan runs or on Outlink. Hiding never stops
// a scan: its page keeps working out of sight.
//
// It comes forward by itself when the scanner needs it in front (LinkedIn
// needs you, signing in, a manual read, Outlink opening a profile) and goes
// back when that's done, unless it was Outlink's profile, which stays for you.
// Outside the desktop app (npm, a plain browser) there is no panel and this
// draws nothing.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import useScanner from './useScanner';
import { panelWanted } from '../../lib/linkedin-panel';

const bridge = () => (typeof window !== 'undefined' ? window.sixgreeDesktop?.linkedinPanel ?? null : null);

// The panel's state from the shell ({ available, visible, linkedin }), shared by
// everything on the page that asks: null outside the desktop app, or until it answers.
let state = null;
const listeners = new Set();
let watching = null;
function publish(next) {
  state = next;
  for (const l of listeners) l();
}
function watchPanel(listener) {
  listeners.add(listener);
  const b = bridge();
  if (b && !watching) {
    watching = b.onState(publish);
    b.state().then(publish).catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watching) {
      watching();
      watching = null;
    }
  };
}
const panelNow = () => state;
const none = () => null;

/** { available, visible, linkedin } in the desktop app with the panel; null otherwise. */
export function useLinkedInPanel() {
  return useSyncExternalStore(watchPanel, panelNow, none);
}

/** Bring the panel forward (Outlink's profile, say). False when there is none. */
export function showLinkedInPanel() {
  const b = bridge();
  if (!b || !state?.available) return false;
  b.show();
  return true;
}

const BAR = 40;

/** The bottom of the page's header (or 0 with none), in CSS pixels. */
function headerBottom() {
  const header = document.querySelector('header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

export default function LinkedInPanel() {
  const panel = useLinkedInPanel();
  const job = useScanner();
  const pathname = usePathname();
  const want = panelWanted(job);
  const shownByJob = useRef(false);   // brought forward by the job, not by you
  const wanted = useRef(false);
  const action = useRef(null);
  const [top, setTop] = useState(0);

  // Forward when the job wants it, back when it's through.
  useEffect(() => {
    const b = bridge();
    if (!b || !panel?.available) return;
    if (want) action.current = job.action;
    if (want && !wanted.current) {
      shownByJob.current = true;
      b.show();
    } else if (!want && wanted.current && shownByJob.current) {
      shownByJob.current = false;
      // Outlink's profile stays in front: it's what you opened it for.
      if (action.current !== 'outlink') b.hide();
    }
    wanted.current = want;
  }, [want, job.action, panel?.available]);

  // Where the panel starts: under this bar, and under the notch when that hangs lower.
  const visible = Boolean(panel?.visible);
  const available = Boolean(panel?.available);
  useLayoutEffect(() => {
    const b = bridge();
    if (!b || !available) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const from = headerBottom();
        setTop(from);
        if (!visible) return;
        const notch = document.querySelector('[data-notch]:not([data-tucked])');
        const notchBottom = notch ? notch.getBoundingClientRect().bottom + 4 : 0;
        b.setTop(Math.max(from + BAR, notchBottom));
      });
    };
    measure();
    const seen = new ResizeObserver(measure);
    for (const el of [document.querySelector('header'), document.querySelector('[data-notch]'), document.body]) if (el) seen.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [available, visible, pathname]);

  if (!panel?.available) return null;
  const b = bridge();

  if (!visible) {
    // Something to go back to: LinkedIn's open there, and a scan runs or you're on Outlink.
    if (!panel.linkedin || !(job.running || pathname === '/queue')) return null;
    return (
      <button type="button" onClick={() => b.show()} title="Show LinkedIn in Sixgree's own browser" style={{ ...PILL, top: `calc(${top || 0}px + 10px)` }}>
        <Dot /> Show LinkedIn
      </button>
    );
  }

  const say = job.running && job.needsYou ? sentence(job.needsYou)
    : job.running && job.action === 'outlink' ? `Opening ${job.target?.name ? `${job.target.name}’s` : 'their'} profile. Sixgree clicks nothing on it.`
    : job.running ? 'A scan is using it. Going back doesn’t stop it.'
    : 'Your own LinkedIn, inside Sixgree.';
  return (
    <div role="region" aria-label="LinkedIn in Sixgree" style={{ ...BAR_STYLE, top }}>
      <Dot gold={Boolean(job.running && job.needsYou)} />
      <b style={{ color: 'var(--sd-fg-1, #fff)' }}>LinkedIn</b>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{say}</span>
      <button type="button" onClick={() => { shownByJob.current = false; b.hide(); }} style={BACK}>Back to Sixgree</button>
    </div>
  );
}

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function Dot({ gold = false }) {
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: gold ? 'var(--sd-gold, #FFD700)' : '#0A66C2' }} />;
}

const BAR_STYLE = {
  position: 'fixed', left: 0, right: 0, height: BAR, zIndex: 59, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', fontSize: 12.5,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-2, #cfd8d8)',
  borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)',
};

const BACK = {
  marginLeft: 'auto', flexShrink: 0, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit', fontWeight: 700,
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
};

const PILL = {
  position: 'fixed', right: 16, zIndex: 61, display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 11px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
};
