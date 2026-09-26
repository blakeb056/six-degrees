import path from 'node:path';
import { homedir } from 'node:os';
import { getDb, dataDir, dbFile, AUTO_BACKUP_PREFIX } from '../../../lib/db-client';
import { folderReport } from '../../../lib/data-folder';
import { countPeople, referencedPhotos } from '../../../lib/data-export';
import {
  pendingImport, lastImport, restartCodeFrom, restartAdvice, MAX_IMPORT_BYTES,
} from '../../../lib/data-import';
import { projectRoot, isGitCheckout } from '../../../lib/paths';
import { installKind } from '../../../lib/release';

// Settings → Your data: where the network is kept, what it takes up, and any
// import waiting to finish. Sizes come from the file system; nothing in the
// folder is read, and chrome-profile/ is only reported as there or not. A read
// that changes nothing, so it stays open like every other read. The actions
// live under /api/data/… and are gated (lib/gate.js).

export async function GET() {
  try {
    const db = getDb();
    const dir = path.resolve(dataDir());
    // A git checkout is its own kind here, as on the rest of the Settings page.
    const kind = isGitCheckout() ? 'git' : installKind(process.env, projectRoot());
    const custom = dir !== path.join(homedir(), '.six-degrees');
    return Response.json({
      ...folderReport({ dir, dbFile: path.resolve(dbFile()), autoPrefix: AUTO_BACKUP_PREFIX, inNetwork: referencedPhotos(db) }),
      people: countPeople(db),
      platform: process.platform,
      kind,
      customDataDir: custom,
      pending: pendingImport(dir),
      lastImport: lastImport(db),
      restart: restartAdvice({ kind, code: restartCodeFrom(process.env), dataDir: custom ? dir : null }),
      maxImportBytes: MAX_IMPORT_BYTES,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
