// Sixgree for the Mac: the window, the menu and the app's lifecycle, around
// the same local server the app has always run. docs/brain/DESKTOP.md, phase D1.
//
// Electron is only the shell. The server is the bundled Node binary running the
// standalone build, exactly as before Electron, not Electron's own Node. So
// every route, the database and the scanner behave as they always have (rule 2).
//
//   start   pick a free port from 6363, start the server on 127.0.0.1, show a
//           "starting" page, and swap in the app once the server answers
//   links   the app's own pages stay in the app; anything else, LinkedIn above
//           all, opens in the user's own browser (rule 7), except the two
//           System Settings panes the Scan page links to (lib.mjs SETTINGS_URLS)
//   panel   with a scanner or the LinkedIn browser plugin installed, LinkedIn
//           can show in a panel of its own under the app's top bar ("Sixgree's
//           own browser", below): the scanner drives it instead of starting
//           Chrome, and every profile link in the app opens in it. Its own
//           sign-in, its own storage, LinkedIn only
//   quit    a running scan is stopped the way the Stop button stops it, so the
//           scanner closes its own Chrome window; then the server stops.
//           Nothing is left running (rule 6)
//   again   opening the app while it runs brings its window forward
//   update  Settings → Updates → Install and restart: the server downloads and
//           checks the new version, starts scripts/apply-update.sh and ends
//           with a code that means "quit quietly" (lib.mjs serverExitAction).
//           The helper swaps the app once this one has gone and opens the new
//           one with --after-update, which opens Settings to show how it went
//   restart the server can ask to be started again (exit code 75, to finish
//           an import from Settings → Your data): the window shows the
//           "starting" page meanwhile and comes back to Settings
//
// For CI: SIX_DEGREES_SMOKE=1 prints "SIX_DEGREES_READY <address>" once the app
// has drawn (and writes the address to SIX_DEGREES_SMOKE_READY=<file>, if given),
// and SIX_DEGREES_SMOKE_SHOT=<file.png> saves a picture of the window.

import { app, BrowserWindow, WebContentsView, Menu, dialog, shell, session, nativeTheme, ipcMain } from 'electron';

// The window's frame follows the app, not the Mac's appearance setting: the app
// is a dark sky, so the title bar, menus and dialogs are dark too, even when the
// Mac is set to Light. Setting it before any window exists means no light frame
// ever shows.
nativeTheme.themeSource = 'dark';
import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeFor, findFreePort, waitForServer, runningJob, quitQuestion, stopScan, stopProcess, dataDirArg,
  RESTART_EXIT_CODE, serverExitAction, bundlePathFromExe, startPathArg,
  userDataPath, isAppUrl, isLinkedInUrl, panelRoute, panelBounds, scannerInstalled, devToolsPort, panelEnv,
  LINKEDIN_PANEL_PARTITION, chromeUserAgent, browserPluginInstalled, panelProfileSlug, createPanelCover,
  sectionUrl, sectionOf, profileAddress, historyMoves, historyKey,
  INVITE_WATCH_JS, INVITE_WATCH_WORLD, inviteSentFor, MUTUAL_WATCH_JS, mutualsSeenFor,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..'); // only meaningful when run from a checkout (npm run desktop)
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(REPO, '.next', 'standalone');
// node.exe on Windows (DESKTOP.md D3); the same Node binary as the Mac's otherwise.
const NODE = app.isPackaged ? path.join(process.resourcesPath, process.platform === 'win32' ? 'node.exe' : 'node') : (process.env.SIX_DEGREES_NODE || 'node');
const ROOT = app.isPackaged ? SERVER_DIR : REPO; // the app's folder: the one with its package.json (lib/paths.js)
// The scanner's own Python, inside the app (DESKTOP.md D2): a standalone CPython
// with the scanner's packages installed when the app was built. The server runs
// the scanner on it before any other Python, so there is nothing to install.
// A SIX_DEGREES_PYTHON the app was started with wins, an empty one included,
// which turns it off: CI does that to check the fallback (the Scan page's
// Install) still works, and to have a job to stop while quitting.
// python.exe sits at the top of the folder on Windows, bin/python3 elsewhere.
const PYTHON = app.isPackaged
  ? path.join(process.resourcesPath, 'python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3']))
  : null;
