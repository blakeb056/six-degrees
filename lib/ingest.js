// Cleaning a batch before it is written. Used by app/api/ingest/route.js.

/**
 * One record per profile, keeping the first.
 *
 * A scraped batch can name the same person more than once — the same profile on
 * two result pages, or the same mutual connection shown under many results — and
 * the database's one-row-per-person-per-bridge index then rejects the WHOLE
 * insert. That is how a bridge's 134 people were read and none saved (TRAPS §32).
 */
export function uniqueByProfile(records) {
  const seen = new Set();
  return records.filter((r) => {
    if (!r || !r.profile_url || seen.has(r.profile_url)) return false;
    seen.add(r.profile_url);
    return true;
  });
}

/**
 * For someone else's circle (2nd degree) or a company scan, set aside the people
 * who are already your own connections.
 *
 * They arrive as the "mutual connections" links under each search result. They
 * are not people you have not met, so counting them inflates every circle; and
 * stored as 2nd-degree they duplicate your own network — the 190 rows a full
 * rescan once had to merge back.
 *
 * @param {object[]} records
 * @param {Set<string>} firstDegreeUrls  profile URLs that are 1st-degree for this user
 */
export function splitAlreadyConnected(records, firstDegreeUrls) {
  const keep = [];
  const connected = [];      // their profile URLs: ties between your connections (lib/ties.js)
  for (const r of records) {
    if (firstDegreeUrls.has(r.profile_url)) connected.push(r.profile_url);
    else keep.push(r);
  }
  return { keep, alreadyConnected: connected.length, connected };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/**
 * A date as LinkedIn writes it → "2026-09-22": "September 22, 2026" (a profile's
 * "Connected on …", read by the scanner) or "22 Sep 2026" (the "Connected On"
 * column of the Connections.csv export, read by lib/csv.js).
 *
 * Parsed by hand rather than with new Date(text).toISOString(): that reads the
 * text as local midnight and converts to UTC, which moves the date back a day
 * anywhere east of Greenwich — and throws outright on text it cannot read.
 * A calendar date has no time zone, so nothing here uses one.
 * Returns null for anything it does not recognise, or a day the month doesn't have.
 */
export function toIsoDate(text) {
  const t = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let name, day, year;
  let m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);   // September 22, 2026
  if (m) [, name, day, year] = m;
  else if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/))) [, day, name, year] = m;   // 22 Sep 2026
  else return null;
  const month = MONTHS.findIndex((full) => full.startsWith(name.toLowerCase()) && name.length >= 3);
  day = Number(day);
  // Day 0 of the next month is this month's last, counted in UTC so no zone moves it.
  if (month < 0 || day < 1 || day > new Date(Date.UTC(Number(year), month + 1, 0)).getUTCDate()) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Tiers that make a new connection worth a notification of its own.
const HIGH_VALUE = new Set(['S', 'A']);

/**
 * The notifications a refresh of your own connections (1st degree) leaves:
 * how many are new, and one for each new person the model scored S or A.
 *
 * `added` are the records this request inserted: new means new to the
 * database, not missing from a lookup (a re-scan of people already saved
 * used to count everyone past the first hundred as new). `tierOf(url)` is
 * the tier each was stored with by the rescore that follows the insert, so
 * "high-value" is the model's judgement (lib/scoring.js), not a list of
 * words or famous names matched anywhere in the headline, which read
 * "Metadata Engineer" as Meta and "Engineer at Applewood Bakery" as Apple.
 * `checked` is how many records the refresh sent.
 */
export function refreshNotifications({ added = [], checked = 0, tierOf = () => null, userId = null } = {}) {
  const user_id = userId || null;
  if (!added.length) {
    return [{
      user_id, type: 'refresh_summary', title: 'Network up to date',
      message: `Checked ${checked} connections — no new additions`, icon: '✓',
    }];
  }
  const out = [{
    user_id,
    type: 'refresh_summary',
    title: `${added.length} new connection${added.length > 1 ? 's' : ''} found!`,
    message: added.slice(0, 3).map((r) => r.name).join(', ') + (added.length > 3 ? ` +${added.length - 3} more` : ''),
    icon: '🔄',
  }];
  for (const r of added.filter((a) => HIGH_VALUE.has(tierOf(a.profile_url))).slice(0, 5)) {
    out.push({
      user_id, type: 'new_elite_connection', title: `High-value connection: ${r.name}`,
      message: r.headline?.substring(0, 60), icon: '👑',
      // Who it is, so the notification can open them (lib/notifications.js noteSubject).
      data: { profileUrl: r.profile_url },
    });
  }
  return out;
}

/**
 * LinkedIn's own count of the mutual connections you share with someone, as
 * the scanner read it off their result card (scripts/scrape.py
 * BRIDGE_RESULTS_JS), or null. A whole number from 1 (the bridge is always
 * one) to 30,000 (LinkedIn's cap on connections); anything else is a misread
 * and is dropped, never stored.
 */
export function mutualCountOf(value) {
  const n = typeof value === 'string' && /^\d[\d,]*$/.test(value.trim()) ? Number(value.replace(/,/g, '')) : value;
  return Number.isInteger(n) && n >= 1 && n <= 30000 ? n : null;
}
