// Circle scans in rounds (Blake, 2026-10-16: "scanning 25 pages per round so
// there's like 4 unfilled bars around the dot showing how scanned it is, unless
// they pick 50 per scan which is max").
//
// LinkedIn shows at most 100 pages (about 1,000 people) of anyone's
// connections. A scan of one person's circle reads one round of their list:
// 25 pages, or 50 (the most) when Scanner settings say so ("roundPages" in
// scan-limits.json, lib/linkedin-limits.js), by itself or by hand, from where
// the last round stopped (the scanner's note, bridge-progress.json: "pages" and
// "readPages"). Four rounds of 25, or two of 50, read the most LinkedIn shows.
// Breach's company rounds (3, 5 or 10 pages, lib/breach.js) are their own.
//
// Round a bridge's dot in Network Circle (app/components/ForceGraph.js), one arc
// for each round (lib/dot-rings.js roundSegments), filled as their list is read:
// pages read out of their page total, min(100, ceil(connections / 10)) when
// how many they have is known, else 100.
//
// No Node imports: the map, the person card and the Scan page read it.

import { experienceCard } from './experience.js';
import { pagesKnownRead } from './in-progress.js';
import { circleState, cleanProfileUrl } from './reach.js';
import { keyFor } from './separation.js';

/** The pages a round can be: 25, or 50, the most. scrape.py CIRCLE_ROUND_MAX is the most it takes. */
export const ROUND_CHOICES = Object.freeze([25, 50]);
export const DEFAULT_ROUND = 25;
/** LinkedIn's people search goes no further than page 100 (scrape.py LINKEDIN_MAX_PAGES). */
export const MAX_PAGES = 100;
// Read before 0.1.6 kept a note: to page 10, more to come (lib/paused.js LEGACY_PAGES_READ).
const LEGACY_PAGES = 10;

/** A round the app keeps: 25 or 50 pages. */
export const validRound = (n) => ROUND_CHOICES.includes(n);
/** The pages a round is: the one saved, or 25. */
export const roundOf = (n) => (validRound(n) ? n : DEFAULT_ROUND);
/** How many arcs round a dot: 4 for rounds of 25, 2 for rounds of 50. */
export const segmentsFor = (round) => Math.round(MAX_PAGES / roundOf(round));

/** How many pages someone's list runs to: min(100, ceil(count / 10)) when the count is known, else 100. */
export function pageTotal(count) {
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_PAGES, Math.ceil(n / 10)) : MAX_PAGES;
}

/**
 * How many connections someone has, as exactly as is known, or null: the
 * search's own count ("About N results", the note's total), else their
 * connection count when it's exact (not "500+"), from the note or else their
 * top card (lib/experience.js). The same order as the ring in Bridge Chains
 * (lib/reach.js scanFill).
 */
export function knownCount(note, card) {
  if (Number(note?.total) > 0) return Number(note.total);
  const kept = Number(note?.connections) > 0;
  const connections = kept ? Number(note.connections) : Number(card?.connections);
  const plus = kept ? note.connectionsPlus : card?.connectionsPlus;
  return connections > 0 && !plus ? connections : null;
}

/**
 * Where someone's circle stands in rounds, from the scanner's note of their list.
 *
 * @param note   bridge-progress.json's note ({ pages, more, readPages, hidden }), or null
 * @param round  the pages a round is (25 or 50)
 * @param count  how many connections they have, when known (knownCount)
 * @param legacy their circle was scanned before notes were kept: pages 1 to 10, more to come
 * @returns {{ round, segments, pages, total, filled, done, next, of }}
 *   pages   pages read (every page known read, past a gap too)
 *   total   the pages their list runs to (pageTotal)
 *   filled  0..1 of the ring: pages read of `total`, 1 once the list is done
 *   done    no more of it can be read: it ended, or page 100
 *   next    the round the next scan reads (1 for a circle not scanned yet), null when done
 *   of      how many rounds their list takes
 */
