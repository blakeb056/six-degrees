import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCAN_RISK_SETTING, riskAccepted, touchesLinkedIn, RISK_POINTS, RISK_REFUSAL } from '../lib/scan-risk.js';
import { SETTINGS } from '../lib/settings.js';

const route = readFileSync(new URL('../app/api/scraper/route.js', import.meta.url), 'utf8');
const ACTIONS = (() => {
  const block = route.slice(route.indexOf('const ACTIONS = {'), route.indexOf('};', route.indexOf('const ACTIONS = {')));
  return [...block.matchAll(/^\s*'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);
})();

test('the "I understand" is a setting: when it was given, or null', () => {
  assert.equal(SETTINGS.scanRiskAccepted, SCAN_RISK_SETTING);
  assert.equal(SCAN_RISK_SETTING.default, null);
  assert.equal(SCAN_RISK_SETTING.parse(null), null);
  assert.equal(SCAN_RISK_SETTING.parse('2026-10-03T15:20:00Z'), '2026-10-03T15:20:00.000Z');
  for (const bad of [true, 1, '', 'yes', {}]) assert.throws(() => SCAN_RISK_SETTING.parse(bad));
});

test('accepted when given here, or when the scanner was used before this existed', () => {
  assert.equal(riskAccepted(), false);
  assert.equal(riskAccepted({ acceptedAt: null, scannedBefore: false }), false);
  assert.equal(riskAccepted({ acceptedAt: '2026-10-03T15:20:00.000Z' }), true);
  assert.equal(riskAccepted({ scannedBefore: true }), true);
});

test('everything that opens LinkedIn waits for it; installing and saving photos do not', () => {
  assert.ok(ACTIONS.length >= 10, 'read the scanner actions from the route');
  const off = ACTIONS.filter((a) => !touchesLinkedIn(a));
  assert.deepEqual(off.sort(), ['install', 'photos', 'setup']);
  for (const a of ['login', 'full', 'refresh', 'auto-bridge', 'bridge', 'company', 'messages']) {
    assert.ok(ACTIONS.includes(a), `${a} is a scanner action`);
    assert.equal(touchesLinkedIn(a), true, a);
  }
  // A name nobody has classified yet is treated as touching LinkedIn.
  assert.equal(touchesLinkedIn('something-new'), true);
});

test('the server refuses before it starts anything, and says where to go', () => {
  const post = route.slice(route.indexOf('export async function POST'));
  const check = post.indexOf('touchesLinkedIn(action) && !scanRisk()');
  assert.ok(check > 0, 'POST checks the risk');
  assert.ok(check < post.indexOf('spawn('), 'before any process starts');
  assert.match(RISK_REFUSAL, /Scan page/);
});

test('the three points say what it does, what it risks, and that nothing leaves', () => {
  assert.equal(RISK_POINTS.length, 3);
  assert.match(RISK_POINTS[0], /your own LinkedIn account/);
  assert.match(RISK_POINTS[1], /restrict/);
  assert.match(RISK_POINTS[1], /50 searches a day/);
  assert.doesNotMatch(RISK_POINTS[1], /a month/);
  assert.match(RISK_POINTS[2], /Nothing leaves your computer/);
});
