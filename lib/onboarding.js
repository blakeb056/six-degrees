// The guided setup a new install opens on (app/components/onboarding): which
// step you're on, and what each step's live status is, from what the Scan page
// already reads. Blake, 2026-10-04: "how [Wispr] Flow is with its onboarding …
// i want the same thing for the app management setting and also to sign into
// linkedin as thats how they 'sign into their account'", and of the mock-ups,
// "for the onboard i like a's approach".
//
// The app carries no scanner now: scanning comes from a plugin (Auto scan,
// Manual scan), so the setup follows what is installed (Blake, 2026-10-14):
//
//   Welcome
//     └─ Import your Connections.csv (the main path, recommended, never a gate)
//          ├─ Other ways to bring in your network, under it: the scanners' cards, and Install
//          ├─ no scanner installed: See your galaxy, and into the app
//          └─ a scanner installed: Set up scanning, after the import or without one
//               Get ready → Connect → Pace (not with Manual scan alone)
//               → First scan (firstScanOffer: one person's circle, your connections,
//                 or how to bring them in; or Later) → Open the map
//
// Everything but three things is known from GET /api/scraper (Chrome, the
// scanner, the one-time "I understand", signed in, the people you know and
// the first scan), so someone who left halfway comes back to the step they
// were on. The three it can't know are kept in this browser (SETUP_KEY): that
// you chose to set up scanning, that you've seen the pace step, and that you
// pressed Open the map (opensSetup); none is ever a reason to scan or not.
// The step itself is also kept with your settings (SETUP_STEP_SETTING), so a
// restart finds it.
//
// Plain data in, plain data out, like lib/scanner-setup.js: the components draw
// it, and tests/onboarding.test.mjs checks every state without a browser.

import { setupStep } from './scanner-setup.js';
import { cleanCapabilities } from './scanner-capabilities.js';
import { scanProgress } from './scan-progress.js';

