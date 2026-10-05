#!/usr/bin/env node
// Build the desktop app for Windows or Linux (docs/brain/DESKTOP.md D3).
//
//   node scripts/build-desktop.mjs --platform=win32   # on Windows: dist/Sixgree-<v>-win-x64-Setup.exe
//   node scripts/build-desktop.mjs --platform=linux   # on Linux:   dist/six-degrees_<v>_amd64.deb and a .tar.gz
//   --fast   reuse the existing Next build (only while working on the packaging itself)
//
// The same app as the Mac's (scripts/build-app.mjs, left untouched): the same
// standalone server on the same bundled Node, the same Electron shell
// (desktop/), and the scanner's own Python with its packages installed, so
// nothing needs installing before a scan. What differs is only the packaging:
//   Windows  @electron/packager, then Inno Setup (preinstalled on GitHub's
//            windows runners) for a one-click, per-user Setup.exe with Start
//            Menu and Desktop shortcuts. No admin rights asked for.
//   Linux    @electron/packager, then a .deb (chrome-sandbox setuid root, which
//            Electron needs on Ubuntu 24.04 and later) and a plain .tar.gz.
// Unsigned (the Mac app is signed and notarized since D4; Windows signing is
// D4's other half): Windows shows SmartScreen's "More info → Run anyway" the
// first time.
//
// Built on the platform it is for (release.yml has a job each): pip installs
// the Python's packages by running that Python. No new npm dependency: packager
// is the Mac build's, the icons come from sharp (Next's), Inno Setup and
// dpkg-deb are the runners' own.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, rmSync, cpSync, writeFileSync, existsSync, readFileSync, readdirSync, renameSync, chmodSync, symlinkSync,
  realpathSync, statSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { standaloneBuild, downloadVerified, IMPORTS } from '../lib/scanner-python.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = (process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1]) || process.platform;
if (!['win32', 'linux'].includes(PLATFORM)) {
  console.error('Usage: node scripts/build-desktop.mjs --platform=win32|linux (the Mac app is scripts/build-app.mjs)');
  process.exit(2);
}
if (PLATFORM !== process.platform) {
  console.error(`Build the ${PLATFORM} app on ${PLATFORM}: pip installs its Python's packages by running that Python.`);
  process.exit(2);
}
const WIN = PLATFORM === 'win32';
const ARCH = 'x64';
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
// The executable and install folder keep the name 1.0.0 installed ("Six Degrees.exe",
// Programs\Six Degrees): Setup.exe replaces that install in place (same AppId).
// What people see is DISPLAY_NAME (window title, shortcuts, Apps & features).
const APP_NAME = 'Six Degrees';
const DISPLAY_NAME = 'Sixgree';
const OUT = path.join(ROOT, 'dist');
const STAGE = path.join(OUT, 'stage');
const CACHE = path.join(os.homedir(), '.cache', 'six-degrees-build');
// Windows' own tar (bsdtar): it reads .zip as well, and a bash step's PATH finds
// Git's GNU tar first, which takes "C:" for a remote host.
const TAR = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

// The same Node as the Mac app's server, pinned by its SHA-256 from nodejs.org's SHASUMS256.txt.
const NODE_VERSION = 'v24.21.0';
const NODE = WIN
  ? { file: `node-${NODE_VERSION}-win-x64.zip`, sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541', size: 37618919, member: `node-${NODE_VERSION}-win-x64/node.exe` }
  : { file: `node-${NODE_VERSION}-linux-x64.tar.gz`, sha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff', size: 58088022, member: `node-${NODE_VERSION}-linux-x64/bin/node` };

function step(msg) { console.log(`\n▸ ${msg}`); }
function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}
function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
async function fetchPinned({ url, file, sha256, size }, what) {
  const archive = path.join(CACHE, file);
  mkdirSync(CACHE, { recursive: true });
  if (existsSync(archive) && sha256File(archive) === sha256) {
    console.log(`  ${what}: using the cached download (its SHA-256 matches the pinned one)`);
  } else {
    rmSync(archive, { force: true });
    await downloadVerified(url, archive, { sha256, size, idleMs: 60000, from: new URL(url).host });
    console.log(`  ${what}: downloaded, and its SHA-256 matches the pinned one`);
  }
  return archive;
}
function findDirs(dir, match) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = path.join(dir, entry.name);
    if (match(entry.name)) found.push(at);
    else found.push(...findDirs(at, match));
  }
  return found;
}
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(at);
    else yield at;
  }
}

