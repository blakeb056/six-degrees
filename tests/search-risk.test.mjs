// The daily limit's note: past 100 a day it says why, beside the number. Since
// 2026-10-05 nothing asks first (one limit, one number, no pop-up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitNote, riskyDaily, RISKY_DAILY, RESTRICTED_AT, SAFE_LIMITS } from '../lib/search-risk.js';

test('the default is 50 a day, and there is no monthly part any more', () => {
  assert.deepEqual(SAFE_LIMITS, { daily: 50 });
  assert.equal(RISKY_DAILY, 100);
});

test('the note shows only while the number is over 100, and says why', () => {
  assert.equal(limitNote(SAFE_LIMITS), null);
  assert.equal(limitNote({ daily: 100 }), null);
  assert.equal(riskyDaily(100), false);
  assert.equal(riskyDaily(101), true);
  assert.match(limitNote({ daily: 500 }), new RegExp(`^A real account was restricted after ${RESTRICTED_AT} searches in 24 hours\\. 500 a day can use up`));
  assert.equal(limitNote({ daily: 500 }, { restriction: false }), '500 a day can use up a free account\'s month in a day or two.');
  assert.doesNotMatch(limitNote({ daily: 500 }), /monthly cap/);
});
