// Where the scanner's Python comes from (lib/scanner-python.js): the pinned
// standalone builds, which computer gets which, the order Pythons are chosen
// in, and the download that is checked against its pinned SHA-256 before
// anything is unpacked. DESKTOP.md D2.
//
// Offline: every Python here is a stand-in that answers like one, and every
// download comes from a server on 127.0.0.1 in this process. Never GitHub or
// PyPI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STANDALONE_PYTHON, STANDALONE_BASE, SYSTEM_PYTHON, SETUP_WORK_PREFIX, PROBE_SCRIPT,
  hostKey, standaloneBuild, standaloneUrl, systemPythonFits, parseProbe, ownPythonEnv, choosePython,
  downloadVerified, placeDownloadedPython, sweepSetupLeftovers, venvPython, downloadedPython,
  machoSlices, machoSlice, ScannerSetupError,
} from '../lib/scanner-python.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sixdeg-python-'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ── the pins ─────────────────────────────────────────────────────────────────

test('each computer has one pinned build: a name with the version and release, a SHA-256 and a size', () => {
  const { release, version, builds } = STANDALONE_PYTHON;
  assert.match(release, /^\d{8}$/);
  assert.match(version, /^3\.12\.\d+$/);
  assert.deepEqual(Object.keys(builds).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
  const triple = {
    'darwin-arm64': 'aarch64-apple-darwin-install_only',
    'darwin-x64': 'x86_64-apple-darwin-install_only',
    // Linux: the same build without debug symbols (a third of the download).
    'linux-x64': 'x86_64-unknown-linux-gnu-install_only_stripped',
    'linux-arm64': 'aarch64-unknown-linux-gnu-install_only_stripped',
  };
  for (const [key, b] of Object.entries(builds)) {
    assert.equal(b.file, `cpython-${version}+${release}-${triple[key]}.tar.gz`, key);
    assert.match(b.sha256, /^[0-9a-f]{64}$/, key);
    assert.ok(Number.isInteger(b.size) && b.size > 10e6 && b.size < 60e6, `${key}: ${b.size}`);
    assert.ok(Object.isFrozen(b), `${key} can't be changed at run time`);
  }
  assert.equal(new Set(Object.values(builds).map((b) => b.sha256)).size, 4, 'four different files');
});

test('the download address is GitHub\'s release download for exactly that file', () => {
  const b = standaloneBuild('darwin-arm64');
  assert.equal(STANDALONE_BASE, 'https://github.com/astral-sh/python-build-standalone/releases/download');
  assert.equal(b.url,
    `https://github.com/astral-sh/python-build-standalone/releases/download/${STANDALONE_PYTHON.release}/cpython-${STANDALONE_PYTHON.version}%2B${STANDALONE_PYTHON.release}-aarch64-apple-darwin-install_only.tar.gz`);
  assert.equal(b.sha256, STANDALONE_PYTHON.builds['darwin-arm64'].sha256);
  assert.equal(b.version, STANDALONE_PYTHON.version);
  assert.equal(standaloneUrl({ file: 'a+b c.tar.gz' }, { release: 'r1' }), `${STANDALONE_BASE}/r1/a%2Bb%20c.tar.gz`);
  assert.equal(standaloneBuild(null), null);
  assert.equal(standaloneBuild('win32-x64'), null);
  assert.equal(standaloneBuild('constructor'), null, 'only its own keys');
});

// ── which computer gets which ────────────────────────────────────────────────

test('the operating system and chip pick the download', () => {
  assert.equal(hostKey({ platform: 'darwin', arch: 'arm64' }), 'darwin-arm64');
  assert.equal(hostKey({ platform: 'darwin', arch: 'x64' }), 'darwin-x64');
  // Node under Rosetta says x64 on Apple Silicon; the hardware decides (TRAPS §30).
  assert.equal(hostKey({ platform: 'darwin', arch: 'x64', sysctlArm64: '1\n' }), 'darwin-arm64');
  assert.equal(hostKey({ platform: 'darwin', arch: 'x64', sysctlArm64: '0' }), 'darwin-x64');
  assert.equal(hostKey({ platform: 'linux', arch: 'x64' }), 'linux-x64');
  assert.equal(hostKey({ platform: 'linux', arch: 'arm64' }), 'linux-arm64');
  for (const [platform, arch] of [['linux', 'ia32'], ['linux', 'arm'], ['linux', 'ppc64'], ['linux', 's390x'], ['win32', 'x64'], ['freebsd', 'x64']]) {
    assert.equal(hostKey({ platform, arch }), null, `${platform} ${arch}`);
    assert.equal(standaloneBuild(hostKey({ platform, arch })), null);
  }
});

test('a Python on this computer fits when the pinned packages install into it: 3.10 to 3.14', () => {
  assert.deepEqual(SYSTEM_PYTHON, { min: [3, 10], max: [3, 14] });
  for (const v of ['3.10.0', '3.10.12', '3.12.3', '3.13.1', '3.14.0']) assert.equal(systemPythonFits(v), true, v);
  for (const v of ['3.9.6', '3.8.10', '3.15.0', '2.7.18', '4.0.0', '', null, 'Python 3.12']) assert.equal(systemPythonFits(v), false, String(v));
});

test('one look says a Python\'s version, whether it can make environments, and whether the packages load', () => {
  assert.deepEqual(parseProbe('version 3.12.14\nvenv\nimports\n'), { version: '3.12.14', venv: true, imports: true, missing: null });
  assert.deepEqual(parseProbe('version 3.9.6\nvenv\nmissing ModuleNotFoundError: No module named \'playwright\'\n'),
    { version: '3.9.6', venv: true, imports: false, missing: 'ModuleNotFoundError: No module named \'playwright\'' });
  assert.deepEqual(parseProbe(''), { version: null, venv: false, imports: false, missing: null });
  // The script itself asks for all three, and loads the compiled parts (TRAPS §30).
  assert.match(PROBE_SCRIPT, /import venv, ensurepip/);
  assert.match(PROBE_SCRIPT, /from PIL import Image/);
  assert.match(PROBE_SCRIPT, /from playwright\.sync_api import sync_playwright/);
});

test('the app\'s own Python runs on its own packages only, and writes nothing into the app', () => {
  const given = { PATH: '/usr/bin', PYTHONPATH: '/somewhere', PYTHONHOME: '/elsewhere', HOME: '/Users/someone' };
  const env = ownPythonEnv(given);
  assert.equal(env.PYTHONNOUSERSITE, '1');
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal('PYTHONPATH' in env, false);
  assert.equal('PYTHONHOME' in env, false);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(given.PYTHONPATH, '/somewhere', 'the environment passed in is left alone');
});

// ── the order: bundled, then this computer's, then downloaded ────────────────

// A pretend computer: `pythons` maps a command to what PROBE_SCRIPT would print
// (or null: not there). Every probe is recorded.
function computer(pythons, files = []) {
  const calls = [];
  return {
    calls,
    probe: async (cmd, args, opts) => {
      calls.push({ cmd, env: opts?.env });
      assert.deepEqual(args, ['-c', PROBE_SCRIPT]);
      const said = pythons[cmd];
      if (said == null) return { ok: false, stdout: '', stderr: '', problem: 'it isn\'t there' };
      return { ok: true, stdout: said, stderr: '', problem: null };
    },
    exists: (p) => files.includes(p) || Object.hasOwn(pythons, p),
  };
}

const APP = '/Applications/Six Degrees.app';
const BUNDLED = `${APP}/Contents/Resources/python/bin/python3`;
const DATA = '/home/someone/.six-degrees';
const READY = 'version 3.12.14\nvenv\nimports\n';

test('the app\'s own Python comes first, and when it works nothing else is started', async () => {
  const pc = computer({ [BUNDLED]: READY, '/usr/bin/python3': READY });
  const r = await choosePython({ bundled: BUNDLED, app: APP, dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'darwin-arm64' });
  assert.deepEqual(r.run, { path: BUNDLED, source: 'bundled', version: '3.12.14' });
  assert.equal(r.download, null);
  assert.deepEqual(pc.calls.map((c) => c.cmd), [BUNDLED], 'not /usr/bin/python3: on a Mac without the developer tools it asks to install them');
  assert.equal(pc.calls[0].env.PYTHONNOUSERSITE, '1', 'probed the way it runs');
});

test('a Python named from outside the app is used the same way, and called what it is', async () => {
  const pc = computer({ '/opt/py/bin/python3': READY });
  const r = await choosePython({ bundled: '/opt/py/bin/python3', app: APP, dataDir: DATA, probe: pc.probe, exists: pc.exists });
  assert.equal(r.run.source, 'custom');
  // A path that merely starts with the app's name isn't inside it.
  const sneaky = `${APP}-copy/python3`;
  const r2 = await choosePython({ bundled: sneaky, app: APP, dataDir: DATA, ...computer({ [sneaky]: READY }) });
  assert.equal(r2.run.source, 'custom');
});

test('when the app\'s own Python doesn\'t work, it says why and falls back to the scanner\'s environment', async () => {
  const venv = venvPython(DATA, 'darwin');
  const pc = computer({
    [BUNDLED]: 'version 3.12.14\nvenv\nmissing ImportError: dlopen(_imaging.so): code signature invalid\n',
    [venv]: 'version 3.13.1\nvenv\nimports\n',
  });
  const r = await choosePython({ bundled: BUNDLED, app: APP, dataDir: DATA, probe: pc.probe, exists: pc.exists });
  assert.deepEqual(r.run, { path: venv, source: 'venv', version: '3.13.1' });
  assert.deepEqual(r.own, { source: 'bundled', problem: 'ImportError: dlopen(_imaging.so): code signature invalid' });
  assert.deepEqual(pc.calls.map((c) => c.cmd), [BUNDLED, venv]);
});

test('no app Python: the scanner\'s environment, then a system Python that already has the packages', async () => {
  const pc = computer({ '/usr/bin/python3': 'version 3.9.6\nvenv\nimports\n', python3: READY });
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'darwin-arm64' });
  // Someone who installed the packages by hand keeps using that Python, 3.9 or not.
  assert.deepEqual(r.run, { path: '/usr/bin/python3', source: 'system', version: '3.9.6' });
  assert.deepEqual(pc.calls.map((c) => c.cmd), ['/usr/bin/python3'], 'the environment isn\'t there, so it isn\'t started');
});

