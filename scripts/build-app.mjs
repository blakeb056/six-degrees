#!/usr/bin/env node
// Build "Six Degrees.app" and a .dmg you can hand to someone.
//
// Two shells, one server (docs/brain/DESKTOP.md):
//   --shell=electron   the desktop app: an Electron window, menu and lifecycle
//                      around the same server. Betas and, once promoted, releases.
//   --shell=classic    the 0.1.x app: a bash launcher that opens a Chrome --app
//                      window. The default until Electron is promoted, and kept
//                      buildable for one release after that (rule 5).
// Both bundle the same Node binary and the same standalone server, and share
// the disk image step below.
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
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, chmodSync, readFileSync, symlinkSync, lstatSync, renameSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const NODE_VERSION = process.env.BUNDLE_NODE || 'v24.21.0';
const ARCH = process.env.BUNDLE_ARCH || (os.arch() === 'x64' ? 'x64' : 'arm64');
const SHELL = (process.argv.find((a) => a.startsWith('--shell='))?.split('=')[1]) || process.env.BUNDLE_SHELL || 'classic';
if (!['classic', 'electron'].includes(SHELL)) {
  console.error(`\n  ✗ --shell must be classic or electron, not ${SHELL}\n`);
  process.exit(1);
}
const APP_NAME = 'Six Degrees';
const OUT = path.join(ROOT, 'dist');
const APP = path.join(OUT, `${APP_NAME}.app`);
const RES = path.join(APP, 'Contents', 'Resources');
// Where the server and the runtime are assembled. The classic app holds them in
// its own Resources; for Electron they are staged, then packed into its Resources.
const STAGE = path.join(OUT, 'electron-stage');
const SERVER_DIR = SHELL === 'electron' ? path.join(STAGE, 'server') : path.join(RES, 'app');
const NODE_OUT = SHELL === 'electron' ? path.join(STAGE, 'node') : path.join(RES, 'node');
const CACHE = path.join(os.homedir(), '.cache', 'six-degrees-build');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function step(msg) { console.log(`\n▸ ${msg}`); }

// Eject a mounted image, patiently. Right after Finder lays out the window, it
// or Spotlight can still hold the volume for a moment, and hdiutil fails with
// "Resource busy" — 0.1.1's first Intel release build died exactly that way.
// Retry plainly first, then with -force, before giving up.
//
// "Resource busy" can come after the volume has already unmounted, when only
// ejecting the disk device failed. Retrying the mount point then fails with "No
// such file or directory" — there is nothing left there — and 0.1.5's first
// Intel build gave up on exactly that. So once the mount point is gone, finish
// the job on the device, and stop as soon as neither exists.
function detach(mountPoint, device) {
  const tries = [[], [], ['-force'], ['-force'], ['-force']];
  let last;
  for (let i = 0; i < tries.length; i++) {
    const volumeGone = !existsSync(mountPoint);
    if (volumeGone && (!device || !existsSync(device))) {
      if (i > 0) console.log('  (ejected)');
      return;
    }
    const target = volumeGone ? device : mountPoint;
    try {
      execFileSync('hdiutil', ['detach', target, ...tries[i]], { stdio: ['ignore', 'ignore', 'pipe'] });
      if (i > 0) console.log(`  (ejected on attempt ${i + 1})`);
      return;
    } catch (err) {
      last = err;
      console.log(`  (retrying the eject of ${target}: ${(err.stderr || '').toString().trim() || err.message})`);
      execFileSync('sleep', [String(2 * (i + 1))]);
    }
  }
  if (!existsSync(mountPoint) && (!device || !existsSync(device))) return;
  throw last;
}

// ---- 1. the app itself -----------------------------------------------------
// Always rebuild. Reusing whatever happened to be in .next means that after a
// `git pull` you package the previous commit and cannot tell from the outside —
// a shipped app that quietly is not the code you just fetched. --fast skips it
// when you are iterating on the packaging itself and know the build is current.
// Clear the output BEFORE building. Next traces the project directory into the
// standalone bundle, so a dist/ left from the previous run gets swallowed into
// the next one — each build carrying the last one inside it. That is how a
// 70 MB image became 361 MB.
rmSync(OUT, { recursive: true, force: true });

