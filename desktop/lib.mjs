// The desktop app's decisions that don't need Electron, kept here so the tests
// can run them directly (tests/desktop.test.mjs). main.mjs wires them up.

import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The folder Electron keeps the shell's own state in (the single-instance lock,
 * the session's storage). Electron names it after the app, so renaming Six
 * Degrees to Sixgree would have moved it to a new, empty folder and reset it.
 * main.mjs pins it to the old name, under app.getPath('appData') (~/Library/
 * Application Support on a Mac, %APPDATA% on Windows, ~/.config on Linux),
 * before anything reads it. The network itself is in ~/.six-degrees, not here.
 */
export const USER_DATA_FOLDER = 'Six Degrees';

export function userDataPath(appData) {
  return path.join(appData, USER_DATA_FOLDER);
}

/** Is this URL one of the app's own pages (same scheme, host and port as its server)? */
export function isAppUrl(url, origin) {
  if (!origin) return false;
  try {
    // A blob: URL made by the app's own page reports that page's origin.
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** May this URL go to the user's own browser? Ordinary web links only. */
export function isExternalWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The System Settings panes the app may open, exactly as the Scan page links
 * them (lib/scanner-setup.js APP_MANAGEMENT_URLS; tests/desktop.test.mjs checks
 * the two lists agree). Privacy & Security → App Management: macOS asks there
 * whether Sixgree may manage apps when Chrome, started by the scanner,
 * updates itself. "shouldnt we have in the onboarding for scan … a button where
 * the user is basically brought to the app management and enables it like Flow
 * does" (Blake, 2026-10-04). The first is macOS 15 and later's address (checked
 * on 26.5.1), the second macOS 13 and 14's.
 *
 * Whole strings only: no prefix, no other pane, no other query. A page that
 * could send any x-apple.systempreferences: address could open any pane, and
 * a custom scheme can start any app that claims it, so nothing else of the
 * kind gets out.
 */
export const SETTINGS_URLS = Object.freeze([
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AppBundles',
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles',
]);

/**
 * What to do with a link the page opens or follows:
 *   'app'       one of the app's own pages: stays in the app
 *   'browser'   a web link (LinkedIn above all): the user's own browser. LinkedIn
 *               opens inside Sixgree only in its own panel (panelRoute, below;
 *               DESKTOP.md rule 7), never in the app's page
 *   'settings'  one of SETTINGS_URLS: System Settings opens on that pane
 *   'block'     anything else (file:, javascript:, custom schemes)
 */
export function routeFor(url, origin) {
  if (isAppUrl(url, origin)) return 'app';
  if (SETTINGS_URLS.includes(url)) return 'settings';
  if (isExternalWebUrl(url)) return 'browser';
  return 'block';
}

function portIsFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** The first port from `from` to `to` that nothing is using, like the old launcher's walk. */
export async function findFreePort(from = 6363, to = 6399, host = '127.0.0.1') {
  for (let port = from; port <= to; port++) {
    if (await portIsFree(port, host)) return port;
  }
  throw new Error(`No free port between ${from} and ${to}.`);
}

/** Wait until the server answers; give up early if its process has died. */
export async function waitForServer(origin, { timeoutMs = 60000, isAlive = () => true, fetchImpl = fetch, sleep = sleepFor } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('The app\'s server stopped while it was starting.');
    try {
      const res = await fetchImpl(`${origin}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await sleep(300);
  }
  throw new Error(`The app's server did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
}

/** Is a scan (or the scanner's setup) running? null when the server can't be asked. */
export async function scanRunning(origin, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${origin}/api/scraper`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return Boolean((await res.json()).running);
  } catch {
    return null;
  }
}

/**
 * What the Scan page is running: its action ('full', 'install', 'setup',
 * 'login', …), or null when nothing runs or the server can't be asked.
 */
export async function runningJob(origin, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${origin}/api/scraper`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const status = await res.json();
    if (!status.running) return null;
    return typeof status.action === 'string' && status.action ? status.action : 'scan';
  } catch {
    return null;
  }
}

/**
 * The question Quit asks while the Scan page runs something, in the words of
 * what runs: Install and Set up the scanner aren't scans, and saying "A scan is
 * running" over them sent people looking for one (the server's refusals say
 * the same, lib/scan-state.js). { message, detail, buttons }: the first button
 * quits, the second keeps it going.
 */
export function quitQuestion(job) {
  if (job === 'install' || job === 'setup') {
    return {
      message: job === 'setup' ? 'The scanner is being set up.' : 'The scanner\'s packages are being installed.',
      detail: 'Quitting stops it the way the Stop button does. Press the same button on the Scan page next time to finish it.',
      buttons: ['Stop It and Quit', 'Keep Going'],
    };
  }
  if (job === 'login') {
    return {
      message: 'The LinkedIn sign-in window is open.',
      detail: 'Quitting closes it the way the Stop button does. If you hadn\'t finished signing in, open LinkedIn from the Scan page again next time.',
      buttons: ['Close It and Quit', 'Keep It Open'],
    };
  }
  return {
    message: 'A scan is running.',
    detail: 'Quitting stops it the way the Stop button does, and it closes its Chrome window. A list that was stopped part-way carries on from where it got to next time.',
    buttons: ['Stop the Scan and Quit', 'Keep Scanning'],
  };
}

/**
 * Stop a running scan the way the Stop button does, then wait until it has
 * stopped: the scanner closes its own Chrome window when it is asked to stop.
 * Resolves 'none' (nothing was running), 'stopped', or 'timeout'.
 */
export async function stopScan(origin, { timeoutMs = 25000, fetchImpl = fetch, sleep = sleepFor } = {}) {
  if ((await scanRunning(origin, { fetchImpl })) !== true) return 'none';
  try {
    await fetchImpl(`${origin}/api/scraper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* the check below decides */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await scanRunning(origin, { fetchImpl })) !== true) return 'stopped';
    await sleep(500);
  }
  return 'timeout';
}

/** Stop a child process: SIGTERM, then SIGKILL after `graceMs`. Resolves once it has exited. */
export function stopProcess(child, { graceMs = 5000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', done);
    // Windows has no SIGTERM: kill() there ends node.exe alone, and anything it
    // started would outlive it. taskkill /T ends the whole tree (the scan was
    // already asked to stop cleanly before this, stopScan in main.mjs).
    if (process.platform === 'win32') {
      try {
        spawnTree('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch { try { child.kill(); } catch { done(); } }
      timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, graceMs);
      return;
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, graceMs);
    try { child.kill('SIGTERM'); } catch { done(); }
  });
}

// Started and left: its exit doesn't matter, only that it never shows a window.
function spawnTree(cmd, args) {
  spawn(cmd, args, { stdio: 'ignore', windowsHide: true }).on('error', () => {});
}

/**
 * The app bundle, from the path of its own executable (process.execPath in
 * Electron's main process):
 * "/Applications/Six Degrees.app/Contents/MacOS/Six Degrees" → "/Applications/Six Degrees.app".
 * null when it isn't running from a bundle (npm run desktop, from a checkout).
 */
export function bundlePathFromExe(exe) {
  const m = String(exe || '').match(/^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : null;
}

/**
 * The page to open first. After an update the new version (or the old one,
 * put back) is opened with --after-update, and opens Settings, where the
 * outcome is shown, rather than the map.
 */
export function startPathArg(argv = []) {
  return argv.includes('--after-update') ? '/settings#updates' : null;
}

/**
 * A data folder asked for on the command line: `--data-dir PATH` or
 * `--data-dir=PATH`. It lets a beta run against a copy of the data:
 *   open "Six Degrees.app" --args --data-dir ~/six-degrees-copy
 *
 * Made absolute here. The server runs in its own folder inside the app, so a
 * relative path handed to it as it is would name a different folder, and a
 * new, empty network. A relative path is taken from the folder the app was
 * started in, except /: `open` and the Finder start every app in /, which
 * can't hold a folder, so there it is taken from the home folder. A leading ~
 * is the home folder, as the shell would have made it (it doesn't after =).
 */
export function dataDirArg(argv = [], { cwd = process.cwd(), home = os.homedir() } = {}) {
  let value = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg.startsWith('--data-dir=')) {
      value = arg.slice('--data-dir='.length);
      break;
    }
    if (arg === '--data-dir' && argv[i + 1]) {
      value = String(argv[i + 1]);
      break;
    }
  }
  if (!value) return null;
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  return path.resolve(cwd === '/' ? home : cwd, expanded);
}

/**
 * The exit code with which the server asks to be started again, to finish an
 * import (Settings → Your data). main.mjs hands it to the server as
 * SIX_DEGREES_RESTART_CODE, so only a shell that knows it offers the button.
 * 75 is EX_TEMPFAIL: "try again". Next ends with 143 on SIGTERM, so a signal
 * can never be mistaken for it.
 */
export const RESTART_EXIT_CODE = 75;

/**
 * The exit code with which the server hands over to the in-app updater
 * (Settings → Updates → Install and restart): its helper takes it from there,
 * and the app quits quietly. Reserved here with the updater's own number, so
 * the shell reads every code the same way whichever feature is in.
 */
export const UPDATE_HANDOFF_EXIT_CODE = 76;

/**
 * Next's server catches SIGTERM and SIGINT and ends with 143 or 130
 * (next/dist/server/lib/start-server.js). So a server stopped from outside
 * (the installer replacing this copy, logging out) arrives as one of these
 * codes, not as a signal; only a signal Next doesn't catch (SIGKILL) arrives
 * as one.
 */
const STOPPED_FROM_OUTSIDE = [143, 130];

/**
 * What the shell does when its server ends:
 *   'ignore'   the app is quitting anyway
 *   'quit'     stopped from outside (a signal, or Next's 143 or 130), or handed
 *              over to the updater (76): the whole app is going, so go quietly
 *   'restart'  it asked to be started again (75), to finish an import
 *   'report'   any other exit: a crash, said out loud
 *
 * `answered` says whether that server ever answered the shell. Restart now is
 * a click on a page the server served, so a server that asks to be restarted
 * before it has answered once can't be doing it for a person: it can't stay
 * up, and is reported rather than started forever. One that answered is
 * restarted however soon after the last restart, so trying again after an
 * import that stopped (the page says why) is never a crash.
 */
export function serverExitAction({ code, signal, quitting = false, answered = true }) {
  if (quitting) return 'ignore';
  if (signal) return 'quit';
  if (code === UPDATE_HANDOFF_EXIT_CODE || STOPPED_FROM_OUTSIDE.includes(code)) return 'quit';
  if (code === RESTART_EXIT_CODE) return answered ? 'restart' : 'report';
  return 'report';
}

// ── Sixgree's own browser: LinkedIn in a panel inside the window ─────────────
// Blake, 2026-10-15: "why not have the actual chrome playwright instead of open
// up a new window, basically somehow takes over the screen of sixgree so it's
// all in house and doesn't make the user click away", then, of three ways to do
// it, "Sixgree's own browser": LinkedIn shows in a panel under the app's top bar
// (main.mjs), on Electron's own Chromium, and the scanner drives that panel
// instead of starting Chrome (scripts/scrape.py attach_panel). Only in the
// desktop app; npm and a plain browser keep the scanner's own Chrome.

/**
 * The panel's own storage: its cookies (the LinkedIn sign-in) are kept apart
 * from the app's, and from one start to the next. Never the app's default
 * session, which serves the app's own pages.
 */
export const LINKEDIN_PANEL_PARTITION = 'persist:linkedin';

/** Is this an https page on linkedin.com itself (www., the sign-in and security-check pages included)? */
export function isLinkedInUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'linkedin.com' || host.endsWith('.linkedin.com'));
  } catch {
    return false;
  }
}

/**
 * What to do with a page the panel is asked to open, by a link or a redirect:
 *   'panel'    a LinkedIn page, or about:blank (the empty panel): opens there
 *   'browser'  any other web page (a link on someone's profile to their own
 *              site, LinkedIn's lnkd.in short links): the user's own browser
 *   'block'    anything else (file:, javascript:, custom schemes)
 * `testOrigin` lets one more origin into the panel, for the local check of a
 * checkout (main.mjs passes it only when the app isn't packaged, and only from
 * SIX_DEGREES_PANEL_TEST_ORIGIN): never in a download.
 */
export function panelRoute(url, { testOrigin = null } = {}) {
  if (url === 'about:blank') return 'panel';
  if (isLinkedInUrl(url)) return 'panel';
  if (testOrigin) {
    try {
      if (new URL(url).origin === testOrigin) return 'panel';
    } catch { /* not a URL: below */ }
  }
  return isExternalWebUrl(url) ? 'browser' : 'block';
}

/**
 * Where the panel goes in the window: from `top` down to the bottom, the whole
 * width. `top` is where the page says the panel starts (the bottom of its top
 * bar, so the tabs and the notch stay in sight), in the page's own CSS pixels;
 * the window counts in its own points, which differ by the page's zoom (View →
 * Zoom In). So top × zoom, rounded up, so the bar's last line is never covered.
 * null when `top` isn't a number of pixels the page could mean, or the window
 * has no room under it. `bottom` is kept clear, in CSS pixels.
 */
export function panelBounds({ width, height }, top, zoom = 1, { bottom = 0 } = {}) {
  const t = typeof top === 'number' ? top : NaN;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  if (!Number.isFinite(t) || t < 0 || !(width > 0) || !(height > 0)) return null;
  const y = Math.ceil(t * z);
  // What the page keeps under it (a banner along the bottom), in its CSS
  // pixels too: rounded up, so the panel never covers its first line.
  const inset = (v) => (Number.isFinite(v) && v > 0 ? Math.ceil(v * z) : 0);
  const w = Math.floor(width);
  const h = Math.floor(height) - y - inset(bottom);
  if (y >= height || w <= 0 || h <= 0) return null;
  return { x: 0, y, width: w, height: h };
}

/**
 * Is there a scanner that could use the panel? Then, and only then, the app
 * turns on Chromium's debugging port, which the scanner attaches through
 * (main.mjs). An installed scanner plugin is a folder <data>/plugins/<id>/
 * with scanner/scrape.py in it (lib/plugins.js SCANNER_FOLDER); a checkout
 * (`npm run desktop`, not packaged) has the built-in one in scripts/. Read
 * once, at start: a plugin installed later counts from the next start.
 */
export function scannerInstalled({ dataDir, repo = null, packaged = true, exists, list }) {
  if (!packaged && repo && exists(path.join(repo, 'scripts', 'scrape.py'))) return true;
  let ids = [];
  try {
    ids = list(path.join(dataDir, 'plugins'));
  } catch {
    return false;
  }
  return ids.some((id) => !id.startsWith('.') && exists(path.join(dataDir, 'plugins', id, 'scanner', 'scrape.py')));
}

/**
 * The port in Chromium's DevToolsActivePort file (its first line), which it
 * writes into the app's own folder once it listens. The app asks for port 0,
 * so the system picks a free one. null until there is one.
 */
export function devToolsPort(text) {
  const port = Number(String(text ?? '').split('\n')[0].trim());
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * What the app's server, and through it every scanner it starts, is told about
 * the panel (scripts/scrape.py panel_settings; lib/linkedin-panel.js):
 *   SIX_DEGREES_PANEL_CDP     http://127.0.0.1:<port>, the debugging port
 *   SIX_DEGREES_PANEL_TARGET  the panel page's DevTools target id, so the
 *                             scanner takes that page and never the app's own
 * Nothing at all unless both are sound.
 */
export function panelEnv({ port, targetId } = {}) {
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return {};
  if (typeof targetId !== 'string' || !/^[0-9A-Fa-f]{16,64}$/.test(targetId)) return {};
  return { SIX_DEGREES_PANEL_CDP: `http://127.0.0.1:${port}`, SIX_DEGREES_PANEL_TARGET: targetId };
}

// ── The panel as plain Chrome (Blake, 2026-10-15) ────────────────────────────

/**
 * The panel's user agent: Electron's own for this app, with the app's token
 * (Sixgree/x) and Electron's (Electron/x) taken out, so it reads as the
 * Chrome it is built on. Derived from the real one at each start, so the
 * Chrome version is always the one actually running. Only the panel's session
 * (LINKEDIN_PANEL_PARTITION) gets it; the app's own pages keep the default.
 * Nothing else is changed: no client hints, no navigator.webdriver, no
 * fingerprint. `appNames` are the app tokens to take out (main.mjs passes
 * app.getName()). A string with no Chrome token left is given back as it came.
 */
export function chromeUserAgent(ua, { appNames = ['Sixgree'] } = {}) {
  const raw = String(ua ?? '');
  const names = [...new Set(appNames.map((n) => String(n ?? '').replace(/\s+/g, '')).filter(Boolean)), 'Electron'];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = new RegExp(`(^|\\s)(?:${names.map(esc).join('|')})\\/\\S+`, 'g');
  const out = raw.replace(tokens, '$1').replace(/\s{2,}/g, ' ').trim();
  return /\bChrome\/\d/.test(out) ? out : raw;
}

// ── The LinkedIn browser plugin (Blake, 2026-10-15) ──────────────────────────
// It brings the LinkedIn tab (Feed, Messaging, Notifications, Jobs). The
// header's LinkedIn button and its people list were taken out in favour of the
// tab and Back and Forward on the panel's bar (Blake, 2026-10-15: "I want to
// remove the LinkedIn button at the top right and don't like the side panel
// idea"). The page decides whether the plugin is installed and on
// (lib/plugins-view.js appFeatures); the shell only needs to know whether to
// have a panel at all.

/** The feature plugin's id (lib/plugins-shipped.js). */
export const LINKEDIN_BROWSER_PLUGIN = 'linkedin-browser';

/**
 * Is the LinkedIn browser plugin installed (its folder with its manifest)?
 * Then the panel is made even without a scanner, for browsing only: the
 * debugging port still opens only with a scanner (scannerInstalled). Whether
 * the plugin is sound and switched on is the server's to say, and the tab
 * shows only then. Read once, at start, like scannerInstalled.
 */
export function browserPluginInstalled({ dataDir, exists }) {
  try {
    return exists(path.join(dataDir, 'plugins', LINKEDIN_BROWSER_PLUGIN, 'manifest.json'));
  } catch {
    return false;
  }
}

/**
 * The profile the panel is on: the <slug> of a linkedin.com/in/<slug> page
 * (any page under it, like /in/<slug>/details/experience/), decoded and in
 * lower case, or null on any other page. The local check's origin counts as
 * LinkedIn when it is named. profileAddress reads a profile link with it.
 */
export function panelProfileSlug(url, { testOrigin = null } = {}) {
  if (panelRoute(url, { testOrigin }) !== 'panel' || url === 'about:blank') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const m = u.pathname.match(/^\/in\/([^/]+)/i);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* kept as it is */ }
  slug = slug.trim().toLowerCase();
  return slug && slug.length <= 200 ? slug : null;
}

/**
 * The address the panel opens for one person's profile link (every profile
 * link in the app, Connect and View profile alike: app/components/OpenProfile.js):
 * https://www.linkedin.com/in/<slug>/, built from the slug alone so nothing
 * else of the link reaches the panel; in a checkout with the local check's
 * page named, that page's /in/<slug>/ instead. A link with no scheme
 * (linkedin.com/in/...) is read as https. null for anything that isn't a
 * LinkedIn profile link.
 */
export function profileAddress(url, { testOrigin = null } = {}) {
  const raw = String(url ?? '').trim();
  if (!raw || raw.length > 2000) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const slug = panelProfileSlug(withScheme, { testOrigin });
  if (!slug) return null;
  return `${testOrigin || 'https://www.linkedin.com'}/in/${encodeURIComponent(slug)}/`;
}

// ── Back and Forward (Blake, 2026-10-15: "there's no way to go back and
// forwards in the UI for LinkedIn") ──────────────────────────────────────────

/**
 * Where the panel can go in its own history: { back, forward }. `urls` are its
 * entries, oldest first, and `index` the one showing. The empty page it was
 * made with (about:blank) is never somewhere to go back to.
 */
export function historyMoves({ urls = [], index = -1 } = {}) {
  const list = Array.isArray(urls) ? urls : [];
  const i = Number.isInteger(index) ? index : -1;
  if (i < 0 || i >= list.length) return { back: false, forward: false };
  const before = list[i - 1];
  return {
    back: i > 0 && typeof before === 'string' && before !== '' && before !== 'about:blank',
    forward: i < list.length - 1,
  };
}

/**
 * Cmd+[ and Cmd+] (Ctrl on Windows and Linux), as in a browser: 'back',
 * 'forward', or null. `input` is Electron's before-input-event's.
 */
export function historyKey(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.alt || input.shift) return null;
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  if (input.key === '[') return 'back';
  if (input.key === ']') return 'forward';
  return null;
}

// ── Nothing cut off while the panel shows ────────────────────────────────────
// The panel is a view of its own, drawn over the app's page, so anything the
// page opens over it (the bell's list, the scan light's briefing, the notch
// opened, a note under a header button) would be under it. While the page
// says something is open there, the panel is swapped for a still picture of
// itself, drawn by the page in the same place and under what's open; once
// nothing is, the panel comes back. (Blake, 2026-10-15: "I want the top tabs
// and the UI to not be cut off".)
//
// The order, so nothing flashes: the picture is taken with the panel still in
// front, the page draws it and says so (or ACK_MS passes), and only then does
// the panel go; coming back, the panel is put in front first and the page
// drops the picture after. Each picture has a number, so a late answer for an
// old one is ignored, and a cover lifted while a picture was being taken
// freezes nothing.

export const STILL_ACK_MS = 400;

/**
 * The swap, without Electron (tests/linkedin-panel.test.mjs drives it):
 *   capture()          → a picture of the panel now (main: capturePage, as a data URL)
 *   sendStill(n, src)  the page draws picture n where the panel is, or none (src null)
 *   apply()            the panel's visibility changed: main places it again (frozen hides it)
 *   shown()            is the panel in front, or about to be, as the page asked?
 * Returns { set(covered), drawn(n), refresh(), frozen }.
 */
export function createPanelCover({ capture, sendStill, apply, shown, ackMs = STILL_ACK_MS, wait = sleepFor }) {
  let wanted = false;
  let frozen = false;
  let seq = 0;
  let pictured = false;   // a picture was sent and not taken back yet
  const acks = new Map();

  async function freeze() {
    const n = ++seq;
    let src = null;
    try { src = await capture(); } catch { src = null; }
    if (n !== seq || !wanted || !shown()) return;
    if (src) {
      pictured = true;
      sendStill(n, src);
      await Promise.race([new Promise((resolve) => acks.set(n, resolve)), wait(ackMs)]);
      acks.delete(n);
      if (n !== seq || !wanted || !shown()) return;
    }
    // Without a picture the panel still goes: what's open matters more.
    frozen = true;
    apply();
  }

  function thaw() {
    seq++;
    const was = frozen;
    frozen = false;
    if (was) apply();
    if (pictured) {
      pictured = false;
      sendStill(seq, null);
    }
  }

  const api = {
    /** The page says something is (true) or nothing is (false) open over the panel. */
    set(covered) {
      const on = Boolean(covered);
      if (on === wanted) return;
      wanted = on;
      api.refresh();
    },
    /** The page has drawn picture n. */
    drawn(n) {
      acks.get(n)?.();
    },
    /** After the panel is shown or hidden: freeze it if something is open over it, else bring it back. */
    refresh() {
      if (wanted && shown()) {
        if (!frozen) freeze();
      } else {
        thaw();
      }
    },
    get frozen() { return frozen; },
  };
  return api;
}

// ── LinkedIn's sections, one at a time (Blake, 2026-10-15) ───────────────────
// "for the actual LinkedIn section tab we can have where the notch will have
// buttons for exact features like the feed and only the feed embedded into
// the panel, same for messaging … feed, notifications and jobs". The LinkedIn
// tab's notch buttons open the panel straight on one of these.

export const LINKEDIN_SECTIONS = Object.freeze({
  feed: '/feed/',
  messaging: '/messaging/',
  notifications: '/notifications/',
  jobs: '/jobs/',
});

/** The address of section `key` (LINKEDIN_SECTIONS), or the local check's stand-in for it; null for no such section. */
export function sectionUrl(key, { testOrigin = null } = {}) {
  if (!Object.hasOwn(LINKEDIN_SECTIONS, key)) return null;
  return `${testOrigin || 'https://www.linkedin.com'}${LINKEDIN_SECTIONS[key]}`;
}

/** Which section the panel's page is in (any page under its path), or null: another LinkedIn page, or not LinkedIn. */
export function sectionOf(url, { testOrigin = null } = {}) {
  if (panelRoute(url, { testOrigin }) !== 'panel' || url === 'about:blank') return null;
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return null; }
  const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return Object.keys(LINKEDIN_SECTIONS).find((k) => p.startsWith(LINKEDIN_SECTIONS[k])) || null;
}

// ── "Invitation sent": the panel goes back (Blake, 2026-10-16) ───────────────
// "when they click connect on the person we will detect in the bottom left corner where
// it says connection has been sent, to close out so they can continue in the Outlink or
// Separation or bridge." After you press Connect on a profile the app opened in the
// panel, LinkedIn says so in a small notice ("Invitation sent", "Invitation sent to X",
// "Your invitation to X was sent"). A watcher in the panel's page sees it (by its words,
// never a class name: TRAPS §5) and prints one console line; the shell reads that line
// (main.mjs inviteSent) and tells the app's page, which marks the request sent, puts the
// panel away and says so (app/components/LinkedInPanel.js).

/** The start of the watcher's console line: what it saw follows, as JSON. */
export const INVITE_SENT_MARK = '[sixgree:invite-sent]';

/**
 * The isolated world the watcher runs in (webContents.executeJavaScriptInIsolatedWorld):
 * it shares the page's document but none of its scripts, so LinkedIn's page never sees
 * it, its observer or its line. Not Electron's own (999) nor the page's (0).
 */
export const INVITE_WATCH_WORLD = 1916;

/** LinkedIn's words for an invitation that went, whole (anchored, so "withdraw invitation sent to X" is not one). */
const INVITE_SENT_WORDS = [
  /^invitation sent(?: to (.{1,120}?))?[.!]?$/i,
  /^your invitation to (.{1,120}?) (?:was|has been) sent[.!]?$/i,
];

/** Do these words say an invitation went? → { name } (null when they name nobody), or null. */
export function inviteSentText(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200) return null;
  for (const re of INVITE_SENT_WORDS) {
    const m = t.match(re);
    if (m) return { name: m[1] ? m[1].trim() : null };
  }
  return null;
}

