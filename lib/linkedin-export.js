// The Social tab (experimental): what your own LinkedIn data export says about
// your relationships. The export is the folder LinkedIn emails you from
// Settings → Data privacy → Get a copy of your data; nothing here talks to
// LinkedIn. It runs in the browser on the files you pick, and what it keeps is
// numbers and dates only:
//
//   people     per profile: when you last messaged, who wrote last, how many
//              messages (1:1 conversations only). Never a message's text.
//   conversations  per conversation: who's in it, when it was last active, who
//              wrote last, how many messages. The text itself only when you turn
//              on Keep my messages, and then in a file of its own
//              (app/api/social/messages).
//   chapters   your jobs (Positions.csv) and the connections made in each
//   posts      your posts (Shares.csv) and the connections that came the week after
//   invites    requests to and from you (Invitations.csv), when the export has them
//
// Plain functions, no React; tests/linkedin-export.test.mjs.

import { parseCsv } from './csv.js';
import { keyFor } from './separation.js';

const DAY = 86400000;

/** The rows of a CSV as objects, from the first line that has `mustHave` among its columns (exports put notes above the header). */
export function readTable(text, mustHave) {
  const rows = parseCsv(String(text || ''));
  const at = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === mustHave.toLowerCase()));
  if (at < 0) return [];
  const head = rows[at].map((c) => c.trim().toLowerCase());
  return rows.slice(at + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** A date in any of the export's formats, as ms; null when it can't be read. */
export function exportDate(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*UTC)?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    let h = +m[4] % 12;
    if ((m[6] || '').toUpperCase() === 'PM') h += 12;
    return Date.UTC(y, +m[1] - 1, +m[2], h, +m[5]);
  }
  m = v.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);                    // "Jan 2020"
  if (m) { const t = Date.parse(`1 ${m[1]} ${m[2]} UTC`); return Number.isNaN(t) ? null : t; }
  const t = Date.parse(/\d{4}$/.test(v) ? `${v} UTC` : v);       // "01 May 2024"
  return Number.isNaN(t) ? null : t;
}

const urlKey = (u) => keyFor({ profile_url: u });

/** You, in messages.csv: the sender in the most conversations. */
function selfOf(rows = []) {
  const senders = new Map();
  for (const r of rows) {
    const from = urlKey(r['sender profile url']);
    const id = r['conversation id'];
    if (!id || !from) continue;
    if (!senders.has(from)) senders.set(from, new Set());
    senders.get(from).add(id);
  }
  let self = null;
  for (const [who, ids] of senders) if (!self || ids.size > senders.get(self).size) self = who;
  return self;
}

/**
 * From messages.csv, per person (by profile): { last, lastFromThem, total, recent }.
 * `self` is you: the sender in the most conversations. Only 1:1 conversations
 * count; group threads say little about one relationship. No text is read.
 */
export function messageStats(rows = []) {
  const self = selfOf(rows);
  const convos = new Map();
  for (const r of rows) {
    const from = urlKey(r['sender profile url']);
    const id = r['conversation id'];
    if (!id || !from) continue;
    const to = String(r['recipient profile urls'] || '').split(/[,;\s]+/).filter(Boolean).map(urlKey);
    const t = exportDate(r.date);
    if (t == null) continue;
    if (!convos.has(id)) convos.set(id, { people: new Set(), msgs: [] });
    const c = convos.get(id);
    c.people.add(from);
    to.forEach((p) => c.people.add(p));
    c.msgs.push({ from, t });
  }
  let asOf = 0;
  const people = new Map();
  for (const c of convos.values()) {
    const others = [...c.people].filter((p) => p !== self);
    if (others.length !== 1 || !c.people.has(self)) continue;
    const other = others[0];
    const s = people.get(other) || { last: 0, lastFromThem: false, total: 0, times: [] };
    for (const m of c.msgs) {
      s.total += 1;
      s.times.push(m.t);
      if (m.t >= s.last) { s.last = m.t; s.lastFromThem = m.from !== self; }
      if (m.t > asOf) asOf = m.t;
    }
    people.set(other, s);
  }
  for (const s of people.values()) {
    s.recent = s.times.filter((t) => t > asOf - 90 * DAY).length;
    delete s.times;
  }
  return { self, asOf: asOf || null, people };
}

/**
 * Every conversation in messages.csv you're part of, one record each:
 * { id, title, people, group, messages: [{ t, fromMe, text }] }, messages oldest
 * first. `people` is everyone but you, by profile key; more than one makes it a
 * group. You are found the way messageStats finds you. The words (the subject,
 * when there is one, then the message) are read only with keepText: without it
 * a message is a date and who sent it, and the title (a group's name) is left
 * out too.
 */
