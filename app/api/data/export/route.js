import { mkdtempSync, openSync, rmSync, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { getDb, dataDir } from '../../../../lib/db-client';
import { buildExport, exportFileName } from '../../../../lib/data-export';
import { EXPORT_WORK_PREFIX, sweepLeftovers } from '../../../../lib/data-folder';
import { SCHEMA_SQL } from '../../../../db/schema';
import { APP_VERSION } from '../../../../lib/app-version';

// Save a copy of the network to carry to another computer: one .sixdegrees
// file (lib/data-export.js), sent back as a download. A POST, so it takes a
// click on the app's own page (the cross-site guard applies), and gated with
// the other routes that hand over or replace everything (lib/gate.js).
//
// It is built in a private folder inside the data folder, never anywhere else,
// and that folder is gone before the first byte is sent: the open file keeps
// the bytes readable, so an interrupted download leaves no copy behind.

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* no options: the defaults */ }
  const includePhotos = body?.photos !== false;

  const dir = dataDir();
  sweepLeftovers(dir);
  const work = mkdtempSync(path.join(dir, EXPORT_WORK_PREFIX));
  try {
    const file = path.join(work, 'export.sixdegrees');
    const made = buildExport(getDb(), {
      dir, outFile: file, includePhotos, appVersion: APP_VERSION, schemaSql: SCHEMA_SQL,
    });
    const fd = openSync(file, 'r');
    rmSync(work, { recursive: true, force: true });
    const stream = createReadStream(file, { fd });
    return new Response(Readable.toWeb(stream), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${exportFileName()}"`,
        'Content-Length': String(made.bytes),
        'Cache-Control': 'no-store',
        'X-Six-Degrees-People': String(made.people),
        'X-Six-Degrees-Photos': String(made.photos),
      },
    });
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    return Response.json({ error: `The copy couldn't be made: ${err.message}` }, { status: 500 });
  }
}
