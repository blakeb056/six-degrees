// Help (lib/help.js): the tour at the start, the hints on first visits, and
// Settings → Help (Blake's backlog: "a tutorial at the start with a curated
// video, a dedicated section in the settings, a hints section"). The tour is
// offered once, can be skipped, and is replayed from Settings → Help; a hint
// shows until it's dismissed, never during a scan, and the switch turns them
// all off. No browser: a stand-in storage, and the components read as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOUR_KEY, HINTS_KEY, TOUR_REPLAY_HREF, TOUR_FILM, hasFilm, TOUR_STEPS, tourSteps, tourMove, tourCount, readTour, rememberTour,
  tourOpens, withKeys, placeCard, spotlight, NARROW, HINTS, placeOf, readHints, dismissHint, setHintsOff, resetHints, hintFor,
  HOW_TOS, PACING_NOTES, SHORTCUTS,
} from '../lib/help.js';
import { HOVER_HOLD } from '../lib/circle-focus.js';
import { BREACH_WEEKLY } from '../lib/breach.js';
import { WINDOW_DEFAULTS } from '../lib/scan-windows.js';
import { BREAK_DEFAULTS } from '../lib/manual-breaks.js';
import { MODE_KEYS } from '../lib/app-tabs.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A window's localStorage, as a Map. */
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
}
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// ── The tour: shown once, replayed, skipped ──────────────────────────────────

test('the tour is offered once: a new window opens it, and once seen never again by itself', () => {
  const s = storage();
  assert.deepEqual(readTour(s), { seen: false, ended: null });
  assert.equal(tourOpens({ memory: readTour(s) }), 'first');
  // Opening it is what counts as seen (Tour.js), so a reload halfway doesn't offer it twice.
  rememberTour({ seen: true }, s);
  assert.equal(tourOpens({ memory: readTour(s) }), null);
  rememberTour({ ended: 'done' }, s);
  assert.deepEqual(readTour(s), { seen: true, ended: 'done' });
  assert.equal(tourOpens({ memory: readTour(s) }), null);
  assert.ok(s.data.has(TOUR_KEY));
});

test('the first time, never while a scan runs or before the scanner has answered: that visit passes', () => {
  const memory = readTour(storage());
  assert.equal(tourOpens({ memory, scanKnown: false }), null);
  assert.equal(tourOpens({ memory, scanKnown: true, scanning: true }), null);
  assert.equal(tourOpens({ memory, scanKnown: true, scanning: false }), 'first');
  // Never in the public demo, which has no Settings to replay it from.
  assert.equal(tourOpens({ memory, demo: true }), null);
  assert.equal(tourOpens({ memory, demo: true, replay: true }), null);
});

test('Replay the tour opens it whatever is remembered: Settings → Help links to the map with ?tour=replay', () => {
  const s = storage();
  rememberTour({ seen: true, ended: 'skipped' }, s);
  assert.equal(tourOpens({ memory: readTour(s), replay: true }), 'replay');
  assert.equal(tourOpens({ memory: readTour(s), replay: true, scanning: true, scanKnown: false }), 'replay');
  assert.equal(TOUR_REPLAY_HREF, '/?tour=replay');
  // The map reads the address and passes it on; the Tour drops ?tour= once it's open.
  const page = read('app/page.js');
  assert.match(page, /const replayTour = params\.get\(TOUR_PARAM\) === TOUR_REPLAY;/);
  assert.match(page, /\{!IS_DEMO && <Tour own=\{!csvMode\} scanner=\{Boolean\(scanner\)\} replay=\{replayTour\} \/>\}/);
  assert.match(read('app/components/help/Tour.js'), /url\.searchParams\.delete\(TOUR_PARAM\)/);
  // Only on the map, which shows only once the setup is done (app/page.js returns the setup before it).
  assert.ok(page.indexOf('<Tour ') > page.indexOf('return <Onboarding'));
  assert.match(read('app/components/settings/HelpSection.js'), /router\.push\(TOUR_REPLAY_HREF\)\}>Replay the tour</);
});

