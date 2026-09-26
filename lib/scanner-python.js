// The Python the scanner runs on, and where it comes from (docs/brain/DESKTOP.md D2).
//
// In this order:
//   1. The Mac app's own. A standalone CPython 3.12 with the scanner's packages
//      already installed ships inside the app (Contents/Resources/python), and
//      the app names it in SIX_DEGREES_PYTHON. Nothing to install, and it works
//      offline.
//   2. The scanner's own environment in the data folder (venv/), which the Scan
//      page's Install builds, or a Python on this computer that already has the
//      packages (someone who set it up by hand).
//   3. For Install, something to build that environment from: a Python 3.10 to
//      3.14 on this computer, or else a standalone CPython in the data folder
//      (python/), which the Scan page's "Set up the scanner" downloads when the
//      computer has no Python the scanner can use: `npx six-degrees` on Linux,
//      or on a Mac without the app. Only on that click, only the file pinned
//      below for this computer, and it is checked against its SHA-256 before
//      anything is unpacked. The packages then come from PyPI, pinned by hash
//      in scripts/requirements.txt.
//
// scripts/build-app.mjs uses the same pins for the Python inside the app. What
// can be decided without a process or a network is here, so
// tests/scanner-python.test.mjs can check it offline.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chipOf } from './updater.js';
import { SETUP_WORK_PREFIX } from './data-folder.js';

/**
 * The standalone CPython: python-build-standalone's release (a date), the
 * CPython in it, and one file per computer, with its SHA-256 and size from that
 * release's SHA256SUMS (checked against the files themselves on 2026-09-25).
 * The Mac files are the "install_only" builds the app bundles. The Linux ones
 * are "install_only_stripped": the same build without debug symbols, 33 MB to
 * download instead of 104 (on a Mac, stripping saves 0.2 MB).
 *
 * To move to a newer one: take the new release's SHA256SUMS lines for these
 * four names, and each file's size, and change all of them together.
 */
export const STANDALONE_PYTHON = Object.freeze({
  release: '20260814',
  version: '3.12.14',
  builds: Object.freeze({
    'darwin-arm64': Object.freeze({
      file: 'cpython-3.12.14+20260814-aarch64-apple-darwin-install_only.tar.gz',
      sha256: '4572133a5542f306b9bdb155da5800f9e38950cd0a98d469b832ce256fe299ea',
      size: 25151480,
    }),
    'darwin-x64': Object.freeze({
      file: 'cpython-3.12.14+20260814-x86_64-apple-darwin-install_only.tar.gz',
      sha256: '1a94c83264731e9603fbea78e57e7ca8f20e7d91eb866627ac2304621b0f6f1f',
      size: 24839099,
    }),
    'linux-x64': Object.freeze({
      file: 'cpython-3.12.14+20260814-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
      sha256: '5acfa3e9ba26b51ae161c83aff278da915b590d22373a424b2ba55b8afe91fcc',
      size: 34143739,
    }),
    'linux-arm64': Object.freeze({
      file: 'cpython-3.12.14+20260814-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz',
      sha256: '2d8e17dfd732102cfeb18e0e1fa6769b24caa034e159981129590fe409c7157a',
      size: 29217771,
    }),
  }),
});

/** GitHub's release downloads for python-build-standalone: the one place the Python comes from. */
export const STANDALONE_BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download';

/** The download address of a pinned build ("+" in its name is %2B, as GitHub lists it). */
export function standaloneUrl(build, pin = STANDALONE_PYTHON) {
  return `${STANDALONE_BASE}/${pin.release}/${encodeURIComponent(build.file)}`;
}

/**
 * This computer, as a key of STANDALONE_PYTHON.builds, or null when there is
 * no build for it (Windows, 32-bit, other chips).
 *
 * On a Mac the chip is the hardware's (`hw.optional.arm64`, as install.sh and
 * the updater ask), not this process's: Node running under Rosetta calls itself
 * x64 on Apple Silicon (TRAPS §30), and the scanner would then run translated.
 */
