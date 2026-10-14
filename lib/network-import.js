// Bringing a checked network file (lib/network-file.js) into your own network.
//
// Imports always merge: they add people and bring them up to date, and never
// remove anyone. Blake, 2026-10-12: someone starts by importing their
// Connections file at onboarding, "and then they can from there rescan and
// etc build from that start once they install the proper plugins". Starting
// over is a restore or a fresh start, never an import. (Format 1.0 leaves one
// door for slice 5: a circle read again from its first page may drop that
// circle's members it no longer shows. Nothing here removes anyone.)
//
// This copy imports your connections (1st degree) and the facts about them
// only. A file with more (circles, ties, company scans, photos, experience,
// mutual counts) is refused as a whole and says which parts, rather than
// importing part of it and implying the rest arrived (TRAPS §7).
//
// The rules, each learned elsewhere first:
//   - Only your own rows (resolveProfile().id): never another profile's,
//     never a row with no user_id (TRAPS §9, §25).
//   - People are matched by personMatchKey, never by the link's text: every
//     stored link ends in "/", and an export's don't.
//   - Someone at 2nd or 3rd degree who is now a connection is promoted
//     through lib/promote.js, which keeps who introduced them (TRAPS §19, §36).
//   - Ids never change, and nothing writes scores, unlock_*, outreach_status,
//     company_scores, settings or the queue.
//   - Back up, then one transaction, then rescore. The transaction drops
//     app_meta 'scoring_version', so if the rescore after it fails, the next
//     read of the network rescores (lib/rpc.js rescoreIfStale).
//
// One transaction with awaits inside it is safe only because nothing awaited
// in it ever waits on the outside world: lib/db.js runs each query the moment
// it is awaited, so every await resolves as a microtask, and no other request
// (a macrotask) can run between BEGIN and COMMIT. tests/network-import.test.mjs
// holds that: a setImmediate queued before an import runs only after COMMIT.
// Never call db.rpc() (a dynamic import) or anything that reads a file or the
// network in there.

import { db as queries } from './db.js';
import { getDb, newId, applySchema } from './db-client.js';
import { SCHEMA_SQL } from '../db/schema.js';
import { APP_VERSION } from './app-version.js';
import { promoteToFirstDegree } from './promote.js';
import { rescoreAll } from './rpc.js';
import { parseHeadline } from './ingest.js';
import { makeBackup } from './backups.js';
import { countPeople } from './data-export.js';
import { pendingImport } from './data-import.js';
import { scannerJob, runningNow } from './scan-state.js';
import { personMatchKey, NetworkFileError } from './network-file.js';

// The lengths /api/ingest keeps (app/api/ingest/route.js), so a person saved
// by a scan or by a file reads the same.
const HEADLINE_MAX = 200;
const ROLE_MAX = 100;
const COMPANY_MAX = 100;

/** The fields an import may write on a connection's row. Nothing else, ever. */
export const IMPORTED_FIELDS = Object.freeze(['name', 'headline', 'role', 'company', 'connected_date']);

const clip = (v, max) => (typeof v === 'string' ? v.trim().substring(0, max) : '');

/**
 * "Role at Company", the headline a Connections export implies (it has no
 * headline of its own), as lib/csv.js has always built it. Empty when it
 * names neither.
 */
export function builtHeadline(role, company) {
  const r = clip(role, ROLE_MAX);
  const c = clip(company, COMPANY_MAX);
  return r && c ? `${r} at ${c}` : r || c || '';
}

/**
 * A row only an export ever described: no headline, or exactly the "Role at
 * Company" an export builds from both. An export may bring such a row up to
 * date (a new job), because no scan's reading would be lost.
 *
 * A headline that is a role alone ("Mathematician") isn't enough to say so:
 * a scan reads that headline as all role, so it would equal the built one,
 * and a scanned headline would be overwritten by the export's position. Such
 * a row is filled where blank only.
 */
export function exportOwned(row) {
  const headline = (row?.headline || '').trim();
  if (!headline) return true;
  const role = clip(row?.role, ROLE_MAX);
  const company = clip(row?.company, COMPANY_MAX);
  return Boolean(role && company) && headline === builtHeadline(role, company);
}

