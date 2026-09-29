import { rmSync } from 'node:fs';
import { db } from '../../../lib/db';
import { resolveProfile } from '../../../lib/profile';
import { matchLive, matchLiveGroups, mergeLive } from '../../../lib/linkedin-export';
import { socialFiles, readJson, writeJsonAtomic, readMessages, deleteMessages } from '../../../lib/social-store';

// The Social tab's saved findings (lib/linkedin-export.js): numbers and dates
// from your own LinkedIn export and the live messages sync, one file per
// profile in the data folder, and the names of people who aren't your
// connections (nothing else in the app says who they are). No message text is
// kept in this file: the words, when Keep my messages is on, go to their own
// file (lib/social-store.js, app/api/social/messages). GET reads it, POST
// replaces it, PUT takes a live sync, PATCH flips a switch, DELETE forgets it
// all. Your CRM notes are a file of their own (app/api/social/crm), which
// Forget it leaves alone: the page asks about them separately.

// A person's key: their profile link, as lib/separation.js keyFor makes it.
const KEY_OK = (k) => typeof k === 'string' && k.length > 0 && k.length < 300;
const num = (n) => (Number.isFinite(Number(n)) && n !== null ? Number(n) : null);
const name = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) : '');

/**
 * An import's list of conversations, with nothing but the fields the list
 * shows. A conversation with no one but you in it (the export didn't say to
 * whom) stays, with no people: nothing is dropped.
 */
function cleanConversations(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || !Array.isArray(c.people)) continue;
    const people = c.people.filter(KEY_OK).slice(0, 200);
    out.push({
      id: c.id,
      people,
      group: c.group === true,
      kind: ['sponsored', 'inmail'].includes(c.kind) ? c.kind : null,
      folder: typeof c.folder === 'string' && /^[\w -]{0,30}$/.test(c.folder) ? c.folder.toLowerCase() : '',
      last: Number(c.last) || null,
      lastFromThem: typeof c.lastFromThem === 'boolean' ? c.lastFromThem : null,
      count: num(c.count),
      mine: num(c.mine),
    });
  }
  return out;
}

/** An import's requests (buildInvitations), without their notes: those go with the messages, and only while they're kept. */
function cleanInvitations(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const i of list.slice(0, 50000)) {
    if (!i || !['in', 'out'].includes(i.dir) || !KEY_OK(i.key) || typeof i.id !== 'string' || i.id.length > 400) continue;
    out.push({ id: i.id, dir: i.dir, key: i.key, name: name(i.name), t: Number(i.t) || null });
  }
  return out;
}

/** Names by key, as the export spells them. */
function cleanNames(names) {
  const out = {};
  if (!names || typeof names !== 'object') return out;
  for (const [k, v] of Object.entries(names).slice(0, 200000)) {
    const n = name(v);
    if (KEY_OK(k) && n) out[k] = n;
  }
  return out;
}

export async function GET() {
  const files = socialFiles();
  if (!files) return Response.json({ social: null });
  const social = readJson(files.social, null);
  if (!social) return Response.json({ social: null });
  // The lists (conversations, requests, names, what the sync found beyond your
  // connections) can run to thousands; the Galaxy and the tab's counts don't
  // need them, and GET /api/social/messages serves them.
  const { conversations, invitations, names, liveOthers, liveGroups, ...rest } = social;
  return Response.json({ social: { ...rest, conversationCount: Array.isArray(conversations) ? conversations.length : 0 } });
}

export async function POST(request) {
  const files = socialFiles();
  if (!files) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  // Only the known fields, so nothing else rides along into the file.
  const before = readJson(files.social, {}) || {};
  const clean = {
    live: before.live || {},
    liveAt: before.liveAt || null,
    liveOthers: before.liveOthers || {},
    liveGroups: before.liveGroups || [],
    autoSync: before.autoSync === true,
    keepMessages: before.keepMessages === true,
    importedAt: new Date().toISOString(),
    asOf: Number(body?.asOf) || null,
    people: body?.people && typeof body.people === 'object' ? body.people : {},
    conversations: cleanConversations(body?.conversations),
    chapters: Array.isArray(body?.chapters) ? body.chapters : [],
    posts: body?.posts && typeof body.posts === 'object' ? body.posts : null,
    invites: body?.invites && typeof body.invites === 'object' ? body.invites : null,
    invitations: cleanInvitations(body?.invitations),
    names: cleanNames(body?.names),
    emails: body?.emails === true,
  };
  for (const p of Object.values(clean.people)) {
    if (p && typeof p === 'object') {
      for (const k of Object.keys(p)) if (!['last', 'lastFromThem', 'total', 'recent', 'email'].includes(k)) delete p[k];
      if (!clean.emails) delete p.email;
    }
  }
  writeJsonAtomic(files.social, clean);
  return Response.json({ ok: true, people: Object.keys(clean.people).length, conversations: clean.conversations.length, invitations: clean.invitations.length });
}

