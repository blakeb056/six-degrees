// Six Degrees for the Mac: the window, the menu and the app's lifecycle, around
// the same local server the app has always run. docs/brain/DESKTOP.md, phase D1.
//
// Electron is only the shell. The server is the bundled Node binary running the
// standalone build, exactly as before Electron, not Electron's own Node. So
// every route, the database and the scanner behave as they always have (rule 2).
//
//   start   pick a free port from 6363, start the server on 127.0.0.1, show a
//           "starting" page, and swap in the app once the server answers
//   links   the app's own pages stay in the app; anything else, LinkedIn above
//           all, opens in the user's own browser (rule 7)
//   quit    a running scan is stopped the way the Stop button stops it, so the
//           scanner closes its own Chrome window; then the server stops.
//           Nothing is left running (rule 6)
//   again   opening the app while it runs brings its window forward
//
// For CI: SIX_DEGREES_SMOKE=1 prints "SIX_DEGREES_READY <address>" once the app
// has drawn, and SIX_DEGREES_SMOKE_SHOT=<file.png> saves a picture of the window.

import { app, BrowserWindow, Menu, dialog, shell, session } from 'electron';
import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeFor, findFreePort, waitForServer, scanRunning, stopScan, stopProcess, dataDirArg,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..'); // only meaningful when run from a checkout (npm run desktop)
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(REPO, '.next', 'standalone');
const NODE = app.isPackaged ? path.join(process.resourcesPath, 'node') : (process.env.SIX_DEGREES_NODE || 'node');
const ROOT = app.isPackaged ? SERVER_DIR : REPO; // the folder holding scripts/scrape.py
const DATA_DIR = dataDirArg(process.argv) || process.env.SIX_DEGREES_HOME || path.join(os.homedir(), '.six-degrees');
const LOG = path.join(os.tmpdir(), 'six-degrees.log');
const REPO_URL = 'https://github.com/blakeb056/six-degrees';
const SMOKE = process.env.SIX_DEGREES_SMOKE === '1';

let server = null;   // the Node server process
let origin = null;   // http://127.0.0.1:<port>, once chosen
let ready = false;   // the server has answered
let win = null;
let quitting = false;

app.setName('Six Degrees');
app.enableSandbox();

if (!app.requestSingleInstanceLock()) {
  // Another copy is running; it brings its window forward (second-instance).
  app.exit(0);
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch((err) => fail('Six Degrees could not start', err));
}

async function start() {
  lockDownSession();
  Menu.setApplicationMenu(buildMenu());
  app.setAboutPanelOptions({
    applicationName: 'Six Degrees',
    applicationVersion: app.getVersion(),
    version: '',
    website: REPO_URL,
    copyright: 'Runs on this computer only. MIT licence.',
  });
  showWindow(); // the "starting" page, until the server answers

  const port = await findFreePort();
  origin = `http://127.0.0.1:${port}`;
  const log = openSync(LOG, 'w');
  server = spawn(NODE, [path.join(SERVER_DIR, 'server.js')], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      SIX_DEGREES_BIND: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      SIX_DEGREES_ROOT: ROOT,
      SIX_DEGREES_HOME: DATA_DIR,
      ...(app.isPackaged ? { SIX_DEGREES_INSTALL: 'mac-app' } : {}),
    },
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  server.on('exit', (code, signal) => {
    if (quitting) return;
    // Stopped by a signal from outside (the installer replacing this copy, or
    // the system): the whole app is going, so go quietly. A crash (an exit
    // code) is worth saying out loud.
    if (signal) {
      quitting = true;
      app.exit(0);
      return;
    }
    fail('Six Degrees stopped', new Error(`Its server exited (code ${code}).`));
  });

  await waitForServer(origin, { isAlive: () => server.exitCode === null && server.signalCode === null });
  ready = true;
  if (win) win.loadURL(origin);
}