step('Building the app');
if (process.argv.includes('--fast') && existsSync(path.join(ROOT, '.next', 'standalone', 'server.js'))) {
  console.log('  --fast: reusing the existing build (make sure it is current)');
} else {
  run('npm', ['run', 'build'], { cwd: ROOT });
}

step(`Assembling the bundle (${SHELL})`);
if (SHELL === 'classic') mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
mkdirSync(path.dirname(NODE_OUT), { recursive: true });

cpSync(path.join(ROOT, '.next', 'standalone'), SERVER_DIR, { recursive: true });

// Next traces the whole project folder into the standalone output, so check
// what came along. A .git inside the app would make the installed copy believe
// it is a checkout (lib/paths.js isGitCheckout) and offer `git pull` against its
// own bundle; next.config.mjs excludes it, and this makes sure.
if (existsSync(path.join(SERVER_DIR, '.git'))) {
  rmSync(path.join(SERVER_DIR, '.git'), { recursive: true, force: true });
  console.log('  removed a .git that was traced into the bundle — check next.config.mjs');
}
// Anything not committed is somebody's local file, and it is about to be handed
// to whoever gets this app. Releases build from a clean checkout; a local build
// should at least say what it is shipping.
try {
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--directory'], { cwd: ROOT })
    .toString().split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean)
    .filter((rel) => existsSync(path.join(SERVER_DIR, rel)));
  if (untracked.length) {
    console.log('  ⚠ uncommitted files are inside this app — commit them or move them out if they should not ship:');
    for (const rel of untracked) console.log(`      ${rel}`);
  }
} catch { /* not a git checkout: nothing to compare against */ }
// The scraper is not part of the standalone output but the Scan page runs it.
for (const rel of ['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt',
                   'scripts/audit-avatars.mjs']) {
  const from = path.join(ROOT, rel);
  if (existsSync(from)) {
    mkdirSync(path.join(SERVER_DIR, path.dirname(rel)), { recursive: true });
    cpSync(from, path.join(SERVER_DIR, rel));
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
cpSync(path.join(CACHE, tarName, 'bin', 'node'), NODE_OUT);
chmodSync(NODE_OUT, 0o755);

// ---- 3. how it launches ----------------------------------------------------
if (SHELL === 'electron') {
  await buildElectronShell();
} else {
step('Writing the launcher');
writeFileSync(path.join(APP, 'Contents', 'MacOS', 'six-degrees'), `#!/bin/bash
# Start the server, wait for it to answer, then open the browser.
HERE="$(cd "$(dirname "$0")/../Resources" && pwd)"
export SIX_DEGREES_BIND=127.0.0.1
export NEXT_TELEMETRY_DISABLED=1
export SIX_DEGREES_ROOT="$HERE/app"
export SIX_DEGREES_INSTALL=mac-app
export HOSTNAME=127.0.0.1

# Walk up from 6363 so a second copy does not fight the first.
PORT=6363
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
export PORT

"$HERE/node" "$HERE/app/server.js" >"\${TMPDIR:-/tmp}/six-degrees.log" 2>&1 &
SERVER=$!

# The server goes when this launcher goes. Without this, stopping the launcher —
# which is what an update does to a running copy — left the server serving the
# old version, and the new copy opened on the next port beside it.
trap 'kill $SERVER 2>/dev/null' EXIT
trap 'exit 143' TERM INT HUP

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

// LSArchitecturePriority is not decoration. The app's executable is a shell
// script, so macOS cannot see which chips it supports, and on Apple Silicon it
// played safe and ran the script under Rosetta. Everything the launcher started
// then preferred Intel: the Python that runs the scraper came up x86_64 and could
// not load the arm64 packages beside it, and a Mac without Rosetta would have been
// asked to install it just to open the app. Naming the chip makes it native.
// Checked with a probe app: without this key, sysctl.proc_translated was 1; with
// it, 0. LSRequiresNativeExecution alone did not change it. TRAPS §30.
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
  <key>LSMinimumSystemVersion</key><string>13.5</string>
  <key>LSUIElement</key><false/>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSArchitecturePriority</key><array><string>${ARCH === 'x64' ? 'x86_64' : 'arm64'}</string></array>
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
} // end of the classic shell

// ---- the Electron shell (--shell=electron) -----------------------------------
// @electron/packager makes the .app from desktop/ (main process, starting page)
// and packs the staged server and Node binary into its Resources as extra
// resources, where desktop/main.mjs looks for them. Same app name and bundle id
// as the classic app, so installing it replaces the classic app in place.
async function buildElectronShell() {
  step('Building the Electron app');
  const { packager } = await import('@electron/packager');
  const electronVersion = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;

  const src = path.join(STAGE, 'shell');
  cpSync(path.join(ROOT, 'desktop'), src, { recursive: true, filter: (p) => !p.split(path.sep).includes('icon') });
  const shellPkg = JSON.parse(readFileSync(path.join(src, 'package.json'), 'utf8'));
  writeFileSync(path.join(src, 'package.json'), `${JSON.stringify({ ...shellPkg, version: pkg.version }, null, 2)}\n`);

  const icon = await makeIcns(path.join(ROOT, 'desktop', 'icon', 'icon.svg'), path.join(STAGE, 'six-degrees.icns'));
  const [built] = await packager({
    dir: src,
    out: path.join(STAGE, 'out'),
    overwrite: true,
    name: APP_NAME,
    platform: 'darwin',
    arch: ARCH,
    electronVersion,
    appBundleId: 'com.blakeburford.sixdegrees',
    appVersion: pkg.version,
    buildVersion: pkg.version,
    appCategoryType: 'public.app-category.productivity',
    icon,
    asar: true,
    prune: false,          // the shell has no dependencies
    junk: true,
    extraResource: [SERVER_DIR, NODE_OUT],
    darwinDarkModeSupport: true,
    // The bundled Node 24 needs macOS 13.5 (Electron itself needs 13), so say
    // so, and macOS explains it instead of the app failing to start.
    extendInfo: { LSMinimumSystemVersion: '13.5' },
    osxSign: false,        // signed ad hoc below, after everything is in place
  });
  console.log(`  Electron ${electronVersion} (${ARCH})`);
  rmSync(APP, { recursive: true, force: true });
  renameSync(path.join(built, `${APP_NAME}.app`), APP);
  rmSync(STAGE, { recursive: true, force: true });

  step('Signing (ad-hoc)');
  // Electron's framework and helpers must all carry the same kind of signature,
  // or macOS refuses to load them; re-signing the whole bundle ad hoc does that.
  run('codesign', ['--force', '--deep', '--sign', '-', APP]);
  run('codesign', ['--verify', '--deep', '--strict', APP]);
  console.log('  signed ad-hoc and verified — no Apple account needed, still unnotarised');
}

// The app icon, from an SVG: sharp (already here, Next depends on it) draws it
// at 1024px, sips makes the sizes macOS wants, iconutil packs them.
async function makeIcns(svg, out) {
  const { default: sharp } = await import('sharp');
  const set = path.join(STAGE, 'icon.iconset');
  mkdirSync(set, { recursive: true });
  const master = path.join(STAGE, 'icon-1024.png');
  await sharp(svg, { density: 288 }).resize(1024, 1024).png().toFile(master);
  for (const [size, name] of [[16, '16x16'], [32, '16x16@2x'], [32, '32x32'], [64, '32x32@2x'],
    [128, '128x128'], [256, '128x128@2x'], [256, '256x256'], [512, '256x256@2x'], [512, '512x512'], [1024, '512x512@2x']]) {
    execFileSync('sips', ['-z', String(size), String(size), master, '--out', path.join(set, `icon_${name}.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out]);
  return out;
}

// ---- 5. the disk image -----------------------------------------------------
step('Building the disk image');
const dmg = path.join(OUT, `${APP_NAME.replace(/ /g, '-')}-${pkg.version}-${ARCH}.dmg`);
const staging = path.join(OUT, 'staging');
mkdirSync(staging, { recursive: true });
// ditto, not cpSync: Node's copy rewrites relative symlinks into absolute paths
// on the machine that built it. Electron's framework is held together by
// relative links (Versions/Current/…), and copied that way the app opened only
// on the build machine: anywhere else those paths do not exist (TRAPS §37).
run('ditto', [APP, path.join(staging, `${APP_NAME}.app`)]);

// The picture behind the window says what to do: drag across, then the one-time
// Open Anyway step, since the app is unsigned. It replaces the READ ME text file
// this image used to carry. Made by scripts/make-dmg-background.mjs from
// scripts/dmg/background.html; its geometry and the positions below are one
// layout, so change them together.
const BACKGROUND = path.join(ROOT, 'scripts', 'dmg', 'background.tiff');
const hasBackground = existsSync(BACKGROUND);
if (hasBackground) {
  mkdirSync(path.join(staging, '.background'), { recursive: true });
  cpSync(BACKGROUND, path.join(staging, '.background', 'background.tiff'));
} else {
  console.log('  (no scripts/dmg/background.tiff — the window will have no instructions)');
}

// Lay the window out the way every other Mac installer does: the app on the
// left, the Applications folder on the right, drag across. Without this the
// disk image opens as a plain file list and nobody knows what to do with it.
const rw = path.join(OUT, 'rw.dmg');
run('hdiutil', ['create', '-volname', APP_NAME, '-srcfolder', staging,
  '-ov', '-format', 'UDRW', rw]);

// hdiutil prints one line per device it creates — the whole disk (/dev/diskN)
// first, the mounted volume last — but it can print progress lines before them,
// so find the lines rather than count them. Keep both: see detach().
const attachLines = execFileSync('hdiutil', ['attach', rw, '-nobrowse', '-readwrite'])
  .toString().split('\n').map((l) => l.trim()).filter(Boolean);
const mount = attachLines.filter((l) => l.includes('/Volumes/')).pop().split('\t').pop().trim();
const device = (attachLines.map((l) => l.match(/^\/dev\/disk\d+/)).find(Boolean) || [null])[0];

// Why a Finder step failed, in one line, for the build log.
const osaReason = (err) =>
  ((err && err.stderr ? err.stderr.toString() : '').trim().split('\n').pop() || (err && err.message) || 'unknown');

// The drop target. A Finder alias, not a symlink: macOS 26 draws a symlink to
// /Applications as a blank dashed square, which leaves the one thing the window
// asks you to do with nowhere visible to do it. The symlink stays as a fallback
// for machines where Finder cannot be scripted — it still works, it just shows
// no folder icon.
try {
  execFileSync('osascript', ['-e',
    `tell application "Finder" to make new alias file at (POSIX file "${mount}" as alias) ` +
    `to (POSIX file "/Applications" as alias) with properties {name:"Applications"}`],
  { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
} catch (err) {
  console.log(`  (Finder could not make the Applications alias: ${osaReason(err)})`);
}
const dropTarget = path.join(mount, 'Applications');
if (!existsSync(dropTarget)) {
  symlinkSync('/Applications', dropTarget);
  console.log('  (could not make a Finder alias; using a plain link, which shows no folder icon)');
}

// ...and give the alias the folder's icon. Finder does not look through an alias
// on a disk image to draw its target, so without an icon of its own it is still a
// dashed square. Other installers ship exactly this: an alias carrying the
// Applications folder icon. Only ever a regular file — setting an icon through a
// symlink would try to change the real /Applications folder instead.
if (lstatSync(dropTarget).isFile()) {
  try {
    execFileSync('osascript', ['-l', 'JavaScript', '-e', `
      ObjC.import('AppKit');
      const ws = $.NSWorkspace.sharedWorkspace;
      ws.setIconForFileOptions(ws.iconForFile('/Applications'), ${JSON.stringify(dropTarget)}, 0);
    `], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
  } catch (err) {
    console.log(`  (could not give the Applications alias its icon: ${osaReason(err)})`);
  }
}

// A bound on every Finder step: on a build machine nobody is watching, a Finder
// that never answers must fail the step, not hold the release for hours. And
// keep comments OUT of the AppleScript below — it is AppleScript, where `//` is
// a syntax error. One slipped in once, and 0.1.0 shipped with a plain window.
const styleScript = `
    tell application "Finder"
      tell disk "${APP_NAME}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        -- 640 x 400 of content under a title bar of about 28.
        set the bounds of container window to {200, 120, 840, 548}
        set theViewOptions to the icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 100
        set text size of theViewOptions to 13
        ${hasBackground ? 'set background picture of theViewOptions to file ".background:background.tiff"' : ''}
        set position of item "${APP_NAME}.app" of container window to {180, 150}
        set position of item "Applications" of container window to {460, 150}
        close
        open
        update without registering applications
        delay 2
        -- Closing is what writes the layout into the image's .DS_Store.
        close
      end tell
    end tell
`;

// Compile it before touching anything, so a syntax slip fails here — loudly, on
// every machine — instead of as a quiet "could not style" on a release build.
try {
  execFileSync('osacompile', ['-o', path.join(OUT, 'style.scpt'), '-e', styleScript],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  rmSync(path.join(OUT, 'style.scpt'), { force: true });
} catch (err) {
  try { detach(mount, device); } catch { /* the error below is the one that matters */ }
  console.error(`\n  ✗ The window-layout AppleScript does not compile: ${osaReason(err)}\n`);
  process.exit(1);
}

try {
  execFileSync('osascript', ['-e', styleScript], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
} catch (err) {
  console.log(`  (could not style the window: ${osaReason(err)})`);
  // Locally that is a warning — the image still installs. On a release build it
  // is a failure: a window with no instructions must never ship quietly again.
  if (process.env.CI) {
    try { detach(mount, device); } catch { /* the error below is the one that matters */ }
    console.error('\n  ✗ The disk image window could not be laid out. Refusing to publish a plain one.\n');
    process.exit(1);
  }
}

// Finder writes the layout into .DS_Store when the window closes. No file means
// the layout never landed, whatever the script reported.
if (!existsSync(path.join(mount, '.DS_Store'))) {
  console.log('  (the window layout was not saved — the image will open as a plain list)');
  if (process.env.CI) {
    try { detach(mount, device); } catch { /* the error below is the one that matters */ }
    console.error('\n  ✗ No .DS_Store in the disk image. Refusing to publish a plain window.\n');
    process.exit(1);
  }
}

execFileSync('sync');
detach(mount, device);
run('hdiutil', ['convert', rw, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', dmg, '-ov']);
rmSync(rw, { force: true });
rmSync(staging, { recursive: true, force: true });
checkImage(dmg);

// Check the app as people will get it: inside the finished image, not the copy
// in dist/. Its signature must verify strictly, and no symlink may point
// outside the app (a build-machine path works on the build machine and nowhere
// else). Any failure fails the build.
function checkImage(image) {
  step('Checking the app inside the disk image');
  const mnt = path.join(OUT, 'check-mnt');
  mkdirSync(mnt, { recursive: true });
  const lines = execFileSync('hdiutil', ['attach', image, '-nobrowse', '-readonly', '-mountpoint', mnt])
    .toString().split('\n').map((l) => l.trim()).filter(Boolean);
  const dev = (lines.map((l) => l.match(/^\/dev\/disk\d+/)).find(Boolean) || [null])[0];
  let problem = null;
  try {
    const inside = path.join(mnt, `${APP_NAME}.app`);
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', inside], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      problem = `its signature does not verify: ${(err.stderr || '').toString().trim().split('\n').slice(0, 2).join(' ')}`;
    }
    const escaping = execFileSync('find', [inside, '-type', 'l'])
      .toString().split('\n').filter(Boolean)
      .filter((link) => {
        const target = readlinkSync(link);
        return path.isAbsolute(target) || !path.resolve(path.dirname(link), target).startsWith(inside);
      });
    if (escaping.length) problem = `${escaping.length} symlink(s) point outside the app, e.g. ${path.relative(mnt, escaping[0])} → ${readlinkSync(escaping[0])}`;
  } finally {
    detach(mnt, dev);
    rmSync(mnt, { recursive: true, force: true });
  }
  if (problem) {
    console.error(`\n  ✗ The app inside ${path.basename(image)} is broken: ${problem}\n`);
    process.exit(1);
  }
  console.log('  signature verifies, and every link stays inside the app');
}

const size = execFileSync('du', ['-h', dmg]).toString().split('\t')[0];
console.log(`\n✓ ${dmg}  (${size})\n`);
console.log('  Unsigned by design: notarisation needs a paid Apple account.');
console.log('  First launch needs one approval in System Settings > Privacy & Security.\n');
