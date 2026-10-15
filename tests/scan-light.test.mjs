// The scan light (lib/scan-light.js, app/components/ScanLight.js): green,
// yellow or red for what a running scan needs from you, read from the lines
// the scanner prints. Fed the sentences scripts/scrape.py prints, word for
// word as tests/dev-manual-mode.test.mjs and tests/dig-deeper.test.mjs match
// them, with invented people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scanLight, endedLight, isManualRun, lightLabel, liveFill, searchesToday, timeLeft, timeLeftText,
  NO_LIGHT, LIGHT_WORDS, LIGHT_LINGER_MS,
} from '../lib/scan-light.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const NOW = 1_800_000_000_000;
const BUDGET = { searches: 40, cap: 120, profiles: 3, profileCap: 120, lifted: false, dev: false, devCeiling: 250, pace: 'fast' };

/** A running circle scan of Invented Bridge, by hand, with these lines. */
function manual(log, extra = {}) {
  return scanLight({
    known: true, running: true, pending: false, action: 'bridge', target: { id: 'p-1', name: 'Invented Bridge' },
    startedAt: NOW - 300_000, mode: 'manual', pages: 2, found: [10, 10], budget: BUDGET, log, ...extra,
  }, { now: NOW });
}

// The opening, as scrape.py prints it (_scrape_one_bridge, then _read_by_hand).
const OPEN = [
  "  Opening Invented Bridge's profile...",
  '  Opening their connections...',
  '  Search results loaded!',
  '  About 412 results in their list: 42 pages.',
  "  Manual mode: you page through Invented Bridge's list, and each page is read when you reach its foot.",
  "LinkedIn needs you: scroll to the bottom of each page of Invented Bridge's connections in the Chrome window, then click Next. Close the window when you're done with them.",
];
const READ_1 = [
  '  Page 1... 10 found (total: 10)',
  "LinkedIn needs you: page 1 is read (10 people). Click Next, then scroll to the bottom of page 2. Close the window when you're done with Invented Bridge.",
];

// ── By hand: green ───────────────────────────────────────────────────────────

test('by hand, green: the page is read, click Next', () => {
  const l = manual([...OPEN, ...READ_1]);
  assert.equal(l.color, 'green');
  assert.equal(l.mode, 'manual');
  assert.equal(l.headline, 'Click Next to page 2');
  assert.equal(l.detail, "Page 1 is read (10 people). Click Next, then scroll to the bottom of page 2. Close the window when you're done with Invented Bridge.",
    'the detail is the scanner\'s own sentence');
  assert.equal(l.stats.who, 'Invented Bridge');
  assert.equal(l.stats.page, 1);
  assert.equal(l.stats.found, 20, 'people found this run, from the job\'s counts');
  assert.equal(l.stats.foundInList, 10);
  // The page line alone (the needs-you line not in yet) says the same.
  assert.equal(manual([...OPEN, READ_1[0]]).headline, 'Click Next to page 2');
});

test('by hand, green: a page already read says click Next to the one after', () => {
  const l = manual([...OPEN, ...READ_1,
    "LinkedIn needs you: page 1 is already read. Click Next to page 2. Close the window when you're done with Invented Bridge."]);
  assert.equal(l.color, 'green');
  assert.equal(l.headline, 'Click Next to page 2');
});

