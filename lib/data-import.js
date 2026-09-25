// Bringing a network in from another computer: check the file, stage it, and
// swap it in at the next start.
//
// Replace, never merge. Merging two networks means deciding again who "you"
// are, re-parenting every circle (a bridge's id is a UUID made on one
// computer), and de-duplicating against the unique index. Each of those is a
// way to corrupt data silently (TRAPS §7, §25, §32). Moving to a new computer
// is a replacement anyway, and what was here is kept in backups/ first.
//
// Applied at the next start, not live. The database handle is opened once and
// kept (lib/db-client.js), and nothing can safely close it under a running
// server. So the import route only checks the file and stages it in
// import-pending/; getDb() finishes the job the next time the app starts,
// before it opens the database.
//
// The file is untrusted until it has been checked (SECURITY.md): it came from
// somewhere else. Nothing in the data folder changes until every check passes,
// and the database it brings is rebuilt into this version's own schema, so
// only rows travel, never table definitions.

import { DatabaseSync } from 'node:sqlite';
import {
  openSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync,
  lstatSync, cpSync, readdirSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { compareVersions } from './release.js';
import {
  AVATAR_FILE, TRAVELLING_FILES, PENDING_DIR, IMPORT_BACKUP_PREFIX, sweepLeftovers,
} from './data-folder.js';
import {
  EXPORT_FORMAT, EXPORT_TABLES, sha256, sqlString, appTables, appIndexes, countPeople,
} from './data-export.js';

/** The biggest file an import accepts. next.config.mjs lets a request body this large through the proxy. */
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

/** A refusal whose message is fit to show as it is. Nothing was changed. */
export class ImportError extends Error {
  constructor(message, { status = 400, ...extra } = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function megabytes(bytes) {
  const n = bytes / 1024 / 1024;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} MB`;
}

// Names from the file are shown in messages; keep a hostile one short.
const shortName = (s) => String(s).slice(0, 80);

/**
 * The checks that need no file: may an import start at all?
 * @returns an ImportError to refuse with, or null to go ahead.
 */
export function importPreflight({ scanRunning, pending, declared, currentPeople = 0, confirmedPeople, max = MAX_IMPORT_BYTES }) {
  if (scanRunning) {
    return new ImportError('A scan is running. Let it finish, or stop it on the Scan page, then import.', { status: 409 });
  }
  if (pending) {
    return new ImportError('An import is already waiting to finish. Restart Six Degrees to finish it, or cancel it first.', { status: 409 });
  }
  if (!Number.isSafeInteger(declared) || declared <= 0) {
    return new ImportError('Choose a Six Degrees export (a .sixdegrees file) to import.');
  }
  if (declared > max) {
    return new ImportError(`That file is ${megabytes(declared)}. This copy can import files up to ${megabytes(max)}.`, { status: 413 });
  }
  // Replacing a network needs a yes that names what it replaces. If a scan has
  // added people since the page asked, the count no longer matches: ask again.
  if (currentPeople > 0 && confirmedPeople !== currentPeople) {
    return new ImportError(
      `This copy already has ${currentPeople.toLocaleString('en-US')} people. Confirm that the import replaces them.`,
      { status: 409, needsConfirm: true, people: currentPeople },
    );
  }
  return null;
}

/**
 * Write a request body to `file`, refusing more than `declared` bytes and
 * anything short of it. Resolves the number of bytes written.
 */
export async function receiveUpload(body, file, { declared }) {
  const fh = await open(file, 'wx', 0o600);
  let received = 0;
  try {
    if (body) {
      for await (const chunk of body) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        received += bytes.byteLength;
        if (received > declared) {
          throw new ImportError('The file was bigger than the size it was sent with, so nothing was imported. Try again.');
        }
        for (let at = 0; at < bytes.byteLength;) {
          const { bytesWritten } = await fh.write(bytes, at, bytes.byteLength - at);
          at += bytesWritten;
        }
      }
    }
  } finally {
    await fh.close();
  }
  if (received !== declared) {
    throw new ImportError(`The file didn't arrive whole (${received} of ${declared} bytes), so nothing was imported. Try again.`);
  }
  return received;
}

/** 'photo', 'file' (one of the scanner's travelling files), or null for anything an export never carries. */
export function exportedFileKind(rel) {
  if (typeof rel !== 'string') return null;
  if (TRAVELLING_FILES.includes(rel)) return 'file';
  // The same pattern the /avatars route serves: no folders, no dots but the
  // extension, so no path can climb out of avatars/.
  if (rel.startsWith('avatars/') && AVATAR_FILE.test(rel.slice('avatars/'.length))) return 'photo';
  return null;
}

/**
 * Tables every export must have. The rest of this version's tables are
 * optional: an export made before a table was added simply lacks it, and it is
 * made empty here.
 */
const REQUIRED_TABLES = ['users', 'linkedin_connections', ...Object.keys(EXPORT_TABLES)];

/**
 * The tables, columns and indexes this version makes, to hold a file up against.
 * A column is required only if a row can't be stored without it (a key, or NOT
 * NULL with no default). Any other column may be missing, as in an export from
 * before it was added, and gets its default. So adding a column or a table
 * later never turns away the exports people already have.
 */
function referenceSchema(applySchema, schemaSql) {
  const ref = new DatabaseSync(':memory:');
  try {
    applySchema(ref);
    ref.exec(`${Object.values(EXPORT_TABLES).join(';\n')};`);
    const tables = new Map();
    for (const t of [...appTables(schemaSql), ...Object.keys(EXPORT_TABLES)]) {
      const cols = ref.prepare(`PRAGMA table_info("${t}")`).all();
      tables.set(t, {
        required: cols.filter((c) => c.pk > 0 || (c.notnull && c.dflt_value === null)).map((c) => c.name),
        allowed: new Set(cols.map((c) => c.name)),
      });
    }
    return { tables, indexes: new Set(appIndexes(schemaSql)) };
  } finally {
    ref.close();
  }
}

/**
 * Everything about the file that can be checked without changing anything.
 * @throws ImportError with a message fit to show.
 * @returns {{ fromVersion, exportedAt, people, photos, files }}
 */
export function validateImport(file, { applySchema, schemaSql, appVersion }) {
  const head = Buffer.alloc(100);
  let got = 0;
  const fd = openSync(file, 'r');
  try { got = readSync(fd, head, 0, 100, 0); } finally { closeSync(fd); }
  if (got < 100 || !head.subarray(0, 16).equals(SQLITE_MAGIC)) {
    throw new ImportError("This isn't a Six Degrees export (a .sixdegrees file), so nothing was imported.");
  }

  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (err) {
    throw new ImportError(`This file couldn't be opened (${err.message}), so nothing was imported.`);
  }
  try {
    // Its schema was written somewhere else: nothing in it may call functions,
    // and SQLite checks each page's cells as it reads them. Both are SQLite's
    // own advice for a database file from somewhere else.
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA cell_size_check = ON;');

    let check;
    try { check = db.prepare('PRAGMA integrity_check').all(); } catch (err) { check = [{ integrity_check: err.message }]; }
    if (check.length !== 1 || check[0].integrity_check !== 'ok') {
      throw new ImportError("This file is damaged (its database fails SQLite's own check), so nothing was imported. Export it again on the other computer.");
    }

    const ref = referenceSchema(applySchema, schemaSql);
    const notOurs = (type, name) => new ImportError(
      `This file holds something a Six Degrees export never does (the ${shortName(type)} “${shortName(name)}”), so nothing was imported.`,
    );
    // Only the app's own tables and indexes, by name, and each table an
    // ordinary one: a virtual table can carry an app table's name while a
    // module of its own answers for it. A view, a trigger or anything else the
    // app never makes is refused whatever it is.
    const kinds = new Map(db.prepare('PRAGMA main.table_list').all().map((r) => [r.name, r]));
    const objects = db.prepare('SELECT type, name, tbl_name FROM sqlite_master').all();
    for (const o of objects) {
      if (o.type === 'table') {
        const kind = kinds.get(o.name)?.type;
        if (kind !== 'table') throw notOurs(`${kind || 'unknown'} table`, o.name);
        if (ref.tables.has(o.name)) continue;
      }
      if (o.type === 'index'
        && (ref.indexes.has(o.name) || (String(o.name).startsWith('sqlite_autoindex_') && ref.tables.has(o.tbl_name)))) continue;
      throw notOurs(o.type, o.name);
    }
    const present = new Set(objects.filter((o) => o.type === 'table').map((o) => o.name));
    if (!present.has('sd_export_manifest') || !present.has('sd_export_files')) {
      throw new ImportError("This is a database but not a Six Degrees export, so nothing was imported. Make one on the other computer with Settings → Your data → Save a copy.");
    }
    for (const [t, { required, allowed }] of ref.tables) {
      if (!present.has(t)) {
        // Made empty when the network is rebuilt: an export from before this table existed.
        if (!REQUIRED_TABLES.includes(t)) continue;
        throw new ImportError(`This export has no “${t}” table, so nothing was imported.`);
      }
      // table_xinfo, not table_info: it also lists generated and hidden
      // columns, which the app never makes.
      const cols = db.prepare(`PRAGMA table_xinfo("${t}")`).all();
      const names = cols.map((c) => c.name);
      const laidOut = kinds.get(t).wr === 0
        && cols.every((c) => c.hidden === 0 && allowed.has(c.name))
        && required.every((c) => names.includes(c));
      if (!laidOut) {
        throw new ImportError(`This export's “${t}” table isn't laid out the way Six Degrees makes it, so nothing was imported.`);
      }
    }

    const m = Object.fromEntries(db.prepare('SELECT key, value FROM sd_export_manifest').all().map((r) => [r.key, r.value]));
    const format = Number(m.format);
    if (format !== EXPORT_FORMAT) {
      throw new ImportError(Number.isInteger(format) && format > EXPORT_FORMAT
        ? 'This export was made by a newer Six Degrees than this copy. Update this copy first, then import it.'
        : "This file's export details aren't ones Six Degrees writes, so nothing was imported.");
    }
    const fromVersion = String(m.app_version ?? '');
    if (!/^v?\d+\.\d+\.\d+/.test(fromVersion)) {
      throw new ImportError("This file doesn't say which version of Six Degrees made it, so nothing was imported.");
    }
    // There is no way back down: an older copy can't know what a newer one
    // changed, and its backups only ever guard an upgrade.
    if (compareVersions(fromVersion, appVersion) > 0) {
      throw new ImportError(`This file comes from Six Degrees ${shortName(fromVersion)}, which is newer than this copy (${appVersion}). Update this copy first, then import it.`);
    }

    // The manifest counted every table and file as the export was made, so a
    // file changed since then (rows or photos added or taken out) gives itself
    // away here.
    let counts = null;
    try { counts = JSON.parse(m.counts); } catch { /* refused just below */ }
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      throw new ImportError("This file's export details aren't ones Six Degrees writes, so nothing was imported.");
    }
    const changedSince = (what, has, says) => new ImportError(
      `This file's ${what} doesn't match its own export details (${has}, where they say ${shortName(says)}), so nothing was imported. Export it again on the other computer.`,
    );
    for (const t of present) {
      if (Object.hasOwn(EXPORT_TABLES, t)) continue;
      const n = db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
      if (!Object.hasOwn(counts, t) || Number(counts[t]) !== n) throw changedSince(`“${t}” table`, `${n} rows`, counts[t] ?? 'nothing');
    }
    // A table it counted rows in has to still be there. (One made after this
    // export was isn't in its counts at all, and is made empty.)
    for (const [t, n] of Object.entries(counts)) {
      if (!present.has(t) && Number(n) !== 0) throw changedSince(`“${shortName(t)}” table`, 'no table', n);
    }

    let photos = 0;
    let files = 0;
    const one = db.prepare('SELECT bytes, sha256 FROM sd_export_files WHERE path = ?');
    for (const { path: rel } of db.prepare('SELECT path FROM sd_export_files').all()) {
      const kind = exportedFileKind(rel);
      if (!kind) {
        throw new ImportError(`This file carries “${shortName(rel)}”, which an export never includes, so nothing was imported.`);
      }
      const row = one.get(rel);
      if (!(row?.bytes instanceof Uint8Array) || sha256(row.bytes) !== row.sha256) {
        throw new ImportError(`“${rel}” inside this file is damaged (it doesn't match its checksum), so nothing was imported.`);
      }
      if (kind === 'photo') { photos++; continue; }
      let parsed;
      try { parsed = JSON.parse(Buffer.from(row.bytes).toString('utf8')); } catch { parsed = undefined; }
      // Every one of the scanner's files is a JSON object; the scanner and the
      // app read them as one.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ImportError(`“${rel}” inside this file can't be read, so nothing was imported.`);
      }
      files++;
    }
    if (Number(m.files) !== photos + files) {
      throw changedSince('list of files', `${photos + files} files`, m.files ?? 'nothing');
    }

    return { fromVersion, exportedAt: m.exported_at || null, people: countPeople(db), photos, files };
  } catch (err) {
    // Anything SQLite itself trips on while reading a strange file is still a
    // plain refusal, never a crash with nothing said.
    if (err instanceof ImportError) throw err;
    throw new ImportError(`This file couldn't be read as a Six Degrees export (${shortName(err.message)}), so nothing was imported.`);
  } finally {
    db.close();
  }
}

