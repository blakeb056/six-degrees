'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { watchTies, tiesNow, loadTies, TIES_NONE } from '../../lib/ties-client';
import { IS_DEMO } from '../../lib/demo';

/**
 * The mutual web, shared by every view (lib/ties-client.js): { ready, ties, index },
 * index by person (lib/mutual-web.js tieIndex). Loaded the first time a view asks.
 * `off` for a network that has none (the sample, a CSV).
 */
export default function useTies({ off = false } = {}) {
  const now = useSyncExternalStore(watchTies, tiesNow, () => TIES_NONE);
  const skip = off || IS_DEMO;
  useEffect(() => {
    if (!skip && !now.ready) loadTies();
  }, [skip, now.ready]);
  return skip ? TIES_NONE : now;
}
