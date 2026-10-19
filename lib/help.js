// Help: the tour at the start, the hints on first visits, and Settings → Help
// (Blake's backlog: "a tutorial at the start with a curated video, a dedicated
// section in the settings, a hints section").
//
//   The tour   offered once, on the map, after the guided setup: a film to start
//              (TOUR_FILM), then a few steps, each pointing at the real thing in
//              the app (a tab, the map, the ⚙ button). Back, Next, Skip and Esc.
//              Never offered while a scan runs: it waits for the next time the
//              map opens with nothing running. Replayed from Settings → Help
//              (TOUR_REPLAY_HREF).
//   Hints      one small card at a time, on the first visits to a place (HINTS),
//              until it's dismissed. Never during a scan, never over the tour,
//              never under Sixgree's own browser, and none at all with Settings
//              → Help's switch off.
//   The page   Settings → Help: Replay the tour, the hints switch, how-tos
//              (HOW_TOS), what scanning's pace and limits mean (PACING_NOTES),
//              shortcuts (SHORTCUTS), and where your data lives.
//
// What's remembered is this window's own (localStorage: TOUR_KEY, HINTS_KEY),
// like the setup's memory (lib/onboarding.js SETUP_KEY): none of it is ever a
// reason to scan or not, and nothing about it leaves this computer.
//
// Plain data and plain functions, no React and no Node imports, so the pages
// and tests/help.test.mjs read the same thing. Numbers the words quote (3.5 s,
// 10 a week, 50 a day, every 10 pages) come from other modules; the test checks
// they still agree rather than importing them here, so every page that shows a
// hint doesn't load the scoring model to say "10".

export const TOUR_KEY = 'six-degrees-tour';
export const HINTS_KEY = 'six-degrees-hints';
/** Said on window when the tour opens or closes, or a hint is dismissed or switched off. */
export const HELP_EVENT = 'six-degrees:help';

/** Settings → Help's Replay the tour: the map, which opens the tour on `?tour=replay`. */
export const TOUR_PARAM = 'tour';
export const TOUR_REPLAY = 'replay';
export const TOUR_REPLAY_HREF = `/?${TOUR_PARAM}=${TOUR_REPLAY}`;

/**
 * The film the tour opens with, from the app's own files (public/), never
 * fetched from anywhere else.
 *
 * PLACEHOLDER: there is no film in the app yet. The website's films
 * (site/video/features.mp4 and hero.mp4) show the 1.x app (the scanner built
 * in, no Map or Breach tab, Rings · Clusters · Orbit in the notch), and copying
 * one in would add 3 to 5 MB to every install for a picture of the old app. A
 * later release fills the slot: put the film and its poster in public/tour/ and
 * set `src` and `poster` to their paths ('/tour/…'). Until then the tour shows
 * a marked, empty frame in its place.
 */
export const TOUR_FILM = Object.freeze({
  src: null,
  poster: null,
  label: 'Video: a short tour of Sixgree on an invented network',
});

/** A film is set, and it's one of the app's own files. */
export const hasFilm = (film = TOUR_FILM) => typeof film?.src === 'string' && film.src.startsWith('/') && !film.src.startsWith('//');

// ── The tour ─────────────────────────────────────────────────────────────────

/**
 * The steps, in order. `target` is the [data-tour] it points at (AppTabs,
 * AppHeader's ⚙, the map page's canvas); none is the middle of the window.
 * `own`: only for your own network (not the sample or a CSV), as its tab is;
 * `scanner`: only with a scanner plugin; `linkedin`: only with the LinkedIn
 * browser plugin in the desktop app. {mod} is ⌘ on a Mac, Ctrl+ elsewhere (withKeys).
 */
