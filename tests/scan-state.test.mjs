// lib/scan-state.js: other routes (an import, a restart, an update) must be able
// to ask whether the scanner is running, and get the same answer the scanner's
// own route sees, however many times its module is evaluated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerScanState, scanIsRunning } from '../lib/scan-state.js';

test('nothing registered yet reads as not running', () => {
  assert.equal(scanIsRunning(), false);
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
