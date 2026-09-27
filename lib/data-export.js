// One file that carries your network to another computer.
//
// The file is itself a SQLite database: a consistent copy of yours, made with
// VACUUM INTO the way the automatic backups are (safe even mid-WAL), plus two
// tables of its own. sd_export_manifest says what it is: the format, which
// version made it, when, and how many of each thing. sd_export_files holds the
// photos and the scanner's files that travel, each with its SHA-256. One file,
// no archive format, no new dependency. lib/data-import.js reads it back.
//
// What travels is an allow-list (lib/data-folder.js). Your LinkedIn sign-in
// (chrome-profile/) never does: the new computer signs in again.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, lstatSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AVATAR_FILE, TRAVELLING_FILES, namesInFolder } from './data-folder.js';

/** Bump when the file's layout changes in a way an older import can't read. */
export const EXPORT_FORMAT = 1;
export const EXPORT_EXTENSION = '.sixdegrees';

/** The two tables an export adds. An import accepts exactly these columns. */
export const EXPORT_TABLES = {
  sd_export_manifest: 'CREATE TABLE sd_export_manifest (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  sd_export_files: 'CREATE TABLE sd_export_files (path TEXT PRIMARY KEY, bytes BLOB NOT NULL, sha256 TEXT NOT NULL)',
};

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A path as an SQL string literal, for the statements that can't take a parameter (VACUUM INTO, ATTACH). */
export function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The app's tables, read from the schema, so a table added later is counted and carried without anyone remembering to. */
export function appTables(schemaSql) {
  return [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

/** The app's named indexes, read from the schema the same way. */
export function appIndexes(schemaSql) {
  return [...schemaSql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

/** People, not rows: someone reachable through two bridges has a row for each. */
export function countPeople(db, schema = 'main') {
  try {
    return db.prepare(`SELECT count(DISTINCT profile_url) AS n FROM ${schema}.linkedin_connections`).get().n;
  } catch {
    return 0;
  }
}

/** "Six Degrees backup 2026-09-25.sixdegrees", in this computer's own date. */
export function exportFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Six Degrees backup ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${EXPORT_EXTENSION}`;
}

/** The photo files the network's rows point at (`/avatars/<name>`), by name. */
export function referencedPhotos(db) {
  return new Set(db.prepare(`SELECT DISTINCT substr(profile_image_url, 10) AS name FROM linkedin_connections
    WHERE substr(profile_image_url, 1, 9) = '/avatars/'`).all().map((r) => r.name));
}

/**
 * The files in the data folder that travel: the scanner's own JSON files and,
 * if asked, the photos (only those named in `photos`, when it is given). Only
 * plain files are taken, never a link, and avatars/ is read only if it is a
 * real folder, so nothing outside the data folder can be pulled in through one.
 */
export function travellingFiles(dir, { includePhotos = true, photos = null } = {}) {
  const plain = (p) => {
    try { return lstatSync(p).isFile(); } catch { return false; }
  };
  const out = [];
  for (const name of TRAVELLING_FILES) {
    const abs = path.join(dir, name);
    if (plain(abs)) out.push({ rel: name, abs });
  }
  if (includePhotos) {
    for (const name of namesInFolder(path.join(dir, 'avatars')).sort()) {
      if (!AVATAR_FILE.test(name) || (photos && !photos.has(name))) continue;
      const abs = path.join(dir, 'avatars', name);
      if (plain(abs)) out.push({ rel: `avatars/${name}`, abs });
    }
  }
  return out;
}

/**
 * Write an export of the open database `db` and the data folder `dir` to
 * `outFile`, which must not exist yet.
 * @returns {{ bytes, people, photos, files, counts }}
 */
export function buildExport(db, { dir, outFile, includePhotos = true, appVersion, schemaSql, now = new Date() }) {
  db.exec(`VACUUM INTO ${sqlString(outFile)}`);

  const out = new DatabaseSync(outFile);
  let summary;
  try {
    // One self-contained file: no -wal beside it to be forgotten in a copy.
    out.exec('PRAGMA journal_mode = DELETE');
    out.exec(`${Object.values(EXPORT_TABLES).join(';\n')};`);
    out.exec('BEGIN');

    // Without the photos, a row pointing at /avatars/<file> would point at a
    // file the other computer doesn't have: some views draw an empty circle
    // for it. With no photo, they show initials, and the next scan of that
    // person saves a new one. A photo not saved yet (LinkedIn's own link,
    // which expires in a few weeks) is left as it is, as it is here.
    if (!includePhotos) {
      out.exec("UPDATE linkedin_connections SET profile_image_url = NULL WHERE profile_image_url LIKE '/avatars/%'");
    }
    // This computer's own history, not the network's: the other computer
    // records its own import when it finishes it.
    out.exec("DELETE FROM app_meta WHERE key = 'last_import'");

    const put = out.prepare('INSERT INTO sd_export_files (path, bytes, sha256) VALUES (?, ?, ?)');
    let photos = 0;
    let files = 0;
    // Only the photos of people still in the network. avatars/ keeps the
    // photo of someone whose circle was deleted since; the copy has no row
    // for them, so their face has no reason to travel.
    const inNetwork = includePhotos ? referencedPhotos(out) : null;
    for (const f of travellingFiles(dir, { includePhotos, photos: inNetwork })) {
      let bytes;
      try { bytes = readFileSync(f.abs); } catch { continue; } // replaced since the listing
      put.run(f.rel, bytes, sha256(bytes));
      files++;
      if (f.rel.startsWith('avatars/')) photos++;
    }

    const counts = {};
    for (const t of appTables(schemaSql)) {
      try { counts[t] = out.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n; } catch { counts[t] = 0; }
    }
    let scoringVersion = '';
    try {
      scoringVersion = out.prepare("SELECT value FROM app_meta WHERE key = 'scoring_version'").get()?.value ?? '';
    } catch { /* never scored */ }
    const people = countPeople(out);

    const manifest = {
      format: EXPORT_FORMAT,
      app_version: appVersion,
      scoring_version: scoringVersion,
      exported_at: now.toISOString(),
      include_photos: includePhotos ? 1 : 0,
      people,
      photos,
      files,
      counts: JSON.stringify(counts),
    };
    const meta = out.prepare('INSERT INTO sd_export_manifest (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(manifest)) meta.run(key, String(value));

    out.exec('COMMIT');
    summary = { people, photos, files, counts };
  } catch (err) {
    try { out.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw err;
  } finally {
    out.close();
  }
  return { ...summary, bytes: statSync(outFile).size };
}
