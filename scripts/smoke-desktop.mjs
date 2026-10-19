#!/usr/bin/env node
// CI's check of the Windows and Linux apps as installed (docs/brain/DESKTOP.md
// rule 6), the same checks release.yml runs on the Mac app: the scanner's code
// isn't in it (it comes only as a plugin), it opens, every page answers, the
// scanner would run on the Python inside the app (the plugin runtime), a real
// scanner plugin built from this checkout installs and a scan job starts on it
// and finishes (Save photos: the plugin's scrape.py on the app's Python, talking
// to the app, with no browser and nothing of LinkedIn's), Settings → Updates
// offers the installer and never the Mac's swap, a second copy hands over and
// exits, it quits, and nothing of it is left running.
//
//   node scripts/smoke-desktop.mjs --exe <app executable> --dir <install folder> --home <scratch data folder> [--shot <png>]
//
// Node, not PowerShell: PowerShell can't pass an environment variable set to
// '' (it deletes it), and Electron's stdout is hard to read on Windows, so the
// app writes its address to a file (SIX_DEGREES_SMOKE_READY).

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { startTestReleaseServer } from './test-release-server.mjs';
import { SCANNER_CODE } from '../lib/scanner-files.js';
import { buildPackage, PLUGINS } from './build-plugin.mjs';
import { SIZE_HEADER, CONFIRM_HEADER } from '../lib/plugins-client.js';
import { SHIPPED_PLUGIN_VERSION } from '../lib/plugins-shipped.js';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
const EXE = arg('exe');
const DIR = arg('dir');
const HOME = arg('home');
const SHOT = arg('shot');
if (!EXE || !DIR || !HOME) { console.error('Usage: --exe <app> --dir <install folder> --home <data folder> [--shot <png>]'); process.exit(2); }
const WIN = process.platform === 'win32';
const KIND = WIN ? 'windows-app' : 'linux-app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };
const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (file, dir) => {
  const f = path.resolve(file); const d = path.resolve(dir) + path.sep;
  return WIN ? f.toLowerCase().startsWith(d.toLowerCase()) : f.startsWith(d);
};

// ---- no scanner code inside: it comes only as a plugin (lib/scanner-files.js) --------
// Looked for by name anywhere in the server, not only in scripts/: tracing keeps
// a file where it was, but a copy step could put one somewhere else.
const SCANNER_NAMES = new Set(SCANNER_CODE.map((rel) => path.basename(rel)));
const scannerCode = (function find(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, e.name);
    const found = e.isDirectory() ? find(at) : SCANNER_NAMES.has(e.name) ? at : null;
    if (found) return found;
  }
  return null;
})(path.join(DIR, 'resources', 'server'));
if (scannerCode) fail(`The scanner's code is inside the app: ${scannerCode}. It ships only as a plugin (next.config.mjs).`);
console.log('  no scanner code in the app');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const slug = String(pkg.repository?.url || pkg.repository).match(/github\.com[/:]([^/]+\/[^/.#?]+)/)[1];
// A pretend newer release, so Updates has something to offer (and must not install).
const releases = await startTestReleaseServer({ slug, release: { version: '99.0.0', assets: [{ name: 'Six-Degrees-99.0.0-win-x64-Setup.exe', data: Buffer.from('not an installer') }] } });

rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
const READY = path.join(HOME, '..', `ready-${process.pid}.txt`);

function start(extraEnv = {}) {
  rmSync(READY, { force: true });
  const env = {
    ...process.env,
    SIX_DEGREES_HOME: HOME,
    SIX_DEGREES_SMOKE: '1',
    SIX_DEGREES_SMOKE_READY: READY,
    SIX_DEGREES_TEST_RELEASES: releases.origin,
    ...(SHOT ? { SIX_DEGREES_SMOKE_SHOT: SHOT } : {}),
    ...extraEnv,
  };
  const child = spawn(EXE, [], { env, stdio: 'ignore', detached: !WIN });
  child.on('error', (e) => fail(`Could not start the app: ${e.message}`));
  return child;
}
async function ready(child) {
  for (let i = 0; i < 150; i++) {
    if (existsSync(READY)) {
      const url = readFileSync(READY, 'utf8').trim();
      if (url) return url;
    }
    if (child.exitCode !== null) fail(`The app exited while starting (code ${child.exitCode}).`);
    await sleep(1000);
  }
  fail('The app never became ready.');
}
const get = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.text() }; };
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const listening = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});
// Every process running a program from inside the install folder.
function appProcesses() {
  if (WIN) {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'], { maxBuffer: 64 << 20 }).toString();
    const list = JSON.parse(out || '[]');
    return (Array.isArray(list) ? list : [list]).filter((p) => p.ExecutablePath && inside(p.ExecutablePath, DIR)).map((p) => `${p.ProcessId} ${p.ExecutablePath}`);
  }
  const found = [];
  for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    try { const exe = readlinkSync(`/proc/${pid}/exe`); if (inside(exe, DIR)) found.push(`${pid} ${exe}`); } catch { /* gone, or not ours to read */ }
  }
  return found;
}
async function quit(child) {
  if (WIN) {
    // As a window's close button or Setup does: taskkill without /F sends WM_CLOSE.
    try { execFileSync('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore' }); } catch { /* reported below if it stays */ }
  } else {
    process.kill(child.pid, 'SIGTERM');
  }
  for (let i = 0; i < 45 && child.exitCode === null; i++) await sleep(1000);
  if (child.exitCode === null) fail('The app did not quit.');
  await sleep(3000);
}