/** What the file says about one connection, in the stored row's terms. */
function incoming(person, connection) {
  const headline = clip(person.headline, HEADLINE_MAX);
  const parsed = parseHeadline(headline);
  const role = clip(person.role || parsed.role, ROLE_MAX);
  const company = clip(person.company || parsed.company, COMPANY_MAX);
  return {
    name: clip(person.name, 1000),
    headline: headline || builtHeadline(role, company),
    role,
    company,
    connected_date: connection.connected_date || '',
  };
}

/**
 * The fields of `row` an import changes, with their new values. A scan or a
 * hand edit overwrites; an export fills blanks only, unless the row is
 * export-owned. A file never blanks a field.
 */
export function changesFor(row, fields, source) {
  const overwrite = source !== 'export' || exportOwned(row);
  const out = {};
  for (const f of IMPORTED_FIELDS) {
    const next = fields[f];
    if (!next) continue;
    const now = row[f] == null ? '' : String(row[f]);
    if (now === next) continue;
    if (overwrite || !now.trim()) out[f] = next;
  }
  return out;
}

/** The parts of a file this copy can't import yet, in words, or []. */
export function notYetImportable(model) {
  const out = [];
  if (model.edges?.length) out.push('2nd-degree connections');
  if (model.circles?.length) out.push('circles');
  if (model.ties?.length) out.push('ties');
  if (model.companyScans?.length) out.push('company scans');
  if (model.photos?.length || model.people?.some((p) => p.photo)) out.push('photos');
  if (model.people?.some((p) => p.experience)) out.push('experience');
  if (model.people?.some((p) => p.mutual_count != null)) out.push('mutual counts');
  return out;
}

const listInWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * May an import start at all? Not while the scanner's route runs something
 * (lib/scan-state.js), not while a whole-network import or restore waits for
 * the next start (lib/data-import.js pendingImport: it would replace what
 * this one writes), and not with parts this copy can't import yet.
 * @returns a NetworkFileError to refuse with, or null to go ahead.
 */
export function networkImportPreflight({ scanRunning = null, pending = null, notYet = [] } = {}) {
  if (scanRunning) {
    return new NetworkFileError(`${runningNow(scanRunning)}. Let it finish, or stop it on the Scan page, then import.`, { status: 409 });
  }
  if (pending) {
    return new NetworkFileError('An import or a restore is already waiting to finish. Restart Sixgree to finish it, or cancel it first.', { status: 409 });
  }
  if (notYet.length) {
    return new NetworkFileError(
      `This copy of Sixgree can't import ${listInWords(notYet)} yet. Nothing was imported. Update Sixgree, or import a file with your connections only.`,
      { status: 422, notYet },
    );
  }
  return null;
}

/** Every row of yours, by match key. A stored link that isn't one can match nothing, so it's left out. */
function yourRowsByKey(db, userId) {
  const rows = db.prepare(`SELECT id, degree, name, headline, role, company, profile_url, connected_date, source_connection_id, unlocked_from_bridge_id
    FROM linkedin_connections WHERE user_id = ?`).all(userId);
  const byKey = new Map();
  for (const r of rows) {
    const k = personMatchKey(r.profile_url);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return byKey;
}

/** The row lib/promote.js keeps when it promotes someone: the one carrying an origin, then one in a circle, else the deepest. */
function promotedRow(rows) {
  return rows.find((r) => r.unlocked_from_bridge_id) || rows.find((r) => r.source_connection_id)
    || rows.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];
}

