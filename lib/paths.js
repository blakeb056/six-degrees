// Where things are on disk. Both API routes that shell out need these, and
// having two copies is how they drift.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pkg from '../package.json' with { type: 'json' };

/**
 * Is `dir` this app's own folder? Its package.json names this app. Every copy
 * has that file: a checkout, the npm package, and .next/standalone, which Next
 * always writes it into and which the desktop apps' server folder is a copy of.
 *
 * scripts/scrape.py used to be the sign, but the scanner is leaving the app,
 * and a copy without it must still find itself: without a root the Mac app's
 * updater can't find its helper (no-helper), and a checkout looks like an install.
 */
export function isAppRoot(dir) {
  try {
    // Read at run time, wherever this copy is: nothing for the build to trace.
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ path.join(dir, 'package.json'), 'utf8')).name === pkg.name;
  } catch {
    return false;   // no package.json there, or one that can't be read
  }
}

/** The checkout or install root: the folder holding the app's own package.json (isAppRoot). */
export function projectRoot() {
  const candidates = [
    process.env.SIX_DEGREES_ROOT,
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '..', '..'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (isAppRoot(c)) return c;
  }
  return null;
}

/** Everything personal: database, avatars, browser profile, python env. */
export function dataDir() {
  return process.env.SIX_DEGREES_HOME || path.join(os.homedir(), '.six-degrees');
}

/** True when the app is running from a git checkout rather than an install. */
export function isGitCheckout() {
  const root = projectRoot();
  return Boolean(root && existsSync(path.join(root, '.git')));
}
