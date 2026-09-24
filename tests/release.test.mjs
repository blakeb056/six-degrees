// The installed-copy side of the Updates panel: which release is newer, and
// which update instruction fits how this copy was installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoSlug, compareVersions, installKind, updateCommand } from '../lib/release.js';

test('repository field to owner/repo', () => {
  assert.equal(repoSlug({ url: 'git+https://github.com/owner/repo.git' }), 'owner/repo');
  assert.equal(repoSlug('https://github.com/owner/repo'), 'owner/repo');
  assert.equal(repoSlug('git@github.com:owner/repo.git'), 'owner/repo');
  assert.equal(repoSlug({ url: 'https://gitlab.com/owner/repo' }), null);
  assert.equal(repoSlug(undefined), null);
});

test('versions compare as numbers, not strings', () => {
  assert.equal(compareVersions('0.10.0', '0.9.3'), 1);
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.1.0', 'v0.2.0'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), 0);
});

test('the launcher says how it was installed', () => {
  assert.equal(installKind({ SIX_DEGREES_INSTALL: 'mac-app' }, '/x'), 'mac-app');
  assert.equal(installKind({ SIX_DEGREES_INSTALL: 'npm' }, '/Applications/Six Degrees.app/Contents/Resources/app'), 'npm');
});

test('an older Mac app is recognised by its path', () => {
  assert.equal(installKind({}, '/Applications/Six Degrees.app/Contents/Resources/app'), 'mac-app');
  assert.equal(installKind({}, '/Users/x/.npm/_npx/abc/node_modules/six-degrees'), 'npm');
});

test('each install kind gets its own update line', () => {
  assert.match(updateCommand('mac-app', 'owner/repo'), /raw\.githubusercontent\.com\/owner\/repo\/main\/install\.sh \| bash$/);
  assert.equal(updateCommand('npm', 'owner/repo'), 'npx six-degrees@latest');
});
