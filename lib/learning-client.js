// The pages' side of the learning log (lib/learning-log.js, POST
// /api/learning, the taxonomy in lib/behavior-taxonomy.js): what the pages
// show and what is done in them, sessions, tabs and dwell, controls, focus,
// person interest, sections, the LinkedIn panel and the app's health.
// Same-origin only, to this app's own server; the log never leaves the
// computer. Never in the sample or the public demo, which have no server.
//
// Nothing here is in the way of the page: events go into a buffer
// (lib/behavior-buffer.js) that drops repeats and floods and sends a batch
// every few seconds when the page is idle, and everything left as the window
// goes away. Listeners are passive, timers are coarse (a five-second tick for
// active time), and summaries (frame times, long tasks, hovers) are counted
// here and sent as one event each.
//
// A list is reported once it has settled (a short wait after it's drawn) and
// only when what it shows has changed, so scrolling, hovering and re-renders
// never spam the log. The server dedupes too.

import { IS_DEMO } from './demo.js';
import { createBuffer } from './behavior-buffer.js';
import { sizeBucket, queryCategory, keepsQueryText, scrubMessage } from './behavior-taxonomy.js';
import { notchTabsNow, watchNotchTabs } from './island.js';

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const SETTLE_MS = 900;
const SESSION_KEY = 'six-degrees-session';
const SESSION_GAP_MS = 30 * 60 * 1000;   // a window left alone this long starts a new session
const PULSE_MS = 5 * 60 * 1000;
const TICK_MS = 5000;
const ACTIVE_MS = 60 * 1000;              // used in the last minute, with the window in front: active
const HOVER_MS = 1500;

let sid = null;

function post(payload) {
  if (IS_DEMO || !browser()) return;
  try {
    fetch('/api/learning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: sid, ...payload }), keepalive: true,
    }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.on === false) buffer.setOn(false); }).catch(() => {});
  } catch { /* the log is never in the way */ }
}

const idle = (fn) => {
  if (browser() && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout: 2000 });
  else setTimeout(fn, 0);
};

const buffer = createBuffer({ send: post, idle });

const who = (r) => ({ id: r?.id ?? null, profile_url: r?.profile_url ?? r?.profileUrl ?? null });
const hasWho = (p) => p.id != null || p.profile_url;

/**
 * One event (lib/behavior-taxonomy.js TAXONOMY): `person` a row or { id,
 * profile_url } for the person kinds, `key` to keep it once per session and key.
 * The tab it happened on goes with it.
 */
export function track(kind, type, data = {}, { person = null, key = null } = {}) {
  if (IS_DEMO || !browser()) return;
  try {
    const p = person ? who(person) : null;
    if (person && !hasWho(p)) return;
    buffer.add({ kind, type, data: { ...data, tab: data?.tab ?? view?.tab ?? null }, person: p, key });
  } catch { /* the log is never in the way */ }
}

/** "Record my behaviour" switched on the Settings page: off, nothing more is sent and what's waiting goes. */
export function setBehaviourOn(on) { buffer.setOn(on); }

// ── Lists shown ──────────────────────────────────────────────────────────────

const lastShown = new Map();
const timers = new Map();

/**
 * A list as drawn: `list` is where (separation, breach, class, focus, map,
 * card...), `rows` in the order shown (the top 50 go), `sort` the order or lens.
 */
export function logExposure(list, rows = [], { sort = null, context = null } = {}) {
  const people = rows.slice(0, 50).map(who).filter(hasWho);
  if (!people.length) return;
  const sig = `${sort}|${context}|${people.map((p) => p.id ?? p.profile_url).join(',')}`;
  const key = `${list}|${context || ''}`;
  if (lastShown.get(key) === sig) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    lastShown.set(key, sig);
    track('exposure', list, { people, sort, context });
  }, SETTLE_MS));
}

/** Something done with one person: card-open, connect-click, ... (TAXONOMY.interaction). */
export function logInteraction(type, row, data = {}) {
  if (!row) return;
  track('interaction', type, data, { person: row });
}

// ── Controls ─────────────────────────────────────────────────────────────────

const has = (list, x) => Array.isArray(list) && list.includes(x);

/**
 * A Filters grid changed by a tap (lib/tier-grid.js): the Tiers switch as
 * control/tiers, else control/filter saying what was switched: one tier, one
 * degree, one cell (tier and degree), or the whole grid (a reset, Show all).
 */
