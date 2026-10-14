'use client';

// The Social tab's "once a day" live messages sync (experimental): once per
// app session, if it's switched on, the last sync is over a day old, it's
// daytime and the scanner is free, read the messages list (scripts/scrape.py
// --messages). Nothing else starts it.

import { useEffect } from 'react';
import { watchScanner, scannerNow, beginScrape } from '../../lib/scraper-client';
import { scanShows } from '../../lib/scanner-capabilities';
import { IS_DEMO } from '../../lib/demo';

let tried = false;

export default function SocialAutoSync() {
  useEffect(() => {
    if (IS_DEMO || tried) return undefined;
    let stop = () => {};
    fetch('/api/social').then((r) => r.json()).then(({ social }) => {
      if (!social?.autoSync || tried) return;
      const last = social.liveAt ? Date.parse(social.liveAt) : 0;
      const hour = new Date().getHours();
      if (Date.now() - last < 24 * 3600 * 1000 || hour < 9 || hour >= 19) return;
      stop = watchScanner(() => {
        const now = scannerNow();
        if (!now.known || tried) return;
        tried = true;
        stop();
        // Message sync is the Auto scan plugin's (lib/scanner-capabilities.js): without it, nothing starts.
        if (!now.running && scanShows(now.capabilities).auto) beginScrape('messages').catch(() => {});
      });
    }).catch(() => {});
    return () => stop();
  }, []);
  return null;
}
