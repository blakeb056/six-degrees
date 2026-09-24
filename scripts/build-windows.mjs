#!/usr/bin/env node
// Build the Windows download: Six-Degrees-<version>-win-x64.zip.
//
// The Windows counterpart of scripts/build-app.mjs. Inside the zip:
//
//   node.exe      a Node runtime, so Windows needs nothing installed to run it
//   app\          the Next standalone server, plus the scanner's Python files
//   launch.ps1    what the Start Menu shortcut runs (scripts/windows/launch.ps1)
//   six-degrees.ico
//
// install.ps1 downloads this, checks it against SHA256SUMS, unpacks it into
// %LOCALAPPDATA%\Programs\Six Degrees and makes the shortcuts.
//
// Run it ON WINDOWS. Next traces native modules (sharp) for the machine that
// builds, so a zip made on a Mac would carry Mac binaries. The release workflow
// builds it on GitHub's Windows machines.
//
// Like the Mac app, it needs Python and Google Chrome only for the scanner; the
// Scan page checks for both.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const NODE_VERSION = process.env.BUNDLE_NODE || 'v24.21.0';
const ARCH = 'x64'; // Windows on Arm runs x64 builds through its built-in emulation
const OUT = path.join(ROOT, 'dist');
const STAGE = path.join(OUT, 'win');
const CACHE = path.join(os.homedir(), '.cache', 'six-degrees-build');
const ZIP = path.join(OUT, `Six-Degrees-${pkg.version}-win-${ARCH}.zip`);

if (process.platform !== 'win32' && !process.env.SIX_DEGREES_ALLOW_CROSS) {
  console.error('\n  ✗ Build the Windows zip on Windows (the release workflow does). A zip built here\n' +
    '    would carry this machine\'s native modules and fail to start on Windows.\n');
  process.exit(1);
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...opts });
const step = (msg) => console.log(`\n▸ ${msg}`);

// Clear dist first: Next traces the project folder into the standalone output,
// so a leftover dist would be swallowed into the build (see build-app.mjs).
rmSync(OUT, { recursive: true, force: true });

step('Building the app');
run('npm', ['run', 'build'], { cwd: ROOT });

step('Assembling the bundle');
mkdirSync(STAGE, { recursive: true });
cpSync(path.join(ROOT, '.next', 'standalone'), path.join(STAGE, 'app'), { recursive: true });
if (existsSync(path.join(STAGE, 'app', '.git'))) rmSync(path.join(STAGE, 'app', '.git'), { recursive: true, force: true });
// The scanner is not part of the standalone output but the Scan page runs it.
for (const rel of ['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt', 'scripts/audit-avatars.mjs']) {
  const from = path.join(ROOT, rel);
  if (existsSync(from)) {
    mkdirSync(path.join(STAGE, 'app', path.dirname(rel)), { recursive: true });
    cpSync(from, path.join(STAGE, 'app', rel));
  }
}
cpSync(path.join(ROOT, 'scripts', 'windows', 'launch.ps1'), path.join(STAGE, 'launch.ps1'));
cpSync(path.join(ROOT, 'public', 'favicon.ico'), path.join(STAGE, 'six-degrees.ico'));

step(`Fetching Node ${NODE_VERSION} (win-${ARCH})`);
const name = `node-${NODE_VERSION}-win-${ARCH}`;
const zipped = path.join(CACHE, `${name}.zip`);
mkdirSync(CACHE, { recursive: true });
if (!existsSync(zipped)) {
  run('curl', ['-fSL', '--retry', '3', '-o', zipped, `https://nodejs.org/dist/${NODE_VERSION}/${name}.zip`]);
} else {
  console.log('  using the cached download');
}
// Windows 10+ ships bsdtar as tar.exe, which reads and writes zip files.
run('tar', ['-xf', zipped, '-C', CACHE, `${name}/node.exe`]);
cpSync(path.join(CACHE, name, 'node.exe'), path.join(STAGE, 'node.exe'));

step('Zipping');
run('tar', ['-a', '-c', '-f', ZIP, '-C', STAGE, 'node.exe', 'launch.ps1', 'six-degrees.ico', 'app']);
rmSync(STAGE, { recursive: true, force: true });

const mb = (readFileSync(ZIP).length / 1e6).toFixed(0);
console.log(`\n✓ ${ZIP}  (${mb} MB)\n`);