export const STEPS = Object.freeze(['welcome', 'ready', 'connect', 'pace', 'map']);
export const STEP_LABELS = Object.freeze({
  welcome: 'Welcome', ready: 'Get ready', connect: 'Connect', pace: 'Pace', map: 'First scan',
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

// ── Which scanner is installed ───────────────────────────────────────────────

/**
 * Which scanner plugins scans can use, from GET /api/scraper's `capabilities`
 * (lib/scanner-capabilities.js): 'none', 'auto', 'manual' or 'both'. The
 * built-in scanner, which only a git checkout still has, is 'both'. An answer
 * that isn't one (none yet) is 'none': the setup never offers a scan it can't
 * see a scanner for.
 */
export function scannerKind(caps) {
  const c = cleanCapabilities(caps);
  if (!c) return 'none';
  if (c.auto && c.manual) return 'both';
  return c.auto ? 'auto' : c.manual ? 'manual' : 'none';
}

/**
 * Where the CSV import's result leads: 'ready', Set up scanning, when a
 * scanner is installed (before the CSV, during it, or on the result itself);
 * 'galaxy', into the app, when none is. Skip, see your galaxy is always there
 * beside Set up scanning.
 */
export function afterImport(caps) {
  return scannerKind(caps) === 'none' ? 'galaxy' : 'ready';
}

/**
 * Is there a Pace step? Not with Manual scan alone: you turn every page
 * yourself, and the speed only paces what the scanner does by itself.
 */
export function pacesFor(caps) {
  return scannerKind(caps) !== 'manual';
}

/** The steps the setup has with what's installed: the dots, in order. */
export function stepsFor(caps) {
  return pacesFor(caps) ? STEPS : STEPS.filter((s) => s !== 'pace');
}

/** The step Continue goes to from `step`, and the one Back goes to. */
export function stepAfter(step, caps) {
  const steps = stepsFor(caps);
  return steps[steps.indexOf(step) + 1] ?? null;
}
export function stepBefore(step, caps) {
  const steps = stepsFor(caps);
  const at = steps.indexOf(step);
  return at > 0 ? steps[at - 1] : null;
}

/** "Step 3 of 5 · Connect": a step's line above its title, counted with what's installed. */
export function stepEyebrow(step, caps) {
  const steps = stepsFor(caps);
  return `Step ${steps.indexOf(step) + 1} of ${steps.length} · ${STEP_LABELS[step]}`;
}

// ── The steps ────────────────────────────────────────────────────────────────

/**
 * Step 2, Get ready: { chrome, scanner, risk, done }. `chrome` is true, false,
 * or null when the server couldn't say; `scanner` is setupStep's answer with
 * Chrome's part taken out (Chrome has its own row here), with `missing` when
 * no scanner is installed at all and `plugin` when it's a plugin's. Done when
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
  const plugin = c.scanner?.from === 'plugin' && c.scanner.plugin?.name ? c.scanner.plugin : null;
  return {
    chrome,
    scanner: { ...scanner, done: scanner.done && !missing, missing, bundled: c.pythonSource === 'bundled', plugin },
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

// ── The first scan ───────────────────────────────────────────────────────────
// Which one follows what's there (Blake, 2026-10-14: the CSV is recommended,
// never a gate, "if the user doesn't have a csv but wants to scan only for
// their connections to start we have to allow that"):
//   - your people in (a CSV, or earlier): one person's circle, someone you
//     know picked for you (lib/reach.js firstCirclePicks), the first few pages
//     of their list, by their id (app/api/scraper/route.js `bridge`), which
//     either plugin does;
//   - nobody yet, with Auto scan: the walk of your own connections (`full`),
//     the first scan the setup has always had, which only Auto scan does;
//   - nobody yet, with Manual scan alone: it reads the circles of people you
//     already know, so it can't bring them in itself. The setup says so, and
//     offers the CSV and Auto scan.

/**
 * How many pages of their list a first circle scan reads: about 30 people, a
 * profile view and three searches. Gentle on a new account, after two real
 * accounts were restricted by scanning too much too fast.
 */
export const FIRST_SCAN_PAGES = 3;
/** The route's action for one person's circle. */
export const FIRST_SCAN_ACTION = 'bridge';
/** The route's action for the walk of your own connections. */
export const WALK_ACTION = 'full';

/**
 * Which first scan the setup offers: 'circle' (your people are in), 'walk'
 * (nobody yet, and Auto scan is installed), 'needs-people' (nobody yet, and
 * Manual scan alone), or 'none' (no scanner).
 */
export function firstScanOffer(status) {
  const kind = scannerKind(status?.capabilities);
  if (kind === 'none') return 'none';
  if (first(status) > 0) return 'circle';
  return kind === 'manual' ? 'needs-people' : 'walk';
}

/**
 * Does the CSV step offer "Continue without a CSV: set up scanning"? Once a
 * scanner is installed: the CSV stays the recommended way in, never a gate.
 */
export function scanWithoutCsv(caps) {
  return scannerKind(caps) !== 'none';
}

const total = (found) => (Array.isArray(found) ? found.reduce((n, x) => n + (Number(x) || 0), 0) : 0);
const FIRST_SCANS = new Set([FIRST_SCAN_ACTION, WALK_ACTION]);

/** How the followed scan ended: the status itself once it says so (statusWithJob), else its line in `recent`. */
function endOf(status, follow) {
  if (follow == null || !status) return null;
  if (!status.running && status.startedAt === follow) return status;
  return (Array.isArray(status.recent) ? status.recent : []).find((j) => j?.startedAt === follow) || null;
}

// What the scanner prints as a read of one list ends with nobody on it
// (scripts/scrape.py scrape_bridge: keep these in step with it), and the
// app's own line once a job has ended (app/api/scraper/route.js, lib/scan-exit.js).
const LIST_HIDDEN = /^(Their connections are hidden|LinkedIn shows no one in their list)\b/;
const NOBODY_READ = /^Done! No connections found\b/;
const JOB_OVER = /^(Finished\.|Stopped\.|Stopped at today’s limit\.|Stopped: .+\.|Stopped \(exit -?\d+\)\.)$/;

/**
 * Step 5, the first scan:
 *   { state, kind, pages, of, found, done, total, who, hidden, failure }
 *   kind   'circle' (one person's) or 'walk' (your own connections)
 *   state  'idle'     nothing started yet
 *          'running'  reading: for a circle, `pages` read so far of `of` and
 *                     `found`, the people on them (the job answer's own
 *                     counts); for the walk, `done` of `total` once the
 *                     platform has said how many (lib/scan-progress.js)
 *          'saving'   the walk saving everyone and fetching photos; or a
 *                     circle ended while the rest of the status (the people
 *                     saved) is a moment behind: "Your galaxy is ready" waits
 *          'done'     a circle ended calmly with people read: finished,
 *                     stopped (everything read is kept), or at a limit (exit
 *                     code 0); the walk ended with people saved, however it
 *                     ended (photos are optional, and photosNote says so)
 *          'empty'    a circle ended with nobody read: their list is hidden
 *                     (`hidden`), or nothing was read (a manual read closed at once)
 *          'failed'   stopped with a reason (`failure`), nobody saved
 * `who` is whose circle it is.
 *
 * `follow` is the startedAt of the scan the setup started (followedScan). A
 * first scan already running when the setup opened is shown running; nothing
 * that ended before it was watched is the setup's.
 */
export function firstScan(status, follow = null) {
  const idle = { state: 'idle', kind: 'circle', pages: 0, of: FIRST_SCAN_PAGES, found: 0, done: null, total: null, who: null, hidden: false, failure: null };
  if (status?.running && FIRST_SCANS.has(status.action) && (follow == null || status.startedAt === follow)) {
    if (status.action === WALK_ACTION) {
      const p = status.progress || scanProgress(status.log, WALK_ACTION);
      if (p?.kind === 'saving') return { ...idle, kind: 'walk', state: 'saving' };
      return { ...idle, kind: 'walk', state: 'running', done: p?.done ?? null, total: p?.total ?? null };
    }
    return { ...idle, state: 'running', pages: Number(status.pages) || 0, found: total(status.found), who: status.target?.name ?? null };
  }
  const end = endOf(status, follow);
  if (!end || !FIRST_SCANS.has(end.action)) return idle;
  const kind = end.action === WALK_ACTION ? 'walk' : 'circle';
  const who = kind === 'circle' ? end.target?.name ?? null : null;
  // Stopped by Stop is a calm end; a code that isn't 0, or an end with no code
  // that the server called anything but "ok", is a stop with a reason.
  const failed = end.exitKind === 'stopped' ? false
    : end.exitCode != null ? end.exitCode !== 0
      : end.exitKind != null && end.exitKind !== 'ok';
  const failure = Array.isArray(end.failure) && end.failure.length ? end.failure.join('\n') : null;
  if (kind === 'walk') {
    // Done is the people saved, however it ended: finished, stopped, or failed
    // while saving the photos, which are optional.
    const saved = first(status);
    if (saved > 0) return { ...idle, kind, state: 'done', done: saved, total: saved };
    if (failed) return { ...idle, kind, state: 'failed', failure };
    return { ...idle, kind, state: end === status && !(status.log || []).some((l) => JOB_OVER.test(String(l ?? '').trim())) ? 'saving' : 'failed' };
  }
  if (failed) return { ...idle, state: 'failed', who, failure };
  // Another job runs now, so this one's log is gone: it ended calmly, and that is all there is to know.
  if (end !== status) return { ...idle, state: 'done', who };
  const log = (Array.isArray(status.log) ? status.log : []).map((l) => String(l ?? '').trim());
  if (!log.some((l) => JOB_OVER.test(l))) return { ...idle, state: 'saving', who };
  const hidden = log.some((l) => LIST_HIDDEN.test(l));
  if (hidden || log.some((l) => NOBODY_READ.test(l))) return { ...idle, state: 'empty', who, hidden };
  return { ...idle, state: 'done', who };
}

/**
 * Which scan the setup is watching: the startedAt of the first scan it
 * started, `startedFor` saying which (the person's id for a circle, WALK_ACTION
 * for the walk), so Try again or someone else is watched in its place, and the
 * queue's next circle never is. With nothing started here (the setup opened
 * while one ran), the first such scan it sees running.
 */
export function followedScan(prev, status, startedFor = null) {
  if (!status?.running || !FIRST_SCANS.has(status.action) || status.startedAt == null) return prev ?? null;
  if (status.startedAt === prev) return prev;
  const mine = status.action === WALK_ACTION ? startedFor === WALK_ACTION : status.target?.id === startedFor;
  if (startedFor != null ? mine : prev == null) return status.startedAt;
  return prev ?? null;
}

/**
 * The moment the field question shows during a first scan: once the reading
 * has begun, not while Chrome opens: for the walk, once the platform has said
 * how many; for a circle, once a page is read.
 */
export function fieldMoment(scan) {
  if (scan?.state === 'saving') return true;
  if (scan?.state !== 'running') return false;
  return scan.kind === 'walk' ? scan.total != null : scan.pages > 0 || scan.found > 0;
}

/**
 * Does the setup ask for your field while the first scan reads? Once, for
 * anyone who hasn't picked one (Scores → Your sector) or answered or skipped
 * it before (`fieldAsked`): the minute or two you'd otherwise spend watching a
 * bar, and the last moment it's asked, since the Scan page only asks it before
 * anyone in a circle is saved (lib/scanner-setup.js askForField). Not while
 * your settings are unknown (undefined) or couldn't be read (null).
 */
export function asksField(settings) {
  return Boolean(settings && !settings.fieldAsked && !settings.sectorFocus?.sectors?.length);
}

const READS_YOURS = new Set(['full', 'refresh']);
const JOB_END = /^(Finished\.|Stopped\.|Stopped \(exit -?\d+\)\.)$/;

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
 * The scanner's steps need a scanner: with nobody yet and none installed,
 * it's Welcome, where the CSV is, however far an earlier setup got. Otherwise
 * Welcome until you've chosen to set up scanning (from the CSV step, with or
 * without a CSV), unless the app already shows you have (the "I understand",
 * or a sign-in). A first scan running is where its progress shows.
 */
export function onboardingStep(status, memory = {}, gate = null) {
  if (!status) return null;
  if (['running', 'saving'].includes(firstScan(status).state)) return 'map';
  // With nobody yet and no scanner, there's nothing to set up: Welcome, for the CSV.
  if (!(first(status) > 0) && scannerKind(status.capabilities) === 'none') return 'welcome';
  const signedIn = Boolean(status.checks?.signedIn);
  const begun = memory.started || signedIn || status.checks?.riskAccepted === true;
  if (!begun) return 'welcome';
  // `gate` is appManagementGate's: on a Mac, Get ready holds until App Management is on.
  if (!readyChecks(status).done || (gate && !gate.canContinue)) return 'ready';
  if (!signedIn) return 'connect';
  if (!memory.paced && pacesFor(status.capabilities)) return 'pace';
  return 'map';
}

/** The scanner's steps, past Welcome: a kept one of these is a setup left halfway. */
const SCANNER_STEPS = new Set(['ready', 'connect', 'pace', 'map']);

/**
 * The step a setup was left on (the kept `setupStep`), when it's one of the
 * scanner's; else null. Turning App Management on makes macOS quit and reopen
 * Sixgree, and by then the CSV has put people in your network, so this is
 * what brings the setup back rather than the map.
 */
export function setupLeftAt(saved) {
  return SCANNER_STEPS.has(saved) ? saved : null;
}

/**
 * Does the map open on the setup? Always with no network yet (your own: never
 * the sample or a CSV kept outside it). With one: when the setup was left on
 * one of the scanner's steps (`saved`, the kept setupStep), and for someone
 * this browser saw start the setup whose first scan finished before they
 * pressed Open the map. Someone with a network who never used the setup never
 * sees it.
 */
export function opensSetup({ firstDegree = 0, demo = false, csv = false, memory = {}, saved = null } = {}) {
  if (demo || csv) return false;
  if (!(firstDegree > 0)) return true;
  if (setupLeftAt(saved)) return true;
  return memory.started === true && memory.finished !== true;
}

/**
 * How it opens, once opensSetup says it does: true, the setup on its step, or
 * 'again', only "Your galaxy is ready" (app/page.js then marks it finished).
 * 'again' is for a first scan that ended before Open the map: an earlier
 * setup's, which read your connections (this browser saw it start and not
 * finish), or this one's, kept on First scan with people in a circle already.
 */
export function setupMode({ firstDegree = 0, secondDegree = 0, saved = null, memory = {} } = {}) {
  if (!(firstDegree > 0)) return true;
  if (memory.started === true && memory.finished !== true) return 'again';
  if (setupLeftAt(saved) && !(saved === 'map' && secondDegree > 0)) return true;
  return 'again';
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