export function hostKey({ platform = process.platform, arch = process.arch, sysctlArm64 = '' } = {}) {
  if (platform === 'darwin') return `darwin-${chipOf({ sysctlArm64, processArch: arch })}`;
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return `linux-${arch}`;
  return null;
}

/** hostKey() for the computer this runs on. */
export function thisHostKey() {
  let sysctlArm64 = '';
  if (process.platform === 'darwin') {
    try {
      sysctlArm64 = execFileSync('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'],
        { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch { /* an Intel Mac has no such key */ }
  }
  return hostKey({ sysctlArm64 });
}

/** The pinned build for a hostKey(), with its address, or null. */
export function standaloneBuild(key, pin = STANDALONE_PYTHON) {
  const build = key && Object.hasOwn(pin.builds, key) ? pin.builds[key] : null;
  return build ? { key, version: pin.version, release: pin.release, ...build, url: standaloneUrl(build, pin) } : null;
}

/**
 * Which Python on this computer Install may build the scanner's environment
 * from. The pinned packages (scripts/requirements.txt) have wheels for CPython
 * 3.10 to 3.14 and nothing is built from source, so an older Python can't
 * install them (Playwright needs 3.10) and a newer one has nothing to install.
 */
export const SYSTEM_PYTHON = Object.freeze({ min: [3, 10], max: [3, 14] });

/**
 * The names a Python on this computer goes by, in the order they are tried.
 * /usr/bin/python3 first, as before: on a Mac it is often the one that already
 * has the packages (TRAPS §14). The numbered names find a Homebrew or deadsnakes
 * Python whose `python3` points elsewhere; a name that isn't there costs nothing.
 */
export const SYSTEM_CANDIDATES = Object.freeze([
  '/usr/bin/python3', 'python3', 'python',
  'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10',
]);

/** Is "3.12.4" a Python the pinned packages install into? */
export function systemPythonFits(version, range = SYSTEM_PYTHON) {
  const m = String(version || '').match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2])];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);
  return cmp(v, range.min) >= 0 && cmp(v, range.max) <= 0;
}

// Load the compiled parts, not just the package names. `import PIL` succeeds even
// when its C extension is built for the other chip; `from PIL import Image` is
// what fails (TRAPS §30).
export const IMPORTS = 'import requests; from PIL import Image; from playwright.sync_api import sync_playwright';

/**
 * One look at a Python: its version, whether it can make an environment
 * (venv and ensurepip: Debian and Ubuntu leave them out until python3-venv is
 * installed), and whether the scanner's packages load, with the reason when
 * they don't. One process instead of one per question.
 */
export const PROBE_SCRIPT = [
  'import sys',
  'print("version %d.%d.%d" % sys.version_info[:3])',
  'try:',
  '    import venv, ensurepip',
  '    print("venv")',
  'except Exception:',
  '    pass',
  'try:',
  `    ${IMPORTS}`,
  '    print("imports")',
  'except Exception as e:',
  '    print("missing %s: %s" % (type(e).__name__, (str(e).splitlines() or [""])[0][:200]))',
].join('\n');

/** What PROBE_SCRIPT printed, as { version, venv, imports, missing }. */
export function parseProbe(stdout) {
  const out = { version: null, venv: false, imports: false, missing: null };
  for (const line of String(stdout || '').split('\n').map((l) => l.trim())) {
    if (line.startsWith('version ')) out.version = line.slice(8).trim() || null;
    else if (line === 'venv') out.venv = true;
    else if (line === 'imports') out.imports = true;
    else if (line.startsWith('missing ')) out.missing = line.slice(8).trim() || null;
  }
  return out;
}

