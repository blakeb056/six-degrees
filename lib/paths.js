// Where things are on disk. Both API routes that shell out need these, and
// having two copies is how they drift.

import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** The checkout or install root — the folder holding scripts/scrape.py. */
export function projectRoot() {
  const candidates = [
    process.env.SIX_DEGREES_ROOT,
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.join(process.cwd(), '..', '..'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(path.join(c, 'scripts', 'scrape.py'))) return c;
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
