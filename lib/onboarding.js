// The guided setup a new install opens on (app/components/onboarding): which
// step you're on, and what each step's live status is, from what the Scan page
// already reads. Blake, 2026-10-04: "how [Wispr] Flow is with its onboarding …
// i want the same thing for the app management setting and also to sign into
// linkedin as thats how they 'sign into their account'", and of the mock-ups,
// "for the onboard i like a's approach".
//
// Five steps, one a screen: Welcome, Get your Mac ready, Connect your LinkedIn,
// Set your pace, Map your people. Everything but two of them is known from
// GET /api/scraper (Chrome, the scanner, the one-time "I understand", signed in,
// the first scan and the people it saved), so someone who left halfway comes
// back to the step they were on. The three it can't know are kept in this
// browser (SETUP_KEY): that you chose to scan on the welcome screen, that
// you've seen the pace step, and that you pressed Open the map (opensSetup);
// none is ever a reason to scan or not. The step itself is also kept with
// your settings (SETUP_STEP_SETTING), so a restart finds it.
//
// Plain data in, plain data out, like lib/scanner-setup.js: the components draw
// it, and tests/onboarding.test.mjs checks every state without a browser.

import { setupStep } from './scanner-setup.js';
import { scanProgress } from './scan-progress.js';

export const STEPS = Object.freeze(['welcome', 'ready', 'connect', 'pace', 'map']);
export const STEP_LABELS = Object.freeze({
  welcome: 'Welcome', ready: 'Get ready', connect: 'Connect', pace: 'Pace', map: 'Map',
});

/** What this browser remembers of the setup: { started, paced, finished }. */
export const SETUP_KEY = 'six-degrees-setup';

export function readSetupMemory(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    const raw = JSON.parse(storage?.getItem(SETUP_KEY) || '{}');
    return { started: raw?.started === true, paced: raw?.paced === true, finished: raw?.finished === true };
  } catch {
    return { started: false, paced: false, finished: false };
  }
}

export function rememberSetup(change, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const next = { ...readSetupMemory(storage), ...change };
  try { storage?.setItem(SETUP_KEY, JSON.stringify(next)); } catch { /* not remembered: the checks still place you */ }
  return next;
}

const first = (status) => Number(status?.network?.first) || 0;
// The one-time "I understand" (lib/scan-risk.js). Unknown, from an older server, counts as given, as on the Scan page.
const riskOk = (status) => status?.checks?.riskAccepted !== false;

/**
 * Step 2, Get your Mac ready: { chrome, scanner, risk, done }. `chrome` is
 * true, false, or null when the server couldn't say; `scanner` is setupStep's
 * answer with Chrome's part taken out (Chrome has its own row here). Done when
 * Chrome is here, the scanner can run, and "I understand" was given. App
 * Management, on a Mac, is the step's other gate (appManagementGate), asked of
 * macOS separately, since GET /api/scraper doesn't run it on every poll.
 */
export function readyChecks(status) {
  const c = status?.checks || {};
  const chrome = c.chrome === false ? false : c.chrome === true ? true : null;
  // setupStep counts Chrome in; here Chrome has a row of its own, so the
  // scanner's part is asked as if Chrome were here.
  const scanner = setupStep(status && { ...status, checks: { ...c, chrome: true } });
  const missing = c.scriptsFound === false;
  const risk = riskOk(status);
  return {
    chrome,
    scanner: { ...scanner, done: scanner.done && !missing, missing, bundled: c.pythonSource === 'bundled' },
    risk,
    done: chrome !== false && scanner.done && !missing && risk,
  };
}

/**
 * Step 3, Connect your LinkedIn:
 *   'connected'  the scanner's note says the session is confirmed (signed-in.json)
 *   'waiting'    the sign-in window is open and waiting for you
 *   'closed'     the last sign-in ended without one (the window was closed, or it timed out)
 *   'idle'       not signed in, nothing open
 */
export function connectState(status) {
  if (status?.checks?.signedIn) return 'connected';
  if (status?.running && status.action === 'login') return 'waiting';
  if (!status?.running && status?.action === 'login' && status.exitCode != null && status.exitCode !== 0) return 'closed';
  return 'idle';
}

const READS_YOURS = new Set(['full', 'refresh']);
const JOB_END = /^(Finished\.|Stopped\.|Stopped \(exit -?\d+\)\.)$/;

/**
 * Step 5, the first scan of the people you know:
 *   { state: 'idle' | 'running' | 'saving' | 'done' | 'failed', done, total, failure }
 * `done`/`total` while it reads (lib/scan-progress.js), the people saved once
 * it's done, and why it stopped when it failed.
 *
 * `status` is useScanStatus's, already brought up to date by the job answer
 * the notch reads (lib/scraper-client.js statusWithJob), so the two can't
 * disagree about whether it has ended. `follow` is the startedAt of the scan
 * this setup has been watching (followedScan): once people are saved, another
 * read of your connections that starts after it (a Check for new) is not the
 * first scan, and doesn't hold "Your galaxy is ready" back. Done is the people
 * saved, however the job ended: finished, stopped, or failed while saving the
 * photos, which are optional (photosNote says so, calmly).
 */
