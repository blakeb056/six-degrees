// Whether the scanner is running, for routes other than the one that runs it.
//
// app/api/scraper/route.js owns the job and its state. It registers that state
// here, on globalThis, so a route that must not act mid-scan (an import that
// replaces the database, a restart) can ask without an HTTP call to its own
// server, and gets the same answer however the bundler splits route modules.

const KEY = Symbol.for('six-degrees.scan-state');

/** The scanner's state object: the one already registered in this server, or `initial`. */
export function registerScanState(initial) {
  if (!globalThis[KEY]) globalThis[KEY] = initial;
  return globalThis[KEY];
}

/** Is a scan, or the scanner's setup, running in this server? */
export function scanIsRunning() {
  return globalThis[KEY]?.running === true;
}
