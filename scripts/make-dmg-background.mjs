#!/usr/bin/env node
// Render scripts/dmg/background.html into scripts/dmg/background.tiff — the
// picture behind the .dmg window: drag across, then the one-time Open Anyway step.
//
// Run by hand when the picture changes, and commit the .tiff. The build only
// copies it, so packaging never depends on a browser being installed (the
// release runners have Chrome, but a build that needs one to succeed is a build
// that fails for no reason one day).
//
// Needs Google Chrome (or CHROME=/path/to/a/chromium) and macOS's sips and
// tiffutil. Produces a two-resolution TIFF, 640 × 440 at 72 dpi plus 1280 × 880
// at 144 dpi, which is how Finder picks the sharp one on a Retina screen.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'dmg', 'background.html');
const OUT = path.join(HERE, 'dmg', 'background.tiff');
const W = 640;
const H = 440;

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME=/path/to/chrome and run again.`);
  process.exit(1);
}

// Headless Chrome writes the screenshot within a few seconds and then, on some
// macOS versions, never exits. So: start it, wait for the file to appear and stop
// growing, then end it ourselves.
async function shoot(scale, png, work) {
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    // A fresh profile asks the macOS keychain for Chrome's storage key, which
    // can raise a permission prompt. Nothing here needs stored secrets.
    '--use-mock-keychain',
    // Its own profile, so this never collides with a Chrome you have open.
    `--user-data-dir=${path.join(work, `profile-${scale}`)}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${W},${H}`,
    `--screenshot=${png}`,
    pathToFileURL(SRC).href,
  ], { stdio: 'ignore', detached: true });

  const deadline = Date.now() + 60000;
  let last = -1;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (!existsSync(png)) continue;
    const size = statSync(png).size;
    if (size > 0 && size === last) break;
    last = size;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  if (!existsSync(png)) throw new Error('Chrome did not write a screenshot within 60 seconds.');
}

const work = mkdtempSync(path.join(tmpdir(), 'dmg-bg-'));
try {
  const shots = [];
  for (const scale of [1, 2]) {
    const png = path.join(work, scale === 1 ? 'bg.png' : 'bg@2x.png');
    await shoot(scale, png, work);
    execFileSync('sips', ['-s', 'dpiWidth', String(72 * scale), '-s', 'dpiHeight', String(72 * scale), png],
      { stdio: 'ignore' });
    shots.push(png);
  }
  execFileSync('tiffutil', ['-cathidpicheck', ...shots, '-out', OUT], { stdio: 'inherit' });
  console.log(`✓ ${path.relative(process.cwd(), OUT)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
