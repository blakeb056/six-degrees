// How a scanner run ended, by its exit code (Blake, 2026-10-05: structured exit
// codes). scripts/scrape.py EXIT_CODES is the same table, and
// tests/scan-exit.test.mjs checks the two agree. The app goes by the code; the
// old reading of the log's words is kept only for a scanner from before this
// (exitOutcome's `log`), which ended every known failure with 1.
//
//   kind          what happened
//   failure       the page shows it as a stop with a reason (the red box),
//                 not a calm end; a limit or a cooldown is the design working
//   limit         the notch offers "Lift limits for this session"
//   line          the job's last log line, in place of "Stopped (exit N)."

export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  pushback: 10,
  limit: 11,
  cooldown: 12,
  'signed-out': 13,
  'save-failed': 14,
  unread: 15,
  'search-limit': 16,
  'try-later': 17,
};

const OUTCOMES = {
  ok: { failure: false, line: 'Finished.' },
  error: { failure: true, line: null },
  usage: { failure: true, line: null },
  pushback: { failure: true, line: 'Stopped: LinkedIn pushed back.' },
  limit: { failure: false, limit: true, line: 'Stopped at today’s limit.' },
  cooldown: { failure: false, line: 'Stopped: scanning is paused for now.' },
  'signed-out': { failure: true, line: 'Stopped: LinkedIn isn’t signed in.' },
  'save-failed': { failure: true, line: 'Stopped: the app couldn’t save what was read.' },
  unread: { failure: true, line: 'Stopped: a page couldn’t be read.' },
  'search-limit': { failure: true, line: 'Stopped: LinkedIn’s monthly search limit.' },
  'try-later': { failure: true, line: 'Stopped: the photos couldn’t be saved this time.' },
};

const BY_CODE = new Map(Object.entries(EXIT_CODES).map(([k, v]) => [v, k]));
// What an older scanner printed for the two calm ends it exited 0 on, and the daily limit (scrape.py budget_message).
const DAILY_LIMIT_USED = /Today's limit of \d+ (searches|profile views) is used/;

/**
 * What an exit code means: { kind, code, failure, limit, line,
 * effective }. `effective` is the code the rest of the app has always read: 0
 * for a calm end (finished, a limit, a cooldown), else the code. An unknown
 * code is an unexpected error, and so is any non-zero code from a step that
 * isn't the scanner (`scanner: false`: pip, while installing). `log` (the job's last lines) is only looked at
 * for a scanner from before the table, to find the daily limit as before.
 */
export function exitOutcome(code, { log = [], scanner = true } = {}) {
  const n = Number.isInteger(code) ? code : -1;
  // Only the scanner's codes mean anything here: pip's, while installing, are its own.
  const kind = n === 0 ? 'ok' : (scanner && BY_CODE.get(n)) || 'error';
  const o = OUTCOMES[kind];
  const limit = Boolean(o.limit) || (n === 0 && log.slice(-15).some((l) => DAILY_LIMIT_USED.test(l)));
  return {
    kind, code: n, failure: o.failure, limit,
    line: o.line ?? `Stopped (exit ${n}).`,
    effective: o.failure ? n : 0,
  };
}
