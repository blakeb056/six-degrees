import path from 'node:path';
import { dataDir } from '../../../../lib/db-client';
import { revealFolder } from '../../../../lib/data-folder';

// Show the data folder in Finder (or the Linux file browser). It opens the data
// folder itself and takes nothing from the request. Gated (lib/gate.js) like
// every route that starts a process.

export async function POST() {
  const dir = path.resolve(dataDir());
  const result = await revealFolder(dir);
  if (result.ok) return Response.json({ ok: true });
  return Response.json({ error: `${result.message} The folder is ${dir}` }, { status: 500 });
}
