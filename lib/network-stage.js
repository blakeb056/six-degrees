// A network file waiting between its preview and Import.
//
// A preview says what an import would do, and Import does exactly that, so
// both have to read the same file. The first request writes the file into a
// private working folder inside the data folder (NETWORK_STAGE_PREFIX, made
// with mkdtemp, so nothing is written anywhere else) through the format's own
// writer, which reads it back through its own checks (lib/network-file.js
// writeNetworkFolder). The second request names the folder by the random part
// of its name, never by a path, and the folder is read again, checks and all,
// before anything is imported.
//
// After an import the folder goes. One nobody imported (the window closed on
// the preview) is swept once it is an hour old, like every working folder
// (lib/data-folder.js sweepLeftovers).

import { mkdtempSync, lstatSync, rmSync } from 'node:fs';
import path from 'node:path';
import { NETWORK_STAGE_PREFIX, sweepLeftovers } from './data-folder.js';
import { readNetworkFolder, writeNetworkFolder, NetworkFileError } from './network-file.js';

// mkdtemp's random part: six letters and digits.
const STAGE_ID = /^[A-Za-z0-9]{6}$/;
const NETWORK = 'network';

/** The folder of stage `id`, or null when `id` can't be one (anything with a "/" or ".." included). */
function stageFolder(dataDir, id) {
  return typeof id === 'string' && STAGE_ID.test(id) ? path.join(dataDir, `${NETWORK_STAGE_PREFIX}${id}`) : null;
}

/**
 * Write a network file (writeNetworkFolder's parts and options) into a new
 * stage in `dataDir`. Old stages nobody imported are swept first.
 * @returns {{ id, model }} the stage's name, and the file as readNetworkFolder reads it.
 * @throws NetworkFileError when the parts aren't a valid file; nothing is left behind.
 */
export function stageNetwork(dataDir, parts, options) {
  try { sweepLeftovers(dataDir); } catch { /* swept at the next start */ }
  const work = mkdtempSync(path.join(dataDir, NETWORK_STAGE_PREFIX));
  try {
    writeNetworkFolder(path.join(work, NETWORK), parts, options);
    return { id: path.basename(work).slice(NETWORK_STAGE_PREFIX.length), model: readNetworkFolder(path.join(work, NETWORK)) };
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
}

/**
 * The network file staged as `id`, read and checked again.
 * @throws NetworkFileError: 400 for a name that can't be a stage, 410 for one that's gone.
 */
export function stagedNetwork(dataDir, id) {
  const folder = stageFolder(dataDir, id);
  if (!folder) throw new NetworkFileError('That preview isn\'t one Sixgree made.', { status: 400 });
  let s;
  try { s = lstatSync(folder); } catch { s = null; }
  if (!s?.isDirectory()) {
    throw new NetworkFileError('That preview has expired, so nothing was imported. Choose the file again.', { status: 410 });
  }
  return readNetworkFolder(path.join(folder, NETWORK));
}

/** Remove stage `id`. @returns whether there was one. */
export function dropStage(dataDir, id) {
  const folder = stageFolder(dataDir, id);
  if (!folder) return false;
  let had = true;
  try { lstatSync(folder); } catch { had = false; }
  rmSync(folder, { recursive: true, force: true });
  return had;
}
