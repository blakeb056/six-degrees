// Who you reached through a circle, and whether their own circle is next.
//
// Blake, 2026-09-25: "i would like to sigingy if a orb in the 2nd degree is
// added already so it shows they are ready for a 2nd degree scan to get the 3rd
// degree so it needs to be intuitive with the orb glowing".
//
// "Ready" is one rule, kept here once. It used to live in three slightly
// different copies (Outlink's new doors, the profile page's mapping bar and the
// Degrees panel's Auto-Bridge Next), and only one of them knew about hidden
// lists. Someone is ready for a circle scan when all of these are true:
//   - they're your connection now (degree 1);
//   - they came to you through a circle: unlocked_from_bridge_id, which
//     lib/promote.js keeps when it clears source_connection_id, and which a
//     request sent from the app sets to the circle you asked through;
//   - their own circle hasn't been scanned: nobody in it is saved, and the
//     scanner has no note of reading it (bridge-progress.json);
//   - their list isn't known to be hidden (bridge-skips.json).
// A glow that fired on hidden lists would teach you to ignore it, so a hidden
// list is its own state, never "ready".
//
// Plain functions, no React; tests/reach.test.mjs.

import { paceSeconds } from './scan-pace.js';
import { keyFor, compareBridges } from './separation.js';

/**
 * What the rules read, built once per load.
 *
 * @param connections 1st-degree rows
 * @param degree2     2nd-degree rows: whose circle each sits in
 * @param notes       what the scanner noted, from /api/scraper?reach=1:
 *                    { skips: [{ profileUrl }] (hidden lists), read: [profileUrl] (lists it has read) }
 * @returns {{ scanned: Set, read: Set, hidden: Set, reachedFrom: Map }}
 *   `reachedFrom` is circle id → the connections you reached through it.
 */
export function reachIndex(connections = [], degree2 = [], notes = {}) {
  const scanned = new Set();
  for (const row of degree2 || []) {
    if (row?.source_connection_id != null) scanned.add(row.source_connection_id);
  }
  const hidden = new Set();
  for (const s of notes?.skips || []) {
    if (s?.profileUrl) hidden.add(keyFor({ profile_url: s.profileUrl }));
  }
  const read = new Set();
  for (const url of notes?.read || []) {
    if (url) read.add(keyFor({ profile_url: url }));
  }
  const lists = new Map();
  for (const [url, list] of Object.entries(notes?.lists || {})) {
    if (url && list) lists.set(keyFor({ profile_url: url }), list);
  }
  const reachedFrom = new Map();
  for (const row of connections || []) {
    const from = row?.unlocked_from_bridge_id;
    if (from == null || row.degree !== 1) continue;
    let list = reachedFrom.get(from);
    if (!list) reachedFrom.set(from, (list = []));
    list.push(row);
  }
  return { scanned, read, hidden, reachedFrom, lists };
}

/**
 * Their own circle: 'scanned' (someone in it is saved, or the scanner read
 * their list and everyone on it was already yours), 'hidden' (they keep their
 * connections private) or 'todo'.
 */
export function circleState(person, reach) {
  if (!person) return 'todo';
  if (reach.scanned.has(person.id)) return 'scanned';
  if (person.profile_url && reach.read?.has(keyFor(person))) return 'scanned';
  if (person.profile_url && reach.hidden.has(keyFor(person))) return 'hidden';
  return 'todo';
}

/**
 * For someone you reached through a circle: 'ready' (their circle can be
 * scanned next), 'hidden' or 'scanned'. Null for anyone else: people who were
 * always your connections, and 2nd-degree rows (a request sent from the app
 * marks those with the circle it asked through, but they aren't yours yet).
 */
export function reachState(person, reach) {
  if (!person || person.degree !== 1 || person.unlocked_from_bridge_id == null) return null;
  const state = circleState(person, reach);
  return state === 'todo' ? 'ready' : state;
}

