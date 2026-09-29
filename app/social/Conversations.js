'use client';

// The Social tab's Conversations: every conversation with one of your
// connections, from your export and the live messages sync
// (app/api/social/messages). The list is only who, when, who wrote last,
// unread and how many. The messages themselves show only while Keep my
// messages is on, and live only in the app's data folder (lib/social-store.js).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sortConversations } from '../../lib/linkedin-export';
import { Body, LINE } from '../components/ui';

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];
const LIST_PAGE = 100;
const THREAD_PAGE = 100;
const EARLIER_PAGE = 200;
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const slug = (u) => String(u || '').replace(/\/+$/, '').split('/').pop();
// Only LinkedIn's own pages go behind "Open on LinkedIn".
const linkedin = (u) => (/^https:\/\/(www\.)?linkedin\.com\//.test(String(u || '')) ? u : null);

export default function Conversations({ byKey, connected, ready, keep, onKeep, switching, token }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(LIST_PAGE);

  useEffect(() => {
    let live = true;
    fetch('/api/social/messages').then((r) => r.json()).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ conversations: [] }); });
    return () => { live = false; };
  }, [token, keep]);

  // Searching the words happens where they're kept, a moment after typing stops.
  useEffect(() => {
    const words = q.trim();
    if (!keep || words.length < 2) return undefined;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/social/messages?q=${encodeURIComponent(words)}`).then((r) => r.json())
        .then((d) => { if (live) setHits({ q: words, ids: new Set(d.ids || []) }); }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, keep, token]);

  // Only conversations with one of your connections; a group counts when at
  // least one of them is in it. The rest are counted, not shown.
  const { rows, leftOut } = useMemo(() => {
    const all = data?.conversations || [];
    const mine = all.filter((c) => c.people.some((k) => connected.has(k)));
    const withPeople = mine.map((c) => {
      const persons = c.people.map((k) => byKey.get(k)).filter(Boolean);
      const tier = TIER_ORDER.find((t) => persons.some((p) => p.tier === t)) || null;
      return { ...c, persons, tier };
    });
    return { rows: sortConversations(withPeople, (c) => c.tier), leftOut: all.length - mine.length };
  }, [data, byKey, connected]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase();
    if (!words) return rows;
    // Word matches count only for what's typed now, and only while they're kept.
    const said = keep && hits?.q === q.trim() ? hits.ids : null;
    return rows.filter((c) => c.persons.some((p) => String(p.name || '').toLowerCase().includes(words))
      || String(c.title || '').toLowerCase().includes(words)
      || said?.has(c.id));
  }, [rows, q, hits, keep]);

  const box = { padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(255,255,255,0.03)', marginTop: 10 };

  return (
    <>
      <div style={box}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: '#fff', cursor: switching ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={keep} disabled={switching} onChange={(e) => onKeep(e.target.checked)} />
          <b>Keep my messages on this computer</b>
          <span style={{ fontSize: 11.5, color: keep ? '#00ff88' : '#8b9a9a' }}>{keep ? 'on' : 'off'}</span>
        </label>
        <Body style={{ margin: '6px 0 0', fontSize: 12.5 }}>
          Off unless you turn it on. When it&rsquo;s on, the messages themselves, including what other people wrote to
          you, are saved only in the app&rsquo;s data folder on this computer. They&rsquo;re never sent anywhere, and
          they aren&rsquo;t in &ldquo;Save a copy of my network&rdquo;. <i>Forget it</i>, or switching this off, deletes
          them. With it off, the list below still shows who, when and who wrote last.
        </Body>
      </div>

      <div style={{ ...box, padding: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: LINE, display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setShown(LIST_PAGE); }}
            placeholder={keep ? 'Search by name or by what was said' : 'Search by name'}
            aria-label="Search conversations"
            style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 6, border: LINE, background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: '#8b9a9a', whiteSpace: 'nowrap' }}>
            {filtered.length.toLocaleString()} {filtered.length === 1 ? 'conversation' : 'conversations'}
          </span>
        </div>
        {(!data || !ready) && <div style={{ padding: 12, fontSize: 13, color: '#8b9a9a' }}>Loading…</div>}
        {data && ready && rows.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: '#8b9a9a' }}>
            No conversations with your connections yet. Choose your export folder above, or sync your messages.
          </div>
        )}
        {data && ready && rows.length > 0 && filtered.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: '#8b9a9a' }}>Nothing matches that.</div>
        )}
        {ready && filtered.slice(0, shown).map((c) => (
          <Row key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} keep={keep} token={token} />
        ))}
        {ready && filtered.length > shown && (
          <button onClick={() => setShown(shown + LIST_PAGE)} style={{ width: '100%', padding: 10, background: 'none', border: 'none', color: '#3498DB', cursor: 'pointer', fontSize: 13 }}>
            Show {Math.min(LIST_PAGE, filtered.length - shown).toLocaleString()} more
          </button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: '#778', marginTop: 6 }}>
        Waiting on you first (they wrote last), then S and A tier, then the most recent. Groups are shown but not
        counted in warmth.{leftOut > 0 ? ` ${leftOut.toLocaleString()} ${leftOut === 1 ? 'conversation is' : 'conversations are'} with people who aren’t your connections and aren’t shown.` : ''}
      </div>
    </>
  );
}

function Row({ c, open, onToggle, keep, token }) {
  const one = !c.group ? c.persons[0] : null;
  const names = c.persons.map((p) => p.name).filter(Boolean);
  const label = c.group
    ? (c.title || (names.length ? `${names.slice(0, 3).join(', ')}${c.people.length > 3 ? ` +${c.people.length - 3}` : ''}` : `${c.people.length} people`))
    : (one?.name || slug(c.people[0]));
  const href = linkedin(c.threadUrl) || (!c.group ? linkedin(one?.profile_url || c.people[0]) : null);
  const waiting = !c.group && c.lastFromThem === true;
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer', background: open ? 'rgba(255,255,255,0.04)' : 'none' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[c.tier] || '#556', flexShrink: 0 }} />
        <span style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b>{label}</b>
          {c.group && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: '#b8c4c4' }}>Group</span>}
          {one?.company ? <span style={{ color: '#8b9a9a' }}> · {one.company}</span> : null}
        </span>
        {c.unread > 0 && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#3498DB', color: '#fff' }}>{c.unread} unread</span>}
        {c.lastFromThem != null && (
          <span style={{ color: waiting ? '#ff9f43' : '#8b9a9a', fontSize: 12, whiteSpace: 'nowrap' }}>{c.lastFromThem ? 'They wrote last' : 'You wrote last'}</span>
        )}
        <span style={{ color: '#b8c4c4', fontSize: 12, whiteSpace: 'nowrap', minWidth: 86, textAlign: 'right' }}>{day(c.last)}</span>
        <span style={{ color: '#8b9a9a', fontSize: 12, whiteSpace: 'nowrap', minWidth: 74, textAlign: 'right' }}>
          {c.count != null ? `${c.count.toLocaleString()} ${c.count === 1 ? 'message' : 'messages'}` : ''}
        </span>
        {href
          ? <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#3498DB', textDecoration: 'none', whiteSpace: 'nowrap', fontSize: 12 }}>Open on LinkedIn ↗</a>
          : <span style={{ minWidth: 104 }} />}
      </div>
      {open && <Thread key={`${c.id}:${token}:${keep}`} id={c.id} keep={keep} group={c.group} token={token} />}
    </div>
  );
}

// One conversation's messages, newest at the bottom, a page at a time: the
// newest 100 first and 200 more each time you ask, so a thread of thousands
// opens as fast as a short one.
function Thread({ id, keep, group, token }) {
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

  const pad = { padding: '10px 14px 14px 32px', fontSize: 12.5, color: '#8b9a9a' };
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
