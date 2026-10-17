'use client';

// A hint (lib/help.js HINTS): one small card, the first visits to a place,
// until Got it. Drawn by the header (AppHeader), so every page with the app's
// tabs has its place's hint, and only one: a place has one hint, and a page
// is one place. Never during a scan, never over the tour, never under
// Sixgree's own browser, none before the tour has been offered, and none at
// all with Settings → Help's switch off. Dismissals are kept in this window.

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import useScanner from '../useScanner';
import { useLinkedInPanel } from '../linkedInPanelState';
import { IS_DEMO } from '../../../lib/demo';
import {
  placeOf, hintFor, readHints, readTour, dismissHint, setHintsOff, withKeys, isMac,
  watchHelp, hintsRawNow, tourRawNow, touringNow, nothingStored,
} from '../../../lib/help';
import { HELP_CSS } from './styles';

const noWindow = () => () => {};
const isClient = () => true;
const isServer = () => false;
const asStorage = (raw) => ({ getItem: () => raw });

/** @param {{ place: string }} props  the header's `active`: the page, or the map's tab. */
export default function Hint({ place: active }) {
  const place = IS_DEMO ? null : placeOf(active);
  const client = useSyncExternalStore(noWindow, isClient, isServer);
  const hintsRaw = useSyncExternalStore(watchHelp, hintsRawNow, nothingStored);
  const tourRaw = useSyncExternalStore(watchHelp, tourRawNow, nothingStored);
  const touring = useSyncExternalStore(watchHelp, touringNow, isServer);
  const mac = useSyncExternalStore(noWindow, () => isMac(), isServer);
  const scan = useScanner();
  const panel = useLinkedInPanel();
  const hint = client && place ? hintFor(place, {
    hints: readHints(asStorage(hintsRaw)),
    tourSeen: readTour(asStorage(tourRaw)).seen,
    touring,
    scanning: scan.running || scan.pending,
    panel: Boolean(panel?.visible),
  }) : null;
  if (!hint) return null;
  const done = () => dismissHint(hint.key);
  return createPortal((
    <div className="sdh sdh-hint" role="status" aria-live="polite" data-glass-panel="" data-hint={hint.key}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } }}>
      <style>{HELP_CSS}</style>
      <span className="sdh-hint-mark" aria-hidden="true">✦</span>
      <div style={{ minWidth: 0 }}>
        <p>{withKeys(hint.text, mac)}</p>
        <div className="sdh-hint-actions">
          <button type="button" className="sdh-btn quiet" onClick={done} aria-label="Got it, dismiss this hint">Got it</button>
          <button type="button" className="sdh-btn quiet" onClick={() => setHintsOff(true)}>Turn hints off</button>
        </div>
      </div>
    </div>
  ), document.body);
}
