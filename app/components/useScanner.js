'use client';

import { useSyncExternalStore } from 'react';
import { watchScanner, scannerNow, capabilitiesNow, SCANNER_UNKNOWN } from '../../lib/scraper-client';
import { scanShows } from '../../lib/scanner-capabilities';

/**
 * What the scanner is running, shared by every Scan button on the page: one
 * answer, asked once (lib/scraper-client.js). Any button that starts a scan
 * greys out while `running`, and says why with busyReason().
 */
export default function useScanner() {
  return useSyncExternalStore(watchScanner, scannerNow, () => SCANNER_UNKNOWN);
}

const NOT_KNOWN = () => null;

/**
 * What the pages show for the scanner installed (lib/scanner-capabilities.js
 * scanShows): { scan, auto, manual, manualLocked, chimes }. From the same
 * answer as useScanner, but a component that reads only this is drawn again
 * only when what's installed changes, never on a scan's progress, so the
 * header, the map and every row can ask it. Everything shows until the server
 * has said, as it always did.
 */
export function useScanShows() {
  return scanShows(useSyncExternalStore(watchScanner, capabilitiesNow, NOT_KNOWN));
}
