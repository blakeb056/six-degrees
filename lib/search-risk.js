// How much searching is asking for trouble, for Scan → LinkedIn usage's meter.
// No Node imports, so the page and the tests share it (lib/linkedin-limits.js
// reads files and can't load in the browser).
//
// The number behind it (TRAPS §16): on 2026-09-28 a real account was restricted
// after 373 searches in 24 hours, run back to back, with the daily budget raised
// to 500 and no monthly cap. It opened 7 profiles that day, so searches alone
// were enough.
//
// Since 2026-10-17 the scan windows (lib/scan-windows.js) hold searches to 120 a
// day at most, so no setting can reach these numbers any more; they mark the
// meter. The note a risky searches a day showed went with that setting.

export const RISKY_DAILY = 100;       // searches in 24 hours above which the meter reads risky
export const RESTRICTED_AT = 373;     // searches in 24 hours when that account was restricted
export const SAFE_LIMITS = { daily: 50 };   // the old default a day: above it the meter reads busier