/**
 * How the app's own Python starts: the one inside the Mac app, one named in
 * SIX_DEGREES_PYTHON, and the one Set up the scanner downloaded. It must use
 * its own packages and nothing of this user's:
 *   -E  no PYTHON* setting from this user's environment counts. Not PYTHONPATH
 *       or PYTHONHOME, and not PYTHONPLATLIBDIR, which alone stops Python
 *       before it starts, or PYTHONSAFEPATH, which hides scrape.py's own folder
 *       from its imports
 *   -s  no user site-packages (a `pip install --user` of another Playwright
 *       would come first on the path)
 *   -B  no bytecode: inside the app that would be writing into its own signed
 *       bundle, which breaks its signature
 *   -u  unbuffered, which PYTHONUNBUFFERED said before -E: the Scan page shows
 *       the scanner's lines as they come
 * Not -I: that also takes scrape.py's own folder off the import path, and with
 * it `import image_store`.
 */
export const OWN_PYTHON_FLAGS = Object.freeze(['-E', '-s', '-B', '-u']);

/**
 * The environment the app's own Python runs with, beside OWN_PYTHON_FLAGS. The
 * flags keep this user's PYTHON* settings from the interpreter; leaving them out
 * of its environment keeps them from whatever it starts too (the Python that
 * `-m venv` starts to put pip in place, for one).
 */
export function ownPythonEnv(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('PYTHON')) out[name] = value;
  }
  out.PYTHONNOUSERSITE = '1';
  out.PYTHONDONTWRITEBYTECODE = '1';
  return out;
}

/**
 * The environment a scan on this user's own Python gets (the scanner's
 * environment in the data folder, or this computer's Python): theirs, as it
 * always was, but no bytecode. scrape.py imports image_store from its own
 * folder, so Python would write scripts/__pycache__ beside it, and in the Mac
 * app that folder is inside the signed app, whichever Python runs the scan.
 */
export function noBytecodeEnv(env = process.env) {
  return { ...env, PYTHONDONTWRITEBYTECODE: '1' };
}

/** Is this Python the app's own (choosePython's 'bundled' or 'custom'), run isolated? */
export const isOwnPython = (run) => run?.source === 'bundled' || run?.source === 'custom';

/**
 * How the scanner (scrape.py, at `script`) is started on the Python
 * choosePython() picked: { cmd, args, env }, where env(base) makes its
 * environment from the server's. The app's own Python runs isolated
 * (OWN_PYTHON_FLAGS, ownPythonEnv); any other writes no bytecode (noBytecodeEnv).
 */
export function scannerCommand(run, script, args = []) {
  const own = isOwnPython(run);
  return {
    cmd: run.path,
    args: [...(own ? OWN_PYTHON_FLAGS : []), script, ...args],
    env: own ? ownPythonEnv : noBytecodeEnv,
  };
}

// pip settings that send an install somewhere other than the environment pip
// runs in (--target, --prefix, --root: pip then says it succeeded, and the
// scanner's environment has nothing), or make it refuse there (--user). pip
// reads any PIP_<NAME>, whatever the case of NAME, with _ for -.
const PIP_ELSEWHERE = new Set(['target', 'prefix', 'root', 'user']);

/**
 * The environment Install's pip runs with: this user's, less the settings that
 * would send the packages somewhere else (PIP_ELSEWHERE). Everything else of
 * theirs stays: which index to use, a proxy, certificates. Behind a company
 * network those are what make pip work at all, and scripts/requirements.txt's
 * hashes still have to match whatever serves the files.
 */
export function pipInstallEnv(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('PIP_') && PIP_ELSEWHERE.has(name.slice(4).toLowerCase().replace(/_/g, '-'))) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Install's last step, run by the scanner's environment: do the packages load
 * there? pip can say it succeeded after putting them somewhere else (a pip.conf
 * with a target, say), and the page would then say Finished over a scanner that
 * can't start. When they don't load it exits 1, with the reason in words.
 * `imports` is for tests.
 */
