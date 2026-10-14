// Invented plugin packages, for the tests of the installer (lib/plugins.js),
// its routes (app/api/plugins) and the scanner lookup (lib/scanner-files.js).
// Not a test file itself: `npm test` runs tests/*.test.mjs.
//
// The scanner in them is a stand-in whose scrape.py stops at once if a real
// Python ever runs it, as tests/helpers/scanner.mjs standInRoot's does.

import { createHash } from 'node:crypto';
import { writeZip } from '../../lib/zip-write.js';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** A stand-in scanner's files, as a scanner plugin holds them. */
export const STAND_IN_SCANNER = Object.freeze({
  'scanner/scrape.py': 'raise SystemExit("a stand-in: never a real scan")\n',
  'scanner/image_store.py': '# a stand-in\n',
  'scanner/requirements.txt': '# a stand-in: nothing to install\n',
});

/**
 * A package: manifest.json (filled in from `manifest`, with every file's
 * checksum) and `files`, plus `extra` entries the manifest doesn't know about.
 * `manifest` may override anything, files included; `rawManifest` replaces it whole.
 * @returns {{ zip: Buffer, sha256: string, manifest: object }}
 */
export function makePackage({ files = STAND_IN_SCANNER, manifest = {}, extra = [], rawManifest } = {}) {
  const list = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  const m = rawManifest ?? {
    format: 'sixgree.plugin',
    format_version: 1,
    id: 'manual-scan',
    name: 'Manual scan',
    version: '1.0.0',
    sixgree: '>=1.0.0',
    about: 'An invented scanner, for tests.',
    risk: 'An invented risk note.',
    kind: 'scanner',
    unlocks: ['manual'],
    files: Object.fromEntries(list.map((f) => [f.name, sha256(f.data)])),
    ...manifest,
  };
  const zip = writeZip([{ name: 'manifest.json', data: typeof m === 'string' ? m : JSON.stringify(m, null, 2) }, ...list, ...extra]);
  return { zip, sha256: sha256(zip), manifest: m };
}
