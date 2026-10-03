import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Blake's rule: no em dashes in anything the app shows. Every string in app/ and
// lib/ can reach the screen (pages, notices, notifications, error messages), so
// all of it is checked once comments are taken out.
//
// The one exception is reading, not writing: lib/scoring.js splits LinkedIn
// headlines on " — " among other separators, because people type them.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(js|mjs)$/.test(name) ? [p] : [];
  });
}

// Block and JSX comments, then line comments (not the // in a URL).
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

const READS_THEM = (file, line) => file === 'lib/scoring.js' && line.includes('.split(/');

test('no em dashes in on-screen text', () => {
  const found = [];
  for (const dir of ['app', 'lib']) {
    for (const file of files(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        if (/—|&mdash;|\\u2014|&#8212;/.test(line) && !READS_THEM(rel, line)) found.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(found, [], `em dashes in text the app shows:\n${found.join('\n')}`);
});
