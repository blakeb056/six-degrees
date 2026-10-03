import path from 'node:path';
import { getDb, dataDir, applySchema, backupsFolder } from '../../../../lib/db-client';
import { SCHEMA_SQL } from '../../../../db/schema';
import { APP_VERSION } from '../../../../lib/app-version';
import { countPeople } from '../../../../lib/data-export';
import { ImportError, pendingImport } from '../../../../lib/data-import';
import { findBackup, restoreBackup, restorePreflight } from '../../../../lib/backups';
import { scannerJob } from '../../../../lib/scan-state';

// Settings → Your data → Restore, on one backup: put that backup's network
// back. The same as importing it (lib/backups.js restoreBackup, through
// stageImport): checked first, applied at the next start (Restart now), and
// what is here kept in backups/ before anything is replaced.
//
// The body names a backup, {name, replace}: a name from backups/' own listing
// (lib/data-folder.js listBackups), never a path. Anything else is refused.
// `replace` is the number of people the person agreed to replace. Gated
// (lib/gate.js): it replaces the network.

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* refused below */ }
  const name = typeof body?.name === 'string' ? body.name : '';

  // The name first: one the folder doesn't hold is refused before anything else is asked.
  if (!findBackup(backupsFolder(), name)) {
    return Response.json({ error: 'There is no backup by that name in the backups folder.' }, { status: 404 });
  }
  const dir = path.resolve(dataDir());
  const currentPeople = countPeople(getDb());
  const refusal = restorePreflight({
    scanRunning: scannerJob(),
    pending: pendingImport(dir),
    currentPeople,
    confirmedPeople: Number(body?.replace),
  });
  if (refusal) return Response.json({ error: refusal.message, ...refusal.extra }, { status: refusal.status });

  try {
    const pending = restoreBackup(name, {
      dir, backupsDir: backupsFolder(), applySchema, schemaSql: SCHEMA_SQL, appVersion: APP_VERSION, replacedPeople: currentPeople,
    });
    return Response.json({ ok: true, pending });
  } catch (err) {
    if (err instanceof ImportError) return Response.json({ error: err.message, ...err.extra }, { status: err.status });
    return Response.json({ error: `The backup couldn’t be restored: ${err.message}` }, { status: 500 });
  }
}
