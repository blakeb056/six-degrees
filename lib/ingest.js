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
  let alreadyConnected = 0;
  for (const r of records) {
    if (firstDegreeUrls.has(r.profile_url)) alreadyConnected += 1;
    else keep.push(r);
  }
  return { keep, alreadyConnected };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/**
 * "September 22, 2026" (as LinkedIn prints "Connected on …") → "2026-09-22".
 *
 * Parsed by hand rather than with new Date(text).toISOString(): that reads the
 * text as local midnight and converts to UTC, which moves the date back a day
 * anywhere east of Greenwich — and throws outright on text it cannot read.
 * Returns null for anything it does not recognise.
 */
export function toIsoDate(text) {
  const t = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase()) && m[1].length >= 3);
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
    });
  }
  return out;
}
