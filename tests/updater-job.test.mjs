// The Mac app's update job (lib/updater-job.js), up to the moment it hands
// over to the helper: against a pretend release on 127.0.0.1
// (scripts/test-release-server.mjs), with real disk images made by hdiutil that
// hold pretend apps, signed ad hoc the way the real one is.
//
// Never GitHub, never /Applications, never a real app. The "running app" is a
// folder in a temporary directory, the pretend apps carry a test bundle id and
// versions far below any release, and the helper is only ever really started
// where it refuses at once. The swap itself is tests/apply-update.test.mjs.
//
// macOS only: hdiutil, codesign and ditto are the Mac's.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startUpdate, cancelUpdate, currentUpdate, _resetUpdateForTesting, readStatusFile, launchHelper, updatePaths,
} from '../lib/updater-job.js';
import { startTestReleaseServer } from '../scripts/test-release-server.mjs';

const skip = process.platform !== 'darwin' && 'disk images and code signatures are the Mac app\'s';
const HELPER = fileURLToPath(new URL('../scripts/apply-update.sh', import.meta.url));
const SLUG = 'owner/six-degrees';
const TEST_ID = 'com.example.six-degrees-updater-test';   // never the real app's id
const OLD = '0.0.8';
const NEW = '0.0.9';
const ARM = `Six-Degrees-${NEW}-arm64.dmg`;
const INTEL = `Six-Degrees-${NEW}-x64.dmg`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let fixtures = null;   // folder of pretend apps and their disk images
let server = null;     // the pretend release
const dmg = {};