export function installCheckScript(imports = IMPORTS) {
  return [
    'import sys',
    'try:',
    `    ${imports}`,
    'except Exception as e:',
    '    first = (str(e).splitlines() or [""])[0][:200]',
    '    sys.stderr.write("pip said it installed them, but the scanner\'s environment can\'t load them (%s: %s). '
      + 'A pip setting may send packages somewhere else: pip config list shows yours.\\n" % (type(e).__name__, first))',
    '    sys.exit(1)',
    'print("The scanner\'s packages load in its environment.")',
  ].join('\n');
}

/**
 * Install's steps: build the scanner's environment from `base` (choosePython's
 * base: this computer's Python, or the one Set up downloaded, which is the
 * app's own and runs isolated), install the pinned packages into it, then
 * check they load there. Each step is { cmd, args, note, env? }, where env(base)
 * makes its environment from the server's.
 */
export function installSteps({ base, dataDir, requirements }) {
  const own = base.source === 'downloaded';
  const python = venvPython(dataDir);
  return [
    // --clear: Install runs only when the environment doesn't work, so what is there goes.
    {
      cmd: base.path,
      args: [...(own ? OWN_PYTHON_FLAGS : []), '-m', 'venv', '--clear', venvDir(dataDir)],
      ...(own ? { env: ownPythonEnv } : {}),
      note: 'Creating the scanner’s own Python environment',
    },
    // Every file pinned by its hash, wheels only (scripts/requirements.txt says so itself).
    {
      cmd: python,
      args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', requirements],
      env: pipInstallEnv,
      note: 'Installing Playwright, requests and Pillow',
    },
    { cmd: python, args: ['-c', installCheckScript()], note: 'Checking that they load' },
  ];
}

/** The scanner's environment in the data folder, and the Python in it. */
export function venvDir(dataDir) {
  return path.join(dataDir, 'venv');
}
export function venvPython(dataDir, platform = process.platform) {
  return platform === 'win32'
    ? path.join(venvDir(dataDir), 'Scripts', 'python.exe')
    : path.join(venvDir(dataDir), 'bin', 'python');
}

/** Where "Set up the scanner" puts the standalone Python, and its interpreter. */
export const DOWNLOADED_DIR = 'python';
export function downloadedPython(dataDir) {
  return path.join(dataDir, DOWNLOADED_DIR, 'bin', 'python3');
}

// Private working folders for a setup, inside the data folder (lib/data-folder.js
// keeps the names of every such folder): swept once an hour old, at a server's
// start as well as before a setup.
export { SETUP_WORK_PREFIX };

/**
 * Run a Python briefly and report what happened: { ok, stdout, stderr, problem }.
 * `problem` says why it didn't run, in a few words, when it didn't.
 */
export function runProbe(cmd, args, { timeoutMs = 8000, env } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    } catch (err) {
      finish({ ok: false, stdout, stderr, problem: err.message });
      return;
    }
    const cap = (s, d) => (s.length < 16384 ? s + d.toString() : s);
    child.stdout.on('data', (d) => { stdout = cap(stdout, d); });
    child.stderr.on('data', (d) => { stderr = cap(stderr, d); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ ok: false, stdout, stderr, problem: `it didn't answer within ${Math.round(timeoutMs / 1000)} seconds` });
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr, problem: err.code === 'ENOENT' ? 'it isn\'t there' : err.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const last = stderr.trim().split('\n').pop() || '';
      finish({
        ok: code === 0,
        stdout,
        stderr,
        problem: code === 0 ? null : signal ? `it was stopped (${signal})` : (last || `it exited with ${code}`),
      });
    });
  });
}