export function roundState(note, { round = DEFAULT_ROUND, count = null, legacy = false } = {}) {
  const size = roundOf(round);
  const entry = note || (legacy ? { pages: LEGACY_PAGES, more: true } : null);
  const pages = entry ? pagesKnownRead(entry).length : 0;
  const total = pageTotal(count);
  const done = Boolean(entry) && (!entry.more || pages >= MAX_PAGES);
  // A list that went hidden after it was read: what was read stays, and nothing more can be.
  const closed = Boolean(entry?.hidden) && !done;
  const roundsDone = Math.floor(pages / size);
  const of = done ? Math.max(1, Math.ceil(pages / size)) : Math.max(Math.ceil(total / size), roundsDone + 1);
  return {
    round: size, segments: segmentsFor(size), pages, total,
    filled: done ? 1 : Math.min(1, pages / total),
    done, next: done || closed ? null : Math.min(of, roundsDone + 1), of,
  };
}

/**
 * A person's rounds, for the ring round their dot and their card: null for no
 * ring. Only your connections, and only one who has a circle (scanned, or
 * part read) or could have one scanned (a profile link a scan can go by, and a
 * scanner: `canScan`). Never one whose list is hidden.
 *
 * @param reach  lib/reach.js reachIndex (with `lists`, the scanner's notes)
 */
export function personRounds(person, reach, { round = DEFAULT_ROUND, canScan = true } = {}) {
  if (!person || (person.degree || 1) !== 1 || !reach) return null;
  const state = circleState(person, reach);
  if (state === 'hidden') return null;
  const note = person.profile_url ? reach.lists?.get(keyFor(person)) || null : null;
  const scanned = state === 'scanned' || Boolean(note);
  if (!scanned && !(canScan && cleanProfileUrl(person.profile_url))) return null;
  return roundState(note, { round, count: knownCount(note, experienceCard(person)), legacy: !note && scanned });
}

/** "Round 2 of 4", "Round 1 of 4", or for a list read through "All 4 rounds done" ("1 round" for a short one). */
export function roundWords(state) {
  if (!state) return '';
  if (state.done) return state.of === 1 ? 'Their whole list is read' : `All ${state.of} rounds done`;
  if (state.next == null) return `${state.pages} ${state.pages === 1 ? 'page' : 'pages'} read; their list is hidden now`;
  return `Round ${state.next} of ${state.of}`;
}

/** What a round reads, in words: "25 pages a round, about 250 people". */
export const roundSizeWords = (round) => `${roundOf(round)} pages a round, about ${roundOf(round) * 10} people`;

/**
 * The pages one round reads and where it starts, as the command line takes it
 * (app/api/scraper/route.js), for a scan of one person's circle by id.
 *
 *   action     'bridge' (a Scan button) or 'resume' (Scan next round, Resume)
 *   note       their note, or null
 *   nextPage   where their list carries on (lib/paused.js nextPageToRead), null when done
 *   round      the pages a round is
 *   maxPages   fewer pages asked for (the guided setup's first scan reads 3), else null
 *   fromStart  Rescan from the start: page 1, whatever was read
 *   roundFlag  the scanner takes --round for a circle (plugins 1.0.10 on, built in)
 *
 * A Scan button on someone part read carries on with their next round; on
 * someone never scanned, read to the end, or hidden, it starts at page 1, as
 * Rescan does. --max-pages is the round's last page, which every scanner
 * understands; --round lets a newer one work the start out itself, the same way.
 * @returns {{ fromStart: boolean, start: number, last: number, pages: number, args: string[] }}
 */
export function circleRoundArgs({ action, note = null, nextPage = null, round = DEFAULT_ROUND, maxPages = null, fromStart = false, roundFlag = true } = {}) {
  const size = roundOf(round);
  const pages = Number.isInteger(maxPages) && maxPages > 0 && maxPages < size ? maxPages : size;
  const carryOn = action === 'resume' || (!fromStart && Boolean(note) && nextPage != null);
  const start = carryOn ? Math.min(MAX_PAGES, Math.max(1, nextPage ?? 1)) : 1;
  const last = Math.min(MAX_PAGES, start + pages - 1);
  return {
    fromStart: !carryOn, start, last, pages,
    args: [...(carryOn ? [] : ['--from-start']), `--max-pages=${last}`, ...(roundFlag ? [`--round=${pages}`] : [])],
  };
}
