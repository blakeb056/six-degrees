// Whether the scanner is running, for routes other than the one that runs it.
//
// app/api/scraper/route.js owns the job and its state. It registers that state
// here, on globalThis, so a route that must not act mid-scan (an import that
// replaces the database, a restart) can ask without an HTTP call to its own
// server, and gets the same answer however the bundler splits route modules.
//
// The scanner's route runs more than scans: Install, Set up the scanner and
// the LinkedIn sign-in window take the same slot. A refusal says which one is
// running (runningNow): "A scan is running" while Install ran sent people
// looking for a scan that wasn't there.

const KEY = Symbol.for('six-degrees.scan-state');

/** The scanner's state object: the one already registered in this server, or `initial`. */
export function registerScanState(initial) {
  if (!globalThis[KEY]) globalThis[KEY] = initial;
  return globalThis[KEY];
}

/** What the scanner's route is running: its action ('full', 'install', 'setup', 'login', …), or null. */
export function scannerJob() {
  const state = globalThis[KEY];
  if (state?.running !== true) return null;
  return typeof state.action === 'string' && state.action ? state.action : 'scan';
}

/** Is a scan, or the scanner's setup, running in this server? */
export function scanIsRunning() {
  return scannerJob() !== null;
}

/**
 * What is running, in words that start a refusal: "A scan is running", "The
 * scanner is being set up", … `job` is scannerJob()'s answer; `true` (a caller
 * that only knows something runs) reads as a scan.
 */
export function runningNow(job) {
  switch (job) {
    case 'install': return 'The scanner\'s packages are being installed';
    case 'setup': return 'The scanner is being set up';
    case 'login': return 'The LinkedIn sign-in window is open';
    default: return 'A scan is running';
  }
}

/**
 * A refusal while the scanner's route runs something: "<what runs>. <then>",
 * or null when nothing runs.
 */
export function busyRefusal(then, job = scannerJob()) {
  return job ? `${runningNow(job)}. ${then}` : null;
}
