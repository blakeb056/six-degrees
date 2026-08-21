import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

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

export function getDb() {
  if (_db) return _db;

  const file = process.env.SIX_DEGREES_DB || path.join(dataDir(), 'six-degrees.sqlite');
  _db = new DatabaseSync(file);

  // Idempotent: every statement is CREATE ... IF NOT EXISTS, so this doubles
  // as first-run setup and as a no-op on every later boot.
  const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
  if (existsSync(schemaPath)) _db.exec(readFileSync(schemaPath, 'utf8'));

  return _db;
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
