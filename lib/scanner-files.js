// The scanner's own files, beside the app in scripts/: scrape.py, the program
// a scan runs; image_store.py, which it imports from beside it to save photos;
// and requirements.txt, its Python packages, pinned by hash.
//
// Everything that starts or sets up the scanner finds them here, and asks
// scannerPresent() first. The scanner is moving out of the app into add-ons of
// its own, so a copy without these files must say so, not fail on a path that
// isn't there. Plain paths and a look at the disk, so the build scripts use it
// too (scripts/build-app.mjs, scripts/build-desktop.mjs).

import { existsSync } from 'node:fs';
import path from 'node:path';

/** The scanner's files, relative to the app's folder (lib/paths.js projectRoot). */
export const SCANNER_FILES = Object.freeze(['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt']);

/** The program a scan runs, in the app's folder `root`. */
export function scannerScript(root) {
  return path.join(root, 'scripts', 'scrape.py');
}

/** The scanner's pinned packages, in the app's folder `root`: what Install and Set up the scanner install. */
export function scannerRequirements(root) {
  return path.join(root, 'scripts', 'requirements.txt');
}

/** Does the app's folder `root` have the scanner: every one of its files? */
export function scannerPresent(root) {
  return Boolean(root) && SCANNER_FILES.every((rel) => existsSync(path.join(root, rel)));
}

/** The server's answer to anything that needs the scanner, in a copy without it. */
export const SCANNER_MISSING = 'The scanner isn’t installed in this copy of Sixgree.';
