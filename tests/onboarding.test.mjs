// The guided setup's steps (lib/onboarding.js), from every state GET
// /api/scraper can report: which step someone new is on, which one someone who
// left halfway comes back to, and each step's live status. No browser, no
// scanner. Invented counts only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, SETUP_KEY, onboardingStep, opensSetup, readyChecks, connectState, firstScan, followedScan, photosNote, readSetupMemory, rememberSetup, canOpen, here,
} from '../lib/onboarding.js';
import { statusWithJob } from '../lib/scraper-client.js';

const NOTHING = { first: 0, second: 0, third: 0 };
const MAC_APP = { scriptsFound: true, chrome: true, dependencies: true, pythonSource: 'bundled', mac: { version: 26, app: true } };
const status = (checks = {}, extra = {}) => ({ checks: { ...MAC_APP, riskAccepted: false, signedIn: false, ...checks }, running: false, network: NOTHING, log: [], ...extra });

test('the five steps, in order', () => {
  assert.deepEqual([...STEPS], ['welcome', 'ready', 'connect', 'pace', 'map']);
});

test('a new install opens on Welcome, and nothing at all until the scanner has answered', () => {
  assert.equal(onboardingStep(null), null);
  assert.equal(onboardingStep(status()), 'welcome');
  assert.equal(onboardingStep(status(), { started: false }), 'welcome');
});

test('chose to scan: Get ready until Chrome, the scanner and "I understand" are all there', () => {
  const started = { started: true };
  assert.equal(onboardingStep(status(), started), 'ready');
  assert.equal(onboardingStep(status({ riskAccepted: true, chrome: false }), started), 'ready');
  assert.equal(onboardingStep(status({ riskAccepted: true, dependencies: false, pythonSource: null }), started), 'ready');
  assert.equal(onboardingStep(status({ riskAccepted: true, scriptsFound: false }), started), 'ready');
  assert.equal(onboardingStep(status({ riskAccepted: true }), started), 'connect');
});

test('App Management never holds Get ready up: optional, and the app can\'t see it', () => {
  // The answer lives in settings, which this doesn't even take.
  assert.equal(onboardingStep(status({ riskAccepted: true }), { started: true }), 'connect');
});

test('someone who left halfway lands back on their step, whatever this browser remembers', () => {
  // "I understand" given (or a scan before it, which the server counts the same): past Welcome.
  assert.equal(onboardingStep(status({ riskAccepted: true })), 'connect');
  // Signed in: Set your pace, then Map once that's been seen.
  assert.equal(onboardingStep(status({ riskAccepted: true, signedIn: true })), 'pace');
  assert.equal(onboardingStep(status({ riskAccepted: true, signedIn: true }), { paced: true }), 'map');
  // A first scan reading, or one that has saved people: Map, where its progress is.
  assert.equal(onboardingStep(status({ riskAccepted: true, signedIn: true }, { running: true, action: 'full' })), 'map');
  assert.equal(onboardingStep(status({ riskAccepted: true, signedIn: true }, { network: { ...NOTHING, first: 12 } })), 'map');
  // Signed out since (a deleted Chrome profile): back to Connect.
  assert.equal(onboardingStep(status({ riskAccepted: true, signedIn: false }), { started: true, paced: true }), 'connect');
});

test('a first scan that failed comes back to Map, to say why and try again', () => {
  const failed = status({ riskAccepted: true, signedIn: true }, { action: 'full', exitCode: 1, failure: ['LinkedIn isn\'t signed in, so nothing was read.'] });
  assert.equal(onboardingStep(failed), 'map');
  assert.deepEqual(firstScan(failed), { state: 'failed', done: null, total: null, failure: 'LinkedIn isn\'t signed in, so nothing was read.' });
});

