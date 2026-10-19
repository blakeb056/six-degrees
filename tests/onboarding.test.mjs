// The guided setup's steps (lib/onboarding.js), from every state GET
// /api/scraper can report: which step someone new is on, which one someone who
// left halfway comes back to, and each step's live status. No browser, no
// scanner. Invented counts only.
//
// The app carries no scanner now (Blake, 2026-10-14): the scanner's steps
// follow the CSV import, and only with a scanner plugin installed. Their order
// follows which one (no Pace with Manual scan alone), and the first scan maps
// one person's circle, three pages of it, not your own connections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STEPS, STEP_LABELS, SETUP_KEY, onboardingStep, opensSetup, setupMode, setupLeftAt, readyChecks, connectState, firstScan, followedScan,
  photosNote, readSetupMemory, rememberSetup, canOpen, here, scannerKind, afterImport, pacesFor, stepsFor, stepAfter, stepBefore,
  stepEyebrow, asksField, fieldMoment, firstScanOffer, scanWithoutCsv, FIRST_SCAN_PAGES, FIRST_SCAN_ACTION, WALK_ACTION,
} from '../lib/onboarding.js';
import { capabilities, SCANNER_NONE, SCANNER_BUILT_IN } from '../lib/scanner-capabilities.js';
import { statusWithJob } from '../lib/scraper-client.js';

const NOTHING = { first: 0, second: 0, third: 0 };
// The people a CSV import put in: the scanner's steps come after them.
const PEOPLE = { ...NOTHING, first: 300 };
const MAC_APP = { scriptsFound: true, chrome: true, dependencies: true, pythonSource: 'bundled', mac: { version: 26, app: true } };
const status = (checks = {}, extra = {}) => ({ checks: { ...MAC_APP, riskAccepted: false, signedIn: false, ...checks }, running: false, network: NOTHING, log: [], ...extra });
const withPeople = (checks = {}, extra = {}) => status(checks, { network: PEOPLE, ...extra });

const AUTO = capabilities({ auto: true, from: 'plugin' });
const MANUAL = capabilities({ manual: true, from: 'plugin' });
const BOTH = capabilities({ auto: true, manual: true, from: 'plugin' });

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the five steps, in order, the last one the first scan', () => {
  assert.deepEqual([...STEPS], ['welcome', 'ready', 'connect', 'pace', 'map']);
  assert.equal(STEP_LABELS.map, 'First scan');
});

test('a new install opens on Welcome, and nothing at all until the scanner has answered', () => {
  assert.equal(onboardingStep(null), null);
  assert.equal(onboardingStep(status()), 'welcome');
  assert.equal(onboardingStep(status(), { started: false }), 'welcome');
});

