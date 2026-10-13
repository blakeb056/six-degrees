import { getDb, dataDir } from '../../../../lib/db-client';
import { pendingImport } from '../../../../lib/data-import';
import { scannerJob } from '../../../../lib/scan-state';
import { resolveProfile, networkCounts } from '../../../../lib/profile';
import { CsvStoreError } from '../../../../lib/csv-store';
import { NetworkFileError } from '../../../../lib/network-file';
import { planNetworkImport, networkImportPreflight } from '../../../../lib/network-import';
import { stageCsvNetwork } from '../../../../lib/csv-network-file';
import { dropStage } from '../../../../lib/network-stage';

// A Connections.csv import, step one of two: what importing it would do.
//
// The page reads the CSV and sends the six fields lib/csv.js packConnections
// makes, as it always has ({connections}); nothing here sees the file itself.
// They're written as a network file into a private working folder in the data
// folder (lib/csv-network-file.js stageCsvNetwork, lib/network-stage.js), and
// the importer says what it would do with it, changing nothing
// (lib/network-import.js planNetworkImport). Import is step two:
// POST /api/data/network/apply with the `stage` this answers.
//
// Answers { ok, stage, received, counts: { add, update, promote, unchanged },
// leftOut: { no_profile_link }, repeated, network }: how many people arrived,
// what would happen to each one with a profile link, how many had none, how
// many were the same person twice, and how many connections are here now.
//
// 409 while a scan runs or an import or a restore waits for the next start,
// with the reason in words: nothing is staged then. Gated (lib/gate.js) with
// Settings → Your data: it adds a network to yours.

export async function POST(request) {
  const dir = dataDir();
  const refusal = networkImportPreflight({ scanRunning: scannerJob(), pending: pendingImport(dir) });
  if (refusal) return Response.json({ error: refusal.message }, { status: refusal.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The file didn't arrive whole, so nothing was read. Try again." }, { status: 400 });
  }

  let staged;
  try {
    staged = stageCsvNetwork(dir, body?.connections);
  } catch (err) {
    if (err instanceof CsvStoreError) {
      return Response.json({ error: `This file can't be imported (${err.message}), so nothing was read.` }, { status: 400 });
    }
    if (err instanceof NetworkFileError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: `The file couldn't be read on this computer (${err.message}).` }, { status: 500 });
  }

  try {
    getDb();
    // The profile that is "you" (lib/profile.js): the one a scan would save into.
    const me = resolveProfile();
    const plan = planNetworkImport(getDb(), staged.model, { userId: me.id });
    return Response.json({
      ok: true,
      stage: staged.id,
      received: staged.received,
      counts: plan.counts,
      leftOut: plan.leftOut,
      repeated: staged.repeated,
      network: networkCounts(me.id).first,
    });
  } catch (err) {
    dropStage(dir, staged.id);
    const status = err instanceof NetworkFileError ? err.status : 500;
    return Response.json({ error: `What the import would do couldn't be worked out (${err.message}).` }, { status });
  }
}

/** Forget a preview nobody imported: Choose another file. */
export async function DELETE(request) {
  let body = null;
  try { body = await request.json(); } catch { /* nothing named */ }
  return Response.json({ ok: true, removed: dropStage(dataDir(), body?.stage) });
}
