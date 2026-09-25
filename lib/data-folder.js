// The data folder: what is in it, and which parts of it may leave this computer.
//
// Everything Six Degrees keeps lives in one folder (SIX_DEGREES_HOME, default
// ~/.six-degrees). Parts of it belong to this computer only: chrome-profile/ is
// a live, signed-in LinkedIn session (SECURITY.md), and venv/ is built for this
// machine's chip. So what an export carries is an allow-list, never "the folder
// minus a few things": a file that appears in the folder later stays behind
// until someone decides it should travel.

import { readdirSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

/** A photo the /avatars route serves: a plain file name, no folders. The route uses this same pattern. */
export const AVATAR_FILE = /^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/;

/**
 * The scanner's own files that travel with your network. Without the first
 * three, people whose circles are hidden or half-read would be retried from
 * scratch on the new computer (TRAPS §15, §34). The last three are the LinkedIn
 * account's budget and cooldown: they belong to the account, not to this
 * computer, and leaving them behind would reset the month's count (TRAPS §35).
 */
export const TRAVELLING_FILES = [
  'bridge-progress.json',
  'bridge-skips.json',
  'bridge-unclear.json',
  'scan-limits.json',
  'linkedin-activity.json',
  'linkedin-cooldown.json',
];

/** Where a checked import waits for the next start (lib/data-import.js). */
export const PENDING_DIR = 'import-pending';

/** backups/ names: the copy kept before an import replaced the network. */
export const IMPORT_BACKUP_PREFIX = 'before-import-';

// Private working folders, made with mkdtemp inside the data folder so nothing
// is written anywhere else. A run that dies part-way leaves one behind; they
// are swept once they are an hour old (so a job still running is never hit).
export const EXPORT_WORK_PREFIX = '.export-';
export const UPLOAD_WORK_PREFIX = '.import-upload-';
const SPENT_PENDING = /^import-pending\.(done|cancelled)-/;

function plainFileSize(file) {
  try {
    const s = lstatSync(file);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

/** Count and total size of the plain files directly in a folder whose names pass `keep`. */
function filesIn(folder, keep = () => true) {
  let count = 0;
  let bytes = 0;
  let names = [];
  try { names = readdirSync(folder); } catch { return { count, bytes }; }
  for (const name of names) {
    if (!keep(name)) continue;
    try {
      const s = lstatSync(path.join(folder, name));
      if (s.isFile()) { count++; bytes += s.size; }
    } catch { /* gone since the listing */ }
  }
  return { count, bytes };
}

/** Everything under a folder, without following links. Capped, so a huge folder can't stall the page. */
function treeBytes(folder, budget = { left: 50000 }) {
  let bytes = 0;
  let names = [];
  try { names = readdirSync(folder); } catch { return 0; }
  for (const name of names) {
    if (budget.left-- <= 0) break;
    const p = path.join(folder, name);
    try {
      const s = lstatSync(p);
      if (s.isDirectory()) bytes += treeBytes(p, budget);
      else if (s.isFile()) bytes += s.size;
    } catch { /* gone since the listing */ }
  }
  return bytes;
}

/** 'auto' (before a new version), 'import' (before an import) or 'manual' (anything else, made by hand). */
export function backupKind(name, autoPrefix) {
  if (autoPrefix && name.startsWith(autoPrefix)) return 'auto';
  if (name.startsWith(IMPORT_BACKUP_PREFIX)) return 'import';
  return 'manual';
}

/** Every copy in backups/, newest first. A folder is the photos and files kept beside an import's copy. */
export function listBackups(folder, { autoPrefix } = {}) {
  let names = [];
  try { names = readdirSync(folder); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.') || name.endsWith('.partial')) continue;
    const p = path.join(folder, name);
    let s;
    try { s = lstatSync(p); } catch { continue; }
    if (!s.isFile() && !s.isDirectory()) continue;
    out.push({
      name,
      bytes: s.isFile() ? s.size : treeBytes(p),
      modifiedAt: s.mtimeMs,
      kind: backupKind(name, autoPrefix),
      folder: s.isDirectory(),
    });
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
}

/**
 * What the Settings page shows about the folder. Sizes come from the file
 * system only; nothing is read. chrome-profile/ is reported as there or not,
 * and never looked inside.
 */
export function folderReport({ dir, dbFile, autoPrefix }) {
  return {
    dataDir: dir,
    dbFile,
    databaseBytes: ['', '-wal', '-shm'].reduce((n, s) => n + plainFileSize(dbFile + s), 0),
    photos: filesIn(path.join(dir, 'avatars'), (name) => AVATAR_FILE.test(name)),
    backups: listBackups(path.join(path.dirname(dbFile), 'backups'), { autoPrefix }),
    linkedinSignIn: existsSync(path.join(dir, 'chrome-profile')),
  };
}

/** Remove working folders a run that died left behind, once they are old enough to be nobody's. */
export function sweepLeftovers(dir, { now = Date.now(), maxAgeMs = 3600 * 1000 } = {}) {
  let names = [];
  try { names = readdirSync(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const work = name.startsWith(EXPORT_WORK_PREFIX) || name.startsWith(UPLOAD_WORK_PREFIX);
    if (!work && !SPENT_PENDING.test(name)) continue;
    const p = path.join(dir, name);
    try {
      const s = lstatSync(p);
      if (!s.isDirectory()) continue;
      // A spent import folder is only ever renamed away to be deleted: always safe.
      if (work && now - s.mtimeMs < maxAgeMs) continue;
      rmSync(p, { recursive: true, force: true });
      removed++;
    } catch { /* someone else got there first */ }
  }
  return removed;
}

/** The program that opens a folder in the file browser here, or null where there is none. */
export function folderOpener(platform = process.platform) {
  if (platform === 'darwin') return 'open';
  if (platform === 'linux') return 'xdg-open';
  return null;
}

/**
 * Open the data folder in Finder (or the Linux file browser). The path is the
 * data folder itself, never anything from a request. Resolves { ok, message }.
 */
export function revealFolder(dir, { platform = process.platform, spawnImpl = spawn, waitMs = 3000 } = {}) {
  const cmd = folderOpener(platform);
  if (!cmd) return Promise.resolve({ ok: false, message: 'There is no file browser to open it with on this computer.' });
  return new Promise((resolve) => {
    let timer = null;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawnImpl(cmd, [dir], { stdio: 'ignore', detached: true });
    } catch (err) {
      done({ ok: false, message: `It couldn't be opened (${err.message}).` });
      return;
    }
    child.on('error', (err) => done({
      ok: false,
      message: err.code === 'ENOENT'
        ? `This computer has no ${cmd}, so there is no file browser to open it with.`
        : `It couldn't be opened (${err.message}).`,
    }));
    // `open` hands the folder to Finder and exits at once, and so does xdg-open
    // (or it fails at once, on a machine with no desktop). Still running after a
    // few seconds means a file browser is up and holding it.
    child.on('exit', (code) => done(code === 0
      ? { ok: true }
      : { ok: false, message: `The file browser didn't open (${cmd} stopped with code ${code}).` }));
    timer = setTimeout(() => {
      try { child.unref(); } catch { /* already gone */ }
      done({ ok: true });
    }, waitMs);
  });
}
