// Where the scanner's queue (lib/scan-queue.js) lives between restarts: one
// file in the data folder. Read once when the server first needs it; written
// after every change.
//
// A queue read back at start waits for you (`paused: 'restarted'`): nothing
// starts scanning just because the app opened. Resume queue in the notch
// carries on.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { durable } from './durable.js';
import { cleanQueue, emptyQueue, waitingIn } from './scan-queue.js';

export const QUEUE_FILE = 'scan-queue.json';

/** The queue on file in `dir`, or an empty one. Anything waiting waits for you. */
export function loadQueue(dir) {
  const file = path.join(dir, QUEUE_FILE);
  if (!existsSync(file)) return emptyQueue();
  try {
    const q = cleanQueue(JSON.parse(readFileSync(file, 'utf8')));
    if (waitingIn(q).length && !q.paused) q.paused = 'restarted';
    return q;
  } catch {
    return emptyQueue();
  }
}

/** Write it down. A queue that can't be written still runs; it just won't outlive a restart. */
export function saveQueue(dir, q) {
  try {
    durable.writeJsonDurably(path.join(dir, QUEUE_FILE), q);
    return true;
  } catch {
    return false;
  }
}
