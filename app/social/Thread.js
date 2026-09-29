'use client';

// One conversation's messages in the Social tab's CRM (Crm.js), newest at the
// bottom. Only while Keep my messages is on: the words live only in the app's
// data folder (lib/social-store.js), and GET /api/social/messages serves them
// a page at a time.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LINE } from '../components/ui';

const THREAD_PAGE = 100;
const EARLIER_PAGE = 200;
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// One conversation's messages, newest at the bottom, a page at a time: the
// newest 100 first and 200 more each time you ask, so a thread of thousands
// opens as fast as a short one.
export default function Thread({ id, keep, group, token }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const scroller = useRef(null);
  const keepAt = useRef(null);

  useEffect(() => {
    if (!keep) return undefined;
    let live = true;
    fetch(`/api/social/messages?id=${encodeURIComponent(id)}&limit=${THREAD_PAGE}`).then((r) => r.json())
      .then((d) => { if (live) { if (d.error) setErr(d.error); else { keepAt.current = 'bottom'; setT(d); } } })
      .catch(() => { if (live) setErr('It couldn’t be read.'); });
    return () => { live = false; };
  }, [id, keep, token]);

  // Opened at the newest; after "Show earlier", where you were stays put.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !keepAt.current) return;
    if (keepAt.current === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - keepAt.current;
    keepAt.current = null;
  }, [t]);

  async function earlier() {
    const el = scroller.current;
    const d = await fetch(`/api/social/messages?id=${encodeURIComponent(id)}&before=${t.start}&limit=${EARLIER_PAGE}`).then((r) => r.json()).catch(() => null);
    if (!d || d.error) return;
    keepAt.current = el ? el.scrollHeight - el.scrollTop : null;
    setT({ ...t, start: d.start, messages: [...d.messages, ...t.messages] });
  }

  const pad = { padding: '10px 14px 14px', fontSize: 12.5, color: '#8b9a9a' };
  if (!keep) return <div style={pad}>Turn on <b>Keep my messages</b> to read them here.</div>;
  if (err) return <div style={{ ...pad, color: '#ff9b9b' }}>{err}</div>;
  if (!t) return <div style={pad}>Opening…</div>;
  if (!t.total) {
    return (
      <div style={pad}>
        No messages are kept for this conversation yet. Choose your export folder again, or sync your messages, to
        bring them in.
      </div>
    );
  }
  return (
    <div ref={scroller} style={{ maxHeight: 440, overflowY: 'auto', padding: '8px 14px 12px', background: 'rgba(0,0,0,0.2)' }}>
      {t.start > 0 && (
        <div style={{ textAlign: 'center', margin: '4px 0 10px' }}>
          <button onClick={earlier} style={{ background: 'rgba(255,255,255,0.06)', border: LINE, borderRadius: 6, color: '#cfe6f7', cursor: 'pointer', fontSize: 12, padding: '4px 12px' }}>
            Show earlier ({t.start.toLocaleString()} more)
          </button>
        </div>
      )}
      {t.messages.map((m, i) => (
        <div key={t.start + i} style={{ display: 'flex', justifyContent: m.fromMe ? 'flex-end' : 'flex-start', margin: '6px 0' }}>
          <div style={{ maxWidth: '72%' }}>
            <div style={{
              padding: '7px 11px', borderRadius: 12, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              background: m.fromMe ? 'rgba(52,152,219,0.35)' : 'rgba(255,255,255,0.08)', color: '#eef',
              borderBottomRightRadius: m.fromMe ? 4 : 12, borderBottomLeftRadius: m.fromMe ? 12 : 4,
            }}
            >
              {m.text || <i style={{ color: '#8b9a9a' }}>(no words: an attachment or a reaction)</i>}
            </div>
            <div style={{ fontSize: 10.5, color: '#778', marginTop: 2, textAlign: m.fromMe ? 'right' : 'left' }}>
              {m.fromMe ? 'You' : group ? 'Someone in the group' : 'Them'} · {when(m.t)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
