// Insights moved into the profile (lib/insights-address.js): the boards'
// address, and where every old link goes now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS, BOARD_LABELS, DEFAULT_BOARD, boardOf, insightsHref, movedInsights } from '../lib/insights-address.js';

test('the boards, People first, then Health, each with a name', () => {
  assert.deepEqual(BOARDS, ['people', 'kingmakers', 'gatekeepers', 'companies', 'industries', 'report', 'health']);
  assert.equal(DEFAULT_BOARD, 'people');
  for (const b of BOARDS) assert.ok(BOARD_LABELS[b], b);
});

test('a board has one address in the profile', () => {
  assert.equal(insightsHref('kingmakers'), '/profile?view=insights&board=kingmakers');
  assert.equal(insightsHref('health'), '/profile?view=insights&board=health');
  // Nothing, or something that isn't a board, is People.
  assert.equal(insightsHref(), '/profile?view=insights&board=people');
  assert.equal(insightsHref('evil"><script>'), '/profile?view=insights&board=people');
  assert.equal(boardOf(null), 'people');
  assert.equal(boardOf('toString'), 'people');
});

test('the old Insights tab\'s addresses land on the same board', () => {
  assert.equal(movedInsights(''), '/profile?view=insights&board=people');
  assert.equal(movedInsights('?view=people'), '/profile?view=insights&board=people');
  for (const b of ['kingmakers', 'gatekeepers', 'companies', 'industries', 'report']) {
    assert.equal(movedInsights(`view=${b}`), `/profile?view=insights&board=${b}`, b);
    assert.equal(movedInsights(`?view=${b}`), `/profile?view=insights&board=${b}`, b);
  }
  assert.equal(movedInsights('?view=nonsense&x=1'), '/profile?view=insights&board=people');
});