/** What would happen to each connection in the file, with what the apply step needs. */
function diff(db, model, userId) {
  const mine = yourRowsByKey(db, userId);
  const people = new Map(model.people.map((p) => [personMatchKey(p.key), p]));
  return model.connections.map((c) => {
    const key = personMatchKey(c.person);
    const person = people.get(key);
    const fields = incoming(person, c);
    const rows = mine.get(key) || [];
    const direct = rows.filter((r) => r.degree === 1);
    const deeper = rows.filter((r) => r.degree !== 1);
    const entry = { key: c.person, name: person.name, source: c.source, incoming: fields, direct, deeper };
    if (direct.length) {
      const changed = new Set(direct.flatMap((r) => Object.keys(changesFor(r, fields, c.source))));
      // A connection with a stale 2nd- or 3rd-degree copy has it folded in, as a scan does (lib/promote.js).
      return { ...entry, action: changed.size || deeper.length ? 'update' : 'unchanged', fields: [...changed], fold: deeper.length };
    }
    if (deeper.length) {
      return { ...entry, action: 'promote', fields: Object.keys(changesFor(promotedRow(deeper), fields, c.source)), fold: deeper.length - 1 };
    }
    return { ...entry, action: 'add', fields: IMPORTED_FIELDS.filter((f) => fields[f]), fold: 0 };
  });
}

function ownerCheck(db, model, userId) {
  const fileKey = model.manifest?.owner?.key ? personMatchKey(model.manifest.owner.key) : null;
  const link = db.prepare('SELECT linkedin_url FROM users WHERE id = ?').get(userId)?.linkedin_url;
  const yours = link ? personMatchKey(link) : null;
  return { file: fileKey, yours, same: fileKey && yours ? fileKey === yours : null };
}

/**
 * What importing `model` (readNetworkFolder's answer) would do to the network
 * of profile `userId`, without changing anything: per connection, add,
 * update, promote or unchanged, and the fields that would change.
 * @returns {{ userId, counts, people, folded, notYet, leftOut, ignored, newerFormat, owner }}
 */
export function planNetworkImport(db, model, { userId } = {}) {
  if (typeof userId !== 'string' || !userId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
    throw new NetworkFileError('There is no profile to import into.', { status: 500 });
  }
  const entries = diff(db, model, userId);
  const counts = { add: 0, update: 0, promote: 0, unchanged: 0 };
  for (const e of entries) counts[e.action] += 1;
  return {
    userId,
    counts,
    people: entries.map(({ key, name, action, fields }) => ({ key, name, action, fields })),
    folded: entries.reduce((n, e) => n + e.fold, 0),
    notYet: notYetImportable(model),
    leftOut: { no_profile_link: model.manifest?.left_out?.no_profile_link || 0 },
    ignored: model.ignored || null,
    newerFormat: Boolean(model.version?.newerMinor),
    owner: ownerCheck(db, model, userId),
  };
}

/** Update every one of your 1st-degree rows with this key that the file changes. @returns how many changed. */
function updateDirect(db, userId, urls, fields, source) {
  let changed = 0;
  for (const url of urls) {
    const rows = db.prepare(`SELECT id, name, headline, role, company, connected_date FROM linkedin_connections
      WHERE user_id = ? AND degree = 1 AND profile_url = ?`).all(userId, url);
    for (const row of rows) {
      const set = changesFor(row, fields, source);
      const cols = Object.keys(set);
      if (!cols.length) continue;
      db.prepare(`UPDATE linkedin_connections SET ${cols.map((c) => `"${c}" = ?`).join(', ')}, updated_at = ?
        WHERE id = ? AND user_id = ?`).run(...cols.map((c) => set[c]), new Date().toISOString(), row.id, userId);
      changed += 1;
    }
  }
  return changed;
}

async function applyEntry(db, e, userId, insert) {
  if (e.action === 'unchanged') return;
  if (e.action === 'add') {
    const f = e.incoming;
    insert.run(newId(), f.name, f.headline, f.role, f.company, e.key, f.connected_date || null, userId);
    return;
  }
  if (e.action === 'promote') {
    const url = promotedRow(e.deeper).profile_url;
    const res = await promoteToFirstDegree(queries, { profileUrl: url, userId });
    if (!res.promoted) throw new Error(`a promotion didn't happen (${res.reason})`);
    updateDirect(db, userId, [url], e.incoming, e.source);
    return;
  }
  // update: fold stale copies first, as a scan does, then bring the row up to date.
  const urls = [...new Set(e.direct.map((r) => r.profile_url))];
  if (e.deeper.length) await promoteToFirstDegree(queries, { profileUrl: urls[0], userId });
  updateDirect(db, userId, urls, e.incoming, e.source);
}

