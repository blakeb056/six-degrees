// The Scan page's first step, in every state GET /api/scraper can report
// (lib/scanner-setup.js), and what other pages say when the scanner isn't
// ready (lib/scraper-client.js notReadyMessage). DESKTOP.md D2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupStep } from '../lib/scanner-setup.js';
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
    assert.deepEqual(setupStep(status({ dependencies: true, pythonSource: source })), { done: true, text: 'Installed.', button: null });
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
    text: 'Python 3.10 or newer was not found on this machine. Install it from python.org, then reload.',
    button: null,
  });
  // Before the first answer the page draws no body; the step itself is simply not done.
  assert.equal(setupStep(null).done, false);
});

test('the app\'s own Python failing is said out loud, before the way round it', () => {
  const s = setupStep(status({
    python: true, ownPython: { source: 'bundled', problem: 'it was stopped (SIGKILL)' },
    installFrom: { source: 'system', version: '3.13.1' },
  }));
  assert.match(s.text, /^The Python inside the app didn't work \(it was stopped \(SIGKILL\)\), so the scanner needs setting up another way\. One-time/);
  assert.equal(s.button.action, 'install');
  const custom = setupStep(status({ python: false, ownPython: { source: 'custom', problem: 'it isn\'t there' }, download: DOWNLOAD }));
  assert.match(custom.text, /^The Python named in SIX_DEGREES_PYTHON didn't work \(it isn't there\)/);
  assert.equal(custom.button.action, 'setup');
});

test('other pages send people to Scan while there is something to set up there', () => {
  assert.equal(notReadyMessage(null), 'Could not reach the app.');
  assert.equal(notReadyMessage(status({ scriptsFound: false })), 'The scanner files are missing from this install.');
  assert.equal(notReadyMessage(status({ python: false, dependencies: false, download: DOWNLOAD })),
    'The scanner is not set up yet — open Scan to set it up.');
  assert.equal(notReadyMessage(status({ python: true, dependencies: false })),
    'The scanner is not set up yet — open Scan to set it up.');
  assert.equal(notReadyMessage(status({ python: false, dependencies: false, download: null })),
    'Python 3.10 or newer is not installed on this machine.');
  assert.equal(notReadyMessage(status({ python: true, dependencies: true, chrome: false })), 'Google Chrome is not installed.');
  assert.equal(notReadyMessage(status({ python: true, dependencies: true, pythonSource: 'bundled' })), null);
});