// From the scanner's experimental messages sync (scripts/scrape.py sync_messages):
// per person, when your 1:1 conversation was last active, unread count, the
// thread's link, who wrote last and the newest message; and the group
// conversations, without any words. Kept beside what the export gave: your
// connections under `live`, everyone else (with their name) under
// `liveOthers`, groups under `liveGroups`, each merged with what earlier syncs
// found, so a quick sync doesn't forget what a full-history one read further
// down. The newest message's words go to the messages file, and only while
// Keep my messages is on.
export async function PUT(request) {
  const files = socialFiles();
  if (!files) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  const saved = readJson(files.social, {}) || {};
  // Matched to your connections here, so the names the sync sends go no further.
  const me = resolveProfile({ create: false });
  let conns = [];
  try {
    const q = db.from('linkedin_connections').select('name, profile_url, id').eq('degree', 1);
    if (me?.id) q.eq('user_id', me.id);
    conns = (await q).data || [];
  } catch { /* no connections yet */ }
  const { live: matched, others: found, unmatched } = matchLive(body?.live || {}, conns);
  const live = {};
  const others = {};
  const previews = {};
  for (const [into, from] of [[live, matched], [others, found]]) {
    for (const [key, { preview, ...rest }] of Object.entries(from)) {
      into[key] = rest;
      if (saved.keepMessages === true && preview?.text) previews[key] = preview;
    }
  }
  const groups = {};
  for (const g of saved.liveGroups || []) groups[g.threadUrl || g.people.join(',')] = g;
  for (const g of matchLiveGroups(body?.groups || [], conns)) {
    const k = g.threadUrl || g.people.join(',');
    if (!groups[k] || (g.last || 0) >= (groups[k].last || 0)) groups[k] = g;
  }
  writeJsonAtomic(files.social, {
    ...saved,
    live: mergeLive(saved.live, live),
    liveOthers: mergeLive(saved.liveOthers, others),
    liveGroups: Object.values(groups),
    liveAt: new Date().toISOString(),
  });
  if (Object.keys(previews).length) {
    const kept = readJson(files.messages, {}) || {};
    writeJsonAtomic(files.messages, { ...kept, previews: { ...(kept.previews || {}), ...previews } });
  }
  return Response.json({ ok: true, people: Object.keys(live).length, unmatched, groups: Object.keys(groups).length, previews: Object.keys(previews).length });
}

// The Social tab's switches: "once a day" for the live messages sync, and
// Keep my messages. Only the ones sent change. Turning Keep my messages off
// deletes the kept messages here too, so the words can't outlive the switch
// whatever the page did first.
export async function PATCH(request) {
  const files = socialFiles();
  if (!files) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body = {};
  try { body = await request.json(); } catch { /* nothing to change */ }
  const next = { ...(readJson(files.social, {}) || {}) };
  if (typeof body?.autoSync === 'boolean') next.autoSync = body.autoSync;
  if (typeof body?.keepMessages === 'boolean') next.keepMessages = body.keepMessages;
  if (next.keepMessages !== true) deleteMessages(files);
  writeJsonAtomic(files.social, next);
  return Response.json({ ok: true, autoSync: next.autoSync === true, keepMessages: next.keepMessages === true });
}

// Forget it: both files, the numbers and the words. Not your CRM notes: the
// page asks about those on their own (DELETE /api/social/crm).
export async function DELETE() {
  const files = socialFiles();
  if (files) {
    rmSync(files.social, { force: true });
    deleteMessages(files);
  }
  return Response.json({ ok: true });
}
