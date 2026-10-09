'use client';

// Social (experimental): what your own LinkedIn data says about your
// relationships (lib/linkedin-export.js). Two sources, both yours:
//   - the export LinkedIn emails you (Settings → Data privacy → Get a copy of
//     your data), read here in the browser: full history, no traffic to LinkedIn;
//   - an experimental live sync (the scanner's --messages): your messages list,
//     read once in your own Chrome, by hand or once a day.
// Kept on this computer: dates, who wrote last and counts, the names of people
// who aren't your connections, and the messages themselves (and the notes sent
// with requests) only if you turn on Keep my messages, in a file of their own
// that switching it off deletes. The CRM (Crm.js) is the main section: everyone
// you've been in touch with, and your own stage, tags, notes and follow-ups.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../components/UserProvider';
import { loadNetwork } from '../../lib/network';
import {
  readTable, messageStats, careerChapters, postingEffect, invitationSplit, warmthOf, buildConversations, conversationSummary, buildInvitations,
} from '../../lib/linkedin-export';
import { mergeSocial } from '../../lib/galaxy-lab';
import { keyFor } from '../../lib/separation';
import { runScrape, watchScanner, scannerNow } from '../../lib/scraper-client';
import { Body, LINE, FONT } from '../components/ui';
import { IS_DEMO } from '../../lib/demo';
import Crm from './Crm';

const WARMTH = { warm: ['Warm', '#ff9f43'], cool: ['Cool', '#3498DB'], dormant: ['Dormant', '#8899aa'], never: ['Never messaged', '#556'] };
const FILES = { 'connections.csv': 'first name', 'messages.csv': 'conversation id', 'invitations.csv': 'direction', 'positions.csv': 'company name', 'shares.csv': 'date' };
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
// Messages go to the server in parts of about this many characters: a request
// here can carry 10 MB, and a character can take up to 3 bytes.
const PART_CHARS = 2_500_000;

/** An import's messages, in parts that each fit in one request. */
async function sendMessages(conversations) {
  const parts = [];
  let cur = {};
  let size = 0;
  for (const c of conversations) {
    for (const m of c.messages) {
      const n = JSON.stringify(m).length + 2;
      if (size + n > PART_CHARS && size > 0) { parts.push(cur); cur = {}; size = 0; }
      if (!cur[c.id]) { cur[c.id] = { title: c.title || '', messages: [] }; size += c.id.length + (c.title || '').length + 40; }
      cur[c.id].messages.push(m);
      size += n;
    }
  }
  parts.push(cur);
  for (let i = 0; i < parts.length; i++) {
    const r = await fetch('/api/social/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part: i, parts: parts.length, threads: parts[i] }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The messages couldn’t be saved.');
  }
}

/** The notes sent with requests, when the messages are kept: they ride in the same file and go with it. */
async function sendInviteNotes(invitations) {
  const invites = {};
  for (const i of invitations) if (i.note) invites[i.id] = i.note;
  const r = await fetch('/api/social/messages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invites }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The requests’ notes couldn’t be saved.');
}

/**
 * Social, the CRM and your LinkedIn export, as part of Outlink (Blake,
 * 2026-10-02: "make outlink a one thing with the dms follow up and etc mixed
 * with the social aspect of adding those people and keeping track"). `embedded`
 * leaves out its own header: Outlink's tabs and notch are above it.
 */