/**
 * Which Python runs the scanner, and what the Scan page can offer when none
 * can. Looks in the order at the top of this file, and stops looking once it
 * has an answer: when the app's own Python works, nothing on the computer is
 * started at all (on a Mac without the developer tools, /usr/bin/python3 is a
 * stub that asks to install them).
 *
 *   bundled            SIX_DEGREES_PYTHON, or '' when unset
 *   app                SIX_DEGREES_APP, the running app bundle: a named Python
 *                      inside it is the app's own ('bundled'), any other is 'custom'
 *   dataDir            the data folder
 *   probe(cmd, args, { timeoutMs, env })  runProbe, or a stand-in in tests
 *   exists(path)       fs.existsSync, or a stand-in
 *   host               hostKey() of this computer
 *   systemCandidates   the names a Python on this computer goes by
 *   env                the environment Pythons are started from (process.env)
 *
 * Resolves to:
 *   run          { path, source: 'bundled'|'custom'|'venv'|'system', version } or null
 *   own          when the named Python (SIX_DEGREES_PYTHON) didn't do:
 *                { source: 'bundled'|'custom', problem }, else null
 *   base         when nothing runs: what Install builds the environment from,
 *                { path, source: 'system'|'downloaded', version }, or null
 *   systemFound  when there is no base: a Python this computer does have, as
 *                { version, venv }, so the page can say why it won't do
 *   download     when there is neither: the pinned build for this computer
 *                (standaloneBuild), which "Set up the scanner" fetches, or null
 */
export async function choosePython({
  bundled = '',
  app = '',
  dataDir,
  probe = runProbe,
  exists = fs.existsSync,
  host = null,
  systemCandidates = SYSTEM_CANDIDATES,
  timeouts = { own: 20000, other: 8000 },
  env = process.env,
} = {}) {
  const result = { run: null, own: null, base: null, systemFound: null, download: null };

  if (bundled) {
    const source = app && path.resolve(bundled).startsWith(`${path.resolve(app)}${path.sep}`) ? 'bundled' : 'custom';
    // Asked the way it will run the scanner: isolated from this user's settings.
    const r = await probe(bundled, [...OWN_PYTHON_FLAGS, '-c', PROBE_SCRIPT], { timeoutMs: timeouts.own, env: ownPythonEnv(env) });
    const p = parseProbe(r.stdout);
    if (r.ok && p.imports) {
      result.run = { path: bundled, source, version: p.version };
      return result;
    }
    result.own = { source, problem: p.missing || r.problem || 'it didn\'t start' };
  }

  // The scanner's own environment, built earlier by Install.
  const venv = venvPython(dataDir);
  if (exists(venv)) {
    const r = await probe(venv, ['-c', PROBE_SCRIPT], { timeoutMs: timeouts.other, env });
    const p = parseProbe(r.stdout);
    if (r.ok && p.imports) {
      result.run = { path: venv, source: 'venv', version: p.version };
      return result;
    }
  }

  // A Python on this computer: one that already has the packages is used as it
  // is (someone who installed them by hand); otherwise the first that fits is
  // what Install builds from.
  const seen = [];
  for (const cmd of systemCandidates) {
    const r = await probe(cmd, ['-c', PROBE_SCRIPT], { timeoutMs: timeouts.other, env });
    const p = parseProbe(r.stdout);
    if (!p.version) continue;
    if (r.ok && p.imports) {
      result.run = { path: cmd, source: 'system', version: p.version };
      return result;
    }
    seen.push({ path: cmd, version: p.version, venv: p.venv });
  }
  const fits = seen.find((s) => s.venv && systemPythonFits(s.version));
  if (fits) {
    result.base = { path: fits.path, source: 'system', version: fits.version };
    return result;
  }
  // The most telling one first: the right version without venv, then any.
  const near = seen.find((s) => systemPythonFits(s.version)) || seen[0];
  result.systemFound = near ? { version: near.version, venv: near.venv } : null;

  // The standalone Python "Set up the scanner" downloaded, if it is here.
  const own = downloadedPython(dataDir);
  if (exists(own)) {
    const r = await probe(own, [...OWN_PYTHON_FLAGS, '-c', PROBE_SCRIPT], { timeoutMs: timeouts.other, env: ownPythonEnv(env) });
    const p = parseProbe(r.stdout);
    if (r.ok && p.venv) {
      result.base = { path: own, source: 'downloaded', version: p.version };
      return result;
    }
  }

  result.download = standaloneBuild(host);
  return result;
}

