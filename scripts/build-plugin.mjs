#!/usr/bin/env node
// Build the official plugin packages: the scanner's two from the app's own
// scanner files, and the feature plugins from their README:
//
//   node scripts/build-plugin.mjs [--version=1.0.1] [--out=dist/plugins] [--catalog <base-url>]
//   (the scanners' version is lib/plugins-shipped.js SHIPPED_PLUGIN_VERSION
//   unless given; a feature plugin always has its own, from that list)
//   npm run build:plugins
//
// → dist/plugins/auto-scan-<version>.sgplugin, manual-scan-<version>.sgplugin
//   and linkedin-browser-<its version>.sgplugin
//
// A feature plugin (kind "feature", lib/plugins.js) carries its manifest and
// README.md only, from scripts/plugins/<id>/README.md: its feature's code is
// the app's own.
//
// --catalog also writes dist/plugins/catalog.json, a plugin list
// (docs/PLUGINS.md, "The plugin list") naming both packages at <base-url>,
// with each one's SHA-256 and size. Served with the packages from a folder on
// this computer, it is what SIX_DEGREES_PLUGIN_CATALOG points a test at:
//
//   node scripts/build-plugin.mjs --catalog http://127.0.0.1:4848
//   SIX_DEGREES_PLUGIN_CATALOG=http://127.0.0.1:4848/catalog.json npm run dev
//
// Both hold the same scanner (scripts/scrape.py, image_store.py and
// requirements.txt, under scanner/), with a manifest that lists each file's
// SHA-256 (docs/PLUGINS.md). What differs is the name, what each says it does,
// and what it unlocks in the app (lib/scanner-capabilities.js).
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
import { checkCatalog, CATALOG_FORMAT, CATALOG_FORMAT_VERSION } from '../lib/plugin-catalog.js';
import { SCANNER_FILES, scannerPresent } from '../lib/scanner-files.js';
import { SHIPPED_PLUGINS, SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// What each one is (name, what it does, its risk, what it unlocks) is the
// shipped copy of the official list (lib/plugins-shipped.js), which the app
// draws its cards from before it goes online, so the two always say the same.
export const PLUGINS = SHIPPED_PLUGINS.map(({ id, name, unlocks, about, risk, kind, version }) => ({
  id, name, unlocks: [...unlocks], about, risk, kind,
  // A feature plugin's own version; the scanners take the build's.
  ...(kind === 'feature' ? { version } : {}),
}));

/** The version `plugin` is built at: its own (a feature plugin's), or the build's (the scanners'). */
export const versionOf = (plugin, version) => plugin.version || version;

/** Where a feature plugin's README is kept. */
export const featureReadme = (id, root = ROOT) => path.join(root, 'scripts', 'plugins', id, 'README.md');

function option(name, fallback) {
  const args = process.argv.slice(2);
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (arg) return arg.slice(name.length + 3);
  // `--name value` too; `--name` with nothing after it is an empty value, said by its check.
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  return args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : '';
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** One package: its manifest and its files (the scanner's, or a feature's README), in the order an install reads them. */
export function buildPackage(plugin, { version, appVersion, root = ROOT }) {
  const kind = plugin.kind || 'scanner';
  const files = kind === 'feature'
    ? [{ name: 'README.md', data: readFileSync(featureReadme(plugin.id, root)) }]
    : SCANNER_FILES.map((rel) => ({ name: `scanner/${path.basename(rel)}`, data: readFileSync(path.join(root, rel)) }));
  const manifest = {
    format: PLUGIN_FORMAT,
    format_version: PLUGIN_FORMAT_VERSION,
    id: plugin.id,
    name: plugin.name,
    version: versionOf(plugin, version),
    sixgree: `>=${appVersion}`,
    about: plugin.about,
    risk: plugin.risk,
    kind,
    unlocks: plugin.unlocks,
    files: Object.fromEntries(files.map((f) => [f.name, sha256(f.data)])),
  };
  return writeZip([{ name: MANIFEST_FILE, data: `${JSON.stringify(manifest, null, 2)}\n` }, ...files]);
}

/**
 * A plugin list naming `built` ({ plugin, file, zip, sha256 }) at `base`, as
 * the app reads one (lib/plugin-catalog.js checkCatalog). A test's list: http
 * on 127.0.0.1 is allowed in it, as SIX_DEGREES_PLUGIN_CATALOG allows it.
 */
export function buildCatalog(built, { base, version, appVersion }) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const catalog = {
    format: CATALOG_FORMAT,
    format_version: CATALOG_FORMAT_VERSION,
    plugins: built.map(({ plugin, file, zip, sha256: sum }) => ({
      id: plugin.id,
      name: plugin.name,
      version: versionOf(plugin, version),
      about: plugin.about,
      risk: plugin.risk,
      kind: plugin.kind || 'scanner',
      unlocks: plugin.unlocks,
      sixgree: `>=${appVersion}`,
      url: new URL(file, root).href,
      sha256: sum,
      size: zip.length,
    })),
  };
  // Read back as the app will, so a list this makes is always shown whole.
  const checked = checkCatalog(catalog, { appVersion, test: true });
  if (checked.problem || checked.dropped.length || checked.plugins.some((p) => p.problem)) {
    throw new Error(`The plugin list didn’t read back whole: ${checked.problem
      || [...checked.dropped.map((d) => d.reason), ...checked.plugins.map((p) => p.problem).filter(Boolean)].join(' ')}`);
  }
  return catalog;
}

function main() {
  const version = option('version', SHIPPED_PLUGIN_VERSION);
  const out = path.resolve(ROOT, option('out', path.join('dist', 'plugins')));
  const base = option('catalog', null);
  if (base !== null && !URL.canParse(base)) {
    console.error(`\n  ✗ --catalog needs the address the packages will be served from, like http://127.0.0.1:4848 (got ${JSON.stringify(base)}).\n`);
    process.exit(1);
  }
  if (!scannerPresent(ROOT)) {
    console.error(`\n  ✗ This copy has no scanner to package (${SCANNER_FILES.join(', ')}).\n`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const shown = (file) => {
    const rel = path.relative(process.cwd(), file);
    return rel.startsWith('..') ? file : rel;
  };
  const built = [];
  for (const plugin of PLUGINS) {
    const zip = buildPackage(plugin, { version, appVersion: pkg.version });
    // Read back as an install will, so a package this makes always installs.
    const checked = readPackage(zip, { appVersion: pkg.version });
    const name = `${plugin.id}-${versionOf(plugin, version)}.sgplugin`;
    const file = path.join(out, name);
    writeFileSync(file, zip);
    built.push({ plugin, file: name, zip, sha256: checked.sha256 });
    console.log(`  ✓ ${shown(file)}: ${plugin.name} ${versionOf(plugin, version)}, ${Math.round(zip.length / 1024)} KB, sha256 ${checked.sha256}`);
  }
  if (base !== null) {
    const file = path.join(out, 'catalog.json');
    writeFileSync(file, `${JSON.stringify(buildCatalog(built, { base, version, appVersion: pkg.version }), null, 2)}\n`);
    console.log(`  ✓ ${shown(file)}: a plugin list naming all ${built.length}, at ${base}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
