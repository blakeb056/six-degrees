import { dataDir } from '../../../../lib/db-client';
import { pendingImport } from '../../../../lib/data-import';
import { resolveProfile, networkCounts } from '../../../../lib/profile';
import {
  readCsvNetwork, writeCsvNetwork, removeCsvNetwork, CsvStoreError, CSV_NETWORK_FILE,
} from '../../../../lib/csv-store';

// A LinkedIn Connections.csv import, kept in the data folder so it is still
// there after the window closes (lib/csv-store.js). The page reads the CSV and
// sends only what the map needs (lib/csv.js packConnections); nothing here
// sees the file itself.
//
// Gated with the other routes under /api/data (lib/gate.js): POST replaces the
// kept import, DELETE removes it, and GET hands it over, so all three answer
// only on this computer, as the server's bind address proves, never a header
// (TRAPS §2). POST and DELETE are writes, so middleware.js also refuses them
// from another site.

export async function GET() {
  const { csv, problem } = readCsvNetwork(dataDir());
  // Your scanned 1st-degree connections, under the profile the map shows
  // (lib/profile.js): once there are any, pages show them instead of a kept
  // CSV (lib/csv.js openNetworkSource).
  let scanned;
  try {
    const me = resolveProfile({ create: false });
    scanned = me ? networkCounts(me.id).first : 0;
  } catch (err) {
    return Response.json({ error: `Your network couldn't be read (${err.message}).` }, { status: 500 });
  }
  return Response.json({
    csv,
    scanned,
    // Said, never shown as no import at all (TRAPS §7): the welcome screen
    // puts this on the CSV card.
    problem: problem ? `Your kept CSV import couldn't be read: ${problem}. Import Connections.csv again to replace it.` : null,
  });
}

export async function POST(request) {
  const dir = dataDir();
  // An import from another computer waiting for the next start replaces the
  // network's files, this one included: a CSV kept now would be set aside
  // with what it replaces.
  if (pendingImport(dir)) {
    return Response.json({
      error: 'A copy of a network is waiting to finish importing. Restart Six Degrees to finish it first (Settings → Your data says how), then import the CSV.',
    }, { status: 409 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The import didn't arrive whole, so nothing was kept. Try again." }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...writeCsvNetwork(dir, body?.connections) });
  } catch (err) {
    if (err instanceof CsvStoreError) {
      return Response.json({ error: `This import can't be kept (${err.message}), so nothing was saved.` }, { status: 400 });
    }
    return Response.json({ error: `The import couldn't be saved on this computer (${err.message}).` }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    return Response.json({ ok: true, removed: removeCsvNetwork(dataDir()) });
  } catch (err) {
    return Response.json({
      error: `The import couldn't be removed (${err.message}). It is ${CSV_NETWORK_FILE} in your data folder.`,
    }, { status: 500 });
  }
}
