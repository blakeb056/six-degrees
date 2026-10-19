'use client';

// The LinkedIn panel's state from the desktop shell (desktop/main.mjs
// panelState), shared by everything on the page that asks: the bar and the
// still picture (LinkedInPanel.js), the LinkedIn tab (app/linkedin/page.js)
// and every profile link (OpenProfile.js). Its own file so none of them has to
// import another to read it.
//
//   { available, visible, linkedin, mode, section, at, canGoBack, canGoForward, frozen, scanner }
//   mode         'profile' (a profile link), 'section' (the LinkedIn tab) or 'scan', while shown
//   canGoBack    Back and Forward on the bar: where its own history can go
//   frozen       swapped for a still picture while something is open over it
//   scanner      a scanner can drive it (a running scan then has it)
// null outside the desktop app, or until the shell answers.

import { useSyncExternalStore } from 'react';
import { profileSlugOf } from '../../lib/linkedin-panel';
import { track } from '../../lib/learning-client';

export const panelBridge = () => (typeof window !== 'undefined' ? window.sixgreeDesktop?.linkedinPanel ?? null : null);

let state = null;
const listeners = new Set();
let watching = null;

// The learning log (lib/learning-client.js): which section of LinkedIn is shown
// (a section of the LinkedIn tab, a profile, or a scan's), and for how long.
let shownAs = null;
function notePanel(next) {
  const section = next?.visible ? (next.mode === 'section' ? next.section || 'section' : next.mode || 'panel') : null;
  if ((shownAs?.section ?? null) === section) return;
  const now = Date.now();
  if (shownAs) track('panel', 'time', { section: shownAs.section, ms: now - shownAs.at });
  if (section) track('panel', 'open', { section, from: shownAs?.section ?? null });
  shownAs = section ? { section, at: now } : null;
}

function publish(next) {
  state = next;
  try { notePanel(next); } catch { /* the log is never in the way */ }
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

/** Bring the panel forward (Show LinkedIn). False when there is none. */
export function showLinkedInPanel() {
  const b = panelBridge();
  if (!b || !state?.available) return false;
  b.show();
  return true;
}

/**
 * Open it straight on one person's profile, at once (desktop/main.mjs
 * showProfile). Resolves true when it went; false when there is no panel or
 * the shell refused the link.
 */
export async function showProfileInPanel(url) {
  const b = panelBridge();
  if (!b || !state?.available || typeof b.profile !== 'function') return false;
  try {
    return (await b.profile(url)) === true;
  } catch {
    return false;
  }
}

// Who each profile link opened in the panel was, by their slug, so "Invitation sent" on
// that profile marks that row (LinkedInPanel.js, lib/linkedin-panel.js inviteSentAction).
const opened = new Map();
const OPENED_KEPT = 200;

/** A profile link opened this person in the panel (OpenProfile.js). */
export function rememberPanelPerson(person) {
  const slug = profileSlugOf(person?.profile_url || person?.profileUrl);
  if (!slug) return;
  opened.delete(slug);
  opened.set(slug, person);
  if (opened.size > OPENED_KEPT) opened.delete(opened.keys().next().value);
}

/** The person a profile link opened at this slug, or null. */
export function panelPersonFor(slug) {
  return (typeof slug === 'string' && opened.get(slug.toLowerCase())) || null;
}

/** Back, and Forward, in the panel's own history (the bar's buttons). */
export function panelBack() {
  track('panel', 'nav', { dir: 'back', section: shownAs?.section ?? null });
  panelBridge()?.back?.();
}
export function panelForward() {
  track('panel', 'nav', { dir: 'forward', section: shownAs?.section ?? null });
  panelBridge()?.forward?.();
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