test('nothing ready: Install builds from this computer\'s Python when it fits, never downloading', async () => {
  const pc = computer({ '/usr/bin/python3': 'version 3.9.6\nvenv\nmissing x\n', python3: 'version 3.12.3\nvenv\nmissing x\n' });
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'linux-x64' });
  assert.equal(r.run, null);
  assert.deepEqual(r.base, { path: 'python3', source: 'system', version: '3.12.3' });
  assert.equal(r.download, null);
});

test('this computer\'s Python is too old: the download for this computer is offered, and why', async () => {
  const pc = computer({ '/usr/bin/python3': 'version 3.9.6\nvenv\nmissing x\n' });
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'darwin-arm64' });
  assert.equal(r.run, null);
  assert.equal(r.base, null);
  assert.deepEqual(r.systemFound, { version: '3.9.6', venv: true });
  assert.equal(r.download.key, 'darwin-arm64');
  assert.equal(r.download.sha256, STANDALONE_PYTHON.builds['darwin-arm64'].sha256);
});

test('a Python that can\'t make environments (Ubuntu without python3-venv) is no base either', async () => {
  const pc = computer({ python3: 'version 3.12.3\nmissing x\n', '/usr/bin/python3': 'version 3.12.3\nmissing x\n' });
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'linux-x64' });
  assert.equal(r.base, null);
  assert.deepEqual(r.systemFound, { version: '3.12.3', venv: false });
  assert.equal(r.download.key, 'linux-x64');
});

