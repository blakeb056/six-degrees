'use client';

// The header on every page that has the app's tabs: the name on the left, the
// tabs in the exact middle of the window, and the same buttons on the right
// everywhere — Settings, notifications, ↻ Check for new and your profile.
// Blake, 2026-10-03: on Paths, Outlink and Scan "the profile settings and
// refresh buttons aren't there, every section should have the same buttons",
// and "align the button bar to the exact middle".
//
// The row is a grid of 1fr | auto | 1fr: the two sides share what's left
// equally, so the tabs sit in the middle whatever is beside them. A window too
// narrow for that lets the sides shrink to fit before anything overlaps.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppTabs from './AppTabs';
import AutoScanButton from './AutoScanButton';
import ScanTrail from './ScanTrail';
import ClusterSpinner from './ClusterSpinner';
import useScanner from './useScanner';
import { useUser } from './UserProvider';
import { scraperStatus, beginScrape, notReadyMessage, busyReason } from '../../lib/scraper-client';
import { loadNetwork } from '../../lib/network';
import { networkLevel, rememberLevel, levelNow, watchLevel } from '../../lib/level';
import { IS_DEMO } from '../../lib/demo';

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return m;
}

const TITLE = { fontWeight: 700, margin: 0, whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' };

/**
 * @param {{ active: string, isMobile?: boolean, csvMode?: boolean, onMode?: (key: string) => void,
 *   chips?: any, level?: number | null, onOpenNote?: (note: object) => void, openNoteId?: string | null,
 *   brand?: string, children?: any }} props
 *   `chips` go in the tab row after the map's tabs (the sample or CSV chip);
 *   `children` under the row. `level` is your network's level when the page has
 *   the network loaded; elsewhere the button finds it. `onOpenNote` opens a
 *   notification on this page (the map's side panel); without it, a notification
 *   opens there (/?note=…). `brand` is the element the name is drawn in: an
 *   <h1> unless the page has its own (the Scan page).
 */
export default function AppHeader({ active, isMobile: mobileProp, csvMode = false, onMode, chips, level, onOpenNote, openNoteId = null, brand: Brand = 'h1', children }) {
  const mobileSeen = useIsMobile();
  const isMobile = mobileProp ?? mobileSeen;
  const own = !IS_DEMO && !csvMode;   // scanning and notifications are for your own network
  return (
    <header style={{
      position: 'relative', padding: isMobile ? '10px 12px' : '20px 30px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)', flexShrink: 0,
      // Clear, or frosted glass on a glass theme (lib/themes.js).
      background: 'var(--sd-header)', backdropFilter: 'var(--sd-header-blur)', WebkitBackdropFilter: 'var(--sd-header-blur)',
    }}>
      <div style={isMobile
        ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 4 }
        : { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, marginBottom: 8 }}>
        <Link href="/" style={{ textDecoration: 'none', justifySelf: 'start' }}>
          <Brand style={{ ...TITLE, fontSize: isMobile ? 16 : 28 }}>Six Degrees</Brand>
        </Link>
        <AppTabs active={active} isMobile={isMobile} csvMode={csvMode} onMode={onMode}
          after={own ? <AutoScanButton isMobile={isMobile} /> : null}>
          {chips}
        </AppTabs>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', justifySelf: 'end', gap: isMobile ? 4 : 8 }}>
          {/* Settings: also in CSV or sample mode and on phones, so updates stay reachable */}
          {!IS_DEMO && <Link href="/settings" title="Settings" aria-label="Settings" style={{
            width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-3, #888)', fontSize: isMobile ? 14 : 16, textDecoration: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{'⚙︎'}</Link>}
          {own && <NotificationBell isMobile={isMobile} onOpen={onOpenNote} openId={openNoteId} />}
          {own && <RefreshButton isMobile={isMobile} />}
          <ProfileButton isMobile={isMobile} csvMode={csvMode} level={level} />
        </div>
      </div>
      {children}
      {/* While a scan runs: a dot on the line below for each page it reads */}
      {own && <ScanTrail inset={isMobile ? 12 : 30} />}
    </header>
  );
}

/** Notifications: the bell, its count, and the list under it. */
function NotificationBell({ isMobile, onOpen, openId }) {
  const { userId } = useUser();
  const router = useRouter();
  const [notes, setNotes] = useState([]);
  const [open, setOpen] = useState(false);
  // A notification picked on another page arrives as /?note=<id>: opened once, when the list is in.
  const opened = useRef(false);
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; });
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/notifications?userId=${userId}`).then((r) => r.json()).then((d) => {
      const list = d.notifications || [];
      setNotes(list);
      const asked = openId != null && !opened.current && list.find((n) => String(n.id) === String(openId));
      if (asked && onOpenRef.current) { opened.current = true; onOpenRef.current(asked); }
    }).catch(() => {});
  }, [userId, openId]);
  const unseen = notes.filter((n) => !n.seen).length;
  const show = (n) => {
    // Open it, and count it as read.
    if (!n.seen) {
      fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-seen', id: n.id }) }).catch(() => {});
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, seen: true } : x)));
    }
    setOpen(false);
    if (onOpen) onOpen(n);
    else router.push(`/?note=${encodeURIComponent(n.id)}`);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} title="Notifications" aria-label={unseen ? `Notifications, ${unseen} new` : 'Notifications'} style={{
        width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: 'var(--sd-fg-3, #888)', fontSize: isMobile ? 12 : 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      }}>
        🔔
        {unseen > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: '50%',
            background: '#ff5050', color: '#fff', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{unseen}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0, width: 320, maxHeight: 400,
          background: 'color-mix(in srgb, var(--sd-bg) 97%, transparent)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)',
          borderRadius: 12, overflow: 'hidden', zIndex: 100,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
            {unseen > 0 && (
              <button onClick={() => {
                fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-all-seen' }) });
                setNotes((prev) => prev.map((n) => ({ ...n, seen: true })));
              }} style={{ background: 'none', border: 'none', color: 'var(--sd-blue, #3498DB)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 340 }}>
            {notes.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--sd-fg-5, #555)', fontSize: 12 }}>No notifications yet</div>
            ) : notes.slice(0, 20).map((n) => (
              <div key={n.id} role="button" tabIndex={0}
                onClick={() => show(n)}
                onKeyDown={(e) => { if (e.key === 'Enter') show(n); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--sd-ink, 255, 255, 255), 0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = n.seen ? 'transparent' : 'rgba(255,215,0,0.04)'; }}
                style={{
                  padding: '10px 16px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)', cursor: 'pointer',
                  background: n.seen ? 'transparent' : 'rgba(255,215,0,0.04)',
                }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 16 }}>{n.icon || '📌'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: n.seen ? 'var(--sd-fg-3, #888)' : 'var(--sd-fg-1, #fff)' }}>{n.title}<span style={{ color: 'var(--sd-fg-5, #556)', marginLeft: 6 }}>›</span></div>
                    {n.message && <div style={{ fontSize: 10, color: 'var(--sd-fg-4, #666)', marginTop: 2 }}>{n.message}</div>}
                    <div style={{ fontSize: 9, color: 'var(--sd-fg-5, #444)', marginTop: 3 }}>{new Date(n.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Its own component so the scanner's answer, which changes every second or two
// while a scan runs, re-renders this button and not the whole page.
//
// It asks first, as a company scan does, and says what it will do and what it
// costs: one click on a small icon used to open a Chrome window on LinkedIn
// with no word of what it was about to do.
function RefreshButton({ isMobile }) {
  const scan = useScanner();
  const checking = scan.running && scan.action === 'refresh';
  const busy = busyReason(scan);
  return (
    <button
      className="cluster-host"
      onClick={async () => {
        try {
          const blocked = notReadyMessage(await scraperStatus());
          if (blocked) { alert(blocked); return; }
          const ok = window.confirm(
            'Check for new connections?\n\nThis opens a Chrome window on your LinkedIn connections ' +
            'list and reads it from the newest, stopping once it reaches people already saved. It ' +
            'usually takes under a minute. It reads your own list, not a search, so it doesn’t ' +
            'use your search budget, but like any scan it is LinkedIn traffic from your account.',
          );
          if (!ok) return;
          await beginScrape('refresh');
          alert('Checking for new connections. Watch it on the Scan page.');
        } catch (e) {
          alert(e.message);
        }
      }}
      disabled={Boolean(busy)}
      title={busy ? `${busy}. One scan at a time.` : 'Check for new connections: reads your LinkedIn connections list from the newest'}
      aria-label="Check for new connections"
      style={{
        // Words, not a bare ↻ (Blake, 2026-10-02: "make it easier to check for new
        // connections"), and the same words as the Scan page's button.
        height: isMobile ? 28 : 32, padding: isMobile ? '0 10px' : '0 14px', borderRadius: 16,
        // Its own check running stays bright, its cluster building; something else running greys it.
        border: '1px solid rgba(0,255,136,0.3)', cursor: checking ? 'progress' : busy ? 'not-allowed' : 'pointer', opacity: busy && !checking ? 0.45 : 1,
        background: 'rgba(0,255,136,0.08)', color: 'var(--sd-fg-1, #bff5d9)', fontSize: isMobile ? 11 : 12.5, fontWeight: 700,
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {/* A cluster forming: built once on hover, round and round while it checks */}
      <ClusterSpinner size={isMobile ? 12 : 14} live={checking} />
      {checking ? 'Checking…' : isMobile ? 'New' : 'Check for new'}
    </button>
  );
}

// Asked once per tab, for the pages that don't load the network themselves.
let levelLoad = null;

/** Your level, opening your Profile (the sample's launch page, or a CSV's import page). */
function ProfileButton({ isMobile, csvMode, level }) {
  const { userId } = useUser();
  const source = IS_DEMO ? 'sample' : csvMode ? 'csv' : 'own';
  const remembered = useSyncExternalStore(watchLevel, () => levelNow(source), () => null);
  useEffect(() => {
    if (level != null) { rememberLevel(level, source); return; }
    // The sample and a CSV live in the map page's tab: only your own network is loaded here.
    if (remembered != null || IS_DEMO || csvMode || !userId) return;
    if (!levelLoad) levelLoad = loadNetwork(userId).then((n) => networkLevel(n.degree1, n.degree2)).catch(() => { levelLoad = null; return null; });
    levelLoad.then((l) => { if (l != null) rememberLevel(l, source); });
  }, [level, remembered, csvMode, source, userId]);
  const shown = level ?? remembered;
  return (
    <a href={IS_DEMO ? '/launch' : csvMode ? '/import' : '/profile'} title={shown != null ? `Your profile · level ${shown}` : 'Your profile'} style={{
      width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000', fontWeight: 800, fontSize: isMobile ? 11 : 14,
      textDecoration: 'none', marginLeft: isMobile ? 2 : 4, flexShrink: 0,
    }}>
      {shown ?? ''}
    </a>
  );
}
