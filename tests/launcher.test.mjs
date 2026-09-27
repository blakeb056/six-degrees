// The npx launcher's command line (bin/args.mjs). A relative --data-dir used to
// reach the server as it was typed, and the server runs from inside the
// package, so the network landed in the npx cache and was lost when that was
// cleared.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, resolveDataDir } from '../bin/args.mjs';

test('a relative --data-dir is made absolute against the folder npx was run from', () => {
  const cwd = '/home/someone/projects';
  assert.equal(parseArgs(['--data-dir', 'net'], { env: {}, cwd }).dataDir, '/home/someone/projects/net');
  assert.equal(parseArgs(['--data-dir=../net'], { env: {}, cwd }).dataDir, '/home/someone/net');
  assert.equal(parseArgs(['--data-dir', '/srv/net'], { env: {}, cwd }).dataDir, '/srv/net');
});

test('a leading ~ is the home folder, even after = where the shell leaves it alone', () => {
  const home = '/home/someone';
  assert.equal(parseArgs(['--data-dir=~/net'], { env: {}, cwd: '/tmp', home }).dataDir, '/home/someone/net');
  assert.equal(parseArgs(['--data-dir', '~'], { env: {}, cwd: '/tmp', home }).dataDir, '/home/someone');
  assert.equal(resolveDataDir({ dataDir: null }, { env: { SIX_DEGREES_HOME: '~/elsewhere' }, cwd: '/tmp', home }), '/home/someone/elsewhere');
  assert.equal(parseArgs(['--data-dir=~other'], { env: {}, cwd: '/tmp', home }).dataDir, '/tmp/~other');
});

test('--data-dir with no folder is an error, not a folder named "undefined"', () => {
  const a = parseArgs(['--data-dir'], { env: {}, cwd: '/x' });
  assert.equal(a.dataDir, null);
  assert.match(a.error, /--data-dir needs a folder/);
  assert.match(parseArgs(['--data-dir='], { env: {}, cwd: '/x' }).error, /needs a folder/);
});

test('the data folder is --data-dir, then SIX_DEGREES_HOME (made absolute too), then ~/.six-degrees', () => {
  const home = '/home/someone';
  const cwd = '/home/someone/projects';
  assert.equal(resolveDataDir({ dataDir: '/srv/net' }, { env: { SIX_DEGREES_HOME: '/elsewhere' }, cwd, home }), '/srv/net');
  assert.equal(resolveDataDir({ dataDir: null }, { env: { SIX_DEGREES_HOME: 'rel' }, cwd, home }), '/home/someone/projects/rel');
  assert.equal(resolveDataDir({ dataDir: null }, { env: {}, cwd, home }), '/home/someone/.six-degrees');
});

test('the other options read as they always have', () => {
  const a = parseArgs(['-p', '7000', '--no-open', '--help', '-v'], { env: {}, cwd: '/x' });
  assert.deepEqual({ port: a.port, open: a.open, help: a.help, version: a.version }, { port: 7000, open: false, help: true, version: true });
  assert.equal(parseArgs([], { env: { PORT: '6400' }, cwd: '/x' }).port, 6400);
  assert.equal(parseArgs([], { env: {}, cwd: '/x' }).port, 6363);
});
