// The Mac app's shell, the parts the in-app updater relies on
// (desktop/lib.mjs): how the app reads its server's exit, where its own
// bundle is, and the page it opens after an update. Kept apart from
// tests/desktop.test.mjs, which the data import's branch also extends, so the
// two merge without touching each other's tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serverExitAction, bundlePathFromExe, startPathArg, dataDirArg, UPDATE_HANDOFF_EXIT_CODE, RESTART_EXIT_CODE,
} from '../desktop/lib.mjs';

// When the server ends, the app says nothing (it is quitting anyway), quits
// quietly, starts it again, or reports a crash. TRAPS §39: Next turns a
// SIGTERM into exit code 143, so "stopped from outside" mostly arrives as a
// code, not a signal. The data import (75) and the updater (76) each have a
// code of their own, read by one decision.
test('the updater hands over with 76, and the app quits quietly, with no "Six Degrees stopped" dialog', () => {
  assert.equal(UPDATE_HANDOFF_EXIT_CODE, 76);
  assert.equal(serverExitAction({ code: UPDATE_HANDOFF_EXIT_CODE, signal: null, quitting: false }), 'quit');
  // Whatever the restart guard knows about this server, a hand-over is never held back.
  assert.equal(serverExitAction({ code: UPDATE_HANDOFF_EXIT_CODE, signal: null, quitting: false, answered: false }), 'quit');
});

test('REGRESSION: a server stopped from outside quits quietly, as a code (Next) or a signal', () => {
  // install.sh, or logging out, sends SIGTERM to the server too. Next catches it
  // and exits 143 (130 for SIGINT), which used to reach the "Six Degrees
  // stopped" dialog whenever the app hadn't started quitting first.
  for (const code of [143, 130]) assert.equal(serverExitAction({ code, signal: null, quitting: false }), 'quit', String(code));
  for (const signal of ['SIGKILL', 'SIGTERM']) assert.equal(serverExitAction({ code: null, signal, quitting: false }), 'quit', signal);
});

test('the data import\'s 75 is a restart, never the updater\'s quiet quit', () => {
  assert.equal(RESTART_EXIT_CODE, 75);
  assert.notEqual(RESTART_EXIT_CODE, UPDATE_HANDOFF_EXIT_CODE);
  assert.equal(serverExitAction({ code: RESTART_EXIT_CODE, signal: null, quitting: false }), 'restart');
  assert.equal(serverExitAction({ code: RESTART_EXIT_CODE, signal: null, quitting: false, answered: false }), 'report');
});

test('while the app quits anyway, the server ending is expected; any other exit is a crash, and is reported', () => {
  for (const code of [0, 1, 75, 76, 130, 143]) {
    assert.equal(serverExitAction({ code, signal: null, quitting: true }), 'ignore', String(code));
  }
  for (const code of [0, 1, 2, 74, 77, 137, 255]) {
    assert.equal(serverExitAction({ code, signal: null, quitting: false }), 'report', String(code));
  }
});

test('the app bundle, from Electron\'s own executable path', () => {
  assert.equal(bundlePathFromExe('/Applications/Six Degrees.app/Contents/MacOS/Six Degrees'), '/Applications/Six Degrees.app');
  assert.equal(bundlePathFromExe('/Users/me/Apps/Six Degrees (beta).app/Contents/MacOS/Six Degrees'), '/Users/me/Apps/Six Degrees (beta).app');
  assert.equal(bundlePathFromExe('/usr/local/bin/electron'), null, 'run from a checkout: no bundle');
  assert.equal(bundlePathFromExe(undefined), null);
});

test('after an update the app opens on Settings, where the outcome is shown', () => {
  assert.equal(startPathArg(['/Applications/Six Degrees.app/Contents/MacOS/Six Degrees', '--after-update']), '/settings#updates');
  assert.equal(startPathArg(['x', '--after-update', '--data-dir', '/tmp/copy']), '/settings#updates');
  assert.equal(startPathArg(['x', '--data-dir', '/tmp/copy']), null);
});

// dataDirArg is the data branch's (a relative --data-dir made absolute), kept
// word for word so the two branches merge into one copy. What the updater
// needs of it: the folder it reopens the new version with (always absolute,
// lib/updater.js relaunchArgs) arrives exactly as it was sent.
test('the data folder the updater reopens the app with arrives as it was sent', () => {
  const dir = '/Users/someone/Six Degrees data/it\'s here';
  assert.equal(dataDirArg(['/Applications/Six Degrees.app/Contents/MacOS/Six Degrees', '--after-update', '--data-dir', dir], { cwd: '/', home: '/Users/someone' }), dir);
  // A relative one typed by hand is taken from where the app was started, or
  // from the home folder when that is / (as with `open`), never from inside the app.
  assert.equal(dataDirArg(['x', '--data-dir', 'copy'], { cwd: '/', home: '/Users/someone' }), '/Users/someone/copy');
  assert.equal(dataDirArg(['x', '--data-dir=copy'], { cwd: '/Users/someone/work', home: '/Users/someone' }), '/Users/someone/work/copy');
});
