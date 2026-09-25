import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb, dataDir, applySchema } from '../../../../lib/db-client';
import { SCHEMA_SQL } from '../../../../db/schema';
import { APP_VERSION } from '../../../../lib/app-version';
import { countPeople } from '../../../../lib/data-export';
import { UPLOAD_WORK_PREFIX, sweepLeftovers } from '../../../../lib/data-folder';
import {
  ImportError, importPreflight, receiveUpload, stageImport, pendingImport, cancelPendingImport,
} from '../../../../lib/data-import';
import { scanIsRunning } from '../../../../lib/scan-state';

// Bring in a network from another computer. The body is the .sixdegrees file
// itself; X-Six-Degrees-Size says how big it is (a body the proxy cut short
// must never pass for a whole one), and X-Six-Degrees-Replace is the number of
// people the user agreed to replace.
//
// This only checks the file and stages it (lib/data-import.js). The network is
// replaced the next time the app starts, after a copy of it is kept. Gated
// (lib/gate.js): it replaces everything.

function refuse(err) {
  return Response.json({ error: err.message, ...err.extra }, { status: err.status });
}

export async function POST(request) {
  const dir = dataDir();
  const current = countPeople(getDb());
  const declared = Number(request.headers.get('x-six-degrees-size'));
  const refusal = importPreflight({
    scanRunning: scanIsRunning(),
    pending: pendingImport(dir),
    declared,
    currentPeople: current,
    confirmedPeople: Number(request.headers.get('x-six-degrees-replace')),
  });
  if (refusal) return refuse(refusal);

  sweepLeftovers(dir);
  const work = mkdtempSync(path.join(dir, UPLOAD_WORK_PREFIX));
  try {
    const upload = path.join(work, 'upload.sixdegrees');
    await receiveUpload(request.body, upload, { declared });
    // Asked again: a scan or a second import could have started during the upload.
    if (scanIsRunning()) {
      throw new ImportError('A scan started while the file was arriving. Let it finish, then import again.', { status: 409 });
    }
    if (pendingImport(dir)) {
      throw new ImportError('Another import is already waiting to finish.', { status: 409 });
    }
    const pending = stageImport(upload, {
      dir, applySchema, schemaSql: SCHEMA_SQL, appVersion: APP_VERSION, replacedPeople: current,
    });
    return Response.json({ ok: true, pending });
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    if (err instanceof ImportError) return refuse(err);
    return Response.json({ error: `The file couldn't be checked: ${err.message}` }, { status: 500 });
  }
}

/** Throw away an import that is waiting, before it starts. */
export async function DELETE() {
  const result = cancelPendingImport(dataDir());
  if (result.reason === 'started') {
    return Response.json(
      { error: 'This import has already started, so it can only go forward. Restart Six Degrees to finish it.' },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, cancelled: result.cancelled });
}
