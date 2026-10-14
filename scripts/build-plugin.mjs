#!/usr/bin/env node
// Build the scanner's two plugin packages from the app's own scanner files:
//
//   node scripts/build-plugin.mjs [--version=1.0.0] [--out=dist/plugins]
//   npm run build:plugins
//
// → dist/plugins/auto-scan-<version>.sgplugin and manual-scan-<version>.sgplugin
//
// Both hold the same scanner (scripts/scrape.py, image_store.py and
// requirements.txt, under scanner/), with a manifest that lists each file's
// SHA-256 (docs/PLUGINS.md). What differs is the name, what each says it does,
// and what it unlocks; what each unlocks in the app comes in a later change.
// Built for trying the installer now, until the scanner's code moves to a
// repository of its own and is packaged there.
//
// The same files always make the same package, byte for byte (lib/zip-write.js
// dates every entry alike). Each package is read back through the installer's
// own checks (lib/plugins.js readPackage) before it is called built.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { writeZip } from '../lib/zip-write.js';
import { readPackage, PLUGIN_FORMAT, PLUGIN_FORMAT_VERSION, MANIFEST_FILE } from '../lib/plugins.js';
import { SCANNER_FILES, scannerPresent } from '../lib/scanner-files.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The honest risk each one carries, shown before it installs: the Scan page's
// own points (lib/scan-risk.js RISK_POINTS), said for what each plugin does.
const RISK_TERMS = 'LinkedIn’s User Agreement doesn’t allow automated tools, and LinkedIn may restrict accounts that use them.';

export const PLUGINS = [
  {
    id: 'auto-scan',
    name: 'Auto scan',
    unlocks: ['auto'],
    about: 'The scanner, reading by itself: circle scans that turn the pages on their own, Auto scan, Auto connect and Dev mode.',
    risk: `It runs your own LinkedIn account automatically, in Chrome on this computer. ${RISK_TERMS}`,
  },
  {
    id: 'manual-scan',
    name: 'Manual scan',
    unlocks: ['manual'],
    about: 'The scanner, by hand: you scroll and click Next in its Chrome window, and it reads each page as you go, with chimes.',
    risk: `It reads LinkedIn pages with your own account, in Chrome on this computer, as you page through them. ${RISK_TERMS}`,
  },
];

function option(name, fallback) {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** One package: its manifest and the scanner's files, in the order an install reads them. */
export function buildPackage(plugin, { version, appVersion, root = ROOT }) {
  const files = SCANNER_FILES.map((rel) => ({ name: `scanner/${path.basename(rel)}`, data: readFileSync(path.join(root, rel)) }));
  const manifest = {
    format: PLUGIN_FORMAT,
    format_version: PLUGIN_FORMAT_VERSION,
    id: plugin.id,
    name: plugin.name,
    version,
    sixgree: `>=${appVersion}`,
    about: plugin.about,
    risk: plugin.risk,
    kind: 'scanner',
    unlocks: plugin.unlocks,
    files: Object.fromEntries(files.map((f) => [f.name, sha256(f.data)])),
  };
  return writeZip([{ name: MANIFEST_FILE, data: `${JSON.stringify(manifest, null, 2)}\n` }, ...files]);
}

function main() {
  const version = option('version', '1.0.0');
  const out = path.resolve(ROOT, option('out', path.join('dist', 'plugins')));
  if (!scannerPresent(ROOT)) {
    console.error(`\n  ✗ This copy has no scanner to package (${SCANNER_FILES.join(', ')}).\n`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  for (const plugin of PLUGINS) {
    const zip = buildPackage(plugin, { version, appVersion: pkg.version });
    // Read back as an install will, so a package this makes always installs.
    const checked = readPackage(zip, { appVersion: pkg.version });
    const file = path.join(out, `${plugin.id}-${version}.sgplugin`);
    writeFileSync(file, zip);
    const shown = path.relative(process.cwd(), file);
    console.log(`  ✓ ${shown.startsWith('..') ? file : shown}: ${plugin.name} ${version}, ${Math.round(zip.length / 1024)} KB, sha256 ${checked.sha256}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
