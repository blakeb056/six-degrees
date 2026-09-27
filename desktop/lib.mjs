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
 * What the Scan page is running: its action ('full', 'install', 'setup',
 * 'login', …), or null when nothing runs or the server can't be asked.
 */
export async function runningJob(origin, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${origin}/api/scraper`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const status = await res.json();
    if (!status.running) return null;
    return typeof status.action === 'string' && status.action ? status.action : 'scan';
  } catch {
    return null;
  }
}

/**
 * The question Quit asks while the Scan page runs something, in the words of
 * what runs: Install and Set up the scanner aren't scans, and saying "A scan is
 * running" over them sent people looking for one (the server's refusals say
 * the same, lib/scan-state.js). { message, detail, buttons }: the first button
 * quits, the second keeps it going.
 */
export function quitQuestion(job) {
  if (job === 'install' || job === 'setup') {
    return {
      message: job === 'setup' ? 'The scanner is being set up.' : 'The scanner\'s packages are being installed.',
      detail: 'Quitting stops it the way the Stop button does. Press the same button on the Scan page next time to finish it.',
      buttons: ['Stop It and Quit', 'Keep Going'],
    };
  }
  if (job === 'login') {
    return {
      message: 'The LinkedIn sign-in window is open.',
      detail: 'Quitting closes it the way the Stop button does. If you hadn\'t finished signing in, open LinkedIn from the Scan page again next time.',
      buttons: ['Close It and Quit', 'Keep It Open'],
    };
  }
  return {
    message: 'A scan is running.',
    detail: 'Quitting stops it the way the Stop button does, and it closes its Chrome window. A list that was stopped part-way carries on from where it got to next time.',
    buttons: ['Stop the Scan and Quit', 'Keep Scanning'],
  };
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
 * The app bundle, from the path of its own executable (process.execPath in
 * Electron's main process):
 * "/Applications/Six Degrees.app/Contents/MacOS/Six Degrees" → "/Applications/Six Degrees.app".
 * null when it isn't running from a bundle (npm run desktop, from a checkout).
 */
export function bundlePathFromExe(exe) {
  const m = String(exe || '').match(/^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : null;
}

/**
 * The page to open first. After an update the new version (or the old one,
 * put back) is opened with --after-update, and opens Settings, where the
 * outcome is shown, rather than the map.
 */
export function startPathArg(argv = []) {
  return argv.includes('--after-update') ? '/settings#updates' : null;
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

/**
 * The exit code with which the server asks to be started again, to finish an
 * import (Settings → Your data). main.mjs hands it to the server as
 * SIX_DEGREES_RESTART_CODE, so only a shell that knows it offers the button.
 * 75 is EX_TEMPFAIL: "try again". Next ends with 143 on SIGTERM, so a signal
 * can never be mistaken for it.
 */
export const RESTART_EXIT_CODE = 75;

/**
 * The exit code with which the server hands over to the in-app updater
 * (Settings → Updates → Install and restart): its helper takes it from there,
 * and the app quits quietly. Reserved here with the updater's own number, so
 * the shell reads every code the same way whichever feature is in.
 */
export const UPDATE_HANDOFF_EXIT_CODE = 76;

/**
 * Next's server catches SIGTERM and SIGINT and ends with 143 or 130
 * (next/dist/server/lib/start-server.js). So a server stopped from outside
 * (the installer replacing this copy, logging out) arrives as one of these
 * codes, not as a signal; only a signal Next doesn't catch (SIGKILL) arrives
 * as one.
 */
const STOPPED_FROM_OUTSIDE = [143, 130];

/**
 * What the shell does when its server ends:
 *   'ignore'   the app is quitting anyway
 *   'quit'     stopped from outside (a signal, or Next's 143 or 130), or handed
 *              over to the updater (76): the whole app is going, so go quietly
 *   'restart'  it asked to be started again (75), to finish an import
 *   'report'   any other exit: a crash, said out loud
 *
 * `answered` says whether that server ever answered the shell. Restart now is
 * a click on a page the server served, so a server that asks to be restarted
 * before it has answered once can't be doing it for a person: it can't stay
 * up, and is reported rather than started forever. One that answered is
 * restarted however soon after the last restart, so trying again after an
 * import that stopped (the page says why) is never a crash.
 */
export function serverExitAction({ code, signal, quitting = false, answered = true }) {
  if (quitting) return 'ignore';
  if (signal) return 'quit';
  if (code === UPDATE_HANDOFF_EXIT_CODE || STOPPED_FROM_OUTSIDE.includes(code)) return 'quit';
  if (code === RESTART_EXIT_CODE) return answered ? 'restart' : 'report';
  return 'report';
}
