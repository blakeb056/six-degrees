// Backups: copies of the whole network kept in backups/, so the app keeps
// working without anyone looking after it (Blake, 2026-10-03: proper backups
// of his connections and photos).
//
// No new format. A backup is a .sixdegrees file, the same one Settings →
// Your data exports (lib/data-export.js): the database (the settings in it),
// the photos of the people in it and the scanner's files, each file with its
// SHA-256. So a backup is checked by the same importer that would restore it
// (validateImport), and restoring one is an import of it (stageImport), with
// the same Restart now and the same copy of what was there kept first.
//
// Never the Social tab's files (BACKUP_SOCIAL). Its messages are kept only
// while Keep my messages is on, and Forget it deletes them and the numbers
// (lib/social-store.js): a copy made every day and kept for a week, or for
// good, would keep what Forget it promised to delete. An export still carries
// them when its box is ticked: someone chose that copy. Because a backup
// brings none, restoring one leaves this computer's Social files where they
// are (applyPendingImport steps them aside only for a copy that brings its own).
//
// Written aside as a hidden .partial, synced, checked, and only then renamed
// to its name (the vacuumCopy pattern, lib/data-import.js): a file with a
// backup's name is always a whole one that passed the importer's checks. A
// copy that fails its check is never kept under a backup's name, so it can
// never push a good one out of the rotation.
//
// When they are made: before a new version first opens the data
// (lib/db-client.js backupOnNewVersion), once a day, checked when the server
// starts and after each scan (no timers: nothing runs that nobody started),
// and when someone clicks Back up now. Which are kept is KEEP below.

import { DatabaseSync } from 'node:sqlite';
import {
  rmSync, renameSync, mkdirSync, lstatSync, copyFileSync, mkdtempSync,
} from 'node:fs';
import path from 'node:path';
import { buildExport, countPeople, EXPORT_EXTENSION } from './data-export.js';
import { validateImport, stageImport, ImportError } from './data-import.js';
import {
  listBackups, namesInFolder, IMPORT_BACKUP_PREFIX, UPLOAD_WORK_PREFIX, sweepLeftovers,
} from './data-folder.js';
import { runningNow } from './scan-state.js';
import { durable } from './durable.js';

/** The kinds makeBackup makes. A copy kept before an import is made by the import itself (applyPendingImport). */
export const MADE_KINDS = ['daily', 'before-update', 'manual'];

/**
 * How many of each kind are kept, newest first. One made by hand (Back up
 * now, or anything someone put in backups/ themselves) is never deleted.
 */
export const KEEP = Object.freeze({ daily: 7, 'before-update': 3, 'before-import': 3 });

/**
 * A copy kept before an import (or a restore) is the only way back from it, so
 * it stays for at least this long however many imports follow.
 */
export const IMPORT_FLOOR_MS = 30 * 24 * 3600 * 1000;

/** Whether a backup carries the Social tab's files: never (see the top of this file). */
export const BACKUP_SOCIAL = false;

/** A daily backup is made when the newest is at least this old. */
export const DAILY_EVERY_MS = 24 * 3600 * 1000;

/** backups/ names before this feature: the database alone, before a new version (lib/db-client.js). */
export const AUTO_BACKUP_PREFIX = 'auto-before-';

// A half-written backup a stopped server left: hidden, so no listing shows it,
// and swept once it is an hour old (never one a running backup is writing).
const PARTIAL = /^\..+\.partial(?:-journal)?$/;
const PARTIAL_AGE_MS = 3600 * 1000;

