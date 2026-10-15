'use client';

// The LinkedIn panel's state from the desktop shell (desktop/main.mjs
// panelState), shared by everything on the page that asks: the bar and the
// still picture (LinkedInPanel.js), the LinkedIn browser's button and people
// list (LinkedInBrowser.js) and every profile link (OpenProfile.js). Its own
// file so none of them has to import another to read it.
//
//   { available, visible, linkedin, mode, profile, frozen, scanner }
//   mode      'browse' (the LinkedIn browser's button) or 'scan', while shown
//   profile   the linkedin.com/in/<slug> it is on, or null
//   frozen    swapped for a still picture while something is open over it
//   scanner   a scanner can drive it (Outlink's profiles need one)
// null outside the desktop app, or until the shell answers.

import { useSyncExternalStore } from 'react';

export const panelBridge = () => (typeof window !== 'undefined' ? window.sixgreeDesktop?.linkedinPanel ?? null : null);

let state = null;
const listeners = new Set();
let watching = null;

function publish(next) {
  state = next;
  for (const l of listeners) l();
}

function watchPanel(listener) {
  listeners.add(listener);
  const b = panelBridge();
  if (b && !watching) {
    watching = b.onState(publish);
    b.state().then(publish).catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && watching) {
      watching();
      watching = null;
    }
  };
}

export const panelNow = () => state;
const none = () => null;

/** The panel's state in the desktop app with the panel; null otherwise. */
export function useLinkedInPanel() {
  return useSyncExternalStore(watchPanel, panelNow, none);
}

/** Bring the panel forward (Outlink's profile, say). False when there is none. */
export function showLinkedInPanel() {
  const b = panelBridge();
  if (!b || !state?.available) return false;
  b.show();
  return true;
}

/** Open it for your own browsing (the LinkedIn browser plugin). False when there is none. */
export function browseLinkedIn() {
  const b = panelBridge();
  if (!b || !state?.available || typeof b.browse !== 'function') return false;
  b.browse();
  return true;
}

/** Put it away (Back to Sixgree). */
export function hideLinkedInPanel() {
  panelBridge()?.hide();
}

/** The LinkedIn tab's sections, in the notch's order (desktop/lib.mjs LINKEDIN_SECTIONS). */
export const LINKEDIN_SECTION_TABS = Object.freeze([
  { key: 'feed', label: 'Feed' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'jobs', label: 'Jobs' },
]);

/** Open it straight on one LinkedIn section (the LinkedIn tab). False when there is none. */
export function openLinkedInSection(key) {
  const b = panelBridge();
  if (!b || !state?.available || typeof b.section !== 'function') return false;
  b.section(key);
  return true;
}
