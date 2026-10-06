// One way to run the scraper from the browser.
//
// Every view used to POST to a Python server on http://localhost:5555 that the
// user had to start by hand, and each one told them to "double-click Start
// Scraper on your Desktop" when it was not running. There were six copies of
// that logic and one of them is why a working scraper looked broken.
//
// Now they all call this, which talks to /api/scraper on the app itself.

import { runningNow } from './scan-state.js';
import { CHROME_REFUSAL } from './scanner-setup.js';
import { QUEUE_CAP, queueKind, ordinal, placeOf } from './scan-queue.js';

export async function scraperStatus() {
  const r = await fetch('/api/scraper');
  if (!r.ok) throw new Error('Could not reach the app.');
  return r.json();
}

/**
 * Scan page → Fine-tune → "Show the scanner's Chrome window", remembered in
 * this browser, off unless ticked. Without it the scanner's Chrome stays out of
 * sight and comes forward only when LinkedIn needs you (scripts/scrape.py
 * launch_chrome; Blake, 2026-10-04: "we want seamlessness … not to have any
 * disruption through pop ups or windows"). Every way a scan starts asks here.
 *
 * It replaced "Hide the Chrome window while scanning" (six-degrees-hide-chrome,
 * which ran Chrome headless): hidden is now how every scan runs, without
 * headless Chrome's risks, so that old switch is no longer read.
 */
export const SHOW_CHROME_KEY = 'six-degrees-show-chrome';
export function showChromeOn(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { return JSON.parse(storage?.getItem(SHOW_CHROME_KEY) || 'false') === true; } catch { return false; }
}

/** What a scan start sends: the action, its details, and `showWindow` when you've asked to watch it. */
export function scanRequest(action, extra = {}, shown = showChromeOn()) {
  return { action, ...extra, ...(shown ? { showWindow: true } : {}) };
}

export async function startScrape(action, name, extra = {}) {
  const r = await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scanRequest(action, { ...(name ? { name } : {}), ...extra })),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // The answer's flags travel with the error (needsAutoAcceptance, say), so a
    // button can tell a question to ask from a reason to show.
    const err = new Error(d.error || 'Could not start the scanner.');
    err.details = d;
    throw err;
  }
  return d;
}

/**
 * Where Resume would carry on with one of your connections, for their profile
 * card: { nextPage, pagesRead, legacy }, or null when there is nothing left to
 * read (never mapped, read to the end, hidden).
 */