export function firstScan(status, follow = null) {
  const saved = first(status);
  const later = saved > 0 && follow != null && status?.startedAt != null && status.startedAt !== follow;
  if (status?.running && READS_YOURS.has(status.action) && !later) {
    const p = status.progress || scanProgress(status.log, status.action);
    if (p?.kind === 'saving') return { state: 'saving', done: null, total: null, failure: null };
    return { state: 'running', done: p?.done ?? null, total: p?.total ?? null, failure: null };
  }
  if (saved > 0) return { state: 'done', done: saved, total: saved, failure: null };
  if (!status?.running && status?.action === 'full' && status.exitCode != null && status.exitCode !== 0) {
    return { state: 'failed', done: null, total: null, failure: status.failure?.length ? status.failure.join('\n') : null };
  }
  return { state: 'idle', done: null, total: null, failure: null };
}

/**
 * Which scan the setup is watching: the startedAt of the read of your
 * connections it saw run, kept from `prev` once people are saved. Before any
 * are, each new one is the first scan (a Try again after one that failed).
 */
export function followedScan(prev, status) {
  if (!status?.running || !READS_YOURS.has(status.action) || status.startedAt == null) return prev ?? null;
  if (prev == null || first(status) === 0) return status.startedAt;
  return prev;
}

/**
 * A calm line for "Your galaxy is ready" when not every photo came through:
 * photos are optional, and everyone is saved either way. null when there's
 * nothing to say.
 */
export function photosNote(status) {
  if (!(first(status) > 0) || status?.running) return null;
  const waiting = Number(status.photosWaiting) || 0;
  if (waiting > 0) {
    return `${waiting.toLocaleString()} ${waiting === 1 ? 'photo isn’t' : 'photos aren’t'} saved yet. Until then they show initials; Scan → Save photos fetches them anytime.`;
  }
  if (!READS_YOURS.has(status.action)) return null;
  // How the app says the job ended (app/api/scraper/route.js finish): "Finished.", "Stopped." or "Stopped (exit 1).".
  const log = Array.isArray(status.log) ? status.log : [];
  const end = [...log].reverse().map((l) => String(l ?? '').trim()).find((l) => JOB_END.test(l)) || '';
  const endedEarly = (status.exitCode != null && status.exitCode !== 0) || end.startsWith('Stopped');
  return endedEarly ? 'Some photos may not have come through. Everyone is saved, and anyone without one shows initials.' : null;
}

/**
 * The step you're on: the first not done. `memory` is readSetupMemory().
 * null until the scanner's status is known, so the welcome screen never shows
 * and then gives way to step 3.
 *
 * Welcome until you've chosen to scan, unless the app already shows you have
 * (the "I understand", or a sign-in). Anything that reads your connections,
 * or a network already saved, is step 5: that is where its progress shows.
 */
export function onboardingStep(status, memory = {}, gate = null) {
  if (!status) return null;
  const scan = firstScan(status);
  if (scan.state !== 'idle' && scan.state !== 'failed') return 'map';
  const signedIn = Boolean(status.checks?.signedIn);
  const begun = memory.started || signedIn || status.checks?.riskAccepted === true;
  if (!begun) return 'welcome';
  // `gate` is appManagementGate's: on a Mac, Get ready holds until App Management is on.
  if (!readyChecks(status).done || (gate && !gate.canContinue)) return 'ready';
  if (!signedIn) return 'connect';
  if (!memory.paced && scan.state !== 'failed') return 'pace';
  return 'map';
}

/**
 * Does the map open on the setup? Always with no network yet (your own: never
 * the sample or a CSV). With one, only for someone this browser saw start the
 * setup whose first scan finished before they pressed Open the map: they get
 * "Your galaxy is ready" once, on their next visit (app/page.js then marks it
 * finished), and the map after. Someone with a network who never used the
 * setup never sees it.
 */
export function opensSetup({ firstDegree = 0, demo = false, csv = false, memory = {} } = {}) {
  if (demo || csv) return false;
  if (!(firstDegree > 0)) return true;
  return memory.started === true && memory.finished !== true;
}

// ── App Management, mandatory on a Mac from macOS 13 ─────────────────────────
// Blake, 2026-10-06: the Get ready step's App Management row is mandatory, and
// Continue waits until it is actually on. Chrome updating itself while the
// scanner uses it makes macOS stop and ask whether Sixgree may manage apps,
// which a scan can't answer. lib/app-management.js reads the setting from
// macOS (GET /api/scraper?appManagement).

