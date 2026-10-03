'use client';

// The Social tab's CRM: everyone you've been in touch with on LinkedIn, one
// contact each (lib/social-crm.js), and your own stage, tags, notes and next
// follow-up for them (app/api/social/crm). A list on the left with the views
// and a search box, the person on the right; stacked on a phone.
//
// What it reads: the Conversations list and requests (GET /api/social/messages,
// no words), your network (for tier, company and who can introduce you), and
// the CRM file. What was said shows only while Keep my messages is on (Thread).
// Your notes are always kept: they're yours. Nothing here goes anywhere but
// this computer; the CSV is made in this window and saved where you choose.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildContacts, inboxOf, awaitingOf, followUpsDue, pipelineOf, sentOf, receivedOf, suggestedStage, matchesContact,
  crmCsv, localDay, emptyCrm, STAGES, stageLabel, AWAIT_DAYS,
} from '../../lib/social-crm';
import { keyFor } from '../../lib/separation';
import { Body, LINE } from '../components/ui';
import Thread from './Thread';
import { TIER_COLORS as THEME_TIERS } from '../../lib/themes';

const TIER = THEME_TIERS;   // the theme's dot colours (lib/themes.js)
const STAGE_COLOUR = { new: '#8b9a9a', contacted: '#3498DB', replied: '#00d4aa', meeting: '#ff9f43', won: '#FFD700', 'not-now': '#667' };
const LIST_PAGE = 100;
const DAY = 86400000;
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ymd = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
// Only LinkedIn's own pages go behind "Open on LinkedIn".
const linkedin = (u) => (/^https:\/\/(www\.)?linkedin\.com\//.test(String(u || '')) ? u : null);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const VIEWS = [
  ['inbox', 'Inbox'],
  ['awaiting', 'Awaiting reply'],
  ['due', 'Follow-ups due'],
  ['pipeline', 'Pipeline'],
  ['sent', 'Sent'],
  ['received', 'Received'],
  ['all', 'All'],
];

