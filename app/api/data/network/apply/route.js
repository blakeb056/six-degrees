import { getDb, backupOptions } from '../../../../../lib/db-client';
import { resolveProfile, networkCounts } from '../../../../../lib/profile';
import { NetworkFileError } from '../../../../../lib/network-file';
import { applyNetworkImport } from '../../../../../lib/network-import';
import { stagedNetwork, dropStage } from '../../../../../lib/network-stage';

// A Connections.csv import, step two of two: Import, after the preview
// (POST /api/data/network). Body { stage }, the name that answer gave, never a
// path. The staged file is read and checked again, then imported through
// lib/network-import.js: merge only, nothing removed; a before-import backup
// first whenever there's a network to lose; one transaction; then a rescore
// with your own company scores and settings.
//
// Answers { ok, counts, folded, backup, rescored, leftOut, network, tiers }:
// what happened to each person, the backup made first (or null), how many
// connections you have now, and your 1st-degree tiers before and after.
//
// 409 while a scan runs or an import or a restore waits; 410 when the preview
// has gone (it's kept an hour). Nothing is imported then, and the preview
// stays for another try. Gated (lib/gate.js): it adds a network to yours.

/** Your 1st-degree people by tier: { S, A, B, C, D }. */
function tierCounts(db, userId) {
  const out = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const r of db.prepare('SELECT tier, COUNT(*) AS n FROM linkedin_connections WHERE user_id = ? AND degree = 1 GROUP BY tier').all(userId)) {
    if (r.tier in out) out[r.tier] = r.n;
  }
  return out;
}

export async function POST(request) {
  let body = null;
  try { body = await request.json(); } catch { /* said below: no stage named */ }
  const opts = backupOptions(getDb());
  let model;
  try {
    model = stagedNetwork(opts.dataDir, body?.stage);
  } catch (err) {
    const status = err instanceof NetworkFileError ? err.status : 500;
    return Response.json({ error: err.message }, { status });
  }

  const db = getDb();
  const me = resolveProfile();
  const before = tierCounts(db, me.id);
  let done;
  try {
    done = await applyNetworkImport(db, model, {
      userId: me.id, dataDir: opts.dataDir, backupsDir: opts.backupsDir, appVersion: opts.appVersion,
      schemaSql: opts.schemaSql, applySchema: opts.applySchema,
    });
  } catch (err) {
    if (err instanceof NetworkFileError) return Response.json({ error: err.message, backup: err.extra?.backup?.name ?? null }, { status: err.status });
    return Response.json({ error: `Nothing was imported: ${err.message}` }, { status: 500 });
  }
  dropStage(opts.dataDir, body.stage);
  return Response.json({
    ok: true,
    counts: done.counts,
    folded: done.folded,
    backup: done.backup ? { name: done.backup.name, people: done.backup.people } : null,
    rescored: done.rescored ? { ok: done.rescored.ok } : null,
    leftOut: done.leftOut,
    network: networkCounts(me.id).first,
    tiers: { before, after: tierCounts(db, me.id) },
  });
}
