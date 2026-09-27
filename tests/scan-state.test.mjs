// lib/scan-state.js: other routes (an import, a restart, an update) must be able
// to ask whether the scanner is running, and get the same answer the scanner's
// own route sees, however many times its module is evaluated. And a refusal
// says what is running: Install and Set up the scanner aren't scans.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerScanState, scanIsRunning, scannerJob, runningNow, busyRefusal } from '../lib/scan-state.js';

test('nothing registered yet reads as not running', () => {
  assert.equal(scanIsRunning(), false);
  assert.equal(scannerJob(), null);
  assert.equal(busyRefusal('Then do it.'), null);
});

test('the registered object is the one every reader sees, even if the route loads twice', () => {
  const first = registerScanState({ running: false });
  const second = registerScanState({ running: false });   // e.g. a second bundle of the route
  assert.equal(first, second);
  first.running = true;
  assert.equal(scanIsRunning(), true);
  second.running = false;
  assert.equal(scanIsRunning(), false);
});

test('what runs is named: a scan, the scanner\'s setup, or the sign-in window', () => {
  const state = registerScanState({ running: false, action: null });
  try {
    for (const [action, words] of [
      ['full', 'A scan is running'],
      ['auto-bridge', 'A scan is running'],
      ['resume-all', 'A scan is running'],
      ['company', 'A scan is running'],
      ['install', 'The scanner\'s packages are being installed'],
      ['setup', 'The scanner is being set up'],
      ['login', 'The LinkedIn sign-in window is open'],
    ]) {
      Object.assign(state, { running: true, action });
      assert.equal(scannerJob(), action);
      assert.equal(busyRefusal('Stop it on the Scan page first, then restart.'),
        `${words}. Stop it on the Scan page first, then restart.`, action);
    }
    // Running with no action recorded still refuses, as a scan.
    Object.assign(state, { running: true, action: null });
    assert.equal(scannerJob(), 'scan');
    assert.match(busyRefusal('Then import.'), /^A scan is running\. Then import\.$/);
    // Finished: nothing to refuse for, whatever the last action was.
    Object.assign(state, { running: false, action: 'install' });
    assert.equal(scannerJob(), null);
    assert.equal(busyRefusal('Then import.'), null);
  } finally {
    Object.assign(state, { running: false, action: null });
  }
  // A caller that only knows something runs gets the old words.
  assert.equal(runningNow(true), 'A scan is running');
});

test('no refusal says "A scan is running" by itself: each asks what runs', () => {
  // The four places that refused with "A scan is running" while Install or
  // Set up the scanner ran. Each now takes its words from scan-state.
  for (const file of ['app/api/update/route.js', 'lib/updater-job.js', 'lib/data-import.js',
    'app/api/data/restart/route.js', 'app/api/data/import/route.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /A scan (is running|started)/, file);
    assert.match(source, /busyRefusal\(|runningNow\(/, file);
  }
});