// Absolute before it reaches the server, which runs from its own folder.
const DATA_DIR = path.resolve(dataDirArg(process.argv) || process.env.SIX_DEGREES_HOME || path.join(os.homedir(), '.six-degrees'));
// Per user off the Mac: Linux's /tmp is shared, and a second user's copy
// couldn't open the first one's log, and so couldn't start. (The Mac's tmpdir is per user already.)
const LOG = path.join(os.tmpdir(), process.platform === 'darwin' ? 'six-degrees.log' : `six-degrees-${os.userInfo().username}.log`);
const REPO_URL = 'https://github.com/blakeb056/six-degrees';
const SMOKE = process.env.SIX_DEGREES_SMOKE === '1';
// This app's own bundle, for the in-app updater, which replaces it. The shell
// knows it for certain; the server would otherwise have to guess from its folder.
// process.execPath, not app.getPath('exe'): the same path, and it can't throw
// here, before the app is ready.
// On Windows and Linux it is the folder the app is installed in (DESKTOP.md D3):
// the server needs it to know the Python in it is the app's own ('bundled').
const APP_BUNDLE = !app.isPackaged ? null
  : process.platform === 'darwin' ? bundlePathFromExe(process.execPath)
    : path.dirname(process.execPath);
// What kind of install this is, for Settings → Updates (lib/release.js): only the
// Mac app replaces itself; on Windows and Linux an update is the new installer.
const INSTALL_KIND = { darwin: 'mac-app', win32: 'windows-app', linux: 'linux-app' }[process.platform] || 'mac-app';

let server = null;   // the Node server process
let origin = null;   // http://127.0.0.1:<port>, once chosen
let ready = false;   // the server has answered
let win = null;
let quitting = false;
// A menu choice made before the server answered, or Settings when opened after an update.
let pendingPath = startPathArg(process.argv);

app.setName('Sixgree');
// Still the "Six Degrees" folder (lib.mjs userDataPath), so a rename resets nothing.
// Here, before anything reads it: the single-instance lock below is the first.
// A checkout (npm run desktop, never a download) may name another folder in
// SIX_DEGREES_SHELL_DATA, so a copy being worked on runs beside the installed
// app instead of finding its lock and handing over to it.
const USER_DATA = !app.isPackaged && process.env.SIX_DEGREES_SHELL_DATA
  ? path.resolve(process.env.SIX_DEGREES_SHELL_DATA)
  : userDataPath(app.getPath('appData'));
app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);
app.enableSandbox();
// Windows groups the taskbar button and the Start Menu shortcut by this (scripts/windows/six-degrees.iss).
if (process.platform === 'win32') app.setAppUserModelId('com.blakeburford.sixdegrees');

// Sixgree's own browser (the LinkedIn panel, below): with a scanner to drive
// it, or the LinkedIn browser plugin to browse in it, and SIX_DEGREES_PANEL=0
// turns it off (the scanner then starts its own Chrome, as before). The
// debugging port the scanner attaches through opens only with a scanner. Read
// once, here: Chromium's switches must be set before the app is ready.
const PANEL_OFF = process.env.SIX_DEGREES_PANEL === '0';
const SCANNER_HERE = !PANEL_OFF && scannerInstalled({
  dataDir: DATA_DIR, repo: REPO, packaged: app.isPackaged, exists: existsSync, list: (dir) => readdirSync(dir),
});
const PANEL_WANTED = !PANEL_OFF && (SCANNER_HERE || browserPluginInstalled({ dataDir: DATA_DIR, exists: existsSync }));
// One more address the panel may show, for checking a checkout against a local
// test page (lib.mjs panelRoute). Never in a download.
const PANEL_TEST_ORIGIN = !app.isPackaged ? process.env.SIX_DEGREES_PANEL_TEST_ORIGIN || null : null;

if (!app.requestSingleInstanceLock()) {
  // Another copy is running; it brings its window forward (second-instance).
  app.exit(0);
} else {
  app.on('second-instance', showWindow);
  if (SCANNER_HERE) openDebuggingPort();
  app.whenReady().then(start).catch((err) => fail('Sixgree could not start', err));
}

async function start() {
  lockDownSession();
  setUpPanelMessages();
  Menu.setApplicationMenu(buildMenu());
  app.setAboutPanelOptions({
    applicationName: 'Sixgree',
    applicationVersion: app.getVersion(),
    version: '',
    website: REPO_URL,
    copyright: 'Runs on this computer only. MIT licence.',
  });
  showWindow(); // the "starting" page, until the server answers
  // Before the server, which hands the panel's address on to every scanner it starts.
  if (PANEL_WANTED) await createPanel();
  await startServer(await findFreePort(), { logMode: 'w' });
}

