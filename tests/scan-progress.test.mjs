// The Scan page's progress bar reads scrape.py's own output. These pin the
// formats it prints, so a change of wording there fails here instead of the
// bar quietly freezing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanProgress } from '../lib/scan-progress.js';

test('nothing measurable yet', () => {
  assert.equal(scanProgress([], 'full'), null);
  assert.equal(scanProgress(['Scanning your whole network…', 'Opening connections page...'], 'full'), null);
});

test('the total is known before anyone is collected', () => {
  const log = ['Opening connections page...', '  LinkedIn reports 817 connections'];
  assert.deepEqual(scanProgress(log, 'full'), { done: 0, total: 817, kind: 'walk' });
});

test('the latest "collected" line wins', () => {
  const log = [
    '  LinkedIn reports 817 connections',
    '  50 / 817 collected',
    '  100 / 817 collected',
    '  150 / 817 collected',
  ];
  assert.deepEqual(scanProgress(log, 'full'), { done: 150, total: 817, kind: 'walk' });
});

test('the end of a walk reads as complete', () => {
  const log = ['  800 / 817 collected', '  Collected all 817 connections.'];
  assert.deepEqual(scanProgress(log, 'full'), { done: 817, total: 817, kind: 'walk' });
});

test('a count past the reported total is capped', () => {
  assert.deepEqual(scanProgress(['  850 / 817 collected'], 'refresh'), { done: 817, total: 817, kind: 'walk' });
});

test('2nd-degree batches count finished people, not the one starting', () => {
  const log = [
    'Stopping after 10 this run.',
    '[1/10] Alex Example (S-tier, score 8.1)',
    '[2/10] Sam Example (A-tier, score 6.4)',
    '[3/10] Jo Example (A-tier, score 6.0)',
  ];
  assert.deepEqual(scanProgress(log, 'auto-bridge'), { done: 2, total: 10, current: 3, kind: 'batch' });
  assert.deepEqual(scanProgress(log, 'auto-bridge-retry').current, 3);
});

test('other actions have no bar', () => {
  assert.equal(scanProgress(['  50 / 817 collected'], 'login'), null);
  assert.equal(scanProgress(['[1/10] Someone'], 'install'), null);
});