// A pretend Six Degrees.app: a real Mach-O executable (a copy of /usr/bin/true,
// which has both chips) and an Info.plist, signed ad hoc.
function makeApp(dir, { version = NEW, id = TEST_ID, minimum = '13.5', thin = false, escape = false } = {}) {
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Six Degrees updater test</string>
  <key>CFBundleIdentifier</key><string>${id}</string>
  <key>CFBundleExecutable</key><string>Six Degrees</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>${minimum}</string>
</dict></plist>
`);
  const exe = path.join(dir, 'Contents', 'MacOS', 'Six Degrees');
  fs.copyFileSync('/usr/bin/true', exe);
  if (thin) {
    // Apple Silicon only, the way an arm64 release is: ditto can thin a copy,
    // with no developer tools (lipo would ask to install them).
    execFileSync('/usr/bin/ditto', ['--arch', 'arm64e', exe, `${exe}.thin`]);
    fs.renameSync(`${exe}.thin`, exe);
  }
  fs.chmodSync(exe, 0o755);
  fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'VERSION'), `${version}\n`);
  if (escape) fs.symlinkSync('/etc', path.join(dir, 'Contents', 'Resources', 'escape'));
  execFileSync('/usr/bin/codesign', ['--sign', '-', '--force', '--deep', dir], { stdio: 'ignore' });
  return dir;
}

// A disk image holding one app, as "Six Degrees.app", the way releases do.
// hdiutil can take several seconds per image, so they are made side by side.
async function makeDmg(name, options) {
  const src = path.join(fixtures, `${name}-src`);
  makeApp(path.join(src, 'Six Degrees.app'), options);
  const out = path.join(fixtures, `${name}.dmg`);
  await promisify(execFile)('/usr/bin/hdiutil', ['create', '-quiet', '-volname', 'Six Degrees', '-fs', 'HFS+',
    '-srcfolder', src, '-format', 'UDZO', '-ov', out]);
  return out;
}

before(async () => {
  if (skip) return;
  fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-job-fixtures-'));
  [dmg.good, dmg.wrongId, dmg.escape, dmg.thin] = await Promise.all([
    makeDmg('good'),
    makeDmg('wrong-id', { id: 'com.example.not-six-degrees' }),
    makeDmg('escape', { escape: true }),
    makeDmg('thin', { thin: true }),
  ]);
  server = await startTestReleaseServer({ slug: SLUG });
});

after(async () => {
  _resetUpdateForTesting();
  if (server) await server.close();
  if (fixtures) fs.rmSync(fixtures, { recursive: true, force: true });
});

// A release carrying both chips' images and the fixed-name copies, like release.yml's.
const release = (over = {}) => ({
  version: NEW,
  assets: [
    { name: ARM, file: dmg.good },
    { name: INTEL, file: dmg.good },
    { name: 'Six-Degrees-Mac-Apple-Silicon.dmg', file: dmg.good },
    { name: 'Six-Degrees-Mac-Intel.dmg', file: dmg.good },
  ],
  ...over,
});

// A temporary Applications folder with the "running" app in it, and the rest of
// the places an update uses.
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-job-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const apps = path.join(root, 'Applications');
  const bundle = path.join(apps, 'Six Degrees.app');
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Resources.txt'), `the running ${OLD}\n`);
  const tmpRoot = path.join(root, 'tmp');
  fs.mkdirSync(tmpRoot);
  const cacheDir = path.join(root, 'Caches', 'Six Degrees');
  return {
    root, apps, bundle, tmpRoot, cacheDir,
    statusFile: path.join(cacheDir, 'last-update.json'),
    logFile: path.join(root, 'six-degrees-update.log'),
    staged: path.join(apps, '.Six Degrees.app.incoming'),
    dataDir: path.join(root, 'my data'),
  };
}

function context(w, over = {}) {
  const calls = { launch: [], exit: 0 };
  const c = {
    slug: SLUG,
    currentVersion: OLD,
    chip: 'arm64',
    macosVersion: '15.0',
    bundle: w.bundle,
    dataDir: w.dataDir,
    defaultDataDir: path.join(w.root, '.six-degrees'),
    helper: HELPER,
    tmpRoot: w.tmpRoot,
    cacheDir: w.cacheDir,
    statusFile: w.statusFile,
    logFile: w.logFile,
    apiBase: server.origin,
    downloadBase: server.origin,
    bundleId: TEST_ID,
    pids: [424242],
    idleMs: 5000,
    settleMs: 0,
    fetchImpl: fetch,
    launch: async (o) => { calls.launch.push(o); return { exitCode: null, signalCode: null }; },
    exit: () => { calls.exit += 1; },
    ...over,
  };
  return { c, calls };
}

async function run(c) {
  _resetUpdateForTesting();
  server.requests.length = 0;
  const started = startUpdate(c);
  assert.equal(started.error, undefined);
  await started.done;
  return currentUpdate();
}

const requested = () => server.requests.map((r) => r.replace(/^GET /, '').replace(`/${SLUG}/releases/download/v${NEW}/`, 'asset:'));
const workDirs = (w) => fs.readdirSync(w.tmpRoot).filter((f) => f.startsWith('six-degrees-update-'));
const mountedUnder = (dir) => {
  const info = execFileSync('/usr/bin/hdiutil', ['info']).toString();
  return info.includes(dir) || info.includes(fs.realpathSync(dir));
};
const plistValue = (app, key) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')]).toString().trim();

// Refused, and exactly as it was: nothing staged, nothing mounted, no work
// folder, no helper, no quit, no status file.
function assertUntouched(w, calls, job) {
  assert.equal(fs.existsSync(w.staged), false, 'nothing staged beside the app');
  assert.deepEqual(workDirs(w), [], 'the download folder is gone');
  assert.equal(mountedUnder(w.root), false, 'no disk image left mounted');
  assert.equal(calls.launch.length, 0, 'no helper');
  assert.equal(calls.exit, 0, 'the app keeps running');
  assert.equal(fs.existsSync(w.statusFile), false, 'no outcome to report');
  assert.equal(fs.readFileSync(path.join(w.bundle, 'Contents', 'Resources.txt'), 'utf8').trim(), `the running ${OLD}`);
  assert.ok(job.endedAt);
}

test('HAPPY PATH: checks, downloads, verifies, stages beside the app, then hands over and quits', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  const { c, calls } = context(w);
  const job = await run(c);

  assert.equal(job.phase, 'restarting', job.error);
  assert.equal(job.version, NEW);
  assert.equal(job.received, fs.statSync(dmg.good).size);
  assert.equal(job.total, job.received);

  // Only what it needed, and only the build for this chip, by its exact name.
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`, 'asset:SHA256SUMS', `asset:${ARM}`]);

  // The new version waits, whole and verified, beside the running one.
  assert.equal(plistValue(w.staged, 'CFBundleShortVersionString'), NEW);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', w.staged]);
  assert.equal(fs.readFileSync(path.join(w.bundle, 'Contents', 'Resources.txt'), 'utf8').trim(), `the running ${OLD}`,
    'the running app is not touched: the helper does that after it quits');
  assert.equal(mountedUnder(w.root), false, 'the image is unmounted');

  // The hand-over: one helper, then one quit.
  assert.equal(calls.launch.length, 1);
  assert.equal(calls.exit, 1);
  const { helper, args, cwd, logFile } = calls.launch[0];
  const [work] = workDirs(w);
  assert.ok(work, 'the folder with the helper\'s copy stays: the helper removes it');
  assert.equal(helper, path.join(w.tmpRoot, work, 'apply-update.sh'), 'a copy of the helper, outside the app');
  assert.equal(fs.readFileSync(helper, 'utf8'), fs.readFileSync(HELPER, 'utf8'));
  assert.deepEqual(fs.readdirSync(path.join(w.tmpRoot, work)).sort(), ['apply-update.sh', 'mnt'], 'the image itself is deleted');
  assert.equal(cwd, w.tmpRoot, 'the helper runs from outside the app');
  assert.equal(logFile, w.logFile);
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('--target'), w.bundle);
  assert.equal(at('--staged'), w.staged);
  assert.equal(at('--keep'), w.cacheDir);
  assert.equal(at('--status'), w.statusFile);
  assert.equal(at('--from'), OLD);
  assert.equal(at('--to'), NEW);
  assert.equal(at('--pid'), '424242');
  assert.equal(at('--work'), path.join(w.tmpRoot, work));
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['--after-update', '--data-dir', w.dataDir],
    'reopened on the same data folder, and on Settings');

  // Until the helper writes its outcome, the next start knows one was under way.
  const status = readStatusFile(w.statusFile);
  assert.equal(status.outcome, 'started');
  assert.equal(status.from, OLD);
  assert.equal(status.to, NEW);
});