test('a Python the setup already downloaded is built from before anything is downloaded again', async () => {
  const own = downloadedPython(DATA);
  const pc = computer({ '/usr/bin/python3': 'version 3.9.6\nvenv\nmissing x\n', [own]: 'version 3.12.14\nvenv\nmissing x\n' });
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'linux-arm64' });
  assert.deepEqual(r.base, { path: own, source: 'downloaded', version: '3.12.14' });
  assert.equal(r.download, null);
  // Order: this computer's Pythons were asked first, the downloaded one last.
  assert.equal(pc.calls.at(-1).cmd, own);
  assert.ok(pc.calls.findIndex((c) => c.cmd === '/usr/bin/python3') < pc.calls.length - 1);
});

test('the full order when nothing works: bundled, the environment, this computer\'s, the downloaded one, then a download', async () => {
  const venv = venvPython(DATA);
  const own = downloadedPython(DATA);
  const broken = 'version 3.12.14\nmissing x\n';
  const pc = computer({ [BUNDLED]: broken, [venv]: broken, '/usr/bin/python3': 'version 3.9.6\nmissing x\n', [own]: broken });
  const r = await choosePython({
    bundled: BUNDLED, app: APP, dataDir: DATA, probe: pc.probe, exists: pc.exists, host: 'darwin-x64',
    systemCandidates: ['/usr/bin/python3', 'python3'],
  });
  assert.deepEqual(pc.calls.map((c) => c.cmd), [BUNDLED, venv, '/usr/bin/python3', 'python3', own]);
  assert.equal(r.run, null);
  assert.equal(r.base, null, 'a downloaded Python without venv is no base');
  assert.equal(r.download.key, 'darwin-x64');
});

