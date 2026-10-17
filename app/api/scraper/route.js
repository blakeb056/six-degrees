import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { release as osRelease } from 'node:os';
import { projectRoot, dataDir } from '../../../lib/paths';
import { findScanner, SCANNER_MISSING } from '../../../lib/scanner-files';
import { resolveProfile, networkCounts } from '../../../lib/profile';
import { scanProgress, mappingNow, needsYou } from '../../../lib/scan-progress';
import { linkedinState, linkedinUsage, writeLimits, readLimits, devMode, applyLockedModes } from '../../../lib/linkedin-limits';
import { liftLimits, putLimitsBack, liftedAt, liftEnded } from '../../../lib/limits-lift';
import { pausedList, readProgress, readUnclear, yourListNote, nextPageToRead } from '../../../lib/paused';
import { breachNotes, breachRoundArgs, companyName } from '../../../lib/breach';
import { mutualNotes, mutualRound } from '../../../lib/mutual-web';
import { getDb, backUpDailyIfDue } from '../../../lib/db-client';
import { db as notesDb } from '../../../lib/db';
import { scanDoneNotification } from '../../../lib/notifications';
import { registerScanState, runningNow } from '../../../lib/scan-state';
import { pendingImport } from '../../../lib/data-import';
import { waitingPhotoCount } from '../../../lib/photos';
import { readSettings } from '../../../lib/settings';
import { pluginsEnabled, scannerCapabilitiesNow } from '../../../lib/plugins-view';
import { capabilityRefusal, settingRefusal, lockedModes, circleMode, pluginTooOld, pluginHas, AUTO_NEEDED } from '../../../lib/scanner-capabilities';
import { riskAccepted, touchesLinkedIn, RISK_REFUSAL } from '../../../lib/scan-risk';
import { reachIndex, circleState, cleanProfileUrl } from '../../../lib/reach';
import { scannerEnvWithPanel } from '../../../lib/linkedin-panel';
import { chromeInstalled, signedInFrom, macosVersion, SIGNED_IN_FILE, CHROME_REFUSAL } from '../../../lib/scanner-setup';
import { checkAppManagement } from '../../../lib/app-management';
import { FIRST_SCAN_PAGES } from '../../../lib/onboarding';
import { installKind } from '../../../lib/release';
import { AUTO_REFUSAL, connectResultIn, connectMarks, inviteRefusal, personRefusal } from '../../../lib/auto-connect';
import { markSentRows, awardXP, whose, requestStanding } from '../../../lib/requests';
import {
  pythonLooker, thisHostKey, scannerCommand, installSteps, downloadedPython, downloadVerified,
  placeDownloadedPython, sweepSetupLeftovers, megabytes, SETUP_WORK_PREFIX, ScannerSetupError,
} from '../../../lib/scanner-python';
import { enqueue, nextUp, removeItem, skipItem, clearQueue, queueView, queueKind, waitingIn, QUEUE_CAP, DEV_QUEUE_CAP } from '../../../lib/scan-queue';
import { loadQueue, saveQueue } from '../../../lib/scan-queue-store';
import { AUTO_PACES, autoPlan, cleanPace, cleanTiers, tierList, MANUAL_STOPS_AUTO } from '../../../lib/auto-scan';
import { exitOutcome } from '../../../lib/scan-exit';
import { windowRefusal } from '../../../lib/scan-windows';
import { experienceCounts, experienceCard } from '../../../lib/experience';
import { DEFAULT_ROUND, circleRoundArgs, knownCount, personRounds, roundState } from '../../../lib/scan-rounds';
import { ensureChimes } from '../../../lib/chime-files';

// The app runs the scraper itself.
//
// It used to be a second Python HTTP server on port 5555 that the user had to
// start by hand in a second terminal before the Setup buttons did anything.
// That is the step everyone fell off — the app looked broken while it was
// simply waiting for a server nobody had been told to start clearly enough.
//
// This route is behind the same gate as the destructive ones (lib/gate.js): it
// spawns processes, which is more power than deleting a row, so it must never
// be reachable from another machine. Actions are a fixed enum — no part of a
// command line ever comes from the request.

const MAX_LOG = 500;

// Registered in lib/scan-state.js so other routes can see whether a job runs.
const state = registerScanState({
  running: false,
  action: null,
  target: null,    // who a scan is of: { id, name } (either may be null), or null for scans of no one
  recent: [],      // the last few finished jobs, newest first: how each one ended
  log: [],
  startedAt: null,
  exitCode: null,
  child: null,
  abort: null,     // a step that runs inside this server (the Python download): its AbortController
  stopping: false,
  stderrTail: [],
  failure: null,   // the last lines of stderr from a run that failed — its reason
  pages: 0,        // pages the running scan has read: the dots along the header's line (app/components/ScanTrail.js)
  found: [],       // how many people each of those pages found: the Scan page's cluster (app/components/ScanRadar.js)
  invitee: null,   // Auto's person: { id, name, profileUrl, userId, bridgeId }, looked up here (connectTarget)
  outcome: null,   // how Auto's request went: the scanner's "Connect result: …" line (lib/auto-connect.js)
  port: null,      // the port this app was last asked on, for the job the queue starts by itself
  limitHit: null,  // when a limit last held a scan back (the scan window, or profile views a day: a press refused, or a scan that stopped at it), ms
  autoSitting: false,  // the running job is one of Auto scan's sittings (autoTick)
});

// What runs next (lib/scan-queue.js): read from the data folder the first time
// it's needed, so a restart keeps it, waiting for you (lib/scan-queue-store.js).
// On globalThis like the state above, however the bundler splits this route.
const QUEUE = Symbol.for('six-degrees.scan-queue');
function queue() {
  return (globalThis[QUEUE] ??= loadQueue(dataDir()));
}
function queueChanged() {
  saveQueue(dataDir(), queue());
}
// A breath between one job's end and the next one's start.
const QUEUE_GAP_MS = Number(process.env.SIX_DEGREES_QUEUE_GAP_MS) >= 0 && process.env.SIX_DEGREES_QUEUE_GAP_MS !== undefined
  ? Number(process.env.SIX_DEGREES_QUEUE_GAP_MS) : 4000;
let nextTimer = null;

// Auto scan (experimental, the header's button; lib/auto-scan.js): short
// sittings, each one ordinary job here (`--auto-bridge --experimental
// --sitting=N`), with the rest between them kept in this server, no browser
// open. Only while the app is open, and never started by a restart: it's off
// until you press Start. The order with the queue: what you queue goes first,
// and a sitting starts only when nothing runs and nothing waits.
const AUTO_KEY = Symbol.for('six-degrees.auto-scan');
function auto() {
  return (globalThis[AUTO_KEY] ??= {
    on: false, pace: 'medium', tiers: ['S', 'A'], showWindow: false,
    restUntil: null, sitting: null, sittings: 0, plan: null, ended: null, timer: null, ticking: false,
  });
}
// The clock, which the tests set (Symbol.for('six-degrees.auto-clock')).
const autoNow = () => globalThis[Symbol.for('six-degrees.auto-clock')]?.() ?? Date.now();const AUTO_TICK_MS = Number(process.env.SIX_DEGREES_AUTO_TICK_MS) > 0 ? Number(process.env.SIX_DEGREES_AUTO_TICK_MS) : 20000;

/**
 * What Auto scan would do now, from the scan window and the cooldown. While the
 * limits are lifted for this session linkedinState gives no cooldown, so Auto
 * scan's hours, its rests and the windows (at their ceilings) hold it back; in
 * Dev mode its rests, which are its pace, and the windows. Manual mode stops it.
 */
function autoPlanNow() {
  const a = auto();
  const now = autoNow();
  const li = linkedinState(dataDir(), now);
  return autoPlan({
    now, pace: a.pace, restUntil: a.restUntil,
    left: li.searchesLeft, opensAt: li.window?.nextOpensAt ?? null, cooldown: li.cooldown,
    anyHour: li.dev === true, manual: li.limits?.manual === true,
  });
}

/** How many may wait in the queue: QUEUE_CAP, or DEV_QUEUE_CAP in Dev mode. */
function queueCap() {
  try {
    return devMode(dataDir()) ? DEV_QUEUE_CAP : QUEUE_CAP;
  } catch {
    return QUEUE_CAP;
  }
}

/** Auto scan, for the button, its panel and the notch. From memory: the plan is the last tick's. */
function autoView() {
  const a = auto();
  const base = { on: a.on, pace: a.pace, tiers: a.tiers, sittings: a.sittings, ended: a.ended };
  if (!a.on) return { ...base, phase: 'off' };
  if (state.running && state.autoSitting) return { ...base, phase: 'running', sitting: a.sitting };
  const plan = a.plan || { kind: 'go' };
  if (plan.kind === 'go') {
    if (state.running) return { ...base, phase: 'waiting', reason: 'Another scan is running. The next sitting starts after it.' };
    const q = queue();
    if (waitingIn(q).length) {
      return { ...base, phase: 'waiting', reason: q.paused ? 'The queue is paused. Resume or clear it in the notch, and Auto scan carries on.' : 'Your queued scans go first.' };
    }
    return { ...base, phase: 'starting' };
  }
  return { ...base, phase: plan.kind === 'stop' ? 'starting' : plan.kind, until: plan.until ?? null };
}

/** Auto scan ends: 'done' (nothing left), 'limit', or 'stopped', with why. */
function autoEnd(phase, reason = null) {
  const a = auto();
  clearInterval(a.timer);
  Object.assign(a, { on: false, timer: null, restUntil: null, plan: null, sitting: null, ended: { phase, reason, at: autoNow() } });
}

/** Start a sitting if one is due and the scanner is free; otherwise note why not. */
async function autoTick() {
  const a = auto();
  if (!a.on || a.ticking || state.running) return;
  a.ticking = true;
  try {
    // Only with the auto plugin (lib/scanner-capabilities.js): one removed, or
    // plugins switched off, while Auto scan rests ends it here, with why.
    if (!scannerCapabilitiesNow().auto) return autoEnd('stopped', AUTO_NEEDED);
    const plan = autoPlanNow();
    a.plan = plan;
    if (plan.kind === 'stop') {
      // At a limit the notch says which, as for a press held back.
      if (plan.as === 'limit') state.limitHit = Date.now();
      return autoEnd(plan.as, plan.reason);
    }
    // Your queue goes first, paused or not: Stop held it for you.
    if (plan.kind !== 'go' || waitingIn(queue()).length) return;
    a.sitting = plan.sitting;
    const res = await startJob({
      action: 'auto-bridge', order: 'score', tiers: a.tiers, maxPages: 100, deeper: true,
      ...(a.showWindow ? { showWindow: true } : {}),
    }, { sitting: plan.sitting });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (state.running && d.error === 'Something is already running.') return;
      autoEnd('stopped', d.error || 'Auto scan could not start.');
    }
  } finally {
    a.ticking = false;
  }
}

