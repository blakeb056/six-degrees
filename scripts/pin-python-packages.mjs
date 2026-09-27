#!/usr/bin/env node
// Pin the scanner's Python packages: rewrite scripts/requirements.txt with the
// SHA-256 of every file pip may install for the versions it names.
//
//   node scripts/pin-python-packages.mjs
//
// To move a package to a newer version, change its `name==version` line in
// scripts/requirements.txt and run this. It asks PyPI (pypi.org, the JSON API)
// about each version, and nothing else. A developer's tool: the app never runs
// it, and it isn't in the npm package or the Mac app (next.config.mjs leaves it
// out of the standalone build, which otherwise carries every file in scripts/).
//
// Why hashes. Every copy of the scanner installs from this one file: the Python
// inside the Mac app when it is built (scripts/build-app.mjs), and the private
// environment `npx six-degrees` and source copies set up from the Scan page. With
// a hash on every line pip refuses any file that isn't byte for byte the one
// pinned here, whoever serves it, and every dependency has to be listed too, so
// nothing arrives unpinned.
//
// Which files. Wheels only (the file says --only-binary :all:), so nothing is
// ever built from source on someone's computer. Only wheels for where Six
// Degrees runs:
//   - CPython 3.10 to 3.14 (lib/scanner-python.js SYSTEM_PYTHON), or any Python 3
//     for a pure-Python wheel. No free-threaded builds.
//   - macOS on Apple Silicon or Intel, for macOS 13 or older. The Mac app needs
//     macOS 13.5, and pip on a newer build Mac would happily take a wheel made
//     for its own macOS, which then fails on an older one. build-app.mjs checks
//     the result again, file by file.
//   - Linux with glibc (manylinux) on x86_64 or aarch64.
// pip only takes a file whose hash is listed, so these rules decide what can be
// installed anywhere.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'requirements.txt');
const PYTHON_MINORS = [10, 11, 12, 13, 14];
const MACOS_MAX_MAJOR = 13;

/** Can pip install this wheel somewhere Six Degrees runs? */
export function wheelAllowed(filename) {
  const m = String(filename).match(/^[^-]+-[^-]+(?:-\d[^-]*)?-([^-]+)-([^-]+)-([^-]+)\.whl$/);
  if (!m) return false;
  const [, pyTags, abiTags, platTags] = m;
  const pythonOk = pyTags.split('.').some((py) => {
    if (py === 'py3') return true;
    const cp = py.match(/^cp3(\d+)$/);
    if (!cp) return false;
    const minor = Number(cp[1]);
    return abiTags.split('.').some((abi) => {
      if (abi === 'abi3') return minor <= PYTHON_MINORS.at(-1);
      if (abi === 'none') return PYTHON_MINORS.includes(minor);
      return abi === `cp3${minor}` && PYTHON_MINORS.includes(minor); // not cp313t: free-threaded
    });
  });
  const platformOk = platTags.split('.').some((plat) => {
    if (plat === 'any') return true;
    const mac = plat.match(/^macosx_(\d+)_(\d+)_(arm64|x86_64|universal2)$/);
    if (mac) return Number(mac[1]) <= MACOS_MAX_MAJOR;
    return /^manylinux(1|2010|2014|_2_\d+)_(x86_64|aarch64)$/.test(plat);
  });
  return pythonOk && platformOk;
}

/**
 * A requirements file as { header, blocks }: the comment lines at its top (up
 * to the first blank line), then each requirement with the comments just above
 * it. Options and hashes are left out: main() writes them afresh.
 */
export function parseRequirements(text) {
  const lines = String(text).split('\n');
  const header = [];
  let i = 0;
  while (i < lines.length && lines[i].trim().startsWith('#')) header.push(lines[i++].trimEnd());
  const blocks = [];
  let comments = [];
  for (; i < lines.length; i++) {
    let line = lines[i];
    // A requirement continues over lines ending in a backslash (its hashes).
    while (/\\\s*$/.test(line) && i + 1 < lines.length) line = line.replace(/\\\s*$/, ' ') + lines[++i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      comments.push(trimmed);
      continue;
    }
    if (trimmed.startsWith('-')) {
      comments = [];
      continue;
    }
    const spec = trimmed.replace(/\s--hash=\S+/g, '').trim();
    const m = spec.match(/^([A-Za-z0-9_.-]+)==([^\s;]+)\s*(?:;\s*(.+))?$/);
    if (!m) throw new Error(`Not an exact pin (name==version): ${spec}`);
    blocks.push({ name: m[1], version: m[2], marker: m[3] ? m[3].trim() : null, comments });
    comments = [];
  }
  return { header, blocks };
}

async function hashesFor(name, version) {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`PyPI answered ${res.status} for ${name} ${version}`);
  const data = await res.json();
  const files = (data.urls || []).filter((f) => f.packagetype === 'bdist_wheel' && !f.yanked && wheelAllowed(f.filename));
  if (!files.length) throw new Error(`${name} ${version} has no wheel for the platforms Six Degrees runs on`);
  return [...new Set(files.map((f) => f.digests.sha256))].sort();
}

async function main() {
  const { header, blocks } = parseRequirements(readFileSync(FILE, 'utf8'));
  const out = [...header, '', '--only-binary :all:', '--require-hashes', ''];
  for (const b of blocks) {
    const hashes = await hashesFor(b.name, b.version);
    console.log(`  ${b.name}==${b.version}: ${hashes.length} file${hashes.length === 1 ? '' : 's'}`);
    out.push(...b.comments);
    out.push(`${b.name}==${b.version}${b.marker ? ` ; ${b.marker}` : ''} \\`);
    hashes.forEach((h, i) => out.push(`    --hash=sha256:${h}${i < hashes.length - 1 ? ' \\' : ''}`));
    out.push('');
  }
  writeFileSync(FILE, out.join('\n').replace(/\n+$/, '\n'));
  console.log(`✓ ${path.relative(process.cwd(), FILE)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  });
}
