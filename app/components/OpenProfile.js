'use client';

// Every link that opens one person's LinkedIn profile, in one place.
//
// In the desktop app with Sixgree's own browser (the LinkedIn panel,
// lib/linkedin-panel.js), the profile opens there at once: the shell takes the
// panel straight to it (desktop/main.mjs showProfile) and brings it forward,
// and you connect, follow or message by hand. Then the server counts it as one
// of the day's profile views and writes down which profile and when
// (app/api/profile-view, lib/profile-opened.js), in the background: no scanner
// job, no sign-in check, no wait between views. Connect, View profile and
// the Map's "Ask … for an intro" all do exactly this. Blake, 2026-10-15: "it took like
// 2-3 min to load and it's not snappy like the view profile button which is
// essentially the same", and "It should just copy that format as the user
// wants to do it manually themselves anyways".
//
// While a scan is driving the panel (lib/linkedin-panel.js scanHoldsPanel),
// and anywhere without the panel, your own browser, as before: taking the
// panel's page from a running scan would lose its place.
//
// One profile per press, never several at once: Open All and Open Top 10 went
// with the introductions queue they were on (Blake, 2026-10-17).
//
// Blake, 2026-10-15: "I sent a request to connect manually in the Separation
// tab and it opened an external tab": every profile link is this one, and
// tests/open-profile.test.mjs keeps it so.

import { useState } from 'react';
import { useLinkedInPanel, panelNow, showProfileInPanel, rememberPanelPerson } from './linkedInPanelState';
import { scannerNow, LIMITS_CHANGED } from '../../lib/scraper-client';
import { scanHoldsPanel } from '../../lib/linkedin-panel';
import { logInteraction } from '../../lib/learning-client';

/** The profile link of a row: profile_url, or profileUrl. */
export const profileUrlOf = (person) => person?.profile_url || person?.profileUrl || null;

/** Can a profile open in the panel now: the desktop app's panel, and no scan driving it? */
export function panelCanOpen(panel = panelNow(), job = scannerNow()) {
  return Boolean(panel?.available) && !scanHoldsPanel(job, panel);
}

/** One profile in your own browser, as every link did before the panel. */
export function openProfileInBrowser(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

export const PANEL_TITLE = 'Opens in Sixgree’s own browser, and counts as one of today’s profile views';

/**
 * Tell the server a profile opened in the panel: one profile view, written
 * down (app/api/profile-view). In the background; the panel is already there.
 */
export function countProfileView(person, url) {
  fetch('/api/profile-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: person?.id ?? null, name: person?.name ?? null, url }),
  }).then((r) => {
    // The notch's and the Scan page's counts, at once rather than at their next look.
    if (r.ok && typeof window !== 'undefined') window.dispatchEvent(new Event(LIMITS_CHANGED));
  }).catch(() => {});
}

/**
 * Open `person`'s profile: in the panel when it can (at once, then counted as
 * one profile view), else in your browser.
 * → { where: 'panel' | 'browser' | 'error', message? }
 */
export async function openProfile(person) {
  const url = profileUrlOf(person);
  if (!url) return { where: 'error', message: 'There is no LinkedIn profile to open.' };
  if (panelCanOpen() && await showProfileInPanel(url)) {
    // Who it is, for when LinkedIn says "Invitation sent" there (LinkedInPanel.js).
    rememberPanelPerson(person);
    countProfileView(person, url);
    return { where: 'panel' };
  }
  // The learning log: opened in your own browser (one opened in the panel is logged by app/api/profile-view).
  logInteraction('profile-open', person, { via: 'browser' });
  openProfileInBrowser(url);
  return { where: 'browser' };
}

/**
 * A profile link. `onOpen` runs on the click first (Connect marks the request
 * sent); `stopPropagation` keeps the click from the row under it; `title` is
 * said when it opens in your browser.
 */
export default function OpenProfile({ person, style, className, title, onOpen, stopPropagation = false, noteStyle, children }) {
  const panel = useLinkedInPanel();
  const [note, setNote] = useState(null);
  const url = profileUrlOf(person);
  if (!url) return null;
  const before = (e) => {
    if (stopPropagation) e.stopPropagation();
    onOpen?.(e);
  };
  if (!panel?.available) {
    // The learning log: a profile opened in your own browser, before whatever the link does with it (Connect).
    const inBrowser = (e) => { logInteraction('profile-open', person, { via: 'browser' }); before(e); };
    return <a href={url} target="_blank" rel="noopener noreferrer" onClick={inBrowser} className={className} style={style} title={title}>{children}</a>;
  }
  async function open(e) {
    e.preventDefault();
    before(e);
    setNote(null);
    const got = await openProfile(person);
    if (got.where === 'error') setNote(got.message);
  }
  return (
    <>
      <a href={url} onClick={open} className={className} style={style} title={PANEL_TITLE}>{children}</a>
      {note && <span role="status" style={{ fontSize: 11, color: 'var(--sd-gold, #FFD700)', maxWidth: 220, ...noteStyle }}>{note}</span>}
    </>
  );
}