/**
 * The watcher, run in the panel's page at each page load (main.mjs watchInvites): on a
 * profile (/in/<slug>), anything added to the page whose words are LinkedIn's for an
 * invitation that went (INVITE_SENT_WORDS, the same patterns as inviteSentText) is said
 * once a page, as INVITE_SENT_MARK and { text, href }. It reads words only, clicks and
 * changes nothing, and does nothing on any other page.
 */
export const INVITE_WATCH_JS = `(() => {
  if (window.__sixgreeInviteWatch) return;
  window.__sixgreeInviteWatch = true;
  const MARK = ${JSON.stringify(INVITE_SENT_MARK)};
  const WORDS = [${INVITE_SENT_WORDS.map(String).join(', ')}];
  const said = new Set();
  const says = (text) => {
    const t = String(text || '').replace(/\\s+/g, ' ').trim();
    return t && t.length <= 200 && WORDS.some((re) => re.test(t)) ? t : null;
  };
  // The notice's own words: the shortest that say it, so a Dismiss button beside them
  // ("Invitation sent to Ada Stone" + "Dismiss") is never read as part of a name.
  const look = (el) => {
    if (!el || el.nodeType !== 1 || !/invitation/i.test(el.textContent || '')) return;
    const at = location.pathname;
    if (said.has(at)) return;
    let best = null;
    for (const n of [el, ...el.querySelectorAll('*')].slice(0, 400)) {
      const t = says(n.textContent);
      if (t && (!best || t.length < best.length)) best = t;
    }
    if (!best) return;
    said.add(at);
    console.log(MARK + JSON.stringify({ text: best, href: location.href }));
  };
  new MutationObserver((records) => {
    if (!/^\\/in\\/[^/]+/.test(location.pathname)) return;
    for (const r of records) {
      if (r.type === 'characterData') look(r.target.parentElement);
      else for (const n of r.addedNodes) look(n.nodeType === 3 ? n.parentElement : n);
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
})();`;

