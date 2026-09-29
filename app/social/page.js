'use client';

// Social (experimental): what your own LinkedIn data says about your
// relationships (lib/linkedin-export.js). Two sources, both yours:
//   - the export LinkedIn emails you (Settings → Data privacy → Get a copy of
//     your data), read here in the browser: full history, no traffic to LinkedIn;
//   - an experimental live sync (the scanner's --messages): your messages list,
//     read once in your own Chrome, by hand or once a day.
// Kept on this computer: dates, who wrote last and counts. Never message text.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import OnboardingGate from '../components/OnboardingGate';
import { useUser } from '../components/UserProvider';
import { loadNetwork } from '../../lib/network';
import { readTable, messageStats, careerChapters, postingEffect, invitationSplit, warmthOf, repliesWaiting } from '../../lib/linkedin-export';
import { mergeSocial } from '../../lib/galaxy-lab';
import { keyFor } from '../../lib/separation';
import { runScrape, watchScanner, scannerNow } from '../../lib/scraper-client';
import { Body, LINE, FONT } from '../components/ui';
import { IS_DEMO } from '../../lib/demo';

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const WARMTH = { warm: ['Warm', '#ff9f43'], cool: ['Cool', '#3498DB'], dormant: ['Dormant', '#8899aa'], never: ['Never messaged', '#556'] };
const FILES = { 'connections.csv': 'first name', 'messages.csv': 'conversation id', 'invitations.csv': 'direction', 'positions.csv': 'company name', 'shares.csv': 'date' };
const day = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const slug = (u) => String(u || '').replace(/\/+$/, '').split('/').pop();

export default function SocialPage() {
  return <OnboardingGate><SocialInner /></OnboardingGate>;
}