const chip = (bg, color = '#dfe8e8') => ({ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: bg, color, whiteSpace: 'nowrap' });
const btn = { background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', border: LINE, borderRadius: 6, color: 'var(--sd-fg-1, #cfe6f7)', cursor: 'pointer', fontSize: 12, padding: '4px 10px' };
const field = { padding: '6px 10px', borderRadius: 6, border: LINE, background: 'rgba(var(--sd-shade, 0, 0, 0), 0.3)', color: 'var(--sd-fg-1, #fff)', fontSize: 13 };

/** A download made in this window, as the app's other exports are (lib/galaxy-export.js). */
function save(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // Anything appended to <body> is position: fixed (TRAPS §29). Gone at once.
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function Crm({ net, asOf, keep, onKeep, switching, token, crmToken }) {
  const [data, setData] = useState(null);
  const [crm, setCrm] = useState(null);
  const [view, setView] = useState('inbox');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [picked, setPicked] = useState(null);   // { type: 'person', key } | { type: 'group', id }
  const [shown, setShown] = useState(LIST_PAGE);
  const [note, setNote] = useState(null);
  const panel = useRef(null);

  useEffect(() => {
    let live = true;
    fetch('/api/social/messages').then((r) => r.json()).then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setData({ conversations: [], invitations: [], names: {}, inviteNotes: {} }); });
    return () => { live = false; };
  }, [token, keep]);
  useEffect(() => {
    let live = true;
    fetch('/api/social/crm').then((r) => r.json()).then((d) => { if (live) setCrm(d.crm || emptyCrm()); })
      .catch(() => { if (live) setCrm(emptyCrm()); });
    return () => { live = false; };
  }, [crmToken]);

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

  const pickedKey = picked?.type === 'person' ? picked.key : null;
  const { contacts, groups } = useMemo(() => buildContacts({
    conversations: data?.conversations || [],
    invitations: data?.invitations || [],
    network: net || {},
    crm: crm || emptyCrm(),
    names: data?.names || {},
    also: pickedKey ? [pickedKey] : [],
  }), [data, net, crm, pickedKey]);

  // Anyone's name: a contact's, else the network's, else as the export or the sync spelt it.
  const nameOf = useMemo(() => {
    const byKey = new Map();
    for (const p of [...(net?.degree1 || []), ...(net?.degree2 || [])]) if (!byKey.has(keyFor(p))) byKey.set(keyFor(p), p);
    const names = data?.names || {};
    return (k) => contacts.get(k)?.name || byKey.get(k)?.name || names[k] || null;
  }, [contacts, net, data]);

  const awaitDays = crm?.settings?.awaitDays || AWAIT_DAYS;
  // "Now" for a page with no data yet, and today for follow-ups: when the page opened.
  const [opened] = useState(() => Date.now());
  const now = asOf || opened;
  const today = localDay(new Date(opened));
  const people = useMemo(() => [...contacts.values()], [contacts]);

  // Each view as rows of { type, key | id, sub }: what the list shows under the name.
  const views = useMemo(() => {
    const person = (c, sub) => ({ type: 'person', key: c.key, c, sub, t: c.lastContact || 0 });
    const wrote = (c) => (c.lastFromThem == null ? '' : c.lastFromThem ? `They wrote ${day(c.last)}` : `You wrote ${day(c.last)}`);
    const sentText = (s) => s.items.map((i) => (i.type === 'invite' ? `Request ${day(i.t)} · ${i.status}`
      : i.type === 'request' ? `Tracked request · ${i.status}` : `No reply for ${plural(i.waited, 'day')}`)).join(' · ');
    // In All, the most telling thing about each: the last word, else a request, else your stage.
    const gist = (c) => wrote(c)
      || (c.invitesOut[0] ? `You asked to connect ${day(c.invitesOut[0].t)}` : '')
      || (c.invitesIn[0] ? `Asked to connect ${day(c.invitesIn[0].t)}` : '')
      || (c.request ? `Tracked request · ${c.request.status}` : '')
      || (c.crm?.stage ? stageLabel(c.crm.stage) : '');
    const all = people.filter((c) => c.lastContact || c.crm || c.request).map((c) => person(c, gist(c)));
    for (const g of groups) all.push({ type: 'group', id: g.id, g, sub: g.last ? `${g.lastFromThem ? 'Someone wrote' : 'You wrote'} ${day(g.last)}` : '', t: g.last || 0 });
    all.sort((a, b) => b.t - a.t);
    return {
      inbox: inboxOf(people).map((c) => person(c, c.unread > 0 ? `${c.unread} unread · ${wrote(c)}` : wrote(c))),
      awaiting: awaitingOf(people, now, awaitDays).map((a) => person(a.contact, `You wrote ${day(a.contact.last)}, no reply for ${plural(a.waited, 'day')}`)),
      due: followUpsDue(people, today).map((c) => person(c, c.crm.followUp === today ? 'Follow up today' : `Follow up was due ${ymd(c.crm.followUp)}`)),
      pipeline: pipelineOf(people),
      sent: sentOf(people, now, awaitDays).map((s) => person(s.contact, sentText(s))),
      received: receivedOf(people).map((r) => person(r.contact, `Asked to connect ${day(r.t)}`)),
      all,
    };
  }, [people, groups, now, awaitDays, today]);

  const said = keep && hits?.q === q.trim() ? hits.ids : null;
  const words = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = view === 'pipeline' ? [] : views[view];
    if (!words) return list;
    const found = list.filter((r) => (r.type === 'person'
      ? matchesContact(r.c, words, said)
      : String(r.g.title || '').toLowerCase().includes(words) || r.g.people.some((k) => String(nameOf(k) || '').toLowerCase().includes(words)) || said?.has(r.g.id)));
    // In All, anyone in your network matches too, so you can add a note to
    // someone you haven't been in touch with yet.
    if (view === 'all' && words.length >= 2 && net) {
      const have = new Set(found.map((r) => r.key));
      const seen = new Set();
      for (const p of [...(net.degree1 || []), ...(net.degree2 || [])]) {
        const k = keyFor(p);
        if (have.has(k) || seen.has(k)) continue;
        if (![p.name, p.company, p.role, p.headline].some((x) => String(x || '').toLowerCase().includes(words))) continue;
        seen.add(k);
        found.push({ type: 'person', key: k, c: null, row: p, sub: 'Nothing on file yet', t: 0 });
        if (seen.size >= 50) break;
      }
    }
    return found;
  }, [views, view, words, said, net, nameOf]);

  const pipeline = useMemo(() => {
    if (view !== 'pipeline') return null;
    const out = {};
    for (const [id, list] of Object.entries(views.pipeline)) out[id] = words ? list.filter((c) => matchesContact(c, words, said)) : list;
    return out;
  }, [views, view, words, said]);

  const counts = {
    inbox: views.inbox.length,
    awaiting: views.awaiting.length,
    due: views.due.length,
    pipeline: Object.values(views.pipeline).reduce((n, l) => n + l.length, 0),
    sent: views.sent.length,
    received: views.received.length,
    all: views.all.length,
  };

  function pick(p) {
    setPicked(p);
    // Stacked (a phone): the person's panel is below the list, so go there.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches) {
      setTimeout(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  async function change(key, set) {
    const r = await fetch('/api/social/crm', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, set }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That couldn’t be saved.');
    setCrm((cur) => {
      const next = { ...(cur || emptyCrm()), people: { ...(cur?.people || {}) } };
      if (d.entry) next.people[key] = d.entry;
      else delete next.people[key];
      return next;
    });
  }

  async function setAwaitDays(n) {
    const r = await fetch('/api/social/crm', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { awaitDays: n } }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setCrm((cur) => ({ ...(cur || emptyCrm()), settings: d.settings }));
  }

  // Your notes can outlive Forget it (it asks); this is the way to delete them on their own.
  async function deleteNotes() {
    if (!window.confirm('Delete your CRM: every stage, tag, note and follow-up date you added? This can’t be undone.')) return;
    await fetch('/api/social/crm', { method: 'DELETE' });
    setCrm(emptyCrm());
    setNote('Your CRM notes are deleted.');
  }

  function exportCsv() {
    const list = people.filter((c) => c.kind !== 'sponsored').sort((a, b) => (b.lastContact || 0) - (a.lastContact || 0));
    const name = `Six Degrees CRM ${localDay()}.csv`;
    save(crmCsv(list), name);
    // The page can't see where the file went: a browser puts it in its
    // downloads folder, the Mac app asks where to save it.
    setNote(`Made “${name}” (${plural(list.length, 'person', 'people')}). Look for it in your Downloads folder, or wherever you chose to save it. It holds your notes: keep it private.`);
  }

  const loading = !data || !crm || !net;
  const box = { padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', marginTop: 10 };
  const selectedGroup = picked?.type === 'group' ? groups.find((g) => g.id === picked.id) : null;
  const selected = pickedKey ? contacts.get(pickedKey) : null;

  return (
    <>
      <div style={box}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: 'var(--sd-fg-1, #fff)', cursor: switching ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={keep} disabled={switching} onChange={(e) => onKeep(e.target.checked)} />
          <b>Keep my messages on this computer</b>
          <span style={{ fontSize: 11.5, color: keep ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-3, #8b9a9a)' }}>{keep ? 'on' : 'off'}</span>
        </label>
        <Body style={{ margin: '6px 0 0', fontSize: 12.5 }}>
          Off unless you turn it on. When it&rsquo;s on, the messages themselves, including what other people wrote to
          you, and the notes sent with connection requests, are saved only in the app&rsquo;s data folder on this
          computer. They&rsquo;re never sent anywhere, and they aren&rsquo;t in &ldquo;Save a copy of my
          network&rdquo;. <i>Forget it</i>, or switching this off, deletes them. With it off, the CRM still shows who,
          when and who wrote last. Your own stages, tags, notes and follow-ups are always kept, on this computer only.
        </Body>
      </div>

      <div className="crm-grid" style={{ marginTop: 10 }}>
        <div className={view === 'pipeline' ? 'crm-wide' : undefined} style={{ ...box, marginTop: 0, padding: 0, minWidth: 0 }}>
          <div role="tablist" aria-label="CRM views" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '10px 10px 6px', borderBottom: LINE }}>
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={view === id}
                onClick={() => { setView(id); setShown(LIST_PAGE); }}
                style={{
                  ...btn, padding: '4px 9px', fontSize: 12,
                  background: view === id ? 'rgba(52,152,219,0.28)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.04)',
                  color: view === id ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-2, #b8c4c4)',
                }}
              >
                {label} <span style={{ color: view === id ? 'var(--sd-fg-1, #cfe6f7)' : 'var(--sd-fg-4, #778)' }}>{loading ? '' : counts[id].toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: '8px 10px', borderBottom: LINE, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(LIST_PAGE); }}
              placeholder={keep ? 'Search names, companies, tags, notes, what was said' : 'Search names, companies, tags, notes'}
              aria-label="Search the CRM"
              style={{ ...field, flex: '1 1 180px', minWidth: 0 }}
            />
            <button onClick={exportCsv} disabled={loading} style={btn} title="A spreadsheet of everyone here, with your stages, tags, follow-ups and notes">Export CSV</button>
          </div>
          {view === 'awaiting' && (
            <div style={{ padding: '8px 12px', borderBottom: LINE, fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              You wrote last and nothing came back for
              <input
                type="number" min={1} max={365} value={awaitDays} aria-label="Days with no reply"
                onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 365) setAwaitDays(n); }}
                style={{ ...field, width: 64, padding: '3px 6px' }}
              />
              days or more{asOf ? `, as of ${day(asOf)}` : ''}.
            </div>
          )}
          {note && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--sd-green, #00ff88)', borderBottom: LINE }}>{note}</div>}

          {loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>Loading…</div>}
          {!loading && view === 'pipeline' && <Board pipeline={pipeline} picked={pickedKey} onPick={(key) => pick({ type: 'person', key })} />}
          {!loading && view !== 'pipeline' && rows.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>{words ? 'Nothing matches that.' : EMPTY[view]}</div>
          )}
          {!loading && view !== 'pipeline' && (
            <div>
              {rows.slice(0, shown).map((r) => (
                <Row
                  key={r.type === 'person' ? `p:${r.key}` : `g:${r.id}`}
                  r={r}
                  nameOf={nameOf}
                  active={r.type === 'person' ? pickedKey === r.key : picked?.id === r.id}
                  onPick={() => pick(r.type === 'person' ? { type: 'person', key: r.key } : { type: 'group', id: r.id })}
                />
              ))}
              {rows.length > shown && (
                <button onClick={() => setShown(shown + LIST_PAGE)} style={{ width: '100%', padding: 10, background: 'none', border: 'none', color: 'var(--sd-blue, #3498DB)', cursor: 'pointer', fontSize: 13 }}>
                  Show {Math.min(LIST_PAGE, rows.length - shown).toLocaleString()} more of {rows.length.toLocaleString()}
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={panel} className={view === 'pipeline' ? 'crm-wide' : undefined} style={{ ...box, marginTop: 0, minWidth: 0, scrollMarginTop: 80 }}>
          {!picked && <div style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>Pick someone to see everything with them, and to add a stage, tags, notes or a follow-up.</div>}
          {selected && (
            <Person
              key={selected.key}
              c={selected}
              nameOf={nameOf}
              groups={groups}
              keep={keep}
              token={token}
              inviteNotes={data?.inviteNotes || {}}
              onChange={change}
              onPickGroup={(id) => pick({ type: 'group', id })}
            />
          )}
          {selectedGroup && (
            <Group g={selectedGroup} contacts={contacts} nameOf={nameOf} keep={keep} token={token} onPick={(key) => pick({ type: 'person', key })} />
          )}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #778)', marginTop: 6 }}>
        Everyone from your export and the live sync, connections or not; groups are listed and marked. Sponsored
        messages are marked and kept out of the Inbox. Awaiting reply and warmth are judged as of the newest thing
        your data knows.
        {Object.keys(crm?.people || {}).length > 0 && (
          <>
            {' '}Your notes are in the app&rsquo;s data folder, not in &ldquo;Save a copy of my network&rdquo;.{' '}
            <button onClick={deleteNotes} style={{ background: 'none', border: 'none', color: 'var(--sd-fg-2, #ff9b9b)', cursor: 'pointer', fontSize: 11.5, padding: 0 }}>Delete my CRM notes</button>
          </>
        )}
      </div>
    </>
  );
}

const EMPTY = {
  inbox: 'No one is waiting on a reply.',
  awaiting: 'Nobody you wrote to is overdue a reply.',
  due: 'No follow-ups are due. Set one on anyone, and it shows here on the day.',
  sent: 'Nothing sent yet: choose your export folder above (its Invitations.csv), or mark requests sent in the app.',
  received: 'No requests waiting on you, as far as your export shows.',
  all: 'Nobody here yet. Choose your export folder above, or sync your messages.',
};

function Dot({ tier }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[tier] || '#556', flexShrink: 0, display: 'inline-block' }} />;
}

function Badges({ c }) {
  return (
    <>
      {c && !c.connection && <span style={chip('rgba(255,159,67,0.18)', '#ffc58a')}>{c.degree === 2 ? '2nd degree' : 'Not a connection'}</span>}
      {c?.kind === 'sponsored' && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.08)')}>Sponsored</span>}
      {c?.kind === 'inmail' && <span style={chip('rgba(155,89,182,0.25)')}>InMail</span>}
      {c?.crm?.stage && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.06)', STAGE_COLOUR[c.crm.stage])}>{stageLabel(c.crm.stage)}</span>}
    </>
  );
}

function Row({ r, nameOf, active, onPick }) {
  let title;
  let tier = null;
  let extra = null;
  if (r.type === 'person') {
    const c = r.c;
    title = c?.name || r.row?.name || r.key;
    tier = c?.row?.tier || r.row?.tier;
    extra = (
      <>
        <Badges c={c || { connection: r.row?.degree === 1, degree: r.row?.degree }} />
        {c?.unread > 0 && <span style={chip('#3498DB', '#fff')}>{c.unread} unread</span>}
      </>
    );
  } else {
    title = groupLabel(r.g, nameOf);
    extra = <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.08)')}>{r.g.unknown ? 'To someone unnamed' : 'Group'}</span>;
  }
  const company = r.type === 'person' ? (r.c?.row?.company || r.row?.company) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      style={{ padding: '8px 12px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)', cursor: 'pointer', background: active ? 'rgba(52,152,219,0.14)' : 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0, flexWrap: 'wrap' }}>
        <Dot tier={tier} />
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{title}</b>
        {extra}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 2, paddingLeft: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {[company, r.sub].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function groupLabel(g, nameOf) {
  if (g.title) return g.title;
  if (g.unknown) return 'A conversation only you wrote in';
  const names = g.people.map(nameOf).filter(Boolean);
  return names.length ? `${names.slice(0, 3).join(', ')}${g.people.length > 3 ? ` +${g.people.length - 3}` : ''}` : `${g.people.length} people`;
}

function Board({ pipeline, picked, onPick }) {
  return (
    <div className="crm-board">
      {STAGES.map((s) => (
        <div key={s.id} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 650, color: STAGE_COLOUR[s.id], margin: '0 0 6px', display: 'flex', justifyContent: 'space-between' }}>
            <span>{s.label}</span>
            <span style={{ color: 'var(--sd-fg-4, #778)' }}>{pipeline[s.id].length.toLocaleString()}</span>
          </div>
          {pipeline[s.id].length === 0 && <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #667)', padding: '6px 0' }}>No one</div>}
          {pipeline[s.id].slice(0, 200).map((c) => (
            <div
              key={c.key}
              role="button"
              tabIndex={0}
              onClick={() => onPick(c.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c.key); } }}
              style={{
                padding: '7px 9px', marginBottom: 6, borderRadius: 6, border: LINE, cursor: 'pointer', fontSize: 12.5,
                background: picked === c.key ? 'rgba(52,152,219,0.18)' : 'rgba(var(--sd-ink, 255, 255, 255), 0.03)',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Dot tier={c.row?.tier} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b></div>
              <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 11, marginTop: 2 }}>
                {[c.row?.company, c.crm.followUp ? `Follow up ${ymd(c.crm.followUp)}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
          {pipeline[s.id].length > 200 && <div style={{ fontSize: 11, color: 'var(--sd-fg-4, #778)' }}>and {(pipeline[s.id].length - 200).toLocaleString()} more (search to find them)</div>}
        </div>
      ))}
    </div>
  );
}

const h4 = { fontSize: 12, fontWeight: 650, color: 'var(--sd-fg-2, #b8c4c4)', margin: '16px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 };

function Person({ c, nameOf, groups, keep, token, inviteNotes, onChange, onPickGroup }) {
  const row = c.row;
  const [open, setOpen] = useState(c.conversations[0]?.id || null);
  const profile = linkedin(c.profileUrl);
  const thread = linkedin(c.threadUrl);
  const how = c.connection
    ? `A connection${row?.connected_date ? ` since ${day(Date.parse(row.connected_date))}` : ''}.`
    : c.degree === 2 ? '2nd degree: not a connection yet.' : 'Not a connection.';
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Dot tier={row?.tier} />
        <h3 style={{ margin: 0, fontSize: 17 }}>{c.name}</h3>
        {row?.tier && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.06)', TIER[row.tier])}>{row.tier} tier</span>}
        <Badges c={c} />
      </div>
      {(row?.headline || row?.company) && (
        <div style={{ color: 'var(--sd-fg-2, #b8c4c4)', marginTop: 4 }}>{row.headline || [row.role, row.company].filter(Boolean).join(' at ')}</div>
      )}
      <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4, fontSize: 12.5 }}>
        {how}
        {c.introducers.length > 0 && <> Who can introduce you: <b style={{ color: 'var(--sd-fg-1, #dfe8e8)' }}>{c.introducers.slice(0, 6).join(', ')}</b>{c.introducers.length > 6 ? ` and ${c.introducers.length - 6} more` : ''}.</>}
        {row?.unlocked_from_name && c.connection && <> You met through <b style={{ color: 'var(--sd-fg-1, #dfe8e8)' }}>{row.unlocked_from_name}</b>.</>}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
        {profile && <a href={profile} target="_blank" rel="noreferrer" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Profile on LinkedIn ↗</a>}
        {thread && <a href={thread} target="_blank" rel="noreferrer" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Conversation on LinkedIn ↗</a>}
      </div>

      <Yours c={c} onChange={onChange} />

      <div style={h4}>Conversations</div>
      {c.conversations.length === 0 && <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5 }}>None one to one.</div>}
      {c.conversations.map((conv) => (
        <div key={conv.id} style={{ border: LINE, borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={open === conv.id}
            onClick={() => setOpen(open === conv.id ? null : conv.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === conv.id ? null : conv.id); } }}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 10px', cursor: 'pointer', fontSize: 12.5, background: open === conv.id ? 'rgba(var(--sd-ink, 255, 255, 255), 0.04)' : 'none' }}
          >
            <span style={{ color: 'var(--sd-fg-1, #dfe8e8)' }}>{day(conv.last) || 'No date'}</span>
            {conv.lastFromThem != null && <span style={{ color: conv.lastFromThem ? '#ff9f43' : 'var(--sd-fg-3, #8b9a9a)' }}>{conv.lastFromThem ? 'They wrote last' : 'You wrote last'}</span>}
            {conv.count != null && <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>{plural(conv.count, 'message')}</span>}
            {conv.mine != null && conv.count != null && conv.mine === conv.count && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.06)')}>Only you wrote</span>}
            {conv.folder && conv.folder !== 'inbox' && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.06)')}>{conv.folder}</span>}
            {conv.kind === 'inmail' && <span style={chip('rgba(155,89,182,0.25)')}>InMail</span>}
            {conv.kind === 'sponsored' && <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.08)')}>Sponsored</span>}
            {conv.unread > 0 && <span style={chip('#3498DB', '#fff')}>{conv.unread} unread</span>}
          </div>
          {open === conv.id && <Thread key={`${conv.id}:${token}:${keep}`} id={conv.id} keep={keep} group={false} token={token} />}
        </div>
      ))}
      {c.groups.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4 }}>
          Also in {plural(c.groups.length, 'group')}:{' '}
          {c.groups.slice(0, 8).map((id, i) => {
            const g = groups.find((x) => x.id === id);
            return (
              <span key={id}>
                {i > 0 ? ', ' : ''}
                <button onClick={() => onPickGroup(id)} style={{ background: 'none', border: 'none', color: 'var(--sd-blue, #3498DB)', cursor: 'pointer', padding: 0, fontSize: 12.5 }}>{g ? groupLabel(g, nameOf) : 'a group'}</button>
              </span>
            );
          })}
        </div>
      )}

      <div style={h4}>Requests</div>
      {c.invitesOut.length + c.invitesIn.length === 0 && !c.request && <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', fontSize: 12.5 }}>None on file.</div>}
      {[...c.invitesOut, ...c.invitesIn].sort((a, b) => (b.t || 0) - (a.t || 0)).map((inv) => (
        <div key={inv.id} style={{ fontSize: 12.5, marginBottom: 6 }}>
          <span style={{ color: 'var(--sd-fg-1, #dfe8e8)' }}>{inv.dir === 'out' ? 'You asked to connect' : 'They asked to connect'}</span>
          <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}> · {day(inv.t) || 'no date'} · {c.connection ? 'accepted' : inv.dir === 'out' ? 'pending' : 'not accepted yet'}</span>
          {keep && inviteNotes[inv.id] && <div style={{ marginTop: 3, padding: '6px 9px', borderRadius: 8, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{inviteNotes[inv.id]}</div>}
        </div>
      ))}
      {c.request && (
        <div style={{ fontSize: 12.5 }}>
          <span style={{ color: 'var(--sd-fg-1, #dfe8e8)' }}>Request tracked in the app</span>
          <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}> · {c.request.status}</span>
        </div>
      )}
    </div>
  );
}

/** Your part: stage, follow-up, tags and notes, each saved as you change it. */
function Yours({ c, onChange }) {
  const entry = c.crm || {};
  const [notes, setNotes] = useState(entry.notes || '');
  const [tag, setTag] = useState('');
  const [state, setState] = useState(null);
  const timer = useRef(null);
  const suggested = suggestedStage(c);

  async function put(set) {
    setState('Saving…');
    try {
      await onChange(c.key, set);
      setState('Saved');
    } catch (e) {
      setState(e.message);
    }
  }
  // Notes save a moment after typing stops, and when you leave the box.
  function typed(v) {
    setNotes(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => put({ notes: v }), 800);
  }
  function leave() {
    clearTimeout(timer.current);
    if (notes !== (entry.notes || '')) put({ notes });
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  const addDays = (n) => localDay(new Date(Date.now() + n * DAY));
  const tags = entry.tags || [];
  function addTag() {
    const t = tag.trim();
    if (!t) return;
    setTag('');
    put({ tags: [...tags, ...t.split(',')] });
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(52,152,219,0.06)', border: '1px solid rgba(52,152,219,0.18)' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          Stage
          <select value={entry.stage || ''} onChange={(e) => put({ stage: e.target.value || null })} style={{ ...field, padding: '5px 8px' }}>
            <option value="">Not set (looks like {stageLabel(suggested)})</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11.5, color: 'var(--sd-fg-3, #8b9a9a)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          Next follow-up
          <input type="date" value={entry.followUp || ''} onChange={(e) => put({ followUp: e.target.value || null })} style={{ ...field, padding: '4px 8px', colorScheme: 'dark' }} />
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => put({ followUp: addDays(3) })} style={btn}>In 3 days</button>
          <button onClick={() => put({ followUp: addDays(7) })} style={btn}>In a week</button>
          {entry.followUp && <button onClick={() => put({ followUp: null })} style={btn}>Clear</button>}
        </div>
      </div>
      {entry.stage == null && suggested !== 'new' && (
        <button onClick={() => put({ stage: suggested })} style={{ ...btn, marginTop: 8 }}>Set to {stageLabel(suggested)}</button>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {tags.map((t) => (
          <span key={t} style={{ ...chip('rgba(var(--sd-ink, 255, 255, 255), 0.08)'), fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {t}
            <button aria-label={`Remove ${t}`} onClick={() => put({ tags: tags.filter((x) => x !== t) })} style={{ background: 'none', border: 'none', color: 'var(--sd-fg-3, #8b9a9a)', cursor: 'pointer', padding: 0, fontSize: 12 }}>×</button>
          </span>
        ))}
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          onBlur={addTag}
          placeholder="Add a tag"
          aria-label="Add a tag"
          style={{ ...field, padding: '3px 8px', fontSize: 12, width: 120 }}
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => typed(e.target.value)}
        onBlur={leave}
        placeholder="Your notes on them: kept on this computer only"
        aria-label="Notes"
        rows={4}
        style={{ ...field, width: '100%', marginTop: 10, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45, boxSizing: 'border-box' }}
      />
      <div style={{ fontSize: 11, color: state && state !== 'Saved' && state !== 'Saving…' ? 'var(--sd-fg-2, #ff9b9b)' : 'var(--sd-fg-4, #778)', marginTop: 4, minHeight: 14 }}>{state || ''}</div>
    </div>
  );
}

function Group({ g, contacts, nameOf, keep, token, onPick }) {
  const href = linkedin(g.threadUrl);
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>{groupLabel(g, nameOf)}</h3>
        <span style={chip('rgba(var(--sd-ink, 255, 255, 255), 0.08)')}>{g.unknown ? 'To someone unnamed' : 'Group'}</span>
        {g.unread > 0 && <span style={chip('#3498DB', '#fff')}>{g.unread} unread</span>}
      </div>
      <div style={{ color: 'var(--sd-fg-3, #8b9a9a)', marginTop: 4, fontSize: 12.5 }}>
        {[g.last ? `Last active ${day(g.last)}` : null, g.count != null ? plural(g.count, 'message') : null].filter(Boolean).join(' · ')}
      </div>
      {href && <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none', fontSize: 12.5, display: 'inline-block', marginTop: 6 }}>Conversation on LinkedIn ↗</a>}
      {g.people.length > 0 && (
        <>
          <div style={h4}>Who&rsquo;s in it</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.people.map((k) => {
              const p = contacts.get(k);
              return (
                <button key={k} onClick={() => onPick(k)} style={{ ...btn, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Dot tier={p?.row?.tier} />{nameOf(k) || k.split('/').pop()}
                  {p && !p.connection && <span style={{ color: 'var(--sd-fg-2, #ffc58a)', fontSize: 10.5 }}>not a connection</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div style={h4}>Messages</div>
      <div style={{ border: LINE, borderRadius: 6, overflow: 'hidden' }}>
        <Thread key={`${g.id}:${token}:${keep}`} id={g.id} keep={keep} group token={token} />
      </div>
    </div>
  );
}
