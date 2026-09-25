import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getDb, dataDir, applySchema } from '../../../../lib/db-client';
import { SCHEMA_SQL } from '../../../../db/schema';
import { APP_VERSION } from '../../../../lib/app-version';
import { countPeople } from '../../../../lib/data-export';
import { UPLOAD_WORK_PREFIX, sweepLeftovers } from '../../../../lib/data-folder';
import { requestRefusal } from '../../../../lib/gate';
import {
  ImportError, IMPORT_ROUTE, admitImport, receiveUpload, stageImport, pendingImport, cancelPendingImport,
} from '../../../../lib/data-import';
import { scanIsRunning } from '../../../../lib/scan-state';

// Bring in a network from another computer. The body is the .sixdegrees file
// itself; X-Six-Degrees-Size says how big it is (a body cut short must never
// pass for a whole one), and X-Six-Degrees-Replace is the number of people the
// user agreed to replace.
//
// middleware.js leaves this route alone: Next would copy the whole upload into
// memory before middleware could refuse it. So every handler here makes the
// middleware's checks itself, first (lib/gate.js requestRefusal, the same
// function), and the upload is written to disk as it arrives (receiveUpload).
//
// This only checks the file and stages it (lib/data-import.js). The network is
// replaced the next time the app starts, after a copy of it is kept. Gated
// (lib/gate.js): it replaces everything.

function refuse(err) {
  return Response.json({ error: err.message, ...err.extra }, { status: err.status });
}

export async function POST(request) {
  const admitted = admitImport(request, {
    env: process.env,
    scanRunning: scanIsRunning,
    pending: () => pendingImport(dataDir()),
    currentPeople: () => countPeople(getDb()),
  });
  if (admitted.refused) {
    const { status, ...body } = admitted.refused;
    return Response.json(body, { status });
  }
  const { declared, currentPeople } = admitted;

  const dir = dataDir();
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
      dir, applySchema, schemaSql: SCHEMA_SQL, appVersion: APP_VERSION, replacedPeople: currentPeople,
    });
    return Response.json({ ok: true, pending });
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    if (err instanceof ImportError) return refuse(err);
    return Response.json({ error: `The file couldn't be checked: ${err.message}` }, { status: 500 });
  }
}

/** Throw away an import that is waiting, before it starts. */
export async function DELETE(request) {
  const refused = requestRefusal({ method: request.method, pathname: IMPORT_ROUTE, headers: request.headers, env: process.env });
  if (refused) return Response.json({ error: refused.error }, { status: refused.status });

  const result = cancelPendingImport(dataDir());
  if (result.reason === 'started') {
    return Response.json(
      { error: 'This import has already started, so it can only go forward. Restart Six Degrees to finish it.' },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, cancelled: result.cancelled });
}
