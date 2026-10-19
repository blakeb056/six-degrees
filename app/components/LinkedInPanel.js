'use client';

// Sixgree's own browser, from the page's side (lib/linkedin-panel.js). In the
// desktop app with a scanner or the LinkedIn browser plugin installed,
// LinkedIn shows in a panel of the window (desktop/main.mjs), under the
// header, so the tabs, the notch and the scan light stay in sight and in use
// (Blake, 2026-10-15: "I want it embedded in the sixgree screen with maybe the
// top ui tab visible with the notch").
//
// The panel is drawn by the shell, over the page; the page says where it
// starts, what it keeps clear (a banner at the bottom), and when it shows.
// While it shows, a thin bar under the header has Back and Forward (Blake,
// 2026-10-15: "I want to use my blue and yellow buttons since they are
// familiar as the buttons for that": the map's round blue and yellow edge
// buttons; Cmd+[ and Cmd+] too, desktop/main.mjs), says what
// LinkedIn is doing there, and has Back to Sixgree. Hidden, a small Show
// LinkedIn brings it back while a scan runs. Hiding never stops
// a scan: its page keeps working out of sight.
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
// needs you, signing in, a manual read) and goes back when that's done, and
// when a profile link is pressed anywhere in the app (OpenProfile.js), which
// stays for you until you press Connect there: once LinkedIn says "Invitation
// sent", the request is marked sent, the panel goes back to where you were
// (Separation, Bridge Chains, Breach) and "Request sent to X" shows for a
// moment (Blake, 2026-10-16; desktop/main.mjs inviteSent).
// Outside the desktop app (npm, a plain browser) there is no panel and this
// draws nothing.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import useScanner from './useScanner';
import { panelWanted, panelLayout, scanHoldsPanel, inviteSentAction, INVITE_NOTE_MS, PANEL_BAR } from '../../lib/linkedin-panel';
import { markRequested, hasRequest } from '../../lib/requests-client';
import { logInteraction } from '../../lib/learning-client';
import { scannerNow } from '../../lib/scraper-client';
import { watchPanelCover, panelCoveredNow, notCovered } from '../../lib/panel-cover';
import {
  useLinkedInPanel, showLinkedInPanel, panelBridge as bridge, panelNow, openLinkedInSection, panelBack, panelForward, LINKEDIN_SECTION_TABS,
  panelPersonFor,
} from './linkedInPanelState';

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
  const [layout, setLayout] = useState({ barTop: 0, top: PANEL_BAR, words: 0 });
  const [bottom, setBottom] = useState(0);
  const [still, setStill] = useState(null);   // { n, src }: the panel's picture, while something is over it
  const [sentNote, setSentNote] = useState(null);   // "Request sent to X", for a moment
  const covered = useSyncExternalStore(watchPanelCover, panelCoveredNow, notCovered);

  const available = Boolean(panel?.available);
  const visible = Boolean(panel?.visible);

  // Forward when the job wants it, back when it's through.
  useEffect(() => {
    const b = bridge();
    if (!b || !available) return;
    if (want && !wanted.current) {
      shownByJob.current = !panelNow()?.visible;
      b.show();
    } else if (!want && wanted.current && shownByJob.current) {
      shownByJob.current = false;
      b.hide();
    }
    wanted.current = want;
  }, [want, available]);

  // Where the bar and the panel go, and what the panel keeps clear: measured
  // under the whole header, the notch at rest, and any banner along the bottom.
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
      const place = { top: next.top, bottom: under };
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
  }, [available, visible, pathname]);

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

  // "Invitation sent" on the profile a link opened (desktop/main.mjs inviteSent): the
  // request marked sent as Connect marks it (lib/linkedin-panel.js inviteSentAction), the
  // panel put away so you're back where you were, and "Request sent to X" for a moment.
  // Not while a scan drives the panel: Auto marks its own.
  useEffect(() => {
    const b = bridge();
    if (!b || !available || typeof b.onInviteSent !== 'function') return undefined;
    let timer = 0;
    const off = b.onInviteSent((info) => {
      const act = inviteSentAction(info, { job: scannerNow(), panel: panelNow(), person: panelPersonFor(info?.slug) });
      if (!act) return;
      // The learning log: LinkedIn's "Invitation sent" seen in the panel (Auto's are logged by the server).
      logInteraction('invite-detected', act.mark, { outcome: 'invitation sent', route: 'panel' });
      if (!hasRequest(act.mark)) markRequested(act.mark, { bridgeId: act.bridgeId, route: 'panel' }).catch(() => {});
      shownByJob.current = false;
      b.hide();
      clearTimeout(timer);
      setSentNote(act.note);
      timer = setTimeout(() => setSentNote(null), INVITE_NOTE_MS);
    });
    return () => { off?.(); clearTimeout(timer); };
  }, [available]);

  // Choosing a page puts it away, so the page you chose is what you see. Also
  // a click on the header's tabs and links, or the notch's tabs (the same page,
  // another view). Not Auto scan's button, nor anything that opens over it.
  // The LinkedIn tab is the exception: it is where LinkedIn shows, and its notch
  // buttons choose the section (app/linkedin/page.js).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (panelNow()?.visible && pathname !== LINKEDIN_TAB) bridge()?.hide();
  }, [pathname]);
  useEffect(() => {
    if (!available) return undefined;
    const onClick = (e) => {
      if (!panelNow()?.visible) return;
      const hit = e.target?.closest?.('header a[href], header .sd-tab, [data-notch] [role="tab"]');
      if (!hit || hit.closest('.sd-auto')) return;
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
  const sentPill = sentNote ? (
    <div role="status" aria-live="polite" data-invite-sent="" style={{ ...SENT, top: `calc(${barTop || 0}px + 10px)` }}>
      <Dot green /> {sentNote}
    </div>
  ) : null;

  if (!visible) {
    // Something to go back to: LinkedIn's open there, and a scan runs.
    if (!panel.linkedin || !job.running) return sentPill;
    return (
      <>
        <button type="button" onClick={() => b.show()} title="Show LinkedIn in Sixgree's own browser" style={{ ...PILL, top: `calc(${barTop || 0}px + 10px)` }}>
          <Dot /> Show LinkedIn
        </button>
        {sentPill}
      </>
    );
  }

  // On the LinkedIn tab: which section, and the way back to it once you've gone elsewhere.
  const section = panel.mode === 'section' ? LINKEDIN_SECTION_TABS.find((t) => t.key === panel.section) : null;
  const strayed = Boolean(section && panel.at !== section.key);
  const say = job.running && job.needsYou ? sentence(job.needsYou)
    : job.running ? 'A scan is using it. Going back doesn’t stop it.'
    : panel.mode === 'profile' ? 'Their profile, for you to act on. Sixgree clicks nothing on it.'
    : section ? `Your LinkedIn ${section.label.toLowerCase()}, live. Sixgree reads nothing on it.`
    : 'Your own LinkedIn, inside Sixgree.';
  // Back and Forward wait while a scan drives the page: it would lose its place.
  const held = scanHoldsPanel(job, panel);
  return (
    <>
      {/* The panel's still picture, where the panel is, while something is open over it. The
          header is lifted over it, so what opens from the header shows whole. */}
      {/* The header over everything of LinkedIn's: the panel's still picture. */}
      <style>{'header{position:relative;z-index:101}'}</style>
      {still && (
        <>
          <img data-panel-still="" alt="" src={still.src} draggable={false}
            onLoad={() => requestAnimationFrame(() => b.stillDrawn?.(still.n))}
            style={{ position: 'fixed', top, left: 0, width: '100vw', height: `calc(100vh - ${top + bottom}px)`, zIndex: 58, objectFit: 'fill', pointerEvents: 'auto', userSelect: 'none' }} />
        </>
      )}
      <div role="region" aria-label="LinkedIn in Sixgree" data-linkedin-bar="" style={{ ...BAR_STYLE, top: barTop }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, maxWidth: words || undefined, overflow: 'hidden' }}>
          <HistoryButton way="back" can={Boolean(panel.canGoBack) && !held} held={held} />
          <HistoryButton way="forward" can={Boolean(panel.canGoForward) && !held} held={held} />
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
          <button type="button" onClick={() => { shownByJob.current = false; b.hide(); }} style={BACK}>Back to Sixgree</button>
        </span>
      </div>
      {sentPill}
    </>
  );
}

/** The LinkedIn tab's page (app/linkedin/page.js). */
const LINKEDIN_TAB = '/linkedin';

/**
 * Back (blue) and Forward (yellow): the app's own round blue and yellow
 * buttons, the map's edge pucks (EdgeToggle.js, app/globals.css "The map's
 * edge buttons"), Filters' blue on the left and Details' gold on the right,
 * with the same frosted puck and chevron, sized for the bar (.sd-edge-inline).
 * Greyed out where the panel's history can't go that way.
 */
function HistoryButton({ way, can, held }) {
  const back = way === 'back';
  const label = back ? 'Back' : 'Forward';
  const why = held ? 'A scan is using LinkedIn here. Back and Forward wait until it has finished'
    : `${label} in LinkedIn (${MOD}${back ? '[' : ']'})`;
  return (
    <button type="button" data-panel-history={way} disabled={!can} aria-label={label} title={why}
      className={`sd-edge sd-edge-${back ? 'left' : 'right'} sd-edge-inline`}
      onClick={() => (back ? panelBack() : panelForward())}>
      <span className="sd-edge-puck" aria-hidden="true">
        <svg className="sd-edge-chev" viewBox="0 0 16 16" focusable="false">
          <path d={back ? CHEVRON_BACK : CHEVRON_FORWARD} />
        </svg>
      </span>
    </button>
  );
}

const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+';
// EdgeToggle.js's two chevrons: pointing back (its Details puck's) and forward (its Filters puck's).
const CHEVRON_BACK = 'M10 3.2 5.2 8 10 12.8';
const CHEVRON_FORWARD = 'M6 3.2 10.8 8 6 12.8';

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function Dot({ gold = false, green = false }) {
  const background = green ? 'var(--sd-green, #00FF88)' : gold ? 'var(--sd-gold, #FFD700)' : '#0A66C2';
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background }} />;
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

// "Request sent to X": under the header, in the middle, over whatever page you're back on.
const SENT = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 62, display: 'flex', alignItems: 'center', gap: 8,
  padding: '7px 14px', borderRadius: 999, font: 'inherit', fontSize: 12.5, fontWeight: 700, pointerEvents: 'none', whiteSpace: 'nowrap',
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(0, 255, 136, 0.45)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
};

const PILL = {
  position: 'fixed', right: 16, zIndex: 61, display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 11px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700,
  background: 'var(--sd-surface, rgba(8,10,22,0.96))', color: 'var(--sd-fg-1, #fff)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
};
