// How much searching is asking for trouble, for the Scan page's budget picker.
// No Node imports, so the page and the tests share it (lib/linkedin-limits.js
// reads files and can't load in the browser).
//
// The number behind it (TRAPS §16): on 2026-09-28 a real account was restricted
// after 373 searches in 24 hours, run back to back, with the daily budget raised
// to 500 and no monthly cap. It opened 7 profiles that day, so searches alone
// were enough.

export const RISKY_DAILY = 100;       // above this, the picker asks first
export const RESTRICTED_AT = 373;     // searches in 24 hours when that account was restricted
export const SAFE_LIMITS = { daily: 50, monthly: 250 };

export const riskyDaily = (n) => Number(n) > RISKY_DAILY;
export const riskyLimits = ({ daily, monthly } = {}) => riskyDaily(daily) || monthly === 0;

/** What the picker asks before a change that raises the risk; null when there's nothing to ask. */
export function limitQuestion(from = {}, to = {}) {
  if (riskyDaily(to.daily) && Number(to.daily) > Number(from.daily)) {
    return `${to.daily} searches a day is more than LinkedIn has put up with. A real account was `
      + `restricted after ${RESTRICTED_AT} searches in 24 hours, run back to back. The default is `
      + `${SAFE_LIMITS.daily} a day.\n\nSet ${to.daily} a day anyway?`;
  }
  if (to.monthly === 0 && from.monthly !== 0) {
    return 'With no monthly cap, only the daily budget stops a scan. A real account was restricted '
      + `after ${RESTRICTED_AT} searches in 24 hours with no monthly cap set.\n\nTurn the monthly cap off anyway?`;
  }
  return null;
}

/**
 * The note under the picker while the budget is risky; null when it isn't.
 * `restriction: false` leaves out the 373 sentence, for Settings → LinkedIn
 * usage when its own warning has just said it (lib/usage.js warningParts).
 */
export function limitNote({ daily, monthly } = {}, { restriction = true } = {}) {
  if (!riskyLimits({ daily, monthly })) return null;
  const parts = restriction ? [`A real account was restricted after ${RESTRICTED_AT} searches in 24 hours.`] : [];
  if (riskyDaily(daily)) parts.push(`${daily} a day can use up a free account's month in a day or two.`);
  if (monthly === 0) parts.push('With no monthly cap, nothing but the daily budget stops a long run.');
  return parts.join(' ');
}