export function buildConversations(rows = [], { keepText = false } = {}) {
  const self = selfOf(rows);
  const convos = new Map();
  for (const r of rows) {
    const from = urlKey(r['sender profile url']);
    const id = r['conversation id'];
    if (!id || !from) continue;
    const t = exportDate(r.date);
    if (t == null) continue;
    if (!convos.has(id)) convos.set(id, { id, title: '', everyone: new Set(), messages: [] });
    const c = convos.get(id);
    c.everyone.add(from);
    String(r['recipient profile urls'] || '').split(/[,;\s]+/).filter(Boolean).forEach((u) => c.everyone.add(urlKey(u)));
    const m = { t, fromMe: from === self };
    if (keepText) {
      m.text = [r.subject, r.content].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
      if (!c.title && r['conversation title']) c.title = String(r['conversation title']).trim();
    }
    c.messages.push(m);
  }
  const conversations = [];
  for (const c of convos.values()) {
    if (!c.everyone.has(self)) continue;
    const people = [...c.everyone].filter((p) => p && p !== self).sort();
    if (!people.length) continue;
    c.messages.sort((a, b) => a.t - b.t);
    const out = { id: c.id, people, group: people.length > 1, messages: c.messages };
    if (keepText) out.title = c.title;
    conversations.push(out);
  }
  return { self, conversations };
}

/** What the Conversations list keeps of one conversation, never any words: { id, people, group, last, lastFromThem, count }. */
export function conversationSummary(c) {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    people: c.people,
    group: c.group,
    last: last ? last.t : null,
    lastFromThem: last ? !last.fromMe : null,
    count: c.messages.length,
  };
}

/**
 * The Conversations list: the export's conversations with what the live sync
 * adds (unread, the thread's link, and a newer last message), plus a
 * conversation for each person the sync found and the export doesn't have yet
 * (id `live:<key>`, count unknown).
 */
export function conversationList(list = [], live = {}) {
  const out = (Array.isArray(list) ? list : []).map((c) => ({ ...c, unread: null, threadUrl: null }));
  const oneToOne = new Map();
  for (const c of out) {
    if (c.group || c.people?.length !== 1) continue;
    const had = oneToOne.get(c.people[0]);
    if (!had || (c.last || 0) > (had.last || 0)) oneToOne.set(c.people[0], c);
  }
  for (const [key, v] of Object.entries(live || {})) {
    if (!v || typeof v !== 'object') continue;
    let c = oneToOne.get(key);
    if (!c) {
      c = { id: `live:${key}`, people: [key], group: false, last: null, lastFromThem: null, count: null, unread: null, threadUrl: null };
      out.push(c);
      oneToOne.set(key, c);
    }
    if (v.last && (!c.last || v.last > c.last)) {
      c.last = v.last;
      if (typeof v.lastFromThem === 'boolean') c.lastFromThem = v.lastFromThem;
    }
    c.unread = Number.isFinite(v.unread) ? v.unread : c.unread;
    c.threadUrl = v.threadUrl || c.threadUrl;
  }
  return out;
}

/**
 * The order the Conversations list shows: waiting on you (they wrote last, one
 * to one) first, then your S and A tier people, then the most recent.
 * `tierOf(conversation)` gives its best tier.
 */
export function sortConversations(list = [], tierOf = () => null) {
  const waiting = (c) => (!c.group && c.lastFromThem === true ? 0 : 1);
  const tier = (c) => ({ S: 0, A: 1 }[tierOf(c)] ?? 2);
  return [...list].sort((a, b) => waiting(a) - waiting(b) || tier(a) - tier(b) || (b.last || 0) - (a.last || 0));
}

/** Warm (in the last 30 days, or 3+ in 90), cool (within a year), dormant (longer ago), or never. */
export function warmthOf(stat, asOf) {
  if (!stat || !stat.total) return 'never';
  const age = asOf - stat.last;
  if (age <= 30 * DAY || stat.recent >= 3) return 'warm';
  return age <= 365 * DAY ? 'cool' : 'dormant';
}