export default function SocialHub({ embedded = false }) {
  const { userId } = useUser();
  const [social, setSocial] = useState(undefined);
  const [net, setNet] = useState(null);
  const [keepEmails, setKeepEmails] = useState(false);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(() => scannerNow());
  const [switching, setSwitching] = useState(false);
  const [listToken, setListToken] = useState(0);
  const [crmToken, setCrmToken] = useState(0);
  // The last export's messages.csv and Invitations.csv, in this window only, so
  // turning Keep my messages on right after an import needn't ask for the folder again.
  const lastMessages = useRef(null);
  const lastInvites = useRef(null);
  const keep = social?.keepMessages === true;

  // The Conversations list reads again whenever this does (listToken).
  const reload = () => fetch('/api/social').then((r) => r.json()).then((d) => setSocial(d.social || null)).catch(() => setSocial(null))
    .finally(() => setListToken((n) => n + 1));
  useEffect(() => { reload(); }, []);
  useEffect(() => watchScanner(() => setJob(scannerNow())), []);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    loadNetwork(userId).then((n) => { if (live) setNet(n); }).catch(() => {});
    return () => { live = false; };
  }, [userId]);

  async function importFolder(list) {
    setBusy(true);
    setNote(null);
    try {
      const found = {};
      for (const f of Array.from(list || [])) {
        const name = f.name.toLowerCase();
        if (FILES[name] && !found[name]) found[name] = readTable(await f.text(), FILES[name]);
      }
      if (!Object.keys(found).length) throw new Error('That folder doesn’t have the data export’s files in it (Connections.csv, messages.csv and so on).');
      const conns = found['connections.csv'] || [];
      const stats = found['messages.csv'] ? messageStats(found['messages.csv']) : { asOf: null, people: new Map() };
      // The words are read out of messages.csv only when Keep my messages is on.
      const built = found['messages.csv'] ? buildConversations(found['messages.csv'], { keepText: keep }) : null;
      const invitations = found['invitations.csv'] ? buildInvitations(found['invitations.csv'], { keepText: keep }) : null;
      lastMessages.current = found['messages.csv'] || null;
      lastInvites.current = found['invitations.csv'] || null;
      const people = {};
      for (const [url, v] of stats.people) people[url] = { last: v.last, lastFromThem: v.lastFromThem, total: v.total, recent: v.recent };
      if (keepEmails) {
        for (const c of conns) {
          const e = c['email address'];
          if (!e) continue;
          const k = keyFor({ profile_url: c.url });
          people[k] = { ...(people[k] || {}), email: e };
        }
      }
      const asOf = stats.asOf || Date.now();
      const body = {
        asOf,
        people,
        conversations: built ? built.conversations.map(conversationSummary) : [],
        chapters: careerChapters(found['positions.csv'] || [], conns, asOf),
        posts: found['shares.csv'] ? postingEffect(found['shares.csv'], conns) : null,
        invites: found['invitations.csv'] ? invitationSplit(found['invitations.csv']) : null,
        // One record per request, without the notes: those go with the messages, below.
        invitations: (invitations || []).map(({ note, ...rest }) => rest),
        // Names as the export spells them, so people who aren't connections can be listed.
        names: built ? built.names : {},
        emails: keepEmails,
      };
      const r = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'It couldn’t be saved.');
      if (built && keep) await sendMessages(built.conversations);
      if (invitations && keep) await sendInviteNotes(invitations);
      const odd = built ? [
        built.drafts ? `${built.drafts.toLocaleString()} unsent ${built.drafts === 1 ? 'draft' : 'drafts'} left out` : '',
        built.skipped ? `${built.skipped.toLocaleString()} ${built.skipped === 1 ? 'row' : 'rows'} with no conversation or date left out` : '',
      ].filter(Boolean) : [];
      setNote({
        good: true,
        text: `Read ${Object.keys(found).length} of the export’s files: ${stats.people.size.toLocaleString()} people you’ve messaged one to one`
          + (built ? `, ${built.conversations.length.toLocaleString()} conversations${keep ? ', their messages kept on this computer' : ''}` : '')
          + (invitations ? `, ${invitations.length.toLocaleString()} connection requests` : '')
          + `.${odd.length ? ` (${odd.join('; ')}.)` : ''}`,
      });
      await reload();
    } catch (e) {
      setNote({ good: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // The daily sync reads the top of the list; `full` scrolls until the whole
  // history has loaded (scripts/scrape.py --full-history), at the same pace.
  async function syncNow(full = false) {
    setNote(null);
    try {
      const end = await runScrape(full ? 'messages-full' : 'messages');
      setNote(end?.exitCode === 0
        ? { good: true, text: full ? 'Your whole messages history is read.' : 'Your messages list is read.' }
        : { good: false, text: 'The sync stopped before it finished. The Scan page has the log.' });
      await reload();
    } catch (e) {
      setNote({ good: false, text: e.message });
    }
  }

  async function setAuto(on) {
    await fetch('/api/social', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSync: on }) });
    reload();
  }

  // Keep my messages. On: from now on the export's and the sync's words are
  // kept, and if an export was read in this window, its messages are kept now.
  // Off, once you've said so: the kept messages are deleted.
  async function setKeep(on) {
    if (!on && !window.confirm('Delete the messages kept on this computer? The list of conversations stays; the messages themselves are deleted.')) return;
    setSwitching(true);
    setNote(null);
    try {
      if (!on) await fetch('/api/social/messages', { method: 'DELETE' });
      const r = await fetch('/api/social', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepMessages: on }) });
      if (!r.ok) throw new Error('The switch couldn’t be saved.');
      if (on && (lastMessages.current || lastInvites.current)) {
        if (lastMessages.current) await sendMessages(buildConversations(lastMessages.current, { keepText: true }).conversations);
        if (lastInvites.current) await sendInviteNotes(buildInvitations(lastInvites.current, { keepText: true }));
        setNote({ good: true, text: 'Your messages are kept on this computer now.' });
      } else if (on) {
        setNote({ good: true, text: 'On. Choose your export folder again, or sync your messages, to bring the messages in.' });
      } else {
        setNote({ good: true, text: 'Off. The kept messages are deleted.' });
      }
    } catch (e) {
      setNote({ good: false, text: e.message });
    } finally {
      setSwitching(false);
      reload();
    }
  }

  // Forget it: the export's and the sync's findings, and the messages. Your CRM
  // notes are your own work, so they're a question of their own, asked after.
  async function forget() {
    await fetch('/api/social', { method: 'DELETE' });
    lastMessages.current = null;
    lastInvites.current = null;
    let text = 'Forgotten. Nothing from your export or messages is kept here now, the messages themselves included.';
    if (window.confirm('Also delete your CRM: the stages, tags, notes and follow-up dates you added? This can’t be undone. Cancel keeps them.')) {
      await fetch('/api/social/crm', { method: 'DELETE' });
      setCrmToken((n) => n + 1);
      text += ' Your CRM notes are deleted too.';
    } else {
      text += ' Your CRM notes are kept.';
    }
    setNote({ good: true, text });
    reload();
  }

  // What each person's messages say, the export and the live sync together, and
  // "now" for warmth: the newest thing the data knows, so an older export reads as it was.
  const { merged, asOf } = useMemo(() => mergeSocial(social), [social]);

  const warmth = useMemo(() => {
    const counts = { warm: 0, cool: 0, dormant: 0, never: 0 };
    for (const c of net?.degree1 || []) counts[warmthOf(merged.get(keyFor(c)), asOf)] += 1;
    return counts;
  }, [net, merged, asOf]);

  if (IS_DEMO) return <div style={{ minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-3, #aaa)', padding: 40, fontFamily: FONT }}>Not part of the demo.</div>;
  const running = job?.running;
  const box = { padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', marginTop: 10 };
  const h2 = { fontSize: 16, margin: '24px 0 6px' };

  return (
    <div style={embedded ? { color: 'var(--sd-fg-1, #fff)', fontFamily: FONT } : { minHeight: '100vh', background: 'var(--sd-page)', color: 'var(--sd-fg-1, #fff)', fontFamily: FONT }}>
      {!embedded && (
        <header style={{ padding: '16px 24px', borderBottom: LINE, display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ color: 'var(--sd-fg-3, #888)', textDecoration: 'none', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: 'rgba(var(--sd-ink, 255, 255, 255), 0.06)', border: LINE }}>← Back to Map</Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--sd-gold, #FFD700)' }}>Social <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)', fontWeight: 600 }}>experimental</span></h1>
        </header>
      )}
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '8px 16px 64px' }}>
        <Body style={{ marginTop: 16 }}>
          Everyone you&rsquo;ve been in touch with, connections or not: who&rsquo;s waiting on you, who
          hasn&rsquo;t answered, what you&rsquo;ve sent and received, and your own notes and follow-ups on each, from
          your own data export. Only dates, who wrote last, counts and names are kept on this computer, and what
          messages say only if you turn on <i>Keep my messages</i> below.
        </Body>

        <h2 style={h2}>Your data export</h2>
        <div style={box}>
          <Body style={{ margin: 0 }}>
            On the platform: <i>Settings → Data privacy → Get a copy of your data</i>, pick the larger archive, and unzip the
            file it emails you. Then choose that folder here. It&rsquo;s read in this window; nothing is sent anywhere.
          </Body>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', marginTop: 10 }}>
            <input type="checkbox" checked={keepEmails} onChange={(e) => setKeepEmails(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Also keep email addresses from it, on this computer only, for one-click email.</span>
          </label>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(52,152,219,0.18)', color: 'var(--sd-fg-1, #cfe6f7)', cursor: busy ? 'default' : 'pointer', fontSize: 13 }}>
              {busy ? 'Reading…' : social ? 'Choose a newer export' : 'Choose the export folder'}
              <input type="file" webkitdirectory="" directory="" multiple disabled={busy} style={{ display: 'none' }} onChange={(e) => importFolder(e.target.files)} />
            </label>
            {social && <span style={{ fontSize: 12, color: 'var(--sd-fg-3, #8b9a9a)' }}>From an export up to {day(social.asOf)}{social.liveAt ? ` · messages synced ${day(Date.parse(social.liveAt))}` : ''}</span>}
            {social && <button onClick={forget} style={{ background: 'none', border: 'none', color: 'var(--sd-fg-2, #ff9b9b)', cursor: 'pointer', fontSize: 12 }}>Forget it</button>}
          </div>
        </div>

        <h2 style={h2}>Live messages sync <span style={{ fontSize: 11, color: 'var(--sd-gold, #FFD700)' }}>experimental</span></h2>
        <div style={box}>
          <Body style={{ margin: 0 }}>
            Reads your messages list once, in your own Chrome: who each conversation is with, connections or not, when it
            was last active, whether it&rsquo;s unread and who wrote last. It uses no search budget and opens no
            conversation. The newest message&rsquo;s words are kept only if <i>Keep my messages</i> is on. The daily sync
            reads the top of the list; <i>Read my whole history</i> keeps scrolling until no more conversations load
            (at most 60 scrolls, about 1,000 conversations), at the same slow, fixed pace, so it takes a few minutes.
          </Body>
          <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => syncNow(false)} disabled={running} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: running ? '#333' : 'rgba(0,255,136,0.15)', color: running ? 'var(--sd-fg-4, #777)' : 'var(--sd-green, #00ff88)', cursor: running ? 'default' : 'pointer', fontSize: 13 }}>
              {running ? 'The scanner is busy' : 'Sync messages now'}
            </button>
            <button onClick={() => syncNow(true)} disabled={running} style={{ padding: '7px 14px', borderRadius: 8, border: LINE, background: 'none', color: running ? 'var(--sd-fg-4, #777)' : 'var(--sd-fg-1, #cfe6f7)', cursor: running ? 'default' : 'pointer', fontSize: 13 }}>
              Read my whole history
            </button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)' }}>
              <input type="checkbox" checked={social?.autoSync === true} onChange={(e) => setAuto(e.target.checked)} />
              Once a day while the app is open (daytime only)
            </label>
          </div>
        </div>
        {note && <div style={{ marginTop: 10, fontSize: 13, color: note.good ? 'var(--sd-green, #00ff88)' : 'var(--sd-fg-2, #ff9b9b)' }}>{note.text}</div>}

        <h2 style={h2}>People</h2>
        <Crm net={net} asOf={social ? asOf : null} keep={keep} onKeep={setKeep} switching={switching || busy} token={listToken} crmToken={crmToken} />

        {social && (
          <>
            <h2 style={h2}>Warmth</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {Object.entries(WARMTH).map(([k, [label, color]]) => (
                <div key={k} style={{ ...box, marginTop: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{(warmth[k] || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)' }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #778)', marginTop: 6 }}>
              Of your connections. Warm: messaged in the last 30 days, or 3+ messages in 90. Cool: within a year. Dormant: longer ago.
            </div>

            {social.chapters?.length > 0 && (
              <>
                <h2 style={h2}>Career chapters</h2>
                <div style={{ ...box, padding: 0 }}>
                  {social.chapters.map((c) => {
                    const warm = (c.people || []).filter((u) => ['warm', 'cool'].includes(warmthOf(merged.get(keyFor({ profile_url: u })), asOf))).length;
                    return (
                      <div key={`${c.company}-${c.from}`} style={{ display: 'flex', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.04)', fontSize: 13, alignItems: 'baseline' }}>
                        <span style={{ flex: 1 }}><b>{c.company}</b> <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>{c.title} · {new Date(c.from).getFullYear()}–{c.to ? new Date(c.to).getFullYear() : 'now'}</span></span>
                        <span style={{ color: 'var(--sd-fg-2, #b8c4c4)' }}>{c.made.toLocaleString()} connections made</span>
                        <span style={{ color: '#ff9f43', minWidth: 90, textAlign: 'right' }}>{c.made ? `${Math.round((100 * warm) / c.made)}% still in touch` : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {social.posts?.posts?.length > 0 && (
              <>
                <h2 style={h2}>Does posting work?</h2>
                <div style={box}>
                  <div style={{ fontSize: 13 }}>
                    In the week after a post you made <b>{social.posts.afterPosts.toFixed(1)}</b> new connections on average; a usual week, <b>{social.posts.usualWeek.toFixed(1)}</b>.
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--sd-fg-4, #778)', marginTop: 4 }}>What came after a post, not proof it came from it.</div>
                  {[...social.posts.posts].sort((a, b) => b.week - a.week).slice(0, 3).map((p) => (
                    <div key={p.t} style={{ fontSize: 12.5, color: 'var(--sd-fg-2, #b8c4c4)', marginTop: 6 }}>
                      {day(p.t)}: {p.week} new connections that week {p.link ? <a href={p.link} target="_blank" rel="noreferrer" style={{ color: 'var(--sd-blue, #3498DB)', textDecoration: 'none' }}>Post ↗</a> : null}
                    </div>
                  ))}
                </div>
              </>
            )}

            {social.invites?.total > 0 && (
              <>
                <h2 style={h2}>Who reaches out</h2>
                <div style={box}>
                  <span style={{ fontSize: 13 }}>
                    {social.invites.incoming.toLocaleString()} requests came to you and you sent {social.invites.outgoing.toLocaleString()}
                    {' '}({Math.round((100 * social.invites.incoming) / social.invites.total)}% came to you), as far as your export shows.
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
