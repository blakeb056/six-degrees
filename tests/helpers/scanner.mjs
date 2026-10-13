// The scanner's own files, for the tests that read or run them: scrape.py,
// image_store.py beside it, and requirements.txt, its pinned packages
// (lib/scanner-files.js). The scanner is moving out of the app into add-ons of
// its own. In a copy without these files, those tests skip and say why; in one
// with them, every test runs as it always has. Not a test file itself: `npm
// test` runs tests/*.test.mjs.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../package.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));

export const SCRAPER = path.join(here, '..', '..', 'scripts', 'scrape.py');
export const IMAGE_STORE = path.join(here, '..', '..', 'scripts', 'image_store.py');
export const REQUIREMENTS = path.join(here, '..', '..', 'scripts', 'requirements.txt');
/** Runs scrape.py's own code against stand-in pages and a stand-in clock. */
export const HARNESS = path.join(here, 'scanner_harness.py');

/** Every one of the scanner's files is in this copy. */
export const scannerPresent = [SCRAPER, IMAGE_STORE, REQUIREMENTS].every((file) => existsSync(file));

/**
 * True when the scanner's files aren't in this copy, and the test was skipped,
 * as noPython does (tests/python.mjs). Asked before anything reads or runs them.
 */
export function noScanner(t) {
  if (scannerPresent) return false;
  t.skip('the scanner\'s files are not in this copy (scripts/scrape.py, image_store.py, requirements.txt)');
  return true;
}

/**
 * A stand-in install at `root`, for the tests that start the scanner through
 * the app (SIX_DEGREES_ROOT): the app's own package.json, which is how
 * lib/paths.js knows the folder, and the scanner's files, whose scrape.py stops
 * at once if a real Python ever runs it. Nothing here can open a browser.
 */
export function standInRoot(root) {
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: pkg.name })}\n`);
  writeFileSync(path.join(root, 'scripts', 'scrape.py'), 'raise SystemExit("a stand-in: never a real scan")\n');
  writeFileSync(path.join(root, 'scripts', 'image_store.py'), '');
  writeFileSync(path.join(root, 'scripts', 'requirements.txt'), '');
  return root;
}