// The welcome screen itself (app/components/onboarding/steps.js), read as text.
test('Welcome recommends the CSV import and has it chosen; scanning is no longer one of its choices', () => {
  const src = read('../app/components/onboarding/steps.js');
  const welcome = src.slice(src.indexOf('export function Welcome'), src.indexOf('export function GetReady'));
  assert.match(welcome, /useState\('csv'\)/, 'its button as it opens imports a CSV');
  const at = (key) => welcome.indexOf(`option('${key}'`);
  assert.ok(at('csv') > 0 && at('csv') < at('sample'), 'CSV first, then the sample');
  assert.match(welcome.slice(at('csv'), at('sample')), /tag: 'Recommended'/);
  // Behaviour changed on purpose (Blake, 2026-10-14): the built-in scanner's leftover is gone.
  assert.equal(at('scan'), -1, 'no "Scan my network" choice');
  assert.doesNotMatch(welcome, /Scan my network|ctx\.start\(/);
  // "Bring your saved copy" stays.
  assert.match(welcome, /Bring your saved copy/);
});

// ── Which scanner is installed decides the steps ─────────────────────────────

test('which scanner: none, auto, manual or both; the built-in one is both, and no answer is none', () => {
  assert.equal(scannerKind(SCANNER_NONE), 'none');
  assert.equal(scannerKind(null), 'none');
  assert.equal(scannerKind({ nonsense: true }), 'none');
  assert.equal(scannerKind(AUTO), 'auto');
  assert.equal(scannerKind(MANUAL), 'manual');
  assert.equal(scannerKind(BOTH), 'both');
  assert.equal(scannerKind(SCANNER_BUILT_IN), 'both');
});

test('after the CSV import: no scanner goes into the app; auto, manual or both offer Set up scanning first', () => {
  assert.equal(afterImport(SCANNER_NONE), 'galaxy');
  assert.equal(afterImport(null), 'galaxy');
  assert.equal(afterImport(AUTO), 'ready');
  assert.equal(afterImport(MANUAL), 'ready');
  assert.equal(afterImport(BOTH), 'ready');
});

test('Pace is left out with Manual scan alone, and only then', () => {
  assert.equal(pacesFor(MANUAL), false);
  for (const caps of [AUTO, BOTH, SCANNER_BUILT_IN]) assert.equal(pacesFor(caps), true);
  assert.deepEqual(stepsFor(MANUAL), ['welcome', 'ready', 'connect', 'map']);
  assert.deepEqual(stepsFor(AUTO), ['welcome', 'ready', 'connect', 'pace', 'map']);
  assert.deepEqual(stepsFor(BOTH), ['welcome', 'ready', 'connect', 'pace', 'map']);
  // Continue from Connect, and Back from the first scan, go round it.
  assert.equal(stepAfter('connect', MANUAL), 'map');
  assert.equal(stepAfter('connect', AUTO), 'pace');
  assert.equal(stepAfter('pace', AUTO), 'map');
  assert.equal(stepAfter('ready', MANUAL), 'connect');
  assert.equal(stepAfter('map', AUTO), null);
  assert.equal(stepBefore('map', MANUAL), 'connect');
  assert.equal(stepBefore('map', BOTH), 'pace');
  assert.equal(stepBefore('welcome', AUTO), null);
  // The line above each title counts the steps there are.
  assert.equal(stepEyebrow('map', MANUAL), 'Step 4 of 4 · First scan');
  assert.equal(stepEyebrow('map', AUTO), 'Step 5 of 5 · First scan');
  assert.equal(stepEyebrow('ready', MANUAL), 'Step 2 of 4 · Get ready');
  // Someone who left on Connect with Manual scan alone comes back past Pace, to the first scan.
  const signedIn = withPeople({ riskAccepted: true, signedIn: true });
  assert.equal(onboardingStep({ ...signedIn, capabilities: MANUAL }, { started: true }), 'map');
  assert.equal(onboardingStep({ ...signedIn, capabilities: AUTO }, { started: true }), 'pace');
  assert.equal(onboardingStep({ ...signedIn, capabilities: AUTO }, { started: true, paced: true }), 'map');
});

// ── Where someone is ─────────────────────────────────────────────────────────

test('set up scanning: Get ready until Chrome, the scanner and "I understand" are all there', () => {
  const started = { started: true };
  assert.equal(onboardingStep(withPeople(), started), 'ready');
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, chrome: false }), started), 'ready');
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, dependencies: false, pythonSource: null }), started), 'ready');
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, scriptsFound: false }), started), 'ready');
  assert.equal(onboardingStep(withPeople({ riskAccepted: true }), started), 'connect');
});

test('with nobody yet and no scanner, Welcome, however far an earlier setup got; with a scanner, no CSV is needed', () => {
  // Behaviour changed on purpose: scanning used to start from Welcome's own choice, with the built-in scanner.
  assert.equal(onboardingStep(status({ riskAccepted: true, scriptsFound: false }), { started: true }), 'welcome');
  assert.equal(onboardingStep({ ...status({ riskAccepted: true, signedIn: true }), capabilities: SCANNER_NONE }, { started: true, paced: true }), 'welcome');
  // The CSV is recommended, never a gate (Blake, 2026-10-14): a scanner and nobody yet still sets up.
  assert.equal(onboardingStep({ ...status({ riskAccepted: true }), capabilities: AUTO }, { started: true }), 'connect');
  assert.equal(onboardingStep({ ...status({ riskAccepted: true, signedIn: true }), capabilities: MANUAL }, { started: true }), 'map');
  // Not chosen yet: Welcome.
  assert.equal(onboardingStep({ ...status(), capabilities: AUTO }), 'welcome');
});

test('without App Management\'s gate passed in, Get ready is the scanner\'s checks alone', () => {
  // The gate (macOS's answer) is tested in tests/onboarding-app-management.test.mjs.
  assert.equal(onboardingStep(withPeople({ riskAccepted: true }), { started: true }), 'connect');
});

