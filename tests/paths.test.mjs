// Where the app finds its own folder (lib/paths.js projectRoot): the folder
// every route that runs something starts from. The scanner is run from it,
// Settings says how this copy was installed from it, and the Mac app's updater
// runs scripts/apply-update.sh from it. It is the folder whose package.json
// names this app. It used to be the one holding scripts/scrape.py, so a copy
// without the scanner would have looked like an install when it was a
// checkout, and the Mac app would have refused to update itself (no-helper).
// The scanner's files themselves: lib/scanner-files.js. Temporary folders only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { projectRoot, isAppRoot, isGitCheckout } from '../lib/paths.js';
import { SCANNER_FILES, scannerPresent, scannerScript, scannerRequirements } from '../lib/scanner-files.js';
import { installKind } from '../lib/release.js';
import { runningBundle } from '../lib/updater.js';

// realpath: process.cwd() answers with it (on a Mac, /private/var/... for /var/...).
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'sixgree-paths-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A folder at `rel` in the scratch folder, with `files` ({ relative path: contents }) in it. */
function folder(rel, files = {}) {
  const dir = path.join(scratch, rel);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const OURS = JSON.stringify({ name: pkg.name, version: '9.9.9' });
const HELPER = { 'scripts/apply-update.sh': '#!/bin/bash\n' };

/** projectRoot() and isGitCheckout() as a copy started in `cwd`, with SIX_DEGREES_ROOT = `root` (or none). */
function lookFrom(cwd, root = undefined) {
  const [was, wasRoot] = [process.cwd(), process.env.SIX_DEGREES_ROOT];
  if (root === undefined) delete process.env.SIX_DEGREES_ROOT;
  else process.env.SIX_DEGREES_ROOT = root;
  process.chdir(cwd);
  try {
    return { root: projectRoot(), git: isGitCheckout() };
  } finally {
    process.chdir(was);
    if (wasRoot === undefined) delete process.env.SIX_DEGREES_ROOT;
    else process.env.SIX_DEGREES_ROOT = wasRoot;
  }
}

test('the app\'s folder is the one whose package.json names this app, and scrape.py alone no longer counts', () => {
  assert.equal(isAppRoot(folder('ours', { 'package.json': OURS })), true);
  assert.equal(isAppRoot(folder('another', { 'package.json': JSON.stringify({ name: 'another-app' }) })), false);
  // The one Next writes into .next, with no name.
  assert.equal(isAppRoot(folder('next-own', { 'package.json': '{"type": "commonjs"}' })), false);
  assert.equal(isAppRoot(folder('broken', { 'package.json': '{ half a fi' })), false);
  assert.equal(isAppRoot(folder('scanner-only', { 'scripts/scrape.py': 'raise SystemExit("a stand-in")\n' })), false, 'the old sign');
  assert.equal(isAppRoot(path.join(scratch, 'nowhere')), false);
});

test('a checkout is a checkout, with the scanner\'s files or without them', () => {
  const bare = folder('checkout', { 'package.json': OURS, '.git/HEAD': 'ref: refs/heads/main\n' });
  assert.deepEqual(lookFrom(bare), { root: bare, git: true });
  // A worktree's .git is a file, not a folder.
  const worktree = folder('worktree', { 'package.json': OURS, '.git': 'gitdir: /elsewhere\n' });
  assert.deepEqual(lookFrom(worktree), { root: worktree, git: true });
  const withScanner = folder('checkout-scanner', {
    'package.json': OURS, '.git/HEAD': 'ref: refs/heads/main\n', ...Object.fromEntries(SCANNER_FILES.map((f) => [f, ''])),
  });
  assert.deepEqual(lookFrom(withScanner), { root: withScanner, git: true });
});

test('the Mac app finds itself without the scanner: its helper is there, so it can update (no-helper)', () => {
  // Contents/Resources/server, as desktop/main.mjs names it in SIX_DEGREES_ROOT; the classic app's is .../app.
  for (const name of ['server', 'app']) {
    const server = folder(`Sixgree-${name}.app/Contents/Resources/${name}`, { 'package.json': OURS, ...HELPER });
    const { root, git } = lookFrom(scratch, server);
    assert.equal(root, server, name);
    assert.equal(git, false, 'an install, not a checkout');
    assert.ok(existsSync(path.join(root, 'scripts', 'apply-update.sh')), 'where the update route looks for its helper');
    assert.equal(scannerPresent(root), false, 'and no scanner in it');
    assert.equal(installKind({}, root, 'darwin'), 'mac-app');
    assert.equal(runningBundle({ root }), path.join(scratch, `Sixgree-${name}.app`));
  }
});

test('the npm package and .next/standalone: the standalone server\'s own folder first, then the package\'s', () => {
  const pkgDir = folder('npm/sixgree', { 'package.json': OURS, '.next/package.json': '{"type": "commonjs"}' });
  const standalone = folder('npm/sixgree/.next/standalone', { 'package.json': OURS });
  // bin/six-degrees.mjs starts the server in .next/standalone, with no SIX_DEGREES_ROOT.
  assert.deepEqual(lookFrom(standalone), { root: standalone, git: false });
  // Without its own package.json there, .next's (no name) is passed over, and the package's is found.
  rmSync(path.join(standalone, 'package.json'));
  assert.deepEqual(lookFrom(standalone), { root: pkgDir, git: false });
});

test('SIX_DEGREES_ROOT is used when it is the app\'s folder, and passed over when it isn\'t', () => {
  const app = folder('named', { 'package.json': OURS });
  const cwd = folder('started-here', { 'package.json': OURS });
  assert.equal(lookFrom(cwd, app).root, app);
  assert.equal(lookFrom(cwd, folder('not-an-app')).root, cwd);
  assert.equal(lookFrom(cwd, path.join(scratch, 'gone')).root, cwd);
});

test('no package.json of this app anywhere it looks: null, never a guess', () => {
  const deep = folder('a/b/c/d');
  folder('a', { 'package.json': OURS });   // three folders up: further than it looks
  assert.deepEqual(lookFrom(deep), { root: null, git: false });
});

test('the scanner is there only with every one of its files', () => {
  const root = folder('scanner', { 'package.json': OURS, ...Object.fromEntries(SCANNER_FILES.map((f) => [f, ''])) });
  assert.deepEqual(SCANNER_FILES, ['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt']);
  assert.equal(scannerPresent(root), true);
  assert.equal(scannerScript(root), path.join(root, 'scripts', 'scrape.py'));
  assert.equal(scannerRequirements(root), path.join(root, 'scripts', 'requirements.txt'));
  for (const file of SCANNER_FILES) {
    const partial = folder(`partial-${path.basename(file)}`, Object.fromEntries(SCANNER_FILES.filter((f) => f !== file).map((f) => [f, ''])));
    assert.equal(scannerPresent(partial), false, `without ${file}`);
  }
  assert.equal(scannerPresent(null), false);
  assert.equal(scannerPresent(folder('empty')), false);
});
