'use client';

// The LinkedIn browser plugin (lib/linkedin-browser.js; Blake, 2026-10-15: "an
// option to open LinkedIn within the actual application but they can use the
// side panel on their right for finding people and can be interactive, but
// that would be a button at the top right by the bell and settings and would
// be a plugin").
//
//   LinkedInButton  in the header beside the bell and Settings: opens
//                   Sixgree's own browser for your own browsing. Only in the
//                   desktop app, with the plugin installed and plugins on
//                   (useFeature), and never while a scan is using the browser.
//   PeopleSidebar   on the right while you browse: find people in your own
//                   network, open their profile in the panel (Outlink: one
//                   profile view, recorded), and see what Sixgree knows about
//                   whoever is on screen.
//
// Browsing is yours: Sixgree reads nothing in the panel and clicks nothing.
// All it hears of the page is which linkedin.com/in/<slug> it is on
// (desktop/main.mjs panelState), to match against the network on this computer.

import { useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar';
import useScanner from './useScanner';
import useFeature from './useFeature';
import { useUser } from './UserProvider';
import { useLinkedInPanel, browseLinkedIn, hideLinkedInPanel } from './linkedInPanelState';
import { openProfile, openProfileInBrowser } from './OpenProfile';
import { loadNetwork } from '../../lib/network';
import { LINKEDIN_BROWSER, peopleIndex, searchPeople, personOnScreen, degreeLabel } from '../../lib/linkedin-browser';
import { TIER_COLORS } from '../../lib/themes';

/** A job that drives the panel itself: browsing then would be in its way. Outlink's open is one of yours. */
const scanUsesPanel = (job) => Boolean(job?.running && job.action !== 'outlink');

export function LinkedInButton({ isMobile = false }) {
  const panel = useLinkedInPanel();
  const on = useFeature(LINKEDIN_BROWSER);
  const job = useScanner();
  if (!panel?.available || !on || isMobile) return null;
  const open = panel.visible && panel.mode === 'browse';
  const busy = scanUsesPanel(job) && !open;
  const label = busy ? 'LinkedIn: a scan is using Sixgree’s browser. Browse once it has finished'
    : open ? 'Back to Sixgree' : 'LinkedIn, inside Sixgree, with your network beside it';
  return (
    <button type="button" data-linkedin-button="" aria-pressed={open} title={label} aria-label={label} disabled={busy}
      onClick={() => (open ? hideLinkedInPanel() : browseLinkedIn())}
      style={{
        width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0, cursor: busy ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, letterSpacing: -0.3,
        fontFamily: 'var(--font-geist-sans), -apple-system, sans-serif', opacity: busy ? 0.45 : 1,
        background: open ? '#0A66C2' : 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', color: open ? '#fff' : 'var(--sd-fg-3, #888)',
        boxShadow: open ? '0 0 0 2px rgba(10,102,194,0.35)' : 'none',
      }}>
      in
    </button>
  );
}

// The network, loaded once per window and kept while the list is open again and again.
let networkLoad = null;
function useNetworkIndex(userId) {
  const [index, setIndex] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    if (!networkLoad || networkLoad.userId !== userId) {
      networkLoad = { userId, promise: loadNetwork(userId).then(peopleIndex) };
      networkLoad.promise.catch(() => { networkLoad = null; });
    }
    networkLoad.promise.then((i) => { if (live) setIndex(i); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [userId]);
  return { index, failed };
}

const FG1 = 'var(--sd-fg-1, #fff)';
const FG3 = 'var(--sd-fg-3, #8b9a9a)';
const LINE = '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.1)';

export function PeopleSidebar({ top, bottom = 0, width, profile }) {
  const { userId } = useUser();
  const job = useScanner();
  const { index, failed } = useNetworkIndex(userId);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const results = useMemo(() => (index ? searchPeople(index, query, 30) : []), [index, query]);
  const onScreen = index && profile ? personOnScreen(index, profile) : null;
  return (
    <aside aria-label="Your network, beside LinkedIn" data-people-sidebar="" style={{
      // Over the page's own fixed parts (its side panel's toggle); under the header, lifted
      // while LinkedIn shows (LinkedInPanel.js), and the scan light's briefing.
      position: 'fixed', top, right: 0, bottom, width, zIndex: 99, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 16px', overflowY: 'auto',
      // Solid: the page under it must never show through.
      background: 'var(--sd-bg, #0a0a12)', backgroundImage: 'linear-gradient(var(--sd-surface, rgba(8,10,22,0.96)), var(--sd-surface, rgba(8,10,22,0.96)))', borderLeft: LINE, color: 'var(--sd-fg-2, #cfd8d8)', fontSize: 12.5,
    }}>
      {scanUsesPanel(job) && (
        <div role="status" style={{ color: 'var(--sd-gold, #FFD700)', lineHeight: 1.45 }}>
          A scan is using this browser now. Leave it be until it finishes, or it may lose its place.
        </div>
      )}

      <section aria-label="On screen">
        <Heading>On screen</Heading>
        {!profile ? (
          <p style={{ margin: 0, color: FG3, lineHeight: 1.5 }}>Open someone’s profile and Sixgree shows here what it knows about them.</p>
        ) : !index ? (
          <p style={{ margin: 0, color: FG3 }}>{failed ? 'Your network couldn’t be loaded.' : 'Looking them up…'}</p>
        ) : onScreen ? (
          <PersonCard person={onScreen} onScreen />
        ) : (
          <p data-on-screen-unknown="" style={{ margin: 0, color: FG3, lineHeight: 1.5 }}>
            Not in your network data. Sixgree hasn’t found this person through you or your connections yet.
          </p>
        )}
      </section>

      <section aria-label="Find people in your network" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <Heading>Your network</Heading>
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
          placeholder="Search by name, company or place" aria-label="Search your network by name, company or place"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8, fontSize: 12.5, outline: 'none',
            border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: FG1,
          }} />
        {picked && <PersonCard person={picked} onClose={() => setPicked(null)} />}
        {!picked && query.trim().length >= 2 && (
          results.length === 0
            ? <p style={{ margin: 0, color: FG3 }}>{index ? 'Nobody in your network matches that.' : 'Loading your network…'}</p>
            : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {results.map((p) => <PersonRow key={p.key} person={p} onPick={() => setPicked(p)} />)}
              </ul>
            )
        )}
        {!picked && query.trim().length < 2 && (
          <p style={{ margin: 0, color: FG3, lineHeight: 1.5 }}>
            Find anyone Sixgree knows of, through you or your connections, and open their profile here.
          </p>
        )}
      </section>

      <p style={{ margin: 'auto 0 0', color: 'var(--sd-fg-4, #667)', fontSize: 11, lineHeight: 1.5 }}>
        Browsing here is yours: Sixgree reads nothing on the page and isn’t scanning. A profile opened from this list counts as one of today’s profile views.
      </p>
    </aside>
  );
}