export async function resumePoint(id) {
  const r = await fetch(`/api/scraper?resume=${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  return (await r.json()).resume ?? null;
}

/** Nothing noted: before the first answer, and for the sample or a CSV. */
export const NO_SCAN_NOTES = Object.freeze({ skips: [], read: [], lists: {} });

/**
 * What the scanner noted, for lib/reach.js: `skips`, the hidden lists
 * ([{ profileUrl, … }]), `read`, the profile URLs of every list it has
 * read, and `lists`, how far each was read ({ url: { pages, more, total } }).
 * Never throws: with no answer (the app restarting, say) nothing is
 * noted, so a hidden list shows as ready rather than anyone going missing.
 */
export async function loadScanNotes() {
  try {
    const r = await fetch('/api/scraper?reach=1');
    if (!r.ok) return NO_SCAN_NOTES;
    const d = await r.json();
    // `lists` is how far each list was read, for the rings round a dot
    // (lib/reach.js scanBars). Dropped here until 10/3, every scanned
    // connection drew 2 of 5 bars, "partly read", even with the whole list in.
    const lists = d.lists && typeof d.lists === 'object' && !Array.isArray(d.lists) ? d.lists : {};
    return { skips: Array.isArray(d.skips) ? d.skips : [], read: Array.isArray(d.read) ? d.read : [], lists };
  } catch {
    return NO_SCAN_NOTES;
  }
}

/** One of your connections for the Scan page's "Scan one circle" box: { person, circle }. */
export async function pickedPerson(id) {
  const r = await fetch(`/api/scraper?person=${encodeURIComponent(id)}`);
  if (!r.ok) return { person: null };
  return r.json();
}

/** What to tell someone when the scanner is not usable yet. */
export function notReadyMessage(status) {
  if (!status) return 'Could not reach the app.';
  const c = status.checks || {};
  if (!c.scriptsFound) return 'The scanner files are missing from this install.';
  if (!c.dependencies) {
    // With no Python and nothing to download for this computer, Scan can't help yet.
    if (!c.python && !c.download) return 'No Python 3.10 to 3.14 is installed on this machine.';
    return 'The scanner is not set up yet. Open Scan to set it up.';
  }
  // The words the Scan page and the server use (lib/scanner-setup.js).
  if (!c.chrome) return CHROME_REFUSAL;
  return null;
}

/** Stop whatever is running. The scraper closes its browser on the way out. The queue waits for you. */
export async function stopScrape() {
  await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  });
}

// The queue (lib/scan-queue.js): what the notch's list does. Each answers with
// the queue as it now is, shown at once rather than a poll later.
async function queueAction(action, extra = {}) {
  const r = await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (d?.queue) publish({ ...now, queue: cleanQueueView(d.queue) });
  tick();
  return d;
}
/** Take one out of the queue. */
export const removeQueued = (item) => queueAction('queue-remove', { item });
/** Empty the queue, and nothing waits for you. */
export const clearQueued = () => queueAction('queue-clear');
/** Carry on after Stop, or after a restart: the next one starts if nothing runs. */
export const resumeQueue = () => queueAction('queue-resume');

// The one limit, searches a day, and "Lift limits for this session"
// (lib/limits-lift.js): changed from the notch or the Scan page. Each tells
// every view on the page at once (LIMITS_CHANGED) rather than a poll later.
export const LIMITS_CHANGED = 'six-degrees:limits';
async function limitsAction(action, extra = {}) {
  const r = await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'That couldn’t be changed. Try again.');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIMITS_CHANGED));
  tick();
  return d;
}
/** Lift the daily limit and the cooldown until Sixgree restarts. */
export const liftLimitsForSession = () => limitsAction('lift-limits');
/** Put them back now. */
export const putLimitsBack = () => limitsAction('put-limits-back');
/** Searches a day: a whole number from 1 to 1000 (lib/linkedin-limits.js DAILY_RANGE). */
export const setDailyLimit = (daily) => limitsAction('set-limits', { daily });

/** The server's daily-limit state for the notch (route.js limitsNow), kept to its shape. */
export function cleanLimits(l) {
  if (!l || typeof l !== 'object') return NO_LIMITS;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return { lifted: l.lifted === true, reached: l.reached === true, searches: num(l.searches), daily: num(l.daily) };
}

// One scan at a time, and every button knows it.
//
// The scanner runs one job and refuses a second. The buttons that start one
// didn't know that: each kept its own idea of whether a scan was running, so a
// scan started on one profile card left every other card's button live, and
// pressing it said "Scan failed — connections may be private" about a scan
// that had never started. Now they all read the scanner's own answer, asked
// here once for the whole page however many buttons are showing: every 1.5 s
// while a job runs, every 5 s while none does (so one started on the Scan page
// or in another window greys them out too), and not at all while no button is
// on screen. The idle look is skipped while the page is hidden, and the page
// looks again the moment it's shown or focused: a window in the background has
// its timers held back by the browser (to once a minute, after a while), and
// the end of a scan must not wait for the next one of those.

const BUSY_MS = 1500;
const QUIET_MS = 5000;

/** Before the first answer, and on the server, where nothing is asked. */
export const NO_QUEUE = Object.freeze({ paused: null, cap: QUEUE_CAP, waiting: 0, items: [] });
export const NO_LIMITS = Object.freeze({ lifted: false, reached: false, searches: null, daily: null });
export const SCANNER_UNKNOWN = Object.freeze({
  known: false, running: false, pending: false, action: null, target: null,
  startedAt: null, progress: null, pages: 0, found: [], log: [], finished: [], recent: [], needsYou: null, queue: NO_QUEUE, auto: null,
  limits: NO_LIMITS,
});

/** The server's Auto scan (app/api/scraper/route.js autoView), kept to its shape, or null. */
function cleanAutoView(a) {
  if (!a || typeof a !== 'object' || typeof a.phase !== 'string') return null;
  const time = (v) => (Number.isFinite(v) ? v : null);
  return {
    on: a.on === true, phase: a.phase, pace: typeof a.pace === 'string' ? a.pace : null,
    tiers: Array.isArray(a.tiers) ? a.tiers.filter((t) => typeof t === 'string') : [],
    until: time(a.until), sitting: Number(a.sitting) || null, sittings: Number(a.sittings) || 0,
    reason: typeof a.reason === 'string' ? a.reason : null,
    ended: a.ended && typeof a.ended.phase === 'string'
      ? { phase: a.ended.phase, reason: typeof a.ended.reason === 'string' ? a.ended.reason : null, at: time(a.ended.at) }
      : null,
  };
}

/** The server's queue (lib/scan-queue.js queueView), kept to its shape. */
function cleanQueueView(q) {
  if (!q || typeof q !== 'object' || !Array.isArray(q.items)) return NO_QUEUE;
  const items = q.items.filter((i) => i && typeof i.id === 'string' && queueKind(i.action) && i.target?.id);
  return {
    paused: typeof q.paused === 'string' && q.paused ? q.paused : null,
    cap: Number(q.cap) || QUEUE_CAP,
    waiting: items.filter((i) => i.status === 'waiting').length,
    items,
  };
}

const listeners = new Set();
let now = SCANNER_UNKNOWN;
let said = JSON.stringify(now);
let timer = null;
let asking = null;
let epoch = 0;              // moves when this page starts a job: answers asked before then are stale
let starting = false;       // this page's start request is on its way
const followed = new Set(); // jobs (by startedAt) this page has seen running, or started

function publish(next) {
  const text = JSON.stringify(next);
  if (text === said) return;
  said = text;
  now = Object.freeze(next);
  for (const listener of [...listeners]) listener();
}

/**
 * An answer from GET /api/scraper?job=1. `finished` is how the jobs this page
 * watched ended, newest first, so a card can say its scan is done even if it
 * was closed while the scan ran, and never shows the end of a scan from before
 * the page opened.
 */
function take(s) {
  if (!s || typeof s !== 'object') return;
  const running = s.running === true;
  if (running && s.startedAt != null) followed.add(s.startedAt);
  // How the last few jobs ended, whoever started them (the server's own
  // `recent`): what tells a slower answer about a job that it has ended
  // (statusWithJob).
  const recent = (Array.isArray(s.recent) ? s.recent : []).filter((j) => j && typeof j === 'object' && j.startedAt != null);
  const finished = recent
    .filter((j) => followed.has(j.startedAt))
    .map((j) => ({ ...j, log: !running && j.startedAt === s.startedAt && Array.isArray(s.log) ? s.log : [] }));
  // While our own start request is on its way, the server may not have begun
  // the job yet and says nothing runs: the buttons stay grey regardless.
  publish({
    known: true,
    running: running || starting,
    pending: starting && !running,
    action: running ? s.action ?? null : starting ? now.action : null,
    target: running ? s.target ?? null : starting ? now.target : null,
    startedAt: running ? s.startedAt ?? null : null,
    progress: running ? s.progress ?? null : null,
    pages: running ? Number(s.pages) || 0 : 0,   // pages read so far (app/api/scraper/route.js)
    found: running && Array.isArray(s.found) ? s.found.map(Number).filter(Number.isFinite) : [],   // people each page found
    budget: running ? s.budget ?? null : null,
    // What LinkedIn needs you to do at the scanner's Chrome (lib/scan-progress.js needsYou), or null.
    needsYou: running && typeof s.needsYou === 'string' && s.needsYou ? s.needsYou : null,
    log: running && Array.isArray(s.log) ? s.log : [],
    finished,
    recent,
    queue: cleanQueueView(s.queue),
    // The daily limit: lifted for this session, or just reached (the notch offers the lift).
    limits: cleanLimits(s.limits),
    auto: cleanAutoView(s.auto),
  });
}

function ask() {
  if (asking && asking.epoch === epoch) return asking.promise;
  const asked = epoch;
  const promise = fetch('/api/scraper?job=1')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => { if (asked === epoch) take(s); })
    .catch(() => { /* the app restarting, say: keep the last answer */ })
    .finally(() => { if (asking?.promise === promise) asking = null; });
  asking = { epoch: asked, promise };
  return promise;
}

function schedule() {
  clearTimeout(timer);
  timer = listeners.size ? setTimeout(tick, now.running ? BUSY_MS : QUIET_MS) : null;
}

async function tick() {
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (!hidden || now.running) await ask();
  schedule();
}

// Shown again, or focused: look now, not when the held-back timer comes round.
function wake() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  tick();
}
function listenForWake(on) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const how = on ? 'addEventListener' : 'removeEventListener';
  document[how]('visibilitychange', wake);
  window[how]('focus', wake);
  window[how]('pageshow', wake);
}

/** Call `listener` whenever the answer changes. Returns the way to stop. */
export function watchScanner(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    listenForWake(true);
    tick();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      timer = null;
      listenForWake(false);
    }
  };
}

/** The latest answer: { known, running, pending, action, target, startedAt, progress, log, finished, recent }. */
export function scannerNow() {
  return now;
}

/**
 * GET /api/scraper's whole status (the Scan page's and the guided setup's,
 * app/components/useScanStatus.js), brought up to date by the job answer above,
 * which the notch reads: the same server state (route.js job()), asked more
 * cheaply. The whole status is the slower of the two to come back, so it can
 * still say a job runs after the job answer has seen it end. A job's end is
 * final, so when `recent` has the status's running job, that job is over: the
 * status says how it ended, and what runs now if something has started since
 * (the queue's next, say). Anything else is left as the status says it.
 */
export function statusWithJob(status, job) {
  if (!status || status.running !== true || status.startedAt == null || !job?.known) return status;
  const ended = (Array.isArray(job.recent) ? job.recent : []).find((j) => j?.startedAt === status.startedAt);
  if (!ended) return status;
  const next = job.running === true && !job.pending && job.startedAt != null && job.startedAt !== status.startedAt;
  return {
    ...status,
    running: next,
    action: next ? job.action ?? null : ended.action ?? status.action,
    target: next ? job.target ?? null : ended.target ?? null,
    startedAt: next ? job.startedAt : status.startedAt,
    exitCode: next ? null : ended.exitCode ?? null,
    failure: next ? null : ended.failure ?? null,
    progress: next ? job.progress ?? null : null,
    needsYou: next ? job.needsYou ?? null : null,
    pages: next ? job.pages ?? 0 : 0,
    found: next ? job.found ?? [] : [],
    budget: next ? job.budget ?? null : null,
    log: next ? job.log ?? [] : status.log,
  };
}

/**
 * Start a job. Every Scan button greys out at once, not a poll later.
 * Resolves once the scanner has taken it, with `ended`: a promise of how it
 * ends ({ exitCode, failure, log, … }). onLog gets the whole log as it grows.
 * `id` is who a scan of a person is of, so their card can find it again.
 */
export async function beginScrape(action, { name, id, onLog, ...extra } = {}) {
  // Pressed while another job runs: it goes in the queue, so the running job
  // keeps its place in every view; nothing is claimed for this one.
  if (willQueue(now, action, { id })) {
    const d = await startScrape(action, name, { ...(id ? { id } : {}), ...extra });
    if (!d?.queued) {
      // It started after all: the job ended while the press was on its way.
      tick();
      return { startedAt: d?.startedAt ?? null, ended: followEnd(d?.startedAt ?? null, onLog) };
    }
    if (d.queue) publish({ ...now, queue: cleanQueueView(d.queue) });
    tick();
    return { queued: true, place: d.place ?? null, duplicate: Boolean(d.duplicate), startedAt: null, ended: null };
  }
  epoch++;
  starting = true;
  publish({
    ...now, known: true, running: true, pending: true, action,
    target: name || id ? { id: id ?? null, name: name ?? null } : null,
    startedAt: null, progress: null, log: [], needsYou: null,
  });
  let started;
  try {
    // startScrape adds "Show the scanner's Chrome window" itself (scanRequest), however the scan was started.
    started = await startScrape(action, name, { ...(id ? { id } : {}), ...extra });
  } catch (err) {
    // Refused, often because something else runs: ask what, straight away.
    // Until the answer comes, only our own claim is taken back.
    starting = false;
    epoch++;
    if (now.pending) publish({ ...now, running: false, pending: false, action: null, target: null, log: [] });
    tick();
    throw err;
  }
  starting = false;
  epoch++;
  if (started?.queued) {
    // Something started between the last look and this press: queued after all.
    if (started.queue) publish({ ...now, queue: cleanQueueView(started.queue) });
    tick();
    return { queued: true, place: started.place ?? null, duplicate: Boolean(started.duplicate), startedAt: null, ended: null };
  }
  const mine = started?.startedAt ?? null;
  return { startedAt: mine, ended: followEnd(mine, onLog) };
}

/** How the job that started at `mine` ends: a promise of { exitCode, failure, log, … }. */
function followEnd(mine, onLog) {
  if (mine != null) followed.add(mine);
  const ended = new Promise((resolve) => {
    const stop = watchScanner(() => {
      if (now.running && now.startedAt === mine) onLog?.(now.log);
      // A server from before jobs had a start time (one left running while
      // the app updated): the first answer with nothing running is the end.
      const end = mine == null
        ? (!now.running ? { exitCode: null, failure: null, log: [] } : null)
        : now.finished.find((j) => j.startedAt === mine);
      if (!end) return;
      stop();
      if (end.log.length) onLog?.(end.log);
      resolve(end);
    });
    tick();
  });
  return ended;
}

/**
 * Would a press of `action` for `person` go in the queue (lib/scan-queue.js)?
 * While another job runs, Auto and a scan of one person's circle, picked by
 * id, wait their turn instead of being refused, up to QUEUE_CAP.
 */
export function willQueue(job, action, person) {
  if (!job?.running || job.pending || !queueKind(action) || !person?.id) return false;
  if (queueKind(job.action) === queueKind(action) && job.target?.id === person.id) return false;
  return (job.queue?.waiting ?? 0) < QUEUE_CAP || placeOf(job.queue, action, person.id) != null;
}

/** This person's place in the queue for `action` (1 runs next), or null. */
export function queuedPlace(job, action, person) {
  return placeOf(job?.queue, action, person?.id);
}

/**
 * This person's waiting request of the same kind as `action`, or null:
 * { place, label, action }. `action` is what was queued: a Scan and a Resume
 * of one circle are one request, so the button that was pressed says it.
 */
export function queuedFor(job, action, person) {
  const place = queuedPlace(job, action, person);
  if (!place) return null;
  const item = job.queue.items.filter((i) => i.status === 'waiting')[place - 1];
  return { place, label: queuedLabel(place), action: item?.action ?? action };
}

/** A queued button's words: "Queued · 2nd". */
export function queuedLabel(place) {
  return place ? `Queued · ${ordinal(place)}` : null;
}

/** Start a job and follow it to its end: resolves with how it ended. */
export function runScrape(action, opts = {}) {
  return beginScrape(action, opts).then((s) => s.ended);
}

/**
 * Start a job where its button is, the way a profile card's scan box does
 * (Sidebar.js CreateClusterCard): whether the scanner is set up first, then
 * beginScrape, so every Scan button, the header and the notch react at once.
 * No page to go to and no question first (Blake, 2026-10-04: "we need to make
 * it so theres no pop up or nothing"). Resolves to null once it has started,
 * or to why it didn't, in words for a short line beside the button. Never throws.
 */
export async function startHere(action, opts = {}) {
  const blocked = notReadyMessage(await scraperStatus().catch(() => null));
  if (blocked) return blocked;
  try {
    // Queued counts as started: the button says its place (queuedLabel).
    await beginScrape(action, opts);
    return null;
  } catch (e) {
    return e?.message || 'Could not start the scan.';
  }
}

/** Is this job, running or finished, a read of one person's circle? */
export function isCircleScan(job) {
  return Boolean(job?.target) && ['bridge', 'rescrape', 'resume'].includes(job.action);
}

/**
 * Does this job add people to circles on the map while it runs: one person's
 * circle, or a batch of them (Map 2nd degree, every paused list)? The map
 * looks again every so often while one does, with Bridge Chains open
 * (app/page.js NetworkRefresh), so the Scan page's "Watch it fill in" shows
 * the circle filling in, not as it was when the page opened.
 */
export function fillsCircles(job) {
  return isCircleScan(job) || ['auto-bridge', 'auto-bridge-retry', 'resume-all'].includes(job?.action);
}

/**
 * Is this job, running or finished, a read of this person's circle? By id when
 * both have one: two connections can share a name. Else by name.
 */
export function scansCircleOf(job, person) {
  if (!isCircleScan(job) || !person) return false;
  const { id, name } = job.target;
  if (id && person.id) return id === person.id;
  return Boolean(name) && name === person.name;
}

/** Why the Scan buttons are greyed out, in a few words; null when nothing runs. */
export function busyReason(job = now) {
  if (!job?.running) return null;
  const who = job.target?.name;
  switch (job.action) {
    case 'bridge':
    case 'rescrape':
    case 'resume':
      return who ? `${who}’s circle is being scanned` : 'A circle is being scanned';
    case 'company':
      return who ? `${who} is being scanned` : 'A company is being scanned';
    case 'auto-bridge':
    case 'auto-bridge-retry':
    case 'resume-all':
      return 'Your bridges are being mapped, one by one';
    case 'full':
    case 'refresh':
      return 'Your own connections are being scanned';
    case 'connect':
      return who ? `A request to ${who} is being sent` : 'A connection request is being sent';
    case 'read-profiles':
      return 'Your connections’ profiles are being read, one a minute at most';
    default:
      return runningNow(job.action);
  }
}
