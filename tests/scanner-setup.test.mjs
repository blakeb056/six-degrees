// The Scan page's first step, in every state GET /api/scraper can report
// (lib/scanner-setup.js), Google Chrome as part of it, whether it asks for
// your field once your connections are in (askForField), whether you're
// signed in (signedInFrom), and what other pages say when the scanner isn't
// ready (lib/scraper-client.js notReadyMessage). DESKTOP.md D2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupStep, askForField, chromeInstalled, signedInFrom,
  CHROME_MISSING, CHROME_BUTTON, CHROME_REFUSAL, CHROME_DOWNLOAD, SIGNED_IN_FILE,
} from '../lib/scanner-setup.js';
import { notReadyMessage } from '../lib/scraper-client.js';

const MB = 1024 * 1024;
const status = (checks, extra = {}) => ({ checks: { scriptsFound: true, chrome: true, ...checks }, running: false, ...extra });
const DOWNLOAD = { version: '3.12.14', size: 34143739, from: 'github.com' };

test('the Mac app: ready, with nothing to install, because its Python comes with it', () => {
  const s = setupStep(status({ python: true, dependencies: true, pythonSource: 'bundled', pythonPath: '/Applications/Six Degrees.app/Contents/Resources/python/bin/python3' }));
  assert.equal(s.done, true);
  assert.equal(s.button, null, 'no Install button');
  assert.match(s.text, /come with the app/);
  assert.doesNotMatch(s.text, /[Ss]crap/);
});

test('a Python named in SIX_DEGREES_PYTHON, or one already installed: ready', () => {
  const custom = setupStep(status({ dependencies: true, pythonSource: 'custom', pythonPath: '/opt/py/bin/python3' }));
  assert.equal(custom.done, true);
  assert.match(custom.text, /SIX_DEGREES_PYTHON \(\/opt\/py\/bin\/python3\)/);
  for (const source of ['venv', 'system']) {
    assert.deepEqual(setupStep(status({ dependencies: true, pythonSource: source })), { done: true, text: 'Installed.', button: null, note: null, chrome: null });
  }
});

test('a Python to install into: Install, as before', () => {
  const s = setupStep(status({ python: true, dependencies: false, installFrom: { source: 'system', version: '3.12.3' } }));
  assert.equal(s.done, false);
  assert.deepEqual(s.button, { action: 'install', label: 'Install' });
  assert.match(s.text, /about a minute/);
  const running = setupStep(status({ python: true, installFrom: { source: 'system', version: '3.12.3' } }, { running: true, action: 'install' }));
  assert.equal(running.button.label, 'Installing…');
});

test('a setup stopped after its Python arrived: Install finishes it, with no second download', () => {
  const s = setupStep(status({ python: true, installFrom: { source: 'downloaded', version: '3.12.14' }, download: null }));
  assert.equal(s.button.action, 'install');
  assert.match(s.text, /Its own Python is already here/);
});