/**
 * Import `model` (readNetworkFolder's answer) into the network of profile
 * `userId`: merge only, nothing removed. `db` must be the app's own database
 * handle (getDb()), the one lib/promote.js writes through.
 *
 * In order: the preflight; nothing at all when nothing would change; a
 * before-import backup of the whole network through lib/backups.js (no
 * backup, no import); one transaction; then a rescore.
 *
 * `dataDir`, `backupsDir`, `appVersion`, `schemaSql` and `applySchema` are
 * lib/db-client.js backupOptions()'s. `scanRunning` and `pending` default to
 * what this server knows (scannerJob(), pendingImport(dataDir)).
 * `alwaysBackUp` backs up an empty network too: the quiet move of a kept CSV
 * (lib/csv-network-file.js moveKeptCsv) wants the copy for the kept file in it.
 *
 * @returns {{ ok: true, counts, folded, backup, rescored, leftOut, ignored, newerFormat }}
 * @throws NetworkFileError, fit to show; nothing was changed.
 */
export async function applyNetworkImport(db, model, {
  userId, dataDir, backupsDir, appVersion = APP_VERSION, schemaSql = SCHEMA_SQL, applySchema: schemaStep = applySchema,
  scanRunning = scannerJob(), pending, now = new Date(), alwaysBackUp = false,
} = {}) {
  if (db !== getDb()) throw new Error('An import writes through the app\'s own database handle (getDb()).');
  const refusal = networkImportPreflight({
    scanRunning,
    pending: pending === undefined ? (dataDir ? pendingImport(dataDir) : null) : pending,
    notYet: notYetImportable(model),
  });
  if (refusal) throw refusal;

  const preview = planNetworkImport(db, model, { userId });
  if (preview.owner.same === false) {
    throw new NetworkFileError('This network file belongs to someone else: its owner isn\'t the profile this copy of Sixgree is for. Nothing was imported.', { status: 409 });
  }
  const summary = {
    ok: true, leftOut: preview.leftOut, ignored: preview.ignored, newerFormat: preview.newerFormat,
  };
  if (preview.counts.add + preview.counts.update + preview.counts.promote === 0) {
    return { ...summary, counts: preview.counts, folded: 0, backup: null, rescored: null };
  }

  // The way back, made before anything changes. An empty network has nothing to lose.
  let backup = null;
  if (alwaysBackUp || countPeople(db) > 0) {
    if (!dataDir || !backupsDir) throw new Error('An import needs the data and backups folders to back up first.');
    try {
      const made = makeBackup('before-import', {
        db, dataDir, backupsDir, appVersion, schemaSql, applySchema: schemaStep, now,
      });
      backup = { name: made.name, file: made.file, people: made.people };
    } catch (err) {
      throw new NetworkFileError(`Nothing was imported: the backup before it couldn't be made (${err.message}).`, { status: 500 });
    }
  }

  let entries;
  const counts = { add: 0, update: 0, promote: 0, unchanged: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    // Scores are stale from here until the rescore below; if that fails, the next read redoes it.
    db.prepare("DELETE FROM app_meta WHERE key = 'scoring_version'").run();
    // Worked out again inside the transaction, so it's what is there now.
    entries = diff(db, model, userId);
    const insert = db.prepare(`INSERT INTO linkedin_connections (id, degree, name, headline, role, company, profile_url, connected_date, user_id)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of entries) {
      await applyEntry(db, e, userId, insert);
      counts[e.action] += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw new NetworkFileError(`Nothing was imported: ${err.message}`, { status: 500, backup });
  }

  // Everyone, as after a scan (lib/rpc.js): your company scores, sector focus and tier scale apply.
  let rescored;
  try {
    rescored = { ok: true, ...rescoreAll() };
  } catch (err) {
    rescored = { ok: false, error: err.message };
  }
  return { ...summary, counts, folded: entries.reduce((n, e) => n + e.fold, 0), backup, rescored };
}
