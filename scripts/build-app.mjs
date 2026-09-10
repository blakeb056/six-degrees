#!/usr/bin/env node
// Build "Six Degrees.app" and a .dmg you can hand to someone.
//
// What this removes: installing Node, cloning, npm install, and typing a
// command. The Node runtime is bundled, so the app has no prerequisites at all
// for the CSV path — download, double-click, drop in your export.
//
// What it does NOT remove: Python and Google Chrome, which the scraper needs.
// Those stay runtime prerequisites and the Scan page already detects both.
// Bundling a Chromium instead would make the scraper MORE detectable, not less,
// which defeats the point of driving the user's real browser.
//
// Unsigned, because notarisation needs a paid Apple Developer account. macOS
// will refuse the first launch; the user allows it once in System Settings.
// An ad-hoc signature is applied anyway — it costs nothing and avoids the
// separate "app is damaged" failure that unsigned arm64 binaries otherwise hit.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const NODE_VERSION = process.env.BUNDLE_NODE || 'v24.21.0';
const ARCH = process.env.BUNDLE_ARCH || (os.arch() === 'x64' ? 'x64' : 'arm64');
const APP_NAME = 'Six Degrees';
const OUT = path.join(ROOT, 'dist');
const APP = path.join(OUT, `${APP_NAME}.app`);
const RES = path.join(APP, 'Contents', 'Resources');
const CACHE = path.join(os.homedir(), '.cache', 'six-degrees-build');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function step(msg) { console.log(`\n▸ ${msg}`); }

// ---- 1. the app itself -----------------------------------------------------
step('Building the app');
if (!existsSync(path.join(ROOT, '.next', 'standalone', 'server.js'))) {
  run('npm', ['run', 'build'], { cwd: ROOT });
} else {
  console.log('  reusing the existing standalone build (npm run build to refresh)');
}

step('Assembling the bundle');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
mkdirSync(RES, { recursive: true });

cpSync(path.join(ROOT, '.next', 'standalone'), path.join(RES, 'app'), { recursive: true });
// The scraper is not part of the standalone output but the Scan page runs it.
for (const rel of ['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt',
                   'scripts/score_new_connections.sql', 'scripts/audit-avatars.mjs']) {
  const from = path.join(ROOT, rel);
  if (existsSync(from)) {
    mkdirSync(path.join(RES, 'app', path.dirname(rel)), { recursive: true });
    cpSync(from, path.join(RES, 'app', rel));
  }
}

// ---- 2. the runtime --------------------------------------------------------
step(`Fetching Node ${NODE_VERSION} (${ARCH})`);
const tarName = `node-${NODE_VERSION}-darwin-${ARCH}`;
const tarball = path.join(CACHE, `${tarName}.tar.gz`);
mkdirSync(CACHE, { recursive: true });
if (!existsSync(tarball)) {
  run('curl', ['-fSL', '--retry', '3', '-o', tarball,
    `https://nodejs.org/dist/${NODE_VERSION}/${tarName}.tar.gz`]);
} else {
  console.log('  using the cached download');
}
run('tar', ['-xzf', tarball, '-C', CACHE]);
cpSync(path.join(CACHE, tarName, 'bin', 'node'), path.join(RES, 'node'));
chmodSync(path.join(RES, 'node'), 0o755);