// ---- 1. the app itself (always rebuilt: build-app.mjs says why) -------------
rmSync(OUT, { recursive: true, force: true });
step('Building the app');
if (process.argv.includes('--fast') && existsSync(path.join(ROOT, '.next', 'standalone', 'server.js'))) {
  console.log('  --fast: reusing the existing build (make sure it is current)');
} else {
  // node, not npm: execFile can't start npm.cmd on Windows.
  run(process.execPath, [path.join(ROOT, 'scripts', 'next.mjs'), 'build'], { cwd: ROOT });
  run(process.execPath, [path.join(ROOT, 'scripts', 'prepare-standalone.mjs')], { cwd: ROOT });
}

step('Assembling the server');
const SERVER_DIR = path.join(STAGE, 'server');
mkdirSync(STAGE, { recursive: true });
cpSync(path.join(ROOT, '.next', 'standalone'), SERVER_DIR, { recursive: true, verbatimSymlinks: true });
if (existsSync(path.join(SERVER_DIR, '.git'))) rmSync(path.join(SERVER_DIR, '.git'), { recursive: true, force: true });
// The files the app runs from scripts/, by name (TRAPS §27). Not apply-update.sh:
// only the Mac app replaces itself; here an update is the new installer, and a
// missing helper is one more thing that keeps the Mac swap from ever running.
for (const rel of ['scripts/scrape.py', 'scripts/image_store.py', 'scripts/requirements.txt', 'scripts/audit-avatars.mjs']) {
  mkdirSync(path.join(SERVER_DIR, path.dirname(rel)), { recursive: true });
  cpSync(path.join(ROOT, rel), path.join(SERVER_DIR, rel));
}

// ---- 2. the runtime ----------------------------------------------------------
step(`Fetching Node ${NODE_VERSION}`);
const nodeArchive = await fetchPinned({ url: `https://nodejs.org/dist/${NODE_VERSION}/${NODE.file}`, ...NODE }, 'Node');
run(TAR, ['-xf', nodeArchive, '-C', CACHE, NODE.member]);
const NODE_OUT = path.join(STAGE, WIN ? 'node.exe' : 'node');
cpSync(path.join(CACHE, NODE.member), NODE_OUT);
if (!WIN) chmodSync(NODE_OUT, 0o755);

// ---- 3. the icon ---------------------------------------------------------------
// From desktop/icon/icon.svg, like the Mac's .icns (not app/favicon.ico: that is
// Next's default, Vercel's mark). A .ico is PNGs in a small directory; sharp makes the PNGs.
step('Making the icon');
const { default: sharp } = await import('sharp');
const svg = path.join(ROOT, 'desktop', 'icon', 'icon.svg');
const png = async (size) => sharp(svg, { density: 288 }).resize(size, size).png().toBuffer();
let ICON;
if (WIN) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(png));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  ICON = path.join(STAGE, 'six-degrees.ico');
  writeFileSync(ICON, Buffer.concat([header, ...images]));
} else {
  ICON = path.join(STAGE, 'six-degrees.png');
  writeFileSync(ICON, await png(512));
}

