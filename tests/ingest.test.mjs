// Preparing a scraped batch for the database. The failure these pin: one repeated
// profile made the whole insert fail, so a bridge's people were read and not saved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueByProfile, splitAlreadyConnected } from '../lib/ingest.js';

const rec = (url, name = 'Someone') => ({ profile_url: url, name });

test('a repeated profile is kept once, first occurrence wins', () => {
  const out = uniqueByProfile([rec('/in/a/', 'A1'), rec('/in/b/'), rec('/in/a/', 'A2'), rec('/in/c/'), rec('/in/b/')]);
  assert.deepEqual(out.map((r) => r.profile_url), ['/in/a/', '/in/b/', '/in/c/']);
  assert.equal(out[0].name, 'A1');
});

test('records without a profile are dropped rather than inserted', () => {
  assert.deepEqual(uniqueByProfile([rec(''), rec(null), rec('/in/x/')]).map((r) => r.profile_url), ['/in/x/']);
});

test('your own connections are set aside from someone else\'s circle', () => {
  const { keep, alreadyConnected } = splitAlreadyConnected(
    [rec('/in/mutual/'), rec('/in/stranger/'), rec('/in/also-mine/')],
    new Set(['/in/mutual/', '/in/also-mine/']),
  );
  assert.deepEqual(keep.map((r) => r.profile_url), ['/in/stranger/']);
  assert.equal(alreadyConnected, 2);
});

test('nothing is set aside when nobody is already connected', () => {
  const { keep, alreadyConnected } = splitAlreadyConnected([rec('/in/a/'), rec('/in/b/')], new Set());
  assert.equal(keep.length, 2);
  assert.equal(alreadyConnected, 0);
});
