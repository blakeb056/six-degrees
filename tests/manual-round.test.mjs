// The Scan page's own round (Map 2nd degree) must never take Auto scan's
// all-day pacing: with the experimental switch on it used to rest overnight
// after 18:00 instead of starting (Blake, 2026-10-05, 1.2.0). Only Auto scan
// (lib/experimental-client.js) sends `experimental`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/setup/page.js', import.meta.url), 'utf8');

test('REGRESSION: the Scan page never starts a round with experimental pacing', () => {
  const calls = page.match(/run\('auto-bridge[^']*',[^)]*\)/g) || [];
  assert.ok(calls.length > 0, 'the Scan page still starts rounds');
  for (const call of calls) assert.doesNotMatch(call, /experimental/, call);
});

// Since the Auto scan fix, no page sends it at all: the server adds
// --experimental only to Auto scan's own sittings (route.js autoTick), and
// tests/auto-scan.test.mjs shows a request asking for it doesn't get it.
test('only Auto scan\'s sittings take experimental pacing, never a request', () => {
  const route = readFileSync(new URL('../app/api/scraper/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /body\.experimental/);
  assert.match(route, /sitting && action === 'auto-bridge' \? \['--experimental'/);
});
