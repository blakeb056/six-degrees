// Saying yes to the scanner's risk, once, before it first touches LinkedIn.
//
// The Scan page used to carry the risk as a grey line at the bottom. Now the
// first scan waits for an explicit "I understand" to three plain points, kept
// as a setting (app_meta, lib/settings.js) so it travels with a copy of the
// data. The server checks it too, so no button anywhere (the header's Check for
// new, a Scan button in a panel) can start a first scan without it.
//
// Someone who scanned before this existed has seen the risk and chosen it: the
// scanner's own Chrome profile in the data folder is the sign, since only the
// scanner makes one, and it never travels in a copy. They aren't asked again.
//
// No Node imports: the Scan page reads the points from here too.

export const RISK_POINTS = [
  'It runs your own LinkedIn account automatically, in Chrome on this computer, out of sight unless LinkedIn needs you.',
  'LinkedIn’s User Agreement doesn’t allow automated tools, and LinkedIn may restrict accounts that use them. The safe limits, 50 searches a day and 250 a month, stay on unless you change them.',
  'Nothing leaves your computer. There is no account with us and nothing is uploaded.',
];

export const RISK_REFUSAL = 'Before the first scan, open the Scan page and confirm you understand what scanning risks.';

// The scanner's actions that never open LinkedIn: installing its Python and
// packages, and saving photos already linked from it (no browser, no search).
const OFF_LINKEDIN = new Set(['install', 'setup', 'photos']);

export const touchesLinkedIn = (action) => !OFF_LINKEDIN.has(String(action));

/** When the risk was accepted (ISO time), or null; set from the Scan page. */
export const SCAN_RISK_SETTING = {
  default: null,
  parse(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new Error('When the scanning risk was accepted is a date and time.');
    }
    return new Date(value).toISOString();
  },
};

/** @param {{ acceptedAt?: string | null, scannedBefore?: boolean }} state */
export function riskAccepted({ acceptedAt = null, scannedBefore = false } = {}) {
  return Boolean(acceptedAt) || scannedBefore;
}