// The server on `port`. Also how it is started again when it asks to: an
// import (Settings → Your data) is finished as the server starts.
async function startServer(port, { logMode }) {
  origin = `http://127.0.0.1:${port}`;
  const log = openSync(LOG, logMode);
  const child = spawn(NODE, [path.join(SERVER_DIR, 'server.js')], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      SIX_DEGREES_BIND: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      SIX_DEGREES_ROOT: ROOT,
      SIX_DEGREES_HOME: DATA_DIR,
      // Tells the server this shell starts it again when it exits with this
      // code, so Settings can offer "Restart now".
      SIX_DEGREES_RESTART_CODE: String(RESTART_EXIT_CODE),
      ...(app.isPackaged ? { SIX_DEGREES_INSTALL: INSTALL_KIND } : {}),
      ...(APP_BUNDLE ? { SIX_DEGREES_APP: APP_BUNDLE } : {}),
      ...(PYTHON && process.env.SIX_DEGREES_PYTHON === undefined && existsSync(PYTHON) ? { SIX_DEGREES_PYTHON: PYTHON } : {}),
      // Where the scanner finds the LinkedIn panel (lib.mjs panelEnv), when there is one.
      ...panelEnvVars,
    },
    stdio: ['ignore', log, log],
    // No console window for node.exe on Windows (the app has none of its own to share).
    windowsHide: true,
  });
  closeSync(log);
  server = child;
  let answered = false; // this server has answered at least once
  child.on('exit', (code, signal) => {
    // What to do is decided in lib.mjs (tested): stopped from outside quits
    // quietly, the restart code starts it again (unless this server never
    // answered: then it can't stay up), any other exit is a crash and is said
    // out loud.
    const action = serverExitAction({ code, signal, quitting, answered });
    if (action === 'ignore') return;
    if (action === 'quit') {
      quitting = true;
      app.exit(0);
      return;
    }
    if (action === 'restart') {
      restartServer(port);
      return;
    }
    fail('Sixgree stopped', new Error(`Its server exited (code ${code}).`));
  });

  await waitForServer(origin, { isAlive: () => child.exitCode === null && child.signalCode === null });
  answered = true;
  ready = true;
  if (win) win.loadURL(origin + (pendingPath || ''));
  pendingPath = null;
}

// The server asked to be started again. The same port if it is still free, so
// the page's own storage (kept per address) carries on. Meanwhile the window
// shows the starting page, and then comes back to Settings → Your data, where
// the finished import is reported.
async function restartServer(port) {
  ready = false;
  pendingPath = '/settings#data';
  if (win) win.loadFile(path.join(HERE, 'starting.html'));
  try {
    const again = await findFreePort(port, port).catch(() => findFreePort());
    if (quitting) return; // quit while the port was being found: start nothing
    await startServer(again, { logMode: 'a' });
  } catch (err) {
    fail('Sixgree could not restart', err);
  }
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
    title: 'Sixgree',
    backgroundColor: '#0a0a1a', // the app's own background: no white flash
    show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      // Only the LinkedIn panel's controls (preload.cjs), answered for the app's own address alone.
      preload: path.join(HERE, 'preload.cjs'),
    },
  });
  win.once('ready-to-show', () => win.show());
  // The panel outlives the window (a scan carries on with it closed): taken
  // out before the window goes, and put into the next one.
  win.on('close', () => { if (panel && win) win.contentView.removeChildView(panel); });
  win.on('closed', () => { win = null; });
  for (const name of ['resize', 'enter-full-screen', 'leave-full-screen']) win.on(name, placePanel);
  // Away from the app's own pages (the starting page while the server
  // restarts), nothing says where the panel goes: it goes.
  win.webContents.on('did-navigate', (_event, url) => { if (!isAppUrl(url, origin)) setPanelVisible(false); });
  win.webContents.on('zoom-changed', () => setImmediate(placePanel));
  // Cmd+[ and Cmd+] go back and forward in the panel while it shows, whichever has the keyboard.
  win.webContents.on('before-input-event', (event, input) => { if (historyShortcut(input)) event.preventDefault(); });
  attachPanel();
  if (SMOKE) win.webContents.on('did-finish-load', reportReadyOnce);
  if (ready) win.loadURL(origin);
  else win.loadFile(path.join(HERE, 'starting.html'));
}

