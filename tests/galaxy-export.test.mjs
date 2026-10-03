import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CREDIT } from '../lib/galaxy-export.js';

test('a saved picture credits the website, so a shared one says where to get the app', () => {
  assert.equal(CREDIT, 'sixdegreesapp.com');
  // The frame is drawn on a canvas, which this test has no browser for: check
  // the corner text is the credit and not a name typed in by hand.
  const source = readFileSync(new URL('../lib/galaxy-export.js', import.meta.url), 'utf8');
  assert.match(source, /ctx\.fillText\(CREDIT,/);
  assert.doesNotMatch(source, /fillText\('Six Degrees'/);
});