test('the Intel build for an Intel Mac, and never the Apple Silicon one', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  const { c, calls } = context(w, { chip: 'x64' });
  const job = await run(c);
  assert.equal(job.phase, 'restarting', job.error);
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`, 'asset:SHA256SUMS', `asset:${INTEL}`]);
  assert.equal(calls.exit, 1);
});

test('a release with only the other chip\'s build: refused, and nothing downloaded', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ assets: [{ name: INTEL, file: dmg.good }, { name: 'Six-Degrees-Mac-Apple-Silicon.dmg', file: dmg.good }] }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /no download for this Mac \(Apple Silicon\)/);
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`], 'neither the Intel build nor the fixed-name copy');
  assertUntouched(w, calls, job);
});

test('WRONG CHECKSUM: the download is refused and nothing is changed', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ sums: `${'0'.repeat(64)}  ${ARM}\n${'1'.repeat(64)}  ${INTEL}\n` }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /doesn't match the checksum published with it/);
  assert.ok(requested().includes(`asset:${ARM}`), 'it was downloaded, then refused');
  assertUntouched(w, calls, job);
});

test('NO SHA256SUMS: a release published without it is refused before any download', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ sums: null }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /without its checksum file \(SHA256SUMS\)/);
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`]);
  assertUntouched(w, calls, job);
});

test('a SHA256SUMS that doesn\'t list this build: refused before downloading it', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ sums: `${'1'.repeat(64)}  ${INTEL}\n` }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, new RegExp(`doesn't list ${ARM.replace(/\./g, '\\.')}`));
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`, 'asset:SHA256SUMS']);
  assertUntouched(w, calls, job);
});

test('WRONG BUNDLE ID: an image holding some other app is refused', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ assets: [{ name: ARM, file: dmg.wrongId }] }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /isn't Six Degrees \(it calls itself com\.example\.not-six-degrees\)/);
  assertUntouched(w, calls, job);
});

test('OLDER OR SAME VERSION: nothing is downloaded', { skip }, async (t) => {
  const w = world(t);
  for (const version of [OLD, '0.0.7']) {
    server.setRelease(release({ version, assets: [{ name: `Six-Degrees-${version}-arm64.dmg`, file: dmg.good }] }));
    const { c, calls } = context(w);
    const job = await run(c);
    assert.equal(job.phase, 'failed', version);
    assert.match(job.error, new RegExp(`You already have ${OLD.replace(/\./g, '\\.')}`));
    assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`], version);
    assertUntouched(w, calls, job);
  }
});

