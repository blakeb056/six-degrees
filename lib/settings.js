// What the user chose on the Settings page.
//
// Kept in the database, not the browser: the browser's storage belongs to one
// window's address and port (and in the Mac app lives outside the data
// folder), so it would not travel with an export, a backup or a new computer.
// Everything sits in one JSON object under app_meta 'settings'.
//
// Each setting a feature adds declares itself in SETTINGS below: its default,
// and a parse() that returns the cleaned value or throws a plain-English
// error. A key that isn't declared is refused, so a stale page or a stray
// request can't plant values nothing reads.

export const SETTINGS = {};

const KEY = 'settings';

/** A setting the user sent that can't be accepted; its message is shown as is. */
export class SettingsError extends Error {}

/** The stored settings, with defaults for anything never set. */
export function readSettings(db, schema = SETTINGS) {
  let stored = {};
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEY);
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
    } catch {
      // A damaged value reads as "nothing chosen" rather than breaking every
      // page. The next save overwrites it.
    }
  }
  const out = {};
  for (const [name, def] of Object.entries(schema)) {
    let value = def.default;
    if (name in stored) {
      try { value = def.parse(stored[name]); } catch { value = def.default; }
    }
    out[name] = value;
  }
  return out;
}

/**
 * Apply a partial change, validated, and store the result.
 * @returns the full settings after the change.
 * @throws SettingsError with a message fit to show the user; nothing is written.
 */
export function writeSettings(db, patch, schema = SETTINGS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SettingsError('Settings must be an object.');
  }
  const current = readSettings(db, schema);
  const next = { ...current };
  for (const [name, value] of Object.entries(patch)) {
    const def = schema[name];
    if (!def) throw new SettingsError(`There is no setting called '${name}'.`);
    try {
      next[name] = def.parse(value);
    } catch (err) {
      throw new SettingsError(err.message);
    }
  }
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(KEY, JSON.stringify(next));
  return next;
}