/**
 * A console line from the panel's page, and where the panel is now: who LinkedIn says
 * the invitation went to, or null. Only the watcher's line (INVITE_SENT_MARK) whose words
 * say so (inviteSentText); only while the panel shows a profile a link in the app opened
 * (mode 'profile'), still on that profile, the notice seen on it; and once a profile
 * (`seen`, the slugs already acted on). → { slug, name } (name as the notice gives it, or null).
 */
export function inviteSentFor(message, { url = '', mode = null, visible = false, seen = new Set(), testOrigin = null } = {}) {
  const raw = String(message ?? '');
  if (!raw.startsWith(INVITE_SENT_MARK)) return null;
  let report = null;
  try { report = JSON.parse(raw.slice(INVITE_SENT_MARK.length)); } catch { return null; }
  const said = inviteSentText(report?.text);
  if (!said || !visible || mode !== 'profile') return null;
  const slug = panelProfileSlug(String(url ?? ''), { testOrigin });
  if (!slug || panelProfileSlug(String(report?.href ?? ''), { testOrigin }) !== slug) return null;
  if (seen.has(slug)) return null;
  return { slug, name: said.name };
}

// ── The mutual web: a profile's mutual line, read where it already is ───────
// Blake, 2026-10-16: "scanning always for mutuals no matter what ... whenever a new
// connection is showing with the mutuals listed, then it should be tracked to map a web
// of who knows who". A profile open in the panel (Outlink, Separation, Breach, the
// LinkedIn tab) shows its mutual line in its top card: "Maya Chen, Leo Park and 103
// other mutual connections". A watcher in the panel's page, in the same world of its own
// as the invitation watcher, reads it once a profile (by its words and the page's own
// tags, never a class name: TRAPS §5) and prints one console line; the shell passes it
// to the app (main.mjs mutualsSeen, POST /api/ties), which keeps a tie between the
// profile's person and each of your connections the line names (lib/ties.js). Nothing
// is opened, clicked or scrolled for it: only a page already showing is read.

