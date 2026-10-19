// Sixgree's own browser: the pure parts. The panel's links, where it goes in
// the window, when the debugging port opens, what the scanner is told, and
// when the page brings the panel forward (desktop/lib.mjs, lib/linkedin-panel.js,
// lib/profile-opened.js). No Electron needed. The scanner's half is in
// tests/scanner-panel.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isLinkedInUrl, panelRoute, panelBounds, scannerInstalled, devToolsPort, panelEnv, routeFor, LINKEDIN_PANEL_PARTITION,
} from '../desktop/lib.mjs';
import {
  panelEnvOf, scannerEnvWithPanel, hasPanel, panelAsked, panelWanted, scanHoldsPanel,
  PANEL_FRONT, PANEL_AWAY,
} from '../lib/linkedin-panel.js';
import { recordProfileOpened, readProfileOpened, chargeProfileView, OPENED_FILE, OPENED_KEPT, ACTIVITY_FILE } from '../lib/profile-opened.js';
import { usage } from '../lib/linkedin-limits.js';

const TARGET = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

test('the panel shows LinkedIn only: other web pages go to your browser, anything else nowhere', () => {
  for (const url of [
    'https://www.linkedin.com/in/someone-invented/',
    'https://www.linkedin.com/checkpoint/challenge/xyz',
    'https://www.linkedin.com/uas/login',
    'https://linkedin.com/feed/',
    'about:blank',
  ]) assert.equal(panelRoute(url), 'panel', url);
  for (const url of [
    'https://example.com/',
    'https://lnkd.in/abc',
    'https://www.linkedin.com.evil.example/in/x',
    'https://notlinkedin.com/',
    'http://www.linkedin.com/feed/',          // never plain http
    'http://127.0.0.1:6363/',
  ]) assert.equal(panelRoute(url), 'browser', url);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'x-apple.systempreferences:', 'not a url']) {
    assert.equal(panelRoute(url), 'block', url);
  }
  assert.equal(isLinkedInUrl('https://WWW.LinkedIn.com/in/x'), true);
  assert.equal(isLinkedInUrl('https://linkedin.com@evil.example/'), false);
  assert.equal(LINKEDIN_PANEL_PARTITION, 'persist:linkedin', 'its own storage, kept from one start to the next');
});

test('the local check’s test page gets in only when named, and only that origin', () => {
  const testOrigin = 'http://127.0.0.1:61234';
  assert.equal(panelRoute('http://127.0.0.1:61234/panel.html', { testOrigin }), 'panel');
  assert.equal(panelRoute('http://127.0.0.1:61235/panel.html', { testOrigin }), 'browser');
  assert.equal(panelRoute('http://127.0.0.1:61234/panel.html'), 'browser', 'not named: an ordinary web page');
});

test('the app’s own page keeps its rules: LinkedIn links from it still go to your browser', () => {
  assert.equal(routeFor('https://www.linkedin.com/in/someone', 'http://127.0.0.1:6364'), 'browser');
});

test('where the panel goes: under the top bar to the bottom, the page’s zoom counted, nothing when it can’t fit', () => {
  const win = { width: 1400, height: 900 };
  assert.deepEqual(panelBounds(win, 120), { x: 0, y: 120, width: 1400, height: 780 });
  // Zoomed in to 125%: the page's 120 CSS pixels are 150 of the window's points.
  assert.deepEqual(panelBounds(win, 120, 1.25), { x: 0, y: 150, width: 1400, height: 750 });
  // Rounded up, so the bar's last line is never covered.
  assert.equal(panelBounds(win, 100.2).y, 101);
  assert.equal(panelBounds(win, 100, 0.9).y, 90);
  assert.equal(panelBounds(win, 0).y, 0);
  assert.equal(panelBounds(win, 100, 0).y, 100, 'a zoom that makes no sense counts as 1');
  for (const top of [null, undefined, NaN, -5, 'x', 900, 2000]) assert.equal(panelBounds(win, top), null, String(top));
  assert.equal(panelBounds({ width: 0, height: 900 }, 100), null);
  assert.deepEqual(panelBounds({ width: 1400.6, height: 900.4 }, 100), { x: 0, y: 100, width: 1400, height: 800 });
});

