// The scanner's Python packages are pinned: an exact version and the SHA-256 of
// every file pip may install (scripts/requirements.txt, written by
// scripts/pin-python-packages.mjs). The Python inside the Mac app is built from
// this file, and so is the environment the Scan page sets up. DESKTOP.md D2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wheelAllowed, parseRequirements } from '../scripts/pin-python-packages.mjs';

const REQUIREMENTS = readFileSync(fileURLToPath(new URL('../scripts/requirements.txt', import.meta.url)), 'utf8');

test('every package is pinned to one version, with hashes, wheels only', () => {
  const lines = REQUIREMENTS.split('\n');
  assert.ok(lines.includes('--require-hashes'), 'pip refuses any file whose hash isn\'t listed');
  assert.ok(lines.includes('--only-binary :all:'), 'nothing is built from source on someone\'s computer');

  // Requirements, with their continuation lines joined.
  const reqs = REQUIREMENTS.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'));
  const names = [];
  for (const r of reqs) {
    const m = r.match(/^([a-z0-9-]+)==(\S+?)(?: ; ([^-]+?))?((?:\s+--hash=sha256:[0-9a-f]{64})+)$/);
    assert.ok(m, `pinned, with hashes: ${r.slice(0, 80)}`);
    names.push(m[1]);
  }
  assert.equal(new Set(names).size, names.length, 'each package once');
  // The scanner's three, and everything they need (pip installs nothing unlisted).
  assert.deepEqual(names.sort(), [
    'certifi', 'charset-normalizer', 'greenlet', 'idna', 'pillow', 'playwright', 'pyee', 'requests',
    'typing-extensions', 'tzdata', 'urllib3',
  ]);
  const { blocks } = parseRequirements(REQUIREMENTS);
  assert.equal(blocks.length, names.length);
  assert.equal(blocks.find((b) => b.name === 'tzdata').marker, 'sys_platform == "win32"');
});

test('which wheels may be pinned: CPython 3.10 to 3.14, macOS 13 or older, Linux with glibc', () => {
  const ok = [
    'playwright-1.63.0-py3-none-macosx_11_0_arm64.whl',
    'playwright-1.63.0-py3-none-macosx_10_13_x86_64.whl',
    'playwright-1.63.0-py3-none-manylinux1_x86_64.whl',
    'playwright-1.63.0-py3-none-manylinux_2_17_aarch64.manylinux2014_aarch64.whl',
    'pillow-12.3.0-cp312-cp312-macosx_11_0_arm64.whl',
    'pillow-12.3.0-cp310-cp310-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl',
    'pillow-12.3.0-cp314-cp314-macosx_13_0_x86_64.whl',
    'greenlet-3.5.6-cp312-cp312-macosx_11_0_universal2.whl',
    'charset_normalizer-3.5.1-cp37-abi3-macosx_10_9_universal2.whl',
    'requests-2.34.2-py3-none-any.whl',
    'tzdata-2026.4-py2.py3-none-any.whl',
  ];
  const refused = [
    'pillow-12.3.0-cp312-cp312-macosx_14_0_arm64.whl',     // newer than the app's macOS 13.5
    'pillow-12.3.0-cp39-cp39-macosx_11_0_arm64.whl',       // Python 3.9: the packages need 3.10
    'pillow-12.3.0-cp315-cp315-macosx_11_0_arm64.whl',     // not yet
    'pillow-12.3.0-cp313-cp313t-macosx_11_0_arm64.whl',    // free-threaded
    'pillow-12.3.0-cp312-cp312-musllinux_1_2_x86_64.whl',
    'pillow-12.3.0-cp312-cp312-win_amd64.whl',
    'pillow-12.3.0-cp312-cp312-manylinux_2_28_ppc64le.whl',
    'pillow-12.3.0-pp310-pypy310_pp73-manylinux_2_28_x86_64.whl',
    'pillow-12.3.0.tar.gz',
  ];
  for (const f of ok) assert.equal(wheelAllowed(f), true, f);
  for (const f of refused) assert.equal(wheelAllowed(f), false, f);
});

test('rewriting keeps the comments and the markers, and drops the old hashes', () => {
  const { header, blocks } = parseRequirements([
    '# the file\'s own note',
    '',
    '--only-binary :all:',
    '--require-hashes',
    '',
    '# why this one',
    'playwright==1.63.0 \\',
    '    --hash=sha256:' + 'a'.repeat(64) + ' \\',
    '    --hash=sha256:' + 'b'.repeat(64),
    'tzdata==2026.4 ; sys_platform == "win32"',
  ].join('\n'));
  assert.deepEqual(header, ['# the file\'s own note']);
  assert.deepEqual(blocks, [
    { name: 'playwright', version: '1.63.0', marker: null, comments: ['# why this one'] },
    { name: 'tzdata', version: '2026.4', marker: 'sys_platform == "win32"', comments: [] },
  ]);
  assert.throws(() => parseRequirements('playwright>=1.40'), /exact pin/);
});