test('a pre-release is never installed, even if the release server calls it the latest', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ prerelease: true }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /test version/);
  assert.deepEqual(requested(), [`/repos/${SLUG}/releases/latest`]);
  assertUntouched(w, calls, job);
});

test('an image whose app says another version is refused (no downgrade by mislabelling)', { skip }, async (t) => {
  const w = world(t);
  // The release says 0.0.10, the app inside says 0.0.9.
  server.setRelease({ version: '0.0.10', assets: [{ name: 'Six-Degrees-0.0.10-arm64.dmg', file: dmg.good }] });
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /says it is version 0\.0\.9, not 0\.0\.10/);
  assertUntouched(w, calls, job);
});

test('a build for Apple Silicon only is refused on an Intel Mac, from its executable', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ assets: [{ name: INTEL, file: dmg.thin }] }));
  const { c, calls } = context(w, { chip: 'x64' });
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /built for Apple Silicon Macs, not this one/);
  assertUntouched(w, calls, job);
});

test('a Mac older than the new version needs is refused, with both versions named', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  const { c, calls } = context(w, { macosVersion: '13.4.1' });
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /needs macOS 13\.5 or later, and this Mac has 13\.4\.1/);
  assertUntouched(w, calls, job);
});

test('an app with a link pointing outside itself is refused (TRAPS §37)', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ assets: [{ name: ARM, file: dmg.escape }] }));
  const { c, calls } = context(w);
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /link that points outside it|signature doesn't check out/);
  assertUntouched(w, calls, job);
});

test('a scan that started meanwhile: the new version is thrown away and the app stays open', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  const { c, calls } = context(w, { scanRunning: () => true });
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /A scan started/);
  assertUntouched(w, calls, job);
});

test('a helper that refuses at once: the app stays open and says so (the real launch, clean environment)', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  // Two reasons for the real helper to refuse before doing anything: a target
  // that isn't an app, and a wait that isn't a number.
  const notAnApp = path.join(w.apps, 'Six Degrees.app.refuse');
  fs.renameSync(w.bundle, notAnApp);
  const { c, calls } = context(w, { bundle: notAnApp, waitSeconds: 'soon', launch: launchHelper, settleMs: 1500 });
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /The update helper stopped before the app closed \(Refusing: .*is not an app\.\)/);
  assert.equal(calls.exit, 0, 'the app keeps running');
  assert.equal(fs.existsSync(w.statusFile), false, 'no "started" left behind to misreport');
  assert.equal(fs.existsSync(path.join(w.apps, '.Six Degrees.app.refuse.incoming')), false, 'the staged copy is removed');
  assert.deepEqual(workDirs(w), []);
});

test('the helper starts on its own: a new session, outside the app, and none of this process\'s settings', { skip }, async (t) => {
  const w = world(t);
  const probe = path.join(w.root, 'probe.sh');
  const out = path.join(w.root, 'probe.out');
  fs.writeFileSync(probe, `#!/bin/bash
{ echo "pid=$$"; echo "pgid=$(ps -o pgid= -p $$ | tr -d ' ')"; echo "cwd=$(pwd -P)"; env; } > "$1.tmp"
mv "$1.tmp" "$1"
`);
  // Test switches in this process's environment must never reach it.
  process.env.SIX_DEGREES_UPDATER_TEST = '1';
  process.env.SIX_DEGREES_UPDATER_OPEN = '/usr/bin/true';
  t.after(() => { delete process.env.SIX_DEGREES_UPDATER_TEST; delete process.env.SIX_DEGREES_UPDATER_OPEN; });
  await launchHelper({ helper: probe, args: [out], cwd: w.tmpRoot, logFile: w.logFile });
  for (let i = 0; i < 100 && !fs.existsSync(out); i++) await sleep(20);
  const lines = fs.readFileSync(out, 'utf8').split('\n');
  const value = (k) => lines.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1);
  assert.equal(value('pgid'), value('pid'), 'its own process group, so it outlives the app');
  assert.equal(value('cwd'), fs.realpathSync(w.tmpRoot));
  assert.equal(value('PATH'), '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.deepEqual(lines.filter((l) => /^SIX_DEGREES_|^NODE_|^npm_/.test(l)), [], 'a clean environment');
});

