'use client';

// Auto, next to every Connect: one connection request, sent for you from the
// scanner's Chrome, without a note.
//
// Blake, 2026-10-03: "auto add and basically adds the person for them in the
// card or wherever its available", then "i just want it next to connect button
// but say auto and makes it the better pick visually". So Auto comes first and
// wears the look Connect had (the gold-to-orange gradient), and the page's own
// Connect, which opens their profile for you to connect yourself, steps back to
// an outline beside it.
//
// One press, one person: it starts the scanner's `connect` job
// (app/api/scraper/route.js, scripts/scrape.py connect_person) and says how it
// went. It waits its turn like every Scan button (greyed out, with the reason,
// while anything else runs). Before the first one ever it asks once, and the
// answer is a setting (lib/auto-connect.js); the server refuses until it's
// given. A request LinkedIn showed as pending is marked as sent by the server,
// through the same store as Connect (lib/requests.js), and shown everywhere
// here a moment after "Request sent" (lib/requests-client.js sawRequested).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useScanner from './useScanner';
import { beginScrape, busyReason } from '../../lib/scraper-client';
import { sawRequested } from '../../lib/requests-client';
import { AUTO_EXPLAIN, AUTO_CONFIRM, INVITE_CAPS, connectOutcome } from '../../lib/auto-connect';

export const AUTO_GRADIENT = 'linear-gradient(135deg, #FFD700, #FF6B35)';

// How long "Request sent" shows before the card turns to its pending state.
const SENT_SHOWN_MS = 2500;

// Whether the one-time question has been answered yes, asked of the app once per page.
let acceptedHere = false;

async function autoAccepted() {
  if (acceptedHere) return true;
  try {
    const r = await fetch('/api/settings', { cache: 'no-store' });
    const d = await r.json();
    acceptedHere = Boolean(d?.settings?.autoConnectAccepted);
  } catch {
    acceptedHere = false;   // can't tell: ask, which is harmless
  }
  return acceptedHere;
}

async function saveAccepted() {
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { autoConnectAccepted: new Date().toISOString() } }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Your answer couldn’t be saved.');
  acceptedHere = true;
}

/** Auto's state for one person: press it, the one-time question, how it went. */
function useAutoConnect(person, onSent) {
  const scan = useScanner();
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);     // { ok, text } once a press has an answer
  const ours = useRef(new Set());                   // jobs this button started (by startedAt)
  const shownJob = useRef(null);

  const mine = scan.running && scan.action === 'connect' && Boolean(person?.id) && scan.target?.id === person.id;
  const busy = scan.running && !mine && !sending ? busyReason(scan) : null;

  const done = (r) => {
    setResult(r);
    if (r.marks) setTimeout(() => { sawRequested(person); onSent?.(person); }, SENT_SHOWN_MS);
  };

  // A request to this person started elsewhere (another window, or before a
  // reload) that this page watched end: say how it went here too.
  const last = (scan.finished || []).find((j) => j.action === 'connect' && j.target?.id === person?.id);
  useEffect(() => {
    if (!last || ours.current.has(last.startedAt) || shownJob.current === last.startedAt) return;
    shownJob.current = last.startedAt;
    done(connectOutcome(last));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.startedAt]);

  async function send() {
    setAsking(false);
    setSending(true);
    setResult(null);
    try {
      const { startedAt, ended } = await beginScrape('connect', { id: person.id, name: person.name });
      ours.current.add(startedAt);
      shownJob.current = startedAt;
      done(connectOutcome(await ended));
    } catch (err) {
      if (err.details?.needsAutoAcceptance) {
        acceptedHere = false;
        setAsking(true);
      } else {
        setResult({ ok: false, text: err.message });
      }
    } finally {
      setSending(false);
    }
  }

  async function press() {
    if (sending || mine || busy) return;
    setResult(null);
    if (await autoAccepted()) send();
    else setAsking(true);
  }

  async function confirm() {
    try {
      await saveAccepted();
      send();
    } catch (err) {
      setAsking(false);
      setResult({ ok: false, text: err.message });
    }
  }

  return {
    press, confirm, cancel: () => setAsking(false), dismiss: () => setResult(null),
    asking, sending: sending || mine, busy, result,
  };
}

/** The question before Auto's first request ever. Into <body>: a blurred panel would trap a fixed overlay (TheirCircle.js). */
function AutoAsk({ onSend, onCancel }) {
  const sendRef = useRef(null);
  useEffect(() => {
    sendRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Auto sends connection requests" onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(var(--sd-shade, 0, 0, 0), 0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div data-auto-ask onClick={(e) => e.stopPropagation()} style={{
        width: 'min(420px, 100%)', boxSizing: 'border-box', borderRadius: 14, padding: '20px 20px 16px',
        background: 'var(--sd-surface, #12111c)', border: '1px solid rgba(255,215,0,0.28)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.5)', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{
            padding: '3px 9px', borderRadius: 6, background: AUTO_GRADIENT, color: '#000', fontWeight: 800, fontSize: 12,
          }}>Auto</span>
          <span style={{ fontSize: 15, fontWeight: 750, color: 'var(--sd-fg-1, #fff)' }}>Before the first one</span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--sd-fg-2, #d6dbe4)' }}>{AUTO_CONFIRM}</p>
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--sd-fg-3, #8b9a9a)' }}>
          It never adds a note, and stops at {INVITE_CAPS.day} in any 24 hours and {INVITE_CAPS.week} in any 7 days.
          This is asked once.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel} style={{
            padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 650, cursor: 'pointer',
            background: 'transparent', color: 'var(--sd-fg-2, #ccc)', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.18)',
          }}>Cancel</button>
          <button ref={sendRef} type="button" onClick={onSend} style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
            background: AUTO_GRADIENT, color: '#000', border: 'none',
          }}>Send it</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// minWidth: room for "Sending…", so the row doesn't jump when it changes.
