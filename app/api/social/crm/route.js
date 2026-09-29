import { rmSync } from 'node:fs';
import { cleanCrm, patchCrm, emptyCrm } from '../../../../lib/social-crm';
import { socialFiles, readJson, writeJsonAtomic } from '../../../../lib/social-store';

// The Social tab's CRM: your own stage, tags, notes and next follow-up for each
// person, in crm-<profile>.json in the data folder (lib/social-crm.js has the
// shape). Yours, so always kept, whatever Keep my messages says; never sent
// anywhere, and not in "Save a copy of my network".
//
//   GET     the whole store
//   PATCH   { key, set: { stage?, tags?, notes?, followUp? } } one person's
//           fields (null or '' clears one), or { settings: { awaitDays } }
//   DELETE  the file gone: only when you've said so, on its own confirm

export async function GET() {
  const files = socialFiles();
  if (!files) return Response.json({ crm: emptyCrm() });
  return Response.json({ crm: cleanCrm(readJson(files.crm, null)) });
}

export async function PATCH(request) {
  const files = socialFiles();
  if (!files) return Response.json({ error: 'Pick a profile first.' }, { status: 400 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'That isn’t readable.' }, { status: 400 }); }
  // Read, change one person, write whole: two quick edits in a row can't
  // leave half a file, and the second sees the first (Node runs one at a time).
  const next = patchCrm(readJson(files.crm, null), { key: body?.key, set: body?.set, settings: body?.settings });
  writeJsonAtomic(files.crm, next);
  return Response.json({ ok: true, entry: body?.key ? next.people[body.key] || null : null, settings: next.settings });
}

export async function DELETE() {
  const files = socialFiles();
  if (files) rmSync(files.crm, { force: true });
  return Response.json({ ok: true });
}
