import { rmSync } from 'node:fs';
import { db } from '../../../lib/db';
import { resolveProfile } from '../../../lib/profile';
import { matchLive } from '../../../lib/linkedin-export';
import { socialFiles, readJson, writeJsonAtomic, readMessages, deleteMessages } from '../../../lib/social-store';

// The Social tab's saved findings (lib/linkedin-export.js): numbers and dates
// from your own LinkedIn export and the live messages sync, one file per
// profile in the data folder. No message text is kept in this file: the words,
// when Keep my messages is on, go to their own file (lib/social-store.js,
// app/api/social/messages). GET reads it, POST replaces it, PUT takes a live
// sync, PATCH flips a switch, DELETE forgets it all.

// A person's key: their profile link, as lib/separation.js keyFor makes it.
const KEY_OK = (k) => typeof k === 'string' && k.length > 0 && k.length < 300;

/** An import's list of conversations, with nothing but the fields the list shows. */
function cleanConversations(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || !Array.isArray(c.people)) continue;
    const people = c.people.filter(KEY_OK).slice(0, 200);
    if (!people.length) continue;
    out.push({
      id: c.id,
      people,
      group: c.group === true,
      last: Number(c.last) || null,
      lastFromThem: typeof c.lastFromThem === 'boolean' ? c.lastFromThem : null,
      count: Number.isFinite(Number(c.count)) ? Number(c.count) : null,
    });
  }
  return out;
}

export async function GET() {
  const files = socialFiles();
  if (!files) return Response.json({ social: null });
  const social = readJson(files.social, null);
  if (!social) return Response.json({ social: null });
  // The list of conversations can run to thousands; the Galaxy and the tab's
  // counts don't need it, and GET /api/social/messages serves it.
  const { conversations, ...rest } = social;
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
    autoSync: before.autoSync === true,
    keepMessages: before.keepMessages === true,
    importedAt: new Date().toISOString(),
    asOf: Number(body?.asOf) || null,
    people: body?.people && typeof body.people === 'object' ? body.people : {},
    conversations: cleanConversations(body?.conversations),
    chapters: Array.isArray(body?.chapters) ? body.chapters : [],
    posts: body?.posts && typeof body.posts === 'object' ? body.posts : null,
    invites: body?.invites && typeof body.invites === 'object' ? body.invites : null,
    emails: body?.emails === true,
  };
  for (const p of Object.values(clean.people)) {
    if (p && typeof p === 'object') {
      for (const k of Object.keys(p)) if (!['last', 'lastFromThem', 'total', 'recent', 'email'].includes(k)) delete p[k];
      if (!clean.emails) delete p.email;
    }
  }
  writeJsonAtomic(files.social, clean);
  return Response.json({ ok: true, people: Object.keys(clean.people).length, conversations: clean.conversations.length });
}

// From the scanner's experimental messages sync (scripts/scrape.py sync_messages):
// per person, when your 1:1 conversation was last active, unread count, the
// thread's link, who wrote last and the newest message. Merged in beside what
// the export gave, kept under `live`. The newest message's words go to the
// messages file, and only while Keep my messages is on.
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
  const { live: matched, unmatched } = matchLive(body?.live || {}, conns);
  const live = {};
  const previews = {};
  for (const [key, { preview, ...rest }] of Object.entries(matched)) {
    live[key] = rest;
    if (saved.keepMessages === true && preview?.text) previews[key] = preview;
  }
  writeJsonAtomic(files.social, { ...saved, live, liveAt: new Date().toISOString() });
  if (Object.keys(previews).length) {
    const kept = readJson(files.messages, {}) || {};
    writeJsonAtomic(files.messages, { ...kept, previews: { ...(kept.previews || {}), ...previews } });
  }
  return Response.json({ ok: true, people: Object.keys(live).length, unmatched, previews: Object.keys(previews).length });
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

// Forget it: both files, the numbers and the words.
export async function DELETE() {
  const files = socialFiles();
  if (files) {
    rmSync(files.social, { force: true });
    deleteMessages(files);
  }
  return Response.json({ ok: true });
}