test('no Python and no build for this computer: nothing to offer but installing Python by hand', async () => {
  const pc = computer({});
  const r = await choosePython({ dataDir: DATA, probe: pc.probe, exists: pc.exists, host: null });
  assert.deepEqual(r, { run: null, own: null, base: null, systemFound: null, download: null });
});

// ── the download, checked before anything is unpacked ────────────────────────

// A server on 127.0.0.1 that answers every request with `body` (a Buffer), or
// as `how` says: { status, length, stall }.
async function serve(body, how = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (how.status) { res.writeHead(how.status); res.end(); return; }
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (how.length !== null) headers['Content-Length'] = String(how.length ?? body.length);
    res.writeHead(200, headers);
    if (how.stall) { res.write(body.subarray(0, 10)); return; } // then nothing, ever
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/cpython.tar.gz`;
  return {
    url,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

test('a download that matches its pinned SHA-256 and size is kept, under its name', async () => {
  const dir = scratch();
  const body = Buffer.from('the pinned bytes '.repeat(1000));
  const srv = await serve(body);
  const file = path.join(dir, 'python.tar.gz');
  const seen = [];
  try {
    const got = await downloadVerified(srv.url, file, { sha256: sha(body), size: body.length, onProgress: (n, t) => seen.push([n, t]) });
    assert.equal(got, sha(body));
    assert.deepEqual(fs.readFileSync(file), body);
    assert.equal(fs.existsSync(`${file}.part`), false);
    assert.deepEqual(seen.at(-1), [body.length, body.length]);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a download with the wrong bytes is refused and deleted, so there is nothing to unpack', async () => {
  const dir = scratch();
  const pinned = Buffer.from('the pinned bytes '.repeat(1000));
  const other = Buffer.from('other bytes, same '.repeat(1000)).subarray(0, pinned.length); // same size
  const srv = await serve(other);
  const file = path.join(dir, 'python.tar.gz');
  try {
    await assert.rejects(downloadVerified(srv.url, file, { sha256: sha(pinned), size: pinned.length }),
      (err) => err instanceof ScannerSetupError && /checksum/.test(err.message) && /nothing was unpacked/.test(err.message));
    assert.deepEqual(fs.readdirSync(dir), [], 'neither the file nor a .part is left');
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a download of the wrong size is stopped before its bytes are read, and a longer one as soon as it overruns', async () => {
  const dir = scratch();
  const body = Buffer.alloc(5000, 7);
  const file = path.join(dir, 'python.tar.gz');
  const wrongLength = await serve(body);
  const noLength = await serve(Buffer.alloc(9000, 7), { length: null });
  try {
    await assert.rejects(downloadVerified(wrongLength.url, file, { sha256: sha(body), size: 4000 }),
      (err) => err instanceof ScannerSetupError && /isn't the size it should be/.test(err.message));
    await assert.rejects(downloadVerified(noLength.url, file, { sha256: sha(body), size: body.length }),
      (err) => err instanceof ScannerSetupError && /bigger than it should be/.test(err.message));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    await wrongLength.close();
    await noLength.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no pin, no download: nothing is requested without a SHA-256 and a size to check it by', async () => {
  const dir = scratch();
  const srv = await serve(Buffer.from('x'));
  try {
    for (const pin of [{}, { sha256: 'abc', size: 1 }, { sha256: 'a'.repeat(64) }, { sha256: 'a'.repeat(64), size: 0 }]) {
      await assert.rejects(downloadVerified(srv.url, path.join(dir, 'f'), pin), ScannerSetupError);
    }
    assert.equal(srv.requests.length, 0);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused answer, a stalled download and a cancel each stop it and leave nothing', async () => {
  const dir = scratch();
  const body = Buffer.alloc(4096, 1);
  const file = path.join(dir, 'python.tar.gz');
  const missing = await serve(body, { status: 404 });
  const stalled = await serve(body, { stall: true });
  try {
    await assert.rejects(downloadVerified(missing.url, file, { sha256: sha(body), size: body.length, from: 'GitHub' }),
      (err) => err instanceof ScannerSetupError && /GitHub answered 404/.test(err.message));
    await assert.rejects(downloadVerified(stalled.url, file, { sha256: sha(body), size: body.length, idleMs: 300 }),
      (err) => err instanceof ScannerSetupError && /stopped for/.test(err.message));
    const ctrl = new AbortController();
    const going = downloadVerified(stalled.url, file, { sha256: sha(body), size: body.length, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(new ScannerSetupError('Stopped.')), 50);
    await assert.rejects(going, (err) => err.message === 'Stopped.');
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    await missing.close();
    await stalled.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setup, start to end offline: download, check, unpack, put in place; a wrong pin unpacks nothing', async () => {
  const dir = scratch();
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  // A pretend standalone Python: python/bin/python3, packed the way the real one is.
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'python', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'python', 'bin', 'python3.12'), '#!/bin/sh\necho version 3.12.14\n', { mode: 0o755 });
  fs.symlinkSync('python3.12', path.join(src, 'python', 'bin', 'python3'));
  const tarball = path.join(dir, 'cpython.tar.gz');
  execFileSync('tar', ['-czf', tarball, '-C', src, 'python']);
  const bytes = fs.readFileSync(tarball);
  const srv = await serve(bytes);
  try {
    // As the Scan page's setup does it (app/api/scraper/route.js setupPlan).
    const setup = async (pin) => {
      const work = fs.mkdtempSync(path.join(data, SETUP_WORK_PREFIX));
      const archive = path.join(work, 'cpython.tar.gz');
      try {
        await downloadVerified(srv.url, archive, pin);
        execFileSync('tar', ['-xzf', archive, '-C', work]);
        return await placeDownloadedPython(work, data, work);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    };

    await assert.rejects(setup({ sha256: sha(Buffer.from('another file')), size: bytes.length }), /checksum/);
    assert.equal(fs.existsSync(path.join(data, 'python')), false, 'nothing unpacked from a file that failed its check');

    const python = await setup({ sha256: sha(bytes), size: bytes.length });
    assert.equal(python, downloadedPython(data));
    assert.equal(execFileSync(python).toString().trim(), 'version 3.12.14');
    assert.deepEqual(fs.readdirSync(data), ['python'], 'the private working folder is gone');

    // Again over one that is already there (it didn't work, or setup wouldn't run): replaced.
    fs.writeFileSync(path.join(data, 'python', 'marker'), 'old');
    await setup({ sha256: sha(bytes), size: bytes.length });
    assert.equal(fs.existsSync(path.join(data, 'python', 'marker')), false);
    assert.deepEqual(fs.readdirSync(data), ['python']);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an archive without a Python in it is refused, and nothing is put in place', async () => {
  const dir = scratch();
  const work = path.join(dir, 'work');
  fs.mkdirSync(path.join(work, 'python', 'lib'), { recursive: true });
  try {
    await assert.rejects(placeDownloadedPython(work, dir, work), ScannerSetupError);
    assert.equal(fs.existsSync(path.join(dir, 'python')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setup folders left by a stopped server are swept once an hour old, and nothing else', () => {
  const dir = scratch();
  const old = path.join(dir, `${SETUP_WORK_PREFIX}old`);
  const fresh = path.join(dir, `${SETUP_WORK_PREFIX}fresh`);
  for (const d of [old, fresh, path.join(dir, 'python'), path.join(dir, 'venv')]) fs.mkdirSync(d);
  const hourAgo = (Date.now() - 2 * 3600000) / 1000;
  fs.utimesSync(old, hourAgo, hourAgo);
  fs.utimesSync(path.join(dir, 'python'), hourAgo, hourAgo);
  sweepSetupLeftovers(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${SETUP_WORK_PREFIX}fresh`, 'python', 'venv']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Mach-O, as build-app.mjs checks the Python inside the app ────────────────