/** A setup that can't go on, with a message fit to show on the Scan page as it is. */
export class ScannerSetupError extends Error {}

// Next wraps the global fetch to cache what pages fetch. A download is no page's
// business, so use the fetch underneath when Next says which one that is.
const plainFetch = (...args) => (globalThis.fetch?._nextOriginalFetch || globalThis.fetch)(...args);

const MB = 1024 * 1024;
export const megabytes = (bytes) => (bytes / MB).toFixed(1);

/**
 * Download `url` to `file`, checking it against its pinned SHA-256 and size as
 * it arrives. It is written to `<file>.part` and renamed to `file` only once
 * both match, so nothing can unpack a file that failed the check: a wrong one
 * is deleted, and the promise rejects with a ScannerSetupError. Gives up when
 * nothing has arrived for `idleMs`; `signal` cancels it.
 * `onProgress(received, total)` is called as it goes.
 */
export async function downloadVerified(url, file, {
  sha256, size, signal, onProgress, idleMs = 30000, fetchImpl = plainFetch, from = 'GitHub',
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256)) || !(Number.isInteger(size) && size > 0)) {
    throw new ScannerSetupError('There is no pinned checksum for this download, so it wasn\'t started.');
  }
  const part = `${file}.part`;
  const idle = new AbortController();
  const both = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(new ScannerSetupError(
      `The download stopped for ${Math.round(idleMs / 1000)} seconds. Check your connection and try again.`,
    )), idleMs);
  };
  arm();
  const fh = await fsp.open(part, 'w');
  const hash = createHash('sha256');
  let received = 0;
  let good = false;
  try {
    const res = await fetchImpl(url, {
      signal: both,
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'six-degrees-scanner-setup' },
    });
    if (!res.ok || !res.body) throw new ScannerSetupError(`${from} answered ${res.status} to the download. Try again later.`);
    const declared = Number(res.headers.get('content-length')) || null;
    if (declared && declared !== size) {
      throw new ScannerSetupError(`The download isn't the size it should be (${declared} bytes, not ${size}), so it was stopped.`);
    }
    for await (const chunk of res.body) {
      arm();
      received += chunk.byteLength;
      if (received > size) throw new ScannerSetupError('The download is bigger than it should be, so it was stopped.');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await fh.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
      onProgress?.(received, size);
    }
    if (received !== size) throw new ScannerSetupError('The download ended early. Try again.');
    const got = hash.digest('hex');
    if (got !== sha256) {
      throw new ScannerSetupError('The download doesn\'t match the checksum Six Degrees has for it, so it was deleted and nothing was unpacked.');
    }
    good = true;
    return got;
  } catch (err) {
    // Say why it stopped (cancelled, or nothing arriving), not "aborted".
    if (both.aborted && both.reason instanceof Error) throw both.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    await fh.close();
    if (good) await fsp.rename(part, file);
    else await fsp.rm(part, { force: true });
  }
}

