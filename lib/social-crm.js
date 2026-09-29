// The Social tab's CRM: one place for everyone you've been in touch with on
// LinkedIn, and your own notes on them.
//
// Blake, 2026-09-29: "it doesn't show all the conversations and sent messages;
// this needs to be a full CRM with past conversations, current ones, sent out,
// etc." The Conversations list showed only connections, and nothing you'd
// sent that wasn't a message. Here every person you've messaged, asked to
// connect, been asked by, or tracked a request to in the app is one contact,
// connection or not, with:
//
//   what LinkedIn says   their conversations (export and live sync), requests
//                        both ways (Invitations.csv), the app's own tracked
//                        requests (the Outlink queue's "Mark sent")
//   what you say         a stage, tags, notes and a next follow-up date: yours,
//                        kept per profile in crm-<profile>.json
//                        (app/api/social/crm), always, whatever the Keep my
//                        messages switch says, because you wrote them
//
// and the views: Inbox (waiting on you), Awaiting reply (you wrote last, no
// answer for N days), Follow-ups due, Pipeline (by stage), Sent, Received, All.
//
// Plain functions, no React; tests/social-crm.test.mjs.

import { keyFor, routeIndex, routesFor } from './separation.js';
import { nameKey } from './linkedin-export.js';

const DAY = 86400000;

export const STAGES = Object.freeze([
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'won', label: 'Won/Partner' },
  { id: 'not-now', label: 'Not now' },
]);
const STAGE_IDS = new Set(STAGES.map((s) => s.id));
export const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || '';

/** Awaiting reply: you wrote last, and nothing came back for this many days. */
export const AWAIT_DAYS = 7;
const MAX_NOTES = 20000;
const MAX_TAGS = 30;
const MAX_TAG = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_OK = (k) => typeof k === 'string' && k.length > 0 && k.length < 300;

// ── The store: crm-<profile>.json ─────────────────────────────────────────

export function emptyCrm() {
  return { version: 1, settings: { awaitDays: AWAIT_DAYS }, people: {} };
}