/** Everyone ready for a circle scan, strongest first. */
export function readyToScan(connections, reach) {
  return (connections || []).filter((c) => reachState(c, reach) === 'ready').sort(compareBridges);
}

/**
 * Your connections whose own circle isn't scanned yet, for Degrees' Unscanned
 * view (Blake, 2026-10-04: "basically the same thing we have for bridges but
 * just make it for unscanned clusters"), where a press builds their circle.
 *
 * `todo` is everyone whose circle is still to do (circleState 'todo'), S first
 * and strongest first, the order the view rings them in. A dot there means
 * "this circle can be built", so nobody the scanner has already read is in it:
 * `hidden` counts the lists it found hidden and `read` the ones it read with
 * nobody new (or stopped partway before saving anyone), which the view says it
 * left out. People with a scanned circle are neither: they're the bridges.
 */
export function notScannedYet(connections = [], reach) {
  const todo = [];
  let hidden = 0;
  let read = 0;
  for (const row of connections || []) {
    if (!row || row.degree !== 1) continue;
    const state = circleState(row, reach);
    if (state === 'todo') todo.push(row);
    else if (state === 'hidden') hidden += 1;
    else if (!reach.scanned.has(row.id)) read += 1;
  }
  todo.sort(compareBridges);
  return { todo, hidden, read };
}

/**
 * Which view Degrees opens on (Blake, 2026-10-04: "if the person has no scanned
 * bridges yet then they are opened to the unscanned bridges in degrees and once
 * they do have one or more then its back to normal"). Bridge Chains, unless
 * you have no scanned circle yet and can scan: then Unscanned, where the first
 * one is built. Only where Degrees opens, never a switch while you're in it: a
 * first circle finishing on Unscanned stays there, with its link to Bridge
 * Chains. `view` is what it would open on otherwise; one asked for (a link to
 * someone's circle, say) is kept.
 */
export function degreesOpensOn({ view = 'chain', bridgeIds, canScan = true } = {}) {
  const none = !bridgeIds || bridgeIds.size === 0;
  return view === 'chain' && canScan && none ? 'unscanned' : view;
}

/** How many people you reached through each circle are ready, by circle id. */
export function readyByCircle(reach) {
  const out = new Map();
  for (const [from, people] of reach.reachedFrom) {
    const n = people.filter((p) => reachState(p, reach) === 'ready').length;
    if (n) out.set(from, n);
  }
  return out;
}

/**
 * What scanning one circle asks of LinkedIn: one profile view to find their
 * list, then a search for every page of it, `pages` at most (LinkedIn shows
 * 100). About 0.55 minutes a page with the scanner's rests (20 s before each
 * page, a minute more after every 10), so about 55 minutes for a whole list.
 * The Scan page and the Degrees panel both say it from here.
 */
export function circleScanCost(pages = 100, pace = 'fast') {
  const searches = Math.max(1, Math.min(100, Math.round(pages) || 100));
  // At Fast, as it has always been said; slower speeds add their waits (lib/scan-pace.js).
  const minutes = !pace || pace === 'fast'
    ? (searches >= 100 ? 55 : Math.max(5, Math.round(searches * 0.55)))
    : Math.max(5, Math.round(paceSeconds(pace, searches) / 60));
  return { profileViews: 1, searches, minutes };
}

/**
 * How much of someone's circle is scanned, as 0–5 bars for the ring round
 * their dot; null for no ring (not scanned, or their list is hidden).
 * A list read to the end is 5. Part-read, it's the pages read against
 * LinkedIn's own count of the list (about 10 a page), 1 to 4; with no count
 * (read before the scanner kept one), 2.
 */
export function scanBars(person, reach) {
  const state = circleState(person, reach);
  const list = person?.profile_url ? reach.lists?.get(keyFor(person)) : null;
  if (state === 'hidden') return null;
  if (!list) return state === 'scanned' ? 2 : null;
  if (!list.more) return 5;
  if (!list.total) return 2;
  return Math.max(1, Math.min(4, Math.round((5 * Math.min(1, (list.pages * 10) / list.total)))));
}