// ---- open it, reach every page ------------------------------------------------
let app = start();
let url = await ready(app);
console.log(`Running at ${url}`);
for (const p of ['', 'paths', 'class', 'setup', 'settings', 'api/network', 'api/company-scores', 'api/scraper', 'api/settings']) {
  const { status } = await get(`${url}/${p}`);
  console.log(`  /${p} ${status}`);
  if (status !== 200) fail(`/${p} answered ${status}`);
}

// ---- a scanner would run on the app's own Python: the plugin runtime ------------------
const scanner = JSON.parse((await get(`${url}/api/scraper`)).body).checks;
console.log('  plugin runtime:', scanner.pythonSource, scanner.pythonVersion, scanner.pythonPath, '· chrome', scanner.chrome);
if (scanner.pythonSource !== 'bundled' || !scanner.dependencies || !inside(scanner.pythonPath, DIR)) fail('The app isn\'t using the Python inside it.');
if (!scanner.chrome) fail('Google Chrome is installed on this runner, and the app didn\'t find it.');

// ---- a real scanner plugin: built, installed, and a scan job started on it -------------
// The app has no scanner of its own, so until now CI never started one. The Auto scan
// package, built from this checkout the way releases build it (scripts/build-plugin.mjs),
// installed through Settings → Plugins' own route (its check, then the yes naming the
// checksum the check gave). Then a job that runs the plugin's scrape.py on the app's
// Python and has it talk to the app, without LinkedIn: Save photos opens no browser and
// no page (lib/scan-risk.js OFF_LINKEDIN), and on a fresh data folder has none to save.
const sendPackage = async (zip, headers = {}) => {
  const r = await fetch(`${url}/api/plugins/install${headers[CONFIRM_HEADER] ? '' : '?check=1'}`, {
    method: 'POST', body: zip, headers: { 'Content-Type': 'application/octet-stream', [SIZE_HEADER]: String(zip.length), ...headers },
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const autoScan = PLUGINS.find((p) => p.id === 'auto-scan');
const zip = buildPackage(autoScan, { version: SHIPPED_PLUGIN_VERSION, appVersion: pkg.version });
const enabled = await post(`${url}/api/plugins/enabled`, { enabled: true });
if (enabled.status !== 200) fail(`Turning plugins on answered ${enabled.status}: ${enabled.json.error || ''}`);
const checked = await sendPackage(zip);
if (checked.status !== 200 || !checked.json.sha256) fail(`The plugin's check answered ${checked.status}: ${checked.json.error || ''}`);
const installed = await sendPackage(zip, { [CONFIRM_HEADER]: checked.json.sha256 });
if (installed.status !== 200) fail(`Installing the plugin answered ${installed.status}: ${installed.json.error || ''}`);
const withPlugin = JSON.parse((await get(`${url}/api/scraper`)).body).checks;
console.log(`  installed ${autoScan.name} ${SHIPPED_PLUGIN_VERSION}: scanner from`, withPlugin.scanner?.from, withPlugin.scanner?.plugin?.version);
if (!withPlugin.scriptsFound || withPlugin.scanner?.from !== 'plugin') fail('The app doesn\'t scan with the plugin just installed.');
const job = await post(`${url}/api/scraper`, { action: 'photos' });
if (job.status !== 200) fail(`A scan job on the plugin wouldn't start (${job.status}): ${job.json.error || ''}`);
let ran = null;
for (let i = 0; i < 120; i++) {
  ran = JSON.parse((await get(`${url}/api/scraper?job=1`)).body);
  if (!ran.running) break;
  await sleep(1000);
}
console.log('  scan job on the plugin:', ran.action, 'exit', ran.exitCode, ran.exitKind);
if (ran.running) fail('The scan job on the plugin never finished.');
if (ran.exitCode !== 0 || !ran.log.some((line) => /No photos are waiting to be saved/.test(line))) {
  fail(`The scan job on the plugin didn't run through (exit ${ran.exitCode}):\n${ran.log.slice(-15).join('\n')}`);
}

// ---- Updates: the installer, never the Mac's swap or a Terminal line ---------------
const local = JSON.parse((await get(`${url}/api/update`)).body);
console.log('  updates:', local.kind, local.version, local.command);
if (local.kind !== KIND || local.command !== null) fail(`Updates thinks this is ${local.kind} (command ${local.command}).`);
const released = await post(`${url}/api/update`, { action: 'check-release' });
console.log('  check:', released.status, released.json.newer, released.json.install, released.json.fallback);
if (released.status !== 200 || !released.json.newer || released.json.install || released.json.fallback) fail('Check for updates didn\'t offer the newer release the right way.');
const refused = await post(`${url}/api/update`, { action: 'install-release' });
if (refused.status !== 400) fail(`Install and restart answered ${refused.status}: it must refuse off the Mac.`);
if (releases.requests.some((r) => r.includes('/releases/download/'))) fail('Something downloaded the pretend release.');

// ---- a second copy hands over and exits --------------------------------------------
const second = spawn(EXE, [], { env: { ...process.env, SIX_DEGREES_HOME: HOME }, stdio: 'ignore' });
for (let i = 0; i < 20 && second.exitCode === null; i++) await sleep(1000);
if (second.exitCode === null) { try { second.kill(); } catch {} fail('A second copy kept running.'); }
console.log('  a second launch handed over and exited');

// ---- quit; nothing left ---------------------------------------------------------------
const port = Number(new URL(url).port);
await quit(app);
if (await listening(port)) fail('The server was left running.');
const left = appProcesses();
if (left.length) fail(`App processes were left running:\n${left.join('\n')}`);
const pyRoot = path.join(DIR, 'resources', 'python');
const bytecode = (function find(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === '__pycache__') return path.join(dir, e.name);
    const deeper = find(path.join(dir, e.name)); if (deeper) return deeper;
  }
  return null;
})(pyRoot);
if (bytecode) fail(`Something wrote bytecode into the app's Python: ${bytecode}`);
console.log('  quit, and nothing was left running');

// ---- again with the app's Python off: a job to stop while quitting ------------------------
app = start({ SIX_DEGREES_PYTHON: '' });
url = await ready(app);
const checks = JSON.parse((await get(`${url}/api/scraper`)).body).checks;
// Setting up the scanner is the job, which needs a scanner: a plugin, since the
// app has none of its own; the one installed above.
const action = !checks.scriptsFound ? null : checks.installFrom ? 'install' : checks.download ? 'setup' : null;
if (action) {
  const started = await post(`${url}/api/scraper`, { action });
  console.log(`  started "${action}" to have a job running:`, started.status);
  await sleep(3000);
} else {
  console.log(checks.scriptsFound ? '  no Python on this runner to install from: quitting without a job' : '  no scanner plugin installed: quitting without a job');
}
await quit(app);
if (await listening(Number(new URL(url).port))) fail('The server was left running (second run).');
const left2 = appProcesses();
if (left2.length) fail(`App processes were left running after quitting mid-job:\n${left2.join('\n')}`);

await releases.close();
rmSync(READY, { force: true });
console.log('\n✓ No scanner code inside, opened, reached every page, its own Python for plugins, a scan job ran on a real plugin, updates by installer, refused a second copy, quit, left nothing.');
process.exit(0);
