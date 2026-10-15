// Sixgree's own browser, second round (Blake, 2026-10-15): the panel as plain
// Chrome, nothing of Sixgree's ever under it, and the LinkedIn browser
// plugin's mode. The pure parts, no Electron:
//   - the panel's user agent, derived from the real one (desktop/lib.mjs chromeUserAgent);
//   - where the bar and the panel go under a header of one or two rows and
//     the notch (lib/linkedin-panel.js panelLayout), and what it keeps clear
//     (desktop/lib.mjs panelBounds);
//   - the swap for a still picture while something is open over it, and back
//     (desktop/lib.mjs createPanelCover, lib/panel-cover.js);
//   - the LinkedIn browser plugin: when the shell makes a panel for it, where
//     browsing starts, and which profile the panel is on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chromeUserAgent, panelBounds, createPanelCover, browserPluginInstalled, browseHome, panelProfileSlug, scannerInstalled,
  LINKEDIN_BROWSER_PLUGIN,
} from '../desktop/lib.mjs';
import { panelLayout, PANEL_BAR, BROWSER_SIDEBAR } from '../lib/linkedin-panel.js';
import { coverPanel, panelCoveredNow, watchPanelCover } from '../lib/panel-cover.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── Plain Chrome ─────────────────────────────────────────────────────────────

// What Electron 44 gave the panel in a checkout of 2.4.0 (docs/brain/DESKTOP.md).
const ELECTRON_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sixgree/2.4.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';