export function logGridChange(prev, next, where = null) {
  if (!prev || !next || JSON.stringify(prev) === JSON.stringify(next)) return;
  if (Boolean(prev.tiersOff) !== Boolean(next.tiersOff)) { track('control', 'tiers', { on: !next.tiersOff, where }); return; }
  const diff = [];
  if (next.tiersOff) {
    for (const d of new Set([...(prev.flat || []), ...(next.flat || [])])) if (has(prev.flat, d) !== has(next.flat, d)) diff.push(['degree', d, has(next.flat, d)]);
  } else {
    const tiers = new Set([...Object.keys(prev.degrees || {}), ...Object.keys(next.degrees || {})]);
    for (const t of tiers) {
      if (has(prev.hidden, t) !== has(next.hidden, t)) { diff.push(['tier', t, !has(next.hidden, t)]); continue; }
      for (const d of new Set([...(prev.degrees?.[t] || []), ...(next.degrees?.[t] || [])])) {
        if (has(prev.degrees?.[t], d) !== has(next.degrees?.[t], d)) diff.push(['cell', `${t}${d}`, has(next.degrees?.[t], d)]);
      }
    }
  }
  if (diff.length === 1) { const [[what, value, on]] = diff; track('control', 'filter', { what, value, on, where }); return; }
  const degrees = new Set(diff.map(([what, value]) => (what === 'cell' ? String(value).slice(1) : null)));
  if (diff.every(([what]) => what === 'cell') && degrees.size === 1) {
    track('control', 'filter', { what: 'degree', value: Number([...degrees][0]), on: diff[0][2], where });
    return;
  }
  track('control', 'filter', { what: 'grid', value: diff.length, where });
}

// ── Dwell, rests and settled values ──────────────────────────────────────────

// Rests of the pointer on a person dot, summed per person between flushes:
// one event each, never one per frame.
const rests = new Map();
buffer.onFlush(() => {
  for (const r of rests.values()) track('interaction', 'hover', { n: r.n, ms: Math.round(r.ms), where: r.where }, { person: r.person });
  rests.clear();
});

/** The pointer rested on someone for `ms`: kept from 1.5 s, summed with their other rests. */
export function logHover(row, ms, where = null) {
  if (!row || !(ms >= HOVER_MS)) return;
  const p = who(row);
  if (!hasWho(p)) return;
  const k = p.id ?? p.profile_url;
  const r = rests.get(k) || { person: p, n: 0, ms: 0, where };
  r.n += 1;
  r.ms += ms;
  rests.set(k, r);
}

const settling = new Map();
/** A value that changes many times a second (a slider): recorded once it has held still for `wait` ms. */
export function trackSettled(kind, type, data, { key = `${kind}/${type}`, wait = 1000 } = {}) {
  clearTimeout(settling.get(key));
  settling.set(key, setTimeout(() => { settling.delete(key); track(kind, type, data); }, wait));
}

/**
 * A search or finder query, once typing stops: its category and length, and
 * its words only for a company or a sector (never a name). `known` may hold
 * the companies and sectors the page knows, lower case; `as` names the
 * category outright for a box that only finds one kind ('company' for Find a
 * company, 'person' for Find a person).
 */
export function logSearch(where, text, { results = null, known = {}, as = null } = {}) {
  const q = String(text ?? '').trim();
  const category = !q ? 'empty' : as || queryCategory(q, known);
  trackSettled('control', 'search', {
    where, category, length: q.length, ...(keepsQueryText(category) ? { text: q.slice(0, 80) } : {}), ...(results != null ? { results } : {}),
  }, { key: `search/${where}`, wait: 1000 });
}

// ── Frame times and long tasks ───────────────────────────────────────────────

// Upper bounds of the frame-time buckets, in ms; the last catches the rest.
const FRAME_BUCKETS = [8, 12, 17, 25, 33, 50, 100, 200, Infinity];
const meters = new Map();

function percentile(hist, total, q) {
  let seen = 0;
  for (let i = 0; i < hist.length; i += 1) {
    seen += hist[i];
    if (seen >= total * q) return FRAME_BUCKETS[i] === Infinity ? 200 : FRAME_BUCKETS[i];
  }
  return null;
}

/**
 * A view's frame meter (Network Circle's Galaxy): `tick(ms)` per frame drawn,
 * counted into buckets; summed into one health/frames event with each pulse
 * and at the end.
 */
