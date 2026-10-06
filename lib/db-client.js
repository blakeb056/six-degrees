import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SCHEMA_SQL } from '../db/schema.js';
import { APP_VERSION } from './app-version.js';
import { applyPendingImport, recordImport } from './data-import.js';
import { compareVersions } from './release.js';
import { durable } from './durable.js';
import {
  makeBackup, rotateBackups, dailyBackupIfDue, noteBackupFailure, AUTO_BACKUP_PREFIX,
} from './backups.js';

// The database lives OUTSIDE the app directory so an installed copy never
// writes into its own package. Override with SIX_DEGREES_HOME.
export function dataDir() {
  const dir = process.env.SIX_DEGREES_HOME || path.join(homedir(), '.six-degrees');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Columns that are stored as JSON text and handed back to callers as objects
// or arrays, matching what the Postgres jsonb/text[] columns used to return.
export const JSON_COLUMNS = {
  users: ['sectors', 'goals', 'company_prestige_config'],
  user_profile: ['sectors', 'goals', 'company_prestige_config'],
  linkedin_connections: ['influence_signals'],
  notifications: ['data'],
  queue_items: [],
  user_stats: [],
};

// Columns SQLite stores as 0/1 but callers expect as true/false.
export const BOOLEAN_COLUMNS = {
  linkedin_connections: ['is_catalyst'],
  notifications: ['seen'],
  users: [],
  user_profile: [],
  queue_items: [],
  user_stats: [],
};

let _db = null;

// Set once this server process has opened the database, by any copy of this
// module. The bundler can give a route its own copy, with its own _db, and a
// copy that opens late must not finish an import staged while another copy's
// handle was already open: the swap would happen under that handle. There is
// one globalThis per process, like lib/scan-state.js.
const OPENED = Symbol.for('six-degrees.db-opened');

/** The database file: SIX_DEGREES_DB, or six-degrees.sqlite in the data folder. */
export function dbFile() {
  return process.env.SIX_DEGREES_DB || path.join(dataDir(), 'six-degrees.sqlite');
}

export function getDb() {
  if (_db) return _db;

  const file = dbFile();

  // A network imported from another computer (Settings → Your data) is swapped
  // in here, at the start, before anything opens the database: it can't be
  // swapped under a handle that is already open, this process's or another's
  // (it waits while another copy of Sixgree has the database open). What
  // was here is kept in backups/ first. If a step fails, what is in place opens
  // as usual and the next start carries on (lib/data-import.js).
  let imported = null;
  if (!globalThis[OPENED]) {
    try {
      imported = applyPendingImport({ dir: dataDir(), dbFile: file });
      if (imported) {
        console.log(`Sixgree: finished the import (${imported.people} people). What was here before: ${imported.keptDatabase || 'nothing to keep'}.`);
      }
    } catch (err) {
      console.error(`Sixgree: could not finish the import (will try again next start): ${err.message}`);
    }
  }
  globalThis[OPENED] = true;

  _db = new DatabaseSync(file);

  // Before this version changes anything: if a different version opened this
  // data last, keep a copy of it as it was. See backupOnNewVersion().
  try {
    const saved = backupOnNewVersion(_db, { dir: path.dirname(file), dataDir: dataDir(), version: APP_VERSION });
    if (saved) console.log(`Sixgree ${APP_VERSION}: backed up your data first → ${saved}`);
  } catch (err) {
    console.error(`Sixgree: could not back up your data before ${APP_VERSION} (will try again next start): ${err.message}`);
  }

  // Idempotent: every statement is CREATE ... IF NOT EXISTS, so this doubles
  // as first-run setup and as a no-op on every later boot.
  applySchema(_db);

  if (imported) {
    try { recordImport(_db, imported); } catch { /* only the Settings page's note is lost */ }
    // The copy that import kept of what was here joins the rotation (lib/backups.js KEEP).
    try { rotateBackups(backupsFolder()); } catch { /* tried again after the next backup */ }
  }

  // Once a day: checked here, as the server opens the data, and after each
  // scan (app/api/scraper/route.js). No timer: nothing runs that nobody started.
  try {
    const daily = backUpDailyIfDue(_db);
    if (daily) console.log(`Sixgree: made today's backup → ${daily.file}`);
  } catch (err) {
    console.error(`Sixgree: could not make today's backup (will try again after the next scan or start): ${err.message}`);
  }

  return _db;
}

/** backups/, beside the database (where an import keeps its copy too). */
export function backupsFolder() {
  return path.join(path.dirname(dbFile()), 'backups');
}

/** What lib/backups.js needs to make, check and restore this copy's backups. */
export function backupOptions(db = getDb()) {
  return {
    db, dataDir: dataDir(), backupsDir: backupsFolder(), appVersion: APP_VERSION, schemaSql: SCHEMA_SQL, applySchema,
  };
}

/** The daily backup, if one is due (lib/backups.js dailyBackupIfDue). @returns it, or null. */
export function backUpDailyIfDue(db = getDb(), now = new Date()) {
  return dailyBackupIfDue({ ...backupOptions(db), now });
}

/**
 * Every table, index and column this version uses, made if missing. An import
 * is rebuilt into exactly this (lib/data-import.js), so only rows travel.
 */
export function applySchema(db) {
  db.exec(SCHEMA_SQL);
  addMissingColumns(db);
}

// CREATE TABLE IF NOT EXISTS never adds a column to a table that already
// exists, so columns added after first release are added here, once.
const ADDED_COLUMNS = [
  ['linkedin_connections', 'score_why', 'TEXT'],
  ['linkedin_connections', 'mutual_count', 'INTEGER'],
  // Read profiles' current and past roles, one JSON text (lib/experience.js).
  ['linkedin_connections', 'experience', 'TEXT'],
];

function addMissingColumns(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// ── a copy of the data before each new version touches it ──────────────────
// The first time a version opens a database that a different version (or one
// from before this existed) used last, it backs it up, as it was, into
// backups/: before the schema step or anything else writes to it. The backup
// is the whole network, photos and files too (lib/backups.js makeBackup), so
// Settings → Your data → Restore can put it back. The newest three are kept;
// anything someone put in backups/ themselves is never touched. The marker is
// written only after a copy succeeds, so a failed one (a full disk) is retried
// at the next start.
//
// If that backup can't be made or fails its check (a database holding
// something an export never does, say), the database alone is still copied,
// as every version before this did: a copy that only a person can put back is
// better than none before an update. The page says the backup didn't work.

export { AUTO_BACKUP_PREFIX };

export function backupOnNewVersion(db, {
  dir, version, dataDir: filesDir = dir, now = new Date(), schemaSql = SCHEMA_SQL, applySchema: schemaStep = applySchema,
}) {
  const marker = path.join(dir, 'app-version');
  let last = null;
  try { last = readFileSync(marker, 'utf8').trim(); } catch { /* first run, or older than this */ }
  if (last === version) return null;

  let saved = null;
  const hasData = db.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'linkedin_connections'"
  ).get().n > 0;
  if (hasData) {
    const folder = path.join(dir, 'backups');
    // The data is the last version's, not this one's: say so in the copy, so
    // that version can restore it if this one has to be put back. (Data a
    // newer version wrote, or with no marker, is labelled with this version.)
    const known = /^v?\d+\.\d+\.\d+/.test(last || '') && compareVersions(last, version) <= 0;
    try {
      saved = makeBackup('before-update', {
        db, dataDir: filesDir, backupsDir: folder, appVersion: version, dataVersion: known ? last : version,
        schemaSql, applySchema: schemaStep, now,
      }).file;
    } catch (err) {
      noteBackupFailure('before-update', err, now);
      mkdirSync(folder, { recursive: true });
      saved = path.join(folder, `${AUTO_BACKUP_PREFIX}${version}-${now.toISOString().replace(/[:.]/g, '-')}.sqlite`);
      // Through the open handle, and synced before it takes its name (the
      // vacuumCopy pattern, lib/data-import.js).
      const partial = path.join(folder, `.${path.basename(saved)}.partial`);
      try {
        db.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
        durable.syncFile(partial);
        renameSync(partial, saved);
        durable.syncFolder(folder);
      } catch (copyErr) {
        rmSync(partial, { force: true });
        throw copyErr;
      }
      try { rotateBackups(folder, { now }); } catch { /* tried again after the next one */ }
    }
  }
  writeFileSync(marker, `${version}\n`);
  return saved;
}

// Exposed for tests, which need a fresh in-memory database per case.
export function _setDbForTesting(db) {
  _db = db;
}

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

// ── row codecs ─────────────────────────────────────────────────────────────
export function decodeRow(table, row) {
  if (!row) return row;
  const out = { ...row };
  for (const col of JSON_COLUMNS[table] || []) {
    if (typeof out[col] === 'string') {
      try { out[col] = JSON.parse(out[col]); } catch { /* leave as-is */ }
    }
  }
  for (const col of BOOLEAN_COLUMNS[table] || []) {
    if (out[col] === 0 || out[col] === 1) out[col] = Boolean(out[col]);
  }
  return out;
}

export function encodeValue(table, col, value) {
  if (value === undefined) return null;
  if ((JSON_COLUMNS[table] || []).includes(col)) {
    return value === null ? null : JSON.stringify(value);
  }
  if ((BOOLEAN_COLUMNS[table] || []).includes(col)) {
    return value === null ? null : value ? 1 : 0;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}