export const TOUR_STEPS = Object.freeze([
  {
    key: 'film', film: true, title: 'Welcome to Sixgree',
    body: 'A minute’s tour of where everything is, each step pointing at the real thing. Skip it any time: it stays in Settings → Help.',
  },
  {
    key: 'network', target: 'network', title: 'Network Circle, in tiers',
    body: 'Everyone you know, on rings by tier: S closest to you, then A, B, C and D. The chips under the map show or hide a tier.',
  },
  {
    key: 'focus', target: 'canvas', title: 'Focus on one person',
    body: 'Click one of your connections, or hold the pointer on them for 3.5 s, and the map zooms into their circle. Esc or scroll out to come back.',
  },
  {
    key: 'degrees', target: 'degrees', title: 'Degrees and Bridge Chains',
    body: 'The people two steps away. Bridge Chains shows each connection whose circle is scanned, and the chains that lead on from them. Unscanned lists the circles still to build.',
  },
  {
    key: 'separation', target: 'separation', title: 'Separation',
    body: 'Everyone past your connections, ranked, with every way in: which of your connections knows them, and how many do.',
  },
  {
    key: 'map', target: 'map', title: 'The Map',
    body: 'Your network on a world map, by where people are. Click a place for who’s there, and which of your connections gets you to them.',
  },
  {
    key: 'breach', target: 'breach', own: true, title: 'Breach',
    body: 'Get into a company where you have no mutuals. Start with Doors, the people likeliest to accept, then climb. It suggests 10 requests a week, and you press Connect yourself.',
  },
  {
    key: 'scan', target: 'scan', own: true, scanner: true, title: 'Scan, with breaks',
    body: 'Scans read LinkedIn from your own account, a page at a time, with breaks along the way. Slower is safer, but LinkedIn can still restrict an account: no pace is a guarantee.',
  },
  {
    key: 'linkedin', target: 'linkedin', own: true, linkedin: true, title: 'LinkedIn, inside Sixgree',
    body: 'Your feed, messaging, notifications and jobs, in Sixgree’s own browser. {mod}[ and {mod}] go back and forward. Sixgree reads nothing there.',
  },
  {
    key: 'help', target: 'settings', title: 'Help is in Settings',
    body: 'Replay this tour, read the how-tos, or turn hints off, in Settings → Help. Small hints show the first time you open a place.',
  },
]);

/**
 * The steps there are for this network and what's installed:
 * `own` (your own network, not the sample or a CSV), `scanner`, `linkedin`.
 */
export function tourSteps({ own = false, scanner = false, linkedin = false } = {}) {
  return TOUR_STEPS.filter((s) => (!s.own || own) && (!s.scanner || scanner) && (!s.linkedin || linkedin));
}

/**
 * One move through the tour: 'next', 'back', 'skip' or 'esc', from step `at`
 * of `count`. Returns { at, end }: `end` is null while it's open, 'done' after
 * Next on the last step, 'skipped' after Skip or Esc.
 */
export function tourMove(at, action, count) {
  const last = Math.max(0, count - 1);
  const here = Math.min(Math.max(0, Number(at) || 0), last);
  if (action === 'next') return here >= last ? { at: here, end: 'done' } : { at: here + 1, end: null };
  if (action === 'back') return { at: Math.max(0, here - 1), end: null };
  if (action === 'skip' || action === 'esc') return { at: here, end: 'skipped' };
  return { at: here, end: null };
}

/** "2 of 9": where you are, for the card and for a screen reader. */
export const tourCount = (at, count) => `${Math.min(at + 1, count)} of ${count}`;

const browserStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** What this window remembers of the tour: { seen, ended }. `ended` is 'done', 'skipped' or null. */
export function readTour(storage = browserStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(TOUR_KEY) || '{}');
    return { seen: raw?.seen === true, ended: raw?.ended === 'done' || raw?.ended === 'skipped' ? raw.ended : null };
  } catch {
    return { seen: false, ended: null };
  }
}

export function rememberTour(change, storage = browserStorage()) {
  const next = { ...readTour(storage), ...change };
  try { storage?.setItem(TOUR_KEY, JSON.stringify(next)); } catch { /* this visit only: it may be offered again */ }
  announce();
  return next;
}

/**
 * Does the tour open, now the map is showing? 'replay' (asked for from
 * Settings → Help), 'first' (never seen in this window), or null. Never in the
 * public demo; the first time, never while a scan runs or before the scanner
 * has said whether one does: that visit passes, and it's offered on the next.
 */
export function tourOpens({ memory, demo = false, replay = false, scanKnown = true, scanning = false } = {}) {
  if (demo) return null;
  if (replay) return 'replay';
  if (memory?.seen) return null;
  if (!scanKnown || scanning) return null;
  return 'first';
}

/** {mod} as this computer writes it: ⌘ on a Mac, Ctrl+ elsewhere. */
export function withKeys(text, mac) {
  return String(text ?? '').replaceAll('{mod}', mac ? '⌘' : 'Ctrl+');
}

/** Is this a Mac (or an iPad), by what the browser says. */
export const isMac = (nav = typeof navigator !== 'undefined' ? navigator : null) => /Mac|iP(hone|ad)/.test(nav?.platform || nav?.userAgent || '');

/** Narrower than this, the tour's card is a sheet at the foot of the window. */
export const NARROW = 600;

/**
 * Where the tour's card goes: beside the step's target, never off screen.
 * `target` is the target's box (getBoundingClientRect) or null, `card` the
 * card's { width, height }, `view` the window's. Below the target if it fits,
 * else above, else over its foot (the map, as tall as the window); centred
 * with no target; on a narrow window, a sheet along the bottom.
 * Returns { side, top, left }.
 */