test('by hand, green: a page read with an earlier one still unread', () => {
  const l = manual([...OPEN, '  Page 10... 10 found (total: 30)',
    "LinkedIn needs you: page 10 is read (10 people). Page 9 isn't read yet, so the next scan starts there again: click back to it, or carry on with Next to page 11. Close the window when you're done with Invented Bridge."]);
  assert.equal(l.color, 'green');
  assert.equal(l.headline, 'Click Next to page 11');
  assert.match(l.detail, /^Page 10 is read \(10 people\)\. Page 9 isn't read yet/);
});

test('by hand, green: a page LinkedIn hides is done with too', () => {
  const l = manual([...OPEN, '  Page 4: LinkedIn hides the 10 people on it ("LinkedIn Member"), so there\'s no one to read there.']);
  assert.equal(l.color, 'green');
  assert.equal(l.headline, 'Click Next to page 5');
});

// ── By hand: yellow ──────────────────────────────────────────────────────────

test('by hand, yellow: scroll to the bottom, from the opening and from the wait note', () => {
  const first = manual(OPEN);
  assert.equal(first.color, 'yellow');
  assert.equal(first.headline, 'Scroll to the bottom of page 1');
  // Carrying on from page 12: the page it opened at.
  const later = manual([OPEN[0], '  Opening their connections at page 12...', ...OPEN.slice(2)]);
  assert.equal(later.headline, 'Scroll to the bottom of page 12');
  // Next clicked, nothing scrolled for a while: the wait note says which page.
  const waiting = manual([...OPEN, ...READ_1, "  (waiting: scroll to the bottom of page 2 and it's read.)"]);
  assert.equal(waiting.color, 'yellow');
  assert.equal(waiting.headline, 'Scroll to the bottom of page 2');
  assert.equal(waiting.detail, "Scroll to the bottom of page 2 and it's read.");
  assert.equal(waiting.stats.page, 2);
});

test('by hand, yellow: Dig deeper asks you to scroll to their Experience, then reads it', () => {
  const ask = manual(["  Opening Invented Bridge's profile...",
    "LinkedIn needs you: scroll down Invented Bridge's profile to their Experience and stop on it a moment; it's read as it shows, then Sixgree opens their list. Not scrolling: it moves on to their list in 45 seconds."]);
  assert.equal(ask.color, 'yellow');
  assert.equal(ask.mode, 'manual', 'the Experience line alone says it is by hand');
  assert.equal(ask.headline, "Scroll down to Invented Bridge's Experience");
  const reading = manual(["LinkedIn needs you: their Experience is being read: scroll through it to the end, and Sixgree opens their list once you're past it."]);
  assert.equal(reading.color, 'yellow');
  assert.equal(reading.headline, 'Their Experience is being read: keep scrolling');
  const none = manual(["  (waiting: no Experience section on Invented Bridge's profile yet; scroll down to it)"]);
  assert.equal(none.color, 'yellow');
  assert.equal(none.headline, "Scroll down to Invented Bridge's Experience");
});

test('by hand, yellow: opening their list, and done with it', () => {
  const opening = manual(["[2/5] Ada Park (A-tier, score 6.2)", "  Opening Ada Park's profile..."]);
  assert.equal(opening.color, 'yellow');
  assert.equal(opening.headline, "Opening Ada Park's list");
  const done = manual([...OPEN, ...READ_1, "  The window was closed: done with Invented Bridge, and what was read is kept.",
    "Manual read done: 1 page of Invented Bridge's list."]);
  assert.equal(done.color, 'yellow');
  assert.equal(done.headline, "Done with Invented Bridge's list");
});

// ── By hand: red ─────────────────────────────────────────────────────────────

test('by hand, red: don\'t click yet, the page is still loading', () => {
  const same = manual([...OPEN, ...READ_1, "  (waiting: page 2 still shows the last page's people. It's read once it changes.)"]);
  assert.equal(same.color, 'red');
  assert.equal(same.headline, 'Wait: page 2 is still loading');
  const empty = manual([...OPEN, "  (waiting: page 1 shows no one yet. It's read once its people show.)"]);
  assert.equal(empty.color, 'red');
  assert.equal(empty.headline, 'Wait: page 1 is still loading');
});

test('by hand, red: go back, to an earlier page or to their list', () => {
  const previous = manual([OPEN[0], '  Opening their connections at page 51...',
    "LinkedIn needs you: LinkedIn's page bar shows page 52, and page 51 isn't read yet. Click Previous to page 51 and scroll to its bottom, then carry on with Next. Close the window when you're done with Invented Bridge."]);
  assert.equal(previous.color, 'red');
  assert.equal(previous.headline, 'Go back to page 51');
  const away = manual([...OPEN, ...READ_1, "  (waiting: the window isn't on Invented Bridge's list. Go back to it to carry on.)"]);
  assert.equal(away.color, 'red');
  assert.equal(away.headline, "Go back to Invented Bridge's list");
});

test('by hand, red: a fresh start opened on page 2 says go back to page 1 (2026-10-14)', () => {
  const l = manual([OPEN[0], '  Opening their connections...', '  Search results loaded!',
    "  LinkedIn's page bar shows page 2, not page 1.",
    "  Manual mode: you page through Invented Bridge's list, and each page is read when you reach its foot.",
    "LinkedIn needs you: LinkedIn's page bar shows page 2, and page 1 isn't read yet. Click Previous to page 1 and scroll to its bottom, then carry on with Next. Close the window when you're done with Invented Bridge."]);
  assert.equal(l.color, 'red');
  assert.equal(l.headline, 'Go back to page 1');
  assert.equal(l.stats.page, 2, 'the window is on page 2');
});

test('pages read before: back to the page still to read (red), or on past them (green)', () => {
  const back = manual([...OPEN,
    "LinkedIn needs you: page 3 is already read, and page 1 isn't read yet. Go back to page 1 and scroll to its bottom. Close the window when you're done with Invented Bridge."]);
  assert.deepEqual([back.color, back.headline, back.stats.page], ['red', 'Go back to page 1', 3]);
  const filled = manual([...OPEN, '  Page 1... 10 found (total: 10)',
    "LinkedIn needs you: page 1 is read (10 people), and pages 2–14 were read before. Go on to page 15. Close the window when you're done with Invented Bridge."]);
  assert.deepEqual([filled.color, filled.headline], ['green', 'Go on to page 15']);
  const past = manual([...OPEN,
    "LinkedIn needs you: page 4 is already read, and so is every page to 14. Go on to page 15. Close the window when you're done with Invented Bridge."]);
  assert.deepEqual([past.color, past.headline], ['green', 'Go on to page 15']);
  // The same, said as the window moves.
  assert.deepEqual(['color', 'headline'].map((k) => manual([...OPEN, '  (on page 5, which is read: go back to page 1)'])[k]), ['red', 'Go back to page 1']);
  assert.deepEqual(['color', 'headline'].map((k) => manual([...OPEN, '  (on page 2, which is read: go on to page 15)'])[k]), ['green', 'Go on to page 15']);
  // Each is a run by hand, whatever mode the job was started in.
  assert.equal(isManualRun({ log: ["LinkedIn needs you: page 4 is already read, and so is every page to 14. Go on to page 15."] }), true);
});

test('by hand, red: their Experience hasn\'t loaded, scroll back up; or its jobs are still loading', () => {
  const up = manual(["LinkedIn needs you: Invented Bridge's Experience hasn't loaded their jobs: LinkedIn loads them only while it's on screen. Scroll back up to Experience and stop there a moment."]);
  assert.equal(up.color, 'red');
  assert.equal(up.headline, 'Scroll back up to their Experience');
  const loading = manual(["  (waiting: Invented Bridge's Experience is on screen and its jobs are still loading)"]);
  assert.equal(loading.color, 'red');
  assert.equal(loading.headline, 'Wait: their jobs are still loading');
});

test('by hand, red: stopped by push-back, a limit, the Dev ceiling or your Stop', () => {
  const cases = [
    ['  LinkedIn is pushing back (the account being restricted). Stopping here.', 'Stopped: LinkedIn pushed back'],
    ["  Today's limit of 120 searches is used \u2014 it counts the last 24 hours. The next run carries on from the same page.", 'Stopped: today\u2019s searches are used'],
    ["  Dev mode's ceiling: 250 search pages a day, reached. Scanning resumes when the oldest of them is a day old, at 14:05. The next run carries on from the same page.", "Stopped at Dev mode's ceiling of 250"],
    ["  LinkedIn's monthly search limit, and nobody on the page to read.", 'Stopped: LinkedIn\u2019s monthly search limit'],
    ['Stopping…', 'Stopping'],
  ];
  for (const [line, headline] of cases) {
    const l = manual([...OPEN, ...READ_1, line]);
    assert.equal(l.color, 'red', line);
    assert.equal(l.headline, headline, line);
  }
});

test('by hand: signing in is yellow, in the scanner\'s words', () => {
  const l = manual(['LinkedIn needs you: sign in to LinkedIn in the Chrome window in front.', '  waiting for sign-in... (15s)']);
  assert.equal(l.color, 'yellow');
  assert.equal(l.headline, 'Sign in to LinkedIn');
  assert.equal(l.detail, 'Sign in to LinkedIn in the Chrome window in front.');
});

// ── By hand: the changes the scanner says at once ────────────────────────────

test('by hand, the moment it changes: on a new page after Next, yellow; never "Click Next" twice', () => {
  const l = manual([...OPEN, ...READ_1, "  (on page 2: scroll to its bottom and it's read)"]);
  assert.equal(l.color, 'yellow');
  assert.equal(l.headline, 'Scroll to the bottom of page 2');
  assert.equal(l.detail, "On page 2: scroll to its bottom and it's read");
  assert.equal(l.stats.page, 2);
  // Back on a page already read: green, the page after it.
  const back = manual([...OPEN, ...READ_1, "  (on page 2: scroll to its bottom and it's read)", '  (on page 1, which is read: click Next to page 2)']);
  assert.equal(back.color, 'green');
  assert.equal(back.headline, 'Click Next to page 2');
});

test('by hand, the moment it changes: a page still showing the last people, red', () => {
  const l = manual([...OPEN, ...READ_1, "  (on page 2: scroll to its bottom and it's read)", '  (page 2 is loading)']);
  assert.equal(l.color, 'red');
  assert.equal(l.headline, 'Wait: page 2 is still loading');
});

test('by hand, the moment it changes: back on their list clears the red "go back"', () => {
  const away = [...OPEN, ...READ_1, "  (on page 2: scroll to its bottom and it's read)",
    "  (waiting: the window isn't on Invented Bridge's list. Go back to it to carry on.)"];
  assert.equal(manual(away).color, 'red');
  const back = manual([...away, '  (back on their list, page 2)']);
  assert.equal(back.color, 'yellow', 'page 2 is not read yet');
  assert.equal(back.headline, 'Scroll to the bottom of page 2');
  // Back on a page that is read: click Next.
  const onRead = manual([...OPEN, ...READ_1, "  (waiting: the window isn't on Invented Bridge's list. Go back to it to carry on.)", '  (back on their list, page 1)']);
  assert.equal(onRead.color, 'green');
  assert.equal(onRead.headline, 'Click Next to page 2');
});

test('by hand, the moment it changes: their Experience showing with no jobs, scrolled past, and back', () => {
  const showing = manual(["  (Invented Bridge's Experience is showing; its jobs are still loading)"]);
  assert.equal(showing.color, 'red');
  assert.equal(showing.headline, 'Wait: their jobs are still loading');
  const above = manual(["  (Invented Bridge's Experience is showing; its jobs are still loading)",
    "  (Invented Bridge's Experience is above: scroll back up to it)"]);
  assert.equal(above.color, 'red');
  assert.equal(above.headline, 'Scroll back up to their Experience');
  const back = manual(["  (Invented Bridge's Experience is above: scroll back up to it)",
    "  (back at Invented Bridge's Experience; its jobs are still loading)"]);
  assert.equal(back.headline, 'Wait: their jobs are still loading');
  // A note it doesn't know leaves the light as it was.
  assert.equal(manual([...OPEN, ...READ_1, '  (their Experience section is in view with 3 entries, but none it can read yet)']).headline, 'Click Next to page 2');
});

// ── By itself: the briefing ──────────────────────────────────────────────────

const AUTO_JOB = {
  known: true, running: true, pending: false, action: 'auto-bridge', target: null, mode: 'auto',
  startedAt: NOW - 600_000, pages: 12, found: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  progress: { kind: 'batch', done: 2, total: 10, current: 3 }, budget: BUDGET,
};
const AUTO_LOG = [
  '[3/10] Ada Park (A-tier, score 6.2)',
  "  Opening Ada Park's profile...",
  '  Opening their connections...',
  '  Search results loaded!',
  '  About 412 results in their list: 42 pages.',
  '  Reading from page 1 until their list ends, saving every 10 pages.',
  '  Page 1...',
  '10 found (total: 10)',
  '  Page 2...',
];
const auto = (log, extra = {}) => scanLight({ ...AUTO_JOB, log, ...extra }, { now: NOW });

test('by itself, green while it reads a page, yellow while it pauses before the next', () => {
  const reading = auto(AUTO_LOG);
  assert.equal(reading.mode, 'auto');
  assert.equal(reading.color, 'green');
  assert.equal(reading.headline, 'Reading page 2');
  const pausing = auto([...AUTO_LOG, '10 found (total: 20)']);
  assert.equal(pausing.color, 'yellow');
  assert.equal(pausing.headline, 'Pausing before page 3');
  const resting = auto([...AUTO_LOG, '10 found (total: 20)', '  10 pages read; resting 80s before the next search.']);
  assert.equal(resting.color, 'yellow');
  assert.match(resting.headline, /^Resting before page 3$/);
  const profile = auto(['[4/10] Grace Hopper (S-tier, score 7.0)', '  Waiting 42s before opening a profile: at least 60s pass between any two.', '    30s to go']);
  assert.equal(profile.color, 'yellow');
  assert.equal(profile.headline, "Waiting to open Grace Hopper's profile");
  assert.equal(profile.stats.wait, '30s', 'the countdown\'s time left');
});

test('by itself, the briefing: whose circle, page N of about M, found, the ring, searches, time left', () => {
  const l = auto([...AUTO_LOG, '10 found (total: 20)']);
  const s = l.stats;
  assert.equal(s.who, 'Ada Park');
  assert.deepEqual(s.batch, { current: 3, total: 10 });
  assert.equal(s.page, 2);
  assert.equal(s.lastRead, 2);
  assert.equal(s.pages, 42, 'about 42 pages, as LinkedIn counted them');
  assert.equal(s.about, 412);
  assert.equal(s.found, 120, 'people found this run');
  assert.deepEqual(s.searches, { used: 40, limit: 120, left: 80, lifted: false, dev: false });
  // The ring as lib/reach.js scanFill draws it: 20 of 412 read.
  assert.ok(Math.abs(s.fill.read - 20 / 412) < 1e-9);
  assert.equal(s.fill.words, 'about 20 of 412 scanned, about 392 to go');
  // 40 pages left at this run's own pace: 600 s over 12 pages, 50 s a page.
  assert.equal(s.secondsLeft, 40 * 50);
  assert.equal(timeLeftText(s.secondsLeft), 'about 33 min left');
});

test('by itself, red: stopped by push-back, a limit, or the page cap', () => {
  const pushed = auto([...AUTO_LOG, '', '  LinkedIn is pushing back (a security check). Stopping here.']);
  assert.equal(pushed.color, 'red');
  assert.equal(pushed.stats.secondsLeft, null, 'stopped: no time left to give');
  const limit = auto([...AUTO_LOG, "LinkedIn's monthly search limit, and nobody on the page to read."]);
  assert.equal(limit.color, 'red');
  assert.equal(limit.headline, 'Stopped: LinkedIn\u2019s monthly search limit');
  const cap = auto([...AUTO_LOG, '10 found (total: 20)', '  Stopped at the 10-page limit, and LinkedIn has more. Pick more pages to read on.']);
  assert.equal(cap.color, 'red');
  assert.equal(cap.headline, 'Stopped at the 10-page limit');
  // The next person in the batch: going again.
  assert.equal(auto([...AUTO_LOG, '  Stopped at the 10-page limit, and LinkedIn has more.', '[4/10] Grace Hopper (S-tier, score 7.0)']).color, 'green');
});

test('Auto scan between sittings: yellow, saying until when; nothing at all when it is off', () => {
  const until = NOW + 25 * 60_000;
  const l = scanLight({ known: true, running: false, pending: false, log: [], budget: null, auto: { on: true, phase: 'rest', until, sittings: 2 } }, { now: NOW });
  assert.equal(l.color, 'yellow');
  assert.equal(l.mode, 'auto');
  assert.match(l.headline, /^Auto scan: resting until \d\d:\d\d$/);
  assert.equal(l.stats.secondsLeft, 25 * 60);
  assert.equal(scanLight({ running: false, auto: { on: false, phase: 'off' } }), NO_LIGHT);
});

// ── Nothing running, and the end ─────────────────────────────────────────────

test('no scan running: no light; nor for setting the scanner up', () => {
  assert.equal(scanLight(null), NO_LIGHT);
  assert.equal(scanLight({ known: true, running: false, log: [] }).color, null);
  assert.equal(scanLight({ known: true, running: true, pending: true, action: 'bridge', log: [] }).color, null, 'not until the scanner has taken it');
  assert.equal(scanLight({ known: true, running: true, action: 'setup', log: ['Downloading Python 3.12.14: 12.0 of 24.0 MB'] }).color, null);
  assert.equal(scanLight({ known: true, running: true, action: 'install', log: [] }).color, null);
});

test('just ended: how it ended, for a short while', () => {
  const last = manual([...OPEN, ...READ_1]);
  assert.deepEqual(
    (({ color, headline, ended, mode }) => ({ color, headline, ended, mode }))(endedLight({ action: 'bridge', startedAt: 1, exitCode: 0, exitKind: 'ok' }, last)),
    { color: 'green', headline: 'Finished', ended: true, mode: 'manual' });
  const stopped = endedLight({ action: 'bridge', exitCode: 0, exitKind: 'stopped' }, manual([...OPEN, ...READ_1]));
  assert.equal(stopped.color, 'red');
  assert.match(stopped.detail, /^What was read is saved, and Resume/, 'not the last instruction, which is over');
  assert.equal(lightLabel(stopped), 'Red: Stopped');
  assert.equal(endedLight({ action: 'bridge', exitCode: 0, exitKind: 'limit' }).headline, 'Stopped at today\u2019s limit');
  assert.equal(endedLight({ action: 'bridge', exitCode: 10, exitKind: 'pushback' }).headline, 'Stopped: LinkedIn pushed back');
  assert.equal(endedLight({ action: 'bridge', exitCode: 1, exitKind: 'error', failure: ['Traceback…', 'It went wrong.'] }).detail, 'It went wrong.');
  assert.equal(endedLight({ action: 'setup', exitCode: 0, exitKind: 'ok' }), NO_LIGHT);
  assert.ok(LIGHT_LINGER_MS >= 5000 && LIGHT_LINGER_MS <= 60000);
});

// ── Smaller pieces ───────────────────────────────────────────────────────────

test('manual or automatic: the run\'s own lines first, else the mode it was started in', () => {
  assert.equal(isManualRun({ action: 'bridge', mode: 'auto', log: OPEN }), true, 'its lines say so');
  assert.equal(isManualRun({ action: 'bridge', mode: 'manual', log: [] }), true);
  assert.equal(isManualRun({ action: 'bridge', mode: 'auto', log: AUTO_LOG }), false);
  assert.equal(isManualRun({ action: 'full', mode: 'manual', log: [] }), false, 'only circle scans are read by hand');
});

test('the light in words, never by colour alone', () => {
  assert.equal(lightLabel(manual([...OPEN, ...READ_1])), 'Green, go ahead: Click Next to page 2');
  assert.equal(lightLabel(NO_LIGHT), 'No scan running');
  assert.deepEqual(Object.keys(LIGHT_WORDS), ['green', 'yellow', 'red']);
  assert.equal(new Set(Object.values(LIGHT_WORDS).map((w) => w.shape)).size, 3, 'a shape of its own for each colour');
});

test('today\'s searches: the daily limit, Dev mode\'s ceiling, or none while lifted', () => {
  assert.deepEqual(searchesToday(BUDGET), { used: 40, limit: 120, left: 80, lifted: false, dev: false });
  assert.deepEqual(searchesToday({ ...BUDGET, dev: true, lifted: true, searches: 300 }), { used: 300, limit: 250, left: 0, lifted: true, dev: true });
  assert.deepEqual(searchesToday({ ...BUDGET, lifted: true }), { used: 40, limit: null, left: null, lifted: true, dev: false });
  assert.equal(searchesToday(null), null);
});

test('the ring and the time left: nothing claimed before there is something to go by', () => {
  assert.equal(liveFill(0, 412), null);
  assert.equal(liveFill(3, null).words, 'about 30 of their connections scanned so far; how many they have isn\'t known yet');
  assert.equal(timeLeft({ page: 3, pages: null }), null, 'no length, no estimate');
  assert.equal(timeLeft({ page: 42, pages: 42 }), 0);
  assert.equal(timeLeftText(0), 'this is the last page');
  // Never quicker than the speed's wait before each page (fast: 20 s, and 6 s to read it).
  assert.equal(timeLeft({ page: 10, pages: 20, startedAt: NOW - 10_000, pagesRead: 10, pace: 'fast', now: NOW }), 10 * 26);
  // Before two pages are in, the speed's own average (lib/scan-pace.js pageSeconds).
  assert.ok(timeLeft({ page: 1, pages: 3, startedAt: NOW, pagesRead: 1, pace: 'fast', now: NOW }) > 0);
});

// ── The header ───────────────────────────────────────────────────────────────

test('the header shows the light only for your own network with a scanner, and the light only while there is one to show', () => {
  const header = read('../app/components/AppHeader.js');
  assert.match(header, /import ScanLight from '\.\/ScanLight';/);
  assert.match(header, /\{own && shows\.scan && <ScanLight isMobile=\{isMobile\} \/>\}/);
  // Top right: before Settings, in the buttons on the right.
  assert.ok(header.indexOf('<ScanLight') > -1 && header.indexOf('<ScanLight') < header.indexOf('<SettingsGear'));
  const light = read('../app/components/ScanLight.js');
  // Nothing drawn without a colour: no scan, and the moment after one has gone.
  assert.match(light, /if \(!color\) return null;/);
  assert.match(light, /const light = live\.color \? live : seen\.ending;/);
  // It reads the answer every Scan button shares, and asks nothing of its own.
  assert.match(light, /const job = useScanner\(\);/);
  assert.doesNotMatch(light, /setInterval|fetch\(/);
  // Its words for a screen reader, and the pulse only without Reduce Motion.
  assert.match(light, /aria-label=\{`Scan light\. \$\{label\}/);
  assert.match(light, /@media \(prefers-reduced-motion: no-preference\) \{\n {2}\.scan-light-ring\.is-new-green/);
  // The pulse only by hand: by itself it turns green at every page, and asks nothing of you.
  assert.match(light, /pulse: color === 'green' && light\.mode === 'manual' &&/);
  assert.match(light, /const pulsing = color === 'green' && manual && seen\.pulse > 0;/);
  // Esc and a click outside close the panel; Stop is the stop every scan has.
  assert.match(light, /e\.key !== 'Escape'/);
  assert.match(light, /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.match(light, /await stopScrape\(\)/);
});