export function frameMeter(viewName) {
  if (!meters.has(viewName)) meters.set(viewName, { hist: FRAME_BUCKETS.map(() => 0), frames: 0, max: 0, slow: 0 });
  const m = meters.get(viewName);
  return {
    tick(ms) {
      if (!(ms > 0) || ms > 10000) return;
      m.frames += 1;
      if (ms > m.max) m.max = ms;
      if (ms > 50) m.slow += 1;
      m.hist[FRAME_BUCKETS.findIndex((b) => ms <= b)] += 1;
    },
  };
}

let longTasks = { count: 0, totalMs: 0, maxMs: 0 };

function reportHealth() {
  for (const [name, m] of meters) {
    if (!m.frames) continue;
    track('health', 'frames', { view: name, frames: m.frames, p50: percentile(m.hist, m.frames, 0.5), p95: percentile(m.hist, m.frames, 0.95), max: Math.round(m.max), slow: m.slow });
    m.hist.fill(0); m.frames = 0; m.max = 0; m.slow = 0;
  }
  if (longTasks.count) {
    track('health', 'long-tasks', { count: longTasks.count, totalMs: Math.round(longTasks.totalMs), maxMs: Math.round(longTasks.maxMs) });
    longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  }
}

// ── The window's session, its tabs and its health ────────────────────────────

let started = false;
let openedAt = 0;
let activeMs = 0;
let hiddenMs = 0;
let lastTick = 0;
let lastInput = 0;
let views = 0;
let view = null;          // { tab, sub, at, active }
let pendingTab = null;
let pendingSub = null;
let lastEntry = null;     // { entry, at }: what was clicked or pressed last
let settleTimer = null;
let size = null;

// Kept in the window's sessionStorage, so a reload carries the session on: its
// id, when it started, and its active and hidden time so far.
function rememberSession() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: sid, start: openedAt, last: Date.now(), activeMs, hiddenMs }));
  } catch { /* a private window: a session per load */ }
}