/** A sitting has ended: rest, or end Auto scan with why. */
function autoSittingEnded(code, stopped, log, failure) {
  const a = auto();
  if (!a.on) return;
  a.sittings += 1;
  if (stopped) return autoEnd('stopped', null);
  if (code !== 0) return autoEnd('stopped', failure?.[failure.length - 1] || `The scanner stopped (exit ${code}).`);
  if (log.some((l) => /Nothing left to bridge\./.test(l))) {
    return autoEnd('done', `Everyone in ${tierList(a.tiers)} has been scanned. Pick more tiers to carry on.`);
  }
  a.restUntil = autoNow() + AUTO_PACES[a.pace].rest * 1000;
  a.plan = { kind: 'rest', until: a.restUntil };
}

/** Why Auto scan can't start at all, said at Start rather than at 9:00: the checks a sitting runs. */
async function autoRefusal() {
  // First: without the scanner, nothing else it would ask about matters.
  if (!scannerHere().found) return { error: SCANNER_MISSING, scannerMissing: true };
  // Auto scan is the auto plugin's (lib/scanner-capabilities.js). Looked at
  // here, which also takes manual mode off with only that plugin, so the
  // manual-mode check below can't hold it back with no switch to change.
  if (!capabilitiesHere().auto) return { error: AUTO_NEEDED, needsPlugin: 'auto' };
  if (!scanRisk()) return { error: RISK_REFUSAL, needsRiskAcceptance: true };
  if (!chromeHere()) return { error: CHROME_REFUSAL, needsChrome: true };
  if (pendingImport(dataDir())) return { error: 'An import is waiting to finish. Restart Sixgree first (Settings → Your data), then scan.' };
  if (!(await machineChecks()).python.run) return { error: 'The scanner’s packages are not installed yet. Do step 1 first.' };
  if (readLimits(dataDir()).manual) return { error: MANUAL_STOPS_AUTO.replace('so Auto scan has stopped', 'so Auto scan can’t start'), manualMode: true };
  return null;
}

// A page read, as scripts/scrape.py prints it: "  Page 3... " as a circle or a
// company scan reads each page, and "  350 / 817 collected" for each fifty
// people of your own connections list. Counted as the lines arrive, since the
// log only keeps its last MAX_LOG lines.
const PAGE_READ = /^\s*Page \d+\.\.\.|\d+\s*\/\s*\d+\s+collected/;
// What a page found, which the scanner prints after "Page N... " once it's read:
// "10 found (total: 30)" in a circle, "7 found (2 with images)" for a company.
const PAGE_FOUND = /(\d+) found \((?:total: \d+|\d+ with images)\)/;
const MAX_PAGES_KEPT = 400;
// A break by hand's countdown, a line a second (scrape.py _manual_break): only the
// newest is kept, so a five-minute break doesn't push the rest of the log out. The
// scan light reads the newest line (lib/scan-light.js).
const BREAK_TICK = /^\s*\(break after page \d+: \d+ s, then page \d+\)$/;
// What the scanner says when a limit stops a scan (scrape.py budget_message) is
// read in lib/scan-exit.js now, only for a scanner from before its exit codes.

/** Stop the running job without orphaning the browser it opened.
 *
 *  The child is spawned into its own process group, so the negative pid
 *  signals Chrome too — killing only the Python process would leave a browser
 *  window open with a live LinkedIn session in it. SIGTERM first, because the
 *  scraper catches it and closes the browser itself; SIGKILL only if that is
 *  ignored. A step running inside this server (the Python download) stops at
 *  once, and nothing it fetched is kept.
 */
function stopChild() {
  if (state.abort) {
    state.stopping = true;
    push('Stopping…');
    state.abort.abort(new ScannerSetupError('Stopped.'));
    return;
  }
  const child = state.child;
  if (!child) return;
  state.stopping = true;
  push('Stopping…');
  const pid = child.pid;
  // Windows has no process groups or SIGTERM. taskkill /T walks the tree the
  // scanner started; without /F it asks Chrome's windows to close, so the
  // browser shuts down cleanly and keeps the LinkedIn session. Forced after 5 s.
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    setTimeout(() => {
      if (state.child && state.child.pid === pid) {
        push('Still running. Forcing it to stop.');
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      }
    }, 5000);
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch {} }

  setTimeout(() => {
    if (state.child && state.child.pid === pid) {
      push('Still running. Forcing it to stop.');
      try { process.kill(-pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch {} }
    }
  }, 20000);
}