test('someone who left halfway lands back on their step, whatever this browser remembers', () => {
  // Your people in and nothing chosen yet: Welcome (the CSV's result offers Set up scanning).
  assert.equal(onboardingStep(withPeople()), 'welcome');
  // "I understand" given (or a scan before it, which the server counts the same): past Welcome.
  assert.equal(onboardingStep(withPeople({ riskAccepted: true })), 'connect');
  // Signed in: Set your pace, then the first scan once that's been seen.
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, signedIn: true })), 'pace');
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, signedIn: true }), { paced: true }), 'map');
  // A circle scan reading: the first scan, where its progress is, whatever else.
  assert.equal(onboardingStep(withPeople({}, { running: true, action: 'bridge', startedAt: 5 })), 'map');
  // Signed out since (a deleted Chrome profile): back to Connect.
  assert.equal(onboardingStep(withPeople({ riskAccepted: true, signedIn: false }), { started: true, paced: true }), 'connect');
});

test('Get ready: Chrome, the scanner and "I understand", each on its own', () => {
  const r = readyChecks(status({ riskAccepted: true }));
  assert.equal(r.chrome, true);
  assert.equal(r.scanner.done, true);
  assert.equal(r.scanner.bundled, true);
  assert.equal(r.scanner.plugin, null);
  assert.equal(r.risk, true);
  assert.equal(r.done, true);
  // No Chrome: its own row says so; the scanner's row doesn't repeat it.
  const noChrome = readyChecks(status({ chrome: false }));
  assert.equal(noChrome.chrome, false);
  assert.equal(noChrome.scanner.done, true);
  assert.doesNotMatch(noChrome.scanner.text, /Chrome/);
  assert.equal(noChrome.done, false);
  // A scanner to install: setupStep's words and button (lib/scanner-setup.js).
  const install = readyChecks(status({ dependencies: false, pythonSource: null, installFrom: { source: 'system', version: '3.12.3' } }));
  assert.equal(install.scanner.done, false);
  assert.equal(install.scanner.button.action, 'install');
  // An older server that doesn't say: Chrome unknown, the "I understand" counted as given.
  const older = readyChecks({ checks: { scriptsFound: true, dependencies: true }, running: false });
  assert.equal(older.chrome, null);
  assert.equal(older.risk, true);
  assert.equal(older.done, true);
});