const SIZES = {
  card: { padding: '10px 18px', fontSize: 13, radius: 8, minWidth: 104 },
  quest: { padding: '7px 14px', fontSize: 12.5, radius: 8, minWidth: 92 },
  row: { padding: '4px 9px', fontSize: 9.5, radius: 4, minWidth: 0 },
};

/** The Auto button itself: the gradient, the better pick. */
function AutoButton({ auto, size, label = 'Auto' }) {
  const s = SIZES[size] || SIZES.card;
  // Also while "Request sent" shows, before the card turns to its pending state.
  const off = auto.sending || Boolean(auto.busy) || Boolean(auto.result?.marks);
  const title = auto.busy ? `${auto.busy}. Auto waits for it to finish.` : AUTO_EXPLAIN;
  return (
    <button type="button" data-auto-connect onClick={(e) => { e.stopPropagation(); auto.press(); }} disabled={off} title={title}
      aria-label={auto.sending ? 'Sending the request' : `${label}: ${AUTO_EXPLAIN}`}
      style={{
        padding: s.padding, borderRadius: s.radius, fontSize: s.fontSize, fontWeight: 800, border: 'none', minWidth: s.minWidth,
        background: AUTO_GRADIENT, color: '#000', cursor: off ? 'not-allowed' : 'pointer', opacity: auto.busy ? 0.45 : 1,
        whiteSpace: 'nowrap', flexShrink: 0, boxShadow: off ? 'none' : '0 2px 12px rgba(255,140,50,0.28)',
      }}>
      {auto.sending ? 'Sending…' : label}
    </button>
  );
}

const resultColor = (r) => (r.ok ? 'var(--sd-green, #00ff88)' : 'var(--sd-coral, #ff8a7a)');

/**
 * Auto and the page's Connect, side by side: Auto first, as the better pick.
 * `connect(secondary)` draws the page's own Connect, told whether it now stands
 * second (an outline) or alone (as it always looked). Without Auto (`canAuto`
 * false: the sample, a CSV, someone with no profile on file) Connect stands
 * alone. `size`: 'card' (the person card: a line under it says what Auto does),
 * 'quest' (Outlink's move cards) or 'row' (a list row: the line is the
 * button's tooltip, and how it went shows in a small note under the buttons).
 */
export default function ConnectChoice({ person, canAuto = true, size = 'card', connect, onSent, style }) {
  const available = canAuto && Boolean(person?.id) && Boolean(person?.profile_url);
  if (!available) return connect(false);
  // Keyed by person: a card reused for the next person starts fresh, never
  // showing the last one's result as theirs.
  return <WithAuto key={person.id} person={person} size={size} connect={connect} onSent={onSent} style={style} />;
}

function WithAuto({ person, size, connect, onSent, style }) {
  const auto = useAutoConnect(person, onSent);
  const ask = auto.asking && <AutoAsk onSend={auto.confirm} onCancel={auto.cancel} />;

  if (size === 'row') {
    return (
      <span style={{ position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center', flexShrink: 0, ...style }}
        onClick={(e) => e.stopPropagation()}>
        <AutoButton auto={auto} size="row" />
        {connect(true)}
        {auto.result && (
          <span role="status" style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, width: 230, boxSizing: 'border-box',
            padding: '7px 24px 7px 9px', borderRadius: 7, fontSize: 11, lineHeight: 1.45, fontWeight: 600, textAlign: 'left',
            color: resultColor(auto.result), background: 'var(--sd-surface, #14131d)',
            border: `1px solid ${auto.result.ok ? 'rgba(0,255,136,0.35)' : 'rgba(255,138,122,0.4)'}`, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {auto.result.text}
            <button type="button" aria-label="Close" onClick={auto.dismiss} style={{
              position: 'absolute', top: 3, right: 4, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--sd-fg-3, #888)', fontSize: 12, lineHeight: 1,
            }}>×</button>
          </span>
        )}
        {ask}
      </span>
    );
  }

  const card = size === 'card';
  return (
    <div style={style}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <AutoButton auto={auto} size={size} />
        {connect(true)}
      </div>
      {card && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 8 }}>
          {auto.busy ? `${auto.busy}. Auto waits for it to finish.` : AUTO_EXPLAIN}
        </div>
      )}
      {auto.result && (
        <div role="status" style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 650, marginTop: 8, color: resultColor(auto.result) }}>
          {auto.result.text}
        </div>
      )}
      {ask}
    </div>
  );
}

/**
 * The page's Connect when it stands second to Auto: the same link, as an
 * outline. `color` and `line` keep a page's own colour (Outlink's blue Add).
 */
export function secondaryLook(size = 'card', { color = 'var(--sd-gold, #FFD700)', line = 'rgba(255,215,0,0.5)' } = {}) {
  const s = SIZES[size] || SIZES.card;
  return {
    padding: s.padding, borderRadius: s.radius, fontSize: s.fontSize, fontWeight: 700,
    background: 'transparent', color, border: `1px solid ${line}`,
    textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}