// ---- 3. how it launches ----------------------------------------------------
step('Writing the launcher');
writeFileSync(path.join(APP, 'Contents', 'MacOS', 'six-degrees'), `#!/bin/bash
# Start the server, wait for it to answer, then open the browser.
HERE="$(cd "$(dirname "$0")/../Resources" && pwd)"
export SIX_DEGREES_BIND=127.0.0.1
export NEXT_TELEMETRY_DISABLED=1
export SIX_DEGREES_ROOT="$HERE/app"
export HOSTNAME=127.0.0.1

# Walk up from 6363 so a second copy does not fight the first.
PORT=6363
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
export PORT

"$HERE/node" "$HERE/app/server.js" >"\${TMPDIR:-/tmp}/six-degrees.log" 2>&1 &
SERVER=$!

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  if ! kill -0 $SERVER 2>/dev/null; then
    osascript -e 'display alert "Six Degrees could not start" message "See six-degrees.log in your temporary folder."'
    exit 1
  fi
  sleep 0.5
done

URL="http://127.0.0.1:$PORT/"

# Open it as a window, not a tab.
#
# A Chromium browser started with --app gives a plain window: no address bar,
# no tabs, its own entry in the Dock. It is the same rendering engine either
# way, but it stops the app looking like a web page someone left open. Chrome
# is launched directly rather than via the open command, because arguments
# passed that way are ignored when the browser is already running, which it
# usually is. (No backticks in here: this whole script lives inside a
# JavaScript template literal and a stray one ends it.)
APP_WINDOW=""
for B in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$B" ]; then APP_WINDOW="$B"; break; fi
done

if [ -n "$APP_WINDOW" ]; then
  "$APP_WINDOW" --app="$URL" --window-size=1400,900 >/dev/null 2>&1 &
  WINDOW_PID=$!
  sleep 2
  # A Chromium already running forwards the window to itself and the launcher
  # exits 0, so a live process is not the test. A non-zero exit is, and it means
  # nothing opened — fall back rather than leaving a running server and a blank
  # screen.
  if ! kill -0 $WINDOW_PID 2>/dev/null; then
    wait $WINDOW_PID 2>/dev/null || open "$URL"
  fi
else
  # No Chromium anywhere: the default browser is a perfectly good home.
  open "$URL"
fi

wait $SERVER
`);
chmodSync(path.join(APP, 'Contents', 'MacOS', 'six-degrees'), 0o755);

writeFileSync(path.join(APP, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>com.blakeburford.sixdegrees</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>CFBundleExecutable</key><string>six-degrees</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><false/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`);

// ---- 4. sign, ad-hoc -------------------------------------------------------
step('Signing (ad-hoc)');
try {
  run('codesign', ['--force', '--deep', '--sign', '-', APP]);
  console.log('  signed ad-hoc — no Apple account needed, still unnotarised');
} catch {
  console.log('  codesign failed; the app will still run after the one-time approval');
}

// ---- 5. the disk image -----------------------------------------------------
step('Building the disk image');
const dmg = path.join(OUT, `${APP_NAME.replace(/ /g, '-')}-${pkg.version}-${ARCH}.dmg`);
const staging = path.join(OUT, 'staging');
mkdirSync(staging, { recursive: true });
cpSync(APP, path.join(staging, `${APP_NAME}.app`), { recursive: true });
run('ln', ['-s', '/Applications', path.join(staging, 'Applications')]);
writeFileSync(path.join(staging, 'READ ME FIRST.txt'),
`${APP_NAME} ${pkg.version}

1. Drag ${APP_NAME} into Applications.
2. The first time you open it, macOS will refuse — the app is not signed with a
   paid Apple developer certificate. Open System Settings > Privacy & Security,
   scroll down, and click "Open Anyway". You only do this once.
3. It opens in your browser. Your data stays on this machine, in ~/.six-degrees.

Importing a LinkedIn CSV needs nothing else installed.

Scanning LinkedIn directly also needs Python 3 and Google Chrome. The Scan page
inside the app checks for both and sets up the rest itself.
`);
run('hdiutil', ['create', '-volname', APP_NAME, '-srcfolder', staging,
  '-ov', '-format', 'UDZO', dmg]);
rmSync(staging, { recursive: true, force: true });

const size = execFileSync('du', ['-h', dmg]).toString().split('\t')[0];
console.log(`\n✓ ${dmg}  (${size})\n`);
console.log('  Unsigned by design: notarisation needs a paid Apple account.');
console.log('  First launch needs one approval in System Settings > Privacy & Security.\n');
