// Writes that have to be on the disk before the next step may count on them.
//
// A rename is atomic, but it isn't durable. After a power cut the new name can
// be on the disk while the bytes it names aren't, so a copy that "exists" can
// be empty. SQLite doesn't sync what VACUUM INTO writes either (its docs say
// so). So a file is synced before it is renamed into place, and its folder
// after, so the rename itself is on the disk before anything relies on it.
//
// On a Mac, Node's fsync is F_FULLFSYNC (libuv), which also empties the drive's
// own write cache; a plain fsync there doesn't.

import fs from 'node:fs';
import path from 'node:path';

// A folder that isn't there has no rename to make durable, and some file
// systems can't open or sync one: nothing more can be done then.
const FOLDER_CANT_SYNC = new Set(['ENOENT', 'EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR', 'EPERM', 'EBADF']);

function syncFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncFolder(folder) {
  let fd;
  try {
    fd = fs.openSync(folder, 'r');
  } catch (err) {
    if (FOLDER_CANT_SYNC.has(err.code)) return;
    throw err;
  }
  try {
    fs.fsyncSync(fd);
  } catch (err) {
    if (!FOLDER_CANT_SYNC.has(err.code)) throw err;
  } finally {
    fs.closeSync(fd);
  }
}

/** Replace `file` with `data` so that after a power cut it holds either the old contents or the new, never part of either. */
function writeFileDurably(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  syncFolder(path.dirname(file));
}

/** The same, for a JSON document, laid out the way the scanner writes its own files. */
function writeJsonDurably(file, value) {
  writeFileDurably(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Called through this object rather than directly, so a test can see what was
 * synced and in which order (tests/data-transfer.test.mjs).
 */
export const durable = { syncFile, syncFolder, writeFileDurably, writeJsonDurably };