const STAMP = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
const MADE = /^(daily|before-update|manual)-(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sixdegrees$/;
const SIDE = /^(.+\.sqlite)-(?:wal|shm|journal)$/;
const FILES = /^(.+)-files$/;

/** The time in a name, as every backup's name carries it (2026-10-03T14-05-09-123Z), or null. */
export function stampTime(name) {
  const m = STAMP.exec(String(name));
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(t) ? t : null;
}

const stampOf = (now) => now.toISOString().replace(/[:.]/g, '-');

/** "daily-0.7.0-2026-10-03T14-05-09-123Z.sixdegrees" */
export function backupName(kind, version, now = new Date()) {
  return `${kind}-${version}-${stampOf(now)}${EXPORT_EXTENSION}`;
}

/** What one name in backups/ is: its kind, its format, and whether it can be restored. */
function describe(entry, autoPrefix) {
  const { name } = entry;
  const out = {
    name,
    kind: 'manual',
    format: null,      // 'sixdegrees' (photos and files inside) or 'database' (the database alone)
    version: null,
    restorable: false,
    byHand: true,      // put in backups/ by someone, not made by Sixgree
    withFiles: null,   // the folder of photos and files kept beside a database copy
    parts: [],         // names that go with it: that folder, a -wal or -shm
    bytes: entry.bytes,
    modifiedAt: entry.modifiedAt,
    at: stampTime(name) ?? entry.modifiedAt,
    folder: entry.folder,
  };
  if (entry.folder) return out;
  const made = MADE.exec(name);
  if (made) {
    Object.assign(out, { kind: made[1], version: made[2], format: 'sixdegrees', byHand: false });
  } else if (name.startsWith(autoPrefix) && name.endsWith('.sqlite')) {
    const rest = name.slice(autoPrefix.length, -'.sqlite'.length);
    const at = STAMP.exec(rest);
    Object.assign(out, {
      kind: 'before-update', format: 'database', byHand: false,
      version: at ? rest.slice(0, at.index).replace(/-$/, '') || null : null,
    });
  } else if (name.startsWith(IMPORT_BACKUP_PREFIX) && name.endsWith('.sqlite')) {
    Object.assign(out, { kind: 'before-import', format: 'database', byHand: false });
  } else if (name.endsWith(EXPORT_EXTENSION)) {
    out.format = 'sixdegrees';
  } else if (name.endsWith('.sqlite')) {
    out.format = 'database';
  }
  out.restorable = out.format !== null;
  return out;
}

/**
 * Every backup in `folder`, newest first, as the Settings page lists them: a
 * database copy with its -wal, -shm and its folder of photos and files is one
 * backup. Names come from the folder's own listing (lib/data-folder.js
 * listBackups), so nothing here is ever a path someone sent.
 */
export function describeBackups(folder, { autoPrefix = AUTO_BACKUP_PREFIX } = {}) {
  const raw = listBackups(folder, { autoPrefix });
  const names = new Set(raw.map((b) => b.name));
  const owners = new Map();
  const extras = [];
  for (const b of raw) {
    const side = SIDE.exec(b.name);
    if (!b.folder && side && names.has(side[1])) { extras.push([side[1], b]); continue; }
    const files = FILES.exec(b.name);
    if (b.folder && files && names.has(`${files[1]}.sqlite`)) { extras.push([`${files[1]}.sqlite`, b]); continue; }
    owners.set(b.name, describe(b, autoPrefix));
  }
  for (const [owner, b] of extras) {
    const o = owners.get(owner);
    o.bytes += b.bytes || 0;
    o.parts.push(b.name);
    if (b.folder) o.withFiles = b.name;
  }
  return [...owners.values()].sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** Delete one backup and whatever goes with it. Only names from the listing. */
function removeBackup(folder, entry) {
  for (const name of [...entry.parts, entry.name]) {
    rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

/**
 * Keep KEEP of each kind, newest first; never one made by hand; never a copy
 * from before an import that is under 30 days old. Also sweeps half-written
 * backups a stopped server left. @returns the names deleted.
 */
export function rotateBackups(folder, { now = Date.now(), keep = KEEP, floorMs = IMPORT_FLOOR_MS, autoPrefix = AUTO_BACKUP_PREFIX } = {}) {
  const at = now instanceof Date ? now.getTime() : now;
  const all = describeBackups(folder, { autoPrefix });
  const removed = [];
  for (const [kind, n] of Object.entries(keep)) {
    for (const entry of all.filter((e) => e.kind === kind && !e.byHand).slice(n)) {
      if (kind === 'before-import' && at - entry.at < floorMs) continue;
      removeBackup(folder, entry);
      removed.push(entry.name);
    }
  }
  for (const name of namesInFolder(folder)) {
    if (!PARTIAL.test(name)) continue;
    try {
      if (at - lstatSync(path.join(folder, name)).mtimeMs >= PARTIAL_AGE_MS) rmSync(path.join(folder, name), { force: true });
    } catch { /* gone already */ }
  }
  if (removed.length) durable.syncFolder(folder);
  return removed;
}

// ── checking ─────────────────────────────────────────────────────────────────

// Checked once per file per server: a check reads every page and every photo,
// and the page asks often. The same file (name, size and time) gives the same
// answer; a file that changes on the disk is checked again. One map per
// process however the bundler splits route modules, like lib/scan-state.js.
const CHECKED = Symbol.for('six-degrees.backups-checked');
const FAILED = Symbol.for('six-degrees.backup-failed');
const checkedFiles = () => (globalThis[CHECKED] ||= new Map());

/** The importer's refusal, without the words that only fit an import. */
export function plainProblem(message) {
  return String(message || 'it could not be read')
    .replace(/,? so nothing was imported\..*$/s, '.')
    .replace(/\s+Export it again on the other computer\.?$/, '');
}

/**
 * Would this backup restore? The importer's own checks (validateImport): SQLite's
 * integrity check, nothing an export never holds, every row count and every
 * file's checksum against its manifest.
 * @returns {{ ok: true, people, photos, exportedAt, fromVersion } | { ok: false, problem }}
 */
export function checkBackup(file, { applySchema, schemaSql, appVersion }) {
  try {
    const info = validateImport(file, { applySchema, schemaSql, appVersion });
    return { ok: true, ...info };
  } catch (err) {
    const problem = plainProblem(err instanceof ImportError ? err.message : `It could not be read (${err.message}).`);
    return { ok: false, problem: problem.replace(/^This file/, 'This backup') };
  }
}

function fileKey(file) {
  try {
    const s = lstatSync(file);
    return s.isFile() ? `${file}|${s.size}|${s.mtimeMs}` : null;
  } catch {
    return null;
  }
}

/** checkBackup, remembered for the same file. */
export function checkBackupOnce(file, opts) {
  const key = fileKey(file);
  if (!key) return { ok: false, problem: 'It is no longer there.' };
  const memo = checkedFiles();
  if (!memo.has(key)) memo.set(key, checkBackup(file, opts));
  return memo.get(key);
}

/** The last backup that couldn't be made in this server, for the page; cleared by the next that works. */
export function backupFailure() {
  return globalThis[FAILED] || null;
}

export function noteBackupFailure(kind, err, now = new Date()) {
  globalThis[FAILED] = { kind, at: now.toISOString(), message: plainProblem(err?.message || String(err)) };
}

// ── making ───────────────────────────────────────────────────────────────────

/**
 * Make a backup of the open database `db` and the data folder `dataDir` in
 * `backupsDir`: the whole network as a .sixdegrees file, with every photo of
 * someone in it and the scanner's files (not the Social tab's: BACKUP_SOCIAL).
 *
 * `appVersion` is the version making it (in its name); `dataVersion` the one
 * whose data it holds (in its manifest), which differs only before an update:
 * that copy holds the old version's data, so the old version can restore it.
 *
 * @returns {{ name, file, bytes, people, photos, kind, verified: true }}
 * @throws when it can't be made or fails its check; nothing is left under a backup's name then.
 */
export function makeBackup(kind, {
  db, dataDir, backupsDir, appVersion, dataVersion = appVersion, schemaSql, applySchema, now = new Date(), rotate = true,
}) {
  if (!MADE_KINDS.includes(kind)) throw new Error(`There is no kind of backup called '${kind}'.`);
  mkdirSync(backupsDir, { recursive: true });
  const name = backupName(kind, appVersion, now);
  const file = path.join(backupsDir, name);
  const partial = path.join(backupsDir, `.${name}.partial`);
  const tidy = () => {
    rmSync(partial, { force: true });
    rmSync(`${partial}-journal`, { force: true });
  };
  tidy();
  let made;
  try {
    made = buildExport(db, {
      dir: dataDir, outFile: partial, includePhotos: true, includeSocial: BACKUP_SOCIAL, appVersion: dataVersion, schemaSql, now,
    });
    // SQLite doesn't sync what VACUUM INTO writes (lib/durable.js).
    durable.syncFile(partial);
    const check = checkBackup(partial, { applySchema, schemaSql, appVersion });
    if (!check.ok) throw new Error(`the copy failed its check: ${check.problem}`);
    renameSync(partial, file);
    durable.syncFolder(backupsDir);
  } catch (err) {
    tidy();
    throw err;
  }
  const key = fileKey(file);
  if (key) checkedFiles().set(key, { ok: true, people: made.people, photos: made.photos });
  globalThis[FAILED] = null;
  if (rotate) {
    // A backup that was made stays made, even if an old one can't be deleted.
    try { rotateBackups(backupsDir, { now }); } catch { /* tried again after the next one */ }
  }
  return { name, file, kind, bytes: made.bytes, people: made.people, photos: made.photos, verified: true };
}

/** When was the newest daily backup made? null when there is none. */
export function newestDaily(backupsDir) {
  return describeBackups(backupsDir).find((e) => e.kind === 'daily')?.at ?? null;
}

/**
 * Is a daily backup due? When there is none, or the newest is a day old. One
 * stamped more than a day ahead of now (the clock was changed) doesn't hold
 * the next one back forever.
 */
export function dailyDue(newest, now = Date.now()) {
  if (newest == null) return true;
  return now - newest >= DAILY_EVERY_MS || newest - now >= DAILY_EVERY_MS;
}

/**
 * The daily backup, if one is due and there is a network to back up. Called
 * when the server opens the database and after each scan. @returns the backup, or null.
 */
export function dailyBackupIfDue(opts) {
  const now = opts.now || new Date();
  if (!dailyDue(newestDaily(opts.backupsDir), now.getTime())) return null;
  if (countPeople(opts.db) === 0) return null;
  try {
    return makeBackup('daily', { ...opts, now });
  } catch (err) {
    noteBackupFailure('daily', err, now);
    throw err;
  }
}

// ── what the page shows ──────────────────────────────────────────────────────

/**
 * The backups for the Settings page, newest first, and the newest restorable
 * .sixdegrees backup checked (once per file per server): "Last backup: <time>,
 * verified", or what is wrong with it (TRAPS §7: a damaged copy says so).
 */
export function backupReport(backupsDir, { applySchema, schemaSql, appVersion }) {
  const backups = describeBackups(backupsDir);
  const newest = backups.find((e) => e.format === 'sixdegrees' && !e.byHand) || null;
  let last = null;
  if (newest) {
    const check = checkBackupOnce(path.join(backupsDir, newest.name), { applySchema, schemaSql, appVersion });
    last = {
      name: newest.name,
      kind: newest.kind,
      at: new Date(newest.at).toISOString(),
      verified: check.ok,
      people: check.ok ? check.people ?? null : null,
      problem: check.ok ? null : check.problem,
    };
  }
  return { backups, last, failed: backupFailure(), keep: KEEP, floorDays: IMPORT_FLOOR_MS / (24 * 3600 * 1000) };
}

// ── restoring ────────────────────────────────────────────────────────────────

/**
 * The checks before a restore, as an import makes them (lib/data-import.js
 * importPreflight): nothing running, no import waiting, and a yes that names
 * how many people it replaces. @returns an ImportError, or null to go ahead.
 */
export function restorePreflight({ scanRunning, pending, currentPeople = 0, confirmedPeople }) {
  if (scanRunning) {
    return new ImportError(`${runningNow(scanRunning)}. Let it finish, or stop it on the Scan page, then restore.`, { status: 409 });
  }
  if (pending) {
    return new ImportError('An import or a restore is already waiting to finish. Restart Sixgree to finish it, or cancel it first.', { status: 409 });
  }
  if (currentPeople > 0 && confirmedPeople !== currentPeople) {
    return new ImportError(
      `This copy has ${currentPeople.toLocaleString('en-US')} people. Confirm that the backup replaces them.`,
      { status: 409, needsConfirm: true, people: currentPeople },
    );
  }
  return null;
}

/**
 * The backup called `name`, only if it is one of the names backups/ holds now
 * (lib/data-folder.js listBackups) and, unless `restorable` is false (Show in
 * Finder), can be restored. Never a path: a name with a folder in it, "..", or
 * anything the folder doesn't list is refused.
 */
export function findBackup(backupsDir, name, { restorable = true } = {}) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name === '.' || name === '..'
    || /[\\/\0]/.test(name)) {
    return null;
  }
  if (!listBackups(backupsDir).some((b) => b.name === name)) return null;
  return describeBackups(backupsDir).find((e) => e.name === name && (e.restorable || !restorable)) || null;
}

/**
 * Stage a backup to replace the network at the next start: the same as an
 * import (stageImport), from a copy of the backup in a private working folder,
 * so the backup itself is never moved or changed. A database-only copy (from
 * before this feature, or kept before an import) is made into a .sixdegrees
 * file first, with the photos and files kept beside it, or, for one that has
 * none, the photos and files here now.
 * @returns what the page shows while it waits (READY).
 * @throws ImportError, fit to show.
 */
export function restoreBackup(name, {
  dir, backupsDir, applySchema, schemaSql, appVersion, replacedPeople = 0, now = new Date(),
}) {
  const entry = findBackup(backupsDir, name);
  if (!entry) throw new ImportError('There is no backup by that name in the backups folder.', { status: 404 });
  sweepLeftovers(dir);
  const work = mkdtempSync(path.join(dir, UPLOAD_WORK_PREFIX));
  try {
    const upload = path.join(work, 'upload.sixdegrees');
    const source = path.join(backupsDir, entry.name);
    if (entry.format === 'sixdegrees') {
      copyFileSync(source, upload);
    } else {
      // Read from a private copy: SQLite may write beside a database it opens,
      // and nothing is ever written into backups/ by a restore.
      const copy = path.join(work, 'backup.sqlite');
      copyFileSync(source, copy);
      let db;
      try {
        db = new DatabaseSync(copy);
      } catch (err) {
        throw new ImportError(`This backup couldn't be opened (${err.message}).`);
      }
      try {
        // A copy kept before an import has the files that import stepped
        // aside beside it, the Social tab's among them only if the import
        // brought its own: undoing it puts them back. One with none beside it
        // takes the photos and scanner files here now, and leaves the Social
        // tab's where they are.
        buildExport(db, {
          dir: entry.withFiles ? path.join(backupsDir, entry.withFiles) : dir,
          outFile: upload, includePhotos: true, includeSocial: Boolean(entry.withFiles), appVersion, schemaSql, now,
        });
      } catch (err) {
        throw new ImportError(`This backup couldn't be read (${err.message}).`);
      } finally {
        db.close();
      }
      rmSync(copy, { force: true });
    }
    return stageImport(upload, {
      dir, applySchema, schemaSql, appVersion, replacedPeople, now, restoredFrom: entry.name,
    });
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    if (err instanceof ImportError) {
      throw new ImportError(plainProblem(err.message).replace(/^This file/, 'This backup'), { status: err.status, ...err.extra });
    }
    throw err;
  }
}