test('the debugging port opens only with a scanner installed: a plugin with its scanner, or a checkout’s own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-panel-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-repo-'));
  const real = { exists: fs.existsSync, list: (d) => fs.readdirSync(d) };
  try {
    assert.equal(scannerInstalled({ dataDir: dir, ...real }), false, 'no plugins folder');
    fs.mkdirSync(path.join(dir, 'plugins', 'auto-scan', 'scanner'), { recursive: true });
    assert.equal(scannerInstalled({ dataDir: dir, ...real }), false, 'a plugin folder without its scanner');
    fs.mkdirSync(path.join(dir, 'plugins', '.staging-x', 'scanner'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins', '.staging-x', 'scanner', 'scrape.py'), '');
    assert.equal(scannerInstalled({ dataDir: dir, ...real }), false, 'a hidden folder (an install part-way) is not a plugin');
    fs.writeFileSync(path.join(dir, 'plugins', 'auto-scan', 'scanner', 'scrape.py'), '');
    assert.equal(scannerInstalled({ dataDir: dir, ...real }), true);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-panel-'));
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.writeFileSync(path.join(repo, 'scripts', 'scrape.py'), '');
    assert.equal(scannerInstalled({ dataDir: empty, repo, packaged: false, ...real }), true, 'a checkout has its own');
    assert.equal(scannerInstalled({ dataDir: empty, repo, packaged: true, ...real }), false, 'a download never counts scripts/');
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Chromium’s DevToolsActivePort: its first line, a real port, or nothing yet', () => {
  assert.equal(devToolsPort('60212\n/devtools/browser/a6e68c99\n'), 60212);
  assert.equal(devToolsPort('60212'), 60212);
  for (const text of ['', null, undefined, 'abc', '0\n', '70000\n', '-1', '12.5']) assert.equal(devToolsPort(text), null, String(text));
});

test('what the server is told about the panel: both, sound, or nothing', () => {
  assert.deepEqual(panelEnv({ port: 60212, targetId: TARGET }), {
    SIX_DEGREES_PANEL_CDP: 'http://127.0.0.1:60212',
    SIX_DEGREES_PANEL_TARGET: TARGET,
  });
  assert.deepEqual(panelEnv({ port: null, targetId: TARGET }), {});
  assert.deepEqual(panelEnv({ port: 60212, targetId: null }), {});
  assert.deepEqual(panelEnv({ port: 60212, targetId: 'page-1' }), {});
  assert.deepEqual(panelEnv(), {});
});

test('the env a scanner starts with: the panel passed on only when sound, on 127.0.0.1 alone', () => {
  const sound = { SIX_DEGREES_PANEL_CDP: 'http://127.0.0.1:60212', SIX_DEGREES_PANEL_TARGET: TARGET };
  const base = { PATH: '/usr/bin', SIX_DEGREES_HOME: '/x' };
  assert.deepEqual(scannerEnvWithPanel({ ...base, ...sound }), { ...base, ...sound });
  assert.deepEqual(scannerEnvWithPanel(base), base, 'outside the desktop app: nothing added');
  for (const cdp of ['http://localhost:60212', 'http://10.0.0.2:60212', 'http://127.0.0.1:60212/json', 'ws://127.0.0.1:60212', 'http://127.0.0.1:0']) {
    const env = scannerEnvWithPanel({ ...base, ...sound, SIX_DEGREES_PANEL_CDP: cdp });
    assert.deepEqual(env, base, `${cdp}: neither is passed on`);
  }
  assert.deepEqual(scannerEnvWithPanel({ ...base, ...sound, SIX_DEGREES_PANEL_TARGET: '' }), base);
  assert.equal(hasPanel({ ...base, ...sound }), true);
  assert.equal(hasPanel(base), false);
  assert.deepEqual(panelEnvOf({ ...sound, SIX_DEGREES_PANEL_CDP: ' http://127.0.0.1:60212 ' }), sound);
});

test('a running scan holds the panel only with a scanner driving it, and only for a job that opens LinkedIn', () => {
  const withScanner = { available: true, scanner: true };
  const job = (action, running = true) => ({ running, action });
  assert.equal(scanHoldsPanel(job('bridge'), withScanner), true);
  assert.equal(scanHoldsPanel(job('connect'), withScanner), true);
  assert.equal(scanHoldsPanel(job('login'), withScanner), true);
  // Nothing runs, or what runs never opens LinkedIn: the panel is yours.
  assert.equal(scanHoldsPanel(job('bridge', false), withScanner), false);
  for (const action of ['install', 'setup', 'photos']) assert.equal(scanHoldsPanel(job(action), withScanner), false, action);
  // Only the LinkedIn browser plugin, no scanner: scans run in Chrome, never in the panel.
  assert.equal(scanHoldsPanel(job('bridge'), { available: true, scanner: false }), false);
  assert.equal(scanHoldsPanel(job('bridge'), null), false);
  assert.equal(scanHoldsPanel(null, withScanner), false);
});

test('when the page brings the panel forward: the scanner says so, LinkedIn needs you, or signing in', () => {
  assert.equal(panelAsked(['Using Sixgree\'s own browser…', PANEL_FRONT, 'Page 1...']), 'front');
  assert.equal(panelAsked([PANEL_FRONT, 'x', PANEL_AWAY]), 'away');
  assert.equal(panelAsked(['  ' + PANEL_FRONT + '  ']), 'front', 'as the app keeps a line: trimmed');
  assert.equal(panelAsked([]), null);
  assert.equal(panelAsked(null), null);

  const running = (more) => ({ running: true, action: 'bridge', log: [], needsYou: null, ...more });
  assert.equal(panelWanted(running()), false, 'a scan out of sight stays out of sight');
  assert.equal(panelWanted(running({ log: [PANEL_FRONT] })), true);
  assert.equal(panelWanted(running({ log: [PANEL_FRONT, PANEL_AWAY] })), false);
  assert.equal(panelWanted(running({ needsYou: "sign in to LinkedIn in Sixgree's own browser." })), true);
  assert.equal(panelWanted(running({ action: 'login' })), true);
  assert.equal(panelWanted({ running: false, action: null, log: [PANEL_FRONT], needsYou: 'x' }), false, 'nothing runs: nothing wants it');
  assert.equal(panelWanted(null), false);
});

test('the record of profiles opened: which profile and when, the newest kept, and a damaged record never stops one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-opened-'));
  // The file keeps its old name: existing installs already have it.
  assert.equal(OPENED_FILE, 'outlink-opened.json');
  try {
    assert.deepEqual(readProfileOpened(dir), []);
    const e = recordProfileOpened(dir, { id: 'c1', name: 'Someone Invented', url: 'https://www.linkedin.com/in/someone-invented', at: 1790000000000 });
    assert.deepEqual(e, { id: 'c1', name: 'Someone Invented', url: 'https://www.linkedin.com/in/someone-invented', at: 1790000000000 });
    assert.deepEqual(readProfileOpened(dir), [e]);
    const f = recordProfileOpened(dir, { id: 42, url: 'https://www.linkedin.com/in/other' });
    assert.equal(f.id, null, 'only an id of ours');
    assert.equal(f.name, null);
    assert.ok(Number.isFinite(f.at));
    assert.equal(readProfileOpened(dir).length, 2);

    fs.writeFileSync(path.join(dir, OPENED_FILE), '{"opened": [');
    assert.deepEqual(readProfileOpened(dir), []);
    recordProfileOpened(dir, { id: 'c2', url: 'https://www.linkedin.com/in/x', at: 1 });
    assert.equal(readProfileOpened(dir).length, 1, 'a damaged record starts again');

    const many = Array.from({ length: OPENED_KEPT + 5 }, (_, i) => ({ id: `c${i}`, name: null, url: 'u', at: i }));
    fs.writeFileSync(path.join(dir, OPENED_FILE), JSON.stringify({ opened: many }));
    recordProfileOpened(dir, { id: 'last', url: 'u', at: 99999 });
    const kept = readProfileOpened(dir);
    assert.equal(kept.length, OPENED_KEPT);
    assert.equal(kept.at(-1).id, 'last');
    assert.equal(kept[0].id, 'c6');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a profile opened in the panel is one profile view in the scanner’s own record, and nothing else in it changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-view-'));
  const file = path.join(dir, ACTIVITY_FILE);
  const now = 1790000000000;
  try {
    // No record yet: one is started, with this one view.
    assert.equal(chargeProfileView(dir, now), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { searches: [], profiles: [now / 1000] });
    assert.equal(usage(dir, now + 1000).profilesToday, 1, 'the daily limit counts it, as it counts a scan’s');
    // The scanner's searches and Auto's requests are kept as they are; the view goes on the end, in seconds.
    fs.writeFileSync(file, JSON.stringify({ searches: [1, 2], profiles: [3], invites: [4], other: 'kept' }));
    assert.equal(chargeProfileView(dir, now), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { searches: [1, 2], profiles: [3, now / 1000], invites: [4], other: 'kept' });
    // A record that can't be read is left alone: the scanner reads it as the day used up.
    for (const bad of ['{"profiles": [', '[]', '{"profiles": "x"}', '{"profiles": ["a"]}']) {
      fs.writeFileSync(file, bad);
      assert.equal(chargeProfileView(dir, now), false, bad);
      assert.equal(fs.readFileSync(file, 'utf8'), bad, 'unchanged');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