test('a download that stops arriving is given up after the idle time, not a fixed total', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ stall: ARM }));
  const { c, calls } = context(w, { idleMs: 1500 });
  const job = await run(c);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /The download stopped for 2 seconds/);
  assert.ok(job.received > 0, 'part of it had arrived');
  assertUntouched(w, calls, job);
});

test('CANCEL mid-download: nothing is left behind, and a second install can\'t start meanwhile', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release({ stall: ARM }));
  const { c, calls } = context(w, { idleMs: 60000 });
  _resetUpdateForTesting();
  const { done } = startUpdate(c);
  for (let i = 0; i < 200 && !(currentUpdate().phase === 'downloading' && currentUpdate().received > 0); i++) await sleep(20);
  assert.equal(currentUpdate().phase, 'downloading');
  assert.match(startUpdate(c).error, /already in progress/);
  cancelUpdate();
  await done;
  const job = currentUpdate();
  assert.equal(job.phase, 'cancelled');
  assert.equal(job.error, null);
  assertUntouched(w, calls, job);
});

test('QUIT MID-UPDATE: the app quitting while the image is mounted leaves nothing mounted or half-copied', { skip }, async (t) => {
  const w = world(t);
  server.setRelease(release());
  // A server process of its own, which ends the way Next does on the app's
  // SIGTERM (process.exit(143)) the moment the image is mounted.
  const child = path.join(w.root, 'quit-mid-update.mjs');
  fs.writeFileSync(child, `
    import fs from 'node:fs';
    import path from 'node:path';
    import { startUpdate, currentUpdate } from ${JSON.stringify(new URL('../lib/updater-job.js', import.meta.url).href)};
    const c = JSON.parse(process.argv[2]);
    startUpdate({ ...c, fetchImpl: fetch, launch: async () => { throw new Error('never gets here'); }, exit: () => {} });
    const isMounted = (p) => { try { return fs.statSync(p).dev !== fs.statSync(path.dirname(p)).dev; } catch { return false; } };
    const timer = setInterval(() => {
      const work = fs.readdirSync(c.tmpRoot).find((f) => f.startsWith('six-degrees-update-'));
      if (work && isMounted(path.join(c.tmpRoot, work, 'mnt'))) {
        fs.writeFileSync(c.statusFile + '.saw-mount', work);
        process.exit(143);
      }
      if (currentUpdate()?.endedAt) { clearInterval(timer); process.exit(3); }
    }, 2);
  `);
  const { c } = context(w);
  const plainCtx = Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v !== 'function'));
  fs.mkdirSync(path.dirname(w.statusFile), { recursive: true });
  const code = await new Promise((resolve) => {
    const p = execFile(process.execPath, [child, JSON.stringify(plainCtx)], { timeout: 120000 }, () => {});
    p.on('exit', resolve);
  });
  assert.equal(code, 143, 'it quit while the image was mounted');
  assert.ok(fs.existsSync(`${w.statusFile}.saw-mount`));
  assert.equal(mountedUnder(w.root), false, 'the image was unmounted on the way out');
  assert.deepEqual(workDirs(w), [], 'the download folder is gone');
  assert.equal(fs.existsSync(w.staged), false, 'no half-copied app beside the real one');
});

test('the updater\'s own files: the cache and TMPDIR, never the data folder', () => {
  const p = updatePaths({ home: '/Users/me', tmp: '/var/folders/x/T' });
  assert.equal(p.cacheDir, '/Users/me/Library/Caches/Six Degrees');
  assert.equal(p.statusFile, '/Users/me/Library/Caches/Six Degrees/last-update.json');
  assert.equal(p.logFile, '/var/folders/x/T/six-degrees-update.log');
  for (const file of Object.values(p)) assert.equal(file.includes('.six-degrees'), false, file);
});
