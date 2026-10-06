// The guided setup's App Management row, mandatory on a Mac from macOS 13
// (Blake, 2026-10-06): Continue waits until macOS says it's on
// (lib/onboarding.js appManagementGate, lib/app-management.js), the step is
// kept with your settings so the restart macOS makes when it's turned on comes
// back to it (setupStep), and a Mac where it can't be checked takes the user's
// word for it rather than leaving them stuck. No browser, no real macOS check.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  onboardingStep, appManagementGate, startStep, withSavedStep, SETUP_STEP_SETTING, readSetupMemory,
  escapeHatch, OVERRIDE_AFTER_MS, APP_MANAGEMENT_OVERRIDE_SETTING,
} from '../lib/onboarding.js';
import { readPreflight, checkAppManagement, PREFLIGHT_SCRIPT, APP_MANAGEMENT_SERVICE } from '../lib/app-management.js';

const dir = mkdtempSync(path.join(tmpdir(), 'six-degrees-onb-appm-'));
process.env.SIX_DEGREES_HOME = dir;
process.env.SIX_DEGREES_DB = path.join(dir, 'test.sqlite');
let getDb, readSettings, writeSettings;
before(async () => {
  ({ getDb } = await import('../lib/db-client.js'));
  ({ readSettings, writeSettings } = await import('../lib/settings.js'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

const NOTHING = { first: 0, second: 0, third: 0 };
const ready = (mac = { version: 26, app: true }, checks = {}) => ({
  checks: { scriptsFound: true, chrome: true, dependencies: true, pythonSource: 'bundled', riskAccepted: true, signedIn: false, mac, ...checks },
  running: false, network: NOTHING, log: [],
});
const ON = { needed: true, granted: true, why: null };
const OFF = { needed: true, granted: false, why: null };
const CANT = { needed: true, granted: null, why: 'The check could not run (spawn osascript ENOENT).' };

// ── Continue waits until it's actually on ───────────────────────────────────

test('on a Mac from macOS 13, Continue waits for macOS to say App Management is on', () => {
  const s = ready();
  assert.deepEqual(appManagementGate(s, undefined), { shown: true, state: 'checking', why: null, canContinue: false });
  assert.equal(appManagementGate(s, OFF).canContinue, false);
  assert.equal(appManagementGate(s, OFF).state, 'off');
  assert.equal(appManagementGate(s, ON).canContinue, true);
  assert.equal(appManagementGate(s, ON).state, 'granted');
});

test('"I\'ve allowed it" doesn\'t open Continue while macOS says it\'s off', () => {
  assert.equal(appManagementGate(ready(), OFF, { claimed: true }).canContinue, false);
});

test('Get ready holds the step until it\'s on, and only then is Connect next', () => {
  const s = ready();
  const started = { started: true };
  assert.equal(onboardingStep(s, started, appManagementGate(s, OFF)), 'ready');
  assert.equal(onboardingStep(s, started, appManagementGate(s, undefined)), 'ready');
  assert.equal(onboardingStep(s, started, appManagementGate(s, ON)), 'connect');
});

test('off a Mac, and before macOS 13, there is no row and nothing to wait for', () => {
  for (const mac of [null, { version: 12, app: true }, { version: 11, app: false }]) {
    const s = ready(mac);
    const gate = appManagementGate(s, undefined);
    assert.equal(gate.shown, false, JSON.stringify(mac));
    assert.equal(gate.canContinue, true);
    assert.equal(onboardingStep(s, { started: true }, gate), 'connect');
  }
  // The server says there's nothing to ask either.
  assert.equal(appManagementGate(ready(), { needed: false, granted: null, why: null }).canContinue, true);
});

// ── The fallback: never stuck ───────────────────────────────────────────────

test('where macOS can\'t be asked, it says so, and "I\'ve allowed it" opens Continue', () => {
  const s = ready();
  const before = appManagementGate(s, CANT);
  assert.equal(before.state, 'unknown');
  assert.equal(before.why, CANT.why);
  assert.equal(before.canContinue, false);
  assert.equal(appManagementGate(s, CANT, { claimed: true }).canContinue, true);
  assert.equal(onboardingStep(s, { started: true }, appManagementGate(s, CANT, { claimed: true })), 'connect');
  // No reason given still gives one.
  assert.match(appManagementGate(s, { needed: true, granted: null }).why, /couldn’t ask macOS/);
});

test('macOS\'s answers read as on, off, or can\'t tell, never a guess', () => {
  assert.deepEqual(readPreflight('0\n'), { granted: true, why: null });
  assert.deepEqual(readPreflight('1\n'), { granted: false, why: null });
  assert.deepEqual(readPreflight('2'), { granted: false, why: null });
  assert.equal(readPreflight('no-tcc').granted, null);
  assert.match(readPreflight('no-tcc').why, /could not be loaded/);
  assert.equal(readPreflight('').granted, null);
  assert.equal(readPreflight('-1').granted, null);
  assert.match(PREFLIGHT_SCRIPT, new RegExp(APP_MANAGEMENT_SERVICE));
});

test('the check: macOS is asked on a Mac from 13, and a check that can\'t run is logged and reads as can\'t tell', async () => {
  const lines = [];
  const log = (l) => lines.push(l);
  assert.deepEqual(await checkAppManagement({ platform: 'darwin', version: 26, run: async () => '0\n', log }), { needed: true, granted: true, why: null });
  assert.deepEqual(await checkAppManagement({ platform: 'darwin', version: 13, run: async () => '1\n', log }), { needed: true, granted: false, why: null });
  assert.equal(lines.length, 0);
  const broken = await checkAppManagement({ platform: 'darwin', version: 26, run: async () => { throw new Error('spawn osascript ENOENT'); }, log });
  assert.equal(broken.needed, true);
  assert.equal(broken.granted, null);
  assert.match(broken.why, /ENOENT/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /takes the user's word for it/);
  let ran = false;
  const run = async () => { ran = true; return '0'; };
  assert.equal((await checkAppManagement({ platform: 'linux', run })).needed, false);
  assert.equal((await checkAppManagement({ platform: 'darwin', version: 12, run })).needed, false);
  assert.equal(ran, false, 'nothing is run where there\'s nothing to ask');
});

// ── The step survives the restart ───────────────────────────────────────────

test('the setup\'s step is a setting: one of the five, or none', () => {
  for (const step of ['welcome', 'ready', 'connect', 'pace', 'map', null]) assert.equal(SETUP_STEP_SETTING.parse(step), step);
  assert.throws(() => SETUP_STEP_SETTING.parse('elsewhere'));
  assert.equal(SETUP_STEP_SETTING.default, null);
});

test('kept before System Settings, Get ready reopens after macOS restarts Sixgree, ticked once it\'s on', () => {
  getDb().exec("DELETE FROM app_meta WHERE key = 'settings'");
  // Before System Settings: the step is kept with the settings.
  writeSettings(getDb(), { setupStep: 'ready', scanRiskAccepted: new Date().toISOString() });

  // The restart: a new address, so this browser's memory is empty, and only the settings remain.
  const memory = readSetupMemory({ getItem: () => null });
  const saved = readSettings(getDb()).setupStep;
  assert.equal(saved, 'ready');
  const s = ready();

  // Asked again, and now on: the same step, ticked, Continue open.
  const on = appManagementGate(s, ON);
  const derived = onboardingStep(s, withSavedStep(memory, saved), on);
  assert.equal(derived, 'connect', 'everything on the step is done');
  assert.equal(startStep(derived, saved), 'ready', 'but it opens where it was, not a step on');
  assert.equal(on.state, 'granted');
  assert.equal(on.canContinue, true);

  // Still off (turned on, then off again, or the restart came first): the same step, Continue shut.
  const off = appManagementGate(s, OFF);
  assert.equal(startStep(onboardingStep(s, withSavedStep(memory, saved), off), saved), 'ready');
  assert.equal(off.canContinue, false);
});

test('a kept step never skips ahead of the checks, and a step past Welcome means you chose to scan', () => {
  assert.equal(startStep('ready', 'pace'), 'ready', 'Chrome went missing since');
  assert.equal(startStep('connect', 'ready'), 'ready');
  assert.equal(startStep('connect', null), 'connect');
  assert.equal(startStep('connect', 'nowhere'), 'connect');
  assert.equal(startStep(null, 'ready'), null);
  assert.deepEqual(withSavedStep({}, 'ready'), { started: true, paced: false });
  assert.deepEqual(withSavedStep({}, 'map'), { started: true, paced: true });
  assert.deepEqual(withSavedStep({}, 'welcome'), { started: false, paced: false });
  assert.deepEqual(withSavedStep({ started: true, paced: false, finished: false }, null), { started: true, paced: false, finished: false });
});

// ── The escape hatch: a check that wrongly says off can't strand anyone ─────

test('"It\'s on, but Sixgree can\'t tell" shows ~20 s after "I\'ve allowed it" while the check still says off', () => {
  const off = appManagementGate(ready(), OFF, { claimed: true });
  assert.equal(OVERRIDE_AFTER_MS, 20_000);
  assert.equal(escapeHatch(off, {}), false, 'nothing pressed, nothing back from System Settings');
  assert.equal(escapeHatch(off, { claimedAt: 1_000, now: 1_000 + 19_999 }), false);
  assert.equal(escapeHatch(off, { claimedAt: 1_000, now: 1_000 + 20_000 }), true);
});

test('or after two checks say off once the window is back from System Settings', () => {
  const off = appManagementGate(ready(), OFF);
  assert.equal(escapeHatch(off, { offSinceReturn: 0 }), false);
  assert.equal(escapeHatch(off, { offSinceReturn: 1 }), false);
  assert.equal(escapeHatch(off, { offSinceReturn: 2 }), true);
});

test('only ever while the check says off', () => {
  const late = { claimedAt: 0, now: 60_000, offSinceReturn: 5 };
  assert.equal(escapeHatch(appManagementGate(ready(), ON), late), false);
  assert.equal(escapeHatch(appManagementGate(ready(), undefined), late), false);
  assert.equal(escapeHatch(appManagementGate(ready(), CANT), late), false, 'can\'t tell has its own way on');
  assert.equal(escapeHatch(appManagementGate(ready(null), OFF), late), false, 'no row off a Mac');
});

test('taken, it opens Continue and is kept, so the restart doesn\'t put the user back behind the check', () => {
  const s = ready();
  const gate = appManagementGate(s, OFF, { override: true });
  assert.deepEqual(gate, { shown: true, state: 'override', why: null, canContinue: true });
  assert.equal(onboardingStep(s, { started: true }, gate), 'connect');
  // It never hides a real answer: on is on.
  assert.equal(appManagementGate(s, ON, { override: true }).state, 'granted');
  assert.equal(APP_MANAGEMENT_OVERRIDE_SETTING.default, false);
  assert.throws(() => APP_MANAGEMENT_OVERRIDE_SETTING.parse('yes'));

  getDb().exec("DELETE FROM app_meta WHERE key = 'settings'");
  writeSettings(getDb(), { appManagementOverride: true, setupStep: 'ready' });
  const kept = readSettings(getDb());
  assert.equal(kept.appManagementOverride, true);
  assert.equal(appManagementGate(s, OFF, { override: kept.appManagementOverride }).canContinue, true);
});