test('no Python the scanner can use: Set up the scanner, saying what it downloads, from where, and why', () => {
  const none = setupStep(status({ python: false, download: DOWNLOAD }));
  assert.equal(none.done, false);
  assert.deepEqual(none.button, { action: 'setup', label: 'Set up the scanner' });
  assert.match(none.text, /^This computer has no Python the scanner can use\./);
  assert.match(none.text, new RegExp(`Python 3\\.12\\.14 \\(${Math.round(DOWNLOAD.size / MB)} MB, from GitHub\\)`));
  assert.match(none.text, /from PyPI/);
  assert.match(none.text, /Nothing else on this computer changes/);

  const old = setupStep(status({ python: false, systemPython: { version: '3.9.6', venv: true }, download: DOWNLOAD }));
  assert.match(old.text, /^This computer has Python 3\.9\.6, and the scanner needs 3\.10 to 3\.14\./);
  const noVenv = setupStep(status({ python: false, systemPython: { version: '3.12.3', venv: false }, download: DOWNLOAD }));
  assert.match(noVenv.text, /Python 3\.12\.3 can't make the scanner's own environment \(on Ubuntu or Debian, python3-venv isn't installed\)/);
  const newer = setupStep(status({ python: false, systemPython: { version: '3.15.0', venv: true }, download: DOWNLOAD }));
  assert.match(newer.text, /has Python 3\.15\.0, and the scanner needs 3\.10 to 3\.14/);

  const running = setupStep(status({ python: false, download: DOWNLOAD }, { running: true, action: 'setup' }));
  assert.equal(running.button.label, 'Setting up…');
  // Another job running: the button keeps its own label (the page disables it).
  assert.equal(setupStep(status({ python: false, download: DOWNLOAD }, { running: true, action: 'login' })).button.label, 'Set up the scanner');
});

test('no Python and no download for this computer: it says what to install, with nothing to press', () => {
  const s = setupStep(status({ python: false, download: null }));
  assert.deepEqual(s, {
    done: false,
    text: 'No Python 3.10 to 3.14 was found on this machine. Install one from python.org, then reload.',
    button: null,
    note: null,
    chrome: null,
  });
  // Before the first answer the page draws no body; the step itself is simply not done.
  assert.equal(setupStep(null).done, false);
});

test('the app\'s own Python failing is said in a line of its own: what happened, and what to do', () => {
  // The server won't start it again (lib/scanner-python.js pythonLooker, retry: false).
  const blocked = { source: 'bundled', problem: 'it was stopped (SIGKILL)', retry: false };
  const s = setupStep(status({ python: true, ownPython: blocked, installFrom: { source: 'system', version: '3.13.1' } }));
  assert.equal(s.note, 'The Python that comes with the app didn\'t work (it was stopped (SIGKILL)). macOS may have blocked it. '
    + 'Six Degrees won\'t try it again until you restart it. '
    + 'To scan now, use Install below: it gives the scanner a Python of its own in your data folder.');
  assert.equal(s.button.action, 'install');
  assert.match(s.text, /^One-time, about a minute/, 'the step itself reads as for any copy');

  // No Python on this computer that will do: Set up the scanner is the way.
  const setup = setupStep(status({ python: false, ownPython: blocked, systemPython: { version: '3.9.6', venv: true }, download: DOWNLOAD }));
  assert.match(setup.note, /To scan now, use Set up the scanner below/);
  assert.equal(setup.button.action, 'setup');
  // While it runs the button says Setting up…, but the line still names it.
  assert.match(setupStep(status({ python: false, ownPython: blocked, download: DOWNLOAD }, { running: true, action: 'setup' })).note,
    /use Set up the scanner below/);

  // Another Python already has the packages: the scanner runs, and the line says on what.
  const fellBack = setupStep(status({ python: true, dependencies: true, pythonSource: 'system', ownPython: blocked }));
  assert.equal(fellBack.done, true);
  assert.match(fellBack.note, /^The Python that comes with the app didn't work .* The scanner uses another Python on this computer instead\.$/);

  // Nothing to install from or download: the line says what's left.
  assert.match(setupStep(status({ python: false, ownPython: blocked, download: null })).note,
    /install Python 3\.10 to 3\.14 from python\.org, then reload\.$/);

  // A reason that doesn't point at macOS doesn't blame it.
  const missing = setupStep(status({ python: true, ownPython: { source: 'bundled', problem: 'ModuleNotFoundError: No module named \'PIL\'', retry: false }, installFrom: { source: 'system', version: '3.12.3' } }));
  assert.doesNotMatch(missing.note, /macOS/);
  assert.match(missing.note, /No module named 'PIL'/);

  // A Python named in SIX_DEGREES_PYTHON (a developer's) is said in the step, as before, and asked again later.
  const custom = setupStep(status({ python: false, ownPython: { source: 'custom', problem: 'it isn\'t there' }, download: DOWNLOAD }));
  assert.match(custom.text, /^The Python named in SIX_DEGREES_PYTHON didn't work \(it isn't there\)/);
  assert.equal(custom.button.action, 'setup');
  assert.equal(custom.note, null);
  // No failure, no line.
  assert.equal(setupStep(status({ python: true, dependencies: true, pythonSource: 'bundled' })).note, null);
});

test('other pages send people to Scan while there is something to set up there', () => {
  assert.equal(notReadyMessage(null), 'Could not reach the app.');
  assert.equal(notReadyMessage(status({ scriptsFound: false })), 'The scanner files are missing from this install.');
  assert.equal(notReadyMessage(status({ python: false, dependencies: false, download: DOWNLOAD })),
    'The scanner is not set up yet. Open Scan to set it up.');
  assert.equal(notReadyMessage(status({ python: true, dependencies: false })),
    'The scanner is not set up yet. Open Scan to set it up.');
  assert.equal(notReadyMessage(status({ python: false, dependencies: false, download: null })),
    'No Python 3.10 to 3.14 is installed on this machine.');
  // The same words as the Scan page's step 1 and the server's refusal.
  assert.equal(notReadyMessage(status({ python: true, dependencies: true, chrome: false })), CHROME_REFUSAL);
  assert.equal(notReadyMessage(status({ python: true, dependencies: true, pythonSource: 'bundled' })), null);
});

// ── Google Chrome, in step 1 ────────────────────────────────────────────────

const READY = { python: true, dependencies: true, pythonSource: 'bundled' };

test('step 1 isn\'t done without Google Chrome, and offers it: "Install Google Chrome, then come back"', () => {
  const s = setupStep(status({ ...READY, chrome: false }));
  assert.equal(s.done, false);
  // With the Python ready, Chrome is all the step says: "Ready" would read as finished.
  assert.equal(s.text, CHROME_MISSING);
  assert.equal(s.button, null, 'nothing of the Python\'s to press');
  assert.deepEqual(s.chrome, { label: 'Install Google Chrome, then come back', href: 'https://www.google.com/chrome/' });
  assert.equal(CHROME_BUTTON, s.chrome.label);
  assert.equal(CHROME_DOWNLOAD, s.chrome.href);
  // The server's refusal is the step's words with the button's after them.
  assert.equal(CHROME_REFUSAL, `${CHROME_MISSING} ${CHROME_BUTTON}.`);
  assert.doesNotMatch(CHROME_REFUSAL, /—/);
});

test('with the Python still to set up too, its step comes first, then Chrome\'s', () => {
  const install = setupStep(status({ python: true, installFrom: { source: 'system', version: '3.12.3' }, chrome: false }));
  assert.equal(install.done, false);
  assert.deepEqual(install.button, { action: 'install', label: 'Install' });
  assert.match(install.text, /^One-time, about a minute\. .* The scanner works in Google Chrome, and Chrome isn’t on this computer\.$/);
  assert.equal(install.chrome.label, CHROME_BUTTON);
  const setup = setupStep(status({ python: false, download: DOWNLOAD, chrome: false }));
  assert.equal(setup.button.action, 'setup');
  assert.ok(setup.text.endsWith(CHROME_MISSING));
});

test('Chrome found, or not known yet: the step is as it always was', () => {
  assert.equal(setupStep(status({ ...READY })).chrome, null);
  assert.equal(setupStep(status({ ...READY })).done, true);
  // Before the first answer, and a status with no checks (the page's stand-in when the app can't be reached).
  assert.equal(setupStep(null).chrome, null);
  assert.equal(setupStep({ ready: false, checks: {}, log: [] }).chrome, null);
});

test('the app\'s own Python failing still says so when Chrome is missing too', () => {
  const blocked = { source: 'bundled', problem: 'it was stopped (SIGKILL)', retry: false };
  const s = setupStep(status({ python: true, dependencies: true, pythonSource: 'system', ownPython: blocked, chrome: false }));
  assert.equal(s.done, false);
  assert.match(s.note, /The scanner uses another Python on this computer instead\.$/);
  assert.equal(s.text, CHROME_MISSING);
});

test('where Chrome is looked for: Playwright\'s "chrome" channel, per system', () => {
  const only = (want) => (p) => p === want;
  assert.equal(chromeInstalled({ platform: 'darwin', exists: only('/Applications/Google Chrome.app') }), true);
  assert.equal(chromeInstalled({ platform: 'darwin', exists: () => false }), false);
  assert.equal(chromeInstalled({ platform: 'linux', exists: only('/opt/google/chrome/chrome') }), true);
  assert.equal(chromeInstalled({ platform: 'linux', exists: only('/usr/bin/chromium') }), false, 'Chromium doesn\'t count');
  const win = { LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local\\', PROGRAMFILES: 'C:\\Program Files' };
  assert.equal(chromeInstalled({ platform: 'win32', env: win, exists: only('C:\\Users\\ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe') }), true);
  assert.equal(chromeInstalled({ platform: 'win32', env: win, exists: only('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') }), true);
  assert.equal(chromeInstalled({ platform: 'win32', env: {}, exists: () => true }), false, 'nowhere to look');
  assert.equal(chromeInstalled({ platform: 'freebsd', exists: () => false }), true, 'elsewhere Playwright decides');
});

test('SIX_DEGREES_TEST_CHROME answers for the computer, for tests and checking the page; nothing else does', () => {
  assert.equal(chromeInstalled({ platform: 'darwin', env: { SIX_DEGREES_TEST_CHROME: 'missing' }, exists: () => true }), false);
  assert.equal(chromeInstalled({ platform: 'darwin', env: { SIX_DEGREES_TEST_CHROME: 'found' }, exists: () => false }), true);
  for (const other of ['', '1', 'yes', 'MISSING']) {
    assert.equal(chromeInstalled({ platform: 'darwin', env: { SIX_DEGREES_TEST_CHROME: other }, exists: () => false }), false, other);
  }
});

// ── signed in ───────────────────────────────────────────────────────────────

test('signed in is the scanner\'s note once it has one, not Chrome\'s cookie file', () => {
  assert.equal(SIGNED_IN_FILE, 'signed-in.json');
  // Opened LinkedIn and closed the window without signing in: Chrome made its
  // cookie file anyway, and the step used to tick.
  assert.equal(signedInFrom({ note: { signedIn: false, at: 1790000000 }, profile: true, cookies: true }), false);
  assert.equal(signedInFrom({ note: { signedIn: true, at: 1790000000 }, profile: true, cookies: true }), true);
  // The scanner's Chrome profile deleted: signed out, whatever the note said.
  assert.equal(signedInFrom({ note: { signedIn: true, at: 1790000000 }, profile: false, cookies: false }), false);
});

test('a data folder from before the note keeps the old check, so nobody signed in is told they aren\'t', () => {
  assert.equal(signedInFrom({ note: null, profile: true, cookies: true }), true);
  assert.equal(signedInFrom({ note: null, profile: true, cookies: false }), false);
  assert.equal(signedInFrom({ note: null, profile: false, cookies: false }), false);
  // A note that can't be understood counts as none.
  for (const odd of [{}, { signedIn: 'yes' }, [], 'true', 42]) {
    assert.equal(signedInFrom({ note: odd, profile: true, cookies: true }), true, JSON.stringify(odd));
  }
});

// ── your field, once your connections are in ────────────────────────────────

const NOTHING = { first: 0, second: 0, third: 0 };
const FIRST = { first: 120, second: 0, third: 0 };
const unasked = { sectorFocus: { sectors: [], strength: 'lean' }, fieldAsked: false, tierScale: 'curve' };

test('your field is asked once your connections are in, when no sector is picked and it was never answered', () => {
  assert.equal(askForField(status({}, { network: FIRST }), unasked), true);
});

test('never before step 3: nothing stands between someone new and their first scan', () => {
  assert.equal(askForField(status({}, { network: NOTHING }), unasked), false);
  // Not even waiting on the settings: the steps show at once.
  assert.equal(askForField(status({}, { network: NOTHING }), undefined), false);
});

test('never once who they know is in: whoever has 2nd degree or company scans finished onboarding', () => {
  for (const network of [{ ...FIRST, second: 40 }, { ...FIRST, third: 3 }, { ...NOTHING, second: 40 }]) {
    assert.equal(askForField(status({}, { network }), unasked), false, JSON.stringify(network));
  }
});

test('asked once: never to someone who picked a sector, or answered or skipped it before', () => {
  const s = status({}, { network: FIRST });
  assert.equal(askForField(s, { ...unasked, sectorFocus: { sectors: ['dental'], strength: 'lean' } }), false);
  // Answered before step 1 under the old order, or skipped here: kept, never asked again.
  assert.equal(askForField(s, { ...unasked, fieldAsked: true }), false);
});

test('not while something runs, and not when the app couldn\'t be asked', () => {
  assert.equal(askForField(status({}, { network: FIRST, running: true, action: 'auto-bridge' }), unasked), false);
  // The page's stand-in when GET /api/scraper fails has no counts.
  assert.equal(askForField({ ready: false, checks: {}, log: [] }, unasked), false);
  // Settings that couldn't be read: no question, and Scores still has it.
  assert.equal(askForField(status({}, { network: FIRST }), null), false);
});

test('not known until both answers are in, so the question never shows and then goes', () => {
  assert.equal(askForField(null, unasked), null);
  assert.equal(askForField(status({}, { network: FIRST }), undefined), null);
});