/**
 * Check the uploaded file and stage it for the next start. `upload` sits alone
 * in a private working folder inside `dir` (the route made it with mkdtemp); on
 * success that folder becomes import-pending/, in one rename.
 * @returns what the Settings page shows while the import waits.
 */
export function stageImport(upload, { dir, applySchema, schemaSql, appVersion, replacedPeople = 0, now = new Date() }) {
  const info = validateImport(upload, { applySchema, schemaSql, appVersion });
  const work = path.dirname(upload);
  const filesDir = path.join(work, 'files');

  const db = new DatabaseSync(path.join(work, 'data.sqlite'));
  try {
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON;');
    // This version's own tables and indexes. Only rows come from the file.
    applySchema(db);
    db.exec(`ATTACH DATABASE ${sqlString(upload)} AS up`);
    try {
      db.exec('BEGIN');
      for (const t of appTables(schemaSql)) {
        // The columns the file has. A column (or a whole table) added since it
        // was made is left to this version's default.
        const cols = db.prepare(`PRAGMA up.table_info("${t}")`).all().map((c) => `"${c.name}"`).join(', ');
        if (!cols) continue;
        db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM up."${t}" ORDER BY rowid`);
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      throw new ImportError(`This export's network doesn't fit this copy's database (${err.message}), so nothing was imported.`);
    }

    mkdirSync(path.join(filesDir, 'avatars'), { recursive: true });
    const one = db.prepare('SELECT bytes, sha256 FROM up.sd_export_files WHERE path = ?');
    for (const { path: rel } of db.prepare('SELECT path FROM up.sd_export_files').all()) {
      const row = one.get(rel);
      // Checked above; checked again where the bytes are written.
      if (!exportedFileKind(rel) || !(row?.bytes instanceof Uint8Array) || sha256(row.bytes) !== row.sha256) {
        throw new ImportError(`“${shortName(rel)}” inside this file is damaged, so nothing was imported.`);
      }
      writeFileSync(path.join(filesDir, rel), row.bytes, { flag: 'wx' });
    }
  } finally {
    db.close();
  }
  rmSync(upload, { force: true });

  const ready = {
    stagedAt: now.toISOString(),
    exportedAt: info.exportedAt,
    fromVersion: info.fromVersion,
    people: info.people,
    photos: info.photos,
    replacedPeople,
  };
  writeFileSync(path.join(work, 'READY'), `${JSON.stringify(ready, null, 2)}\n`);
  // import-pending/ never exists half-made.
  renameSync(work, path.join(dir, PENDING_DIR));
  return ready;
}

// ── the next start ───────────────────────────────────────────────────────────

const exists = (p) => {
  try { lstatSync(p); return true; } catch { return false; }
};

/** Empty (SQLite makes a new database of it), or starting with SQLite's own header. */
function looksLikeSqlite(file) {
  const head = Buffer.alloc(SQLITE_MAGIC.length);
  const fd = openSync(file, 'r');
  try {
    const got = readSync(fd, head, 0, head.length, 0);
    return got === 0 || (got === head.length && head.equals(SQLITE_MAGIC));
  } finally {
    closeSync(fd);
  }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
}

/** A rename, or a copy and delete when SIX_DEGREES_DB puts the database on another disk. */
function move(from, to) {
  try {
    renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** The import waiting for the next start, or null. */
export function pendingImport(dir) {
  const folder = path.join(dir, PENDING_DIR);
  if (!exists(path.join(folder, 'READY'))) return null;
  const ready = readJson(path.join(folder, 'READY')) || {};
  const applying = readJson(path.join(folder, 'APPLYING'));
  let error = null;
  try { error = readFileSync(path.join(folder, 'ERROR'), 'utf8').trim() || null; } catch { /* none */ }
  // Once anything has moved, the only way out is forward, at the next start.
  return { ...ready, started: Boolean(applying && applying.phase !== 'start'), error };
}

/** Throw away a staged import that hasn't started. Resolves { cancelled, reason? }. */
export function cancelPendingImport(dir) {
  const current = pendingImport(dir);
  if (!current) return { cancelled: false, reason: 'none' };
  if (current.started) return { cancelled: false, reason: 'started' };
  const folder = path.join(dir, PENDING_DIR);
  const spent = `${folder}.cancelled-${Date.now()}`;
  // One rename first, so a half-deleted folder is never read as an import.
  renameSync(folder, spent);
  rmSync(spent, { recursive: true, force: true });
  return { cancelled: true };
}

/**
 * Finish a staged import: called by getDb() before it opens the database.
 *
 * Each step is recorded in import-pending/APPLYING before the next begins, so
 * a start that dies part-way carries on from where it stopped next time rather
 * than undoing or repeating anything.
 *
 * @returns what happened, for app_meta 'last_import', or null when nothing waits.
 * @throws when a step fails; the reason is kept in import-pending/ERROR for the page.
 */
export function applyPendingImport({ dir, dbFile, now = new Date() }) {
  sweepLeftovers(dir, { now: now.getTime() });
  const pending = path.join(dir, PENDING_DIR);
  if (!exists(path.join(pending, 'READY'))) return null;
  const ready = readJson(path.join(pending, 'READY')) || {};

  const journal = path.join(pending, 'APPLYING');
  const state = readJson(journal) || { stamp: now.toISOString().replace(/[:.]/g, '-'), phase: 'start' };
  const step = (phase) => {
    state.phase = phase;
    writeJsonAtomic(journal, state);
  };

  const backups = path.join(path.dirname(dbFile), 'backups');
  const keptDb = path.join(backups, `${IMPORT_BACKUP_PREFIX}${state.stamp}.sqlite`);
  const keptFiles = path.join(backups, `${IMPORT_BACKUP_PREFIX}${state.stamp}-files`);

  try {
    if (!exists(journal)) step('start');

    if (state.phase === 'start') {
      // 1. Keep the network that is here. Opening it first replays a -wal left
      //    by a hard stop (nothing closes the database on quit), so the copy
      //    holds everything. Written aside, then renamed: a copy that exists is
      //    a whole one.
      if (!exists(keptDb) && exists(dbFile)) {
        mkdirSync(backups, { recursive: true });
        const partial = `${keptDb}.partial`;
        rmSync(partial, { force: true });
        try {
          // Not SQLite at all: don't hand it to SQLite, which would open the
          // -wal beside it, find nothing it can use, and delete it on close.
          if (!looksLikeSqlite(dbFile)) throw new Error('it is not a SQLite database');
          const current = new DatabaseSync(dbFile);
          try { current.exec(`VACUUM INTO ${sqlString(partial)}`); } finally { current.close(); }
          renameSync(partial, keptDb);
        } catch (err) {
          // A database that can't be copied (damaged, or a disk too full for
          // the copy) is kept as it is instead: renamed, byte for byte, with
          // its -wal and -shm under the same name so they still pair up.
          // Otherwise the import someone makes to recover from a damaged
          // network could never finish. A rename needs no space, and the next
          // step would remove these files anyway, so nothing is lost.
          rmSync(partial, { force: true });
          for (const suffix of ['-wal', '-shm']) {
            if (exists(`${dbFile}${suffix}`)) move(`${dbFile}${suffix}`, `${keptDb}${suffix}`);
          }
          move(dbFile, keptDb);
          state.keptAsIs = String(err.message || err).slice(0, 200);
        }
      }
      step('database-kept');
    }

    if (state.phase === 'database-kept') {
      // 2. Its photos and the scanner's files go beside it.
      for (const name of ['avatars', ...TRAVELLING_FILES]) {
        const from = path.join(dir, name);
        if (!exists(from)) continue;
        mkdirSync(keptFiles, { recursive: true });
        move(from, path.join(keptFiles, name));
      }
      step('files-kept');
    }

    if (state.phase === 'files-kept') {
      // 3. The old database goes together with its -wal and -shm: a stale WAL
      //    beside the new file would be replayed into it and corrupt it. The
      //    new one takes its place in a single rename.
      const staged = path.join(pending, 'data.sqlite');
      if (exists(staged)) {
        for (const suffix of ['-wal', '-shm', '-journal']) rmSync(`${dbFile}${suffix}`, { force: true });
        mkdirSync(path.dirname(dbFile), { recursive: true });
        move(staged, dbFile);
      }
      step('database-placed');
    }

    if (state.phase === 'database-placed') {
      // 4. The photos and files that came with it.
      const files = path.join(pending, 'files');
      const photos = path.join(files, 'avatars');
      if (exists(photos)) {
        mkdirSync(path.join(dir, 'avatars'), { recursive: true });
        for (const name of readdirSync(photos)) move(path.join(photos, name), path.join(dir, 'avatars', name));
      }
      for (const name of TRAVELLING_FILES) {
        const from = path.join(files, name);
        if (exists(from)) move(from, path.join(dir, name));
      }
      step('done');
    }
  } catch (err) {
    try { writeFileSync(path.join(pending, 'ERROR'), `${err.message}\n`); } catch { /* the folder went too */ }
    throw err;
  }

  // 5. Out of the way in one rename, then deleted.
  const spent = `${pending}.done-${state.stamp}`;
  renameSync(pending, spent);
  rmSync(spent, { recursive: true, force: true });

  const shown = (p) => {
    const rel = path.relative(dir, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
  };
  return {
    appliedAt: now.toISOString(),
    stagedAt: ready.stagedAt ?? null,
    exportedAt: ready.exportedAt ?? null,
    fromVersion: ready.fromVersion ?? null,
    people: ready.people ?? null,
    photos: ready.photos ?? null,
    replacedPeople: ready.replacedPeople ?? null,
    keptDatabase: exists(keptDb) ? shown(keptDb) : null,
    keptFiles: exists(keptFiles) ? shown(keptFiles) : null,
    // Set when the database that was here couldn't be read, so it was kept
    // as it was rather than copied: the reason SQLite gave.
    keptAsIs: state.keptAsIs ?? null,
  };
}

/** Remember the finished import in the new database, for the Settings page. */
export function recordImport(db, result) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES ('last_import', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(result));
}

export function lastImport(db) {
  try {
    const value = db.prepare("SELECT value FROM app_meta WHERE key = 'last_import'").get()?.value;
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// ── restarting to finish ─────────────────────────────────────────────────────

/**
 * The exit code this copy's launcher treats as "start the server again", or
 * null when it can't. Only the Mac app's shell sets it (desktop/main.mjs); an
 * npx or source copy runs the server in the Terminal, which a restart would end.
 */
export function restartCodeFrom(env = process.env) {
  const n = Number(env.SIX_DEGREES_RESTART_CODE);
  return Number.isInteger(n) && n > 1 && n < 126 ? n : null;
}

/** How to restart this copy to finish an import, in words for the page. */
export function restartAdvice({ kind, code, dataDir = null }) {
  const finish = 'It finishes the import as it starts.';
  if (code) return { canRestart: true, how: `Six Degrees restarts in a few seconds. ${finish}` };
  if (kind === 'mac-app') return { canRestart: false, how: `Quit Six Degrees (⌘Q) and open it again. ${finish}` };
  if (kind === 'npm') {
    const flag = dataDir ? ` --data-dir '${String(dataDir).replace(/'/g, `'\\''`)}'` : '';
    return {
      canRestart: false,
      how: `Stop Six Degrees with Ctrl-C in its Terminal window, then start it again. ${finish}`,
      command: `npx six-degrees${flag}`,
    };
  }
  if (kind === 'source') {
    return {
      canRestart: false,
      how: `Stop Six Degrees with Ctrl-C in its Terminal window, then start it again. ${finish}`,
      command: 'npm run start:packaged',
    };
  }
  return { canRestart: false, how: `Stop the server with Ctrl-C and start it again the way you started it. ${finish}` };
}
