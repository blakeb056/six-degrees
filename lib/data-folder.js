// The data folder: what is in it, and which parts of it may leave this computer.
//
// Everything Six Degrees keeps lives in one folder (SIX_DEGREES_HOME, default
// ~/.six-degrees). Parts of it belong to this computer only: chrome-profile/ is
// a live, signed-in LinkedIn session (SECURITY.md), and venv/ and python/ (the
// scanner's own Python, when Set up the scanner downloaded one) are built for this
// machine's chip. So what an export carries is an allow-list, never "the folder
// minus a few things": a file that appears in the folder later stays behind
// until someone decides it should travel.

import { readdirSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

/** A photo the /avatars route serves: a plain file name, no folders. The route uses this same pattern. */
export const AVATAR_FILE = /^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/;

/**
 * The scanner's notes about the network itself: without them, people whose
 * circles are hidden or half-read would be retried from scratch on the new
 * computer (TRAPS §15, §34). They describe one network's people, so an import
 * replaces them along with the network: this computer's notes would say which
 * pages of the old network's people were read, and the scanner would skip
 * those pages for the new one.
 */
export const NETWORK_FILES = [
  'bridge-progress.json',
  'bridge-skips.json',
  'bridge-unclear.json',
];

/**
 * The LinkedIn account's budget and cooldown. They belong to the account, not
 * to a network or a computer, and leaving them behind would reset the month's
 * count (TRAPS §35). So they travel, and an import merges them with the ones
 * already here instead of replacing them (lib/linkedin-limits.js
 * mergeBudgetFiles): searches made on either computer still count.
 */
export const BUDGET_FILES = [
  'scan-limits.json',
  'linkedin-activity.json',
  'linkedin-cooldown.json',
];

/** Everything of the scanner's that an export carries. */
export const TRAVELLING_FILES = [...NETWORK_FILES, ...BUDGET_FILES];

/** Where a checked import waits for the next start (lib/data-import.js). */
export const PENDING_DIR = 'import-pending';

/** backups/ names: the copy kept before an import replaced the network. */
export const IMPORT_BACKUP_PREFIX = 'before-import-';

// Private working folders, made with mkdtemp inside the data folder so nothing
// is written anywhere else. A run that dies part-way leaves one behind; they
// are swept once they are an hour old (so a job still running is never hit),
// at each server's start (lib/data-import.js applyPendingImport, from getDb)
// and before the next run of the same kind.
export const EXPORT_WORK_PREFIX = '.export-';
export const UPLOAD_WORK_PREFIX = '.import-upload-';
// Set up the scanner's download and what it unpacked (lib/scanner-python.js):
// 25 to 150 MB, so a server stopped part-way shouldn't leave it for good.
export const SETUP_WORK_PREFIX = '.python-setup-';
const WORK_PREFIXES = [EXPORT_WORK_PREFIX, UPLOAD_WORK_PREFIX, SETUP_WORK_PREFIX];
const SPENT_PENDING = /^import-pending\.(done|cancelled)-/;

function plainFileSize(file) {
  try {
    const s = lstatSync(file);
    return s.isFile() ? s.size : 0;
  } catch {
    return 0;
  }
}

/**
 * The names in a folder that really is one here. A link, even to a folder, is
 * never followed: nothing outside the data folder may be counted, or carried
 * off in an export, through one.
 */
export function namesInFolder(folder) {
  try {
    return lstatSync(folder).isDirectory() ? readdirSync(folder) : [];
  } catch {
    return [];
  }
}

/** Count and total size of the plain files directly in a folder whose names pass `keep`. */
function filesIn(folder, keep = () => true) {
  let count = 0;
  let bytes = 0;
  const names = namesInFolder(folder);
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
 * and never looked inside. `inNetwork` (the photo names the network's rows
 * point at) gives photosInCopy: the ones a copy would carry, since photos of
 * people no longer in the network stay behind (lib/data-export.js).
 */
export function folderReport({ dir, dbFile, autoPrefix, inNetwork = null }) {
  const avatars = path.join(dir, 'avatars');
  return {
    dataDir: dir,
    dbFile,
    databaseBytes: ['', '-wal', '-shm'].reduce((n, s) => n + plainFileSize(dbFile + s), 0),
    photos: filesIn(avatars, (name) => AVATAR_FILE.test(name)),
    photosInCopy: inNetwork ? filesIn(avatars, (name) => AVATAR_FILE.test(name) && inNetwork.has(name)) : null,
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
    const work = WORK_PREFIXES.some((prefix) => name.startsWith(prefix));
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