/** Tags as typed, without commas or control characters, once each whatever the case. */
export function cleanTags(list) {
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const tag = String(t ?? '').replace(/[\u0000-\u001f,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** A real calendar day as YYYY-MM-DD, or null. */
function cleanDay(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : s;
}

/** One person's CRM entry with only what it may hold, or null when there's nothing in it. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const out = {};
  if (STAGE_IDS.has(e.stage)) out.stage = e.stage;
  const tags = cleanTags(e.tags);
  if (tags.length) out.tags = tags;
  if (typeof e.notes === 'string' && e.notes.trim()) out.notes = e.notes.slice(0, MAX_NOTES);
  const followUp = cleanDay(e.followUp);
  if (followUp) out.followUp = followUp;
  if (!Object.keys(out).length) return null;
  if (typeof e.updatedAt === 'string' && !Number.isNaN(Date.parse(e.updatedAt))) out.updatedAt = e.updatedAt;
  return out;
}

const cleanDays = (n) => {
  const d = Math.round(Number(n));
  return Number.isFinite(d) && d >= 1 && d <= 365 ? d : AWAIT_DAYS;
};

/** The whole file, read back: anything that isn't a CRM entry is dropped. */
export function cleanCrm(raw) {
  const out = emptyCrm();
  if (!raw || typeof raw !== 'object') return out;
  out.settings.awaitDays = cleanDays(raw.settings?.awaitDays);
  for (const [key, e] of Object.entries(raw.people && typeof raw.people === 'object' ? raw.people : {})) {
    if (!KEY_OK(key)) continue;
    const entry = cleanEntry(e);
    if (entry) out.people[key] = entry;
  }
  return out;
}

/**
 * One change to the store: { key, set } changes that person's fields (only the
 * ones sent; null or '' clears one), { settings } the settings. A person left
 * with nothing is taken out. Returns the new store; the old one isn't touched.
 */
export function patchCrm(store, { key, set, settings } = {}, now = Date.now()) {
  const out = cleanCrm(store);
  if (settings && typeof settings === 'object' && 'awaitDays' in settings) out.settings.awaitDays = cleanDays(settings.awaitDays);
  if (KEY_OK(key) && set && typeof set === 'object') {
    const merged = { ...(out.people[key] || {}) };
    for (const f of ['stage', 'tags', 'notes', 'followUp']) {
      if (!(f in set)) continue;
      if (set[f] == null || set[f] === '' || (Array.isArray(set[f]) && !set[f].length)) delete merged[f];
      else merged[f] = set[f];
    }
    delete merged.updatedAt;
    const entry = cleanEntry(merged);
    if (entry) out.people[key] = { ...entry, updatedAt: new Date(now).toISOString() };
    else delete out.people[key];
  }
  return out;
}

// ── Contacts: everything known about each person ─────────────────────────

/** Today on this computer's calendar, as YYYY-MM-DD (a follow-up date is a day, not a moment). */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const PROFILE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+$/;
const slug = (u) => String(u || '').replace(/\/+$/, '').split('/').pop();

/** Who a key is, for showing: their name in the network, else as the export or the sync spelt it, else the end of their link. */
function nameFor(key, row, names) {
  if (row?.name) return row.name;
  if (names[key]) return names[key];
  if (key.startsWith('name:')) return key.slice(5).replace(/\b\w/g, (c) => c.toUpperCase());
  return slug(key);
}

const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const betterRow = (a, b) => (a.degree ?? 9) < (b.degree ?? 9)
  || ((a.degree ?? 9) === (b.degree ?? 9) && (TIER_ORDER[a.tier] ?? 9) < (TIER_ORDER[b.tier] ?? 9));

/**
 * Everyone you've been in touch with, one contact each, and the group
 * conversations beside them:
 *
 *   conversations  the Conversations list (conversationList): 1:1 ones make
 *                  contacts, groups are returned as they are
 *   invitations    buildInvitations' records
 *   network        { degree1, degree2, degree3 } rows, as /api/network sends them
 *   crm            the store (cleanCrm)
 *   names          names by key, from the export and the live sync
 *   also           keys to make a contact for even with nothing on file yet
 *                  (someone found by search, to add a note to)
 *
 * A person the export knows only by name (no link) is joined to the network's
 * person of that name when only one has it. A contact:
 *
 *   { key, name, row, connection, degree, profileUrl, introducers,
 *     conversations, groups, last, lastFromThem, unread, threadUrl, count,
 *     theyWrote, kind, invitesIn, invitesOut, request, crm, lastContact }
 */
export function buildContacts({ conversations = [], invitations = [], network = {}, crm = emptyCrm(), names = {}, also = [] } = {}) {
  const degree1 = network.degree1 || [];
  const degree2 = network.degree2 || [];
  const rows = [...degree1, ...degree2, ...(network.degree3 || [])];
  const byKey = new Map();
  const byName = new Map();
  for (const r of rows) {
    const k = keyFor(r);
    const had = byKey.get(k);
    if (!had || betterRow(r, had)) byKey.set(k, r);
  }
  for (const [k, r] of byKey) {
    const n = nameKey(r.name);
    if (n) byName.set(n, byName.has(n) && byName.get(n) !== k ? null : k);
  }
  const connected = new Set(degree1.map(keyFor));
  const routes = routeIndex(degree2);
  const bridgeById = new Map(degree1.map((r) => [r.id, r]));
  // A name-only key becomes the network's person of that name, when there's one.
  const resolve = (k) => (k.startsWith('name:') ? byName.get(k.slice(5)) || k : k);

  const contacts = new Map();
  const contact = (rawKey) => {
    const key = resolve(rawKey);
    let c = contacts.get(key);
    if (c) return c;
    const row = byKey.get(key) || null;
    c = {
      key,
      name: nameFor(key, row, names),
      row,
      connection: connected.has(key),
      degree: row?.degree ?? null,
      profileUrl: PROFILE.test(key) ? key : (row?.profile_url && PROFILE.test(keyFor(row)) ? keyFor(row) : null),
      introducers: row && row.degree === 2
        ? [...new Set(routesFor(row, routes, bridgeById).map((x) => x.bridge?.name).filter(Boolean))]
        : [],
      conversations: [],
      groups: [],
      last: null,
      lastFromThem: null,
      unread: null,
      threadUrl: null,
      count: 0,
      theyWrote: false,
      kind: null,
      invitesIn: [],
      invitesOut: [],
      request: null,
      crm: crm?.people?.[key] || null,
      lastContact: null,
    };
    contacts.set(key, c);
    return c;
  };

  const groups = [];
  for (const conv of conversations) {
    if (!conv || !Array.isArray(conv.people)) continue;
    if (conv.group) {
      groups.push({ ...conv, people: conv.people.map(resolve) });
      continue;
    }
    if (!conv.people.length) {
      // Only you wrote, and the export doesn't say to whom: kept as a group-like entry of its own.
      groups.push({ ...conv, unknown: true });
      continue;
    }
    const c = contact(conv.people[0]);
    c.conversations.push(conv);
    c.count += conv.count || 0;
    if (conv.lastFromThem === true || (conv.count != null && conv.mine != null && conv.count > conv.mine)) c.theyWrote = true;
    if (conv.last && (!c.last || conv.last >= c.last)) {
      c.last = conv.last;
      c.lastFromThem = conv.lastFromThem;
      c.unread = conv.unread;
      c.threadUrl = conv.threadUrl || c.threadUrl;
    } else if (!c.last && !conv.last) {
      c.threadUrl = conv.threadUrl || c.threadUrl;
    }
  }
  for (const c of contacts.values()) {
    c.conversations.sort((a, b) => (b.last || 0) - (a.last || 0));
    // An advert or an InMail only when every conversation with them is one.
    const kinds = new Set(c.conversations.map((x) => x.kind || null));
    c.kind = kinds.size === 1 ? [...kinds][0] : null;
  }
  for (const g of groups) for (const k of g.people) contacts.get(k)?.groups.push(g.id);

  for (const inv of invitations) {
    if (!inv?.key) continue;
    const c = contact(inv.key);
    if (inv.name && !c.row && !names[c.key]) c.name = inv.name;
    (inv.dir === 'in' ? c.invitesIn : c.invitesOut).push(inv);
  }

  // Requests the app tracks: the Outlink queue's "Mark sent", once per person.
  for (const r of rows) {
    const sent = r.outreach_status === 'sent' || r.outreach_status === 'accepted' || r.unlock_status === 'pending';
    if (!sent) continue;
    const c = contact(keyFor(r));
    const status = c.connection || r.outreach_status === 'accepted' ? 'accepted' : 'pending';
    if (!c.request || status === 'accepted') c.request = { status };
  }

  for (const key of Object.keys(crm?.people || {})) contact(key);
  for (const key of also) if (KEY_OK(key)) contact(key);

  for (const c of contacts.values()) {
    const times = [c.last, ...c.invitesIn.map((i) => i.t), ...c.invitesOut.map((i) => i.t)].filter(Boolean);
    c.lastContact = times.length ? Math.max(...times) : null;
  }
  return { contacts, groups };
}

/** Where a contact seems to be, from what happened, for when you haven't set a stage. */
export function suggestedStage(c) {
  if (c.theyWrote) return 'replied';
  if (c.conversations.length || c.invitesOut.length || c.request) return 'contacted';
  return 'new';
}

const isAdvert = (c) => c.kind === 'sponsored';

/** Waiting on you: they wrote last, or there's something unread. Unread first, then the newest. */
export function inboxOf(contacts) {
  return [...contacts].filter((c) => !isAdvert(c) && (c.lastFromThem === true || c.unread > 0))
    .sort((a, b) => (b.unread > 0) - (a.unread > 0) || (b.last || 0) - (a.last || 0));
}

/**
 * Awaiting reply: you wrote last, in a 1:1 conversation, and `days` or more
 * have gone by with nothing back, as of `asOf` (the newest thing the data
 * knows, so an older export reads as it was). Each with `waited` (days).
 */
export function awaitingOf(contacts, asOf, days = AWAIT_DAYS) {
  const out = [];
  for (const c of contacts) {
    if (isAdvert(c) || c.lastFromThem !== false || !c.last) continue;
    const waited = Math.floor((asOf - c.last) / DAY);
    if (waited >= days) out.push({ contact: c, waited });
  }
  return out.sort((a, b) => a.waited - b.waited);
}

/** Follow-ups due: a next follow-up date of today or before. Oldest first. */
export function followUpsDue(contacts, today = localDay()) {
  return [...contacts].filter((c) => c.crm?.followUp && c.crm.followUp <= today)
    .sort((a, b) => a.crm.followUp.localeCompare(b.crm.followUp));
}

/** The pipeline: people you've given a stage, by stage, most recently in touch first. */
export function pipelineOf(contacts) {
  const out = Object.fromEntries(STAGES.map((s) => [s.id, []]));
  for (const c of contacts) if (c.crm?.stage) out[c.crm.stage].push(c);
  for (const list of Object.values(out)) list.sort((a, b) => (b.lastContact || 0) - (a.lastContact || 0));
  return out;
}

/**
 * Sent: what went out from you, per person, newest first.
 *   invite    a connection request (Invitations.csv, OUTGOING): accepted once
 *             they're a connection, pending until then
 *   request   one the app tracked (Mark sent): the same
 *   awaiting  a message with no reply for `days` or more (awaitingOf)
 * Each: { contact, t, items: [{ type, t?, status?, waited?, id? }] }.
 */
export function sentOf(contacts, asOf, days = AWAIT_DAYS) {
  const list = [...contacts];
  const waiting = new Map(awaitingOf(list, asOf, days).map((a) => [a.contact.key, a.waited]));
  const out = [];
  for (const c of list) {
    const items = [];
    for (const inv of c.invitesOut) items.push({ type: 'invite', id: inv.id, t: inv.t, status: c.connection ? 'accepted' : 'pending' });
    if (c.request) items.push({ type: 'request', status: c.request.status });
    if (waiting.has(c.key)) items.push({ type: 'awaiting', t: c.last, waited: waiting.get(c.key) });
    if (!items.length) continue;
    out.push({ contact: c, items, t: Math.max(0, ...items.map((i) => i.t || 0)) });
  }
  return out.sort((a, b) => b.t - a.t);
}

/** Received: requests to you from people who aren't connections yet (so you haven't accepted them). Newest first. */
export function receivedOf(contacts) {
  const out = [];
  for (const c of contacts) {
    if (c.connection || !c.invitesIn.length) continue;
    out.push({ contact: c, t: Math.max(0, ...c.invitesIn.map((i) => i.t || 0)) });
  }
  return out.sort((a, b) => b.t - a.t);
}

/**
 * Search across names, companies, roles, tags and notes, and what was said
 * when the messages are kept: `said` is the set of conversation ids whose
 * kept messages match (GET /api/social/messages?q=).
 */
export function matchesContact(c, q, said = null) {
  const words = String(q || '').trim().toLowerCase();
  if (!words) return true;
  const hay = [c.name, c.row?.company, c.row?.role, c.row?.headline, ...(c.crm?.tags || []), c.crm?.notes]
    .filter(Boolean).join('\n').toLowerCase();
  return hay.includes(words) || (!!said && c.conversations.some((conv) => said.has(conv.id)));
}

// ── The CSV export ───────────────────────────────────────────────────────

/**
 * One cell. Quoted when it holds a comma, a quote or a line break; and a
 * leading =, +, - or @ gets a ' in front, so a spreadsheet shows it as text
 * instead of running it as a formula (a note or a name is written by someone).
 */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoDay = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');

export const CSV_COLUMNS = ['Name', 'Company', 'Profile', 'Connection', 'Stage', 'Tags', 'Last contact', 'Who wrote last', 'Next follow-up', 'Notes'];

/** The CRM table as a CSV file's text: one row per contact, as Excel and Numbers read it (a BOM, CRLF). */
export function crmCsv(contacts) {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const c of contacts) {
    lines.push([
      c.name,
      c.row?.company || '',
      c.profileUrl || '',
      c.connection ? 'Yes' : 'No',
      stageLabel(c.crm?.stage),
      (c.crm?.tags || []).join('; '),
      isoDay(c.lastContact),
      c.lastFromThem == null ? '' : c.lastFromThem ? 'Them' : 'You',
      c.crm?.followUp || '',
      c.crm?.notes || '',
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