test('Back, Next, Skip and Esc: Skip and Esc end it skipped, Next on the last step is done, Back stops at the start', () => {
  assert.deepEqual(tourMove(0, 'next', 5), { at: 1, end: null });
  assert.deepEqual(tourMove(3, 'next', 5), { at: 4, end: null });
  assert.deepEqual(tourMove(4, 'next', 5), { at: 4, end: 'done' });
  assert.deepEqual(tourMove(2, 'back', 5), { at: 1, end: null });
  assert.deepEqual(tourMove(0, 'back', 5), { at: 0, end: null });
  assert.deepEqual(tourMove(2, 'skip', 5), { at: 2, end: 'skipped' });
  assert.deepEqual(tourMove(2, 'esc', 5), { at: 2, end: 'skipped' });
  assert.deepEqual(tourMove(9, 'next', 5), { at: 4, end: 'done' }, 'a step past the end counts as the last');
  assert.deepEqual(tourMove(1, 'jump', 5), { at: 1, end: null });
  assert.equal(tourCount(1, 9), '2 of 9');
  // A skipped tour is remembered as skipped, and stays seen.
  const s = storage();
  rememberTour({ seen: true, ended: 'skipped' }, s);
  assert.deepEqual(readTour(s), { seen: true, ended: 'skipped' });
  // The card: Back, Next (Start the tour, Done), Skip tour, and Esc from anywhere, which goes no further.
  const tour = read('app/components/help/Tour.js');
  for (const words of ['>Back<', "'Start the tour'", "'Done'", "'Next'", '>Skip tour<']) assert.ok(tour.includes(words), words);
  assert.match(tour, /e\.key === 'Escape'[\s\S]{0,80}e\.stopPropagation\(\);\s*move\('esc'\)/);
  assert.match(tour, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(tour, /role="dialog" aria-modal="true"/);
  assert.match(tour, /usePanelCover\(open\)/);
});

test('what this window remembers: nonsense and blocked storage read as never seen, and nothing throws', () => {
  assert.deepEqual(readTour(storage({ [TOUR_KEY]: 'not json' })), { seen: false, ended: null });
  assert.deepEqual(readTour(storage({ [TOUR_KEY]: '{"seen":"yes","ended":"maybe"}' })), { seen: false, ended: null });
  assert.deepEqual(readTour(broken), { seen: false, ended: null });
  assert.doesNotThrow(() => rememberTour({ seen: true }, broken));
  assert.deepEqual(readHints(broken), { off: false, dismissed: [] });
  assert.doesNotThrow(() => dismissHint('doors', broken));
  assert.deepEqual(readHints(storage({ [HINTS_KEY]: '{"off":1,"dismissed":["doors","nope","doors"]}' })), { off: false, dismissed: ['doors'] });
});

test('the steps: the film first and Settings last, and a page\'s step only where its tab is', () => {
  assert.equal(TOUR_STEPS[0].key, 'film');
  assert.equal(TOUR_STEPS.at(-1).key, 'help');
  const keys = (o) => tourSteps(o).map((s) => s.key);
  // Everything Blake listed, with your own network, a scanner and the LinkedIn browser plugin.
  assert.deepEqual(keys({ own: true, scanner: true, linkedin: true }),
    ['film', 'network', 'focus', 'degrees', 'separation', 'map', 'breach', 'scan', 'linkedin', 'help']);
  // The sample or a CSV: no Breach, Scan or LinkedIn, as their tabs aren't there (AppTabs `own`).
  assert.deepEqual(keys({ own: false, scanner: true, linkedin: true }), ['film', 'network', 'focus', 'degrees', 'separation', 'map', 'help']);
  // Your own network with no scanner: no Scan step; no LinkedIn step without the plugin.
  assert.deepEqual(keys({ own: true }), ['film', 'network', 'focus', 'degrees', 'separation', 'map', 'breach', 'help']);
  // Every target is a [data-tour] the app draws: the four map tabs and the pages (AppTabs), the map (app/page.js), the ⚙ (AppHeader).
  const tabs = read('app/components/AppTabs.js');
  assert.equal((tabs.match(/data-tour=\{m\.key\}/g) || []).length, 2, 'the map tabs, as buttons and as links');
  assert.match(tabs, /data-tour=\{p\.key\}/);
  assert.match(read('app/page.js'), /<div data-tour="canvas"/);
  assert.match(read('app/components/AppHeader.js'), /data-tour="settings"/);
  const pages = [...tabs.matchAll(/\{ key: '([a-z]+)', href:/g)].map((m) => m[1]);
  for (const s of TOUR_STEPS.filter((x) => x.target)) {
    assert.ok([...MODE_KEYS, ...pages, 'canvas', 'settings'].includes(s.target), `${s.key} points at ${s.target}`);
  }
});

test('the film: a marked slot until a later release fills it, and only ever the app\'s own file', () => {
  assert.equal(TOUR_FILM.src, null, 'no film ships yet: the slot is a placeholder');
  assert.equal(hasFilm(), false);
  assert.equal(hasFilm({ src: '/tour/sixgree-tour.mp4' }), true);
  for (const src of ['https://sixgree.com/video/features.mp4', '//cdn.example/x.mp4', 'video.mp4', '', null]) assert.equal(hasFilm({ src }), false, String(src));
  const tour = read('app/components/help/Tour.js');
  assert.match(tour, /data-film-slot="empty"/);
  assert.match(tour, /Film coming in a later release/);
  assert.doesNotMatch(tour, /https?:\/\//, 'nothing fetched from outside');
});

test('the card sits beside its target and never off screen; a sheet along the bottom on a narrow window', () => {
  const view = { width: 1280, height: 800 };
  const card = { width: 400, height: 220 };
  const inside = (p) => p.left >= 16 && p.top >= 16 && p.left + card.width <= view.width - 16 + 0.5 && p.top + card.height <= view.height - 16 + 0.5;
  const tab = { top: 60, left: 600, width: 90, height: 34 };
  const below = placeCard(tab, card, view);
  assert.equal(below.side, 'below');
  assert.equal(below.top, 60 + 34 + 14);
  assert.ok(inside(below));
  assert.equal(placeCard({ top: 700, left: 600, width: 90, height: 40 }, card, view).side, 'above');
  // The map, as tall as the window: over its foot.
  const over = placeCard({ top: 130, left: 0, width: 1280, height: 670 }, card, view);
  assert.equal(over.side, 'over');
  assert.ok(inside(over));
  // A tab at the edge: the card is pulled back in.
  assert.ok(inside(placeCard({ top: 60, left: 1250, width: 30, height: 30 }, card, view)));
  assert.equal(placeCard(null, card, view).side, 'center');
  const sheet = placeCard(tab, { width: 343, height: 260 }, { width: NARROW - 1, height: 700 });
  assert.deepEqual(sheet, { side: 'sheet', left: 16, top: 700 - 260 - 16 });
  // The ring: a little outside a tab, a little inside the map so it stays on screen.
  assert.deepEqual(spotlight(tab, view), { top: 54, left: 594, width: 102, height: 46 });
  assert.equal(spotlight({ top: 130, left: 0, width: 1280, height: 670 }, view).left, 10);
  assert.equal(spotlight(null, view), null);
});

test('⌘ on a Mac, Ctrl+ elsewhere', () => {
  assert.equal(withKeys('{mod}[ and {mod}]', true), '⌘[ and ⌘]');
  assert.equal(withKeys('{mod}[ and {mod}]', false), 'Ctrl+[ and Ctrl+]');
  assert.equal(withKeys('Esc', true), 'Esc');
});

// ── Hints: one at a time, dismissed for good, a switch for all ───────────────

const SEEN = { tourSeen: true };

test('one hint a place, each place a page or a map tab the header knows', () => {
  const places = HINTS.map((h) => h.place);
  assert.equal(new Set(places).size, places.length, 'never two hints in one place');
  assert.equal(new Set(HINTS.map((h) => h.key)).size, HINTS.length);
  assert.deepEqual(places, ['network', 'degrees', 'separation', 'map', 'paths', 'breach', 'scan', 'linkedin']);
  for (const p of places) assert.equal(placeOf(p), p);
  for (const p of ['settings', 'profile', 'import', undefined, null, '']) assert.equal(placeOf(p), null);
  // Blake's two examples.
  assert.match(hintFor('network', SEEN).text, /Hold the pointer on one of your connections for 3\.5 s/);
  assert.match(hintFor('breach', SEEN).text, /start with Doors/);
  // The header draws the hint for its page, so every page with the tabs has one, and only one.
  assert.match(read('app/components/AppHeader.js'), /<Hint place=\{active\} \/>/);
});

test('a dismissed hint is remembered in this window and never shows again; the others still do', () => {
  const s = storage();
  assert.equal(hintFor('breach', { ...SEEN, hints: readHints(s) }).key, 'doors');
  dismissHint('doors', s);
  dismissHint('doors', s);
  assert.deepEqual(readHints(s), { off: false, dismissed: ['doors'] });
  assert.equal(hintFor('breach', { ...SEEN, hints: readHints(s) }), null);
  assert.equal(hintFor('network', { ...SEEN, hints: readHints(s) }).key, 'focus');
  // An unknown key is never kept.
  dismissHint('made-up', s);
  assert.deepEqual(readHints(s).dismissed, ['doors']);
  assert.ok(s.data.has(HINTS_KEY));
  // Show them again (Settings → Help): back, the switch as it was.
  resetHints(s);
  assert.equal(hintFor('breach', { ...SEEN, hints: readHints(s) }).key, 'doors');
});

test('the switch turns every hint off, and on again the dismissed stay dismissed', () => {
  const s = storage();
  dismissHint('focus', s);
  setHintsOff(true, s);
  for (const h of HINTS) assert.equal(hintFor(h.place, { ...SEEN, hints: readHints(s) }), null, h.place);
  setHintsOff(false, s);
  assert.equal(hintFor('network', { ...SEEN, hints: readHints(s) }), null);
  assert.equal(hintFor('scan', { ...SEEN, hints: readHints(s) }).key, 'slow');
  // Settings → Help: Show hints is the switch; Got it and Turn hints off are on the hint.
  const section = read('app/components/settings/HelpSection.js');
  assert.match(section, /checked=\{!hints\.off\} onChange=\{\(e\) => setHintsOff\(!e\.target\.checked\)\}/);
  assert.match(section, />Show hints</);
  const hint = read('app/components/help/Hint.js');
  assert.match(hint, /dismissHint\(hint\.key\)/);
  assert.match(hint, /setHintsOff\(true\)/);
});

test('never during a scan, never over the tour, never under Sixgree\'s own browser, and not before the tour', () => {
  const hints = readHints(storage());
  assert.ok(hintFor('scan', { ...SEEN, hints }));
  assert.equal(hintFor('scan', { ...SEEN, hints, scanning: true }), null);
  assert.equal(hintFor('network', { ...SEEN, hints, touring: true }), null);
  assert.equal(hintFor('linkedin', { ...SEEN, hints, panel: true }), null);
  assert.equal(hintFor('network', { hints, tourSeen: false }), null);
  assert.equal(hintFor('settings', { ...SEEN, hints }), null);
  // The hint asks the scanner, the tour and the panel, and draws nothing in the public demo.
  const hint = read('app/components/help/Hint.js');
  assert.match(hint, /scanning: scan\.running \|\| scan\.pending/);
  assert.match(hint, /panel: Boolean\(panel\?\.visible\)/);
  assert.match(hint, /const place = IS_DEMO \? null : placeOf\(active\)/);
  assert.match(read('app/components/help/Tour.js'), /setTouring\(true\);\s*return \(\) => setTouring\(false\);/);
});

// ── Settings → Help ──────────────────────────────────────────────────────────

test('Settings → Help: its own notch tab, before About, with how-tos that each link to their place', () => {
  const page = read('app/settings/page.js');
  assert.match(page, /\['experimental', 'Experimental'\], \['help', 'Help'\], \['about', 'About'\],/);
  assert.match(page, /<HelpSection about=\{about\} \/>/);
  assert.match(read('app/components/settings/HelpSection.js'), /<Section id="help" title="Help"/);
  for (const h of HOW_TOS) {
    assert.match(h.href, /^\/(\?mode=(network|degrees|separation|map)|breach|setup|linkedin)$/, h.key);
    // 2 to 4 lines in a how-to's card, about 45 characters a line at its narrowest.
    assert.ok(h.text.length >= 90 && h.text.length <= 160, `${h.key}: ${h.text.length} characters`);
  }
  assert.deepEqual(HOW_TOS.map((h) => h.key), ['tiers', 'focus', 'chains', 'separation', 'map', 'breach', 'scan', 'linkedin']);
  // Shortcuts: the LinkedIn panel's back and forward, and Esc.
  assert.equal(SHORTCUTS[0].keys, '{mod}[ and {mod}]');
  assert.ok(SHORTCUTS.some((s) => s.keys === 'Esc'));
});

test('the pace and limits, said plainly: LinkedIn can restrict an account, slow is safer, no guarantee', () => {
  const all = PACING_NOTES.join(' ');
  assert.match(all, /LinkedIn can restrict accounts/);
  assert.match(all, /slow is safer, never a guarantee/);
  assert.match(read('app/components/settings/HelpSection.js'), /href="\/setup#usage"/);
});

test('the numbers the words quote agree with the app', () => {
  const words = [...TOUR_STEPS.map((s) => s.body), ...HINTS.map((h) => h.text), ...HOW_TOS.map((h) => h.text), ...PACING_NOTES].join(' ');
  const hold = `${HOVER_HOLD / 1000} s`;
  assert.equal(hold, '3.5 s');
  for (const t of [TOUR_STEPS.find((s) => s.key === 'focus').body, HINTS.find((h) => h.key === 'focus').text, HOW_TOS.find((h) => h.key === 'focus').text]) {
    assert.ok(t.includes(hold), t);
  }
  assert.ok(words.includes(`${BREACH_WEEKLY} requests a week`));
  // The scan windows (lib/scan-windows.js, 2026-10-17), in place of the daily limit's number.
  assert.ok(PACING_NOTES.join(' ').includes(`at most ${WINDOW_DEFAULTS.windowPages} a window, two windows a day, a new one ${WINDOW_DEFAULTS.windowGapHours} hours after`));
  assert.doesNotMatch(PACING_NOTES.join(' '), /daily limit/);
  assert.ok(PACING_NOTES.join(' ').includes(`every ${BREAK_DEFAULTS.breakEvery} pages`));
  // Blake's words: scanning, never the other one.
  assert.doesNotMatch(words, /scrap/i);
});