test('Get ready names the plugin a scanner came from, and says when none is installed', () => {
  const plugin = { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' };
  const r = readyChecks(status({ riskAccepted: true, scanner: { from: 'plugin', plugin } }));
  assert.deepEqual(r.scanner.plugin, plugin);
  assert.equal(r.done, true);
  const none = readyChecks(status({ riskAccepted: true, scriptsFound: false, scanner: { from: null, plugin: null } }));
  assert.equal(none.scanner.missing, true);
  assert.equal(none.scanner.done, false);
  assert.equal(none.done, false);
});

test('with no scanner, the setup and the Scan page say to install a plugin, not to download the app again', () => {
  // Behaviour changed on purpose: a shipped copy carries no scanner, so "download it again" can't help.
  for (const rel of ['../app/components/onboarding/steps.js', '../app/setup/page.js']) {
    const src = read(rel);
    assert.doesNotMatch(src, /Download it again/, rel);
    assert.doesNotMatch(src, /missing part of its scanner/, rel);
    assert.match(src, /Install Auto scan or Manual scan[\s\S]{0,120}Settings → Plugins/, rel);
  }
  // In the setup, a button back to the plugin cards under the CSV.
  const steps = read('../app/components/onboarding/steps.js');
  const getReady = steps.slice(steps.indexOf('export function GetReady'), steps.indexOf('export function Connect'));
  assert.match(getReady, /onClick=\{ctx\.openPlugins\}>Show the plugins</);
  // A scanner installed there turns the CSV's result into Set up scanning without a reload.
  assert.match(read('../app/components/onboarding/Onboarding.js'), /pluginsChanged: \(\) => \{ askScannerAgain\(\); scan\.poll\(\); \}/);
});

test('the CSV\'s result: Set up scanning and Skip with a scanner, See your galaxy without', () => {
  const steps = read('../app/components/onboarding/steps.js');
  const done = steps.slice(steps.indexOf('function ImportDone'), steps.indexOf('export function ImportCsv'));
  assert.match(done, /afterImport\(ctx\.caps\) === 'ready'/);
  assert.match(done, /Skip, see your galaxy/);
  assert.match(done, /Set up scanning/);
  assert.match(done, /'See your galaxy'/);
  // The plugin cards are there too while no scanner is installed.
  assert.match(done, /ctx\.kind === 'none'/);
  assert.match(done, /<OtherWays /);
});

test('Connect: waiting while the sign-in window is open, Connected from the scanner\'s own note', () => {
  assert.equal(connectState(status()), 'idle');
  assert.equal(connectState(status({}, { running: true, action: 'login' })), 'waiting');
  assert.equal(connectState(status({ signedIn: true }, { running: true, action: 'login' })), 'connected');
  assert.equal(connectState(status({ signedIn: true })), 'connected');
  // The window closed (or the wait ran out) before a sign-in.
  assert.equal(connectState(status({}, { action: 'login', exitCode: 1 })), 'closed');
  // A sign-in that went through, or one stopped by Stop (exit 0): not "closed".
  assert.equal(connectState(status({}, { action: 'login', exitCode: 0 })), 'idle');
  // Another job's failure isn't the sign-in's.
  assert.equal(connectState(status({}, { action: 'full', exitCode: 1 })), 'idle');
});

// ── The first scan: one person's circle, three pages ─────────────────────────

const ADA = { id: 'p-ada', name: 'Ada Quill' };
const circle = (extra = {}) => withPeople({ riskAccepted: true, signedIn: true }, {
  running: true, action: 'bridge', target: ADA, startedAt: 7000, pages: 0, found: [], log: ['Mapping the circle behind Ada Quill…'], ...extra,
});
const told = (recent, extra = {}) => ({ known: true, running: false, pending: false, action: null, startedAt: null, recent, ...extra });
const ended = (extra = {}) => circle({ running: false, exitCode: 0, exitKind: 'ok', log: ['Mapping the circle behind Ada Quill…', '  That\'s the 3 pages this scan reads.', 'Finished.'], ...extra });

test('the first scan is three pages of one circle, by id, as every Scan button sends one', () => {
  assert.equal(FIRST_SCAN_PAGES, 3);
  assert.equal(FIRST_SCAN_ACTION, 'bridge');
  // The setup starts it with the cap, the person's id and name (Onboarding.js startFirstScan).
  const src = read('../app/components/onboarding/Onboarding.js');
  assert.match(src, /scan\.run\(FIRST_SCAN_ACTION, \{ id: person\.id, name: person\.name, maxPages: FIRST_SCAN_PAGES \}\)/);
  // Never the walk of your own connections, which reads the people the CSV brought.
  assert.doesNotMatch(read('../app/components/onboarding/steps.js'), /scan\.run\('full'\)/);
  // Later, from the Scan tab, is always there.
  assert.match(read('../app/components/onboarding/steps.js'), /Later, from the Scan tab/);
});

test('the first scan: reading pages and the people on them, then done', () => {
  const IDLE = { state: 'idle', kind: 'circle', pages: 0, of: 3, found: 0, done: null, total: null, who: null, hidden: false, failure: null };
  assert.deepEqual(firstScan(withPeople()), IDLE);
  const reading = circle({ pages: 2, found: [10, 9] });
  assert.deepEqual(firstScan(reading, 7000), { ...IDLE, state: 'running', pages: 2, found: 19, who: 'Ada Quill' });
  // Opened while one runs, with nothing watched yet: it is the first scan.
  assert.equal(firstScan(reading, null).state, 'running');
  // Ended: done, with whose circle it was.
  assert.deepEqual(firstScan(ended({ network: { ...PEOPLE, second: 29 } }), 7000), { ...IDLE, state: 'done', who: 'Ada Quill' });
  // At today's limit, or stopped: a calm end, everything read is kept.
  assert.equal(firstScan(ended({ log: ['Stopped at today’s limit.'] }), 7000).state, 'done');
  assert.equal(firstScan(ended({ log: ['Stopped at a limit.'] }), 7000).state, 'done', 'the scan window, 2026-10-17');
  assert.equal(firstScan(ended({ exitCode: null, exitKind: 'stopped', log: ['Stopped.'] }), 7000).state, 'done');
  // Nothing watched: an old circle scan's end is never the setup's.
  assert.equal(firstScan(ended(), null).state, 'idle');
  assert.equal(firstScan(ended(), 6000).state, 'idle');
});

test('a first scan that stopped with a reason says why, to try again', () => {
  const failed = ended({ exitCode: 13, exitKind: 'signed-out', failure: ['LinkedIn isn\'t signed in, so nothing was read.'], log: ['Stopped: LinkedIn isn’t signed in.'] });
  assert.equal(firstScan(failed, 7000).state, 'failed');
  assert.equal(firstScan(failed, 7000).who, 'Ada Quill');
  assert.equal(firstScan(failed, 7000).failure, 'LinkedIn isn\'t signed in, so nothing was read.');
  // Ended by a crash, with no code to go by.
  assert.equal(firstScan(ended({ exitCode: null, exitKind: 'error', failure: null }), 7000).state, 'failed');
});

test('a list that was hidden, or a read with nobody in it, isn\'t "Your galaxy is ready"', () => {
  const hidden = ended({ log: ['  Their connections are hidden — noted, and skipped from now on.', 'Done! No connections found (private).', 'Finished.'] });
  assert.equal(firstScan(hidden, 7000).state, 'empty');
  assert.equal(firstScan(hidden, 7000).hidden, true);
  assert.equal(firstScan(hidden, 7000).who, 'Ada Quill');
  const nobody = ended({ log: ['Manual read done: 0 pages of Ada Quill\'s list.', 'Done! No connections found (closed).', 'Finished.'] });
  assert.equal(firstScan(nobody, 7000).state, 'empty');
  assert.equal(firstScan(nobody, 7000).hidden, false);
});

// Blake, 2026-10-05, 1.2.0: the setup once sat on "fetching photos" for
// minutes after a scan had ended. The end comes from the same job answer the
// notch reads, and "Your galaxy is ready" waits the moment it takes the rest
// of the status (the people saved) to catch up, never longer.
test('the end shows the moment the job answer has seen it, and the galaxy waits only for the people saved', () => {
  const s = circle({ pages: 3, found: [10, 10, 9] });
  // The job answer has seen it end; the slower status still has the running log.
  const now = statusWithJob(s, told([{ action: 'bridge', target: ADA, startedAt: 7000, exitCode: 0, exitKind: 'ok', failure: null }]));
  assert.equal(now.running, false);
  assert.equal(now.exitKind, 'ok', 'how it ended travels with it');
  assert.equal(firstScan(now, 7000).state, 'saving');
  // The status catches up, its log ending as the app ends a job: done.
  assert.equal(firstScan(ended(), 7000).state, 'done');
  // Stopped: the job answer says so in words, and it is a calm end.
  const stopped = statusWithJob(s, told([{ action: 'bridge', startedAt: 7000, exitCode: null, exitKind: 'stopped', failure: null }]));
  assert.equal(stopped.exitKind, 'stopped');
  assert.notEqual(firstScan(stopped, 7000).state, 'failed');
  // The job answer is older than the status (it hasn't seen this job yet): still running.
  assert.equal(firstScan(statusWithJob(s, told([])), 7000).state, 'running');
});

test('a job that starts right after the first scan doesn\'t hold "Your galaxy is ready" back', () => {
  // The queue's next circle, someone else's: the first scan's own end is in `recent`.
  const next = circle({ target: { id: 'p-bo', name: 'Bo Lindqvist' }, startedAt: 9000, recent: [{ action: 'bridge', target: ADA, startedAt: 7000, exitCode: 0, exitKind: 'ok' }] });
  assert.equal(firstScan(next, 7000).state, 'done');
  // And it's never watched in the first scan's place.
  assert.equal(followedScan(7000, next, 'p-ada'), 7000);
});

test('which scan the setup watches: the one it started, for whom it started it', () => {
  assert.equal(followedScan(null, withPeople()), null);
  // Started here for Ada: hers, once it runs.
  assert.equal(followedScan(null, circle(), 'p-ada'), 7000);
  // Not yet running (the start is on its way, no startedAt): nothing yet.
  assert.equal(followedScan(null, circle({ startedAt: null }), 'p-ada'), null);
  // Try again, or someone else: the new one is watched in its place.
  assert.equal(followedScan(7000, circle({ startedAt: 9000 }), 'p-ada'), 9000);
  assert.equal(followedScan(7000, circle({ startedAt: 9000, target: { id: 'p-bo', name: 'Bo' } }), 'p-bo'), 9000);
  // Ended: kept.
  assert.equal(followedScan(7000, ended(), 'p-ada'), 7000);
  // Opened while one runs, nothing started here: that one.
  assert.equal(followedScan(null, circle()), 7000);
  // Not a circle scan: nothing to watch.
  assert.equal(followedScan(null, circle({ action: 'refresh' }), 'p-ada'), null);
});

test('your field is asked while the first scan reads, once, for anyone who hasn\'t picked or skipped it', () => {
  assert.equal(asksField({ fieldAsked: false }), true);
  assert.equal(asksField({ fieldAsked: true }), false);
  assert.equal(asksField({ sectorFocus: { sectors: ['software'] } }), false);
  // Settings not known yet, or unreadable: not asked.
  assert.equal(asksField(undefined), false);
  assert.equal(asksField(null), false);
});

// ── Without a CSV (Blake, 2026-10-14: the CSV is recommended, never a gate) ──

test('which first scan, for every path: CSV with either scanner, no CSV with auto, no CSV with manual only, nothing installed', () => {
  const withCaps = (caps, network) => ({ ...status({ riskAccepted: true, signedIn: true }), network, capabilities: caps });
  // A CSV (or people from before), with either scanner, or both: one person's circle.
  for (const caps of [AUTO, MANUAL, BOTH]) assert.equal(firstScanOffer(withCaps(caps, PEOPLE)), 'circle');
  // No CSV, with Auto scan: the walk of your own connections.
  assert.equal(firstScanOffer(withCaps(AUTO, NOTHING)), 'walk');
  assert.equal(firstScanOffer(withCaps(BOTH, NOTHING)), 'walk');
  // No CSV, with Manual scan alone: it can't bring the people you know in; the setup says how.
  assert.equal(firstScanOffer(withCaps(MANUAL, NOTHING)), 'needs-people');
  // Nothing installed: no scan to offer.
  assert.equal(firstScanOffer(withCaps(SCANNER_NONE, NOTHING)), 'none');
  assert.equal(firstScanOffer(withCaps(SCANNER_NONE, PEOPLE)), 'none');
  // The CSV step's second way forward, once a scanner is installed.
  assert.equal(scanWithoutCsv(SCANNER_NONE), false);
  assert.equal(scanWithoutCsv(null), false);
  for (const caps of [AUTO, MANUAL, BOTH]) assert.equal(scanWithoutCsv(caps), true);
});

const walk = (extra = {}) => status({ riskAccepted: true, signedIn: true }, {
  running: true, action: 'full', startedAt: 8000, network: NOTHING, log: ['Scanning your whole network…'], ...extra,
});

test('the walk without a CSV: reading, saving, then done with the people saved, however it ended', () => {
  assert.equal(WALK_ACTION, 'full');
  assert.deepEqual(firstScan(walk(), 8000), {
    state: 'running', kind: 'walk', pages: 0, of: 3, found: 0, done: null, total: null, who: null, hidden: false, failure: null,
  });
  const reading = firstScan(walk({ progress: { done: 350, total: 817, kind: 'walk' } }), 8000);
  assert.deepEqual([reading.state, reading.done, reading.total], ['running', 350, 817]);
  assert.equal(firstScan(walk({ progress: { kind: 'saving' } }), 8000).state, 'saving');
  // Ended with people saved: done, even when the photos at its end failed.
  for (const exitCode of [0, 1]) {
    const end = firstScan(walk({ running: false, exitCode, network: { ...NOTHING, first: 748 }, log: ['Finished.'] }), 8000);
    assert.deepEqual([end.state, end.kind, end.done], ['done', 'walk', 748], `exit ${exitCode}`);
  }
  // Ended with nobody saved, with a reason: failed, to try again or import a CSV.
  const failed = firstScan(walk({ running: false, exitCode: 13, exitKind: 'signed-out', failure: ['Not signed in.'], log: ['Stopped: LinkedIn isn’t signed in.'] }), 8000);
  assert.deepEqual([failed.state, failed.failure], ['failed', 'Not signed in.']);
  // The setup opened on it while it ran: the first scan step.
  assert.equal(onboardingStep({ ...walk(), capabilities: AUTO }), 'map');
  assert.equal(onboardingStep({ ...walk({ progress: { kind: 'saving' } }), capabilities: AUTO }), 'map');
});

test('which walk the setup watches: the one it started, and the field question once the platform says how many', () => {
  assert.equal(followedScan(null, walk(), WALK_ACTION), 8000);
  assert.equal(followedScan(null, walk(), 'p-ada'), null, 'a circle was started here, not this');
  assert.equal(followedScan(8000, walk({ startedAt: 9000 }), WALK_ACTION), 9000, 'Try again');
  assert.equal(fieldMoment(firstScan(walk(), 8000)), false, 'not while Chrome opens');
  assert.equal(fieldMoment(firstScan(walk({ progress: { done: 0, total: 817, kind: 'walk' } }), 8000)), true);
  assert.equal(fieldMoment(firstScan(walk({ progress: { kind: 'saving' } }), 8000)), true);
  assert.equal(fieldMoment(firstScan(circle(), 7000)), false, 'a circle: not before a page is read');
  assert.equal(fieldMoment(firstScan(circle({ pages: 1, found: [10] }), 7000)), true);
});

test('the screens: Continue without a CSV, the walk, and Manual scan alone saying how to bring people in', () => {
  const steps = read('../app/components/onboarding/steps.js');
  const pick = steps.slice(steps.indexOf('export function ImportCsv'), steps.indexOf('// ── Other ways to bring in your network'));
  assert.match(pick, /scanWithoutCsv\(ctx\.caps\) && \(/);
  assert.match(pick, /Continue without a CSV: set up scanning/);
  assert.match(pick, /<Primary onClick=\{pick\}/, 'the CSV stays the primary button');
  const first = steps.slice(steps.indexOf('export function FirstScan'), steps.indexOf('function FirstCircle'));
  assert.match(first, /ctx\.offer === 'walk'\) return <FirstWalk/);
  assert.match(first, /ctx\.offer === 'needs-people'/);
  const walkUi = steps.slice(steps.indexOf('function FirstWalk'), steps.indexOf('function NeedsPeople'));
  assert.match(walkUi, /onClick=\{ctx\.startWalk\}/);
  assert.match(walkUi, /Scan your connections/);
  assert.match(walkUi, /Later, from the Scan tab/);
  assert.match(walkUi, /<FieldQuestion /);
  const needs = steps.slice(steps.indexOf('function NeedsPeople'), steps.indexOf('/** The field question'));
  assert.match(needs, /To bring in the people you know, import your Connections\.csv or install Auto scan\./);
  assert.match(needs, /onClick=\{ctx\.openCsv\}/);
  assert.match(needs, /onClick=\{ctx\.openPlugins\}/);
  assert.match(needs, /Later, from the Scan tab/);
  assert.match(read('../app/components/onboarding/Onboarding.js'), /startWalk: \(\) => \{[^}]*setStartedFor\(WALK_ACTION\);\s*return scan\.run\(WALK_ACTION\);/);
});

// ── Photos, memory, moving about ─────────────────────────────────────────────

const SAVED = { ...NOTHING, first: 748 };
const photos = (extra = {}) => status({ signedIn: true, riskAccepted: true }, {
  running: true, action: 'full', startedAt: 7000, network: SAVED, progress: { kind: 'saving' },
  log: ['Pushing 748 connections', '  Updating 748 profile images'], ...extra,
});

test('photos are optional: a calm line when some didn\'t come through, nothing when they all did', () => {
  const done = (extra) => photos({ running: false, progress: null, exitCode: 0, log: ['  Updating 748 profile images', 'Finished.'], ...extra });
  assert.equal(photosNote(done()), null);
  // Still to save (kept as links): how many, and where to fetch them.
  assert.match(photosNote(done({ photosWaiting: 12 })), /^12 photos aren’t saved yet\..*Save photos/);
  assert.match(photosNote(done({ photosWaiting: 1 })), /^1 photo isn’t saved yet\./);
  // The scan failed or was stopped while saving them: everyone is saved, and says so.
  assert.match(photosNote(done({ exitCode: 1, log: ['Stopped (exit 1).'] })), /Everyone is saved/);
  assert.match(photosNote(done({ log: ['  Updating 748 profile images', 'Stopped.', 'Made today’s backup of your network (Settings → Your data).'] })), /Everyone is saved/);
  // Nobody saved, or still running: not this card's line.
  assert.equal(photosNote(done({ network: NOTHING, exitCode: 1 })), null);
  assert.equal(photosNote(photos({ photosWaiting: 12 })), null);
  assert.equal(photosNote(null), null);
});

test('this browser remembers only that you started, saw the pace step, and opened the map', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(readSetupMemory(storage), { started: false, paced: false, finished: false });
  rememberSetup({ started: true }, storage);
  assert.deepEqual(readSetupMemory(storage), { started: true, paced: false, finished: false });
  rememberSetup({ paced: true }, storage);
  assert.deepEqual(JSON.parse(store.get(SETUP_KEY)), { started: true, paced: true, finished: false });
  // Garbage, or no storage at all (a private window): nothing remembered, nothing thrown.
  store.set(SETUP_KEY, '{nope');
  assert.deepEqual(readSetupMemory(storage), { started: false, paced: false, finished: false });
  assert.deepEqual(readSetupMemory(null), { started: false, paced: false, finished: false });
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(rememberSetup({ started: true }, broken), { started: true, paced: false, finished: false });
});