/** People who wrote last, 3 to 30 days before the export: replies you might owe. */
export function repliesWaiting(stats) {
  const out = [];
  for (const [url, s] of stats.people) {
    const age = stats.asOf - s.last;
    if (s.lastFromThem && age >= 3 * DAY && age <= 30 * DAY) out.push({ url, days: Math.round(age / DAY), total: s.total });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Your jobs, oldest first, each with the connections made while you were there. */
export function careerChapters(positions = [], connections = [], asOf = Date.now()) {
  const jobs = positions
    .map((p) => ({ company: p['company name'] || '', title: p.title || '', from: exportDate(p['started on']), to: exportDate(p['finished on']) }))
    .filter((j) => j.company && j.from != null)
    .sort((a, b) => a.from - b.from);
  const made = connections.map((c) => ({ url: urlKey(c.url || c.profile_url), t: exportDate(c['connected on'] || c.connected_on) })).filter((c) => c.t != null);
  return jobs.map((j) => {
    const end = j.to ?? asOf;
    const inside = made.filter((c) => c.t >= j.from && c.t < end);
    return { ...j, to: j.to, made: inside.length, people: inside.map((c) => c.url) };
  });
}

/**
 * Your posts and the connections made in the 7 days after each, against your
 * usual week. Something that happened after a post, not proof it came from it.
 */
export function postingEffect(shares = [], connections = []) {
  const posts = shares.map((s) => ({ t: exportDate(s.date), link: s.sharelink || s['share link'] || '' })).filter((p) => p.t != null).sort((a, b) => a.t - b.t);
  const made = connections.map((c) => exportDate(c['connected on'] || c.connected_on)).filter((t) => t != null).sort((a, b) => a - b);
  if (!made.length) return { posts: [], usualWeek: 0, afterPosts: 0 };
  const span = Math.max(DAY * 7, made[made.length - 1] - made[0]);
  const usualWeek = (made.length / span) * 7 * DAY;
  const counted = posts.map((p) => ({ ...p, week: made.filter((t) => t >= p.t && t < p.t + 7 * DAY).length }));
  const afterPosts = counted.length ? counted.reduce((n, p) => n + p.week, 0) / counted.length : 0;
  return { posts: counted, usualWeek, afterPosts };
}

/** Requests to and from you, when the export has them. */
export function invitationSplit(rows = []) {
  let incoming = 0;
  let outgoing = 0;
  for (const r of rows) {
    const d = String(r.direction || '').toUpperCase();
    if (d === 'INCOMING') incoming += 1;
    else if (d === 'OUTGOING') outgoing += 1;
  }
  return { incoming, outgoing, total: incoming + outgoing };
}

const nameKey = (s) => String(s || '').split(',')[0].normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const THREAD_LINK = /^https:\/\/www\.linkedin\.com\/messaging\/[\w\-/%=.]*$/;

/** A link to a LinkedIn messaging thread, or null: nothing else is ever put behind "Open on LinkedIn". */
export function threadLink(u) {
  const v = String(u || '').trim();
  return THREAD_LINK.test(v) ? v : null;
}

/** A message the live sync read, as it's kept: { t, fromMe, text }, or null. */
function previewOf(p) {
  if (!p || typeof p !== 'object') return null;
  const t = Number(p.t) || null;
  const text = typeof p.text === 'string' ? p.text.slice(0, 20000) : null;
  if (!t && !text) return null;
  return { t, fromMe: p.fromMe === true, text };
}

/**
 * The live messages sync's people, matched to your connections. LinkedIn's
 * messaging gives a member link (/in/ACoA…) your connections list doesn't have,
 * so a person is matched by their link when it's the same, otherwise by their
 * name when exactly one connection has it. Only the match is kept, never the
 * name. Returns { live: { connectionKey: { last, unread, threadUrl,
 * lastFromThem, preview } }, unmatched }; the caller decides whether the
 * preview's words are kept.
 */
export function matchLive(incoming = {}, connections = []) {
  const byUrl = new Map();
  const byName = new Map();
  for (const c of connections) {
    const key = keyFor(c);
    byUrl.set(key, key);
    const n = nameKey(c.name);
    if (n) byName.set(n, byName.has(n) ? null : key);   // null: two people share it
  }
  const live = {};
  let unmatched = 0;
  for (const [url, v] of Object.entries(incoming || {})) {
    if (!v || typeof v !== 'object') continue;
    const key = byUrl.get(keyFor({ profile_url: url })) || byName.get(nameKey(v.name)) || null;
    if (!key) { unmatched += 1; continue; }
    const last = Number(v.last) || null;
    if (live[key] && (live[key].last || 0) >= (last || 0)) continue;
    live[key] = {
      last,
      unread: Number.isFinite(Number(v.unread)) && v.unread !== null ? Number(v.unread) : null,
      threadUrl: threadLink(v.threadUrl),
      lastFromThem: typeof v.lastFromThem === 'boolean' ? v.lastFromThem : null,
      preview: previewOf(v.preview),
    };
  }
  return { live, unmatched };
}
