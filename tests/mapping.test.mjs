// The three states are the point of this card, so they are the thing to test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of computeMapping — the component is JSX and this runner has no
// transform, so the logic is duplicated here deliberately and must match.
// If you change one, change both; the assertions below are the contract.
function computeMapping(degree1 = [], degree2 = [], skips = []) {
  const mappedIds = new Set(degree2.map((c) => c.source_connection_id).filter(Boolean));
  const hiddenUrls = new Set(skips.map((s) => s.profileUrl).filter(Boolean));
  const state = (c) => {
    if (mappedIds.has(c.id)) return 'mapped';
    if (c.profile_url && hiddenUrls.has(c.profile_url)) return 'hidden';
    return 'todo';
  };
  const counts = { mapped: 0, hidden: 0, todo: 0 };
  for (const c of degree1) counts[state(c)] += 1;
  const total = degree1.length;
  const resolved = counts.mapped + counts.hidden;
  return { ...counts, total, resolved, percent: total ? Math.round((resolved / total) * 100) : 0,
           batches: Math.ceil(counts.todo / 25) };
}

const p = (id, url, tier = 'A') => ({ id, profile_url: url, tier });

test('someone with a mapped circle counts as mapped', () => {
  const m = computeMapping([p('a', '/in/a')], [{ source_connection_id: 'a' }], []);
  assert.equal(m.mapped, 1);
  assert.equal(m.percent, 100);
});

test('someone on the skip list counts as hidden, not outstanding', () => {
  const m = computeMapping([p('a', '/in/a')], [], [{ profileUrl: '/in/a' }]);
  assert.equal(m.hidden, 1);
  assert.equal(m.todo, 0);
});

test('hidden people do not stop the bar reaching the end', () => {
  // The reason this card exists: a network of private profiles is FINISHED,
  // not stuck at 50%. Counting hidden as incomplete would push someone to keep
  // scraping a network with nothing left to give — and that gets accounts
  // restricted.
  const d1 = [p('a', '/in/a'), p('b', '/in/b')];
  const m = computeMapping(d1, [{ source_connection_id: 'a' }], [{ profileUrl: '/in/b' }]);
  assert.equal(m.percent, 100);
  assert.equal(m.todo, 0);
});

test('untouched people are outstanding', () => {
  const m = computeMapping([p('a', '/in/a'), p('b', '/in/b')], [], []);
  assert.equal(m.todo, 2);
  assert.equal(m.percent, 0);
});

test('the remainder is reported in batches, rounded up', () => {
  const many = Array.from({ length: 60 }, (_, i) => p(`x${i}`, `/in/x${i}`));
  assert.equal(computeMapping(many, [], []).batches, 3);   // 60 / 25 -> 3
});

test('an empty network does not divide by zero', () => {
  const m = computeMapping([], [], []);
  assert.equal(m.percent, 0);
  assert.equal(m.total, 0);
});