test('back is always open; forward only as far as the checks allow', () => {
  assert.equal(canOpen('welcome', 'connect'), true);
  assert.equal(canOpen('connect', 'connect'), true);
  assert.equal(canOpen('pace', 'connect'), false);
});

test('"this Mac" on a Mac, "this computer" elsewhere', () => {
  assert.equal(here(status()), 'this Mac');
  assert.equal(here(status({ mac: null })), 'this computer');
  // Before the server answers, the browser's own word.
  assert.equal(here(null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'this Mac');
  assert.equal(here(null, 'Mozilla/5.0 (X11; Linux x86_64)'), 'this computer');
});

// ── Opening on the setup ─────────────────────────────────────────────────────

test('the setup opens with no network; with one, only once for a first scan that ended before Open the map', () => {
  assert.equal(opensSetup({ firstDegree: 0 }), true);
  assert.equal(opensSetup({ firstDegree: 0, demo: true }), false);
  assert.equal(opensSetup({ firstDegree: 0, csv: true }), false);
  // A network and no setup seen in this browser: the map, as ever.
  assert.equal(opensSetup({ firstDegree: 300 }), false);
  assert.equal(opensSetup({ firstDegree: 300, memory: { started: false } }), false);
  // Left before Open the map: the setup (its last card), until it's marked finished.
  assert.equal(opensSetup({ firstDegree: 748, memory: { started: true, paced: true } }), true);
  assert.equal(opensSetup({ firstDegree: 748, memory: { started: true, paced: true, finished: true } }), false);
  assert.equal(opensSetup({ firstDegree: 748, csv: true, memory: { started: true } }), false);
});

test('a setup left on one of the scanner\'s steps comes back after the restart App Management makes', () => {
  // The CSV put people in, and the import marked the setup finished in this
  // browser; macOS then quit and reopened Sixgree, perhaps at a new address
  // with an empty browser memory. The step kept with your settings brings it back.
  for (const saved of ['ready', 'connect', 'pace', 'map']) {
    assert.equal(setupLeftAt(saved), saved);
    assert.equal(opensSetup({ firstDegree: 300, memory: { started: true, finished: true }, saved }), true, saved);
    assert.equal(opensSetup({ firstDegree: 300, memory: {}, saved }), true, saved);
    assert.equal(setupMode({ firstDegree: 300, saved, memory: { started: true, finished: true } }), true, `${saved}: on its step`);
  }
  // Welcome, or nothing kept: the map, as ever.
  for (const saved of ['welcome', null, 'elsewhere']) {
    assert.equal(setupLeftAt(saved), null);
    assert.equal(opensSetup({ firstDegree: 300, memory: { started: true, finished: true }, saved }), false);
  }
  // Never over the sample.
  assert.equal(opensSetup({ firstDegree: 300, demo: true, saved: 'ready' }), false);
});

test('how it opens: on its step, or only "Your galaxy is ready" for a first scan that ended before Open the map', () => {
  assert.equal(setupMode({ firstDegree: 0 }), true);
  // Kept on the first scan with people in a circle already: it ended, so only the last card.
  assert.equal(setupMode({ firstDegree: 300, secondDegree: 29, saved: 'map' }), 'again');
  assert.equal(setupMode({ firstDegree: 300, secondDegree: 0, saved: 'map' }), true);
  // An earlier setup's first scan, which read your connections, ended before Open the map.
  assert.equal(setupMode({ firstDegree: 748, memory: { started: true, paced: true } }), 'again');
  assert.equal(setupMode({ firstDegree: 748, memory: { started: true, paced: true }, saved: 'map' }), 'again');
  // The page asks for the kept step and passes it on (app/page.js).
  const page = read('../app/page.js');
  assert.match(page, /opensSetup\(\{[^}]*saved \}\)/);
  assert.match(page, /setSetupOpen\(setupMode\(\{ firstDegree: d1\.length, secondDegree: d2\.length, saved, memory \}\)\)/);
});