/**
 * The Get ready step's App Management row:
 *   { shown, state, why, canContinue }
 *   state  'none'      off a Mac, or before macOS 13: no row, nothing to wait for
 *          'checking'  not asked yet: Continue waits the moment it takes
 *          'granted'   macOS says it's on
 *          'off'       macOS says it's off: Continue waits, whatever was pressed
 *          'unknown'   macOS couldn't be asked (`why`): Continue goes once the
 *                      user says they've allowed it (`claimed`), so no one is stuck
 * `access` is that answer: { needed, granted, why }, undefined before the first.
 */
export function appManagementGate(status, access, { claimed = false, override = false } = {}) {
  const mac = status?.checks?.mac;
  const none = { shown: false, state: 'none', why: null, canContinue: true };
  if (!mac || (mac.version != null && mac.version < 13) || access?.needed === false) return none;
  if (access == null) return { shown: true, state: 'checking', why: null, canContinue: false };
  if (access.granted === true) return { shown: true, state: 'granted', why: null, canContinue: true };
  // The escape hatch (escapeHatch): the user said it's on and the check never agreed.
  if (access.granted === false && override === true) return { shown: true, state: 'override', why: null, canContinue: true };
  if (access.granted === false) return { shown: true, state: 'off', why: null, canContinue: false };
  return { shown: true, state: 'unknown', why: access.why || 'Sixgree couldn’t ask macOS.', canContinue: claimed === true };
}

/** How long after "I've allowed it" the check may go on saying off before the way past it shows. */
export const OVERRIDE_AFTER_MS = 20_000;
/** Or how many checks may say off after coming back from System Settings. */
export const OVERRIDE_AFTER_CHECKS = 2;

/**
 * Show "It's on, but Sixgree can't tell: continue anyway"? The check is
 * TCC's private preflight: if it ever says off wrongly (macOS names another
 * app, or a macOS update changes it), no one may be stuck behind it. So once
 * the user has said it's on and the check still says off ~20 s later, or it
 * said off twice after they came back from System Settings, they can go on.
 *   claimedAt         when "I've allowed it" was pressed (ms), or null
 *   offSinceReturn    checks that said off since the window came back from System Settings, or null
 */
export function escapeHatch(gate, { claimedAt = null, offSinceReturn = null, now = Date.now() } = {}) {
  if (gate?.state !== 'off') return false;
  if (claimedAt != null && now - claimedAt >= OVERRIDE_AFTER_MS) return true;
  return offSinceReturn != null && offSinceReturn >= OVERRIDE_AFTER_CHECKS;
}

/** "It's on, but Sixgree can't tell": kept, so the restart doesn't put the user back behind the check. */
export const APP_MANAGEMENT_OVERRIDE_SETTING = {
  default: false,
  parse(value) {
    if (value === true || value === false) return value;
    throw new Error('The App Management override is true or false.');
  },
};

/**
 * The step the setup was on, kept with your settings (`setupStep`), not in
 * this browser: turning App Management on makes macOS quit and reopen
 * Sixgree, and the Mac app may come back on another port, a new address whose
 * browser storage is empty. null when there is none.
 */
export const SETUP_STEP_SETTING = {
  default: null,
  parse(value) {
    if (value === null || STEPS.includes(value)) return value;
    throw new Error(`The setup step is one of ${STEPS.join(', ')}, or null.`);
  },
};

/**
 * What this browser remembers, with what the kept step says: a step past
 * Welcome means you chose to scan, and one past Pace that you've seen it, even
 * when this browser's own memory went with the old address.
 */
export function withSavedStep(memory = {}, saved = null) {
  const at = STEPS.indexOf(saved);
  return {
    ...memory,
    started: memory.started === true || at >= STEPS.indexOf('ready'),
    paced: memory.paced === true || at >= STEPS.indexOf('map'),
  };
}

/**
 * The step to open on: the kept one (back from System Settings, or a restart),
 * as long as the checks still let you be there; otherwise the first not done.
 * So a restart after App Management was turned on reopens Get ready, ticked,
 * and doesn't skip ahead.
 */
export function startStep(derived, saved) {
  if (!derived) return null;
  if (saved && STEPS.includes(saved) && canOpen(saved, derived)) return saved;
  return derived;
}

/** Can step `to` be opened from step `at`? Back always; forward only as far as the checks allow. */
export function canOpen(to, at) {
  return STEPS.indexOf(to) <= STEPS.indexOf(at);
}

/**
 * The word for the machine: "this Mac" on a Mac (GET /api/scraper's
 * checks.mac, or the browser's own word while that isn't known), "this
 * computer" elsewhere.
 */
export function here(status, userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const mac = status?.checks ? status.checks.mac != null : /Macintosh|Mac OS X/.test(userAgent || '');
  return mac ? 'this Mac' : 'this computer';
}
