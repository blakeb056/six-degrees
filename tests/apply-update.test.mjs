// scripts/apply-update.sh: the part of an update that runs after the app has
// quit. It must never leave someone without an app, and never stop anything
// that isn't the app. Each case runs the real script against pretend apps in a
// temporary folder (never /Applications), with `open` swapped for a stand-in
// that records what it was asked to open and starts that app's pretend
// executable. It runs with exactly the environment the server gives it
// (lib/updater-job.js helperEnv), plus the test switches.
//
// The processes it waits for and stops are real ones started here, and only
// ever those: a process "of the app" is one whose executable is a copy of this
// Node binary placed inside a pretend app in the temporary folder (a clone, so
// it costs no space). Copies of the system's own programs can't stand in: macOS
// kills them when they run from anywhere else.
//
// macOS only: the script uses ditto, xattr and lsof the way the Mac app does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperEnv } from '../lib/updater-job.js';

const HELPER = fileURLToPath(new URL('../scripts/apply-update.sh', import.meta.url));
const skip = process.platform !== 'darwin' && 'the helper is for the Mac app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A pretend Six Degrees.app. Its executable writes down which version started,
// with which arguments, the way the real app would receive them from `open`,
// and then does what the real one's server does on its first page: says it
// has started (lib/updater-job.js confirmStarted). Unless told otherwise:
//   refuseToOpen  `open` fails on it
//   closeEarly    it opens, and closes before saying it has started
//   stay          it keeps running for a few seconds without saying so
//   stayByName    the same, as a program that isn't the app's but was started
//                 by a path inside it (argv[0]), which lsof's executable misses
// Its bundle id is a test one: nothing here ever looks like the real app.
function makeApp(dir, version, {
  layout = 'electron', refuseToOpen = false, closeEarly = false, stay = false, stayByName = false,
} = {}) {
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
  if (closeEarly) fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'CLOSE_EARLY'), '');
  if (stay) {
    fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'STAY'), '');
    nodeInside(dir, path.join('Contents', 'Resources', 'node'));
  }
  if (stayByName) fs.writeFileSync(path.join(dir, 'Contents', 'Resources', 'STAY_BY_NAME'), '');
  const script = path.join(dir, 'Contents', 'MacOS', exe);
  fs.writeFileSync(script, `#!/bin/bash
here="$(cd "$(dirname "$0")/.." && pwd)"
{ cat "$here/Resources/VERSION"; for a in "$@"; do printf '%s\\n' "$a"; done; } > "$MARKERS/launched.tmp"
mv "$MARKERS/launched.tmp" "$MARKERS/launched"
[ -f "$here/Resources/CLOSE_EARLY" ] && exit 0
if [ -f "$here/Resources/STAY" ]; then exec "$here/Resources/node" -e 'setTimeout(() => {}, 7000)'; fi
if [ -f "$here/Resources/STAY_BY_NAME" ]; then exec -a "$here/MacOS/Six Degrees" /bin/sleep 6; fi
if [ -n "\${CONFIRM:-}" ]; then
  mkdir -p "$(dirname "$CONFIRM")"
  printf '{"version":"%s","pid":%s}\\n' "$(cat "$here/Resources/VERSION")" "$$" > "$CONFIRM"
fi
exit 0
`);
  fs.chmodSync(script, 0o755);
  return dir;
}

