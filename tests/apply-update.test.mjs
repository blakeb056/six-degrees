// scripts/apply-update.sh: the part of an update that runs after the app has
// quit. It must never leave someone without an app. Each case runs the real
// script against pretend apps in a temporary folder (never /Applications),
// with `open` swapped for a stand-in that records what it was asked to open and
// starts that app's pretend executable. The processes it waits for and stops
// are real ones, started from inside the pretend app.
//
// macOS only: the script uses ditto, xattr and lsof the way the Mac app does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('../scripts/apply-update.sh', import.meta.url));
const skip = process.platform !== 'darwin' && 'the helper is for the Mac app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A pretend Six Degrees.app. Its executable writes down which version started,
// with which arguments, the way the real app would receive them from `open`.
// Its bundle id is a test one: nothing here ever looks like the real app.
function makeApp(dir, version, { layout = 'electron', refuseToOpen = false } = {}) {
  const exe = layout === 'classic' ? 'six-degrees' : 'Six Degrees';
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Contents', 'Resources', layout === 'classic' ? 'app' : 'server'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.example.six-degrees-test</string>
  <key>CFBundleExecutable</key><string>${exe}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`);
  fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'VERSION'), `${version}\n`);
  if (refuseToOpen) fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'REFUSE_TO_OPEN'), '');
  const script = path.join(dir, 'Contents', 'MacOS', exe);
  fs.writeFileSync(script, `#!/bin/bash
here="$(cd "$(dirname "$0")/.." && pwd)"
{ cat "$here/Resources/VERSION"; for a in "$@"; do printf '%s\\n' "$a"; done; } > "$MARKERS/launched.tmp"
mv "$MARKERS/launched.tmp" "$MARKERS/launched"
`);
  fs.chmodSync(script, 0o755);
  return dir;
}

// A real process, stopped at the end of the test whatever happened.
function track(t, child) {
  child.ended = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  return child;
}

// Something that runs from inside an app, the way its server and helper
// processes do. `body` is bash.
function startInside(t, app, name, body) {
  const file = path.join(app, 'Contents', 'MacOS', name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return track(t, spawn('/bin/bash', [file], { env: { ...process.env, MARKERS: '' }, stdio: 'ignore' }));
}

function world(t, { folder = 'Applications' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-apply-'));
  t.after(() => {
    // Undo what the refusal cases lock, then remove everything.
    execFileSync('/bin/bash', ['-c', `chflags -R nouchg "$1" 2>/dev/null; chmod -R u+rwX "$1" 2>/dev/null; rm -rf "$1"`, '_', root]);
  });
  const apps = path.join(root, folder);
  const markers = path.join(root, 'markers');
  fs.mkdirSync(apps, { recursive: true });
  fs.mkdirSync(markers);
  const fakeOpen = path.join(root, 'fake-open.sh');
  fs.writeFileSync(fakeOpen, `#!/bin/bash
# Stands in for /usr/bin/open: note the call, refuse if the app says to, else start it.
app="$1"; shift
[ "\${1:-}" = "--args" ] && shift
{ printf '%s' "$app"; for a in "$@"; do printf '|%s' "$a"; done; printf '\\n'; } >> "$MARKERS/open-calls"
if [ -f "$app/Contents/Resources/REFUSE_TO_OPEN" ]; then
  echo "The application cannot be opened. (error -10810)" >&2
  exit 1
fi
exe="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")"
"$app/Contents/MacOS/$exe" "$@" &
exit 0
`);
  fs.chmodSync(fakeOpen, 0o755);
  return {
    root,
    target: path.join(apps, 'Six Degrees.app'),
    staged: path.join(apps, '.Six Degrees.app.incoming'),
    keep: path.join(root, 'Caches', 'Six Degrees'),
    status: path.join(root, 'Caches', 'Six Degrees', 'last-update.json'),
    markers,
    fakeOpen,
  };
}

function runHelper(w, args) {
  // Never anywhere but a temporary folder.
  assert.ok(w.target.startsWith(fs.realpathSync(os.tmpdir())) || w.target.startsWith(os.tmpdir()), w.target);
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [HELPER, ...args], {
      env: { ...process.env, SIX_DEGREES_UPDATER_TEST: '1', SIX_DEGREES_UPDATER_OPEN: w.fakeOpen, MARKERS: w.markers },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const started = Date.now();
    child.on('exit', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
}

const baseArgs = (w, from, to) => [
  '--target', w.target, '--staged', w.staged, '--keep', w.keep, '--status', w.status,
  '--from', from, '--to', to,
];
const versionAt = (app) => fs.readFileSync(path.join(app, 'Contents', 'Resources', 'VERSION'), 'utf8').trim();
const readStatus = (w) => JSON.parse(fs.readFileSync(w.status, 'utf8'));
const openCalls = (w) => {
  try { return fs.readFileSync(path.join(w.markers, 'open-calls'), 'utf8').trim().split('\n').map((l) => l.split('|')); }
  catch { return []; }
};
async function launched(w) {
  const file = path.join(w.markers, 'launched');
  for (let i = 0; i < 60 && !fs.existsSync(file); i++) await sleep(50);
  return fs.readFileSync(file, 'utf8').trim().split('\n');
}
const leftovers = (w) => fs.readdirSync(path.dirname(w.target)).filter((f) => f !== 'Six Degrees.app');
// What a kept zip holds, unpacked the way Archive Utility would.
function unzipKept(w, zip) {
  const out = fs.mkdtempSync(path.join(w.root, 'unzipped-'));
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, out]);
  return { entries: fs.readdirSync(out), app: path.join(out, 'Six Degrees.app') };
}

test('swaps the quit app for the new one, keeps the old one zipped, opens the new one and says so', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 0, r.out);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(leftovers(w), [], 'nothing hidden is left beside it');
  const kept = path.join(w.keep, 'Six Degrees 1.0.0.zip');
  const { entries, app } = unzipKept(w, kept);
  assert.deepEqual(entries, ['Six Degrees.app'], 'unzipping it gives back the app, by its own name');
  assert.equal(versionAt(app), '1.0.0', 'the previous version is kept');
  assert.deepEqual(fs.readdirSync(w.keep).sort(), ['Six Degrees 1.0.0.zip', 'last-update.json'], 'no app left in the cache, only the zip');
  const s = readStatus(w);
  assert.equal(s.outcome, 'installed');
  assert.equal(s.from, '1.0.0');
  assert.equal(s.to, '2.0.0');
  assert.equal(s.previous, kept);
  assert.deepEqual(openCalls(w), [[w.target, '--after-update']]);
  assert.deepEqual(await launched(w), ['2.0.0', '--after-update'], 'the new version was the one opened');
});

test('keeps one previous version: the next update replaces the kept copy', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  assert.equal((await runHelper(w, baseArgs(w, '1.0.0', '2.0.0'))).code, 0);
  makeApp(w.staged, '3.0.0');
  const r = await runHelper(w, baseArgs(w, '2.0.0', '3.0.0'));
  assert.equal(r.code, 0, r.out);
  assert.equal(versionAt(w.target), '3.0.0');
  assert.deepEqual(fs.readdirSync(w.keep).filter((f) => !f.endsWith('.json')), ['Six Degrees 2.0.0.zip']);
});

test('reopens on the same data folder: its arguments reach the new app intact', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const data = path.join(w.root, 'my data', "it's here");
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update', '--data-dir', data]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(await launched(w), ['2.0.0', '--after-update', '--data-dir', data]);
});

test('waits for a process still running from inside the old app before touching anything', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // It looks at the app it runs from as it finishes: still 1.0.0 means the
  // helper waited. (After a swap the same path would show 2.0.0.)
  const lingering = startInside(t, w.target, 'lingering',
    `sleep 1.5; cat "$(dirname "$0")/../Resources/VERSION" > "${w.markers}/lingering-saw"`);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(lingering.pid), '--wait', '20']);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(w.markers, 'lingering-saw'), 'utf8').trim(), '1.0.0');
  assert.ok(r.ms >= 1000, `it waited (${r.ms} ms)`);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(await lingering.ended, { code: 0, signal: null }, 'it ended by itself, not killed');
});

test('finds what runs from the old app by itself, with no --pid given', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Electron's helper processes: nobody names them, their command gives them away.
  const helper = startInside(t, w.target, 'Six Degrees Helper', `sleep 1.2; echo done > "${w.markers}/helper-done"`);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--wait', '20']);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(w.markers, 'helper-done')), 'the swap came after it finished');
  assert.deepEqual(await helper.ended, { code: 0, signal: null });
});

test('stops what will not go after --wait: SIGTERM first, then SIGKILL', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const stubborn = startInside(t, w.target, 'stubborn', "trap '' TERM; while :; do sleep 0.2; done");
  await sleep(200); // let it set its trap
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(stubborn.pid), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Asking them to stop/);
  assert.match(r.out, /Stopping them/);
  assert.equal((await stubborn.ended).signal, 'SIGKILL');
  assert.equal(versionAt(w.target), '2.0.0');
});

test('finds the server by its working folder (TRAPS §26), in the classic app, through a symlinked path', { skip }, async (t) => {
  const w = world(t);
  // os.tmpdir() is under /var, a symlink to /private/var: lsof reports the
  // real path, and the helper is given the other one, as a caller might.
  assert.notEqual(fs.realpathSync(w.root), w.root, 'the test needs a path with a symlink in it');
  makeApp(w.target, '1.0.0', { layout: 'classic' });
  makeApp(w.staged, '2.0.0');   // the Electron app replacing a classic one
  // Next renames its process, so its command line says nothing about where it
  // runs; only its working folder does. No --pid: the sweep must find it.
  const server = track(t, spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: path.join(w.target, 'Contents', 'Resources', 'app'), stdio: 'ignore',
  }));
  await sleep(300);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--wait', '1', '--grace', '3']);
  assert.equal(r.code, 0, r.out);
  assert.equal((await server.ended).signal, 'SIGTERM', 'asked to stop, and it did');
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(await launched(w), ['2.0.0']);
});

test('never stops a process that isn\'t the old app\'s, even one it was told to wait for', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Another copy of the app elsewhere, whose path ends the same way, and an
  // unrelated process handed over as a --pid (as a reused pid would be).
  const other = path.join(w.root, 'Elsewhere', 'Applications', 'Six Degrees.app');
  makeApp(other, '1.0.0');
  const otherCopy = startInside(t, other, 'running', 'while :; do sleep 0.2; done');
  const unrelated = track(t, spawn('/bin/sleep', ['30'], { stdio: 'ignore' }));
  await sleep(200);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(unrelated.pid), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Not waiting for \d+ any longer/);
  assert.doesNotMatch(r.out, /Asking them to stop|Stopping them/);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.equal(unrelated.exitCode, null, 'the unrelated process still runs');
  assert.equal(unrelated.signalCode, null);
  assert.equal(otherCopy.exitCode, null, 'the other copy of the app still runs');
  assert.equal(otherCopy.signalCode, null);
});

test('ROLLBACK: the new version can\'t be moved in, so the old one is put back and opened', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Make both ways in fail: a locked folder can't be renamed, and a file nobody
  // may read stops ditto half-way, leaving a partial copy at the target.
  const secret = path.join(w.staged, 'Contents', 'Resources', 'unreadable');
  fs.writeFileSync(secret, 'x');
  fs.chmodSync(secret, 0o000);
  execFileSync('/usr/bin/chflags', ['uchg', w.staged]);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 1, r.out);
  assert.equal(versionAt(w.target), '1.0.0', 'the old app is back where it was');
  assert.equal(fs.existsSync(path.join(w.target, 'Contents', 'Resources', 'unreadable')), false, 'no partial copy mixed in');
  const s = readStatus(w);
  assert.equal(s.outcome, 'rolled-back');
  assert.match(s.reason, /couldn't put the new version in place/);
  assert.deepEqual(openCalls(w), [[w.target, '--after-update']], 'the old one reopened, on Settings');
  assert.deepEqual(await launched(w), ['1.0.0', '--after-update']);
  assert.equal(fs.readdirSync(path.dirname(w.target)).some((f) => f.includes('.previous-')), false);
});

test('ROLLBACK: the new version won\'t open, so the old one is put back and opened', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { refuseToOpen: true });
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 1, r.out);
  assert.equal(versionAt(w.target), '1.0.0');
  const s = readStatus(w);
  assert.equal(s.outcome, 'rolled-back');
  assert.match(s.reason, /wouldn't open .*-10810/);
  assert.deepEqual(openCalls(w).map((c) => c[0]), [w.target, w.target], 'the new one tried, then the old one');
  assert.deepEqual(await launched(w), ['1.0.0', '--after-update']);
  assert.deepEqual(leftovers(w), [], 'the new version is not left behind');
  assert.equal(fs.existsSync(w.keep) && fs.readdirSync(w.keep).some((f) => f.endsWith('.zip')), false, 'nothing kept: nothing changed');
});

test('macOS won\'t let the old app be moved (App Management): nothing changes, and it reopens', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  execFileSync('/usr/bin/chflags', ['uchg', w.target]);  // stands in for a refusal by the system
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 1, r.out);
  assert.equal(versionAt(w.target), '1.0.0');
  const s = readStatus(w);
  assert.equal(s.outcome, 'not-applied');
  assert.match(s.reason, /didn't let Six Degrees move its old version aside/);
  assert.deepEqual(await launched(w), ['1.0.0', '--after-update']);
  assert.deepEqual(leftovers(w), [], 'the new version is removed, nothing hidden is left');
});

test('nothing to put in place: the old app is left as it was and reopened', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  const r = await runHelper(w, baseArgs(w, '1.0.0', '2.0.0'));
  assert.equal(r.code, 1, r.out);
  assert.equal(versionAt(w.target), '1.0.0');
  assert.equal(readStatus(w).outcome, 'not-applied');
  assert.deepEqual(await launched(w), ['1.0.0']);
});

test('refuses a target that is not an app, or numbers that aren\'t numbers, and touches nothing', { skip }, async (t) => {
  const w = world(t);
  const notApp = path.join(path.dirname(w.target), 'Documents');
  fs.mkdirSync(notApp);
  const r = await runHelper({ ...w, target: notApp }, [
    '--target', notApp, '--staged', w.staged, '--status', w.status, '--to', '2.0.0',
  ]);
  assert.equal(r.code, 2, r.out);
  assert.ok(fs.existsSync(notApp));
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  for (const extra of [['--wait', '1; rm -rf /'], ['--pid', '12 34'], ['--grace', '']]) {
    const bad = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), ...extra]);
    assert.equal(bad.code, 2, `${extra.join(' ')}: ${bad.out}`);
  }
  assert.equal(versionAt(w.target), '1.0.0');
  assert.equal(versionAt(w.staged), '2.0.0');
  assert.equal(fs.existsSync(w.status), false, 'no outcome written for a call that did nothing');
});

test('the status file stays valid JSON whatever the folder is called', { skip }, async (t) => {
  const w = world(t, { folder: 'Apps "quoted" and \\ back\tslash' });
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const r = await runHelper(w, baseArgs(w, '1.0.0', '2.0.0'));
  assert.equal(r.code, 0, r.out);
  assert.equal(readStatus(w).previous, path.join(w.keep, 'Six Degrees 1.0.0.zip'));
});