// Every page in every window follows the same link rules (lib.mjs routeFor).
// The LinkedIn panel follows its own (panelRules).
app.on('web-contents-created', (_event, contents) => {
  if (panelSession && contents.session === panelSession) {
    panelRules(contents);
    return;
  }
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
    // A web link goes to the user's browser; one of the System Settings panes
    // the Scan page links to (App Management) opens System Settings there.
    if (route === 'browser' || route === 'settings') shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const route = routeFor(url, origin);
    if (route === 'app') return;
    event.preventDefault();
    // The Scan page's Open App Management is a plain link (no new tab in a
    // browser), so it arrives here rather than at the handler above.
    if (route === 'browser' || route === 'settings') shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Only what the app uses: copying to the clipboard (the Updates panel) and full
// screen. No camera, microphone, location or notifications. The LinkedIn panel's
// session gets the same.
function lockDownSession() {
  lockDown(session.defaultSession);
}

function lockDown(ses) {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

// ── Sixgree's own browser ────────────────────────────────────────────────────
// LinkedIn in a panel of the window (a WebContentsView), under the app's top
// bar, which stays in sight and in use: its tabs, the notch, the scan light.
// Blake, 2026-10-15: "I want it embedded in the sixgree screen with maybe the
// top ui tab visible with the notch". docs/brain/DESKTOP.md rule 7.
//
//   storage  its own partition (persist:linkedin): LinkedIn's sign-in lives
//            there, apart from the app's pages, and lasts from one start to
//            the next. The user signs in to LinkedIn once more, here.
//   pages    LinkedIn's only. Any other link opens in the user's own browser,
//            anything that isn't a web page nowhere (lib.mjs panelRoute)
//   shown    hidden until the page asks: LinkedIn needs you (signing in, a
//            security check, a manual read), a profile link was pressed, a
//            LinkedIn tab button, or the user pressed Show LinkedIn. Hiding it never stops a scan: the
//            page keeps working out of sight, as the scanner's Chrome did
//   scanner  attaches over Chromium's debugging protocol and drives that one
//            page (scripts/scrape.py attach_panel), told which by its target
//            id (lib.mjs panelEnv). Only with a scanner installed: with only
//            the LinkedIn browser plugin, the panel is for browsing, and the
//            debugging port stays shut
//   agent    plain Chrome's: the session's user agent with the Sixgree/x and
//            Electron/x tokens taken out (lib.mjs chromeUserAgent; Blake,
//            2026-10-15, "the panel should identify as plain Chrome"). That
//            and nothing more: no client hints, no navigator.webdriver, no
//            fingerprint. The app's own pages keep Electron's default
//   profile  every profile link in the app (Connect, View profile, Outlink's
//            Open profile) loads that profile here straight away, from this
//            process (showProfile): no scanner, no wait. You connect by hand.
//            The page has the server count it as one profile view
//   history  Back and Forward on the page's bar, and Cmd+[ / Cmd+], go
//            through the panel's own history (lib.mjs historyMoves)
//   covered  anything the page opens over it (a menu, the notch, a note) is
//            shown over a still picture of it instead (lib.mjs createPanelCover)
//   invited  on a profile a link opened, LinkedIn's "Invitation sent" notice after
//            you press Connect sends you back: a watcher in an isolated world of the
//            panel's page (lib.mjs INVITE_WATCH_JS) prints one line, and the app's
//            page marks the request sent, puts the panel away and says so
//            (watchInvites, inviteSent; Blake, 2026-10-16)
//   mutuals  a profile's mutual line ("Maya Chen, Leo Park and 103 other mutual
//            connections"), read where the panel already shows it by a second
//            watcher in that world (lib.mjs MUTUAL_WATCH_JS): its line is sent to the
//            app's own server (POST /api/ties), once a profile a day, and kept as
//            ties of the mutual web (lib/ties.js). Nothing is opened for it
//            (mutualsSeen; Blake, 2026-10-16)
//
// The trade-off, said plainly: the debugging port listens on 127.0.0.1 only,
// on a port the system picks at each start, and only while the app runs with a
// scanner installed. But nothing asks who is knocking: any program running on
// this computer as any user could attach to it while the app is open, and from
// there read the panel's LinkedIn session or drive the app's own page. That is
// as far as such a program could already reach (it can read ~/.six-degrees,
// the old Chrome profile included, and call the app's local server), and it
// never reaches another computer. SIX_DEGREES_PANEL=0 turns it all off.
// SECURITY.md says the same.

let panel = null;          // the panel's WebContentsView: one for the app's whole run
let panelSession = null;   // its session (LINKEDIN_PANEL_PARTITION)
let panelEnvVars = {};     // what the server is told about it (lib.mjs panelEnv)
let panelVisible = false;  // asked for by the page
let panelTop = null;       // where the page says it starts, in its CSS pixels
let panelInsets = { bottom: 0 };  // what the page keeps clear under it, likewise
let panelMode = null;      // 'profile' (a profile link), 'section' (the LinkedIn tab) or 'scan' (anything else that showed it), while shown
let panelSection = null;   // in 'section' mode: the section its button opened (lib.mjs LINKEDIN_SECTIONS)
const invitesSeen = new Set();   // the profiles whose "Invitation sent" was passed on, this run: once each
const mutualsSent = new Map();   // the profiles whose mutual line was sent, and the day: once a profile a day
// Over the panel: a still picture of it while the page has something open there.
const panelCover = createPanelCover({
  capture: async () => {
    const image = await panel.webContents.capturePage();
    return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`;
  },
  sendStill: (n, src) => { if (win && !win.isDestroyed()) win.webContents.send('linkedin-panel:still', { n, src }); },
  apply: () => { placePanel(); sendPanelState(); },
  shown: () => Boolean(panel && win && !win.isDestroyed() && panelVisible && panelTop !== null),
});

/** Chromium's debugging port on a port the system picks (0), before the app is ready. */
function openDebuggingPort() {
  // A file from the last run would name its old port.
  try { rmSync(path.join(USER_DATA, 'DevToolsActivePort'), { force: true }); } catch { /* read below */ }
  // 127.0.0.1 is where Electron listens anyway; said here so it never isn't.
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', '0');
}

async function createPanel() {
  try {
    panelSession = session.fromPartition(LINKEDIN_PANEL_PARTITION);
    lockDown(panelSession);
    // Plain Chrome's user agent, derived from the real one (see "agent" above), before any page loads.
    panelSession.setUserAgent(chromeUserAgent(panelSession.getUserAgent(), { appNames: [app.getName(), 'Sixgree'] }));
    panel = new WebContentsView({
      webPreferences: {
        partition: LINKEDIN_PANEL_PARTITION,
        contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
        // Out of sight, its page still draws and runs its timers, as the
        // scanner's hidden Chrome did with Playwright's flags.
        backgroundThrottling: false,
      },
    });
    panel.setBackgroundColor('#0a0a1a');
    const contents = panel.webContents;
    for (const name of ['did-navigate', 'did-navigate-in-page']) contents.on(name, sendPanelState);
    // "Invitation sent" on a profile a link opened: the watcher in each page, and its line.
    contents.on('dom-ready', () => watchInvites(contents));
    contents.on('console-message', (event) => { inviteSent(event?.message); mutualsSeen(event?.message); });
    // Cmd+[ and Cmd+] while LinkedIn has the keyboard.
    contents.on('before-input-event', (event, input) => { if (historyShortcut(input)) event.preventDefault(); });
    await contents.loadURL('about:blank');
    // Shown for its first frame (dark on the dark starting page), then hidden.
    // A page that was never shown has no size at all, nothing is ever in its
    // viewport, and the scanner could click nothing on it; once shown, it
    // keeps its size and keeps drawing while hidden, minimised or with the
    // window closed (checked 2026-10-15).
    attachPanel();
    panel.setVisible(true);
    await Promise.race([
      contents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    placePanel();
    // For the scanner only: with just the LinkedIn browser plugin, there is no port to name.
    if (SCANNER_HERE) {
      const [targetId, port] = await Promise.all([targetIdOf(contents), waitForDevToolsPort()]);
      panelEnvVars = panelEnv({ port, targetId });
      if (!Object.keys(panelEnvVars).length) throw new Error(`no ${port ? 'target id' : 'debugging port'}`);
    }
  } catch (err) {
    // The scanner starts its own Chrome instead, as before the panel.
    console.error(`Sixgree's LinkedIn panel is off: ${err.message}`);
    if (panel) {
      try { win?.contentView.removeChildView(panel); } catch { /* not in it */ }
      try { panel.webContents.close(); } catch { /* gone */ }
    }
    panel = null;
    panelEnvVars = {};
  }
}

/** The panel page's DevTools target id: what the scanner looks for among the pages. */
async function targetIdOf(contents) {
  const dbg = contents.debugger;
  dbg.attach('1.3');
  try {
    return (await dbg.sendCommand('Target.getTargetInfo'))?.targetInfo?.targetId ?? null;
  } finally {
    dbg.detach();
  }
}

/** The port Chromium chose, once it has written it down (a few milliseconds after start). */
async function waitForDevToolsPort(timeoutMs = 5000) {
  const file = path.join(USER_DATA, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const port = devToolsPort(readFileSync(file, 'utf8'));
      if (port) return port;
    } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Into the window, on top of the app's page, wherever the page last said. */
function attachPanel() {
  if (!panel || !win) return;
  win.contentView.addChildView(panel);
  placePanel();
}

function placePanel() {
  if (!panel || !win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  // Sized even while hidden, for when it next shows (a hidden page keeps the
  // size it last had in sight: createPanel).
  const bounds = panelBounds({ width, height }, panelTop ?? 0, win.webContents.getZoomFactor(), panelInsets);
  if (bounds) panel.setBounds(bounds);
  // In front only once the page has said where it starts, and not while
  // something the page opened is over it (its still picture is, instead).
  panel.setVisible(panelVisible && panelTop !== null && Boolean(bounds) && !panelCover.frozen);
}

function setPanelVisible(on, mode = 'scan') {
  if (!panel) return;
  if (on && (!panelMode || mode !== 'scan')) panelMode = mode;
  if (on && panelMode !== 'section') panelSection = null;
  if (!on) { panelMode = null; panelSection = null; }
  if (panelVisible === Boolean(on)) {
    sendPanelState();
    return;
  }
  panelVisible = Boolean(on);
  placePanel();
  // Something already open over it: the still picture, at once.
  panelCover.refresh();
  // The keyboard goes with what's in front.
  if (win && !win.isDestroyed()) (panelVisible && !panelCover.frozen ? panel.webContents : win.webContents).focus();
  sendPanelState();
}

/**
 * A profile link pressed in the app: the panel straight on that profile and
 * in front, at once (lib.mjs profileAddress builds the address from the slug
 * alone). True when it went; false for a link that isn't a LinkedIn profile.
 */
function showProfile(url) {
  const address = panel ? profileAddress(url, { testOrigin: PANEL_TEST_ORIGIN }) : null;
  if (!address) return false;
  panel.webContents.loadURL(address).catch(() => {});
  setPanelVisible(true, 'profile');
  return true;
}

/** Where the panel can go in its own history: { back, forward } (lib.mjs historyMoves). */
function panelHistory() {
  if (!panel) return { back: false, forward: false };
  const h = panel.webContents.navigationHistory;
  const urls = [];
  for (let i = 0; i < h.length(); i++) urls.push(h.getEntryAtIndex(i)?.url ?? '');
  return historyMoves({ urls, index: h.getActiveIndex() });
}

/** Back or Forward in the panel's history, where it can go. */
function goPanel(way) {
  if (!panel || !panelVisible) return;
  const can = panelHistory();
  const h = panel.webContents.navigationHistory;
  if (way === 'back' && can.back) h.goBack();
  else if (way === 'forward' && can.forward) h.goForward();
}

/** Cmd+[ / Cmd+] (Ctrl elsewhere) while the panel shows: true when it was one. */
function historyShortcut(input) {
  const way = historyKey(input);
  if (!way || !panelVisible) return false;
  goPanel(way);
  return true;
}

/** The LinkedIn tab's notch buttons: the panel straight on one section (lib.mjs sectionUrl). */
function showSection(key) {
  const url = panel ? sectionUrl(key, { testOrigin: PANEL_TEST_ORIGIN }) : null;
  if (!url) return;
  panelSection = key;
  // Already there (a page under it, say), it stays; anywhere else, to the section.
  if (sectionOf(panel.webContents.getURL(), { testOrigin: PANEL_TEST_ORIGIN }) !== key) panel.webContents.loadURL(url).catch(() => {});
  setPanelVisible(true, 'section');
}

function panelState() {
  const url = panel ? panel.webContents.getURL() : '';
  return {
    available: Boolean(panel),
    visible: Boolean(panel) && panelVisible,
    // Is a LinkedIn page open in it (so there is something to show)?
    linkedin: Boolean(panel) && (isLinkedInUrl(url) || Boolean(panelProfileSlug(url, { testOrigin: PANEL_TEST_ORIGIN }))),
    // Who opened it: 'profile' (a profile link), 'section' (the LinkedIn tab) or 'scan' (a scan, Show LinkedIn).
    mode: Boolean(panel) && panelVisible ? panelMode || 'scan' : null,
    // Back and Forward: where its own history can go (the bar's buttons, Cmd+[ / Cmd+]).
    ...(() => { const can = panelHistory(); return { canGoBack: can.back, canGoForward: can.forward }; })(),
    // In 'section' mode: the section its button opened, and the one its page is in now
    // (another, or null, once the user has gone elsewhere: the page offers the way back).
    section: Boolean(panel) && panelVisible && panelMode === 'section' ? panelSection : null,
    at: panel ? sectionOf(url, { testOrigin: PANEL_TEST_ORIGIN }) : null,
    // Swapped for its still picture while something is open over it.
    frozen: Boolean(panel) && panelCover.frozen,
    // Whether a scanner can drive it (then a running scan has it, and profile links go to your browser meanwhile).
    scanner: Boolean(panel) && Object.keys(panelEnvVars).length > 0,
  };
}

function sendPanelState() {
  if (win && !win.isDestroyed()) win.webContents.send('linkedin-panel:state', panelState());
}

/** Only the app's own page, in the main window, may move the panel. */
function fromApp(event) {
  return Boolean(win) && event.sender === win.webContents && isAppUrl(event.senderFrame?.url ?? '', origin);
}

function setUpPanelMessages() {
  ipcMain.handle('linkedin-panel:state', (event) => (fromApp(event) ? panelState() : { available: false, visible: false, linkedin: false }));
  ipcMain.on('linkedin-panel:show', (event) => { if (fromApp(event)) setPanelVisible(true); });
  // A profile link: answered, so the page knows it went (else it opens in your browser).
  ipcMain.handle('linkedin-panel:profile', (event, url) => (fromApp(event) && typeof url === 'string' ? showProfile(url) : false));
  ipcMain.on('linkedin-panel:back', (event) => { if (fromApp(event)) goPanel('back'); });
  ipcMain.on('linkedin-panel:forward', (event) => { if (fromApp(event)) goPanel('forward'); });
  ipcMain.on('linkedin-panel:section', (event, key) => { if (fromApp(event) && typeof key === 'string') showSection(key); });
  ipcMain.on('linkedin-panel:hide', (event) => { if (fromApp(event)) setPanelVisible(false); });
  ipcMain.on('linkedin-panel:top', (event, px) => {
    if (!fromApp(event)) return;
    panelTop = Number.isFinite(px) ? px : null;
    placePanel();
    panelCover.refresh();
  });
  // Where it starts, and what the page keeps clear under it, in one message.
  ipcMain.on('linkedin-panel:place', (event, place) => {
    if (!fromApp(event)) return;
    const px = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
    panelTop = Number.isFinite(place?.top) && place.top >= 0 ? place.top : null;
    panelInsets = { bottom: px(place?.bottom) };
    placePanel();
    panelCover.refresh();
  });
  // Something the page opened is over the panel (true), or nothing is (false).
  ipcMain.on('linkedin-panel:cover', (event, on) => { if (fromApp(event)) panelCover.set(on === true); });
  ipcMain.on('linkedin-panel:still-drawn', (event, n) => { if (fromApp(event) && Number.isInteger(n)) panelCover.drawn(n); });
}

/** LinkedIn's pages stay in the panel; any other link goes to the user's browser (lib.mjs panelRoute). */
function panelRules(contents) {
  const route = (url) => panelRoute(url, { testOrigin: PANEL_TEST_ORIGIN });
  contents.setWindowOpenHandler(({ url }) => {
    // A LinkedIn link that would open a new window opens in the panel itself:
    // it has no windows of its own.
    if (route(url) === 'panel') contents.loadURL(url).catch(() => {});
    else if (route(url) === 'browser') shell.openExternal(url);
    return { action: 'deny' };
  });
  // The page's own navigations and the redirects of any: the top page only.
  // LinkedIn's frames (its security check among them) load from other hosts.
  const guard = (event) => {
    if (event.isMainFrame === false || route(event.url) === 'panel') return;
    event.preventDefault();
    if (route(event.url) === 'browser') shell.openExternal(event.url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * The "Invitation sent" watcher (lib.mjs INVITE_WATCH_JS) in the page the panel has just
 * loaded, in a world of its own: LinkedIn's page never sees it. Only on the pages the
 * panel shows (LinkedIn's, or the local check's); about:blank has nothing to watch.
 */
function watchInvites(contents) {
  const url = contents.getURL();
  if (url === 'about:blank' || panelRoute(url, { testOrigin: PANEL_TEST_ORIGIN }) !== 'panel') return;
  contents.executeJavaScriptInIsolatedWorld(INVITE_WATCH_WORLD, [{ code: INVITE_WATCH_JS }]).catch(() => {});
  contents.executeJavaScriptInIsolatedWorld(INVITE_WATCH_WORLD, [{ code: MUTUAL_WATCH_JS }]).catch(() => {});
}

/**
 * A console line from the panel's page: when it is the mutual watcher's, on the profile
 * still showing (lib.mjs mutualsSeenFor), the line goes to the app's own server as ties
 * (POST /api/ties, source 'profile'), once a profile a day. Quietly: the web is extra,
 * and a server not up yet just misses one.
 */
function mutualsSeen(message) {
  if (!panel || !ready || !origin) return;
  const seen = mutualsSeenFor(message, { url: panel.webContents.getURL(), seen: mutualsSent, testOrigin: PANEL_TEST_ORIGIN });
  if (!seen) return;
  mutualsSent.set(seen.slug, new Date().toISOString().slice(0, 10));
  fetch(`${origin}/api/ties`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(seen.body),
  }).catch(() => {});
}

/**
 * A console line from the panel's page: when it is the watcher's, on the profile a link
 * opened and still showing (lib.mjs inviteSentFor), the app's page is told, once a
 * profile, and does the rest: marks the request sent, puts the panel away, says so.
 */
function inviteSent(message) {
  if (!panel || !win || win.isDestroyed()) return;
  const sent = inviteSentFor(message, {
    url: panel.webContents.getURL(), mode: panelMode, visible: panelVisible, seen: invitesSeen, testOrigin: PANEL_TEST_ORIGIN,
  });
  if (!sent) return;
  invitesSeen.add(sent.slug);
  win.webContents.send('linkedin-panel:invite-sent', sent);
}

function openInApp(pathname) {
  showWindow();
  if (ready) win.loadURL(origin + pathname);
  else pendingPath = pathname; // opened once the server answers, instead of the map
}

function buildMenu() {
  return Menu.buildFromTemplate(process.platform === 'darwin' ? macMenu() : otherMenu());
}

// Windows and Linux: the menu bar inside the window, with the usual File menu
// and no Mac-only roles (Services, Hide). About lives under Help there.
function otherMenu() {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'Check for Updates…', click: () => openInApp('/settings?check=updates') },
        { label: 'Settings…', accelerator: 'Ctrl+,', click: () => openInApp('/settings') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
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
    {
      label: 'Help',
      submenu: [
        { label: 'Sixgree on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'What Changed', click: () => shell.openExternal(`${REPO_URL}/releases`) },
        { type: 'separator' },
        { label: 'Show the Data Folder', click: () => shell.openPath(DATA_DIR) },
        { label: 'Show the Log', click: () => shell.showItemInFolder(LOG) },
        { type: 'separator' },
        { role: 'about', label: 'About Sixgree' },
      ],
    },
  ];
}

function macMenu() {
  return [
    {
      label: 'Sixgree',
      submenu: [
        { role: 'about', label: 'About Sixgree' },
        { label: 'Check for Updates…', click: () => openInApp('/settings?check=updates') },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openInApp('/settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Sixgree' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Sixgree' },
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
        { label: 'Sixgree on GitHub', click: () => shell.openExternal(REPO_URL) },
        { label: 'What Changed', click: () => shell.openExternal(`${REPO_URL}/releases`) },
        { type: 'separator' },
        { label: 'Show the Data Folder', click: () => shell.openPath(DATA_DIR) },
        { label: 'Show the Log', click: () => shell.showItemInFolder(LOG) },
      ],
    },
  ];
}

// ── quitting ─────────────────────────────────────────────────────────────────
// Like any Mac app, closing the window leaves Sixgree running (a long scan
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
  // A scan, or Install, Set up the scanner or the sign-in window: the question
  // names what runs (lib.mjs quitQuestion).
  const job = ask && origin ? await runningJob(origin) : null;
  if (job) {
    asking = true;
    const question = quitQuestion(job);
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      buttons: question.buttons,
      defaultId: 1,
      cancelId: 1,
      message: question.message,
      detail: question.detail,
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
      // Also to a file: Electron's stdout is hard to catch on Windows (scripts/smoke-desktop.mjs).
      if (process.env.SIX_DEGREES_SMOKE_READY) {
        try { writeFileSync(process.env.SIX_DEGREES_SMOKE_READY, `${origin}\n`); } catch { /* the stdout line still says it */ }
      }
    }
  }, 4000);
}
