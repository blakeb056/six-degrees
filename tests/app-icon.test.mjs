// The guided setup draws the app icon from public/app-icon.svg; it must be the
// same picture the Mac, Windows and Linux builds make their icons from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public/app-icon.svg is desktop/icon/icon.svg', () => {
  assert.equal(readFileSync('public/app-icon.svg', 'utf8'), readFileSync('desktop/icon/icon.svg', 'utf8'));
});
