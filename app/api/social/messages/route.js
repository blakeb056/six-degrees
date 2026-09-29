import { rmSync } from 'node:fs';
import { conversationList } from '../../../../lib/linkedin-export';
import { socialFiles, readJson, writeJsonAtomic, readMessages, deleteMessages } from '../../../../lib/social-store';

// The Social tab's Conversations: the list, one thread at a time, and the
// messages themselves when Keep my messages is on (lib/social-store.js has the
// two files and why they're apart).
//
//   GET                       the list, no words: who, when, who wrote last,
//                             unread, how many, the thread's link
//   GET ?id=<id> | ?with=<key> one thread, a page at a time (before, limit):
//                             its messages only if they're kept
//   GET ?q=<words>            the conversations whose kept messages say that
//   POST                      an import's messages, in parts
//   DELETE                    the messages gone, the list kept
//
// Nothing here goes anywhere but this computer's browser: no route of the app
// sends messages on, and a copy of the network doesn't carry this file.

const PAGE = 100;
const MAX_TEXT = 20000;

function state() {
  const files = socialFiles();
  if (!files) return null;
  const social = readJson(files.social, {}) || {};
  const keep = social.keepMessages === true;
  const kept = keep ? readMessages(files.messages) : { threads: {}, previews: {} };
  return { files, social, keep, kept, list: conversationList(social.conversations, social.live) };
}

/** A conversation's kept messages, oldest first, with the live sync's newest one after them when it's newer. */
function messagesOf(c, kept) {
  const msgs = kept.threads[c.id]?.messages || [];
  const preview = !c.group && c.people.length === 1 ? kept.previews[c.people[0]] : null;
  if (preview?.text && (!msgs.length || (preview.t || 0) > (msgs[msgs.length - 1].t || 0))) return [...msgs, preview];
  return msgs;
}

export async function GET(request) {
  const s = state();
  if (!s) return Response.json({ keepMessages: false, conversations: [] });
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const withKey = url.searchParams.get('with');

  if (id || withKey) {
    const c = id
      ? s.list.find((x) => x.id === id)
      : s.list.filter((x) => !x.group && x.people[0] === withKey).sort((a, b) => (b.last || 0) - (a.last || 0))[0];
    if (!c) return Response.json({ error: 'That conversation isn’t here.' }, { status: 404 });
    if (!s.keep) return Response.json({ kept: false, id: c.id, total: c.count });
    const msgs = messagesOf(c, s.kept);
    const total = msgs.length;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || PAGE));
    const before = url.searchParams.has('before') ? Math.max(0, Math.min(total, Number(url.searchParams.get('before')) || 0)) : total;
    const start = Math.max(0, before - limit);
    return Response.json({ kept: true, id: c.id, title: s.kept.threads[c.id]?.title || '', total, start, messages: msgs.slice(start, before) });
  }

  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  if (url.searchParams.has('q')) {
    if (!s.keep || q.length < 2) return Response.json({ ids: [] });
    const ids = s.list.filter((c) => messagesOf(c, s.kept).some((m) => String(m.text || '').toLowerCase().includes(q))).map((c) => c.id);
    return Response.json({ ids });
  }

  const conversations = s.list.map((c) => ({
    ...c,
    title: s.kept.threads[c.id]?.title || '',
    hasText: s.keep && messagesOf(c, s.kept).length > 0,
  }));
  return Response.json({ keepMessages: s.keep, conversations });
}

/** One message as it's kept, or null when it isn't one. */
function cleanMessage(m) {
  if (!m || typeof m !== 'object' || !Number.isFinite(Number(m.t))) return null;
  return { t: Number(m.t), fromMe: m.fromMe === true, text: typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT) : '' };
}

// An import's messages: { part, parts, threads: { id: { title, messages } } }.
// Each part stays under the 10 MB a request can carry here, so a long history
// comes in several. They gather in the `incoming` file and replace the kept
// messages only when the last one lands, so a half-sent import never shows as
// the whole thing. Refused while Keep my messages is off, whatever the page sent.
export async function POST(request) {
  const s = state();
  if (!s) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  if (!s.keep) return Response.json({ error: 'Keep my messages is off, so nothing was saved.' }, { status: 409 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  const part = Number(body?.part);
  const parts = Number(body?.parts);
  if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 0 || part >= parts) {
    return Response.json({ error: 'That isn’t a part of an import.' }, { status: 400 });
  }
  let into;
  if (part === 0) {
    // A new import replaces the export's messages; the live sync's previews stay.
    into = { threads: {}, previews: s.kept.previews || {} };
  } else {
    into = readJson(s.files.incoming, null);
    if (!into?.threads) return Response.json({ error: 'The start of this import is missing. Choose the export folder again.' }, { status: 409 });
  }
  const threads = body?.threads && typeof body.threads === 'object' ? body.threads : {};
  for (const [id, t] of Object.entries(threads)) {
    if (!id || id.length > 200 || !t || !Array.isArray(t.messages)) continue;
    const to = into.threads[id] || (into.threads[id] = { title: '', messages: [] });
    if (typeof t.title === 'string' && t.title && !to.title) to.title = t.title.slice(0, 200);
    for (const m of t.messages) {
      const c = cleanMessage(m);
      if (c) to.messages.push(c);
    }
  }
  if (part === parts - 1) {
    writeJsonAtomic(s.files.messages, into);
    rmSync(s.files.incoming, { force: true });
  } else {
    writeJsonAtomic(s.files.incoming, into);
  }
  return Response.json({ ok: true, part, parts, done: part === parts - 1 });
}

// The words gone, the list and the numbers kept: what switching Keep my
// messages off does (the PATCH that turns it off deletes them as well).
export async function DELETE() {
  deleteMessages(socialFiles());
  return Response.json({ ok: true });
}
