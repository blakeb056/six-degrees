// The meter's marks for how much searching is asking for trouble. Since the scan
// windows (2026-10-17) no setting reaches them: searches are 120 a day at most,
// and the note a risky searches a day showed went with that setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as risk from '../lib/search-risk.js';
import { WINDOW_DEFAULTS } from '../lib/scan-windows.js';

test('the marks: 50, 100 and the 373 an account was restricted at', () => {
  assert.deepEqual(risk.SAFE_LIMITS, { daily: 50 });
  assert.equal(risk.RISKY_DAILY, 100);
  assert.equal(risk.RESTRICTED_AT, 373);
});

test('the windows keep a day well under the restriction, and the searches-a-day note is gone', () => {
  assert.ok(WINDOW_DEFAULTS.windowPages * WINDOW_DEFAULTS.windowsPerDay < risk.RESTRICTED_AT / 3);
  assert.equal(risk.limitNote, undefined);
  assert.equal(risk.riskyDaily, undefined);
});
