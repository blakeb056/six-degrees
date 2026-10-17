// The scan light: what a running scan needs from you, as a colour, read from
// the lines the scanner prints (scripts/scrape.py).
//
// Blake, 2026-10-14: "an icon at the top right that will be a indicator
// minimized and also can be opened to show whats currently happening … if they
// have sound turned off and need to know when the system is ready to go to the
// next page so it could be green yellow and red … green mean next yellow means
// scanning and red means go back or dont click next yet if its taking some time
// to load … and then for auto it can be more for a updating briefing".
//
// So, for a scan you page through by hand (scrape.py _read_by_hand and
// _read_experience_by_hand):
//   green   the page is read: click Next
//   yellow  it's reading, or waiting for you to scroll to the bottom
//   red     don't click yet (the page is still loading), go back (Previous, or
//           the window has left their list), or it has stopped
// and a break by hand (2026-10-15, lib/manual-breaks.js) is yellow, counting
// down: "Break: 14 s, then page 21".
// and for a scan that runs by itself: green while it reads, yellow while it
// rests before the next page, red once it has stopped.
//
// It only reads. Every state here is one the scanner already says in words;
// a line it doesn't know leaves the light as the last one it did, and a
// scanner whose wording changes shows plain "Scanning", never a wrong colour.
// Keep the patterns in step with scrape.py, as lib/scan-progress.js does.
//
// Plain functions, no React; tests/scan-light.test.mjs.

import { scanFill, scanFillWords, reachIndex } from './reach.js';
import { pageSeconds, durationText, paceOf, WORK_SECONDS } from './scan-pace.js';
import { mappingNow } from './scan-progress.js';

/** How long the light stays after a scan ends, so its last word can be read. */
export const LIGHT_LINGER_MS = 15000;

/** LinkedIn shows 100 pages of anyone's list at most (scrape.py LINKEDIN_MAX_PAGES). */
const MOST_PAGES = 100;

/**
 * Each colour in words, and the shape drawn with it, so the light never says
 * anything by colour alone (a screen reader hears the words, and the shape
 * tells green from red without the colour).
 */
export const LIGHT_WORDS = Object.freeze({
  green: Object.freeze({ word: 'Green', meaning: 'go ahead', shape: 'arrow' }),
  yellow: Object.freeze({ word: 'Yellow', meaning: 'scanning', shape: 'dots' }),
  red: Object.freeze({ word: 'Red', meaning: 'hold on', shape: 'square' }),
});

/** Nothing to show: no scan running. */
export const NO_LIGHT = Object.freeze({ color: null, mode: null, headline: null, detail: null, stats: null, ended: false });

// Jobs that aren't scans: setting the scanner up touches nothing on LinkedIn.
const NOT_SCANS = new Set(['install', 'setup']);
// Jobs that read circles, which can be read by hand.
// Your own connections through LinkedIn's search (scrape.py scan_your_connections) is read the same way,
// and so is a company's people for Breach (scan_company_search), and one person's full mutual list (scan_mutual_list).
const CIRCLE_READS = new Set(['bridge', 'rescrape', 'resume', 'resume-all', 'auto-bridge', 'auto-bridge-retry', 'your-connections', 'breach', 'mutuals']);

// ── The scanner's lines ──────────────────────────────────────────────────────
// Each is matched against a line with its leading spaces taken off.

