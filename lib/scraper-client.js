// One way to run the scraper from the browser.
//
// Every view used to POST to a Python server on http://localhost:5555 that the
// user had to start by hand, and each one told them to "double-click Start
// Scraper on your Desktop" when it was not running. There were six copies of
// that logic and one of them is why a working scraper looked broken.
//
// Now they all call this, which talks to /api/scraper on the app itself.

import { runningNow } from './scan-state.js';

export async function scraperStatus() {
  const r = await fetch('/api/scraper');
  if (!r.ok) throw new Error('Could not reach the app.');
  return r.json();
}

export async function startScrape(action, name, extra = {}) {
  const r = await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(name ? { name } : {}), ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not start the scanner.');
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
export const NO_SCAN_NOTES = Object.freeze({ skips: [], read: [] });

/**
 * What the scanner noted, for lib/reach.js: `skips`, the hidden lists
 * ([{ profileUrl, … }]), and `read`, the profile URLs of every list it has
 * read. Never throws: with no answer (the app restarting, say) nothing is
 * noted, so a hidden list shows as ready rather than anyone going missing.
 */
export async function loadScanNotes() {
  try {
    const r = await fetch('/api/scraper?reach=1');
    if (!r.ok) return NO_SCAN_NOTES;
    const d = await r.json();
    return { skips: Array.isArray(d.skips) ? d.skips : [], read: Array.isArray(d.read) ? d.read : [] };
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
    return 'The scanner is not set up yet — open Scan to set it up.';
  }
  if (!c.chrome) return 'Google Chrome is not installed.';
  return null;
}

/** Stop whatever is running. The scraper closes its browser on the way out. */
export async function stopScrape() {
  await fetch('/api/scraper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  });
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
// on screen. The idle look is skipped while the page is hidden.

const BUSY_MS = 1500;
const QUIET_MS = 5000;

/** Before the first answer, and on the server, where nothing is asked. */
export const SCANNER_UNKNOWN = Object.freeze({
  known: false, running: false, pending: false, action: null, target: null,
  startedAt: null, progress: null, log: [], finished: [],
});

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
  const finished = (Array.isArray(s.recent) ? s.recent : [])
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
    budget: running ? s.budget ?? null : null,
    log: running && Array.isArray(s.log) ? s.log : [],
    finished,
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

/** Call `listener` whenever the answer changes. Returns the way to stop. */
export function watchScanner(listener) {
  listeners.add(listener);
  if (listeners.size === 1) tick();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** The latest answer: { known, running, pending, action, target, startedAt, progress, log, finished }. */
export function scannerNow() {
  return now;
}

/**
 * Start a job. Every Scan button greys out at once, not a poll later.
 * Resolves once the scanner has taken it, with `ended`: a promise of how it
 * ends ({ exitCode, failure, log, … }). onLog gets the whole log as it grows.
 * `id` is who a scan of a person is of, so their card can find it again.
 */
export async function beginScrape(action, { name, id, onLog, ...extra } = {}) {
  epoch++;
  starting = true;
  publish({
    ...now, known: true, running: true, pending: true, action,
    target: name || id ? { id: id ?? null, name: name ?? null } : null,
    startedAt: null, progress: null, log: [],
  });
  let started;
  try {
    // Scan page → "Hide the Chrome window while scanning", remembered in this
    // browser, applies to every scan however it was started.
    let hidden = false;
    try { hidden = JSON.parse(localStorage.getItem('six-degrees-hide-chrome') || 'false') === true; } catch {}
    started = await startScrape(action, name, { ...(id ? { id } : {}), ...(hidden ? { headless: true } : {}), ...extra });
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
  const mine = started?.startedAt ?? null;
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
  return { startedAt: mine, ended };
}

/** Start a job and follow it to its end: resolves with how it ended. */
export function runScrape(action, opts = {}) {
  return beginScrape(action, opts).then((s) => s.ended);
}

/** Is this job, running or finished, a read of one person's circle? */
export function isCircleScan(job) {
  return Boolean(job?.target) && ['bridge', 'rescrape', 'resume'].includes(job.action);
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
    default:
      return runningNow(job.action);
  }
}
