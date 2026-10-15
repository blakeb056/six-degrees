'use client';

// Sixgree's own browser, from the page's side (lib/linkedin-panel.js). In the
// desktop app with a scanner or the LinkedIn browser plugin installed,
// LinkedIn shows in a panel of the window (desktop/main.mjs), under the
// header, so the tabs, the notch and the scan light stay in sight and in use
// (Blake, 2026-10-15: "I want it embedded in the sixgree screen with maybe the
// top ui tab visible with the notch").
//
// The panel is drawn by the shell, over the page; the page says where it
// starts, what it keeps clear (the LinkedIn browser's people list on the
// right, a banner at the bottom), and when it shows. While it shows, a thin
// bar under the header says what LinkedIn is doing there, with Back to
// Sixgree. Hidden, a small Show LinkedIn brings it back while a scan runs or
// on Outlink. Hiding never stops a scan: its page keeps working out of sight.
//
// Nothing of Sixgree's is ever under it (Blake, 2026-10-15: "I want the top
// tabs and the UI to not be cut off"):
//   - where it starts is measured below the whole header (its tabs, which
//     wrap to a second row on a narrow window) and the notch, again on every
//     resize, zoom, page, notch change and once a second while it shows, and
//     the bar keeps beside or under the notch, never over a tab
//     (lib/linkedin-panel.js panelLayout);
//   - anything that opens over it (the bell's list, the scan light's
//     briefing, the notch opened, Auto scan's panel, a note under a header
//     button: usePanelCover) swaps it for a still picture of itself, drawn
//     here under what's open, until that closes (desktop/lib.mjs createPanelCover);
//   - choosing a page or a tab (the header's, the notch's) puts it away, so
//     the page you chose is what you see.
//
// It comes forward by itself when the scanner needs it in front (LinkedIn
// needs you, signing in, a manual read, Outlink opening a profile) and goes
// back when that's done, unless it was Outlink's profile, which stays for you.
// Outside the desktop app (npm, a plain browser) there is no panel and this
// draws nothing.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import useScanner from './useScanner';
import { panelWanted, panelLayout, PANEL_BAR, BROWSER_SIDEBAR } from '../../lib/linkedin-panel';
import { watchPanelCover, panelCoveredNow, notCovered } from '../../lib/panel-cover';
import { useLinkedInPanel, showLinkedInPanel, panelBridge as bridge, panelNow, openLinkedInSection, LINKEDIN_SECTION_TABS } from './linkedInPanelState';
import { PeopleSidebar } from './LinkedInBrowser';
import { ProfileSteps, endProfileSteps } from './OpenProfile';

export { useLinkedInPanel, showLinkedInPanel };

const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
};

