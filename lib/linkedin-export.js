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
//   invites    requests to and from you (Invitations.csv), when the export has
//              them: counts, and one record per request (who, which way, when).
//              The note sent with a request only with Keep my messages.
//   names      the names the export gives people, so someone who isn't a
//              connection (and so isn't in the app's network) can be listed
//
// Every conversation is kept, whoever it's with and whatever folder it's in;
// Sponsored Messages and InMails are marked, not dropped (buildConversations).
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

/** A person with no profile link in the export, by their name: `name:ada quill`. */
export const nameOnlyKey = (name) => {
  const n = nameKey(name);
  return n ? `name:${n}` : null;
};

const SPONSORED = /sponsored/i;
const INMAIL = /in\s?mail/i;
// A company's or a showcase page's link as the sender: an advert, not a person.
const PAGE_SENDER = /linkedin\.com\/(company|showcase|school)\//i;
const yes = (v) => /^(yes|true|1)$/i.test(String(v || '').trim());

/**
 * What LinkedIn's rows say a conversation is: 'sponsored' (a Sponsored
 * Message, an advert), 'inmail' (an InMail), or null for an ordinary one. The
 * export marks neither in a column of its own, so it's read from the folder,
 * the conversation's title, and a sender that's a company page, not a person.
 */
function kindOfRow(r) {
  const folder = String(r.folder || '');
  const title = String(r['conversation title'] || '');
  if (SPONSORED.test(folder) || SPONSORED.test(title) || PAGE_SENDER.test(String(r['sender profile url'] || ''))) return 'sponsored';
  if (INMAIL.test(folder) || INMAIL.test(title)) return 'inmail';
  return null;
}

/**
 * Every conversation in messages.csv, one record each:
 * { id, title, people, group, kind, folder, messages: [{ t, fromMe, text }] },
 * messages oldest first. `people` is everyone but you, by profile key, or by
 * name (nameOnlyKey) when the export has no link for them; more than one makes
 * it a group, none (only you wrote, and to whom isn't said) leaves it empty.
 * Nothing is left out for being in a folder: INBOX, SENT, ARCHIVE, SPAM and
 * anything else LinkedIn adds all count; `folder` is the newest message's, in
 * lower case. `kind` is 'sponsored', 'inmail' or null (kindOfRow). Drafts
 * weren't sent, so they aren't messages; they're counted in `drafts`, and rows
 * with no conversation or no readable date in `skipped`.
 *
 * You are found the way messageStats finds you, and by your name on rows with
 * no link. `names` is everyone's name as the export spells it, by key, so a
 * person who isn't a connection can still be shown. The words (the subject,
 * when there is one, then the message) are read only with keepText: without it
 * a message is a date and who sent it, and the title (a group's name) is left
 * out too.
 */
