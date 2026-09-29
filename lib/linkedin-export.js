// The Social tab (experimental): what your own LinkedIn data export says about
// your relationships. The export is the folder LinkedIn emails you from
// Settings → Data privacy → Get a copy of your data; nothing here talks to
// LinkedIn. It runs in the browser on the files you pick, and what it keeps is
// numbers and dates only:
//
//   people     per profile: when you last messaged, who wrote last, how many
//              messages (1:1 conversations only). Never a message's text.
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

/**
 * From messages.csv, per person (by profile): { last, lastFromThem, total, recent }.
 * `self` is you: the sender in the most conversations. Only 1:1 conversations
 * count; group threads say little about one relationship. No text is read.
 */
export function messageStats(rows = []) {
  const convos = new Map();
  const senders = new Map();
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
    if (!senders.has(from)) senders.set(from, new Set());
    senders.get(from).add(id);
  }
  let self = null;
  for (const [who, ids] of senders) if (!self || ids.size > senders.get(self).size) self = who;
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
