// One-click updates for the Mac app: the work. The decisions are in
// lib/updater.js, and the swap after the app has quit is scripts/apply-update.sh.
//
// A click on "Install and restart" (Settings → Updates) starts one background
// job, which the page polls:
//
//   checking     read releases/latest again. The version is never taken from
//                the page, and a pre-release is never installed.
//   downloading  SHA256SUMS, then the disk image for this Mac's chip
//   verifying    the image's SHA-256 against SHA256SUMS
//   preparing    mount it read-only and check the app inside: its code signature,
//                bundle id, version, macOS minimum and chip, and that no link
//                points outside it. Copy it beside the running app, check the
//                copy the same way, and unmount.
//   restarting   start the helper, then end the server so the app quits
//
// Everything before "restarting" happens while the old version keeps running.
// If any of it fails, or the user cancels, the app stays exactly as it was.
//
// The system tools are called by absolute path, never through PATH, and never
// the developer-tools stubs (lipo, git) that ask to install Xcode's tools on a
// Mac that doesn't have them.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  APP_BUNDLE_NAME, BUNDLE_ID, CHIP_LABEL, GITHUB, UPDATE_HANDOFF_EXIT_CODE,
  chipOf, digestsMatch, foreignAppProcesses, helperArgs, leftoversBeside, machoArchs, parseSha256Sums,
  planFromRelease, relaunchArgs, stagingPath, versionAtLeast,
} from './updater.js';
import { runningNow } from './scan-state.js';

const TOOL = {
  hdiutil: '/usr/bin/hdiutil',
  codesign: '/usr/bin/codesign',
  ditto: '/usr/bin/ditto',
  plutil: '/usr/bin/plutil',
  xattr: '/usr/bin/xattr',
  du: '/usr/bin/du',
  swVers: '/usr/bin/sw_vers',
  sysctl: '/usr/sbin/sysctl',
  ps: '/bin/ps',
};

const USER_AGENT = 'six-degrees-update';
const MB = 1024 * 1024;
const SPACE_MARGIN = 64 * MB;
const ACTIVE = new Set(['checking', 'downloading', 'verifying', 'preparing', 'restarting']);
const CANCELLABLE = new Set(['checking', 'downloading', 'verifying', 'preparing']);

/**
 * A failure with a message fit to show on the Settings page as it is, and a
 * code when the page does something particular about it ('stale-check': offer
 * a new check rather than "Try again").
 */
export class UpdateError extends Error {
  constructor(message, code = null) {
    super(message);
    this.code = code;
  }
}

const CANCELLED = 'cancelled';

/**
 * Where the updater keeps things, none of them in the data folder (DESKTOP.md
 * rule 3) and none in the log the app empties at every start:
 *   cacheDir     ~/Library/Caches/Six Degrees: the previous version, zipped (one copy)
 *   statusFile   …/last-update.json: how the last update went, for the next start
 *   confirmFile  …/update-confirmed.json: the new version saying it has started,
 *                which the helper waits for before it lets go of the old one
 *   logFile      $TMPDIR/six-degrees-update.log: the helper's own log
 */
export function updatePaths({ home = os.homedir(), tmp = os.tmpdir() } = {}) {
  const cacheDir = path.join(home, 'Library', 'Caches', 'Six Degrees');
  return {
    cacheDir,
    statusFile: path.join(cacheDir, 'last-update.json'),
    confirmFile: path.join(cacheDir, 'update-confirmed.json'),
    logFile: path.join(tmp, 'six-degrees-update.log'),
  };
}

/** The status file, or null when there is none or it can't be read. */
export function readStatusFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStatusFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Say, for a helper that is waiting on it, that this version has started
 * (scripts/apply-update.sh keeps the previous version, whole, until it hears
 * this, and puts it back if the new one closes first). Called from GET
 * /api/update, which every page makes (StaleServerBanner), so the first page
 * this version shows is the proof. Only while the status file says an update
 * to exactly this version was handed over and hasn't finished. Returns whether
 * it wrote.
 */