export function placeCard(target, card, view, { gap = 14, margin = 16 } = {}) {
  const w = Math.max(0, card?.width || 0);
  const h = Math.max(0, card?.height || 0);
  const vw = Math.max(0, view?.width || 0);
  const vh = Math.max(0, view?.height || 0);
  const x = (v) => Math.round(Math.min(Math.max(margin, v), Math.max(margin, vw - w - margin)));
  const y = (v) => Math.round(Math.min(Math.max(margin, v), Math.max(margin, vh - h - margin)));
  if (vw < NARROW) return { side: 'sheet', left: margin, top: y(vh - h - margin) };
  if (!target) return { side: 'center', left: x((vw - w) / 2), top: y((vh - h) / 2) };
  const across = target.left + target.width / 2 - w / 2;
  const below = target.top + target.height + gap;
  if (below + h + margin <= vh) return { side: 'below', left: x(across), top: Math.round(below) };
  const above = target.top - gap - h;
  if (above >= margin) return { side: 'above', left: x(across), top: Math.round(above) };
  return { side: 'over', left: x(across), top: y(Math.min(target.top + target.height, vh) - h - margin * 2) };
}

/**
 * The ring round a step's target: a little outside it, or a little inside one
 * that fills most of the window (the map), so the ring stays on screen.
 */
export function spotlight(target, view, pad = 6) {
  if (!target) return null;
  const big = target.width * target.height > 0.4 * Math.max(1, (view?.width || 0) * (view?.height || 0));
  const p = big ? -10 : pad;
  return {
    top: Math.round(target.top - p), left: Math.round(target.left - p),
    width: Math.round(target.width + p * 2), height: Math.round(target.height + p * 2),
  };
}

// ── Hints ────────────────────────────────────────────────────────────────────

/**
 * One hint a place, shown on the first visits there until it's dismissed.
 * `place` is the header's `active` for that page or map tab (placeOf).
 */
export const HINTS = Object.freeze([
  { key: 'focus', place: 'network', text: 'Hold the pointer on one of your connections for 3.5 s, or click them, to focus on their circle. Esc comes back.' },
  { key: 'chains', place: 'degrees', text: 'Bridge Chains follows each scanned circle out from you. Click a bridge, or hold the pointer on it for 3.5 s, to focus on its circle.' },
  { key: 'ways-in', place: 'separation', text: 'Each person here shows who can introduce you, and how many of your connections know them.' },
  { key: 'places', place: 'map', text: 'Click a place for who’s there, and which of your connections gets you to them.' },
  { key: 'companies', place: 'paths', text: 'Click a company for who you know there, who you can reach, and the warmest way in.' },
  { key: 'doors', place: 'breach', text: 'Breach: start with Doors, the people likeliest to accept. Every request is yours to send.' },
  { key: 'slow', place: 'scan', text: 'Slow is safer. The scan windows and the breaks keep scans gentle, but LinkedIn can still restrict an account.' },
  { key: 'keys', place: 'linkedin', text: '{mod}[ and {mod}] go back and forward in LinkedIn. Sixgree reads nothing here.' },
]);

const HINT_KEYS = new Set(HINTS.map((h) => h.key));
const PLACES = new Set(HINTS.map((h) => h.place));

/** The place a page is, from the header's `active` ('network', 'breach', 'scan'…), or null for one with no hint. */
export const placeOf = (active) => (PLACES.has(active) ? active : null);

/** What this window remembers of the hints: { off, dismissed: [keys] }. */
export function readHints(storage = browserStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(HINTS_KEY) || '{}');
    const dismissed = Array.isArray(raw?.dismissed) ? [...new Set(raw.dismissed.filter((k) => HINT_KEYS.has(k)))] : [];
    return { off: raw?.off === true, dismissed };
  } catch {
    return { off: false, dismissed: [] };
  }
}