function Heading({ children }) {
  return <h3 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: FG3 }}>{children}</h3>;
}

const asRow = (p) => ({ name: p.name, tier: p.tier, profile_image_url: p.photo });

function PersonRow({ person, onPick }) {
  const [note, setNote] = useState(null);
  return (
    <li data-person-row={person.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', borderRadius: 8 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--sd-ink, 255, 255, 255), 0.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      <button type="button" onClick={onPick} title="Their card" style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'none',
        color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
      }}>
        <Avatar person={asRow(person)} size={28} tierColors={TIER_COLORS} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', color: FG1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</span>
          <span style={{ display: 'block', color: FG3, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {degreeLabel(person.degree)}{person.tier ? ` · ${person.tier}` : ''}{person.company ? ` · ${person.company}` : ''}{person.location ? ` · ${person.location}` : ''}
          </span>
          {note && <span role="status" style={{ display: 'block', color: 'var(--sd-gold, #FFD700)', fontSize: 11, whiteSpace: 'normal' }}>{note}</span>}
        </span>
      </button>
      <OpenButton person={person} small onNote={setNote} />
    </li>
  );
}

/** Opens their profile in the panel: Outlink, one profile view. Where it can't, it says why and offers your browser. */
function OpenButton({ person, small = false, onNote }) {
  const [busy, setBusy] = useState(false);
  if (!person.profileUrl) return null;
  async function open() {
    onNote?.(null);
    setBusy(true);
    const got = await openProfile({ id: person.id, name: person.name, profile_url: person.profileUrl }, { browser: false });
    setBusy(false);
    if (got.where === 'fallback') {
      onNote?.(<>
        Opening a profile from here needs a scanner plugin (1.0.5 or newer) and the Scan page’s one-time OK, so it can be counted.{' '}
        <a href={person.profileUrl} onClick={(e) => { e.preventDefault(); openProfileInBrowser(person.profileUrl); }} style={{ color: 'var(--sd-blue, #3498DB)' }}>Open it in your browser</a>
      </>);
    } else if (got.where === 'error') onNote?.(got.message);
  }
  return (
    <button type="button" onClick={open} disabled={busy} title="Open their profile here. Counts as one of today’s profile views" style={{
      flexShrink: 0, padding: small ? '4px 9px' : '7px 12px', borderRadius: 7, cursor: busy ? 'progress' : 'pointer',
      font: 'inherit', fontSize: small ? 11.5 : 12.5, fontWeight: 700, border: 'none', background: '#0A66C2', color: '#fff', opacity: busy ? 0.6 : 1,
    }}>
      {busy ? 'Opening…' : small ? 'Open' : 'Open profile'}
    </button>
  );
}

function PersonCard({ person, onScreen = false, onClose }) {
  const [note, setNote] = useState(null);
  const facts = [
    [degreeLabel(person.degree), person.degree === 1 ? 'Your connection' : person.degree === 2 ? 'A connection of your connection' : 'Further out'],
    person.tier && [`Tier ${person.tier}`, null],
    person.location && [person.location, null],
    person.mutual != null && [`${person.mutual.toLocaleString()} mutual`, null],
  ].filter(Boolean);
  return (
    <div data-person-card={person.key} data-on-screen={onScreen ? '' : undefined} style={{
      border: LINE, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar person={asRow(person)} size={40} tierColors={TIER_COLORS} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: FG1, fontWeight: 700, fontSize: 14 }}>{person.name}</div>
          {(person.headline || person.company) && (
            <div style={{ color: FG3, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {person.headline || person.company}
            </div>
          )}
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Back to the results" title="Back to the results" style={{ border: 'none', background: 'none', color: FG3, cursor: 'pointer', fontSize: 16 }}>×</button>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {facts.map(([text, hint]) => (
          <span key={text} title={hint || undefined} style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: 'rgba(var(--sd-ink, 255, 255, 255), 0.07)', color: text.startsWith('Tier') ? TIER_COLORS[person.tier] || FG1 : FG1,
          }}>{text}</span>
        ))}
      </div>
      {person.via.length > 0 && (
        <div style={{ lineHeight: 1.45 }}>
          <span style={{ color: FG3 }}>Who connects you: </span>
          <b style={{ color: FG1, fontWeight: 600 }}>{person.via.slice(0, 5).join(', ')}</b>
          {person.via.length > 5 ? <span style={{ color: FG3 }}> and {person.via.length - 5} more</span> : null}
        </div>
      )}
      {!onScreen && <OpenButton person={person} onNote={setNote} />}
      {note && <div role="status" style={{ color: 'var(--sd-gold, #FFD700)', fontSize: 11.5, lineHeight: 1.45 }}>{note}</div>}
    </div>
  );
}