export function confirmStarted({ statusFile, confirmFile }, version) {
  const status = readStatusFile(statusFile);
  if (!status || status.outcome !== 'started' || status.to !== version) return false;
  if (readStatusFile(confirmFile)?.version === version) return false;
  try {
    writeStatusFile(confirmFile, { version, pid: process.pid, at: new Date().toISOString() });
    return true;
  } catch {
    return false; // the helper then keeps waiting, and keeps the new version: nothing is lost
  }
}

/** This Mac's chip and macOS version, asked of the system (lib/updater.js chipOf). */
export function macFacts() {
  const ask = (file, args) => {
    try { return execFileSync(file, args, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return ''; }
  };
  return {
    chip: chipOf({ sysctlArm64: ask(TOOL.sysctl, ['-n', 'hw.optional.arm64']), processArch: process.arch }),
    macosVersion: ask(TOOL.swVers, ['-productVersion']),
  };
}

/** What lib/updater.js bundleRefusal needs to know about the running bundle. */
export function bundleFacts(bundle) {
  if (!bundle) return { exists: false };
  try {
    const st = fs.statSync(bundle);
    let parentWritable = true;
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch { parentWritable = false; }
    return {
      exists: st.isDirectory(),
      parentWritable,
      ownerUid: st.uid,
      uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    };
  } catch {
    return { exists: false };
  }
}

// ── leftovers ────────────────────────────────────────────────────────────────
// An update cut off half-way (the server or the helper killed, the Mac shut
// down) can leave things behind that nothing will ever remove. The next check
// or install removes them: only this app's own names, only once nothing can
// still be using them, and never the previous version a failed update
// couldn't put back, which is the user's to rename.

const HOUR = 3600000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';   // someone else's: alive
  }
}

/**
 * Remove what interrupted updates left: beside the app, the old version moved
 * aside and a new version taken out again, once their helper has ended and ten
 * minutes have passed, and a staged copy after an hour; in the cache, the
 * helper's half-made zips; in TMPDIR, a job's download folder after an hour
 * (unmounting its image first). Returns what it removed. The caller makes sure
 * no update is running in this server.
 */
export function cleanLeftovers({
  bundle, cacheDir, tmpRoot, statusFile, now = Date.now(), isAlive = pidAlive, asideAgeMs = 10 * 60000,
} = {}) {
  const removed = [];
  const age = (st) => now - Math.max(st.mtimeMs, st.ctimeMs);
  const stat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
  const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
  const remove = (p) => {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push(p);
    } catch { /* next time */ }
  };
  const status = statusFile ? readStatusFile(statusFile) : null;
  const theOnlyCopy = status?.outcome === 'failed' && typeof status.previous === 'string' ? path.resolve(status.previous) : null;

  if (bundle) {
    const dir = path.dirname(bundle);
    for (const { name, kind, pid } of leftoversBeside(list(dir), path.basename(bundle))) {
      const p = path.join(dir, name);
      const st = stat(p);
      if (!st || p === theOnlyCopy) continue;
      if (kind === 'incoming') {
        if (age(st) > HOUR) remove(p);
      } else if (!isAlive(pid) && age(st) > asideAgeMs) {
        remove(p);
      }
    }
  }
  if (cacheDir) {
    for (const name of list(cacheDir)) {
      if (!/^\.previous-[A-Za-z0-9]{6}$/.test(name) && !/\.zip\.part$/.test(name)
        && !/^(last-update|update-confirmed)\.json\.\d+\.tmp$/.test(name)) continue;
      const p = path.join(cacheDir, name);
      const st = stat(p);
      if (st && age(st) > HOUR) remove(p);
    }
  }
  if (tmpRoot) {
    for (const name of list(tmpRoot)) {
      if (!/^six-degrees-update-[A-Za-z0-9]{6}$/.test(name)) continue;
      const p = path.join(tmpRoot, name);
      const st = stat(p);
      if (!st || !st.isDirectory() || age(st) <= HOUR) continue;
      const point = path.join(p, 'mnt');
      if (mounted(point)) {
        // A system tool on a mount point found at run time: nothing for the build to trace.
        try { execFileSync(/*turbopackIgnore: true*/ TOOL.hdiutil, ['detach', point, '-force'], { stdio: 'ignore', timeout: 30000 }); } catch { /* checked below */ }
        if (mounted(point)) continue;   // never remove into a mounted image
      }
      remove(p);
    }
  }
  return removed;
}