export function buildConversations(rows = [], { keepText = false } = {}) {
  const self = selfOf(rows);
  // Your name as the export spells it, for rows that have no link for you.
  const selfNames = new Map();
  for (const r of rows) {
    if (self && urlKey(r['sender profile url']) === self && r.from) selfNames.set(r.from, (selfNames.get(r.from) || 0) + 1);
  }
  const selfName = nameKey([...selfNames].sort((a, b) => b[1] - a[1])[0]?.[0] || '');
  const isMe = (k) => !!k && (k === self || (!!selfName && k === `name:${selfName}`));
  const names = {};
  const convos = new Map();
  let drafts = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = r['conversation id'];
    const t = exportDate(r.date);
    if (!id || t == null) { skipped += 1; continue; }
    if (yes(r['is message draft'])) { drafts += 1; continue; }
    const fromUrl = urlKey(r['sender profile url']);
    const from = fromUrl || nameOnlyKey(r.from);
    if (from && r.from && !names[from]) names[from] = String(r.from).trim();
    const toUrls = String(r['recipient profile urls'] || '').split(/[,;\s]+/).filter(Boolean).map(urlKey);
    const toNames = String(r.to || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Names line up with links only when there are as many of each (a name can
    // hold a comma: "Ben Ode, MBA"); without links, the names are all there is.
    const to = toUrls.length ? toUrls : toNames.map(nameOnlyKey).filter(Boolean);
    if (toUrls.length && toUrls.length === toNames.length) toUrls.forEach((u, i) => { if (!names[u]) names[u] = toNames[i]; });
    if (!toUrls.length) toNames.forEach((n) => { const k = nameOnlyKey(n); if (k && !names[k]) names[k] = n; });
    if (!convos.has(id)) convos.set(id, { id, title: '', everyone: new Set(), messages: [], kind: null, folder: '', newest: -Infinity });
    const c = convos.get(id);
    if (from) c.everyone.add(from);
    to.forEach((p) => c.everyone.add(p));
    c.kind = c.kind || kindOfRow(r);
    if (t >= c.newest) { c.newest = t; c.folder = String(r.folder || '').trim().toLowerCase().slice(0, 30); }
    const m = { t, fromMe: isMe(from) };
    if (keepText) {
      m.text = [r.subject, r.content].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
      if (!c.title && r['conversation title']) c.title = String(r['conversation title']).trim();
    }
    c.messages.push(m);
  }
  const conversations = [];
  for (const c of convos.values()) {
    const people = [...c.everyone].filter((p) => p && !isMe(p)).sort();
    c.messages.sort((a, b) => a.t - b.t);
    const out = { id: c.id, people, group: people.length > 1, kind: c.kind, folder: c.folder, messages: c.messages };
    if (keepText) out.title = c.title;
    conversations.push(out);
  }
  for (const k of Object.keys(names)) if (isMe(k)) delete names[k];
  return { self, conversations, names, drafts, skipped };
}

/**
 * What the Conversations list keeps of one conversation, never any words:
 * { id, people, group, kind, folder, last, lastFromThem, count, mine }. `mine`
 * is how many of the messages you wrote; all of them means no one has answered.
 */
export function conversationSummary(c) {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id,
    people: c.people,
    group: c.group,
    kind: c.kind || null,
    folder: c.folder || '',
    last: last ? last.t : null,
    lastFromThem: last ? !last.fromMe : null,
    count: c.messages.length,
    mine: c.messages.filter((m) => m.fromMe).length,
  };
}

/** The same people, by their names: a set's signature, or null when a name is missing. */
function nameSignature(keys, nameOf) {
  const out = [];
  for (const k of keys) {
    const n = nameKey(nameOf(k));
    if (!n) return null;
    out.push(n);
  }
  return out.sort().join('|');
}

/**
 * The Conversations list: the export's conversations with what the live sync
 * adds (unread, the thread's link, and a newer last message), plus a
 * conversation for each person or group the sync found and the export doesn't
 * have yet (id `live:<key>`, count unknown).
 *
 *   live    your connections, by their key (matchLive)
 *   others  people who aren't your connections, by the link messaging gives
 *           them, with their name: matched to the export's conversation with
 *           someone of that name when only one has it
 *   groups  group conversations: { threadUrl, people, names, last, unread },
 *           matched to the export's group with the same people by name
 *   names   the export's names, by key
 */