function writeHints(next, storage) {
  try { storage?.setItem(HINTS_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
  announce();
  return next;
}

/** A hint's Got it: never again in this window. */
export function dismissHint(key, storage = browserStorage()) {
  const now = readHints(storage);
  if (!HINT_KEYS.has(key) || now.dismissed.includes(key)) return now;
  return writeHints({ ...now, dismissed: [...now.dismissed, key] }, storage);
}

/** Settings → Help's switch: every hint off, or back on (the dismissed stay dismissed). */
export function setHintsOff(off, storage = browserStorage()) {
  return writeHints({ ...readHints(storage), off: Boolean(off) }, storage);
}

/** Settings → Help's Show them again: every dismissed hint back, the switch as it is. */
export function resetHints(storage = browserStorage()) {
  return writeHints({ ...readHints(storage), dismissed: [] }, storage);
}

/**
 * The one hint to show at `place` now, or null: none with the switch off,
 * before the tour has been offered (it comes first), while the tour is open,
 * while a scan runs, while Sixgree's own browser is in front (it would be
 * under it), or once dismissed.
 */
export function hintFor(place, { hints, tourSeen = false, touring = false, scanning = false, panel = false } = {}) {
  const memory = hints || { off: false, dismissed: [] };
  if (memory.off || !tourSeen || touring || scanning || panel) return null;
  const hint = HINTS.find((h) => h.place === place);
  return hint && !memory.dismissed.includes(hint.key) ? hint : null;
}

// ── Settings → Help ──────────────────────────────────────────────────────────

/** Short how-tos, each with the place it happens (`href`) and the link's words (`go`). */
export const HOW_TOS = Object.freeze([
  {
    key: 'tiers', title: 'Read your tiers', href: '/?mode=network', go: 'Open Network Circle',
    text: 'Network Circle puts everyone you know on rings by tier, S closest to you, then A, B, C and D. Tap a chip under the map to hide or show a tier.',
  },
  {
    key: 'focus', title: 'Focus on someone’s circle', href: '/?mode=network', go: 'Open Network Circle',
    text: 'Click one of your connections in Network Circle, or a bridge in Bridge Chains, or hold the pointer on it for 3.5 s, to zoom into their circle. Esc comes back.',
  },
  {
    key: 'chains', title: 'Follow a Bridge Chain', href: '/?mode=degrees', go: 'Open Degrees',
    text: 'Degrees opens on Bridge Chains: each connection whose circle is scanned, and where it leads. Unscanned, in the notch, lists the circles still to build.',
  },
  {
    key: 'separation', title: 'Find who can introduce you', href: '/?mode=separation', go: 'Open Separation',
    text: 'Separation ranks everyone past your connections, with every way in: which of your connections knows them, and how many do.',
  },
  {
    key: 'map', title: 'See where your network is', href: '/?mode=map', go: 'Open the Map',
    text: 'The Map puts your network on a world map. Click a place for who’s there, and which of your connections gets you to them.',
  },
  {
    key: 'breach', title: 'Breach a company', href: '/breach', go: 'Open Breach',
    text: 'Pick a company you have no way into, and start with Doors: the people likeliest to accept. It suggests 10 requests a week, each sent by you.',
  },
  {
    key: 'scan', title: 'Scan gently, with breaks', href: '/setup', go: 'Open Scan',
    text: 'Scan maps your connections and their circles from your own LinkedIn account. Pick a slow speed and let the breaks run. Needs a scanner plugin.',
  },
  {
    key: 'linkedin', title: 'Use LinkedIn inside Sixgree', href: '/linkedin', go: 'Open LinkedIn',
    text: 'With the LinkedIn browser plugin, in the desktop app: your feed, messaging, notifications and jobs. {mod}[ and {mod}] go back and forward.',
  },
]);

/** What scanning's pace and limits mean, said plainly. */
export const PACING_NOTES = Object.freeze([
  'Scans read LinkedIn from your own account, in your own Chrome. LinkedIn can restrict accounts that read this way, and no setting rules that out: slow is safer, never a guarantee.',
  'Scan windows cap search pages, by hand or automatic: at most 60 a window, two windows a day, a new one 6 hours after the last began. Speed (Slow, Medium or Fast) sets how far apart pages are read; it never raises a window.',
  'Breaks by hand pause after every 10 pages, because pages read seconds apart are what LinkedIn notices. Lifting the limits or Dev mode never passes the windows.',
  'If LinkedIn warns you or asks you to check something, stop for the day.',
]);

/** The keyboard shortcuts: `keys` as they're pressed ({mod} as withKeys), and what they do. */
export const SHORTCUTS = Object.freeze([
  { keys: '{mod}[ and {mod}]', what: 'Back and forward in Sixgree’s own browser (the LinkedIn panel), in the desktop app.' },
  { keys: 'Esc', what: 'Close the tour. Come back out of someone’s circle in Network Circle.' },
  { keys: '{mod}.', what: 'Tuck the notch up out of the way, or bring it back.' },
  { keys: '{mod},', what: 'Settings, in the desktop app.' },
]);

// ── The window's copy, for the pages ─────────────────────────────────────────

let touring = false;

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HELP_EVENT));
}

/** Called when anything here changes, in this window or another one with the same storage. */
export function watchHelp(change) {
  window.addEventListener('storage', change);
  window.addEventListener(HELP_EVENT, change);
  return () => {
    window.removeEventListener('storage', change);
    window.removeEventListener(HELP_EVENT, change);
  };
}

/** The tour is open (Tour.js says so), so no hint shows over it. */
export function setTouring(on) {
  if (touring === Boolean(on)) return;
  touring = Boolean(on);
  announce();
}
export const touringNow = () => touring;

/** The stored words, as they are: what a page compares to know something changed. */
export function hintsRawNow() {
  try { return localStorage.getItem(HINTS_KEY) || ''; } catch { return ''; }
}
export function tourRawNow() {
  try { return localStorage.getItem(TOUR_KEY) || ''; } catch { return ''; }
}
export const nothingStored = () => '';