// ── the job ──────────────────────────────────────────────────────────────────
// One per server process, kept on globalThis so that every route bundle (and a
// reloaded module in development) sees the same one.

const STORE = Symbol.for('six-degrees.update-job');
function store() {
  if (!globalThis[STORE]) globalThis[STORE] = { job: null };
  return globalThis[STORE];
}

/** What the page sees of a job. */
function view(job) {
  if (!job) return null;
  const { id, phase, version, notes, received, total, error, code, startedAt, endedAt } = job;
  return { id, phase, version, notes, received, total, error, code, startedAt, endedAt };
}

/** The current (or last) job, for update-status and the Settings page. */
export function currentUpdate() {
  return view(store().job);
}

/** Is a job running (up to and including "restarting")? */
export function updateActive() {
  const job = store().job;
  return Boolean(job && ACTIVE.has(job.phase));
}

/**
 * The version the last "Check for updates" offered, on this server. Install
 * installs exactly that one: if a newer release has come out since, it stops
 * and asks for a new check rather than install something nobody was shown.
 * Kept here, never taken from the page.
 */
export function rememberCheck(version) {
  store().checked = version ? String(version) : null;
}
export function checkedVersion() {
  return store().checked || null;
}

/**
 * Start installing the newest release. Returns { job } at once; the work runs
 * in the background. `done` settles when the job stops (tests wait for it).
 * Refused with { error } while another job is running.
 */
export function startUpdate(ctx) {
  const s = store();
  if (s.job && ACTIVE.has(s.job.phase)) {
    return { error: 'An update is already in progress.', job: view(s.job) };
  }
  const job = {
    id: randomUUID(),
    phase: 'checking',
    version: null,
    notes: null,
    received: 0,
    total: null,
    error: null,
    code: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    ctrl: new AbortController(),
  };
  s.job = job;
  const done = runUpdate(job, ctx);
  return { job: view(job), done };
}

/** Stop a job that hasn't reached "restarting". Nothing is left behind. */
export function cancelUpdate() {
  const job = store().job;
  if (job && CANCELLABLE.has(job.phase)) job.ctrl.abort(new UpdateError(CANCELLED));
  return view(job);
}

/** Forget the job and the last check (tests only). */
export function _resetUpdateForTesting() {
  store().job = null;
  store().checked = null;
}

function run(file, args, { signal, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { signal, timeout: timeoutMs, maxBuffer: 8 * MB }, (err, stdout, stderr) => {
      if (err) {
        const said = String(stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' ');
        err.detail = said || err.message;
        reject(err);
        return;
      }
      resolve(String(stdout));
    });
  });
}

const mb = (bytes) => Math.max(1, Math.round(bytes / MB));

function ensureSpace(dir, needed, where) {
  let free;
  try {
    const s = fs.statfsSync(dir);
    free = s.bavail * s.bsize;
  } catch {
    return; // can't tell; the copy itself will fail plainly if the disk is full
  }
  if (free < needed) {
    throw new UpdateError(`There isn't enough free space ${where}: the update needs about ${mb(needed)} MB, and ${mb(free)} MB is free.`);
  }
}

async function fetchWithin(url, c, signal, ms, accept) {
  return c.fetchImpl(url, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]),
    cache: 'no-store',
    redirect: 'follow',
  });
}

/**
 * Download to `file`, hashing as it arrives. It gives up when nothing has
 * arrived for `idleMs`, not after a fixed total: the image is about 220 MB, and
 * a slow connection that is still moving is fine.
 */