function push(line) {
  for (const part of String(line).split('\n')) {
    const t = part.replace(/\s+$/, '');
    if (!t) continue;
    if (BREAK_TICK.test(t) && BREAK_TICK.test(state.log[state.log.length - 1] || '')) {
      state.log[state.log.length - 1] = t;
      continue;
    }
    state.log.push(t);
    if (PAGE_READ.test(t)) {
      state.pages += 1;
      // Fifty of your own list at a time; a page's count comes on its next line.
      state.found.push(/collected/.test(t) ? 50 : 0);
      if (state.found.length > MAX_PAGES_KEPT) state.found.splice(0, state.found.length - MAX_PAGES_KEPT);
    }
    const got = t.match(PAGE_FOUND);
    if (got && state.found.length) state.found[state.found.length - 1] = Number(got[1]);
    // Auto's one line saying how the request went (scrape.py main, --connect).
    const result = state.action === 'connect' && connectResultIn(t);
    if (result) state.outcome = result;
  }
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

// Which Python runs the scanner is decided in lib/scanner-python.js
// (choosePython): the Mac app's own first (SIX_DEGREES_PYTHON, from the app),
// then the scanner's environment in the data folder, then a Python on this
// computer that already has the packages.
//
// The environment is what Install builds, never the machine's own Python, for
// two reasons that between them are why a hand-run install could appear to
// succeed and still leave nothing working (TRAPS §14):
//
//  1. `python3` on PATH is often Homebrew's, while the interpreter that already
//     has Playwright is /usr/bin/python3. Installing into one and running the
//     other looks identical to a broken install.
//  2. Homebrew and system Pythons are "externally managed" (PEP 668) and refuse
//     `pip install` outright, with an error most people read as a dead end.
//
// A virtualenv in the data directory has neither problem, is thrown away with
// the rest of the folder, and never touches the machine's Python. When the
// computer has no Python to build it from, "Set up the scanner" first downloads
// a standalone one into the data folder (a click, never by itself).

/** Who the scraper found to be private, so the app can report honestly.
 *
 *  This is scraper bookkeeping, not network data — it lives in a JSON file
 *  beside the database rather than in the schema. The profile page needs it to
 *  distinguish "not tried yet" from "will never work", which are very
 *  different numbers to show someone deciding whether they are finished.
 */
function bridgeSkips() {
  try {
    const raw = readFileSync(path.join(dataDir(), 'bridge-skips.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Object.entries(parsed).map(([profileUrl, v]) => ({
      profileUrl,
      name: v?.name ?? '',
      reason: v?.reason ?? '',
      at: v?.at ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * What lib/reach.js needs from the scanner's files to tell who is ready for a
 * circle scan: whose list is hidden, and whose list has been read even though
 * nothing in it was saved (everyone on it was already yours). Read on its own,
 * without the machine checks, because the map asks for it when it loads and
 * again after every scan.
 */
function scanNotes() {
  let read = [];
  const lists = {};
  try {
    const me = resolveProfile({ create: false });
    if (me) {
      const progress = readProgress(dataDir(), me.id);
      read = Object.keys(progress);
      // How far each list was read, and how long it is (the search's count, or the
      // one on their profile, "500+" as connectionsPlus), for the ring round a dot
      // (lib/reach.js scanFill).
      for (const [url, e] of Object.entries(progress)) {
        const connections = Number.isInteger(e?.connections) && e.connections >= 0 ? e.connections : null;
        lists[url] = { pages: Number(e?.pages) || 0, more: !!e?.more, total: Number(e?.total) || null,
          connections, connectionsPlus: connections != null && e?.connectionsPlus === true,
          // Pages read past a gap (scrape.py readPages): the ring counts them too.
          ...(Array.isArray(e?.readPages) ? { readPages: e.readPages } : {}) };
      }
    }
  } catch {}
  // The pages a round of a circle scan reads (lib/scan-rounds.js), for the rounds round a dot.
  let round = DEFAULT_ROUND;
  try { round = readLimits(dataDir()).roundPages; } catch { /* the default */ }
  return { skips: bridgeSkips(), read, lists, round };
}

/**
 * One of your connections, for the Scan page's "Scan one circle" box (Bridge
 * Chains and the Degrees panel send people there by id): who they are, and how
 * their circle stands by the same rule the map uses. Null when not found.
 */
function pickedPerson(id) {
  try {
    const me = resolveProfile({ create: false });
    if (!me) return { person: null };
    const db = getDb();
    const row = db.prepare(
      `SELECT id, name, tier, power_score, degree, profile_url, unlocked_from_bridge_id, unlocked_from_name, experience
         FROM linkedin_connections WHERE id = ? AND user_id = ? AND degree = 1`,
    ).get(String(id ?? ''), me.id);
    if (!row) return { person: null };
    const mapped = db.prepare(
      'SELECT 1 FROM linkedin_connections WHERE user_id = ? AND degree = 2 AND source_connection_id = ? LIMIT 1',
    ).get(me.id, row.id);
    const notes = scanNotes();
    const reach = reachIndex([], mapped ? [{ source_connection_id: row.id }] : [], notes);
    return {
      person: {
        id: row.id, name: row.name, tier: row.tier, power_score: row.power_score,
        unlocked_from_bridge_id: row.unlocked_from_bridge_id, unlocked_from_name: row.unlocked_from_name,
      },
      circle: circleState(row, reach),
      // Where their rounds stand (lib/scan-rounds.js): "Round 2 of 4", and Scan next round.
      round: personRounds(row, reach, { round: notes.round }),
    };
  } catch {
    return { person: null };
  }
}

// The look for a Python spawns processes, so it is cached for a few seconds,
// and callers that arrive while a look is under way share it rather than each
// starting their own Pythons. Everything else (Chrome and signed in, which are
// file checks; the running job, its log, how far it has got; the counts) is
// read fresh on every call: the page polls every 1.5 s, a progress bar that
// moves every 4 s looks stuck, and step 1 ticks the moment Chrome is installed.
let cached = { at: 0, value: null };
let looking = null;
let lookGeneration = 0;

/** Forget the last look, after something that changes its answer (a job starting or ending). */
function forgetChecks() {
  lookGeneration++;
  cached = { at: 0, value: null };
  looking = null;
}

// The Python the app ships can't change while this server runs, so once it has
// been seen to work it isn't started again to ask: each look costs a Python
// start, and the page asks every 1.5 seconds. Once it has failed it isn't
// started again at all until the server restarts (it used to be asked again
// every minute), so a Python macOS refuses to run can't keep bringing macOS's
// alert back; the page says what happened instead. (lib/scanner-python.js
// pythonLooker.) Kept once per server process, like the scan state
// (lib/scan-state.js): a second copy of this module (the bundler's, or a reload
// while developing) must not start a failed Python afresh.
const LOOKER = Symbol.for('six-degrees.python-looker');
const lookForPython = (globalThis[LOOKER] ??= pythonLooker());

let host;
function hostOnce() {
  if (host === undefined) host = thisHostKey();
  return host;
}

async function look() {
  const root = projectRoot();
  const python = await lookForPython(process.env.SIX_DEGREES_PYTHON || '', {
    app: process.env.SIX_DEGREES_APP || '',
    dataDir: dataDir(),
    host: hostOnce(),
  });

  return { root, python };
}

/**
 * Where scans get the scanner from (lib/scanner-files.js findScanner): an
 * installed scanner plugin while Settings → Plugins has Enable plugins on,
 * otherwise the app's own. Looked at afresh each time: a plugin is checked
 * file by file, which costs a millisecond or two.
 */
function scannerHere(root = projectRoot()) {
  return findScanner(root, { dataDir: dataDir(), pluginsEnabled: pluginsEnabled() });
}

/**
 * What the scanner unlocks (lib/scanner-capabilities.js), looked at afresh,
 * with scan-limits.json brought into line with it first (lockedModes): with
 * only the manual plugin, manual mode on and Dev mode off; with only the auto
 * plugin, manual mode off. The scanner reads both from that file and nowhere
 * else (scrape.py manual_reads, dev_mode), so this runs before every scan, and
 * whenever the Scan page looks, so its switches and the file agree.
 */
function capabilitiesHere() {
  const caps = scannerCapabilitiesNow();
  applyLockedModes(dataDir(), lockedModes(caps));
  return caps;
}

/** Google Chrome, where Playwright's "chrome" channel looks (lib/scanner-setup.js). A file check, so cheap enough for every POST. */
function chromeHere() {
  return chromeInstalled({ platform: process.platform, env: process.env, exists: existsSync });
}

/**
 * Signed in to LinkedIn in the scanner's Chrome: the scanner's own note once
 * it has confirmed the session (lib/scanner-setup.js signedInFrom). A folder
 * from before the note goes by Chrome's cookie file, as it always did; Windows'
 * Chrome keeps that one folder down, in Default\Network.
 */
function signedIn() {
  const data = dataDir();
  let note = null;
  try { note = JSON.parse(readFileSync(path.join(data, SIGNED_IN_FILE), 'utf8')); } catch { /* none yet, or unreadable: the old check */ }
  const profile = path.join(data, 'chrome-profile', 'Default');
  return signedInFrom({
    note,
    profile: existsSync(path.join(data, 'chrome-profile')),
    cookies: existsSync(path.join(profile, 'Cookies')) || existsSync(path.join(profile, 'Network', 'Cookies')),
  });
}

// The "I understand" before the first scan: given on the Scan page, or implied by
// the scanner's own Chrome profile, which only a scan before it could have made.
function scanRisk() {
  let acceptedAt = null;
  try { acceptedAt = readSettings(getDb()).scanRiskAccepted; } catch { /* unreadable: ask */ }
  return riskAccepted({ acceptedAt, scannedBefore: existsSync(path.join(dataDir(), 'chrome-profile')) });
}

function machineChecks() {
  if (Date.now() - cached.at < 4000 && cached.value) return Promise.resolve(cached.value);
  if (looking) return looking;
  const generation = lookGeneration;
  const current = look().then((value) => {
    // A job that started or ended meanwhile makes this look stale: don't keep it.
    if (generation === lookGeneration) cached = { at: Date.now(), value };
    return value;
  }).finally(() => {
    if (looking === current) looking = null;
  });
  looking = current;
  return current;
}

/** People whose list was only partly read, for the Scan page's Paused list. */
function paused(userId) {
  if (!userId) return [];
  try {
    const db = getDb();
    const first = db.prepare(
      `SELECT id, name, tier, profile_url, connected_date, created_at, experience
         FROM linkedin_connections WHERE user_id = ? AND degree = 1`,
    ).all(userId);
    const mapped = new Set(db.prepare(
      `SELECT DISTINCT source_connection_id AS id FROM linkedin_connections
        WHERE user_id = ? AND degree = 2 AND source_connection_id IS NOT NULL`,
    ).all(userId).map((r) => r.id));
    const progress = readProgress(dataDir(), userId);
    const round = readLimits(dataDir()).roundPages;
    const byId = new Map(first.map((r) => [r.id, r]));
    // Each with where their rounds stand (lib/scan-rounds.js), for "Round 2 of 4" and Scan next round.
    return pausedList(first, mapped, progress, readUnclear(dataDir())).map((p) => {
      const note = progress[p.profileUrl] || null;
      return { ...p, round: roundState(note, { round, count: knownCount(note, experienceCard(byId.get(p.id))), legacy: !note }) };
    });
  } catch {
    return [];
  }
}

async function status() {
  const m = await machineChecks();
  const chrome = chromeHere();
  // Which scanner, looked at afresh on every call, unlike the Python above: a
  // plugin installed or switched on a moment ago shows at once.
  const scanner = scannerHere(m.root);

  // How much is already mapped, by degree, so the page can mark the scan step
  // done and offer the way to the galaxy instead of leaving someone on a form.
  let network = { first: 0, second: 0, third: 0 };
  let me = null;
  try {
    me = resolveProfile({ create: false });
    if (me) network = networkCounts(me.id);
  } catch {}
  // People whose photo is still a link, which the app doesn't load: Save
  // photos appears while there are any (lib/photos.js).
  let photosWaiting = 0;
  try { photosWaiting = waitingPhotoCount(getDb()); } catch {}
  // Read profiles (Scanner settings): how many of your connections have their
  // experience read, couldn't be read, or wait for a round (lib/experience.js).
  let experience = null;
  try {
    if (me) {
      experience = experienceCounts(getDb().prepare(
        'SELECT degree, profile_url, power_score, experience FROM linkedin_connections WHERE user_id = ? AND degree = 1',
      ).all(me.id));
    }
  } catch { experience = null; }

  // What the scanner unlocks, afresh, with scan-limits.json brought into line
  // with it before linkedinState reads it below. Unreadable: the job answer's.
  let capabilities = null;
  try { capabilities = capabilitiesHere(); } catch { /* the job answer's look, below */ }

  const py = m.python;
  return {
    ready: Boolean(scanner.found && py.run && chrome),
    // Whose circle is being read now, for the Scan page's "Watch it fill in".
    mapping: mappingWho(me?.id),
    checks: {
      // The scanner's files are here, built in or from a plugin (lib/scanner-files.js); the page says "Not installed" when not.
      scriptsFound: scanner.found,
      // Which scanner scans run: 'plugin' (and which) or 'built-in', the program
      // itself, and why an installed scanner plugin wasn't used, when one wasn't.
      scanner: { from: scanner.from, plugin: scanner.plugin, script: scanner.script, skipped: scanner.skipped },
      // A Python that runs the scanner, or one Install can build its environment from.
      python: Boolean(py.run || py.base),
      pythonPath: py.run?.path || py.base?.path || null,
      pythonVersion: py.run?.version || py.base?.version || null,
      // Where the one that runs it comes from: 'bundled' (the Mac app's own),
      // 'custom' (named in SIX_DEGREES_PYTHON), 'venv' or 'system'.
      pythonSource: py.run?.source || null,
      dependencies: Boolean(py.run),
      // The named Python, when it didn't work: { source, problem }.
      ownPython: py.own,
      // What Install would build the scanner's environment from: { source: 'system'|'downloaded', version }.
      installFrom: py.base ? { source: py.base.source, version: py.base.version } : null,
      // A Python this computer has that won't do, when there is no other: { version, venv }.
      systemPython: py.systemFound,
      // What "Set up the scanner" would download, when there is nothing to install from.
      download: py.download ? { version: py.download.version, size: py.download.size, from: 'github.com' } : null,
      chrome,
      signedIn: signedIn(),
      // The one-time "I understand" before the first scan (lib/scan-risk.js).
      riskAccepted: scanRisk(),
      // Step 1's App Management item (lib/scanner-setup.js appManagementStep):
      // which macOS, so its button opens the pane where that version keeps it,
      // and whether this is the Mac app, the name macOS asks about. null off a Mac.
      mac: process.platform === 'darwin'
        ? { version: macosVersion(process.platform, osRelease()), app: installKind(process.env, projectRoot()) === 'mac-app' }
        : null,
    },
    network,
    photosWaiting,
    experience,
    ...job(),
    ...(capabilities ? { capabilities } : {}),
    skips: bridgeSkips(),
    linkedin: linkedinState(dataDir()),
    paused: paused(me?.id),
    // How far the read of your connections through LinkedIn's search got (lib/paused.js yourListNote).
    yourList: me ? yourListNote(readProgress(dataDir(), me.id)) : null,
    // How far each company's search for Breach got, by its key (lib/breach.js breachNotes).
    breach: me ? breachNotes(readProgress(dataDir(), me.id)) : {},
    // How far each Read all mutuals got, by profile URL (lib/mutual-web.js mutualNotes).
    mutuals: me ? mutualNotes(readProgress(dataDir(), me.id)) : {},
  };
}

/**
 * Whose circle the running scan is reading: { id, name } of one of your
 * connections, or null. A scan of one person knows its target; a batch (Map
 * 2nd degree, every paused list) prints each person's name as it starts
 * (lib/scan-progress.js mappingNow), found here among your connections. Two
 * with that name can't be told apart that way, so neither is named.
 */
function mappingWho(userId) {
  if (!state.running) return null;
  if (state.target?.id && ['bridge', 'rescrape', 'resume'].includes(state.action)) return { id: state.target.id, name: state.target.name };
  const name = mappingNow(state.log, state.action);
  if (!name || !userId) return null;
  try {
    const rows = getDb().prepare(
      'SELECT id FROM linkedin_connections WHERE user_id = ? AND degree = 1 AND name = ? LIMIT 2',
    ).all(userId, name);
    return rows.length === 1 ? { id: rows[0].id, name } : null;
  } catch {
    return null;
  }
}

/**
 * The running job alone, from memory: no checks, no database. Every Scan
 * button in the app asks this (lib/scraper-client.js watchScanner), every few
 * seconds, so it must cost nothing.
 *
 * `recent` is how the last few jobs ended. A page following one job can then
 * learn how it ended even when another job started before it looked again;
 * with only the latest job's exit code, that one would never seem to finish.
 */
function job() {
  return {
    running: state.running,
    action: state.action,
    target: state.target,
    startedAt: state.startedAt,
    exitCode: state.exitCode,
    // What the exit code said (lib/scan-exit.js): 'ok', 'limit', 'pushback', …, or 'stopped'.
    exitKind: state.exitKind ?? null,
    failure: state.running ? null : state.failure,
    progress: state.running ? scanProgress(state.log, state.action) : null,
    // What LinkedIn needs you to do at the scanner's Chrome, now in front, or
    // null: read from the whole log, since the wait can outlast what's sent.
    needsYou: state.running ? needsYou(state.log) : null,
    pages: state.running ? state.pages : 0,
    found: state.running ? state.found : [],
    log: state.log.slice(-120),
    recent: state.recent,
    budget: state.running ? budgetNow() : null,
    // The limits for the notch: lifted for this session, or the scan window just used.
    limits: limitsNow(),
    // What waits to run after this (lib/scan-queue.js queueView), for the notch and the buttons.
    queue: queueView(queue(), { cap: queueCap() }),
    // Auto scan, when it's on or has just ended (autoView).
    auto: autoView(),
    // What the installed scanner unlocks (lib/scanner-capabilities.js): which
    // scan screens and buttons every page shows. A look up to 2 s old.
    capabilities: capabilitiesSeen(),
    // How circle scans run, Automatic or By hand, never both: the header
    // offers Auto scan only with Automatic (lib/scanner-capabilities.js circleMode).
    mode: modeNow(),
  };
}

/** 'auto' or 'manual' (null with no scanner): the installed plugins, then the saved manual-mode setting. */
function modeNow() {
  try {
    return circleMode(capabilitiesSeen(), readLimits(dataDir()).manual === true);
  } catch {
    return null;
  }
}

/** What the scanner unlocks, for the job answer: a recent look is reused, and a failed one reads as not known (null). */
function capabilitiesSeen() {
  try {
    return scannerCapabilitiesNow({ maxAge: 2000 });
  } catch {
    return null;
  }
}

/** The scan window and today's profile views, for the notch every page shows while a scan runs. */
function budgetNow() {
  try {
    const li = linkedinState(dataDir());
    return {
      searches: li.searchesToday ?? 0,
      // The scan window (lib/scan-windows.js scanWindow): "Window 1 of 2: 34 of 60", and when the next opens.
      window: li.window,
      // Profile views a day: their own number, off while lifted.
      profiles: li.profilesToday ?? 0, profileCap: li.lifted ? null : li.limits?.daily ?? null,
      lifted: li.lifted,
      dev: li.dev,
      // The speed it reads at, for the clock a forming circle keeps (lib/forming-circle.js).
      pace: li.limits?.pace ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The limits as the notch shows them, idle or not: { lifted, reached, searches,
 * window, profilesReached }. `reached` only once a limit has held a scan back
 * (state.limitHit), and only while it still would. Nothing is read from disk
 * unless the limits are lifted or one was just held back, so the poll every
 * page makes stays as cheap as the rest of job().
 */
function limitsNow() {
  if (liftedAt() == null && !state.limitHit && !readLimits(dataDir()).dev) return { lifted: false, reached: false };
  try {
    const li = linkedinState(dataDir());
    const profilesOut = li.profilesLeftToday === 0;
    const reached = li.limitReached || profilesOut;
    if (!reached) state.limitHit = null;
    return {
      lifted: li.lifted,
      ...(li.dev ? { dev: true } : {}),
      reached: Boolean(state.limitHit) && reached,
      searches: Number.isFinite(li.searchesToday) ? li.searchesToday : null,
      window: li.window,
      // Only profile views held it back: the lift would carry on (the windows it never passes).
      profilesReached: profilesOut && !li.limitReached,
      daily: li.limits.daily,
    };
  } catch {
    return { lifted: liftedAt() != null, reached: false };
  }
}

/** The refusal when a limit holds a scan back: the scan window, with when the next opens, or profile views a day. */
function limitRefusal() {
  try {
    const u = linkedinUsage(dataDir());
    if (u.limitReached) return windowRefusal(u.window);
    const freeAt = u.profilesFreeAt;
    return `Today’s limit of ${u.limits.daily} profile views is used: it counts the last 24 hours.`
      + `${freeAt ? ` The next one frees up ${new Date(freeAt).toLocaleString()}.` : ''}`
      + ' Lift limits for this session to carry on now.';
  } catch {
    return 'A limit is used. The Scan page says which, and when it frees up.';
  }
}

/** Tell the running scanner the limits changed, so a scan under way follows at once (scrape.py _listen_for_limits). */
function tellScanner(line) {
  try { state.child?.stdin?.write(`${line}\n`); } catch { /* it has ended */ }
}

/**
 * Where Resume would carry on with one of your connections, for their profile
 * card: { nextPage, pagesRead, legacy, readPages? }, or null when there is nothing to carry
 * on with (never mapped, read to the end, hidden). The Paused list's own rules
 * (lib/paused.js), so the card and the Scan page can't disagree.
 */
function resumePoint(id) {
  try {
    const me = resolveProfile({ create: false });
    if (!me) return null;
    const db = getDb();
    const row = db.prepare(
      `SELECT id, name, tier, profile_url, connected_date, created_at
         FROM linkedin_connections WHERE id = ? AND user_id = ? AND degree = 1`,
    ).get(String(id ?? ''), me.id);
    if (!row) return null;
    const mapped = db.prepare(
      'SELECT 1 FROM linkedin_connections WHERE user_id = ? AND degree = 2 AND source_connection_id = ? LIMIT 1',
    ).get(me.id, row.id);
    const [p] = pausedList([row], new Set(mapped ? [row.id] : []), readProgress(dataDir(), me.id), readUnclear(dataDir()));
    return p ? { nextPage: p.nextPage, pagesRead: p.pagesRead, legacy: p.legacy, ...(p.readPages ? { readPages: p.readPages } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * Where one of your connections' circle stands in rounds, for their card's
 * "Round 2 of 4" and Scan next round (lib/scan-rounds.js personRounds, as the
 * Scan page's box has it); null when they aren't found, or their list is hidden.
 */
function roundPoint(id) {
  return pickedPerson(id).round ?? null;
}

export async function GET(request) {
  const q = new URL(request?.url || 'http://127.0.0.1/api/scraper').searchParams;
  if (q.has('job')) return Response.json(job());
  if (q.has('resume')) return Response.json({ resume: resumePoint(q.get('resume')) });
  if (q.has('round')) return Response.json({ round: roundPoint(q.get('round')) });
  if (q.has('reach')) return Response.json(scanNotes());
  // Scan → LinkedIn usage: the scanner's record of searches, profile views
  // and pauses, counted (lib/linkedin-limits.js linkedinUsage). Reads only; no
  // checks, no Python, nothing written.
  if (q.has('usage')) {
    try {
      // How the last lift ended, so the page can say the limits came back when LinkedIn pushed back.
      return Response.json({ ...linkedinUsage(dataDir()), liftEnded: liftEnded() });
    } catch {
      return Response.json({ error: 'The record of LinkedIn searches on this computer could not be read.' }, { status: 500 });
    }
  }
  if (q.has('person')) return Response.json(pickedPerson(q.get('person')));
  // The guided setup's App Management row (lib/app-management.js): whether
  // macOS has it on for Sixgree, read for real. Reads only; asked every 2 s
  // while that step is open, at most once a second.
  if (q.has('appManagement')) {
    return Response.json(await checkAppManagement({ version: macosVersion(process.platform, osRelease()) }));
  }
  return Response.json(await status());
}

// A fixed set. Anything taking a name uses `--flag=value`, a single argv token,
// so a name that begins with "-" can never be read as a flag of its own — and
// spawn takes an array, so there is no shell for it to escape into either.
// How many pages of each list a circle scan may be asked to read: a fixed
// set, like everything else that reaches the command line. 100 is every page.
// FIRST_SCAN_PAGES is the guided setup's first scan, a few pages of one
// circle, gentle on a new account (lib/onboarding.js).
const PAGE_CAPS = Object.freeze([FIRST_SCAN_PAGES, 10, 25, 50, 100]);

const ACTIONS = {
  install:       { label: 'Installing the scanner’s Python packages' },
  // Only when this computer has no Python to install into: downloads the one
  // pinned for it (lib/scanner-python.js), then installs as above.
  setup:         { label: 'Setting up the scanner' },
  login:         { flag: '--login',       label: 'Opening LinkedIn so you can sign in' },
  full:          { flag: '--full',        label: 'Scanning your whole network' },
  refresh:       { flag: '--refresh',     label: 'Checking for new connections' },
  'auto-bridge': { flag: '--auto-bridge', label: 'Mapping every bridge in turn' },
  // Hidden profiles are remembered so they are not retried forever; this is
  // the way back in without a terminal.
  'auto-bridge-retry': { flag: '--auto-bridge --retry-private', label: 'Mapping every bridge, hidden ones included' },
  // One person's circle, from page 1. By profile URL when the page sends their
  // id, as every Scan button does: two connections can share a name, and by name
  // the scanner reads whichever was saved first. By name for a caller with no id.
  bridge:        { flag: '--bridge',   needsName: true, byId: true, label: 'Mapping the circle behind' },
  // Carry on with one person whose read was cut short. By profile URL, not name:
  // two connections can share a name, and Resume must reach the one clicked.
  resume:        { flag: '--bridge-url', needsId: true, label: 'Carrying on with', searches: true },
  // Carry on with everyone whose read was cut short, and nobody new.
  'resume-all':  { flag: '--auto-bridge --only-unfinished', label: 'Carrying on with every paused list', searches: true },
  // Your connections through LinkedIn's people search, for where each one is and the
  // mutuals you share (scrape.py scan_your_connections). Read like a circle: by itself
  // or by hand, whichever circle scans run in, so either plugin runs it.
  'your-connections': { flag: '--your-connections', label: 'Adding locations and mutuals to your connections', searches: true },
  rescrape:      { flag: '--rescrape', needsName: true, label: 'Re-mapping the circle behind' },
  company:       { flag: '--company',  needsName: true, label: 'Scanning' },
  // Breach (app/breach): one small round of a company's people through LinkedIn's
  // people search for its name (scrape.py scan_company_search), with its pages and
  // degrees (lib/breach.js breachRoundArgs). Read like a circle, by itself or by
  // hand, whichever circle scans run in, so either plugin runs it.
  breach:        { flag: '--breach',   needsName: true, label: 'Breach: mapping', searches: true },
  // Read all mutuals (the mutual web, lib/ties.js): one round of the "N other mutual
  // connections" of one person, by id, any degree (scrape.py scan_mutual_list), each
  // one of your connections who knows them kept as a tie. Only when pressed, on a
  // Breach target or a top-tier bridge; never by itself. Read like a circle.
  mutuals:       { flag: '--mutuals',  needsId: true, label: 'Reading all mutuals with', searches: true },
  // Photos an older version kept as links to LinkedIn: saved here, once each.
  // No browser, no search; every scan does the same at its end.
  // Experimental, for the Social tab: your messages list, once (who, when, unread; the
  // newest message's words only while Keep my messages is on).
  messages:      { flag: '--messages',    label: 'Reading your messages list' },
  // The same, scrolling until the whole list has loaded (60 scrolls or about
  // 1,000 conversations at most), for the Social tab's "Read my whole history".
  'messages-full': { flag: '--messages --full-history', label: 'Reading your whole messages history' },
  photos:        { flag: '--save-photos', label: 'Saving profile photos to this computer' },
  // Auto (Blake, 2026-10-03): one connection request, without a note, to one
  // person pressed on a card. By id, looked up here (connectTarget); the URL
  // and name that reach the command line come from the database, never the page.
  connect:       { flag: '--connect', label: 'Sending a connection request to' },
  // Read profiles (Scanner settings → "Read full profiles (experience)", off by
  // default): one round of 5, 10 or 25 of your connections' profiles, highest
  // power first, each a profile view. Its own action, never added to another
  // scan's views (scrape.py read_profiles).
  'read-profiles': { flag: '--read-profiles', label: 'Reading full profiles', searches: true },
  // Profiles opened for you (Connect, View profile) are no job: the desktop
  // app's panel goes straight to them, and app/api/profile-view counts the view.
};
/** The lists read in rounds whose finished list is read again only when asked (scrape.py --again). */
const LIST_AGAIN = ['your-connections', 'breach', 'mutuals'];
/** The rounds Read profiles offers (scrape.py PROFILE_READ_BATCHES). */
const PROFILE_READ_BATCHES = [5, 10, 25];

/**
 * Auto's person, by id: { person: { id, name, profileUrl, userId, bridgeId } },
 * or why not: { error, status }. Anyone in your network on this computer with a
 * LinkedIn profile who isn't already one of your connections (no copy of them
 * at degree 1) and has no request out. The URL is checked like every other
 * that reaches a command line.
 */
function connectTarget(id) {
  try {
    const me = resolveProfile({ create: false });
    const db = getDb();
    const row = me && db.prepare(
      'SELECT id, name, degree, profile_url, source_connection_id FROM linkedin_connections WHERE id = ? AND user_id = ?',
    ).get(String(id ?? ''), me.id);
    if (!row) return personRefusal(null);
    const why = personRefusal(row, requestStanding(db, { profileUrl: row.profile_url, userId: me.id }));
    if (why) return why;
    const profileUrl = cleanProfileUrl(row.profile_url);
    if (!profileUrl) return { status: 400, error: `${row.name || 'Their'} LinkedIn profile address on file can’t be used.` };
    return {
      person: {
        id: row.id, name: cleanName(row.name) || null, profileUrl, userId: me.id,
        // Who you'd be asking through: the connection whose circle they're in.
        bridgeId: row.degree === 2 ? row.source_connection_id ?? null : null,
      },
    };
  } catch {
    return personRefusal(null);
  }
}

/** Auto's one-time yes (lib/auto-connect.js), given on the page that first offers it. */
function autoAccepted() {
  try { return Boolean(readSettings(getDb()).autoConnectAccepted); } catch { return false; }
}

/** Names come from the page, so they are checked before becoming an argument. */
function cleanName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 120) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

/**
 * Install, and "Set up the scanner", as steps: { plan, cleanup }, or why not:
 * { error, status }. `found` is choosePython()'s answer. Every step is a fixed
 * command, or a `run` done inside this server; nothing comes from the request.
 *
 *   install  build the scanner's environment from `found.base` (this
 *            computer's Python, or the one a setup downloaded), install the
 *            pinned packages into it, and check that they load there, so a pip
 *            that put them elsewhere fails with its reason, not "Finished"
 *   setup    when there is nothing to build from: download the standalone
 *            Python pinned for this computer, check its SHA-256, unpack it into
 *            the data folder, then install as above. The download is checked
 *            before anything is unpacked: downloadVerified only names the file
 *            once it matches, and deletes it otherwise.
 */
function setupPlan(action, found, { requirements, data, say }) {
  if (found.run) {
    return {
      status: 409,
      error: found.run.source === 'bundled'
        ? 'The scanner is already set up: its Python comes with the app.'
        : 'The scanner is already set up.',
    };
  }
  const base = found.base;
  if (action === 'install' && !base) {
    return found.download
      ? { status: 409, error: 'This computer has no Python the scanner can use. Use Set up the scanner instead.' }
      : { status: 500, error: 'No Python 3.10 to 3.14 is installed, or none is on this app’s PATH.' };
  }
  if (action === 'setup' && base?.source === 'system') {
    return { status: 409, error: `This computer already has Python ${base.version}, so nothing needs downloading. Use Install instead.` };
  }
  if (action === 'setup' && !base && !found.download) {
    return { status: 409, error: 'There is no Python download for this computer. Install Python 3.10 to 3.14, then reload.' };
  }

  // The environment, the pinned packages without the pip settings that would
  // put them elsewhere, and a check that they load there
  // (lib/scanner-python.js installSteps). `requirements` is the scanner's own
  // list, wherever it comes from (lib/scanner-files.js findScanner).
  const install = (from) => installSteps({ base: from, dataDir: data, requirements });
  // A setup that already got as far as the download (it was stopped, or the
  // packages failed) carries on from its Python rather than fetching it again.
  if (base) return { plan: install(base), cleanup: null };

  const dl = found.download;
  mkdirSync(data, { recursive: true });
  sweepSetupLeftovers(data);
  const work = mkdtempSync(path.join(data, SETUP_WORK_PREFIX));
  const archive = path.join(work, dl.file);
  let tenths = -1;
  return {
    plan: [
      {
        note: `Downloading Python ${dl.version} from GitHub (${megabytes(dl.size)} MB)`,
        run: async ({ signal }) => {
          await downloadVerified(dl.url, archive, {
            sha256: dl.sha256,
            size: dl.size,
            signal,
            onProgress: (got, total) => {
              const t = Math.floor((got / total) * 10);
              if (t > tenths) {
                tenths = t;
                say(`Downloading Python ${dl.version}: ${megabytes(got)} of ${megabytes(total)} MB`);
              }
            },
          });
          say('Its checksum matches the one Sixgree has for it.');
        },
      },
      { cmd: 'tar', args: ['-xzf', archive, '-C', work], note: 'Unpacking it' },
      { run: () => placeDownloadedPython(work, data, work) },
      ...install({ path: downloadedPython(data), source: 'downloaded' }),
    ],
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || '');
  // The scraper writes back through this very app, so point it at the port we
  // are actually being served on rather than guessing 3000. Kept for the job
  // the queue starts by itself, when no request is there to ask.
  const hostHeader = request.headers.get('host') || '127.0.0.1:3000';
  state.port = hostHeader.includes(':') ? hostHeader.split(':').pop() : '80';

  // Stop stops the running job and holds the queue: nothing else starts
  // until you say so (Resume queue), or clear it.
  if (action === 'cancel') {
    if (body.queue !== false && queue().items.some((i) => i.status === 'waiting')) {
      queue().paused = 'stopped';
      queueChanged();
    }
    clearTimeout(nextTimer);
    // Stopping one of Auto scan's sittings stops Auto scan: it doesn't come back after a rest.
    if (state.running && state.autoSitting) autoEnd('stopped', null);
    stopChild();
    return Response.json({ ok: true, cancelled: true });
  }
  // Auto scan: Start (with its pace and tiers), Stop, and a change of either while it's on.
  if (action === 'auto-start' || action === 'auto-settings') {
    const tiers = cleanTiers(body.tiers);
    if (!tiers.length) return Response.json({ error: 'Pick at least one tier for Auto scan to scan.' }, { status: 400 });
    const a = auto();
    if (action === 'auto-settings') {
      if (a.on) Object.assign(a, { pace: cleanPace(body.pace), tiers });
      return Response.json({ ok: true, auto: autoView() });
    }
    if (!a.on) {
      const why = await autoRefusal();
      if (why) return Response.json(why, { status: 409 });
      Object.assign(a, {
        on: true, pace: cleanPace(body.pace), tiers, showWindow: body.showWindow === true,
        restUntil: null, sitting: null, sittings: 0, plan: null, ended: null,
      });
      clearInterval(a.timer);
      a.timer = setInterval(() => { autoTick().catch(() => {}); }, AUTO_TICK_MS);
      a.timer.unref?.();
    }
    await autoTick();
    return Response.json({ ok: true, auto: autoView() });
  }
  if (action === 'auto-stop') {
    const sitting = state.running && state.autoSitting;
    if (auto().on || sitting) autoEnd('stopped', null);
    if (sitting) stopChild();
    return Response.json({ ok: true, auto: autoView() });
  }
  if (action === 'queue-remove') {
    const removed = removeItem(queue(), String(body.item ?? ''));
    if (removed) queueChanged();
    return Response.json({ ok: true, removed, queue: queueView(queue(), { cap: queueCap() }) });
  }
  if (action === 'queue-clear') {
    clearQueue(queue());
    queueChanged();
    return Response.json({ ok: true, queue: queueView(queue(), { cap: queueCap() }) });
  }
  if (action === 'queue-resume') {
    queue().paused = null;
    queueChanged();
    if (!state.running) await runNext();
    return Response.json({ ok: true, queue: queueView(queue(), { cap: queueCap() }) });
  }
  return startJob(body);
}

/**
 * The next one waiting, started the way a press would start it: through
 * startJob and every check in it, at this moment. A refusal skips it, with
 * its reason, and the next is tried. Something else running already leaves it
 * where it is, for that job's end.
 */
async function runNext() {
  clearTimeout(nextTimer);
  nextTimer = null;
  for (let item = nextUp(queue()); item && !state.running; item = nextUp(queue())) {
    const res = await startJob({ ...item.request }, { queued: item });
    const answer = await res.json().catch(() => ({}));
    if (res.ok) return;   // started, and out of the queue (startJob took it out)
    if (state.running && answer.error === 'Something is already running.') return;
    // The item could have been removed while its checks ran.
    if (skipItem(queue(), item.id, answer.error)) queueChanged();
  }
}

/**
 * Keep a press for later: { ok, queued, place } (place 1 runs next), the same
 * for one already waiting or running (`duplicate`), or 409 once QUEUE_CAP
 * wait. Only what a press of it would send again is kept: the action, who (by
 * id), the Chrome window setting, and how many pages to read, so a read that
 * was capped (the guided setup's first scan reads three) stays capped when its
 * turn comes. Never the URL: that is looked up again. The pages are checked
 * again then too.
 */
function queueUp(body, action, target) {
  const request = {
    action, id: target.id,
    ...(body.showWindow === true ? { showWindow: true } : {}),
    ...(PAGE_CAPS.includes(body.maxPages) ? { maxPages: body.maxPages } : {}),
    // Rescan from the start, kept as pressed: otherwise its turn would carry on with the next round.
    ...(body.fromStart === true ? { fromStart: true } : {}),
    // Read again from page 1 (a list read to its end), kept as pressed too.
    ...(body.again === true ? { again: true } : {}),
  };
  if (target.name) request.name = target.name;
  const cap = queueCap();
  const said = enqueue(queue(), {
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action, target: { id: target.id, name: target.name ?? null }, request, at: Date.now(),
  }, { action: state.action, target: state.target }, { cap });
  if (said.full) {
    return Response.json({ error: `The queue is full: ${cap} are waiting. Try again once one has run.`, queueFull: true }, { status: 409 });
  }
  if (said.queued) queueChanged();
  return Response.json({ ok: true, queued: true, duplicate: Boolean(said.duplicate), running: Boolean(said.running), place: said.place ?? null, queue: queueView(queue(), { cap: queueCap() }) });
}

/** Once a job ends: the next one, after a breath, unless the queue waits for you. */
function scheduleNext() {
  clearTimeout(nextTimer);
  if (!nextUp(queue())) return;
  nextTimer = setTimeout(() => { runNext().catch(() => {}); }, QUEUE_GAP_MS);
  nextTimer.unref?.();
}

/**
 * Start one job, or say why not. `queued` is the queue's item when the queue
 * starts it; otherwise a press made while something runs is queued here, once
 * every check has passed, instead of refused.
 */
async function startJob(body, { queued = null, sitting = 0 } = {}) {
  const action = String(body.action || '');

  // The settings a person changes here. None starts anything.
  if (action === 'set-limits') {
    // Manual mode and Dev mode only as the installed plugins allow
    // (lib/scanner-capabilities.js): the file is brought into line first, so a
    // save that sends every setting back as it is goes through.
    const refused = settingRefusal(capabilitiesHere(), body);
    if (refused) return Response.json({ error: refused }, { status: 409 });
    const limits = writeLimits(dataDir(), {
      daily: body.daily, pace: body.pace, gentle: body.gentle, profileReads: body.profileReads,
      // Dev mode and manual mode (lib/linkedin-limits.js). The scanner reads both from the
      // file as it goes, so a scan under way follows; Dev mode off brings the limits back.
      dev: body.dev, manual: body.manual, digDeeper: body.digDeeper,
      // Settings → Sound: manual mode's chimes and how loud (lib/chimes.js).
      chimes: body.chimes, chimeVolume: body.chimeVolume,
      // Scanner settings → Breaks by hand (lib/manual-breaks.js): read by the scanner at each break.
      breakEvery: body.breakEvery, breakSeconds: body.breakSeconds,
      // Scanner settings → Pages a round (lib/scan-rounds.js): what a scan of one person's circle reads.
      roundPages: body.roundPages,
      // Scanner settings → Scan windows (lib/scan-windows.js): each only ever stricter than its default.
      windowPages: body.windowPages, windowsPerDay: body.windowsPerDay, windowGapHours: body.windowGapHours,
    });
    if (body.dev === false) state.limitHit = null;
    // Manual mode on while Auto scan waits between sittings: it stops now, with why.
    if (body.manual === true && auto().on && !(state.running && state.autoSitting)) autoEnd('stopped', MANUAL_STOPS_AUTO);
    return Response.json({ ok: true, limits });
  }
  // Lift limits for this session (lib/limits-lift.js): in this server's memory
  // only, so a restart puts them back. A scan under way is told at once.
  if (action === 'lift-limits') {
    liftLimits();
    // What held a scan back is cleared only if the lift lets it go: profile views a day
    // do, a used scan window doesn't (limitsNow looks again on the next poll).
    try {
      if (!linkedinState(dataDir()).limitReached) state.limitHit = null;
    } catch {
      state.limitHit = null;
    }
    tellScanner('limits: lifted');
    return Response.json({ ok: true, lifted: true });
  }
  if (action === 'put-limits-back') {
    putLimitsBack('by-hand');
    tellScanner('limits: on');
    return Response.json({ ok: true, lifted: false });
  }

  if (!Object.hasOwn(ACTIONS, action)) {
    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 });
  }
  // Every action from here on runs the scanner or sets it up. A copy without
  // its files, built in or from a plugin (lib/scanner-files.js), says so
  // before anything else is asked.
  const root = projectRoot();
  const scanner = scannerHere(root);
  if (!scanner.found) {
    return Response.json({ error: SCANNER_MISSING, scannerMissing: true }, { status: 409 });
  }
  // What the installed plugins unlock (lib/scanner-capabilities.js), with
  // manual mode and Dev mode set in scan-limits.json as they decide before the
  // scanner reads it: with only the manual plugin, a circle scan is a manual
  // one whatever was saved. What only the auto plugin does is refused here,
  // and so is one of Auto scan's sittings without it.
  let caps;
  try {
    caps = capabilitiesHere();
  } catch (err) {
    return Response.json({ error: `The scanner’s settings couldn’t be saved, so nothing started (${err.message}).` }, { status: 500 });
  }
  const locked = capabilityRefusal(caps, sitting ? 'auto-start' : action);
  if (locked) return Response.json({ error: locked, needsPlugin: 'auto' }, { status: 409 });
  // A scanner plugin from before an action was added doesn't know its flag: said here, not by its error.
  const tooOld = pluginTooOld(scanner, action);
  if (tooOld) return Response.json({ error: tooOld, needsPluginUpdate: true }, { status: 409 });
  // Auto: who, by id, and whether a request can go to them at all, before
  // anything else is asked. Then its own one-time yes (the page asks it).
  let invitee = null;
  if (action === 'connect') {
    const found = connectTarget(body.id);
    if (found.error) return Response.json({ error: found.error }, { status: found.status });
    invitee = found.person;
    if (!autoAccepted()) return Response.json({ error: AUTO_REFUSAL, needsAutoAcceptance: true }, { status: 409 });
  }
  // Nothing opens LinkedIn before the one-time "I understand" on the Scan page,
  // whichever button asked (lib/scan-risk.js).
  if (touchesLinkedIn(action) && !scanRisk()) {
    return Response.json({ error: RISK_REFUSAL, needsRiskAcceptance: true }, { status: 409 });
  }
  // Nor without Google Chrome, which the scanner drives: the Scan page's step 1
  // says so in the same words, and every other button is told here, before
  // anything starts, rather than by a Playwright error at the end of a log.
  if (touchesLinkedIn(action) && !chromeHere()) {
    return Response.json({ error: CHROME_REFUSAL, needsChrome: true }, { status: 409 });
  }

  // Read profiles only once it's turned on in Scanner settings, and only with a
  // profile view left today (each read is one); the scanner checks both again.
  let profileBatch = 0;
  if (action === 'read-profiles') {
    const lim = linkedinState(dataDir());
    if (!lim.limits?.profileReads) {
      return Response.json({ error: 'Turn on “Read full profiles (experience)” in Scanner settings first.' }, { status: 409 });
    }
    if (lim.profilesLeftToday === 0) {
      state.limitHit = Date.now();
      return Response.json({ error: limitRefusal(), limitReached: true }, { status: 409 });
    }
    profileBatch = PROFILE_READ_BATCHES.includes(body.batch) ? body.batch : 10;
  }

  const spec = ACTIONS[action];
  const maxBridges = Number.isInteger(body.maxBridges) && body.maxBridges > 0
    ? Math.min(body.maxBridges, 500)
    : 0;
  // Tiers arrive as a list and become one --tiers=S,A token. Filtered to the
  // five that exist, so nothing from the request reaches a command line freely.
  const tiers = Array.isArray(body.tiers)
    ? body.tiers.map((t) => String(t).toUpperCase()).filter((t) => 'SABCD'.includes(t) && t.length === 1)
    : [];
  // Which of your connections to map first, and how deep to read each one. Both
  // are a fixed set, like everything else that reaches the command line. 100 is
  // every page: LinkedIn's search goes no further, and most lists end sooner.
  const order = body.order === 'score' ? 'score' : 'newest';
  const maxPages = PAGE_CAPS.includes(body.maxPages) ? body.maxPages : 100;
  const readsCircles = action.startsWith('auto-bridge') || ['bridge', 'rescrape', 'resume', 'resume-all'].includes(action);
  // Carry on with people already mapped, from the page each one stopped at.
  const deeper = body.deeper === true && (action.startsWith('auto-bridge') || action === 'bridge');
  // Resume, and a circle scan of someone picked by id, go by the connection's
  // profile URL rather than a name.
  const byId = spec.needsId || (spec.byId && Boolean(body.id));
  let name = null;
  if (spec.needsName && !byId) {
    // A company for Breach is tidied as the tab keeps it (lib/breach.js companyName).
    name = action === 'breach' ? companyName(body.name) || null : cleanName(body.name);
    if (!name) return Response.json({ error: 'A name is required for this action.' }, { status: 400 });
  }
  // The id comes from the page; the URL is looked up here, for this profile, so
  // nothing from the request itself reaches the command line.
  let profileUrl = null;
  let person = null;
  let note = null;
  if (byId) {
    try {
      const me = resolveProfile({ create: false });
      // Your connections, but anyone in the network for Read all mutuals (a Breach target).
      person = me && getDb().prepare(action === 'mutuals'
        ? 'SELECT name, profile_url FROM linkedin_connections WHERE id = ? AND user_id = ?'
        : 'SELECT name, profile_url FROM linkedin_connections WHERE id = ? AND user_id = ? AND degree = 1',
      ).get(String(body.id ?? ''), me.id);
      profileUrl = person?.profile_url && cleanProfileUrl(person.profile_url);
      // How far their list was read (the scanner's note), for their round below.
      if (profileUrl) note = readProgress(dataDir(), me.id)[person.profile_url] || null;
    } catch { profileUrl = null; }
    if (!profileUrl) {
      return Response.json({ error: action === 'mutuals' ? 'That person could not be found.' : 'That connection could not be found.' }, { status: 400 });
    }
  }
  // A scan of one person's circle, by id, is one round of their list (Blake,
  // 2026-10-16: "scanning 25 pages per round ... unless they pick 50 per scan
  // which is max"): 25 or 50 pages (Scanner settings), from where the last round
  // stopped, or from page 1 for someone never scanned, read to the end, or a
  // Rescan from the start (lib/scan-rounds.js circleRoundArgs). Fewer pages when
  // asked for (the guided setup's first scan reads three).
  const circleRound = profileUrl && (action === 'bridge' || action === 'resume')
    ? circleRoundArgs({
      action, note, nextPage: nextPageToRead(note ?? undefined), round: readLimits(dataDir()).roundPages,
      // Only a Scan's; Scan next round is always a whole round.
      maxPages: action === 'bridge' && PAGE_CAPS.includes(body.maxPages) ? body.maxPages : null,
      fromStart: body.fromStart === true,
      // --round only to a scanner that knows it on a circle (plugins 1.0.10 on).
      roundFlag: pluginHas(scanner, 'circle-round'),
    })
    : null;
  // Who the job is of, so every Scan button can say whose scan is running and a
  // profile card can show its own person's progress. Only ever shown: the id
  // never reaches the command line (a name or the URL looked up for it does),
  // and anything not shaped like one of our ids is dropped.
  const hintId = typeof body.id === 'string' && /^[\w-]{1,64}$/.test(body.id) ? body.id : null;
  const target = invitee ? { id: invitee.id, name: invitee.name }
    : name || profileUrl ? { id: hintId, name: name || person?.name || null } : null;
  // Nothing that searches LinkedIn starts during a cooldown; the scanner checks
  // too, this just says so before a process is spawned.
  // The 1st-degree scans aren't searches, but they open LinkedIn with automation too.
  // Auto's request too: a pause after LinkedIn pushed back holds everything.
  const searches = spec.searches || action.startsWith('auto-bridge')
    || ['bridge', 'rescrape', 'company', 'full', 'refresh', 'connect'].includes(action);
  // A staged import replaces the network at the next start, so anything scanned
  // now would land in the copy that is about to be set aside. Setting the
  // scanner up touches no network data.
  if (!['install', 'setup', 'login'].includes(action) && pendingImport(dataDir())) {
    return Response.json({ error: 'An import is waiting to finish. Restart Sixgree first (Settings → Your data), then scan.' }, { status: 409 });
  }
  // While the limits are lifted for this session there is no cooldown here
  // (lib/linkedin-limits.js linkedinState); the scan windows hold either way.
  const li = linkedinState(dataDir());
  const cooldown = li.cooldown;
  if (searches && cooldown) {
    return Response.json({ error: `Scanning is paused until ${new Date(cooldown.until).toLocaleString()}: ${cooldown.reason}.`, cooldown }, { status: 409 });
  }
  // The scan window, said before a process starts (the scanner checks it
  // before every search too). Auto scan's sittings are planned against the same
  // window (autoPlan ends Auto scan at it, in its own words), so they aren't
  // counted as a press held back.
  const readsLists = action.startsWith('auto-bridge') || ['bridge', 'rescrape', 'resume', 'resume-all', 'company', 'your-connections', 'breach', 'mutuals'].includes(action);
  if (readsLists && li.limitReached && !sitting) {
    state.limitHit = Date.now();
    return Response.json({ error: limitRefusal(), limitReached: true }, { status: 409 });
  }
  // Auto's caps (15 in any 24 hours, 80 in any 7 days) and the profile view it
  // takes, said before a process starts; the scanner checks them again.
  if (invitee) {
    const capped = inviteRefusal(li);
    if (capped) {
      if (li.profilesLeftToday === 0) state.limitHit = Date.now();
      return Response.json({ error: capped, ...(li.profilesLeftToday === 0 ? { limitReached: true } : {}) }, { status: 409 });
    }
  }
  if (state.running) {
    // One thing at a time. Auto, and a scan of one person's circle, picked by
    // id, wait their turn in the queue (lib/scan-queue.js); anything else is
    // refused. Every check above runs again when its turn comes.
    const kind = queueKind(action);
    if (kind && !queued && target?.id) return queueUp(body, action, target);
    if (invitee) return Response.json({ error: `${runningNow(state.action)}. Press Auto again once it has finished.`, action: state.action }, { status: 409 });
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  // Which Python, looked at afresh: what the page saw may be seconds old.
  forgetChecks();
  const found = (await machineChecks()).python;
  if (state.running) {
    if (queueKind(action) && !queued && target?.id) return queueUp(body, action, target);
    return Response.json({ error: 'Something is already running.', action: state.action }, { status: 409 });
  }

  // Installing is several commands, so it runs as a small sequential plan
  // rather than a shell string — nothing here is ever concatenated from input.
  let plan;
  let cleanup = null;
  if (action === 'install' || action === 'setup') {
    const made = setupPlan(action, found, { requirements: scanner.requirements, data: dataDir(), say: push });
    if (made.error) return Response.json({ error: made.error }, { status: made.status });
    ({ plan, cleanup } = made);
  } else {
    if (!found.run) {
      return Response.json({ error: 'The scanner’s packages are not installed yet. Do step 1 first.' }, { status: 409 });
    }
    // The app's own Python runs isolated from this user's Python settings; any
    // Python runs it without writing bytecode beside scrape.py, which in the Mac
    // app is inside the signed app (lib/scanner-python.js scannerCommand).
    plan = [scannerCommand(found.run, scanner.script, [
      // `--flag=value` is one token on purpose: a name beginning with
      // "-" can then never be read as a flag of its own. Anyone found by
      // id is --bridge-url, which carries on where their last read stopped
      // unless told to start at page 1.
      ...(invitee ? [`--connect=${invitee.profileUrl}`, ...(invitee.name ? [`--connect-name=${invitee.name}`] : [])]
        : profileBatch ? [`--read-profiles=${profileBatch}`]
        : name ? [`${spec.flag}=${name}`]
        : profileUrl && action === 'mutuals' ? [`--mutuals=${profileUrl}`, `--round=${mutualRound(body.pages)}`]
        : profileUrl ? [`--bridge-url=${profileUrl}`] : spec.flag.split(' ')),
      // One person's circle by id: one round (circleRound), with --from-start when it starts at page 1.
      ...(circleRound ? circleRound.args : []),
      // A Breach round: its pages (3, 5 or 10) and the degrees the search shows, a fixed set.
      ...(action === 'breach' ? breachRoundArgs({ pages: body.pages, degrees: body.degrees }) : []),
      // A list read to its end (your connections, Breach, Read all mutuals) is read again from page 1
      // only when its button asked (Blake, 2026-10-17); without --again the scanner opens nothing for it.
      // An older plugin doesn't know the flag, and starts again by itself as it always did.
      ...(body.again === true && LIST_AGAIN.includes(action) && pluginHas(scanner, 'list-again') ? ['--again'] : []),
      ...(maxBridges && (action.startsWith('auto-bridge') || action === 'resume-all') ? [`--max-bridges=${maxBridges}`] : []),
      ...(tiers.length && action.startsWith('auto-bridge') ? [`--tiers=${tiers.join(',')}`] : []),
      ...(action.startsWith('auto-bridge') ? [`--order=${order}`] : []),
      // Experimental Auto-Bridge (Scan page switch): all-day pacing and LinkedIn's
      // own data read beside the page text (scripts/scrape.py EXPERIMENT).
      // Only Auto scan's own sittings (autoTick), never a request: a scan you start
      // yourself never keeps Auto scan's hours or rests (PR #201, TRAPS §49).
      ...(sitting && action === 'auto-bridge' ? ['--experimental', `--sitting=${sitting}`] : []),
      // Resume all reads each list to the end: a remembered "10 pages" would leave
      // everyone paused at page 11 and do nothing. A round says its own (above).
      ...(readsCircles && !circleRound ? [`--max-pages=${action.startsWith('resume') ? 100 : maxPages}`] : []),
      ...(deeper && !circleRound ? ['--deeper'] : []),
      // Scan page → Fine-tune → "Show the scanner's Chrome window": a normal
      // window in front, to watch it work. Without it the window stays out of
      // sight and comes forward only when LinkedIn needs you (Blake,
      // 2026-10-04: "not to have any disruption through pop ups or windows").
      // Signing in is always in front.
      ...(body.showWindow === true && action !== 'login' ? ['--show-window'] : []),
    ])];
  }

  const port = state.port || '3000';

  // Its turn came: out of the queue, now that it runs.
  if (queued && removeItem(queue(), queued.id)) queueChanged();

  state.running = true;
  state.stopping = false;
  state.action = action;
  state.target = target;
  state.exitCode = null;
  state.exitKind = null;
  state.startedAt = Date.now();
  state.log = [spec.label + (target?.name ? ` ${target.name}…` : '…')];
  // A round of one person's circle says which pages (lib/scan-rounds.js).
  if (circleRound) {
    const { start, last, pages, fromStart } = circleRound;
    state.log.push(`A round of ${pages} ${pages === 1 ? 'page' : 'pages'}: ${fromStart ? 'from page 1' : `from page ${start}`}, to page ${last} at most.`);
  }
  state.pages = 0;
  state.found = [];
  state.stderrTail = [];
  state.failure = null;
  state.limitHit = null;
  state.invitee = invitee;
  state.outcome = null;
  state.autoSitting = Boolean(sitting);
  if (sitting) state.log = [`Auto scan: a sitting of up to ${sitting} searches, in ${tierList(auto().tiers)}…`];
  forgetChecks();
  // Manual mode's chimes, as files the scanner can play (lib/chime-files.js): written once, never in the way.
  // Only with manual mode there to play them (the manual plugin, or built in).
  if (caps.manual) ensureChimes(dataDir());

  // Name the profile outright. The scraper would otherwise ask the app which one
  // to use; passing it means the page and the scrape cannot disagree.
  let profileId = '';
  try { profileId = resolveProfile().id; } catch {}

  const childEnv = {
    // With Sixgree's own browser named only when it's sound (lib/linkedin-panel.js).
    ...scannerEnvWithPanel(process.env),
    SIX_DEGREES_USER_ID: profileId,
    APP_URL: `http://127.0.0.1:${port}`,
    PYTHONUNBUFFERED: '1',
    // The app's own folder, as it always was. A scanner plugin may run with no
    // app folder found at all, and then whatever this server was given stays.
    ...(root ? { SIX_DEGREES_ROOT: root } : {}),
    // So the scraper's hints name the Scan page's settings, not its flags.
    SIX_DEGREES_FROM_APP: '1',
    // Lifted for this session, or not: the scanner skips profile views a day and the
    // cooldown while it is, and keeps the scan windows, its pace and its stops either way.
    SIX_DEGREES_LIMITS_LIFTED: liftedAt() != null ? '1' : '0',
  };

  /**
   * Auto: a request LinkedIn showed as pending (or one already pending there)
   * is marked as sent through the same store as the Connect button
   * (lib/requests.js), before the job is seen to end, so every view that looks
   * next finds it; its XP follows. Anything else marks nothing (TRAPS §7).
   */
  function markAutoSent() {
    const who = state.invitee;
    if (state.action !== 'connect' || !who || who.marked || !connectMarks(state.outcome)) return;
    who.marked = true;
    try {
      const { saved, xp, user } = markSentRows(getDb(), {
        connectionId: who.id, profileUrl: who.profileUrl, userId: who.userId, bridgeId: who.bridgeId,
      });
      if (saved) Promise.resolve(awardXP(whose(user), xp)).catch(() => {});
      push('Marked as sent in Sixgree.');
    } catch (err) {
      push(`Sent on LinkedIn, but it couldn’t be marked as sent here: ${err.message}`);
    }
  }

  function finish(code) {
    markAutoSent();
    // What the exit code says (lib/scan-exit.js, scrape.py EXIT_CODES): a calm
    // end (finished, today's limit, a cooldown) is `effective` 0, as the rest of
    // the app has always read it; a stop with a reason keeps its code. A scanner
    // from before the table ended its limits with 0, found by the log's words.
    const out = exitOutcome(code, { log: state.log, scanner: !['install', 'setup'].includes(state.action) });
    // Ended by a signal (no code), as before: no code to go by.
    if (code == null) out.effective = code;
    // A failure must say why. stderr is filtered while running because pip and
    // Playwright are noisy there, and that filter once swallowed the only line
    // explaining a failed scan, leaving just "exit 1". On a failure, show the
    // last of it whatever it says.
    if (out.failure && !state.stopping && state.stderrTail.length) {
      const shown = new Set(state.log);
      const unseen = state.stderrTail.filter((l) => !shown.has(l));
      if (unseen.length) push(unseen.join('\n'));
      // Kept apart for the page's red box. A reason is often more than its last
      // line — "more than one profile…" followed by "pick one with…" — so keep
      // the end of it, minus the Python warnings that are not the problem.
      const reason = state.stderrTail.filter((l) => !/Warning|warnings\.warn\(/.test(l)).slice(-6);
      state.failure = reason.length ? reason : null;
    }
    const stopped = state.stopping;
    const wasSitting = state.autoSitting;
    state.autoSitting = false;
    // Stopped at a limit (scrape.py budget_message): the notch says so, and offers the lift when it would help. Auto scan says so in its own words.
    if (!stopped && !wasSitting && out.limit) state.limitHit = Date.now();
    push(state.stopping ? 'Stopped.' : out.line);
    state.stopping = false;
    state.running = false;
    state.child = null;
    state.abort = null;
    state.exitCode = out.effective;
    state.exitKind = stopped ? 'stopped' : out.kind;
    state.recent = [{
      action: state.action, target: state.target, startedAt: state.startedAt, exitCode: out.effective, exitKind: state.exitKind, failure: state.failure,
      // How Auto's request went, for the button that started it (lib/auto-connect.js connectOutcome).
      ...(state.action === 'connect' ? { outcome: state.outcome } : {}),
    }, ...state.recent].slice(0, 5);
    // A scan that finished leaves a notification ("Scan done: …"); a stop or a failure doesn't.
    // One per Auto scan sitting would be one an hour: none for those.
    const done = wasSitting ? null : scanDoneNotification({ action: state.action, target: state.target, exitCode: out.effective, stopped, log: state.log.slice(-12), userId: profileId || null });
    if (done) Promise.resolve(notesDb.from('notifications').insert([done])).catch(() => {});
    // A setup's private folder (the download and what was unpacked from it).
    if (cleanup) {
      try { cleanup(); } catch { /* swept at the next setup (sweepSetupLeftovers) */ }
    }
    forgetChecks();
    // The daily backup, once a scan may have changed the network (lib/backups.js):
    // checked here and when the server starts, never on a timer. Setting the
    // scanner up and signing in change nothing in it.
    if (!['install', 'setup', 'login'].includes(state.action)) {
      try {
        const daily = backUpDailyIfDue();
        if (daily) push('Made today’s backup of your network (Settings → Your data).');
      } catch (err) {
        push(`Today’s backup couldn’t be made: ${err.message}`);
      }
    }
    // Auto scan rests after a sitting, or ends with why (autoSittingEnded).
    if (wasSitting) autoSittingEnded(out.effective, stopped, state.log, state.failure);
    // The next one waiting, unless this one was stopped (Stop holds the queue).
    if (!stopped) scheduleNext();
  }

  function runStep(i) {
    if (i >= plan.length) return finish(0);
    const step = plan[i];
    if (step.note) push(step.note + '…');

    // A step done inside this server: the download, and moving what it unpacked
    // into place. Stop aborts it (stopChild).
    if (step.run) {
      const ctrl = new AbortController();
      state.abort = ctrl;
      Promise.resolve()
        .then(() => step.run({ signal: ctrl.signal }))
        .then(() => {
          state.abort = null;
          if (state.stopping) return finish(0);
          runStep(i + 1);
        }, (err) => {
          state.abort = null;
          if (state.stopping) return finish(0);
          // Kept where finish() looks for a failure's reason, for the page's red box.
          state.stderrTail.push(err instanceof ScannerSetupError ? err.message : `Could not finish: ${err.message}`);
          finish(1);
        });
      return;
    }

    let child;
    try {
      // Its own process group, so cancelling reaches the browser as well. A
      // step's env() makes its own environment from this one.
      // On Windows `detached` means a console of its own, a visible window for
      // Playwright's driver: there taskkill /T reaches the tree instead (stopChild).
      const win = process.platform === 'win32';
      // In the scanner's own folder: the app's for the built-in one, the plugin's for a plugin's.
      child = spawn(step.cmd, step.args, { cwd: scanner.cwd, env: step.env ? step.env(childEnv) : childEnv, detached: !win, windowsHide: true });
    } catch (err) {
      push(`Could not start: ${err.message}`);
      return finish(-1);
    }
    state.child = child;
    // Lines to it (tellScanner) once it has gone are nobody's business.
    child.stdin?.on('error', () => {});

    child.stdout.on('data', (d) => push(d.toString()));
    child.stderr.on('data', (d) => {
      // pip and playwright both chatter on stderr; only surface real trouble.
      const t = d.toString();
      for (const line of t.split('\n')) {
        const l = line.replace(/\s+$/, '');
        if (l) state.stderrTail.push(l);
      }
      if (state.stderrTail.length > 20) state.stderrTail.splice(0, state.stderrTail.length - 20);
      if (/error|Error|Traceback|No module|failed|externally-managed/.test(t)) push(t);
    });
    child.on('error', (err) => { push(`Could not start: ${err.message}`); finish(-1); });
    child.on('close', (code) => {
      if (state.stopping) return finish(code ?? 0);
      if (code !== 0 && !step.tolerant) return finish(code);
      runStep(i + 1);
    });
  }

  runStep(0);

  // Which job this is, so the page that started it can tell its end from the
  // end of whatever runs next (lib/scraper-client.js runScrape).
  return Response.json({ ok: true, action, startedAt: state.startedAt });
}