// ---- 4. the Electron shell ---------------------------------------------------
step('Building the Electron app');
const { packager } = await import('@electron/packager');
const electronVersion = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const shellSrc = path.join(STAGE, 'shell');
cpSync(path.join(ROOT, 'desktop'), shellSrc, { recursive: true, filter: (p) => !p.split(path.sep).includes('icon') });
const shellPkg = JSON.parse(readFileSync(path.join(shellSrc, 'package.json'), 'utf8'));
writeFileSync(path.join(shellSrc, 'package.json'), `${JSON.stringify({ ...shellPkg, version: VERSION }, null, 2)}\n`);
const [built] = await packager({
  dir: shellSrc,
  out: path.join(STAGE, 'out'),
  overwrite: true,
  name: APP_NAME,
  platform: PLATFORM,
  arch: ARCH,
  electronVersion,
  appVersion: VERSION.replace(/-.*/, ''),
  icon: ICON,
  asar: true,
  prune: false,
  junk: true,
  extraResource: [SERVER_DIR, NODE_OUT],
  ...(WIN
    ? { win32metadata: { CompanyName: DISPLAY_NAME, ProductName: DISPLAY_NAME, FileDescription: DISPLAY_NAME, OriginalFilename: `${APP_NAME}.exe` } }
    : { executableName: 'six-degrees' }),
});
const APP_DIR = path.join(OUT, WIN ? 'Six Degrees' : `six-degrees-${VERSION}-linux-x64`);
renameSync(built, APP_DIR);
console.log(`  Electron ${electronVersion} (${PLATFORM} ${ARCH})`);
const RES = path.join(APP_DIR, 'resources');

// ---- 5. the scanner's Python (DESKTOP.md D2, D3) ------------------------------
const build = standaloneBuild(WIN ? 'win32-x64' : 'linux-x64');
const xy = build.version.split('.').slice(0, 2).join('.');
step(`Fetching Python ${build.version}`);
const pyArchive = await fetchPinned(build, 'Python');
const PY = path.join(RES, 'python');
rmSync(PY, { recursive: true, force: true });
run(TAR, ['-xzf', pyArchive, '-C', RES]);
const python = WIN ? path.join(PY, 'python.exe') : path.join(PY, 'bin', 'python3');
const SITE = WIN ? path.join(PY, 'Lib', 'site-packages') : path.join(PY, 'lib', `python${xy}`, 'site-packages');
// Only this Python's own packages and settings: nothing from the build machine's
// user site-packages, PYTHONPATH or pip configuration. Windows' Python can't start without SYSTEMROOT.
const pyEnv = WIN
  ? Object.fromEntries(Object.entries({
    SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA,
    PATH: path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32'),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
  }).filter(([, v]) => v))
  : { HOME: os.homedir(), TMPDIR: os.tmpdir(), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };

step('Installing the scanner\'s packages into it');
run(python, ['-E', '-s', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-input',
  '--no-warn-script-location', '--no-compile', '--index-url', 'https://pypi.org/simple',
  '--cache-dir', path.join(CACHE, 'pip'), '--require-hashes', '--only-binary', ':all:',
  '-r', path.join(ROOT, 'scripts', 'requirements.txt')], { env: pyEnv });
run(python, ['-E', '-s', '-m', 'pip', '--isolated', 'check', '--disable-pip-version-check'], { env: pyEnv });