export function conversationList(list = [], live = {}, { others = {}, groups = [], names = {} } = {}) {
  const out = (Array.isArray(list) ? list : []).map((c) => ({ ...c, unread: null, threadUrl: null }));
  const oneToOne = new Map();
  for (const c of out) {
    if (c.group || c.people?.length !== 1) continue;
    const had = oneToOne.get(c.people[0]);
    if (!had || (c.last || 0) > (had.last || 0)) oneToOne.set(c.people[0], c);
  }
  const addLive = (c, v) => {
    if (v.last && (!c.last || v.last > c.last)) {
      c.last = v.last;
      if (typeof v.lastFromThem === 'boolean') c.lastFromThem = v.lastFromThem;
    }
    c.unread = Number.isFinite(v.unread) ? v.unread : c.unread;
    c.threadUrl = v.threadUrl || c.threadUrl;
  };
  const fresh = (id, people, group) => ({ id, people, group, kind: null, folder: '', last: null, lastFromThem: null, count: null, mine: null, unread: null, threadUrl: null });
  for (const [key, v] of Object.entries(live || {})) {
    if (!v || typeof v !== 'object') continue;
    let c = oneToOne.get(key);
    if (!c) {
      c = fresh(`live:${key}`, [key], false);
      out.push(c);
      oneToOne.set(key, c);
    }
    addLive(c, v);
  }
  // Someone who isn't a connection: the export knows them by their /in/name
  // link, messaging by /in/ACoA…, so only their name can join the two.
  const byName = new Map();
  for (const [key, c] of oneToOne) {
    const n = nameKey(names[key]);
    if (n) byName.set(n, byName.has(n) ? null : c);
  }
  for (const [link, v] of Object.entries(others || {})) {
    if (!v || typeof v !== 'object') continue;
    let c = oneToOne.get(link) || byName.get(nameKey(v.name)) || null;
    if (!c) {
      c = fresh(`live:${link}`, [link], false);
      out.push(c);
      oneToOne.set(link, c);
    }
    c.liveKey = link;
    addLive(c, v);
  }
  const groupsByNames = new Map();
  for (const c of out) {
    if (!c.group) continue;
    const sig = nameSignature(c.people, (k) => names[k]);
    if (sig) groupsByNames.set(sig, groupsByNames.has(sig) ? null : c);
  }
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || !Array.isArray(g.people) || !g.people.length) continue;
    const sig = nameSignature(g.people, (k) => g.names?.[k] || names[k]);
    let c = (sig && groupsByNames.get(sig)) || null;
    if (!c) {
      c = fresh(`live:${g.threadUrl || g.people.join(',')}`, g.people, true);
      out.push(c);
      if (sig) groupsByNames.set(sig, c);
    }
    addLive(c, g);
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

/**
 * Every request in Invitations.csv, one record each, newest first:
 * { id, dir: 'in' | 'out', key, name, t, note? }. `key` is the other person's
 * profile link (inviterProfileUrl or inviteeProfileUrl, in newer exports), or
 * their name (nameOnlyKey) when there's no link. The note sent with a request
 * is written by a person, like a message, so it's read only with keepText.
 */
export function buildInvitations(rows = [], { keepText = false } = {}) {
  const out = [];
  for (const r of rows) {
    const d = String(r.direction || '').toUpperCase();
    if (d !== 'INCOMING' && d !== 'OUTGOING') continue;
    const dir = d === 'INCOMING' ? 'in' : 'out';
    const name = String((dir === 'in' ? r.from : r.to) || '').trim();
    const url = urlKey(dir === 'in' ? r.inviterprofileurl : r.inviteeprofileurl);
    const key = (url && /\/in\//.test(url) ? url : null) || nameOnlyKey(name);
    if (!key) continue;
    const t = exportDate(r['sent at']);
    const inv = { id: `${dir}|${key}|${t ?? ''}`, dir, key, name: name.slice(0, 120), t };
    if (keepText && String(r.message || '').trim()) inv.note = String(r.message).trim().slice(0, 2000);
    out.push(inv);
  }
  return out.sort((a, b) => (b.t || 0) - (a.t || 0));
}

export const nameKey = (s) => String(s || '').split(',')[0].normalize('NFD').replace(/[̀-ͯ]/g, '')
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

/** (link, name) → your connection's key: by link when it's the same, else by a name only one connection has; null otherwise. */
function connectionMatcher(connections = []) {
  const byUrl = new Map();
  const byName = new Map();
  for (const c of connections) {
    const key = keyFor(c);
    byUrl.set(key, key);
    const n = nameKey(c.name);
    if (n) byName.set(n, byName.has(n) ? null : key);   // null: two people share it
  }
  return (url, name) => byUrl.get(keyFor({ profile_url: url })) || byName.get(nameKey(name)) || null;
}

const PROFILE = /^https:\/\/www\.linkedin\.com\/in\/[^/?#\s]+\/?$/;
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) : '');