async function download(url, file, { job, c, signal, expectedSize }) {
  const idle = new AbortController();
  const both = AbortSignal.any([signal, idle.signal]);
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new UpdateError(
      `The download stopped for ${Math.round(c.idleMs / 1000)} seconds. Check your connection and try again.`,
    )), c.idleMs);
  };
  arm();
  const fh = await fsp.open(file, 'w');
  const hash = createHash('sha256');
  let received = 0;
  try {
    const res = await c.fetchImpl(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
      signal: both,
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok || !res.body) throw new UpdateError(`GitHub answered ${res.status} to the download. Try again later.`);
    const header = Number(res.headers.get('content-length')) || null;
    if (expectedSize && header && header !== expectedSize) {
      throw new UpdateError('The download is not the size GitHub listed for it, so it was stopped.');
    }
    const total = header || expectedSize || null;
    job.total = total;
    const limit = total || c.maxBytes;
    for await (const chunk of res.body) {
      arm();
      received += chunk.byteLength;
      if (received > limit) throw new UpdateError('The download is bigger than GitHub said it would be, so it was stopped.');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await fh.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
      job.received = received;
    }
    if (total && received !== total) throw new UpdateError('The download ended early. Try again.');
    return hash.digest('hex');
  } catch (err) {
    // Say why it stopped (cancelled, or nothing arriving), not "aborted".
    if (both.aborted && both.reason instanceof Error) throw both.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    await fh.close();
  }
}

/** Mount read-only, out of sight, at `mount.point`; notes the device for detach(). */
async function attach(image, mount, signal) {
  await fsp.mkdir(mount.point, { recursive: true });
  let out;
  try {
    out = await run(TOOL.hdiutil, ['attach', image, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount.point, '-plist'],
      { signal, timeoutMs: 180000 });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new UpdateError(`The disk image wouldn't open (${err.detail}).`);
  }
  const devices = [...out.matchAll(/<key>dev-entry<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  mount.device = devices.find((d) => /^\/dev\/disk\d+$/.test(d)) || null;
}

function mounted(point) {
  try {
    return fs.statSync(point).dev !== fs.statSync(path.dirname(point)).dev;
  } catch {
    return false;
  }
}

/**
 * Unmount, patiently. Right after use, Spotlight or Finder can hold a volume
 * for a moment and hdiutil says "Resource busy"; and once the volume is gone,
 * only the disk device may be left to eject (TRAPS §28, build-app.mjs detach).
 * Safe to call when nothing was mounted: an attach that was cancelled half-way
 * may or may not have mounted the image, so this looks rather than assumes.
 */
async function detach({ point, device }, sleep) {
  const tries = [[], [], ['-force'], ['-force'], ['-force']];
  let last = null;
  for (let i = 0; i < tries.length; i++) {
    const volume = mounted(point);
    if (!volume && (!device || !fs.existsSync(device))) return;
    try {
      await run(TOOL.hdiutil, ['detach', volume ? point : device, ...tries[i]], { timeoutMs: 60000 });
      return;
    } catch (err) {
      last = err;
      await sleep(1000 * (i + 1));
    }
  }
  if (!mounted(point) && (!device || !fs.existsSync(device))) return;
  throw last;
}

/** The first link inside `root` that points outside it, or null (TRAPS §37). */
async function linkOutside(root) {
  const entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isSymbolicLink()) continue;
    const at = path.join(e.parentPath ?? e.path, e.name);
    const to = await fsp.readlink(at);
    const resolved = path.resolve(path.dirname(at), to);
    if (path.isAbsolute(to) || (resolved !== root && !resolved.startsWith(root + path.sep))) {
      return `${path.relative(root, at)} → ${to}`;
    }
  }
  return null;
}

async function readHead(file, bytes = 4096) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Is this the app it should be? Its signature verifies strictly (what CI
 * checks, release.yml), it is Six Degrees at exactly the release's version, it
 * runs on this macOS and this chip, and every link stays inside it.
 */