/** The session this window is in: the one kept, if it was used in the last half hour, else a new one. */
function sessionNow() {
  const now = Date.now();
  try {
    const s = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && typeof s.id === 'string' && /^[\w-]{4,40}$/.test(s.id) && now - Number(s.last) < SESSION_GAP_MS) {
      const start = Number(s.start);
      return { id: s.id, start: start > 0 && start <= now ? start : now, activeMs: Number(s.activeMs) || 0, hiddenMs: Number(s.hiddenMs) || 0 };
    }
  } catch { /* a new one */ }
  return { id: `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, start: now, activeMs: 0, hiddenMs: 0 };
}

function tick() {
  const now = Date.now();
  const dt = Math.min(now - lastTick, TICK_MS * 3);
  lastTick = now;
  if (document.visibilityState === 'hidden') hiddenMs += dt;
  else if (document.hasFocus() && now - lastInput < ACTIVE_MS) activeMs += dt;
}

/** Which tab the page is on: the app's tab row says (app/components/AppTabs.js). */
export function noteTab(tab) {
  if (!tab) return;
  pendingTab = String(tab);
  settleView();
}

/** The current visit's number: a section seen once per visit (section/seen) uses it. */
export const visitNo = () => views;

function closeView(at = Date.now()) {
  if (!view) return;
  tick();
  const ms = at - view.at;
  track('nav', 'dwell', { tab: view.tab, sub: view.sub, ms, activeMs: Math.min(ms, Math.max(0, activeMs - view.active)) });
}

// The tab row and the notch change in the same commit, a page's tabs a moment
// before or after its tab: the view is read once they've both landed.
function settleView() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const tab = pendingTab;
    if (!tab) return;
    const sub = pendingSub ?? null;
    if (view && view.tab === tab && view.sub === sub) return;
    const now = Date.now();
    const entry = lastEntry && now - lastEntry.at < 2500 ? lastEntry.entry : view ? 'app' : 'open';
    lastEntry = null;
    closeView(now);
    tick();   // the active time so far, so this view's counts from here
    track('nav', 'enter', { tab, sub, from: view?.tab ?? null, fromSub: view?.sub ?? null, entry });
    view = { tab, sub, at: now, active: activeMs };
    views += 1;
  }, 80);
}

/** What a click was on, for the next tab's `entry`: the notch, the header, a card, a link or a button. */
function entryOf(el) {
  const marked = el.closest('[data-entry]');
  if (marked) return String(marked.dataset.entry).slice(0, 20);
  if (el.closest('[data-notch]')) return 'notch';
  if (el.closest('#main-tabs') || el.closest('header')) return 'header';
  if (el.closest('[data-card]')) return 'card';
  return el.tagName === 'A' ? 'link' : 'button';
}

const fileOf = (src) => String(src || '').split(/[?#]/)[0].split('/').pop().slice(0, 60);

function apiPath(input) {
  try {
    const url = new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return null;
    return url.pathname.slice(0, 80);
  } catch { return null; }
}

function watchFetch() {
  const real = window.fetch;
  if (typeof real !== 'function' || real.sixgreeWatched) return;
  const watched = function watchedFetch(input, init) {
    const p = real.call(window, input, init);
    try {
      const path = apiPath(input);
      if (path && path !== '/api/learning') {
        const method = String(init?.method || input?.method || 'GET').toUpperCase().slice(0, 8);
        const failed = (status) => track('health', 'api-failure', { route: path, status, method }, { key: `${path}:${status}:${Math.floor(Date.now() / 60000)}` });
        p.then((r) => { if (!r.ok) failed(r.status); }, (err) => { if (err?.name !== 'AbortError') failed(0); });
      }
    } catch { /* never in the way of the request */ }
    return p;
  };
  watched.sixgreeWatched = true;
  window.fetch = watched;
}

/**
 * Start the window's session (app/components/BehaviorLogger.js, once per page
 * load): its start, a pulse every five minutes and its end; the tab shown and
 * for how long; errors, long tasks and failed requests. Once only.
 */
export function startBehaviour() {
  if (started || IS_DEMO || !browser()) return;
  started = true;
  const kept = sessionNow();
  sid = kept.id;
  openedAt = kept.start;
  activeMs = kept.activeMs;
  hiddenMs = kept.hiddenMs;
  lastTick = Date.now();
  lastInput = lastTick;
  rememberSession();
  size = sizeBucket(window.innerWidth, window.innerHeight);
  let reload = false;
  try { reload = performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { /* not said */ }
  track('session', 'start', { shell: window.sixgreeDesktop ? 'desktop' : 'browser', size, reload });

  const input = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'pointermove', 'touchstart']) window.addEventListener(ev, input, { passive: true, capture: true });
  setInterval(tick, TICK_MS);
  setInterval(() => {
    tick();
    rememberSession();
    track('session', 'pulse', { ms: Date.now() - openedAt, activeMs, views });
    reportHealth();
  }, PULSE_MS);

  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('a[href], button, [role="tab"], [role="button"]');
    if (el) lastEntry = { entry: entryOf(el), at: Date.now() };
  }, { capture: true, passive: true });
  window.addEventListener('popstate', () => { lastEntry = { entry: 'history', at: Date.now() }; });

  // The notch's sub-tabs (lib/island.js): which one is lit is the view's sub.
  const readSub = () => {
    const cur = notchTabsNow()?.current;
    pendingSub = Array.isArray(cur) ? cur.filter((c) => c != null).join('/') || null : cur ?? null;
    settleView();
  };
  watchNotchTabs(readSub);
  readSub();

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = sizeBucket(window.innerWidth, window.innerHeight);
      if (next !== size) { track('session', 'resize', { size: next, from: size }); size = next; }
    }, 1000);
  }, { passive: true });

  window.addEventListener('error', (e) => {
    const message = scrubMessage(e.message || e.error?.message || 'Error');
    const source = `${fileOf(e.filename)}:${e.lineno || 0}`;
    track('health', 'error', { message, code: String(e.error?.name || e.error?.code || 'Error').slice(0, 40), source }, { key: `${message}|${source}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const message = scrubMessage(r?.message || (typeof r === 'string' ? r : 'Unhandled rejection'));
    track('health', 'error', { message, code: String(r?.name || r?.code || 'Rejection').slice(0, 40), source: 'promise' }, { key: `${message}|promise` });
  });
  try {
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) {
        longTasks.count += 1;
        longTasks.totalMs += t.duration;
        if (t.duration > longTasks.maxMs) longTasks.maxMs = t.duration;
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* a browser without long tasks: none counted */ }
  watchFetch();

  // The window going away: the tab's dwell, the session's end, and the rest sent now.
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    closeView();
    track('session', 'end', { ms: Date.now() - openedAt, activeMs, views, hiddenMs });
    reportHealth();
    rememberSession();
    buffer.flush({ urgent: true });
  };
  window.addEventListener('pagehide', end);
  // Hidden (another app in front, the window minimised): what's waiting goes now, in case it never comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { tick(); rememberSession(); buffer.flush({ urgent: true }); } else if (ended) {
      // Back from the back/forward cache: a session that ended goes on.
      ended = false;
      track('session', 'start', { shell: window.sixgreeDesktop ? 'desktop' : 'browser', size, reload: false });
    }
  });
}