step('Trimming what the scanner never uses');
const libDir = WIN ? path.join(PY, 'Lib') : path.join(PY, 'lib', `python${xy}`);
const remove = [
  ...['idlelib', 'tkinter', 'turtledemo', 'turtle.py', 'lib2to3', 'ensurepip', 'test'].map((n) => path.join(libDir, n)),
  ...readdirSync(SITE).filter((n) => n === 'pip' || /^pip-.*\.dist-info$/.test(n)).map((n) => path.join(SITE, n)),
  ...(WIN
    ? ['Scripts', 'include', 'libs', 'tcl', path.join('DLLs', '_tkinter.pyd'), path.join('DLLs', 'tcl86t.dll'), path.join('DLLs', 'tk86t.dll')].map((n) => path.join(PY, n))
    : [
      ...['include', 'share', path.join('lib', 'pkgconfig')].map((n) => path.join(PY, n)),
      ...readdirSync(path.join(PY, 'lib')).filter((n) => /^(libtcl|libtk|tcl|tk|itcl|thread)/.test(n)).map((n) => path.join(PY, 'lib', n)),
      ...readdirSync(libDir).filter((n) => n.startsWith('config-')).map((n) => path.join(libDir, n)),
      ...readdirSync(path.join(libDir, 'lib-dynload')).filter((n) => n.startsWith('_tkinter.')).map((n) => path.join(libDir, 'lib-dynload', n)),
      ...readdirSync(path.join(PY, 'bin')).filter((n) => ![`python${xy}`, 'python3', 'python'].includes(n)).map((n) => path.join(PY, 'bin', n)),
    ]),
];
for (const p of remove) rmSync(p, { recursive: true, force: true });
for (const dir of [...findDirs(PY, (n) => n === '__pycache__'), ...findDirs(SITE, (n) => n === 'tests')]) rmSync(dir, { recursive: true, force: true });

// Linux: Playwright's driver carries its own Node; when it is byte for byte the
// app's, it becomes a relative link to it (as on the Mac). Not on Windows, where
// a symlink needs admin rights.
const driverNode = path.join(SITE, 'playwright', 'driver', WIN ? 'node.exe' : 'node');
if (!WIN && existsSync(driverNode) && sha256File(driverNode) === sha256File(path.join(RES, 'node'))) {
  rmSync(driverNode);
  symlinkSync(path.relative(path.dirname(driverNode), path.join(RES, 'node')), driverNode);
  if (realpathSync(driverNode) !== realpathSync(path.join(RES, 'node'))) throw new Error('The driver\'s link to the app\'s Node is wrong.');
  console.log('  Playwright runs on the app\'s own Node');
}

step('Checking the Python inside the app');
// As the app runs it (lib/scanner-python.js OWN_PYTHON_FLAGS), with a "→" to
// prove its output is UTF-8 on Windows too.
const check = `${IMPORTS}; import sys, zoneinfo; zoneinfo.ZoneInfo('America/Los_Angeles'); from importlib.metadata import version as v; print('→ Python', sys.version.split()[0], '· Playwright', v('playwright'))`;
run(python, ['-E', '-s', '-B', '-u', '-X', 'utf8', '-c', check], { env: pyEnv });
run(driverNode, [path.join(SITE, 'playwright', 'driver', 'package', 'cli.js'), '--version'], { env: { ...pyEnv } });
for (const dir of findDirs(PY, (n) => n === '__pycache__')) rmSync(dir, { recursive: true, force: true });

// Windows' 260-character path limit: installed under
// C:\Users\<name>\AppData\Local\Programs\Six Degrees\ (about 70), the deepest file must still fit.
if (WIN) {
  let longest = '';
  for (const f of walk(APP_DIR)) { const rel = path.relative(APP_DIR, f); if (rel.length > longest.length) longest = rel; }
  console.log(`  longest path inside the app: ${longest.length} characters`);
  if (longest.length > 170) throw new Error(`${longest} is too long for Windows once installed.`);
}