const NEEDS = /^LinkedIn needs you: (.+)$/;
const WAITING = /^\(waiting: (.+?)\)?$/;
// A change said the moment it happens (scrape.py _read_by_hand note, and
// _read_experience_by_hand): "(on page 3: scroll to its bottom and it's read)".
const NOTE = /^\((.+)\)$/;
// "Page 3... 10 found (total: 30)" in one line (manual mode prints it whole),
// or "Page 3..." then "10 found (total: 30)" (an automatic read prints the
// first half before it reads, flushed, so the app gets two lines).
const PAGE = /^Page (\d+)\.\.\.(?:\s*(\d+) found \(total: (\d+)\))?/;
const FOUND = /^(\d+) found \(total: (\d+)\)$/;
const HIDDEN_PAGE = /^Page (\d+): LinkedIn hides the \d+ people on it/;
const MANUAL_START = /^Manual mode: you page through (?:(your)|(.+)'s) list/;
const MANUAL_DONE = /^Manual read done: (\d+) pages? of (?:(your)|(.+)'s) list\./;
const OPENING_LIST = /^Opening (their|your) connections(?: at page (\d+))?\.\.\./;
const OPENING_PROFILE = /^Opening (.+)'s profile\.\.\./;
const ABOUT = /^About ([\d,]+) results in (?:their|your) list: (\d+) pages/;
const READING_FROM = /^Reading from page (\d+)/;
const BATCH = /^\[(\d+)\/(\d+)\] (.+?) \(/;

// Where it stops: LinkedIn pushing back, a limit, the Dev ceiling, your Stop.
const STOPS = [
  [/^LinkedIn is pushing back \((.+)\)\. Stopping here\./, (m) => ({ headline: 'Stopped: LinkedIn pushed back', why: m[1] })],
  [/^Dev mode's ceiling: (\d+) search pages a day, reached\./, (m) => ({ headline: `Stopped at Dev mode's ceiling of ${m[1]}` })],
  // Lifted for the session, the same ceiling holds (2026-10-16).
  [/^The ceiling the lifted limits keep: (\d+) search pages a day, reached\./, (m) => ({ headline: `Stopped at the ceiling of ${m[1]}` })],
  [/^Today's limit of (\d+) profile views is used/, () => ({ headline: 'Stopped: today’s profile views are used' })],
  [/^Today's limit of (\d+) searches is used/, () => ({ headline: 'Stopped: today’s searches are used' })],
  // On a line of its own by hand; after "Page N..." in an automatic read.
  [/LinkedIn's monthly search limit, and nobody on the page to read\./, () => ({ headline: 'Stopped: LinkedIn’s monthly search limit' })],
  [/^LinkedIn opened page (\d+), not page (\d+)\. Stopping/, () => ({ headline: 'Stopped: LinkedIn opened the wrong page' })],
  [/^Stopped at the (\d+)-page limit/, (m) => ({ headline: `Stopped at the ${m[1]}-page limit` })],
  [/^Stopped (?:at|before) page (\d+); the next run carries on from there\./, () => ({ headline: 'Stopped' })],
  [/^Nothing was read, so the scan stops\./, () => ({ headline: 'Stopped: no page was read' })],
  [/^Scanning paused until/, () => ({ headline: 'Stopped: scanning is paused for now' })],
  [/^(Stopping…|Stopping\.\.\.|Still running\. Forcing it to stop\.)$/, () => ({ headline: 'Stopping' })],
  [/^Stopped\.$/, () => ({ headline: 'Stopped' })],
];

// The lines that end a wait for you (lib/scan-progress.js THROUGH).
const THROUGH = /^(Signed in\b|Browser closed\b|Gave up waiting for sign-in|Manual read done\b)/;

const clean = (line) => String(line ?? '').trim();
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const num = (s) => Number(String(s).replace(/,/g, ''));

// Whose list, from a line: "Ada Stone's" is Ada Stone's, and "your" (a scan of your own
// connections, scrape.py scan_your_connections) is YOURS. `listOf` says it back.
const YOURS = 'your';
const whoIn = (m) => (m[1] ? YOURS : m[2]);
const listOf = (who) => (who === YOURS ? 'your list' : `${who}'s list`);
/** Whose connections the panel names: "Ada Stone's connections", or "Your connections". */
export const whoseConnections = (who) => (who === YOURS ? 'Your connections' : `${who}'s connections`);

// ── Manual mode: what each sentence asks of you ──────────────────────────────

/** A "LinkedIn needs you:" sentence from the manual reader, as { color, headline }. */
function manualNeed(text, ctx) {
  let m;
  // A break before the next page (scrape.py _manual_break): before "page N is read" below.
  if ((m = text.match(/^page (\d+) is read \((\d+) people\)\. Break: wait (\d+) seconds, then go on to page (\d+)/))) {
    return { color: 'yellow', headline: `Break: ${m[3]} s, then page ${m[4]}`, page: num(m[1]), wait: `${m[3]} s` };
  }
  if ((m = text.match(/^LinkedIn's page bar shows page (\d+), and page (\d+) isn't read yet\. Click Previous to page (\d+)/))) {
    return { color: 'red', headline: `Go back to page ${m[3]}`, page: num(m[1]) };
  }
  // Read before, with a page before it that isn't: that page is the one to read (2026-10-14).
  if ((m = text.match(/^page (\d+) is already read, and page (\d+) isn't read yet\. Go back to page (\d+)/))) {
    return { color: 'red', headline: `Go back to page ${m[3]}`, page: num(m[1]) };
  }
  // Read before, and the pages after it too: on to the first that isn't.
  if ((m = text.match(/^page (\d+) is already read, and so is every page to (\d+)\. Go on to page (\d+)/))) {
    return { color: 'green', headline: `Go on to page ${m[3]}`, page: num(m[1]) };
  }
  // The missing page, read: the pages after it were read before.
  if ((m = text.match(/^page (\d+) is read \((\d+) people\), and pages (\d+)–(\d+) were read before\. Go on to page (\d+)/))) {
    return { color: 'green', headline: `Go on to page ${m[5]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) is already read\. Click Next to page (\d+)/))) {
    return { color: 'green', headline: `Click Next to page ${m[2]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) is read \((\d+) people\)\. Page (\d+) isn't read yet/))) {
    return { color: 'green', headline: `Click Next to page ${num(m[1]) + 1}`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) is read \((\d+) people\)\./))) {
    return { color: 'green', headline: `Click Next to page ${num(m[1]) + 1}`, page: num(m[1]) };
  }
  if ((m = text.match(/^scroll to the bottom of each page of (?:your|.+'s) connections/))) {
    const p = ctx.startPage || 1;
    return { color: 'yellow', headline: `Scroll to the bottom of page ${p}`, page: p };
  }
  if ((m = text.match(/^scroll down (.+)'s profile to their Experience/))) {
    return { color: 'yellow', headline: `Scroll down to ${m[1]}'s Experience` };
  }
  if (/^their Experience is being read/.test(text)) {
    return { color: 'yellow', headline: 'Their Experience is being read: keep scrolling' };
  }
  if (/Experience hasn't loaded their jobs/.test(text)) {
    return { color: 'red', headline: 'Scroll back up to their Experience' };
  }
  return need(text);
}

/** A "LinkedIn needs you:" sentence anywhere else: signing in, a security check. */
function need(text) {
  if (/security check/.test(text)) return { color: 'yellow', headline: 'Finish LinkedIn’s security check' };
  if (/sign in/i.test(text)) return { color: 'yellow', headline: 'Sign in to LinkedIn' };
  return { color: 'yellow', headline: 'LinkedIn needs you' };
}

/** A "(waiting: …)" note from the manual reader, as { color, headline }, or null for one it doesn't know. */
function manualWait(text) {
  let m;
  if ((m = text.match(/^scroll to the bottom of page (\d+)/))) {
    return { color: 'yellow', headline: `Scroll to the bottom of page ${m[1]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) still shows the last page's people/))) {
    return { color: 'red', headline: `Wait: page ${m[1]} is still loading`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) shows no one yet/))) {
    return { color: 'red', headline: `Wait: page ${m[1]} is still loading`, page: num(m[1]) };
  }
  if ((m = text.match(/^the window isn't on (?:(your)|(.+)'s) list/))) {
    return { color: 'red', headline: `Go back to ${listOf(whoIn(m))}` };
  }
  if (/Experience is on screen and its jobs are still loading/.test(text)) {
    return { color: 'red', headline: 'Wait: their jobs are still loading' };
  }
  if ((m = text.match(/^no Experience section on (.+)'s profile yet/))) {
    return { color: 'yellow', headline: `Scroll down to ${m[1]}'s Experience` };
  }
  return null;
}

/**
 * A change the manual reader says at once, as { color, headline }, or null for
 * one it doesn't know. `read` is the pages read so far, for "back on their list".
 */
function manualNote(text, ctx) {
  let m;
  // A break's countdown, a line a second (scrape.py _manual_break).
  if ((m = text.match(/^break after page (\d+): (\d+) s, then page (\d+)$/))) {
    return { color: 'yellow', headline: `Break: ${m[2]} s, then page ${m[3]}`, page: num(m[1]), wait: `${m[2]} s` };
  }
  if ((m = text.match(/^on page (\d+): scroll to its bottom/))) {
    return { color: 'yellow', headline: `Scroll to the bottom of page ${m[1]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^on page (\d+), which is read: go back to page (\d+)/))) {
    return { color: 'red', headline: `Go back to page ${m[2]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^on page (\d+), which is read: go on to page (\d+)/))) {
    return { color: 'green', headline: `Go on to page ${m[2]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^on page (\d+), which is read: click Next to page (\d+)/))) {
    return { color: 'green', headline: `Click Next to page ${m[2]}`, page: num(m[1]) };
  }
  if ((m = text.match(/^page (\d+) is loading$/))) {
    return { color: 'red', headline: `Wait: page ${m[1]} is still loading`, page: num(m[1]) };
  }
  if ((m = text.match(/^back on their list, page (\d+)$/))) {
    const p = num(m[1]);
    return ctx.read.has(p)
      ? { color: 'green', headline: `Click Next to page ${p + 1}`, page: p }
      : { color: 'yellow', headline: `Scroll to the bottom of page ${p}`, page: p };
  }
  if (/Experience is above: scroll back up to it$/.test(text)) {
    return { color: 'red', headline: 'Scroll back up to their Experience' };
  }
  if (/Experience(?: is showing)?; its jobs are still loading$/.test(text)) {
    return { color: 'red', headline: 'Wait: their jobs are still loading' };
  }
  return null;
}

// ── Reading the log ──────────────────────────────────────────────────────────

/**
 * What the log says about the list being read: whose, the page, how many
 * pages it has, where this read started, people found. Read oldest first, so
 * the latest of each wins; a new person (a batch's next) starts afresh.
 */
function listFacts(lines) {
  const f = { who: null, page: null, lastRead: null, startPage: null, about: null, pages: null, foundInList: null, manual: false, read: new Set() };
  let pendingPage = null;
  for (const line of lines) {
    let m;
    if ((m = line.match(BATCH))) {
      Object.assign(f, { who: m[3], page: null, lastRead: null, startPage: null, about: null, pages: null, foundInList: null, read: new Set() });
    } else if ((m = line.match(OPENING_PROFILE))) {
      if (m[1] !== f.who) Object.assign(f, { who: m[1], page: null, lastRead: null, startPage: null, about: null, pages: null, foundInList: null, read: new Set() });
    } else if ((m = line.match(OPENING_LIST))) {
      if (m[1] === YOURS) f.who = YOURS;
      f.startPage = m[2] ? num(m[2]) : 1;
      f.page = f.startPage;
    } else if ((m = line.match(READING_FROM))) {
      f.startPage = num(m[1]);
      f.page = f.startPage;
    } else if ((m = line.match(ABOUT))) {
      f.about = num(m[1]);
      f.pages = Math.min(MOST_PAGES, num(m[2]));
    } else if ((m = line.match(MANUAL_START))) {
      f.manual = true;
      f.who = whoIn(m);
    } else if ((m = line.match(PAGE))) {
      f.page = num(m[1]);
      if (m[2] != null) {
        f.read.add(f.page);
        f.lastRead = Math.max(f.lastRead ?? 0, f.page);
        f.foundInList = num(m[3]);
      } else {
        pendingPage = f.page;
      }
    } else if ((m = line.match(FOUND))) {
      if (pendingPage != null) {
        f.read.add(pendingPage);
        f.lastRead = Math.max(f.lastRead ?? 0, pendingPage);
      }
      f.foundInList = num(m[2]);
      pendingPage = null;
    } else if ((m = line.match(HIDDEN_PAGE))) {
      f.page = num(m[1]);
      f.read.add(f.page);
    } else if ((m = line.match(NEEDS))) {
      const t = m[1];
      if ((m = t.match(/^page (\d+) is (?:already )?read/)) || (m = t.match(/page bar shows page (\d+)/))) f.page = num(m[1]);
    } else if ((m = line.match(WAITING)) || (m = line.match(NOTE))) {
      if ((m = m[1].match(/page (\d+)/))) f.page = num(m[1]);
    }
  }
  return f;
}

/** The first of the STOPS that `line` is, as { headline, why }, or null. */
function stopIn(line) {
  for (const [re, make] of STOPS) {
    const m = line.match(re);
    if (m) return make(m);
  }
  return null;
}

/** Is this run one you page through by hand? Its own lines say so; else the mode it was started in. */
export function isManualRun(job) {
  const log = Array.isArray(job?.log) ? job.log : [];
  for (const raw of log) {
    const line = clean(raw);
    if (MANUAL_START.test(line) || MANUAL_DONE.test(line)) return true;
    const need = line.match(NEEDS);
    if (need && /scroll (to the bottom of each page|down .+'s profile to their Experience)|Click Previous to page|Click Next|Go (?:back|on) to page|Break: wait \d+ seconds/.test(need[1])) return true;
  }
  return job?.mode === 'manual' && CIRCLE_READS.has(job?.action);
}

/** Manual mode: the light from the newest line that says what it waits for. */
function manualLight(lines, ctx) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const stop = stopIn(line);
    if (stop) return { color: 'red', headline: stop.headline, detail: line, stopped: true };
    let m;
    if ((m = line.match(NEEDS))) {
      const got = manualNeed(m[1], ctx);
      return { ...got, detail: sentence(m[1]) };
    }
    if ((m = line.match(WAITING))) {
      const got = manualWait(m[1]);
      if (got) return { ...got, detail: sentence(m[1]) };
      continue;
    }
    if ((m = line.match(NOTE))) {
      const got = manualNote(m[1], ctx);
      if (got) return { ...got, detail: sentence(m[1]) };
      continue;
    }
    if ((m = line.match(PAGE)) && m[2] != null) {
      // Read: the "page N is read … Click Next" line follows at once.
      return { color: 'green', headline: `Click Next to page ${num(m[1]) + 1}` };
    }
    if ((m = line.match(HIDDEN_PAGE))) {
      return { color: 'green', headline: `Click Next to page ${num(m[1]) + 1}` };
    }
    if ((m = line.match(MANUAL_DONE))) {
      return { color: 'yellow', headline: `Done with ${listOf(m[2] ? YOURS : m[3])}`, detail: line };
    }
    // A round's last page by hand (lib/scan-rounds.js) ends it as a list's end does; and as older scanners said it.
    if (/^That's the end of their list\.|^That was page \d+, as far as LinkedIn's search goes\.|^That's page \d+, as far as this scan reads|^That's the \d+ pages this scan reads\./.test(line)) {
      return { color: 'yellow', headline: `Saving ${ctx.who ? listOf(ctx.who) : 'their list'}`, detail: line };
    }
    if (/^The window was closed: done with|^No new page for \d+ minutes/.test(line)) {
      return { color: 'yellow', headline: 'Moving on', detail: line };
    }
    if (BATCH.test(line) || OPENING_PROFILE.test(line) || OPENING_LIST.test(line)
      || /^Waiting \d+s before opening a profile|^\d+s to go$|^Search results loaded!|^Going straight to|^About [\d,]+ results/.test(line)) {
      // Opening their list for you: nothing to click yet.
      return { color: 'yellow', headline: ctx.who ? `Opening ${listOf(ctx.who)}` : 'Opening their list', detail: line };
    }
  }
  return { color: 'yellow', headline: 'Scanning' };
}

/** A scan that runs by itself: green while it reads, yellow while it rests, red once it stops. */
function autoLight(lines, ctx, job) {
  let left = null;   // a countdown line's time left, for the rest it belongs to
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const stop = stopIn(line);
    if (stop) return { color: 'red', headline: stop.headline, detail: line, stopped: true };
    if (THROUGH.test(line) && !/^Manual read done/.test(line)) break;
    let m;
    if ((m = line.match(NEEDS))) return { ...need(m[1]), detail: sentence(m[1]) };
    if ((m = line.match(/^(\d+)s to go$/))) { left ??= `${m[1]}s`; continue; }
    if ((m = line.match(/^(.+): (\d+) min to go$/))) { left ??= `${m[2]} min`; continue; }
    if ((m = line.match(/^(.+)\. Carrying on at (\d{1,2}:\d{2})\.$/))) {
      return { color: 'yellow', headline: `${m[1]} until ${m[2]}`, detail: line };
    }
    if ((m = line.match(/^\d+ pages read; resting (\d+)s before the next search\./))) {
      return { color: 'yellow', headline: `Resting before page ${(ctx.lastRead ?? 0) + 1}`, detail: line, wait: left || `${m[1]}s` };
    }
    if ((m = line.match(/^Waiting (\d+)s before (opening a profile|re-mapping)/))) {
      return { color: 'yellow', headline: ctx.who ? `Waiting to open ${ctx.who}'s profile` : 'Waiting to open a profile', detail: line, wait: left || `${m[1]}s` };
    }
    if (/: this sitting ends here, and what was read is saved\./.test(line)) {
      return { color: 'yellow', headline: 'This sitting is over: saving', detail: line };
    }
    // The last page of a round of one circle (lib/scan-rounds.js): done, not stopped.
    if (/^That's page \d+, the end of this round/.test(line)) {
      return { color: 'yellow', headline: 'This round is done: saving', detail: line };
    }
    if ((m = line.match(FOUND)) || ((m = line.match(PAGE)) && m[2] != null)) {
      return { color: 'yellow', headline: `Pausing before page ${(ctx.lastRead ?? 0) + 1}` };
    }
    if ((m = line.match(PAGE))) return { color: 'green', headline: `Reading page ${m[1]}` };
    if ((m = line.match(READING_FROM))) return { color: 'green', headline: `Reading page ${m[1]}` };
    if (OPENING_PROFILE.test(line) || OPENING_LIST.test(line) || /^Search results loaded!|^Going straight to|^About [\d,]+ results/.test(line)) {
      return { color: 'green', headline: ctx.who ? `Opening ${listOf(ctx.who)}` : 'Opening their list' };
    }
    if ((m = line.match(BATCH))) return { color: 'green', headline: `Starting ${m[3]}'s list` };
  }
  // A walk of your own connections, or anything else: running.
  const p = job?.progress;
  if (p?.kind === 'saving') return { color: 'green', headline: 'Saving what was read' };
  if (p?.kind === 'walk' && p.total) return { color: 'green', headline: `Reading your connections: ${p.done.toLocaleString('en-US')} of ${p.total.toLocaleString('en-US')}` };
  return { color: 'green', headline: 'Scanning' };
}

// ── The briefing's numbers ───────────────────────────────────────────────────

/** Today's searches: { used, limit, left, lifted, dev }, or null when the job didn't say. */
export function searchesToday(budget) {
  if (!budget || !Number.isFinite(budget.searches)) return null;
  const used = budget.searches;
  // Dev mode keeps one limit, its ceiling; lifted for the session, the same ceiling (since 2026-10-16).
  const limit = budget.dev && Number(budget.devCeiling) > 0 ? Number(budget.devCeiling)
    : budget.lifted ? (Number(budget.ceiling) > 0 ? Number(budget.ceiling) : null) : Number(budget.cap) > 0 ? Number(budget.cap) : null;
  return { used, limit, left: limit == null ? null : Math.max(0, limit - used), lifted: budget.lifted === true, dev: budget.dev === true };
}

/**
 * The ring round this person's dot, as the run so far would draw it
 * (lib/reach.js scanFill): their list read to `lastRead`, more to come, and
 * the list's length when LinkedIn said it. Null before a page is read.
 */
export function liveFill(lastRead, about) {
  if (!(lastRead > 0)) return null;
  const url = 'https://www.linkedin.com/in/scan-light';
  const reach = reachIndex([], [], { lists: { [url]: { pages: lastRead, more: true, total: about || null } } });
  const fill = scanFill({ id: 'scan-light', profile_url: url }, reach);
  return fill ? { read: fill.read, unknown: fill.unknown, words: scanFillWords(fill) } : null;
}

/**
 * About how long the rest of this list takes: the pages left at the pace this
 * run has kept (time since it started over pages read, never under the
 * speed's own wait), or the speed's own average before two pages are in. Null
 * when the list's length isn't known.
 */
export function timeLeft({ page, pages, startedAt, pagesRead, pace, now = Date.now() }) {
  if (!(pages > 0) || !(page > 0)) return null;
  const left = Math.max(0, pages - page);
  if (!left) return 0;
  // Never quicker than the speed's own wait before each page: the scanner
  // waits at least that, whatever pace a run that began quickly seems to have.
  const least = WORK_SECONDS + paceOf(pace).pagePause;
  const each = startedAt && pagesRead >= 2 ? Math.max(least, (now - startedAt) / 1000 / pagesRead) : pageSeconds(pace || undefined);
  return Math.round(left * each);
}

// ── The light ────────────────────────────────────────────────────────────────

/**
 * The scan light for the scanner's answer (lib/scraper-client.js useScanner):
 *   { color: 'green'|'yellow'|'red'|null, mode: 'manual'|'auto'|null,
 *     headline, detail, stats, ended }
 * `headline` is one short instruction ("Click Next to page 13"), `detail` the
 * scanner's own sentence it came from. `stats` is the panel's: whose list,
 * the page, people found, the searches today, and for a scan that runs by
 * itself the pages of about how many, the ring's fill and the time left.
 * NO_LIGHT when nothing runs (see endedLight for the moment after).
 */
export function scanLight(job, { now = Date.now() } = {}) {
  if (!job?.running || job.pending) return autoBetweenSittings(job, now);
  if (NOT_SCANS.has(job.action)) return NO_LIGHT;
  const log = Array.isArray(job.log) ? job.log.map(clean).filter(Boolean) : [];
  // What the log says of the list under way (a batch's next person starts afresh).
  const facts = listFacts(log);
  const manual = facts.manual || isManualRun(job);
  const who = facts.who || job.target?.name || mappingNow(job.log, job.action) || null;
  const ctx = { ...facts, who };
  const got = manual ? manualLight(log, ctx) : autoLight(log, ctx, job);
  // The scanner's latest needs-you sentence, when the light didn't come from one.
  const detail = got.detail ?? (job.needsYou ? sentence(job.needsYou) : null);
  const found = Array.isArray(job.found) ? job.found.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const page = got.page ?? facts.page ?? null;
  const stats = {
    who,
    page,
    lastRead: facts.lastRead,
    pages: facts.pages,
    about: facts.about,
    found,
    foundInList: facts.foundInList,
    pagesRead: Number(job.pages) || 0,
    batch: job.progress?.kind === 'batch' ? { current: job.progress.current, total: job.progress.total } : null,
    searches: searchesToday(job.budget),
    fill: manual ? null : liveFill(facts.lastRead, facts.about),
    // Stopped, nothing is left to time.
    secondsLeft: manual || got.stopped ? null : timeLeft({
      page: facts.lastRead ?? page, pages: facts.pages, startedAt: job.startedAt, pagesRead: Number(job.pages) || 0, pace: job.budget?.pace, now,
    }),
    wait: got.wait ?? null,
    sitting: job.auto?.phase === 'running',
    lines: log.slice(-5),
  };
  return { color: got.color, mode: manual ? 'manual' : 'auto', headline: got.headline, detail, stats, ended: false };
}

/** Auto scan resting between its sittings (route.js autoView): yellow, saying until when. */
function autoBetweenSittings(job, now) {
  const a = job?.auto;
  if (!a?.on || job?.running) return NO_LIGHT;
  const until = a.until ? new Date(a.until) : null;
  const at = until ? `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}` : null;
  const headline = a.phase === 'rest' ? `Auto scan: resting${at ? ` until ${at}` : ''}`
    : a.phase === 'hours' ? `Auto scan: outside its hours${at ? `, from ${at}` : ''}`
    : a.phase === 'waiting' ? 'Auto scan: waiting its turn'
    : 'Auto scan: starting';
  const stats = {
    who: null, page: null, lastRead: null, pages: null, about: null, found: 0, foundInList: null, pagesRead: 0, batch: null,
    searches: searchesToday(job.budget), fill: null, secondsLeft: a.until ? Math.max(0, Math.round((a.until - now) / 1000)) : null,
    wait: null, sitting: false, lines: [],
  };
  return { color: 'yellow', mode: 'auto', headline, detail: a.reason || null, stats, ended: false };
}

// How a job ended (route.js finish, lib/scan-exit.js): its colour, a few
// words, and what that means for what was read.
const KEPT = 'What was read is saved, and Resume on the Scan page carries on from the same page.';
const ENDS = {
  ok: ['green', 'Finished', 'What was read is saved.'],
  stopped: ['red', 'Stopped', KEPT],
  limit: ['red', 'Stopped at today’s limit', KEPT],
  cooldown: ['red', 'Stopped: scanning is paused for now', KEPT],
  pushback: ['red', 'Stopped: LinkedIn pushed back', KEPT],
  'signed-out': ['red', 'Stopped: LinkedIn isn’t signed in', null],
  'save-failed': ['red', 'Stopped: what was read couldn’t be saved', null],
  unread: ['red', 'Stopped: a page couldn’t be read', null],
  'search-limit': ['red', 'Stopped: LinkedIn’s monthly search limit', KEPT],
};

/**
 * The light for a scan that has just ended, from how it ended (an entry of
 * the job answer's `recent`), kept up for LIGHT_LINGER_MS by the header.
 * `last` is the light it showed while it ran, for its mode and numbers.
 */
export function endedLight(ended, last = null) {
  if (!ended || NOT_SCANS.has(ended.action)) return NO_LIGHT;
  const [color, headline, kept] = ENDS[ended.exitKind] || (ended.exitCode === 0 ? ENDS.ok : ['red', 'Stopped with an error', null]);
  const failure = Array.isArray(ended.failure) ? ended.failure[ended.failure.length - 1] : null;
  return {
    color, mode: last?.mode || 'auto', headline,
    // Not the last instruction it gave: there's nothing left to do about that.
    detail: failure || kept,
    stats: last?.stats || null,
    ended: true,
  };
}

/** The light in words for its button and a screen reader: "Green, go ahead: Click Next to page 13". */
export function lightLabel(light) {
  if (!light?.color) return 'No scan running';
  const w = LIGHT_WORDS[light.color];
  // Over: nothing to go ahead with or hold on for, only how it ended.
  if (light.ended) return `${w.word}: ${light.headline}`;
  return `${w.word}, ${w.meaning}: ${light.headline}`;
}

/** "about 12 min" for the briefing, or null. */
export function timeLeftText(seconds) {
  if (seconds == null) return null;
  if (seconds === 0) return 'this is the last page';
  return `${durationText(seconds)} left`;
}
