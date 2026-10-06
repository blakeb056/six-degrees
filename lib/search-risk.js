// How much searching is asking for trouble, for the Scan page's daily limit.
// No Node imports, so the page and the tests share it (lib/linkedin-limits.js
// reads files and can't load in the browser).
//
// The number behind it (TRAPS §16): on 2026-09-28 a real account was restricted
// after 373 searches in 24 hours, run back to back, with the daily budget raised
// to 500 and no monthly cap. It opened 7 profiles that day, so searches alone
// were enough.
//
// Since 2026-10-05 there is one limit, searches a day (Blake: "Just a simple
// default limit for the day and a button to lift restrictions for this
// session"). Nothing asks first any more: a number over 100 shows a note beside
// it, and a way back to the default.

export const RISKY_DAILY = 100;       // above this, the note shows beside the number
export const RESTRICTED_AT = 373;     // searches in 24 hours when that account was restricted
export const SAFE_LIMITS = { daily: 50 };

export const riskyDaily = (n) => Number(n) > RISKY_DAILY;

/**
 * The note beside the number while it's risky; null when it isn't.
 * `restriction: false` leaves out the 373 sentence, for Scan → LinkedIn
 * usage when its own warning has just said it (lib/usage.js warningParts).
 */
export function limitNote({ daily } = {}, { restriction = true } = {}) {
  if (!riskyDaily(daily)) return null;
  const parts = restriction ? [`A real account was restricted after ${RESTRICTED_AT} searches in 24 hours.`] : [];
  parts.push(`${daily} a day can use up a free account's month in a day or two.`);
  return parts.join(' ');
}
