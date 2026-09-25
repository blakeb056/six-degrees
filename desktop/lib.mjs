// The desktop app's decisions that don't need Electron, kept here so the tests
// can run them directly (tests/desktop.test.mjs). main.mjs wires them up.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Is this URL one of the app's own pages (same scheme, host and port as its server)? */
export function isAppUrl(url, origin) {
  if (!origin) return false;
  try {
    // A blob: URL made by the app's own page reports that page's origin.
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** May this URL go to the user's own browser? Ordinary web links only. */
export function isExternalWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * What to do with a link the page opens or follows:
 *   'app'      one of the app's own pages: stays in the app
 *   'browser'  a web link (LinkedIn above all): the user's own browser. LinkedIn
 *              loaded inside the app would be a second, signed-out browser
 *              (DESKTOP.md rule 7)
 *   'block'    anything else (file:, javascript:, custom schemes)
 */
export function routeFor(url, origin) {
  if (isAppUrl(url, origin)) return 'app';
  if (isExternalWebUrl(url)) return 'browser';
  return 'block';
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** The first port from `from` to `to` that nothing is using, like the old launcher's walk. */
export async function findFreePort(from = 6363, to = 6399, host = '127.0.0.1') {
  for (let port = from; port <= to; port++) {
    if (await portIsFree(port, host)) return port;
  }
  throw new Error(`No free port between ${from} and ${to}.`);
}

/** Wait until the server answers; give up early if its process has died. */
export async function waitForServer(origin, { timeoutMs = 60000, isAlive = () => true, fetchImpl = fetch, sleep = sleepFor } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('The app\'s server stopped while it was starting.');
    try {
      const res = await fetchImpl(`${origin}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await sleep(300);
  }
  throw new Error(`The app's server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
}

/** Is a scan (or the scanner's setup) running? null when the server can't be asked. */
export async function scanRunning(origin, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${origin}/api/scraper`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return Boolean((await res.json()).running);
  } catch {
    return null;
  }
}

/**
 * Stop a running scan the way the Stop button does, then wait until it has
 * stopped: the scanner closes its own Chrome window when it is asked to stop.
 * Resolves 'none' (nothing was running), 'stopped', or 'timeout'.
 */
export async function stopScan(origin, { timeoutMs = 25000, fetchImpl = fetch, sleep = sleepFor } = {}) {
  if ((await scanRunning(origin, { fetchImpl })) !== true) return 'none';
  try {
    await fetchImpl(`${origin}/api/scraper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* the check below decides */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await scanRunning(origin, { fetchImpl })) !== true) return 'stopped';
    await sleep(500);
  }
  return 'timeout';
}

/** Stop a child process: SIGTERM, then SIGKILL after `graceMs`. Resolves once it has exited. */
export function stopProcess(child, { graceMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', done);
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, graceMs);
    try { child.kill('SIGTERM'); } catch { done(); }
  });
}

/**
 * A data folder asked for on the command line: `--data-dir PATH` or
 * `--data-dir=PATH`. It lets a beta run against a copy of the data:
 *   open "Six Degrees.app" --args --data-dir ~/six-degrees-copy
 *
 * Made absolute here. The server runs in its own folder inside the app, so a
 * relative path handed to it as it is would name a different folder, and a
 * new, empty network. A relative path is taken from the folder the app was
 * started in, except /: `open` and the Finder start every app in /, which
 * can't hold a folder, so there it is taken from the home folder. A leading ~
 * is the home folder, as the shell would have made it (it doesn't after =).
 */
export function dataDirArg(argv = [], { cwd = process.cwd(), home = os.homedir() } = {}) {
  let value = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg.startsWith('--data-dir=')) {
      value = arg.slice('--data-dir='.length);
      break;
    }
    if (arg === '--data-dir' && argv[i + 1]) {
      value = String(argv[i + 1]);
      break;
    }
  }
  if (!value) return null;
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  return path.resolve(cwd === '/' ? home : cwd, expanded);
}
