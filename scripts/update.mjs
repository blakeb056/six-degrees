#!/usr/bin/env node
// `npm run update` — the whole safe sequence, so it cannot be half-done.
//
// Plain `git pull` fails on this project more often than it should, for a dull
// reason: `npm install` rewrites package-lock.json whenever your npm differs
// from the one that produced the committed file. That leaves the tree dirty,
// git refuses to pull over local changes, prints one line, and exits. Every
// command after it behaves normally and you are still on the old code — which
// reads as "the update did nothing".
//
// A generated lockfile is safe to discard. Anything else is your work and this
// stops rather than touching it.

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: ROOT }).toString().trim();
// Porcelain status lines begin with a significant space, and trimming the block
// eats it off the first line only — which silently corrupts exactly one
// filename. Same trap as TRAPS §20; read this one raw.
const gitRaw = (args) => execFileSync('git', args, { cwd: ROOT }).toString();
const say = (m) => console.log(m);

let before;
try {
  before = git(['rev-parse', '--short', 'HEAD']);
} catch {
  console.error('\n  This is not a git checkout, so there is nothing to pull.');
  console.error('  If you installed the app, replace it with a newer build.\n');
  process.exit(1);
}

const dirty = gitRaw(['status', '--porcelain'])
  .split('\n')
  .filter((l) => l.length > 3)
  .map((l) => l.slice(3).trim())
  .filter(Boolean);

const generated = dirty.filter((f) => f === 'package-lock.json');
const yours = dirty.filter((f) => f !== 'package-lock.json');

if (yours.length) {
  console.error(`
  You have changes here that are not mine to throw away:

${yours.map((f) => `      ${f}`).join('\n')}

  Commit or stash them, then run this again.
`);
  process.exit(1);
}

if (generated.length) {
  say('  Discarding the regenerated package-lock.json (npm rewrites it; it is not your work).');
  git(['checkout', '--', 'package-lock.json']);
}

say('  Fetching…');
const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: ROOT, stdio: 'inherit' });
if (pull.status !== 0) {
  console.error('\n  The pull did not succeed. Nothing else has been changed.\n');
  process.exit(pull.status ?? 1);
}

const after = git(['rev-parse', '--short', 'HEAD']);
if (after === before) {
  say(`\n  Already up to date (${after}).\n`);
  process.exit(0);
}

say('\n  Installing any new dependencies…');
spawnSync('npm', ['install', '--silent'], { cwd: ROOT, stdio: 'inherit' });

say(`
  ┌──────────────────────────────────────────────────────────────┐
  │  Updated ${before} -> ${after}
  └──────────────────────────────────────────────────────────────┘

  Restart the app to actually run it: Ctrl-C in the terminal running
  it, then npm run dev. Files on disk are not the code a running
  server has already loaded.
`);
