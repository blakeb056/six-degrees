// The Scan page's budget picker asks before a budget past what LinkedIn has put up with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitQuestion, limitNote, riskyLimits, RESTRICTED_AT, SAFE_LIMITS } from '../lib/search-risk.js';

const safe = { daily: 50, monthly: 250 };

test('raising the daily budget past 100 asks first, and names the restriction', () => {
  const q = limitQuestion(safe, { ...safe, daily: 200 });
  assert.match(q, new RegExp(`${RESTRICTED_AT} searches in 24 hours`));
  assert.match(q, /Set 200 a day anyway\?/);
  assert.ok(limitQuestion(safe, { ...safe, daily: 500 }));
});

test('up to 100 a day, lowering it, or keeping a risky one asks nothing', () => {
  assert.equal(limitQuestion(safe, { ...safe, daily: 100 }), null);
  assert.equal(limitQuestion({ daily: 500, monthly: 250 }, { daily: 200, monthly: 250 }), null);
  assert.equal(limitQuestion({ daily: 500, monthly: 250 }, { daily: 500, monthly: 500 }), null);
});

test('turning the monthly cap off asks first; changing another cap does not', () => {
  assert.match(limitQuestion(safe, { ...safe, monthly: 0 }), /no monthly cap/);
  assert.equal(limitQuestion({ daily: 50, monthly: 0 }, { daily: 50, monthly: 0 }), null);
  assert.equal(limitQuestion(safe, { ...safe, monthly: 1000 }), null);
});

test('the note shows only while the budget is risky, and says why', () => {
  assert.equal(limitNote(safe), null);
  assert.equal(limitNote({ daily: 100, monthly: 1000 }), null);
  assert.match(limitNote({ daily: 500, monthly: 0 }), /500 a day[\s\S]*no monthly cap/);
  assert.equal(riskyLimits(SAFE_LIMITS), false);
});