/**
 * The live messages sync's people, matched to your connections. LinkedIn's
 * messaging gives a member link (/in/ACoA…) your connections list doesn't have,
 * so a person is matched by their link when it's the same, otherwise by their
 * name when exactly one connection has it. For a connection only the match is
 * kept, never the name: the app has it already. Returns
 *
 *   live       { connectionKey: { last, unread, threadUrl, lastFromThem, preview } }
 *   others     { link: { name, ...the same } }: people who aren't your
 *              connections. Their name is kept (and nothing else says who they
 *              are), so the Social tab can list them.
 *   unmatched  how many are in `others`
 *
 * The caller decides whether the previews' words are kept.
 */
export function matchLive(incoming = {}, connections = []) {
  const match = connectionMatcher(connections);
  const live = {};
  const others = {};
  for (const [url, v] of Object.entries(incoming || {})) {
    if (!v || typeof v !== 'object') continue;
    const key = match(url, v.name);
    const entry = {
      last: Number(v.last) || null,
      unread: Number.isFinite(Number(v.unread)) && v.unread !== null ? Number(v.unread) : null,
      threadUrl: threadLink(v.threadUrl),
      lastFromThem: typeof v.lastFromThem === 'boolean' ? v.lastFromThem : null,
      preview: previewOf(v.preview),
    };
    if (!key) {
      const link = keyFor({ profile_url: url });
      if (PROFILE.test(url) && !others[link]) others[link] = { name: cleanName(v.name), ...entry };
      continue;
    }
    if (live[key] && (live[key].last || 0) >= (entry.last || 0)) continue;
    live[key] = entry;
  }
  return { live, others, unmatched: Object.keys(others).length };
}

/**
 * The live sync's group conversations, each member matched to your connections
 * as matchLive does: { threadUrl, people, names, last, unread }. `people` are
 * connection keys where matched, else the link messaging gave; `names` keeps
 * the names of the ones who aren't connections only. No words: a group's
 * newest message isn't read.
 */
export function matchLiveGroups(groups = [], connections = []) {
  const match = connectionMatcher(connections);
  const out = [];
  for (const g of Array.isArray(groups) ? groups.slice(0, 5000) : []) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.people)) continue;
    const people = [];
    const names = {};
    for (const url of g.people.slice(0, 200)) {
      if (typeof url !== 'string' || !PROFILE.test(url)) continue;
      const name = cleanName(g.names?.[url]);
      const key = match(url, name);
      if (key) { people.push(key); continue; }
      const link = keyFor({ profile_url: url });
      people.push(link);
      if (name) names[link] = name;
    }
    if (people.length < 2) continue;
    out.push({
      threadUrl: threadLink(g.threadUrl),
      people: [...new Set(people)].sort(),
      names,
      last: Number(g.last) || null,
      unread: Number.isFinite(Number(g.unread)) && g.unread !== null ? Number(g.unread) : null,
      lastFromThem: typeof g.lastFromThem === 'boolean' ? g.lastFromThem : null,
    });
  }
  return out;
}

/**
 * A new live sync over what earlier ones found: per person (or group), the
 * newer of the two. A quick sync reads only the top of the list, so what a
 * full-history sync found further down stays until something newer replaces it.
 */
export function mergeLive(before = {}, after = {}) {
  const out = { ...(before && typeof before === 'object' ? before : {}) };
  for (const [k, v] of Object.entries(after || {})) {
    if (!out[k] || (v.last || 0) >= (out[k].last || 0)) out[k] = v;
  }
  return out;
}