async function checkApp(app, { plan, c, signal, where }) {
  const st = await fsp.lstat(app).catch(() => null);
  if (!st || !st.isDirectory()) throw new UpdateError(`The disk image doesn't contain ${APP_BUNDLE_NAME}.`);
  try {
    await run(TOOL.codesign, ['--verify', '--deep', '--strict', app], { signal, timeoutMs: 300000 });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new UpdateError(`The new version's signature doesn't check out ${where} (${err.detail}), so it wasn't used.`);
  }
  const plist = path.join(app, 'Contents', 'Info.plist');
  const read = (key) => run(TOOL.plutil, ['-extract', key, 'raw', '-o', '-', plist], { signal, timeoutMs: 15000 })
    .then((s) => s.trim()).catch(() => '');
  const [id, version, minimum, executable] = await Promise.all([
    read('CFBundleIdentifier'), read('CFBundleShortVersionString'), read('LSMinimumSystemVersion'), read('CFBundleExecutable'),
  ]);
  if (id !== c.bundleId) {
    throw new UpdateError(`The download isn't Six Degrees (it calls itself ${id || 'nothing'}), so it wasn't used.`);
  }
  if (version !== plan.version) {
    throw new UpdateError(`The download says it is version ${version || '(none)'}, not ${plan.version}, so it wasn't used.`);
  }
  if (minimum && c.macosVersion && !versionAtLeast(c.macosVersion, minimum)) {
    throw new UpdateError(`Version ${plan.version} needs macOS ${minimum} or later, and this Mac has ${c.macosVersion}.`);
  }
  // The chip, from the executable itself. The classic app's executable is a
  // bash script, so for it the bundled Node binary is the one that tells.
  const candidates = [
    executable && !executable.includes('/') ? path.join(app, 'Contents', 'MacOS', executable) : null,
    path.join(app, 'Contents', 'Resources', 'node'),
  ].filter(Boolean);
  for (const file of candidates) {
    const archs = machoArchs(await readHead(file).catch(() => null));
    if (!archs.size) continue;
    if (!archs.has(c.chip)) {
      throw new UpdateError(`The download is built for ${[...archs].map((a) => CHIP_LABEL[a] || a).join(' and ')} Macs, not this one, so it wasn't used.`);
    }
    break;
  }
  const escaping = await linkOutside(app);
  if (escaping) throw new UpdateError(`The new version has a link that points outside it (${escaping}), so it wasn't used.`);
}

/**
 * The helper's whole environment: nothing of this process's (test switches
 * included) but the system's own tools, the user, and a UTF-8 locale. Without
 * the locale, ps and lsof write a path that isn't plain ASCII as escapes, and
 * the helper can't find the app's processes in, say, "Programmes Été" (TRAPS
 * §40). tests/apply-update.test.mjs runs the helper with exactly this.
 */
export function helperEnv() {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: os.homedir(),
    TMPDIR: os.tmpdir(),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ...(process.env.USER ? { USER: process.env.USER, LOGNAME: process.env.USER } : {}),
  };
}

/**
 * Other users' processes running the app at `bundle` (lib/updater.js
 * foreignAppProcesses). An app someone else has open can't be stopped by this
 * user, so it is never replaced from under them.
 */
export function othersRunningApp(bundle) {
  if (!bundle || typeof process.getuid !== 'function') return [];
  let out = '';
  try {
    out = execFileSync(TOOL.ps, ['-axo', 'uid=,pid=,comm='], {
      timeout: 10000, maxBuffer: 16 * MB, stdio: ['ignore', 'pipe', 'ignore'], env: helperEnv(),
    }).toString();
  } catch {
    return [];
  }
  let real = bundle;
  try { real = fs.realpathSync(bundle); } catch { /* the path as given */ }
  return foreignAppProcesses(out, { bundles: [bundle, real], uid: process.getuid() });
}

/**
 * Start the helper on its own, outside the app: its own session (so it
 * outlives the app), its working folder in TMPDIR (so it is never inside the
 * bundle it replaces), a clean environment (helperEnv), and its output in the
 * update log. Resolves with the running child once it has started.
 */