/** The start of the mutual watcher's console line: what it read follows, as JSON. */
export const MUTUALS_MARK = '[sixgree:mutuals]';

/**
 * The watcher, run in the panel's page at each page load (main.mjs watchInvites): on a
 * profile itself (/in/<slug>/, not its details pages), once its top card (the section
 * holding the name, <h1>) shows a mutual line, says once a profile, as MUTUALS_MARK and
 * { href, name, degree, line, links }: the line's words, the profile links inside it
 * (most lines link none), and the degree the card shows ("2nd"). Reads words only.
 */
export const MUTUAL_WATCH_JS = `(() => {
  if (window.__sixgreeMutualWatch) return;
  window.__sixgreeMutualWatch = true;
  const MARK = ${JSON.stringify(MUTUALS_MARK)};
  const said = new Set();
  const words = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  const LINE = /\\bmutual connections?$/i;
  const DEGREE = /^(?:[\\u00b7\\u2022]\\s*)?(1st|2nd|3rd\\+?)(?:\\s+degree connection)?$/i;
  const read = () => {
    const at = location.pathname;
    if (!/^\\/in\\/[^/]+\\/?$/.test(at) || said.has(at)) return;
    const main = document.querySelector('main') || document.body;
    const h1 = main && main.querySelector('h1');
    if (!h1) return;
    const card = h1.closest('section') || main;
    let line = null;
    let degree = null;
    for (const n of Array.from(card.querySelectorAll('*')).slice(0, 3000)) {
      if (n.closest && n.closest('aside')) continue;
      const t = words(n.textContent);
      if (!t || t.length > 300) continue;
      if (!degree) { const d = t.match(DEGREE); if (d) degree = d[1]; }
      if (LINE.test(t) && (!line || t.length < line.t.length)) line = { n, t };
    }
    if (!line) return;
    said.add(at);
    const links = [];
    for (const a of Array.from(line.n.querySelectorAll('a'))) {
      const href = a.href || a.getAttribute('href') || '';
      const name = words(a.textContent);
      if (/\\/in\\/[^/?#]+/.test(href) && name && links.length < 3) links.push({ href, name });
    }
    console.log(MARK + JSON.stringify({ href: location.href, name: words(h1.textContent).slice(0, 120), degree, line: line.t, links }));
  };
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(read, 700); };
  new MutationObserver(later).observe(document, { childList: true, subtree: true, characterData: true });
  later();
})();`;

