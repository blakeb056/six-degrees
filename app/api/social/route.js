import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../../lib/db-client';
import { resolveProfile } from '../../../lib/profile';
import { db } from '../../../lib/db';
import { matchLive } from '../../../lib/linkedin-export';

// The Social tab's saved findings (lib/linkedin-export.js): numbers and dates
// from your own LinkedIn export, one file per profile in the data folder. No
// message text ever reaches here. GET reads it, POST replaces it, DELETE
// forgets it.

function fileFor() {
  const me = resolveProfile({ create: false });
  if (!me?.id || !/^[\w-]+$/.test(String(me.id))) return null;
  return path.join(dataDir(), `social-${me.id}.json`);
}

export async function GET() {
  const file = fileFor();
  if (!file) return Response.json({ social: null });
  try { return Response.json({ social: JSON.parse(readFileSync(file, 'utf8')) }); } catch { return Response.json({ social: null }); }
}

export async function POST(request) {
  const file = fileFor();
  if (!file) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  // Only the known fields, so nothing else rides along into the file.
  let before = {};
  try { before = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* none yet */ }
  const clean = {
    live: before.live || {},
    liveAt: before.liveAt || null,
    autoSync: before.autoSync === true,
    importedAt: new Date().toISOString(),
    asOf: Number(body?.asOf) || null,
    people: body?.people && typeof body.people === 'object' ? body.people : {},
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
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean));
  renameSync(tmp, file);
  return Response.json({ ok: true, people: Object.keys(clean.people).length });
}

// From the scanner's experimental messages sync (scripts/scrape.py sync_messages):
// per person, when your 1:1 conversation was last active and unread count.
// Merged in beside what the export gave, kept under `live`.
export async function PUT(request) {
  const file = fileFor();
  if (!file) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* first sync */ }
  // Matched to your connections here, so the names the sync sends go no further.
  const me = resolveProfile({ create: false });
  let conns = [];
  try {
    const q = db.from('linkedin_connections').select('name, profile_url, id').eq('degree', 1);
    if (me?.id) q.eq('user_id', me.id);
    conns = (await q).data || [];
  } catch { /* no connections yet */ }
  const { live, unmatched } = matchLive(body?.live || {}, conns);
  const next = { ...saved, live, liveAt: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, file);
  return Response.json({ ok: true, people: Object.keys(live).length, unmatched });
}

// The Social tab's "once a day" switch for the live messages sync.
export async function PATCH(request) {
  const file = fileFor();
  if (!file) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body = {};
  try { body = await request.json(); } catch { /* nothing to change */ }
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* none yet */ }
  const next = { ...saved, autoSync: body?.autoSync === true };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, file);
  return Response.json({ ok: true, autoSync: next.autoSync });
}

export async function DELETE() {
  const file = fileFor();
  if (file) rmSync(file, { force: true });
  return Response.json({ ok: true });
}
