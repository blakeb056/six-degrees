import path from 'node:path';
import { dataDir, backupsFolder } from '../../../../lib/db-client';
import { revealFolder } from '../../../../lib/data-folder';
import { findBackup } from '../../../../lib/backups';

// Show the data folder in Finder (or the Linux file browser), or one backup in
// it, selected: {backup: name}, a name from backups/' own listing, never a
// path (lib/backups.js findBackup). Nothing else is taken from the request.
// Gated (lib/gate.js) like every route that starts a process.

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* no body: the data folder */ }
  if (body?.backup !== undefined) {
    const folder = path.resolve(backupsFolder());
    const found = findBackup(folder, body.backup, { restorable: false });
    if (!found) return Response.json({ error: 'There is no backup by that name in the backups folder.' }, { status: 404 });
    const file = path.join(folder, found.name);
    const result = await revealFolder(folder, { select: file });
    if (result.ok) return Response.json({ ok: true });
    return Response.json({ error: `${result.message} The backup is ${file}`, path: file }, { status: 500 });
  }
  const dir = path.resolve(dataDir());
  const result = await revealFolder(dir);
  if (result.ok) return Response.json({ ok: true });
  return Response.json({ error: `${result.message} The folder is ${dir}`, path: dir }, { status: 500 });
}
