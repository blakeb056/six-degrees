// Where your own network came from: an export of your connections, or a scan.
//
// A network that came from an export (Connections.csv, through the importer)
// keeps the header a CSV import has always had: no Scan tab, no Auto scan and
// no Check for new (Blake, 2026-10-12: hidden "until plugins bring them back").
// That used to be keyed on the CSV being open instead of the database
// (lib/csv.js openNetworkSource 'csv'). Once a CSV lands in the database it is
// your own network, so where it came from has to be kept, and it's kept in
// app_meta, beside the network it describes: it travels with a copy and with a
// backup, and a restore brings back the answer that went with that network.
//
// Set by the importer (lib/network-import.js), in the same transaction as the
// rows, when a file of nothing but an export lands in a network with no rows
// of its own yet, or in one that came from an export already. Cleared by the
// scanner's first batch (app/api/ingest/route.js) or a file the scanner made:
// from then on it's a scanned network, with the full header. A scanned
// network (rows already there, no mark) never gets one from an export.
//
// The value is the profile's id, so a mark can't carry over to a profile it
// wasn't made for (lib/profile.js decides which profile is "you").
//
// No imports: the header rule below is read in the browser too.

export const FROM_EXPORT_KEY = 'network_from_export';

/** Did profile `userId`'s network come from an export, with nothing scanned in it since? */
export function fromExport(db, userId) {
  if (!userId) return false;
  return db.prepare('SELECT value FROM app_meta WHERE key = ?').get(FROM_EXPORT_KEY)?.value === userId;
}

export function markFromExport(db, userId) {
  db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(FROM_EXPORT_KEY, userId);
}

/** The network has been scanned: it's no export's any more. @returns whether there was a mark. */
export function clearFromExport(db) {
  return db.prepare('DELETE FROM app_meta WHERE key = ?').run(FROM_EXPORT_KEY).changes > 0;
}

/**
 * What the header on every page shows (app/components/AppHeader.js and
 * AppTabs.js), by the network on screen:
 *   - the sample in the demo build, or one opened in this window, or a kept
 *     CSV an older version left (csvMode): none of it is your own network, so
 *     no Outlink, nothing to scan and no notifications, and the round button
 *     opens what that network is;
 *   - your own network from an export (fromExport): Outlink, Profile and
 *     notifications, since it's in the database, but nothing that scans;
 *   - your own scanned network: everything.
 */
export function headerShows({ demo = false, csvMode = false, fromExport: exported = false } = {}) {
  const own = !demo && !csvMode;
  const scans = own && !exported;
  return {
    outlink: own,
    scanTab: scans,
    autoScan: scans,
    checkForNew: scans,
    notifications: own,
    profileHref: demo ? '/launch' : csvMode ? '/import' : '/profile',
  };
}