// A thin 64-bit Mach-O for `cpu` with LC_BUILD_VERSION (minos) and one LC_LOAD_DYLIB.
function fakeMacho(cpu, minos, dylib) {
  const name = Buffer.from(`${dylib}\0`);
  const dylibSize = Math.ceil((24 + name.length) / 8) * 8;
  const buf = Buffer.alloc(32 + 24 + dylibSize);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(cpu, 4);
  buf.writeUInt32LE(2, 16);                  // ncmds
  buf.writeUInt32LE(24 + dylibSize, 20);     // sizeofcmds
  let at = 32;
  buf.writeUInt32LE(0x32, at);               // LC_BUILD_VERSION
  buf.writeUInt32LE(24, at + 4);
  buf.writeUInt32LE(1, at + 8);              // platform: macOS
  const [maj, min] = minos.split('.').map(Number);
  buf.writeUInt32LE((maj << 16) | (min << 8), at + 12);
  at += 24;
  buf.writeUInt32LE(0xc, at);                // LC_LOAD_DYLIB
  buf.writeUInt32LE(dylibSize, at + 4);
  buf.writeUInt32LE(24, at + 8);             // the name follows the command
  name.copy(buf, at + 24);
  return buf;
}

test('Mach-O: the chip, the oldest macOS and the libraries of a program, thin or universal', () => {
  const arm = fakeMacho(0x0100000c, '13.5', '@rpath/libpython3.12.dylib');
  assert.deepEqual(machoSlices(arm), [{ arch: 'arm64', offset: 0 }]);
  assert.deepEqual(machoSlice(arm), { minos: '13.5', dylibs: ['@rpath/libpython3.12.dylib'] });

  const x64 = fakeMacho(0x01000007, '10.13', '/usr/lib/libSystem.B.dylib');
  const fat = Buffer.alloc(4096 * 3);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  [[0x01000007, 4096, x64], [0x0100000c, 8192, arm]].forEach(([cpu, offset, slice], i) => {
    const at = 8 + i * 20;
    fat.writeUInt32BE(cpu, at);
    fat.writeUInt32BE(offset, at + 8);
    fat.writeUInt32BE(slice.length, at + 12);
    slice.copy(fat, offset);
  });
  assert.deepEqual(machoSlices(fat), [{ arch: 'x64', offset: 4096 }, { arch: 'arm64', offset: 8192 }]);
  assert.deepEqual(machoSlice(fat, 4096), { minos: '10.13', dylibs: ['/usr/lib/libSystem.B.dylib'] });

  // Not Mach-O: a script, and a Java class file (same first bytes as a universal binary).
  assert.deepEqual(machoSlices(Buffer.from('#!/bin/sh\necho hi\n')), []);
  const javaClass = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]);
  assert.deepEqual(machoSlices(javaClass), []);
  assert.equal(machoSlice(Buffer.from('#!/bin/sh')), null);
});