// A copy of this Node binary at `rel` inside an app: a real program whose
// executable is inside the app, as the app's own node server and Electron's
// helper processes are.
function nodeInside(app, rel) {
  const file = path.join(app, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(process.execPath, file, fs.constants.COPYFILE_FICLONE);
  return file;
}

// A real process, stopped at the end of the test whatever happened. Only
// processes started here are ever tracked, and only they are ever stopped.
function track(t, child) {
  child.ended = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  return child;
}
const running = (child) => child.exitCode === null && child.signalCode === null;

// A program of the app, running: its executable is inside the app. `code` is JavaScript.
function startExeInside(t, app, rel, code) {
  return track(t, spawn(nodeInside(app, rel), ['-e', code], { stdio: 'ignore' }));
}

// A bash script inside the app, run by /bin/bash (so its executable is not the
// app's): how a process the server names (--pid) is stood in for.
function startScriptInside(t, app, name, body, { cwd } = {}) {
  const file = path.join(app, 'Contents', 'MacOS', name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return track(t, spawn('/bin/bash', [file], { env: { ...process.env, MARKERS: '' }, stdio: 'ignore', cwd }));
}

const IGNORES_TERM = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
const ENDS_ON_TERM = 'setInterval(() => {}, 1000)';

function world(t, { folder = 'Applications' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-apply-'));
  t.after(() => {
    // Undo what the refusal cases lock, then remove everything.
    execFileSync('/bin/bash', ['-c', 'chflags -R nouchg "$1" 2>/dev/null; chmod -R u+rwX "$1" 2>/dev/null; rm -rf "$1"', '_', root]);
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
  # One case also locks the old app where it was moved aside, so it can't be put back.
  if [ -n "\${LOCK_ASIDE:-}" ]; then chflags uchg "$(dirname "$app")"/.Six\\ Degrees.app.previous-*; fi
  echo "The application cannot be opened. (error -10810)" >&2
  exit 1
fi
exe="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$app/Contents/Info.plist")"
# Like LaunchServices: the app gets none of the caller's output, so a caller
# reading it isn't held open for as long as the app runs.
"$app/Contents/MacOS/$exe" "$@" </dev/null >/dev/null 2>&1 &
exit 0
`);
  fs.chmodSync(fakeOpen, 0o755);
  const cache = path.join(root, 'Caches', 'Six Degrees');
  return {
    root,
    apps,
    target: path.join(apps, 'Six Degrees.app'),
    staged: path.join(apps, '.Six Degrees.app.incoming'),
    keep: cache,
    status: path.join(cache, 'last-update.json'),
    confirm: path.join(cache, 'update-confirmed.json'),
    markers,
    fakeOpen,
  };
}

// The helper, with the server's environment (helperEnv) and the test switches.
// `prelude` is bash run first in the same process, which then becomes the
// helper (exec keeps the pid): how a test knows the pid the helper names
// things after.
function runHelper(w, args, { env = {}, prelude = null } = {}) {
  // Never anywhere but a temporary folder.
  assert.ok(w.target.startsWith(fs.realpathSync(os.tmpdir())) || w.target.startsWith(os.tmpdir()), w.target);
  const argv = prelude ? ['-c', `${prelude}\nexec /bin/bash "$0" "$@"`, HELPER, ...args] : [HELPER, ...args];
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', argv, {
      env: {
        ...helperEnv(),
        SIX_DEGREES_UPDATER_TEST: '1', SIX_DEGREES_UPDATER_OPEN: w.fakeOpen, MARKERS: w.markers, CONFIRM: w.confirm, APPS: w.apps,
        ...env,
      },
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const started = Date.now();
    child.on('exit', (code) => resolve({ code, out, pid: child.pid, ms: Date.now() - started }));
  });
}

// What the server passes, the way it passes it (lib/updater.js helperArgs).
// `keep: false` for cases whose old app holds a Node binary, which would only
// slow the zip down.
const baseArgs = (w, from, to, { keep = true, confirmWait = 20 } = {}) => [
  '--target', w.target, '--staged', w.staged, ...(keep ? ['--keep', w.keep] : []), '--status', w.status,
  '--from', from, '--to', to, '--confirm', w.confirm, '--confirm-wait', String(confirmWait),
];
const versionAt = (app) => fs.readFileSync(path.join(app, 'Contents', 'Resources', 'VERSION'), 'utf8').trim();
const readStatus = (w) => JSON.parse(fs.readFileSync(w.status, 'utf8'));
const openCalls = (w) => {
  try { return fs.readFileSync(path.join(w.markers, 'open-calls'), 'utf8').trim().split('\n').map((l) => l.split('|')); }
  catch { return []; }
};
// What the last app opened was told. `version`: wait for that one to have
// opened, when another opened first (the new version, before a rollback).
async function launched(w, version = null) {
  const file = path.join(w.markers, 'launched');
  const read = () => { try { return fs.readFileSync(file, 'utf8').trim().split('\n'); } catch { return null; } };
  for (let i = 0; i < 100; i++) {
    const lines = read();
    if (lines && (!version || lines[0] === version)) return lines;
    await sleep(50);
  }
  return read();
}
const leftovers = (w) => fs.readdirSync(path.dirname(w.target)).filter((f) => f !== 'Six Degrees.app');
// What a kept zip holds, unpacked the way Archive Utility would.
function unzipKept(w, zip) {
  const out = fs.mkdtempSync(path.join(w.root, 'unzipped-'));
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, out]);
  return { entries: fs.readdirSync(out), app: path.join(out, 'Six Degrees.app') };
}

test('swaps the quit app for the new one, waits for it to start, keeps the old one zipped and says so', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /The new version has started/);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(leftovers(w), [], 'nothing hidden is left beside it');
  const kept = path.join(w.keep, 'Six Degrees 1.0.0.zip');
  const { entries, app } = unzipKept(w, kept);
  assert.deepEqual(entries, ['Six Degrees.app'], 'unzipping it gives back the app, by its own name');
  assert.equal(versionAt(app), '1.0.0', 'the previous version is kept');
  assert.deepEqual(fs.readdirSync(w.keep).sort(), ['Six Degrees 1.0.0.zip', 'last-update.json'],
    'no app left in the cache, only the zip; the new version\'s word is cleared away');
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

test('waits for a process the server named before touching anything', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // It looks at the app it runs from as it finishes: still 1.0.0 means the
  // helper waited. (After a swap the same path would show 2.0.0.)
  const lingering = startScriptInside(t, w.target, 'lingering',
    `sleep 1.5; cat "$(dirname "$0")/../Resources/VERSION" > "${w.markers}/lingering-saw"`);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(lingering.pid), '--wait', '20']);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(path.join(w.markers, 'lingering-saw'), 'utf8').trim(), '1.0.0');
  assert.ok(r.ms >= 1000, `it waited (${r.ms} ms)`);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(await lingering.ended, { code: 0, signal: null }, 'it ended by itself, not killed');
});

test('finds what runs the app\'s own executables by itself, with no --pid given, and waits for it', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Electron's helper processes: nobody names them, their executable gives them away.
  const done = path.join(w.markers, 'helper-done');
  const helper = startExeInside(t, w.target, 'Contents/Frameworks/Six Degrees Helper.app/Contents/MacOS/Six Degrees Helper',
    `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(done)}, 'done'), 1200)`);
  await sleep(300);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { keep: false }), '--wait', '20']);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(done), 'the swap came after it finished');
  assert.deepEqual(await helper.ended, { code: 0, signal: null });
});

test('REGRESSION (M1): stops only what runs the app\'s own executables; a Terminal in the app\'s folder and a `tail -f` of a file in it are left alone', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Someone's shell, sitting in the app's folder. Interactive shells ignore SIGTERM.
  const shell = track(t, spawn('/bin/bash', ['-c', "trap '' TERM; while :; do sleep 0.2; done"],
    { cwd: path.join(w.target, 'Contents', 'Resources', 'server'), stdio: 'ignore' }));
  // Someone reading a file inside the app.
  const tail = track(t, spawn('/usr/bin/tail', ['-f', path.join(w.target, 'Contents', 'Info.plist')], { stdio: 'ignore' }));
  // The app's own: its server's node, which won't go on SIGTERM, and a helper process, which does.
  const server = startExeInside(t, w.target, 'Contents/Resources/node', IGNORES_TERM);
  const helper = startExeInside(t, w.target, 'Contents/Frameworks/Six Degrees Helper.app/Contents/MacOS/Six Degrees Helper', ENDS_ON_TERM);
  await sleep(400);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { keep: false }), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.equal((await server.ended).signal, 'SIGKILL', 'SIGTERM first, then SIGKILL');
  assert.equal((await helper.ended).signal, 'SIGTERM');
  assert.ok(running(shell), 'the shell in the app\'s folder still runs');
  assert.ok(running(tail), 'the tail -f still runs');
  assert.equal(versionAt(w.target), '2.0.0');
});

test('stops a process the server named that won\'t go after --wait: SIGTERM first, then SIGKILL', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const stubborn = startScriptInside(t, w.target, 'stubborn', "trap '' TERM; while :; do sleep 0.2; done");
  await sleep(200); // let it set its trap
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(stubborn.pid), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Asking them to stop/);
  assert.match(r.out, /Stopping them/);
  assert.equal((await stubborn.ended).signal, 'SIGKILL');
  assert.equal(versionAt(w.target), '2.0.0');
});

test('finds the server by its executable whatever it calls itself (TRAPS §26), in the classic app, through a symlinked path', { skip }, async (t) => {
  const w = world(t);
  // os.tmpdir() is under /var, a symlink to /private/var: lsof reports the
  // real path, and the helper is given the other one, as a caller might.
  assert.notEqual(fs.realpathSync(w.root), w.root, 'the test needs a path with a symlink in it');
  makeApp(w.target, '1.0.0', { layout: 'classic' });
  makeApp(w.staged, '2.0.0');   // the Electron app replacing a classic one
  // Next renames its process, so its command line says nothing about where it
  // runs; its executable, the app's own node, does. No --pid: the helper finds it.
  const server = startExeInside(t, w.target, 'Contents/Resources/node',
    "process.title = 'next-server (v16.3.6)'; setInterval(() => {}, 1000)");
  await sleep(300);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { keep: false }), '--wait', '1', '--grace', '3']);
  assert.equal(r.code, 0, r.out);
  assert.equal((await server.ended).signal, 'SIGTERM', 'asked to stop, and it did');
  assert.equal(versionAt(w.target), '2.0.0');
  assert.deepEqual(await launched(w), ['2.0.0']);
});

test('never stops a process that isn\'t the old app\'s, even one it was told to wait for, or another copy of the app', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Another copy of the app elsewhere, whose path ends the same way, running
  // its own node; and an unrelated process handed over as a --pid (as a reused pid would be).
  const other = path.join(w.root, 'Elsewhere', 'Applications', 'Six Degrees.app');
  makeApp(other, '1.0.0');
  const otherCopy = startExeInside(t, other, 'Contents/Resources/node', ENDS_ON_TERM);
  const unrelated = track(t, spawn('/bin/sleep', ['30'], { stdio: 'ignore' }));
  await sleep(300);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--pid', String(unrelated.pid), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Not waiting for \d+ any longer/);
  assert.doesNotMatch(r.out, /Asking them to stop|Stopping them/);
  assert.equal(versionAt(w.target), '2.0.0');
  assert.ok(running(unrelated), 'the unrelated process still runs');
  assert.ok(running(otherCopy), 'the other copy of the app still runs');
});

test('REGRESSION: an app in a folder whose name isn\'t plain ASCII is found and stopped, with the server\'s environment', { skip }, async (t) => {
  // Without a UTF-8 locale, ps and lsof print "Été" as escapes, nothing
  // matched, and the app was swapped while it still ran (TRAPS §40).
  assert.equal(helperEnv().LC_ALL, 'en_US.UTF-8');
  const w = world(t, { folder: 'Programmes Été' });
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const server = startExeInside(t, w.target, 'Contents/Resources/node', IGNORES_TERM);
  // And one the server names, sitting in the app's folder, as the server itself does.
  const named = startScriptInside(t, w.target, 'stuck', "trap '' TERM; while :; do sleep 0.2; done",
    { cwd: path.join(w.target, 'Contents', 'Resources', 'server') });
  await sleep(400);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { keep: false }),
    '--pid', String(named.pid), '--wait', '1', '--grace', '1']);
  assert.equal(r.code, 0, r.out);
  assert.equal((await server.ended).signal, 'SIGKILL');
  assert.equal((await named.ended).signal, 'SIGKILL');
  assert.equal(versionAt(w.target), '2.0.0');
});

test('REGRESSION: an app that can\'t be stopped: nothing changes, and it is opened again', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  // Something outside the app keeps starting one of the app's programs again,
  // the way a copy this user can't stop would stay.
  const child = nodeInside(w.target, 'Contents/MacOS/Six Degrees Helper');
  const supervisor = spawn('/bin/bash', ['-c',
    `trap 'kill "$c" 2>/dev/null; exit 0' TERM; while :; do "$0" -e 'setTimeout(() => {}, 20000)' & c=$!; wait "$c"; done`, child],
  { stdio: 'ignore' });
  t.after(async () => {
    try { supervisor.kill('SIGTERM'); } catch { /* gone */ }
    await sleep(300);
    try { supervisor.kill('SIGKILL'); } catch { /* gone */ }
  });
  await sleep(500);
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { keep: false }), '--wait', '1', '--grace', '1', '--', '--after-update']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Could not stop/);
  const s = readStatus(w);
  assert.equal(s.outcome, 'not-applied');
  assert.match(s.reason, /the old version didn't close/);
  assert.deepEqual(openCalls(w), [[w.target, '--after-update']], 'the app it closed is opened again');
  assert.deepEqual(await launched(w), ['1.0.0', '--after-update']);
  assert.equal(versionAt(w.target), '1.0.0');
  assert.equal(fs.existsSync(w.staged), false, 'the new version is removed');
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
  assert.equal(leftovers(w).some((f) => f.includes('.previous-') || f.includes('.failed-')), false,
    'the partial copy is removed once the old app is back');
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

test('ROLLBACK: the new version opens but closes before it has started, so the old one is put back and opened', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { closeEarly: true });
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), '--', '--after-update']);
  assert.equal(r.code, 1, r.out);
  assert.equal(versionAt(w.target), '1.0.0');
  const s = readStatus(w);
  assert.equal(s.outcome, 'rolled-back');
  assert.equal(s.reason, 'the new version closed before it finished starting');
  assert.deepEqual(openCalls(w).map((c) => c[0]), [w.target, w.target], 'the new one opened, then the old one');
  assert.deepEqual(await launched(w, '1.0.0'), ['1.0.0', '--after-update']);
  assert.deepEqual(leftovers(w), [], 'the new version is not left behind, nor the old one\'s hiding place');
  assert.equal(fs.existsSync(w.keep) && fs.readdirSync(w.keep).some((f) => f.endsWith('.zip')), false);
});

test('a new version that runs but never says it has started is left running once --confirm-wait is over, and the old one kept', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { stay: true });
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { confirmWait: 3 }), '--', '--after-update']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hasn't said it has started after 3s/);
  assert.equal(versionAt(w.target), '2.0.0', 'nothing is taken from a version that is running');
  const s = readStatus(w);
  assert.equal(s.outcome, 'installed');
  assert.equal(s.previous, path.join(w.keep, 'Six Degrees 1.0.0.zip'), 'the old version is kept, the way back');
  assert.equal(versionAt(unzipKept(w, s.previous).app), '1.0.0');
  assert.deepEqual(leftovers(w), []);
});

test('a new version that runs is never taken for closed: a look by its path counts too, so no rollback while it runs', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { stayByName: true });
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0', { confirmWait: 4 }), '--', '--after-update']);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /closed before it finished starting/);
  assert.equal(readStatus(w).outcome, 'installed');
  assert.equal(versionAt(w.target), '2.0.0');
});

test('REGRESSION: an earlier update\'s leftovers beside the app are never used as names, or touched', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { refuseToOpen: true });   // a rollback uses both names
  // Folders an earlier run left under exactly the names this run will pick
  // (its pid came round again). `mv app aside` would have put the app *inside* one.
  const prelude = 'for k in previous failed; do d="$APPS/.Six Degrees.app.$k-$$"; mkdir -p "$d/Contents/Resources"; echo 0.9.0 > "$d/Contents/Resources/VERSION"; done';
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0')], { prelude });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`previous-${r.pid}-2`), 'the old app went to a free name');
  assert.equal(readStatus(w).outcome, 'rolled-back');
  assert.equal(versionAt(w.target), '1.0.0', 'the old app is back, whole, not inside anything');
  assert.deepEqual(fs.readdirSync(w.target), ['Contents']);
  for (const k of ['previous', 'failed']) {
    const d = path.join(w.apps, `.Six Degrees.app.${k}-${r.pid}`);
    assert.equal(versionAt(d), '0.9.0', `${k}: left as it was`);
    assert.deepEqual(fs.readdirSync(d), ['Contents'], `${k}: nothing moved into it`);
  }
});

test('REGRESSION: when the old app can\'t be put back, the new version isn\'t deleted either, and the report says where the old one is', { skip }, async (t) => {
  const w = world(t);
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0', { refuseToOpen: true });
  // `open` fails, and the old app's hiding place is locked just then, so it can't be moved back.
  const r = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0')], { env: { LOCK_ASIDE: '1' } });
  assert.equal(r.code, 1, r.out);
  const s = readStatus(w);
  assert.equal(s.outcome, 'failed');
  assert.match(s.reason, /wouldn't open .*putting the previous version back failed too/);
  assert.equal(path.dirname(s.previous), w.apps);
  assert.match(path.basename(s.previous), /^\.Six Degrees\.app\.previous-\d+$/);
  assert.equal(versionAt(s.previous), '1.0.0', 'the old app is whole where the report says');
  const failed = leftovers(w).filter((f) => f.includes('.failed-'));
  assert.equal(failed.length, 1);
  assert.equal(versionAt(path.join(w.apps, failed[0])), '2.0.0', 'the new version was moved aside, not deleted');
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

test('refuses a target that is not an app, numbers that aren\'t numbers, or files it would remove that aren\'t its own, and touches nothing', { skip }, async (t) => {
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
  // Something precious where --staged points: the staged folder is removed after use, so only its own is accepted.
  const precious = path.join(w.root, 'Precious');
  fs.mkdirSync(path.join(precious, 'Contents'), { recursive: true });
  const outside = path.join(w.root, 'elsewhere', 'update-confirmed.json');
  for (const bad of [
    ['--wait', '1; rm -rf /'], ['--pid', '12 34'], ['--grace', ''], ['--confirm-wait', '1m'],
    ['--staged', precious], ['--staged', `${w.staged}/..`], ['--confirm', path.join(w.root, 'notes.txt')],
    ['--confirm', 'update-confirmed.json'], ['--keep', 'relative/cache'],
  ]) {
    const bad2 = await runHelper(w, [...baseArgs(w, '1.0.0', '2.0.0'), ...bad]);
    assert.equal(bad2.code, 2, `${bad.join(' ')}: ${bad2.out}`);
  }
  assert.ok(fs.existsSync(path.join(precious, 'Contents')), 'never removed');
  assert.equal(versionAt(w.target), '1.0.0');
  assert.equal(versionAt(w.staged), '2.0.0');
  assert.equal(fs.existsSync(w.status), false, 'no outcome written for a call that did nothing');
  assert.equal(fs.existsSync(outside), false);
});

test('the status file stays valid JSON whatever the folder is called', { skip }, async (t) => {
  const w = world(t, { folder: 'Apps "quoted" and \\ back\tslash' });
  makeApp(w.target, '1.0.0');
  makeApp(w.staged, '2.0.0');
  const r = await runHelper(w, baseArgs(w, '1.0.0', '2.0.0'));
  assert.equal(r.code, 0, r.out);
  assert.equal(readStatus(w).previous, path.join(w.keep, 'Six Degrees 1.0.0.zip'));
});