export function launchHelper({ helper, args, cwd, logFile }) {
  const env = helperEnv();
  const out = fs.openSync(logFile, 'w');
  try {
    const child = spawn('/bin/bash', [helper, ...args], { cwd, env, detached: true, stdio: ['ignore', out, out] });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(child); });
    });
  } finally {
    fs.closeSync(out);
  }
}

/**
 * End this server with the code the Mac app reads as "quit quietly"
 * (desktop/lib.mjs serverExitAction). Not a SIGTERM to itself: Next catches
 * that and exits with 143, which says "stopped from outside" (TRAPS §39).
 * The pause lets the page's next poll see "restarting". The helper is already
 * running, and waits for the app to be gone before it touches anything.
 */
function exitForUpdate() {
  setTimeout(() => process.exit(UPDATE_HANDOFF_EXIT_CODE), 1200);
}

// Next wraps the global fetch to cache what pages fetch. This download is no
// page's business, outlives the click that started it, and is about 220 MB, so use
// the fetch underneath when Next says which one that is.
const plainFetch = (...args) => (globalThis.fetch?._nextOriginalFetch || globalThis.fetch)(...args);

const DEFAULTS = {
  bundleId: BUNDLE_ID,
  // GitHub, unless the route passes lib/updater.js releaseSource()'s loopback
  // test address. Tests point both at a server on 127.0.0.1 the same way.
  apiBase: GITHUB.apiBase,
  downloadBase: GITHUB.downloadBase,
  idleMs: 30000,
  maxBytes: 1024 * MB,
  waitSeconds: 30,
  // How long the helper waits for the new version to say it has started before
  // it lets go of the old one anyway (it only waits that long if the new
  // version keeps running without a page loading).
  confirmWaitSeconds: 600,
  // How long the helper must stay up before the app quits for it. It spends
  // its first seconds waiting for the app to go, so one that has already ended
  // was given something it refused, and the app stays open to say so.
  settleMs: 400,
  // What the scanner's route is running (lib/scan-state.js scannerJob), or null.
  scanRunning: () => null,
  othersRunning: () => [],
  launch: launchHelper,
  exit: exitForUpdate,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Another user of this Mac has the app open: this user can't stop their copy,
// and swapping the app from under it would break it. Asked before the download
// and again just before the hand-over.
function othersCheck(c) {
  if (c.othersRunning().length) {
    throw new UpdateError('Another user of this Mac has Six Degrees open, so it can\'t be replaced now. Try again once they have quit it.');
  }
}

function plain(err) {
  if (err instanceof UpdateError) return err.message;
  if (err?.name === 'TimeoutError') return "GitHub didn't answer in time. Try again in a moment.";
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return `Could not reach GitHub (${err.cause?.code || err.cause?.message || 'no connection'}). Check your connection and try again.`;
  }
  return `The update stopped: ${err?.detail || err?.message || err}.`;
}

/** The last few lines the helper wrote, to say why it stopped. */
function logTail(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-2).join(' ').replace(/^\S+ \S+ {2}/, '');
  } catch {
    return '';
  }
}

/**
 * The job itself. `c` (the context) comes from the route, which works out
 * every value on the server:
 *   slug, currentVersion, chip, macosVersion       this copy and this Mac
 *   bundle                                         the running app (lib/updater.js runningBundle)
 *   dataDir                                        to reopen it on the same data
 *   helper                                         scripts/apply-update.sh inside the running app
 *   tmpRoot, cacheDir, statusFile, confirmFile,    lib/updater-job.js updatePaths
 *   logFile
 *   apiBase, downloadBase                          lib/updater.js releaseSource
 *   pids                                           the app's processes the helper waits for
 *   expectVersion                                  the version the last check offered
 *   othersRunning                                  other users' processes running the app
 *   fetchImpl, scanRunning, launch, exit, …        see DEFAULTS
 */
