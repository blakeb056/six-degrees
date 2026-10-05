'use client';

import { useLayoutEffect } from 'react';
import { setNotchTabs } from '../../lib/island';

/**
 * A page's buttons in the notch (lib/island.js), there while the page is and
 * gone with it. Pass the same object while nothing in it changes (useMemo, or a
 * constant), and null for none.
 *
 * A layout effect, not a plain one, and that is the point of this hook. A plain
 * effect runs after the new page has been painted, so in a production build the
 * Scan page came up for one frame with the page before's tabs still in the notch
 * (Paths' Map · Companies, Outlink's Circles…). A layout effect runs in the same
 * commit as the page swap: the old page's cleanup and the new page's tabs both
 * land before that frame is drawn, and the notch reads them in one go.
 */
export default function useNotchTabs(tabs) {
  useLayoutEffect(() => {
    setNotchTabs(tabs);
    return () => setNotchTabs(null);
  }, [tabs]);
}