export default function LinkedInPanel() {
  const panel = useLinkedInPanel();
  const job = useScanner();
  const pathname = usePathname();
  const want = panelWanted(job);
  const shownByJob = useRef(false);   // brought forward by the job, not by you
  const wanted = useRef(false);
  const action = useRef(null);
  const [layout, setLayout] = useState({ barTop: 0, top: PANEL_BAR, words: 0 });
  const [bottom, setBottom] = useState(0);
  const [still, setStill] = useState(null);   // { n, src }: the panel's picture, while something is over it
  const covered = useSyncExternalStore(watchPanelCover, panelCoveredNow, notCovered);

  const available = Boolean(panel?.available);
  const visible = Boolean(panel?.visible);
  const browsing = visible && panel?.mode === 'browse';

  // Forward when the job wants it, back when it's through.
  useEffect(() => {
    const b = bridge();
    if (!b || !available) return;
    if (want) action.current = job.action;
    if (want && !wanted.current) {
      shownByJob.current = !panelNow()?.visible;
      b.show();
    } else if (!want && wanted.current && shownByJob.current) {
      shownByJob.current = false;
      // Outlink's profile stays in front: it's what you opened it for.
      if (action.current !== 'outlink') b.hide();
    }
    wanted.current = want;
  }, [want, job.action, available]);

  // Where the bar and the panel go, and what the panel keeps clear: measured
  // under the whole header, the notch at rest, and any banner along the bottom.
  const sidebar = browsing ? BROWSER_SIDEBAR : 0;
  const restingNotch = useRef(null);
  const sent = useRef('');
  useLayoutEffect(() => {
    const b = bridge();
    if (!b || !available) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const notchEl = document.querySelector('[data-notch]');
      let notch = null;
      if (notchEl && !notchEl.hasAttribute('data-tucked')) {
        // Opened, the notch is over the panel's still picture: the panel keeps to the notch at rest.
        if (notchEl.hasAttribute('data-notch-open') && restingNotch.current) notch = restingNotch.current;
        else notch = restingNotch.current = rectOf(notchEl);
      } else {
        notch = rectOf(document.querySelector('[data-notch-pill]'));
      }
      const next = panelLayout({
        width: window.innerWidth,
        header: rectOf(document.querySelector('header')),
        tabs: rectOf(document.getElementById('main-tabs')),
        notch,
      });
      const banner = rectOf(document.querySelector('[data-stale-banner]'));
      const under = banner ? Math.max(0, Math.ceil(window.innerHeight - banner.top)) : 0;
      setLayout((was) => (was.top === next.top && was.barTop === next.barTop && was.words === next.words ? was : next));
      setBottom(under);
      const place = { top: next.top, right: sidebar, bottom: under };
      const key = JSON.stringify(place);
      if (key !== sent.current) {
        sent.current = key;
        if (typeof b.place === 'function') b.place(place);
        else b.setTop(next.top);
      }
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    sent.current = '';
    measure();
    const seen = new ResizeObserver(later);
    const watched = new Set();
    const observe = () => {
      for (const el of [document.querySelector('header'), document.getElementById('main-tabs'), document.querySelector('[data-notch]'),
        document.querySelector('[data-notch-pill]'), document.querySelector('[data-stale-banner]')]) {
        if (el && !watched.has(el)) { watched.add(el); seen.observe(el); }
      }
    };
    observe();
    // The header swapped for the next page's, the notch tucked, opened or gone, a banner come.
    const changes = new MutationObserver(() => { observe(); later(); });
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tucked', 'data-notch-open'] });
    // A resize, and a zoom (View → Zoom In changes the page's width in CSS pixels, so it arrives as one).
    window.addEventListener('resize', later);
    // A safety net while it shows: anything that moved without a resize (the notch sliding in).
    const tick = visible ? setInterval(later, 1000) : 0;
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', later);
      clearInterval(tick);
    };
  }, [available, visible, pathname, sidebar]);

  // Something open over the panel: the shell swaps it for its still picture.
  useEffect(() => {
    const b = bridge();
    if (!b || !available || typeof b.cover !== 'function') return;
    b.cover(covered);
  }, [covered, available]);
  useEffect(() => {
    const b = bridge();
    if (!b || !available || typeof b.onStill !== 'function') return undefined;
    return b.onStill((s) => setStill(s?.src ? s : null));
  }, [available]);

  // Choosing a page puts it away, so the page you chose is what you see. Also
  // a click on the header's tabs and links, or the notch's tabs (the same page,
  // another view). Not the LinkedIn button, nor anything that opens over it.
  // The LinkedIn tab is the exception: it is where LinkedIn shows, and its notch
  // buttons choose the section (app/linkedin/page.js).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    endProfileSteps();
    if (panelNow()?.visible && pathname !== LINKEDIN_TAB) bridge()?.hide();
  }, [pathname]);
  useEffect(() => {
    if (!available) return undefined;
    const onClick = (e) => {
      if (!panelNow()?.visible) return;
      const hit = e.target?.closest?.('header a[href], header .sd-tab, [data-notch] [role="tab"]');
      if (!hit || hit.closest('.sd-auto, [data-linkedin-button]')) return;
      if (hit.getAttribute('href') === LINKEDIN_TAB) return;
      if (lastPath.current === LINKEDIN_TAB && hit.closest('[data-notch]')) return;
      shownByJob.current = false;
      bridge()?.hide();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [available]);

  if (!available) return null;
  const b = bridge();
  const { barTop, top, words } = layout;

  if (!visible) {
    // Something to go back to: LinkedIn's open there, and a scan runs or you're on Outlink.
    if (!panel.linkedin || !(job.running || pathname === '/queue')) return null;
    return (
      <button type="button" onClick={() => b.show()} title="Show LinkedIn in Sixgree's own browser" style={{ ...PILL, top: `calc(${barTop || 0}px + 10px)` }}>
        <Dot /> Show LinkedIn
      </button>
    );
  }

  // On the LinkedIn tab: which section, and the way back to it once you've gone elsewhere.
  const section = panel.mode === 'section' ? LINKEDIN_SECTION_TABS.find((t) => t.key === panel.section) : null;
  const strayed = Boolean(section && panel.at !== section.key);
  const say = job.running && job.needsYou ? sentence(job.needsYou)
    : job.running && job.action === 'outlink' ? `Opening ${job.target?.name ? `${job.target.name}’s` : 'their'} profile. Sixgree clicks nothing on it.`
    : job.running ? 'A scan is using it. Going back doesn’t stop it.'
    : browsing ? 'Your own LinkedIn, browsed by you. Sixgree reads nothing on its own.'
    : section ? `Your LinkedIn ${section.label.toLowerCase()}, live. Sixgree reads nothing on it.`
    : 'Your own LinkedIn, inside Sixgree.';
  return (
    <>
      {/* The panel's still picture, where the panel is, while something is open over it. The
          header is lifted over it, so what opens from the header shows whole. */}
      {/* The header over everything of LinkedIn's: the panel's still picture and the people list. */}
      <style>{'header{position:relative;z-index:101}'}</style>
      {still && (
        <>
          <img data-panel-still="" alt="" src={still.src} draggable={false}
            onLoad={() => requestAnimationFrame(() => b.stillDrawn?.(still.n))}
            style={{ position: 'fixed', top, left: 0, width: `calc(100vw - ${sidebar}px)`, height: `calc(100vh - ${top + bottom}px)`, zIndex: 58, objectFit: 'fill', pointerEvents: 'auto', userSelect: 'none' }} />
        </>
      )}
      <div role="region" aria-label="LinkedIn in Sixgree" data-linkedin-bar="" style={{ ...BAR_STYLE, top: barTop }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, maxWidth: words || undefined, overflow: 'hidden' }}>
          <Dot gold={Boolean(job.running && job.needsYou)} />
          <b style={{ color: 'var(--sd-fg-1, #fff)', flexShrink: 0 }}>LinkedIn</b>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={say}>{say}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {strayed && (
            <button type="button" data-section-back="" onClick={() => openLinkedInSection(section.key)} style={{ ...BACK, background: '#0A66C2', borderColor: '#0A66C2' }}
              title={`You’ve left LinkedIn’s ${section.label.toLowerCase()}: back to it`}>
              Back to {section.label}
            </button>
          )}
          <ProfileSteps buttonStyle={BACK} />
          <button type="button" onClick={() => { shownByJob.current = false; endProfileSteps(); b.hide(); }} style={BACK}>Back to Sixgree</button>
        </span>
      </div>
      {browsing && <PeopleSidebar top={top} bottom={bottom} width={BROWSER_SIDEBAR} profile={panel.profile} />}
    </>
  );
}

/** The LinkedIn tab's page (app/linkedin/page.js). */
const LINKEDIN_TAB = '/linkedin';

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function Dot({ gold = false }) {
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: gold ? 'var(--sd-gold, #FFD700)' : '#0A66C2' }} />;
}

const BAR_STYLE = {
  position: 'fixed', left: 0, right: 0, height: PANEL_BAR, zIndex: 59, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', fontSize: 12.5,
  // Solid: the page under it never shows through.
  background: 'var(--sd-bg, #0a0a12)', backgroundImage: 'linear-gradient(var(--sd-surface, rgba(8,10,22,0.96)), var(--sd-surface, rgba(8,10,22,0.96)))',
  color: 'var(--sd-fg-2, #cfd8d8)',
  borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)',
};

const BACK = {
  flexShrink: 0, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit', fontWeight: 700,
  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
};

const PILL = {
  position: 'fixed', right: 16, zIndex: 61, display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 11px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
};
