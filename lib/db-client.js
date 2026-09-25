import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SCHEMA_SQL } from '../db/schema.js';
import { APP_VERSION } from './app-version.js';
import { applyPendingImport, recordImport } from './data-import.js';

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
  // swapped under a handle that is already open. What was here is kept in
  // backups/ first. If a step fails, what is in place opens as usual and the
  // next start carries on (lib/data-import.js).
  let imported = null;
  if (!globalThis[OPENED]) {
    try {
      imported = applyPendingImport({ dir: dataDir(), dbFile: file });
      if (imported) {
        console.log(`Six Degrees: finished the import (${imported.people} people). What was here before: ${imported.keptDatabase || 'nothing to keep'}.`);
      }
    } catch (err) {
      console.error(`Six Degrees: could not finish the import (will try again next start): ${err.message}`);
    }
  }
  globalThis[OPENED] = true;

  _db = new DatabaseSync(file);

  // Before this version changes anything: if a different version opened this
  // data last, keep a copy of it as it was. See backupOnNewVersion().
  try {
    const saved = backupOnNewVersion(_db, { dir: path.dirname(file), version: APP_VERSION });
    if (saved) console.log(`Six Degrees ${APP_VERSION}: backed up your data first → ${saved}`);
  } catch (err) {
    console.error(`Six Degrees: could not back up your data before ${APP_VERSION} (will try again next start): ${err.message}`);
  }

  // Idempotent: every statement is CREATE ... IF NOT EXISTS, so this doubles
  // as first-run setup and as a no-op on every later boot.
  applySchema(_db);

  if (imported) {
    try { recordImport(_db, imported); } catch { /* only the Settings page's note is lost */ }
  }

  return _db;
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
];

function addMissingColumns(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// ── a copy of the data before each new version touches it ──────────────────
// The first time a version opens a database that a different version (or one
// from before this existed) used last, it copies the database, as it was, into
// backups/ — before the schema step or anything else writes to it. VACUUM INTO
// makes one consistent file even mid-WAL. The newest five automatic copies are
// kept; anything else in backups/ (copies made by hand) is never touched. The
// marker is written only after the copy succeeds, so a failed copy (a full
// disk) is retried at the next start.

export const AUTO_BACKUP_PREFIX = 'auto-before-';

export function backupOnNewVersion(db, { dir, version, keep = 5, now = new Date() }) {
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
    mkdirSync(folder, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    saved = path.join(folder, `${AUTO_BACKUP_PREFIX}${version}-${stamp}.sqlite`);
    db.exec(`VACUUM INTO '${saved.replace(/'/g, "''")}'`);

    const autos = readdirSync(folder)
      .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.sqlite'))
      .map((f) => ({ f, at: statSync(path.join(folder, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at || b.f.localeCompare(a.f));
    for (const { f } of autos.slice(keep)) rmSync(path.join(folder, f), { force: true });
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
