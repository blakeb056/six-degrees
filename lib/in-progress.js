// What the app says about a circle scan that stopped partway. Blake,
// 2026-10-03: "if someone was scanned but not finished it needs to show that in
// their profile card if clicked showing resume scanner in that actual card as we
// need to have some sort of in progress ones in the scanner as well to see all
// the ones they stopped and would like to resume".
//
// The person card (app/components/Sidebar.js) and the Scan page's In progress
// card (app/components/LinkedInLimits.js PausedList) both word it from here, so
// the two never say it differently. Who is stopped partway, and where Resume
// carries on, is lib/paused.js's to decide; this only says it. No Node imports:
// the browser loads it.

/** The scan box's heading on a person card: a read that stopped partway says so first. */
export function scanBoxTitle({ resume, hasCluster }) {
  if (resume) return 'SCAN IN PROGRESS';
  return hasCluster ? 'CLUSTER ACTIVE' : 'CREATE CLUSTER';
}

// LinkedIn shows 100 pages of anyone's list at most (scrape.py LINKEDIN_MAX_PAGES).
const MOST_PAGES = 100;

/**
 * Every page of someone's list known to be read, sorted, from the scanner's note
 * (bridge-progress.json): page 1 through `pages`, and `readPages`, every page read
 * as runs ([[2, 14]]), kept when some were read past a page that wasn't (scrape.py
 * pages_known_read). A note without readPages is pages 1 through `pages`, as before.
 */
export function pagesKnownRead(entry) {
  if (!entry) return [];
  const known = new Set();
  // The bookmark as the note has it (only ever up to 100; the bound is for a file
  // that says otherwise); readPages within the 100 LinkedIn shows.
  const upTo = Math.min(10 * MOST_PAGES, Math.max(0, Math.floor(Number(entry.pages) || 0)));
  for (let p = 1; p <= upTo; p++) known.add(p);
  for (const run of Array.isArray(entry.readPages) ? entry.readPages : []) {
    const [a, b] = Array.isArray(run) ? run : [run, run];
    const first = Math.max(1, Math.floor(Number(a)));
    const last = Math.min(MOST_PAGES, Math.floor(Number(b)));
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
    for (let p = first; p <= last; p++) known.add(p);
  }
  return [...known].sort((x, y) => x - y);
}

/** Sorted pages in words, as runs: [2, 3, 4] is "2–4", [1, 2, 5, 7, 8] "1–2, 5 and 7–8". */
export function pageRunsText(pages) {
  const runs = [];
  for (const p of pages || []) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  const words = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '';
}

/** Pages read past the first one still to read: a gap, so "Read to page N" would undersell it. */
function readPast(resume) {
  const read = Number(resume?.pagesRead) || 0;
  const known = Array.isArray(resume?.readPages) ? resume.readPages : [];
  return known.some((p) => p > read + 1) ? known : null;
}

/**
 * How much of their list is read, for the card and the Scan page's In progress
 * list: "Read to page 4", or with pages read past one that isn't (Blake,
 * 2026-10-14: pages 2 to 14 read, page 1 not), "Pages 2–14 read".
 */
export function pagesReadText(resume) {
  const past = readPast(resume);
  if (!past) return `Read to page ${Number(resume?.pagesRead) || 0}`;
  return `${past.length === 1 ? 'Page' : 'Pages'} ${pageRunsText(past)} read`;
}

/**
 * The line by their name on the card, from GET /api/scraper?resume=<id>
 * ({ nextPage, pagesRead, legacy, readPages }; readPages only when some pages
 * were read past one that wasn't). null when there is nothing to carry on with.
 */
export function stoppedLine(resume) {
  if (!resume) return null;
  if (readPast(resume)) return `${pagesReadText(resume)}; page ${resume.nextPage} still to read`;
  const read = Number(resume.pagesRead) || 0;
  return read > 0 ? `Scan stopped after page ${read}` : 'Scan stopped before its first page';
}

/**
 * The In progress card's line on the Scan page, from the status answer's
 * `paused` (lib/paused.js pausedList). null when nobody is. People mapped
 * before 0.1.6 kept notes (`legacy`) were read to page 10 and no further, which
 * is why they're here at all, so it says so.
 */
export function inProgressSummary(paused = []) {
  const list = Array.isArray(paused) ? paused : [];
  const n = list.length;
  if (!n) return null;
  const legacy = list.filter((p) => p?.legacy).length;
  const line = n === 1
    ? '1 person stopped partway. Resume carries on from the page they stopped at.'
    : `${n} people stopped partway. Resume carries on from the page each one stopped at.`;
  if (!legacy) return line;
  const old = n === 1 ? 'Their list was' : legacy === 1 ? '1 of them was' : `${legacy} of them were`;
  return `${line} ${old} read to page 10, before whole lists were read.`;
}