function showWindow() {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Six Degrees',
    backgroundColor: '#0a0a1a', // the app's own background: no white flash
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  if (SMOKE) win.webContents.on('did-finish-load', reportReadyOnce);
  if (ready) win.loadURL(origin);
  else win.loadFile(path.join(HERE, 'starting.html'));
}

// Every page in every window follows the same link rules (lib.mjs routeFor).
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const route = routeFor(url, origin);
    if (route === 'app') {
      // The app's own pop-ups, like the page that lists people to open on
      // LinkedIn, get a window of their own under these same rules.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          backgroundColor: '#0a0a1a',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (route === 'browser') shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const route = routeFor(url, origin);
    if (route === 'app') return;
    event.preventDefault();
    if (route === 'browser') shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Only what the app uses: copying to the clipboard (the Updates panel) and full
// screen. No camera, microphone, location or notifications.
function lockDownSession() {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function openInApp(pathname) {
  showWindow();
  if (ready) win.loadURL(origin + pathname);
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Six Degrees',
      submenu: [
        { role: 'about', label: 'About Six Degrees' },
        { label: 'Check for Updates…', click: () => openInApp('/setup') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Six Degrees' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Six Degrees' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Six Degrees on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'What Changed', click: () => shell.openExternal(`${REPO_URL}/releases`) },
        { type: 'separator' },
        { label: 'Show the Data Folder', click: () => shell.openPath(DATA_DIR) },
        { label: 'Show the Log', click: () => shell.showItemInFolder(LOG) },
      ],
    },
  ]);
}

// ── quitting ─────────────────────────────────────────────────────────────────
// Like any Mac app, closing the window leaves Six Degrees running (a long scan
// carries on); Quit ends it. The Dock icon brings the window back.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') requestQuit({ ask: false });
});
app.on('activate', showWindow);

// Every way of quitting arrives here: Cmd-Q, the menu, the Dock, logging out,
// and SIGTERM from the installer replacing a running copy. Electron turns that
// signal into an ordinary quit, and process.on('SIGTERM') never fires in this
// process, so a signal can't be told apart from Cmd-Q. What can be told is
// whether someone is looking at the app. Only then, and only while a scan runs,
// does it ask. Otherwise it stops the scan cleanly and quits: a question
// nobody sees would hold the quit forever (it did, in testing).
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  requestQuit({ ask: !SMOKE && BrowserWindow.getFocusedWindow() !== null });
});

let quitStarted = false;
let asking = false;
async function requestQuit({ ask }) {
  if (quitStarted || asking) return;
  if (ask && origin && (await scanRunning(origin)) === true) {
    asking = true;
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      buttons: ['Stop the Scan and Quit', 'Keep Scanning'],
      defaultId: 1,
      cancelId: 1,
      message: 'A scan is running.',
      detail: 'Quitting stops it the way the Stop button does, and it closes its Chrome window. A list that was stopped part-way carries on from where it got to next time.',
    });
    asking = false;
    if (response !== 0) return;
  }
  quitStarted = true;
  quitting = true;
  try {
    if (origin) await stopScan(origin, { timeoutMs: ask ? 25000 : 8000 });
    await stopProcess(server, { graceMs: 5000 });
  } finally {
    app.exit(0);
  }
}

function fail(title, err) {
  if (quitting) return;
  quitting = true;
  dialog.showErrorBox(title, `${err.message}\n\nThe log is at ${LOG}`);
  stopProcess(server).finally(() => app.exit(1));
}

// ── CI smoke test ────────────────────────────────────────────────────────────
let reported = false;
function reportReadyOnce() {
  if (reported || !win || routeFor(win.webContents.getURL(), origin) !== 'app') return;
  reported = true;
  // Give the page a moment to fetch its data and draw.
  setTimeout(async () => {
    try {
      if (process.env.SIX_DEGREES_SMOKE_SHOT && win) {
        const image = await win.webContents.capturePage();
        writeFileSync(process.env.SIX_DEGREES_SMOKE_SHOT, image.toPNG());
      }
    } finally {
      console.log(`SIX_DEGREES_READY ${origin}`);
    }
  }, 4000);
}