// ---- 6. the packages ---------------------------------------------------------------
if (WIN) {
  step('Building Setup.exe (Inno Setup)');
  const iscc = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
  ].find((p) => existsSync(p));
  if (!iscc) throw new Error('Inno Setup 6 (ISCC.exe) isn\'t installed.');
  const numeric = `${VERSION.replace(/-.*/, '')}.0`;
  run(iscc, ['/Qp', `/DAppVersion=${VERSION}`, `/DNumericVersion=${numeric}`, `/DSourceDir=${APP_DIR}`,
    `/DOutputDir=${OUT}`, `/DIconFile=${ICON}`, path.join(ROOT, 'scripts', 'windows', 'six-degrees.iss')]);
  const setup = path.join(OUT, `${DISPLAY_NAME}-${VERSION}-win-x64-Setup.exe`);
  if (!existsSync(setup)) throw new Error('Inno Setup didn\'t write Setup.exe.');
  console.log(`  ${path.relative(ROOT, setup)} (${Math.round(statSync(setup).size / 1e6)} MB)`);
} else {
  step('Building the .tar.gz and the .deb');
  // Readable by everyone, writable by the owner: packager's output folder is
  // private (700, it's made as a temporary folder), and installed as root from
  // the .deb that left /opt/six-degrees unreadable to the user who runs it.
  run('chmod', ['-R', 'u+rwX,go+rX,go-w', APP_DIR]);
  run('tar', ['-C', OUT, '-czf', path.join(OUT, `${DISPLAY_NAME}-${VERSION}-linux-x64.tar.gz`), path.basename(APP_DIR)]);
  const deb = path.join(STAGE, 'deb');
  rmSync(deb, { recursive: true, force: true });
  mkdirSync(path.join(deb, 'opt'), { recursive: true });
  // cp -a, not cpSync: links stay relative (TRAPS §37).
  run('cp', ['-a', APP_DIR, path.join(deb, 'opt', 'six-degrees')]);
  // Electron's sandbox helper must be root's and setuid on Ubuntu 24.04 and later,
  // or the app won't start (dpkg-deb --root-owner-group makes it root's).
  chmodSync(path.join(deb, 'opt', 'six-degrees', 'chrome-sandbox'), 0o4755);
  mkdirSync(path.join(deb, 'usr', 'bin'), { recursive: true });
  symlinkSync('../../opt/six-degrees/six-degrees', path.join(deb, 'usr', 'bin', 'six-degrees'));
  mkdirSync(path.join(deb, 'usr', 'share', 'applications'), { recursive: true });
  writeFileSync(path.join(deb, 'usr', 'share', 'applications', 'six-degrees.desktop'), [
    '[Desktop Entry]', 'Type=Application', 'Name=Sixgree', 'Comment=See your LinkedIn network as a galaxy, on your own computer',
    'Exec=/opt/six-degrees/six-degrees %U', 'Icon=six-degrees', 'Terminal=false', 'Categories=Office;Network;', 'StartupWMClass=Sixgree', '',
  ].join('\n'));
  mkdirSync(path.join(deb, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps'), { recursive: true });
  cpSync(ICON, path.join(deb, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', 'six-degrees.png'));
  mkdirSync(path.join(deb, 'DEBIAN'), { recursive: true });
  // A hyphen would be read as a Debian revision: 0.5.1-beta.1 is 0.5.1~beta.1 (which sorts before 0.5.1).
  const debVersion = VERSION.replace('-', '~');
  const kb = Number(execFileSync('du', ['-sk', path.join(deb, 'opt')]).toString().split(/\s+/)[0]);
  writeFileSync(path.join(deb, 'DEBIAN', 'control'), [
    'Package: six-degrees', `Version: ${debVersion}`, 'Architecture: amd64', 'Section: utils', 'Priority: optional',
    'Maintainer: Sixgree <noreply@sixgree.com>', 'Homepage: https://sixgree.com',
    `Installed-Size: ${kb}`,
    'Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libxss1, libxtst6, libasound2t64 | libasound2, libgbm1, libdrm2, xdg-utils',
    'Recommends: google-chrome-stable',
    'Description: See your LinkedIn network as a galaxy, on your own computer',
    ' Sixgree maps the people you know and the people they know, ranks who can',
    ' introduce you to whom, and keeps all of it on this computer. Scanning drives',
    ' your own Google Chrome, which it needs for that part only.', '',
  ].join('\n'));
  const debFile = path.join(OUT, `six-degrees_${debVersion}_amd64.deb`);
  run('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', deb, debFile]);
  console.log(`  ${path.relative(ROOT, debFile)} (${Math.round(statSync(debFile).size / 1e6)} MB)`);
}
rmSync(STAGE, { recursive: true, force: true });
console.log('\n✓ done');