test('the panel’s user agent is the real one with the Sixgree and Electron tokens taken out, and nothing else changed', () => {
  assert.equal(chromeUserAgent(ELECTRON_UA),
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36');
  // Derived, never typed in: whatever Chrome is running is the one it names.
  const later = ELECTRON_UA.replace('152.0.7977.130', '160.1.2.3').replace('Electron/44.4.5', 'Electron/52.0.0').replace('Sixgree/2.4.0', 'Sixgree/3.1.0');
  assert.equal(chromeUserAgent(later), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.1.2.3 Safari/537.36');
  // A checkout's version, Windows's platform part, and the name the app was given.
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sixgree/0.0.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';
  assert.equal(chromeUserAgent(win), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36');
  assert.equal(chromeUserAgent(ELECTRON_UA.replace('Sixgree/', 'SixDegrees/'), { appNames: ['Six Degrees'] }),
    chromeUserAgent(ELECTRON_UA));
  // Already plain: as it is. Something without a Chrome token: given back untouched.
  const plain = chromeUserAgent(ELECTRON_UA);
  assert.equal(chromeUserAgent(plain), plain);
  assert.equal(chromeUserAgent('Electron/44.4.5'), 'Electron/44.4.5');
  assert.equal(chromeUserAgent(''), '');
  // The parentheses and every other token stay word for word.
  assert.match(plain, /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) /);
  assert.doesNotMatch(plain, /Sixgree|Electron|\s{2}/);
});

test('the shell sets it on the panel’s session only, from the session’s own, and touches nothing else', () => {
  // The code, not what its comments say about it.
  const main = read('../desktop/main.mjs').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(main, /panelSession\.setUserAgent\(chromeUserAgent\(panelSession\.getUserAgent\(\)/);
  assert.equal((main.match(/setUserAgent\(/g) || []).length, 1, 'once, for that session');
  assert.doesNotMatch(main, /session\.defaultSession\.setUserAgent|app\.userAgentFallback/);
  // No client hints, no navigator.webdriver, no fingerprint: none of it is touched.
  assert.doesNotMatch(main, /Sec-CH-UA|userAgentMetadata|navigator\.webdriver|AutomationControlled|onBeforeSendHeaders/i);
});

// ── Where it goes ────────────────────────────────────────────────────────────

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('one header row: the bar under the header, its words to the left of the notch, the panel under both', () => {
  const header = rect(0, 0, 1400, 86);
  const tabs = rect(400, 48, 1000, 86);
  const notch = rect(482, 86, 918, 122);
  const l = panelLayout({ width: 1400, header, tabs, notch });
  assert.equal(l.barTop, 86, 'right under the header: the bar never covers a tab');
  assert.equal(l.top, Math.max(86 + PANEL_BAR, 122 + 4));
  assert.equal(l.words, 482 - 12 - 16, 'the words stop short of the notch');
  // No notch: the bar takes the whole row.
  const bare = panelLayout({ width: 1400, header, tabs });
  assert.deepEqual(bare, { barTop: 86, top: 86 + PANEL_BAR, words: 1400 - 32 });
  // A notch taller than the bar: the panel starts under the notch.
  const tall = panelLayout({ width: 1400, header, tabs, notch: rect(482, 86, 918, 150) });
  assert.equal(tall.top, 154);
});

test('two header rows (the tabs wrapped on a narrow or zoomed window): measured under the lower', () => {
  const header = rect(0, 0, 960, 120);
  // The tabs moved down onto the header's line reach a little past it.
  const tabs = rect(10, 60, 950, 124);
  const notch = rect(330, 124, 630, 158);
  const l = panelLayout({ width: 960, header, tabs, notch });
  assert.equal(l.barTop, 124, 'under the tabs’ second row, not the header’s box');
  assert.ok(l.top >= 158 + 4 && l.top >= 124 + PANEL_BAR);
  assert.equal(l.top, 164);
});

test('no room beside the notch: the bar goes under it, whole, and the panel under the bar', () => {
  const header = rect(0, 0, 960, 86);
  // A wide notch (a scan running, its status beside the page's views).
  const notch = rect(120, 86, 840, 122);
  const l = panelLayout({ width: 960, header, notch });
  assert.equal(l.barTop, 126, 'under the notch');
  assert.equal(l.top, 126 + PANEL_BAR);
  assert.equal(l.words, 960 - 32);
  // Room on the left but not for Back to Sixgree on the right: under it too.
  const right = panelLayout({ width: 960, header, notch: rect(500, 86, 900, 122) });
  assert.equal(right.barTop, 126);
  // A notch that doesn't hang below the header changes nothing.
  assert.deepEqual(panelLayout({ width: 960, header, notch: rect(120, 40, 840, 80) }), panelLayout({ width: 960, header }));
});

test('nothing measured yet: the bar at the top, never a negative or a fraction', () => {
  assert.deepEqual(panelLayout({ width: 0 }), { barTop: 0, top: PANEL_BAR, words: 0 });
  const l = panelLayout({ width: 1200.5, header: rect(0, 0, 1200, 85.6), notch: rect(400, 85.6, 800, 121.3) });
  assert.equal(l.top, Math.ceil(121.3 + 4));
  assert.equal(Number.isInteger(l.barTop) && Number.isInteger(l.words), true);
});

test('what the panel keeps clear: the people list on the right, a banner at the bottom, zoomed too', () => {
  const win = { width: 1400, height: 900 };
  assert.deepEqual(panelBounds(win, 126, 1, { right: BROWSER_SIDEBAR }), { x: 0, y: 126, width: 1400 - 340, height: 900 - 126 });
  assert.deepEqual(panelBounds(win, 126, 1, { right: 340, bottom: 40 }), { x: 0, y: 126, width: 1060, height: 734 });
  // At 125%, the page's 340 CSS pixels are 425 of the window's points.
  assert.deepEqual(panelBounds(win, 100, 1.25, { right: 340, bottom: 40 }), { x: 0, y: 125, width: 975, height: 725 });
  // Nonsense insets count as none; insets that leave no room leave no panel.
  assert.deepEqual(panelBounds(win, 100, 1, { right: -5, bottom: NaN }), panelBounds(win, 100));
  assert.equal(panelBounds(win, 100, 1, { right: 1400 }), null);
  assert.equal(panelBounds(win, 100, 1, { bottom: 800 }), null);
});

// ── The still picture while something is over it ────────────────────────────

/** A cover wired to stand-ins that write down what happens, in order. */
function rig({ shown = true, picture = 'data:image/jpeg;base64,AAAA', ackMs = 50 } = {}) {
  const log = [];
  let release = null;
  const s = { shown };
  const cover = createPanelCover({
    capture: () => new Promise((resolve) => {
      log.push('capture');
      release = () => resolve(picture);
    }),
    sendStill: (n, src) => log.push(src ? `still ${n}` : `still ${n} gone`),
    apply: () => log.push(cover.frozen ? 'panel out' : 'panel back'),
    shown: () => s.shown,
    ackMs,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return { cover, log, s, taken: () => release?.() };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('opened over it: the picture is taken with the panel in front, drawn, and only then does the panel go', async () => {
  const { cover, log, taken } = rig();
  cover.set(true);
  assert.deepEqual(log, ['capture'], 'the panel is still in front while its picture is taken');
  taken();
  await tick();
  assert.deepEqual(log, ['capture', 'still 1'], 'the page draws it first');
  assert.equal(cover.frozen, false);
  cover.drawn(1);
  await tick();
  assert.deepEqual(log, ['capture', 'still 1', 'panel out']);
  assert.equal(cover.frozen, true);
  // Closed: the panel comes back first, then the page drops the picture, so nothing flashes.
  cover.set(false);
  assert.deepEqual(log.slice(3), ['panel back', 'still 2 gone']);
  assert.equal(cover.frozen, false);
});

test('the page never says it drew it: the panel goes anyway, a moment later', async () => {
  const { cover, log, taken } = rig({ ackMs: 20 });
  cover.set(true);
  taken();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(log, ['capture', 'still 1', 'panel out']);
});

test('closed while its picture was being taken: nothing goes, and a picture sent is taken back', async () => {
  const early = rig();
  early.cover.set(true);
  early.cover.set(false);
  early.taken();
  await tick();
  assert.deepEqual(early.log, ['capture'], 'no picture drawn, the panel never went');
  assert.equal(early.cover.frozen, false);

  const late = rig();
  late.cover.set(true);
  late.taken();
  await tick();
  late.cover.set(false);
  late.cover.drawn(1);   // a late answer for the old picture
  await tick();
  assert.deepEqual(late.log, ['capture', 'still 1', 'still 2 gone']);
  assert.equal(late.cover.frozen, false);
});

test('nothing to cover while the panel is out of sight; shown with something open, it steps aside at once', async () => {
  const { cover, log, s, taken } = rig({ shown: false });
  cover.set(true);
  assert.deepEqual(log, [], 'hidden: no picture, nothing to do');
  s.shown = true;
  cover.refresh();   // main.mjs, as the panel is shown
  taken();
  await tick();
  const n = Number(log[1]?.split(' ')[1]);
  cover.drawn(n);
  await tick();
  assert.deepEqual(log, ['capture', `still ${n}`, 'panel out']);
  // Hidden by Back to Sixgree while frozen: it is let go, and the picture with it.
  s.shown = false;
  cover.refresh();
  assert.deepEqual(log.slice(3), ['panel back', `still ${n + 1} gone`]);
  assert.equal(cover.frozen, false);
});

test('a picture that can’t be taken still lets what’s open show', async () => {
  const { cover, log, taken } = rig({ picture: null });
  cover.set(true);
  taken();
  await tick();
  assert.deepEqual(log, ['capture', 'panel out']);
});

test('the page’s side: each open thing counted once, and closed by the function it got back', () => {
  const seen = [];
  const stop = watchPanelCover(() => seen.push(panelCoveredNow()));
  const bell = coverPanel('bell');
  const again = coverPanel('bell');
  const light = coverPanel('scan-light');
  assert.equal(panelCoveredNow(), true);
  bell();
  assert.equal(panelCoveredNow(), true, 'the scan light is still open');
  again();   // the same one twice: already closed
  light();
  assert.equal(panelCoveredNow(), false);
  assert.deepEqual(seen, [true, true, true, false]);
  assert.equal(typeof coverPanel(''), 'function');
  assert.equal(panelCoveredNow(), false, 'no id, nothing open');
  stop();
});

test('every header overlay says so while it is open: the bell, the scan light, the notch, Auto scan, a floating note', () => {
  assert.match(read('../app/components/AppHeader.js'), /usePanelCover\(open\)/);
  assert.match(read('../app/components/ScanLight.js'), /usePanelCover\(open\)/);
  const notch = read('../app/components/ScanStatusBar.js');
  assert.match(notch, /usePanelCover\(opened\)/);
  assert.match(notch, /data-notch-open=\{opened \? '' : undefined\}/);
  assert.match(read('../app/components/AutoScanButton.js'), /usePanelCover\(mounted\)/);
  assert.match(read('../app/components/InlineNote.js'), /usePanelCover\(Boolean\(note && float\)\)/);
  assert.match(read('../app/components/StaleServerBanner.js'), /data-stale-banner=""/);
  // The still sits under them, and the header is lifted over it.
  const panel = read('../app/components/LinkedInPanel.js');
  assert.match(panel, /data-panel-still=""/);
  assert.match(panel, /zIndex: 58/);
  assert.match(panel, /header\{position:relative;z-index:101\}/);
  // The shell's side: the panel stays out while frozen.
  assert.match(read('../desktop/main.mjs'), /&& !panelCover\.frozen\);/);
});

// ── The LinkedIn browser plugin, the shell's side ───────────────────────────

test('the shell makes a panel for the LinkedIn browser plugin alone, but opens the debugging port only for a scanner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'six-degrees-browser-'));
  const real = { exists: fs.existsSync, list: (d) => fs.readdirSync(d) };
  try {
    assert.equal(browserPluginInstalled({ dataDir: dir, ...real }), false);
    fs.mkdirSync(path.join(dir, 'plugins', LINKEDIN_BROWSER_PLUGIN), { recursive: true });
    assert.equal(browserPluginInstalled({ dataDir: dir, ...real }), false, 'a folder without its manifest');
    fs.writeFileSync(path.join(dir, 'plugins', LINKEDIN_BROWSER_PLUGIN, 'manifest.json'), '{}');
    assert.equal(browserPluginInstalled({ dataDir: dir, ...real }), true);
    assert.equal(scannerInstalled({ dataDir: dir, ...real }), false, 'it is no scanner');
    assert.equal(browserPluginInstalled({ dataDir: dir, exists: () => { throw new Error('no'); } }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const main = read('../desktop/main.mjs');
  assert.match(main, /if \(SCANNER_HERE\) openDebuggingPort\(\);/);
  assert.match(main, /PANEL_WANTED = !PANEL_OFF && \(SCANNER_HERE \|\| browserPluginInstalled/);
});

test('browsing starts on LinkedIn’s feed, or the local check’s page in a checkout', () => {
  assert.equal(browseHome(), 'https://www.linkedin.com/feed/');
  assert.equal(browseHome({ testOrigin: 'http://127.0.0.1:61234' }), 'http://127.0.0.1:61234/');
});

test('which profile the panel is on: /in/<slug>, any page under it, decoded and in lower case', () => {
  for (const [url, slug] of [
    ['https://www.linkedin.com/in/someone-invented/', 'someone-invented'],
    ['https://www.linkedin.com/in/Someone-Invented', 'someone-invented'],
    ['https://linkedin.com/in/someone-invented?miniProfileUrn=x#top', 'someone-invented'],
    ['https://uk.linkedin.com/in/someone-invented/details/experience/', 'someone-invented'],
    ['https://www.linkedin.com/in/j%C3%B6rg-invented-12ab/', 'jörg-invented-12ab'],
  ]) assert.equal(panelProfileSlug(url), slug, url);
  for (const url of ['https://www.linkedin.com/feed/', 'https://www.linkedin.com/company/x/', 'https://www.linkedin.com/in/', 'about:blank',
    'https://example.com/in/someone', 'http://www.linkedin.com/in/someone', 'not a url']) {
    assert.equal(panelProfileSlug(url), null, url);
  }
  // The local check's page stands in for LinkedIn only when named.
  assert.equal(panelProfileSlug('http://127.0.0.1:61234/in/ada-invented', { testOrigin: 'http://127.0.0.1:61234' }), 'ada-invented');
  assert.equal(panelProfileSlug('http://127.0.0.1:61234/in/ada-invented'), null);
});