async function runUpdate(job, ctx) {
  const c = { fetchImpl: plainFetch, ...DEFAULTS, ...ctx };
  const { signal } = job.ctrl;
  const set = (patch) => Object.assign(job, patch);
  let work = null;
  let mount = null;
  let staged = null;
  let handedOver = false;
  // Quitting the app mid-update ends this process mid-job (Next exits on the
  // SIGTERM the app sends it). Leave nothing behind then either: not a mounted
  // image, and not a half-copied app hidden beside the real one. Synchronous,
  // because nothing asynchronous runs once a process is exiting.
  const onExit = () => {
    if (handedOver) return;
    if (mount && mounted(mount.point)) {
      // A system tool on a mount point made at run time: nothing for the build to trace.
      try { execFileSync(/*turbopackIgnore: true*/ TOOL.hdiutil, ['detach', mount.point, '-force'], { stdio: 'ignore', timeout: 15000 }); } catch { /* best effort */ }
    }
    for (const dir of [staged, work]) {
      if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
  process.once('exit', onExit);
  try {
    // ── checking ──
    const res = await fetchWithin(`${c.apiBase}/repos/${c.slug}/releases/latest`, c, signal, 15000, 'application/vnd.github+json');
    if (res.status === 404) throw new UpdateError('No release has been published yet.');
    if (!res.ok) throw new UpdateError(`GitHub answered ${res.status}. Try again in a moment.`);
    const { plan, refusal } = planFromRelease(await res.json(), {
      currentVersion: c.currentVersion, chip: c.chip, slug: c.slug, downloadBase: c.downloadBase,
    });
    if (refusal) throw new UpdateError(refusal.message);
    // Exactly the version the page offered, or nothing: a release newer than
    // that is something nobody has seen yet, not what they clicked to install.
    if (c.expectVersion && plan.version !== c.expectVersion) {
      throw new UpdateError(
        `Version ${plan.version} has come out since you checked, and you were offered ${c.expectVersion}. Check again, then install.`,
        'stale-check',
      );
    }
    set({ version: plan.version, notes: plan.notes, total: plan.dmg.size });
    othersCheck(c);

    work = await fsp.mkdtemp(path.join(c.tmpRoot, 'six-degrees-update-'));
    // GitHub always lists the size; the fallback is well above any release (about
    // 220 MB with the scanner's Python inside), so a missing one never lets a
    // download start on a disk that can't hold it.
    ensureSpace(c.tmpRoot, (plan.dmg.size || 512 * MB) + SPACE_MARGIN, 'for the download');

    // ── downloading ──
    set({ phase: 'downloading' });
    const sumsRes = await fetchWithin(plan.sums.url, c, signal, 30000, 'text/plain, application/octet-stream');
    if (!sumsRes.ok) throw new UpdateError(`GitHub answered ${sumsRes.status} for the checksum file. Try again later.`);
    const tooBig = () => new UpdateError('The checksum file is not what was expected, so nothing was downloaded.');
    if (Number(sumsRes.headers.get('content-length')) > 64 * 1024) throw tooBig();
    const sumsText = await sumsRes.text();
    if (sumsText.length > 64 * 1024) throw tooBig();
    const want = parseSha256Sums(sumsText).get(plan.dmg.name);
    if (!want) throw new UpdateError(`The checksum file doesn't list ${plan.dmg.name}, so its download can't be checked.`);
    // A file made at run time, never one of the app's: nothing for the build to trace.
    const image = path.join(/*turbopackIgnore: true*/ work, plan.dmg.name);
    const got = await download(plan.dmg.url, `${image}.part`, { job, c, signal, expectedSize: plan.dmg.size });

    // ── verifying ──
    set({ phase: 'verifying' });
    if (!digestsMatch(want, got)) {
      throw new UpdateError("The download doesn't match the checksum published with it, so it wasn't used. Try again later.");
    }
    await fsp.rename(`${image}.part`, image);

    // ── preparing ──
    set({ phase: 'preparing' });
    // Noted before attaching, so a cancel in the middle still unmounts it.
    mount = { point: path.join(work, 'mnt'), device: null };
    await attach(image, mount, signal);
    const inImage = path.join(mount.point, APP_BUNDLE_NAME);
    await checkApp(inImage, { plan, c, signal, where: 'in the disk image' });
    const kb = Number.parseInt(await run(TOOL.du, ['-sk', inImage], { signal, timeoutMs: 120000 }), 10) || 0;
    ensureSpace(path.dirname(c.bundle), kb * 1024 + SPACE_MARGIN, `in ${path.dirname(c.bundle)}`);
    staged = stagingPath(c.bundle);
    await fsp.rm(staged, { recursive: true, force: true }); // a copy left by an update that was interrupted
    try {
      // ditto, never cpSync, which rewrites Electron's links into absolute paths (TRAPS §37).
      await run(TOOL.ditto, [inImage, staged], { signal, timeoutMs: 900000 });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new UpdateError(`Could not copy the new version into ${path.dirname(c.bundle)} (${err.detail}).`);
    }
    await checkApp(staged, { plan, c, signal, where: 'after copying' });
    await run(TOOL.xattr, ['-dr', 'com.apple.quarantine', staged], { signal }).catch(() => {});
    await detach(mount, c.sleep);
    mount = null;
    await fsp.rm(image, { force: true });

    // ── restarting ──
    // A last look: a scan, or Install on the Scan page, may have started while
    // this ran. Quitting now would stop it half-way, so leave the app alone and
    // say which one it was.
    if (signal.aborted) throw signal.reason;
    const busy = await c.scanRunning();
    if (busy) {
      throw new UpdateError(`${runningNow(busy)}, so the update was not applied. Try again when it has finished.`);
    }
    othersCheck(c);
    if (signal.aborted) throw signal.reason;
    set({ phase: 'restarting' }); // from here it can't be cancelled

    const helper = path.join(work, 'apply-update.sh');
    await fsp.copyFile(c.helper, helper); // run a copy: the original is inside the app it replaces
    const args = helperArgs({
      target: c.bundle,
      staged,
      keepDir: c.cacheDir,
      statusFile: c.statusFile,
      from: c.currentVersion,
      to: plan.version,
      pids: c.pids || [process.ppid, process.pid],
      waitSeconds: c.waitSeconds,
      logFile: c.logFile,
      work,
      confirmFile: c.confirmFile,
      confirmWaitSeconds: c.confirmWaitSeconds,
      relaunch: relaunchArgs({ dataDir: c.dataDir }),
    });
    // Written first: the helper replaces it with the outcome, and if it never
    // gets that far, the next start says so instead of saying nothing.
    const started = { outcome: 'started', from: c.currentVersion, to: plan.version, at: new Date().toISOString(), log: c.logFile };
    try { writeStatusFile(c.statusFile, started); } catch { /* a courtesy; the update doesn't depend on it */ }
    let child;
    try {
      child = await c.launch({ helper, args, cwd: c.tmpRoot, logFile: c.logFile });
      await c.sleep(c.settleMs);
    } catch (err) {
      fs.rmSync(c.statusFile, { force: true });
      throw new UpdateError(`The update helper wouldn't start (${err.message}).`);
    }
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      fs.rmSync(c.statusFile, { force: true });
      const said = logTail(c.logFile);
      throw new UpdateError(`The update helper stopped before the app closed${said ? ` (${said})` : ''}.`);
    }
    // From here the helper waits for this app to go, so the app must quit.
    handedOver = true;
    c.exit();
  } catch (err) {
    const cancelled = signal.aborted && signal.reason instanceof UpdateError && signal.reason.message === CANCELLED;
    set({
      phase: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? null : plain(err),
      code: !cancelled && err instanceof UpdateError ? err.code : null,
    });
  } finally {
    if (mount) await detach(mount, c.sleep).catch(() => {});
    if (!handedOver) {
      if (staged) await fsp.rm(staged, { recursive: true, force: true }).catch(() => {});
      if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
    process.removeListener('exit', onExit);
    set({ endedAt: new Date().toISOString() });
  }
}
