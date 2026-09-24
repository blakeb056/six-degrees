// How far a running scan has got, read from the lines it prints, so the Scan
// page can draw a bar instead of asking someone to read a log.
//
// Both formats come from scripts/scrape.py — keep these patterns in step with it.
// If its wording changes, this returns null and the bar simply disappears; it
// never shows a wrong number.
//
//   1st degree:  "  LinkedIn reports 817 connections"
//                "  350 / 817 collected"            (every fifty people)
//                "  Collected all 817 connections."  (the end)
//   2nd degree:  "[3/10] Some Name (A-tier, score 6.2)"  (as each person starts)

const REPORTED = /LinkedIn reports (\d+) connections/;
const COLLECTED = /(\d+)\s*\/\s*(\d+)\s+collected/;
const COLLECTED_ALL = /Collected all (\d+) connections/;
const BRIDGE_STEP = /\[(\d+)\/(\d+)\]/;
// After the walk: saving to the app and fetching photos, which can take a minute
// or two for a whole network. Without this the bar sat at 99% and looked stuck.
const SAVING = /^(Collected \d+ connections|Pushing \d+ connections|\s*Sent \d+ →|\s*Updating \d+ profile images|\s*\[image_store\]|\s*Images \d+-\d+)/;

/**
 * @param {string[]} log    the scan's output lines, oldest first
 * @param {string} action   the Scan page action that is running
 * @returns {{done?: number, total?: number, current?: number, kind: 'walk'|'batch'|'saving'} | null}
 */
export function scanProgress(log, action) {
  if (!Array.isArray(log) || log.length === 0) return null;

  if (action === 'full' || action === 'refresh') {
    for (let i = log.length - 1; i >= 0; i--) {
      const line = String(log[i]);
      if (SAVING.test(line)) return { kind: 'saving' };
      const all = line.match(COLLECTED_ALL);
      if (all) return walk(Number(all[1]), Number(all[1]));
      const m = line.match(COLLECTED);
      if (m) return walk(Number(m[1]), Number(m[2]));
      const r = line.match(REPORTED);
      if (r) return walk(0, Number(r[1]));
    }
    return null;
  }

  if (action && (action.startsWith('auto-bridge') || action === 'resume-all')) {
    for (let i = log.length - 1; i >= 0; i--) {
      const m = String(log[i]).match(BRIDGE_STEP);
      if (m) {
        const current = Number(m[1]);
        const total = Number(m[2]);
        if (!total) return null;
        // "[3/10]" is printed as the third person STARTS, so two are finished.
        return { done: Math.min(current - 1, total), total, current, kind: 'batch' };
      }
    }
    return null;
  }

  return null;
}

function walk(done, total) {
  if (!total) return null;
  return { done: Math.min(done, total), total, kind: 'walk' };
}