/**
 * A console line from the panel's page, and where the panel is now: what to send the app
 * (POST /api/ties), or null. Only the mutual watcher's line (MUTUALS_MARK), on the
 * profile still showing, with a mutual line; once a profile a day (`seen`: slug → the
 * day it was sent, kept by the shell), so a page looked at twice is one sighting.
 * → { slug, body: { source: 'profile', person: { profileUrl, name, degree }, line, mutuals } }.
 */
export function mutualsSeenFor(message, { url = '', seen = new Map(), today = new Date().toISOString().slice(0, 10), testOrigin = null } = {}) {
  const raw = String(message ?? '');
  if (!raw.startsWith(MUTUALS_MARK)) return null;
  let report = null;
  try { report = JSON.parse(raw.slice(MUTUALS_MARK.length)); } catch { return null; }
  const line = String(report?.line ?? '').replace(/\s+/g, ' ').trim();
  if (!line || line.length > 300 || !/\bmutual connections?$/i.test(line)) return null;
  const slug = panelProfileSlug(String(url ?? ''), { testOrigin });
  if (!slug || panelProfileSlug(String(report?.href ?? ''), { testOrigin }) !== slug) return null;
  if (seen.get(slug) === today) return null;
  const name = String(report?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const degree = /^(1st|2nd|3rd\+?)$/i.test(String(report?.degree ?? '')) ? String(report.degree) : null;
  const mutuals = (Array.isArray(report?.links) ? report.links : []).slice(0, 3).map((l) => {
    const s = panelProfileSlug(String(l?.href ?? ''), { testOrigin });
    return s ? { profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(s)}/`, name: String(l?.name ?? '').slice(0, 120) } : null;
  }).filter(Boolean);
  return {
    slug,
    body: {
      source: 'profile',
      person: { profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`, name, degree },
      line,
      mutuals,
    },
  };
}
