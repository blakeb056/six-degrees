'use client';

import { useSyncExternalStore } from 'react';
import { watchScanner, scannerNow, SCANNER_UNKNOWN } from '../../lib/scraper-client';

/**
 * What the scanner is running, shared by every Scan button on the page: one
 * answer, asked once (lib/scraper-client.js). Any button that starts a scan
 * greys out while `running`, and says why with busyReason().
 */
export default function useScanner() {
  return useSyncExternalStore(watchScanner, scannerNow, () => SCANNER_UNKNOWN);
}