/** Remove setup folders a stopped server left behind, once they are an hour old. */
export function sweepSetupLeftovers(dataDir, { now = Date.now(), maxAgeMs = 3600000 } = {}) {
  let names = [];
  try { names = fs.readdirSync(dataDir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(SETUP_WORK_PREFIX)) continue;
    const dir = path.join(dataDir, name);
    try {
      const st = fs.lstatSync(dir);
      if (st.isDirectory() && now - st.mtimeMs > maxAgeMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* gone already */ }
  }
}

/**
 * Put the unpacked standalone Python in its place in the data folder. `unpacked`
 * is the folder the archive was unpacked into; it must hold python/bin/python3.
 * A Python already there (one that didn't work, or setup wouldn't have run) is
 * moved into `work` first and goes when `work` is removed.
 */
export async function placeDownloadedPython(unpacked, dataDir, work) {
  const from = path.join(unpacked, 'python');
  const st = await fsp.lstat(path.join(from, 'bin', 'python3')).catch(() => null);
  if (!st) throw new ScannerSetupError('The download didn\'t contain the Python it should have.');
  const to = path.join(dataDir, DOWNLOADED_DIR);
  if (fs.existsSync(to)) await fsp.rename(to, path.join(work, 'python-before'));
  await fsp.rename(from, to);
  return downloadedPython(dataDir);
}

// ── Mach-O, for checking the Python that goes inside the Mac app ─────────────

const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const DYLIB_COMMANDS = new Set([0xc, 0x80000018, 0x8000001f, 0x20]); // load, weak, reexport, lazy

/**
 * What one Mach-O (a thin file, or one slice of a universal one) says about
 * itself, from its load commands: the oldest macOS it runs on ('13.5') and the
 * libraries it loads. null when `buf` at `offset` isn't a 64- or 32-bit Mach-O.
 */
export function machoSlice(buf, offset = 0) {
  if (!buf || offset + 28 > buf.length) return null;
  const magic = buf.readUInt32LE(offset);
  if (magic !== 0xfeedfacf && magic !== 0xfeedface) return null;
  const ncmds = buf.readUInt32LE(offset + 16);
  let at = offset + (magic === 0xfeedfacf ? 32 : 28);
  const version = (v) => `${v >>> 16}.${(v >>> 8) & 0xff}${v & 0xff ? `.${v & 0xff}` : ''}`;
  const info = { minos: null, dylibs: [] };
  for (let i = 0; i < ncmds && at + 8 <= buf.length; i++) {
    const cmd = buf.readUInt32LE(at);
    const size = buf.readUInt32LE(at + 4);
    if (size < 8) break;
    if (cmd === LC_BUILD_VERSION && at + 16 <= buf.length) info.minos = version(buf.readUInt32LE(at + 12));
    else if (cmd === LC_VERSION_MIN_MACOSX && at + 12 <= buf.length && !info.minos) info.minos = version(buf.readUInt32LE(at + 8));
    else if (DYLIB_COMMANDS.has(cmd) && at + 12 <= buf.length) {
      const nameAt = at + buf.readUInt32LE(at + 8);
      const end = buf.indexOf(0, nameAt);
      if (nameAt < at + size && end > nameAt) info.dylibs.push(buf.toString('utf8', nameAt, Math.min(end, at + size)));
    }
    at += size;
  }
  return info;
}

/**
 * The slices of a Mach-O file as [{ arch, offset }]: one at offset 0 for a thin
 * file, one per chip for a universal one. [] when it isn't a Mach-O (a script,
 * a Java class file, which begins with the same bytes as a universal binary).
 */
export function machoSlices(buf) {
  if (!buf || buf.length < 8) return [];
  const CPU = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
  const le = buf.readUInt32LE(0);
  if (le === 0xfeedfacf || le === 0xfeedface) return [{ arch: CPU[buf.readUInt32LE(4) >>> 0] || 'other', offset: 0 }];
  const be = buf.readUInt32BE(0);
  if (be !== 0xcafebabe && be !== 0xcafebabf) return [];
  const count = buf.readUInt32BE(4);
  if (count < 1 || count > 16) return [];
  const wide = be === 0xcafebabf;
  const slices = [];
  for (let i = 0; i < count; i++) {
    const at = 8 + i * (wide ? 32 : 20);
    if (at + (wide ? 16 : 12) > buf.length) break;
    const offset = wide ? Number(buf.readBigUInt64BE(at + 8)) : buf.readUInt32BE(at + 8);
    slices.push({ arch: CPU[buf.readUInt32BE(at) >>> 0] || 'other', offset });
  }
  return slices;
}
