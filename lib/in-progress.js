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

/**
 * The line by their name on the card, from GET /api/scraper?resume=<id>
 * ({ nextPage, pagesRead, legacy }). null when there is nothing to carry on with.
 */
export function stoppedLine(resume) {
  if (!resume) return null;
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