function SocialInner() {
  const { userId } = useUser();
  const [social, setSocial] = useState(undefined);
  const [net, setNet] = useState(null);
  const [keepEmails, setKeepEmails] = useState(false);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(() => scannerNow());

  const reload = () => fetch('/api/social').then((r) => r.json()).then((d) => setSocial(d.social || null)).catch(() => setSocial(null));
  useEffect(() => { reload(); }, []);
  useEffect(() => watchScanner(() => setJob(scannerNow())), []);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    loadNetwork(userId).then((n) => { if (live) setNet(n); }).catch(() => {});
    return () => { live = false; };
  }, [userId]);

  // Everyone you know, by profile: name and tier for the lists below.
  const byKey = useMemo(() => {
    const m = new Map();
    for (const r of [...(net?.degree1 || []), ...(net?.degree2 || [])]) if (!m.has(keyFor(r))) m.set(keyFor(r), r);
    return m;
  }, [net]);

  async function importFolder(list) {
    setBusy(true);
    setNote(null);
    try {
      const found = {};
      for (const f of Array.from(list || [])) {
        const name = f.name.toLowerCase();
        if (FILES[name] && !found[name]) found[name] = readTable(await f.text(), FILES[name]);
      }
      if (!Object.keys(found).length) throw new Error('That folder doesn’t have LinkedIn’s export files in it (Connections.csv, messages.csv and so on).');
      const conns = found['connections.csv'] || [];
      const stats = found['messages.csv'] ? messageStats(found['messages.csv']) : { asOf: null, people: new Map() };
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
        chapters: careerChapters(found['positions.csv'] || [], conns, asOf),
        posts: found['shares.csv'] ? postingEffect(found['shares.csv'], conns) : null,
        invites: found['invitations.csv'] ? invitationSplit(found['invitations.csv']) : null,
        emails: keepEmails,
      };
      const r = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'It couldn’t be saved.');
      setNote({ good: true, text: `Read ${Object.keys(found).length} of LinkedIn’s files: ${stats.people.size.toLocaleString()} people you’ve messaged one to one.` });
      await reload();
    } catch (e) {
      setNote({ good: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setNote(null);
    try {
      const end = await runScrape('messages');
      setNote(end?.exitCode === 0 ? { good: true, text: 'Your messages list is read.' } : { good: false, text: 'The sync stopped before it finished. The Scan page has the log.' });
      await reload();
    } catch (e) {
      setNote({ good: false, text: e.message });
    }
  }

  async function setAuto(on) {
    await fetch('/api/social', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoSync: on }) });
    reload();
  }

  async function forget() {
    await fetch('/api/social', { method: 'DELETE' });
    setNote({ good: true, text: 'Forgotten. Nothing from your export or messages is kept here now.' });
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

  const waiting = useMemo(() => {
    const stats = { asOf, people: new Map([...merged].filter(([, v]) => v.lastFromThem != null)) };
    const list = repliesWaiting(stats).map((w) => ({ ...w, person: byKey.get(w.url) }));
    for (const [k, v] of merged) {
      if (v.unread > 0 && !list.some((w) => w.url === k)) list.push({ url: k, unread: v.unread, person: byKey.get(k) });
    }
    const rank = (w) => ({ S: 0, A: 1 }[w.person?.tier] ?? 2);
    return list.sort((a, b) => rank(a) - rank(b) || (a.days ?? 0) - (b.days ?? 0)).slice(0, 15);
  }, [merged, asOf, byKey]);

  if (IS_DEMO) return <div style={{ minHeight: '100vh', background: '#0a0a1a', color: '#aaa', padding: 40, fontFamily: FONT }}>Not part of the demo.</div>;
  const running = job?.running;
  const box = { padding: '12px 14px', borderRadius: 8, border: LINE, background: 'rgba(255,255,255,0.03)', marginTop: 10 };
  const h2 = { fontSize: 16, margin: '24px 0 6px' };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', color: '#fff', fontFamily: FONT }}>
      <header style={{ padding: '16px 24px', borderBottom: LINE, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', border: LINE }}>← Back to Map</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#FFD700' }}>Social <span style={{ fontSize: 12, color: '#8b9a9a', fontWeight: 600 }}>experimental</span></h1>
      </header>
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '8px 24px 64px' }}>
        <Body style={{ marginTop: 16 }}>
          Who you&rsquo;re warm with, who&rsquo;s waiting on a reply, and how each chapter of your career built your network,
          from your own LinkedIn data. Only dates, who wrote last and counts are kept on this computer, never what a
          message says.
        </Body>

        <h2 style={h2}>Your LinkedIn export</h2>
        <div style={box}>
          <Body style={{ margin: 0 }}>
            On LinkedIn: <i>Settings → Data privacy → Get a copy of your data</i>, pick the larger archive, and unzip the
            file it emails you. Then choose that folder here. It&rsquo;s read in this window; nothing goes to LinkedIn.
          </Body>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#b8c4c4', marginTop: 10 }}>
            <input type="checkbox" checked={keepEmails} onChange={(e) => setKeepEmails(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Also keep email addresses from it, on this computer only, for one-click email.</span>
          </label>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(52,152,219,0.18)', color: '#cfe6f7', cursor: busy ? 'default' : 'pointer', fontSize: 13 }}>
              {busy ? 'Reading…' : social ? 'Choose a newer export' : 'Choose the export folder'}
              <input type="file" webkitdirectory="" directory="" multiple disabled={busy} style={{ display: 'none' }} onChange={(e) => importFolder(e.target.files)} />
            </label>
            {social && <span style={{ fontSize: 12, color: '#8b9a9a' }}>From an export up to {day(social.asOf)}{social.liveAt ? ` · messages synced ${day(Date.parse(social.liveAt))}` : ''}</span>}
            {social && <button onClick={forget} style={{ background: 'none', border: 'none', color: '#ff9b9b', cursor: 'pointer', fontSize: 12 }}>Forget it</button>}
          </div>
        </div>

        <h2 style={h2}>Live messages sync <span style={{ fontSize: 11, color: '#FFD700' }}>experimental</span></h2>
        <div style={box}>
          <Body style={{ margin: 0 }}>
            Reads your messages list once, in your own Chrome: who each one-to-one conversation is with, when it was last
            active and whether it&rsquo;s unread. It uses no search budget and never opens or keeps a message&rsquo;s text.
          </Body>
          <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={syncNow} disabled={running} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: running ? '#333' : 'rgba(0,255,136,0.15)', color: running ? '#777' : '#00ff88', cursor: running ? 'default' : 'pointer', fontSize: 13 }}>
              {running ? 'The scanner is busy' : 'Sync messages now'}
            </button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: '#b8c4c4' }}>
              <input type="checkbox" checked={social?.autoSync === true} onChange={(e) => setAuto(e.target.checked)} />
              Once a day while the app is open (daytime only)
            </label>
          </div>
        </div>
        {note && <div style={{ marginTop: 10, fontSize: 13, color: note.good ? '#00ff88' : '#ff9b9b' }}>{note.text}</div>}

        {social && (
          <>
            <h2 style={h2}>Warmth</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {Object.entries(WARMTH).map(([k, [label, color]]) => (
                <div key={k} style={{ ...box, marginTop: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{(warmth[k] || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 12.5, color: '#b8c4c4' }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: '#778', marginTop: 6 }}>
              Of your connections. Warm: messaged in the last 30 days, or 3+ messages in 90. Cool: within a year. Dormant: longer ago.
            </div>

            <h2 style={h2}>Waiting on you</h2>
            <div style={{ ...box, padding: 0 }}>
              {waiting.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#8b9a9a' }}>No one is waiting on a reply.</div>}
              {waiting.map((w) => (
                <div key={w.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER[w.person?.tier] || '#556', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{w.person?.name || slug(w.url)}</b>
                    {w.person?.company ? <span style={{ color: '#8b9a9a' }}> · {w.person.company}</span> : null}
                  </span>
                  <span style={{ color: '#b8c4c4' }}>{w.unread ? `${w.unread} unread` : `wrote ${w.days} days before your export`}</span>
                  <a href={w.url} target="_blank" rel="noreferrer" style={{ color: '#3498DB', textDecoration: 'none' }}>Open ↗</a>
                </div>
              ))}
            </div>

            {social.chapters?.length > 0 && (
              <>
                <h2 style={h2}>Career chapters</h2>
                <div style={{ ...box, padding: 0 }}>
                  {social.chapters.map((c) => {
                    const warm = (c.people || []).filter((u) => ['warm', 'cool'].includes(warmthOf(merged.get(keyFor({ profile_url: u })), asOf))).length;
                    return (
                      <div key={`${c.company}-${c.from}`} style={{ display: 'flex', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13, alignItems: 'baseline' }}>
                        <span style={{ flex: 1 }}><b>{c.company}</b> <span style={{ color: '#8b9a9a' }}>{c.title} · {new Date(c.from).getFullYear()}–{c.to ? new Date(c.to).getFullYear() : 'now'}</span></span>
                        <span style={{ color: '#b8c4c4' }}>{c.made.toLocaleString()} connections made</span>
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
                  <div style={{ fontSize: 11.5, color: '#778', marginTop: 4 }}>What came after a post, not proof it came from it.</div>
                  {[...social.posts.posts].sort((a, b) => b.week - a.week).slice(0, 3).map((p) => (
                    <div key={p.t} style={{ fontSize: 12.5, color: '#b8c4c4', marginTop: 6 }}>
                      {day(p.t)}: {p.week} new connections that week {p.link ? <a href={p.link} target="_blank" rel="noreferrer" style={{ color: '#3498DB', textDecoration: 'none' }}>Post ↗</a> : null}
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
