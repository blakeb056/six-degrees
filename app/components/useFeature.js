'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { fetchFeatures } from '../../lib/plugins-client';

// The app's features that come with a feature plugin (lib/plugins-view.js
// appFeatures), asked once and shared by the page: again on each page you
// open (Settings → Plugins is a page of its own, so coming back from it asks
// afresh) and when the window comes back to the front.

let features = null;   // null until the server has said
let asking = null;
const listeners = new Set();

function ask() {
  if (asking) return asking;
  asking = fetchFeatures()
    .then((f) => { features = f; })
    .catch(() => { features = features || {}; })
    .finally(() => {
      asking = null;
      for (const l of listeners) l();
    });
  return asking;
}

function watch(fn) {
  listeners.add(fn);
  if (listeners.size === 1) window.addEventListener('focus', ask);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) window.removeEventListener('focus', ask);
  };
}

/** Is the feature `unlock` on (its plugin installed, sound, and plugins on)? False until the server has said. */
export default function useFeature(unlock) {
  const pathname = usePathname();
  useEffect(() => { ask(); }, [pathname]);
  return useSyncExternalStore(watch, () => features?.[unlock] === true, () => false);
}