test('Get ready: Chrome, the scanner and "I understand", each on its own', () => {
  const r = readyChecks(status({ riskAccepted: true }));
  assert.equal(r.chrome, true);
  assert.equal(r.scanner.done, true);
  assert.equal(r.scanner.bundled, true);
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

test('the first scan: reading, saving, done with the people saved', () => {
  assert.deepEqual(firstScan(status()), { state: 'idle', done: null, total: null, failure: null });
  const reading = status({}, { running: true, action: 'full', progress: { done: 350, total: 817, kind: 'walk' } });
  assert.deepEqual(firstScan(reading), { state: 'running', done: 350, total: 817, failure: null });
  // Just started: no count yet.
  assert.deepEqual(firstScan(status({}, { running: true, action: 'full' })), { state: 'running', done: null, total: null, failure: null });
  assert.equal(firstScan(status({}, { running: true, action: 'full', progress: { kind: 'saving' } })).state, 'saving');
  assert.deepEqual(firstScan(status({}, { network: { ...NOTHING, first: 748 } })), { state: 'done', done: 748, total: 748, failure: null });
});

// Blake, 2026-10-05, 1.2.0: after the walk the setup moved to "Saving, and
// fetching photos", and sat there for minutes after the job had ended; the
// notch's Details showed it finished. The end now comes from the same job
// answer the notch reads, whatever the slower whole status still says.
const SAVED = { ...NOTHING, first: 748 };
const photos = (extra = {}) => status({ signedIn: true, riskAccepted: true }, {
  running: true, action: 'full', startedAt: 7000, network: SAVED, progress: { kind: 'saving' },
  log: ['Pushing 748 connections', '  Updating 748 profile images'], ...extra,
});
const told = (recent, extra = {}) => ({ known: true, running: false, pending: false, action: null, startedAt: null, recent, ...extra });

test('the photos step ends the moment the job answer has seen the first scan end, however it ended', () => {
  const s = photos();
  assert.equal(firstScan(s, 7000).state, 'saving');
  // Finished, failed while saving the photos, or stopped: everyone is saved, so it's done.
  for (const exitCode of [0, 1, -15]) {
    const now = statusWithJob(s, told([{ action: 'full', startedAt: 7000, exitCode, failure: null }]));
    assert.deepEqual(firstScan(now, 7000), { state: 'done', done: 748, total: 748, failure: null }, `exit ${exitCode}`);
  }
  // The job answer is older than the status (it hasn't seen this job yet): still saving.
  assert.equal(firstScan(statusWithJob(s, told([])), 7000).state, 'saving');
  // Nothing to fetch: the status had already seen the end.
  assert.equal(firstScan(photos({ running: false, progress: null }), 7000).state, 'done');
});

test('a job that starts right after the first scan doesn\'t hold "Your galaxy is ready" back', () => {
  // The queue's next (a circle): not a read of your connections at all.
  const queued = statusWithJob(photos(), told([{ action: 'full', startedAt: 7000, exitCode: 0 }], { running: true, action: 'bridge', startedAt: 9000 }));
  assert.equal(firstScan(queued, 7000).state, 'done');
  // A Check for new straight after: a read of your connections, but not the one the setup watched.
  const again = photos({ action: 'refresh', startedAt: 9000, progress: { done: 10, total: 748, kind: 'walk' } });
  assert.equal(firstScan(again, 7000).state, 'done');
  // Opened while it runs, with nothing watched yet: it is the first scan.
  assert.equal(firstScan(photos(), null).state, 'saving');
});

test('which scan the setup watches: the first it sees run, and a new try while nobody is saved yet', () => {
  assert.equal(followedScan(null, status()), null);
  assert.equal(followedScan(null, photos()), 7000);
  // Kept once people are saved, whatever starts next.
  assert.equal(followedScan(7000, photos({ action: 'refresh', startedAt: 9000 })), 7000);
  assert.equal(followedScan(7000, photos({ running: false })), 7000);
  // A Try again after one that saved nobody: that one is the first scan now.
  assert.equal(followedScan(7000, photos({ startedAt: 9000, network: NOTHING })), 9000);
  // Not a read of your connections: nothing to watch.
  assert.equal(followedScan(null, photos({ action: 'bridge' })), null);
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
