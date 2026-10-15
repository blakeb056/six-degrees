'use client';

// Every link that opens one person's LinkedIn profile, in one place.
//
// In the desktop app with Sixgree's own browser and a scanner that can drive
// it (lib/linkedin-panel.js; Blake, 2026-10-15: "yes on the outlink"), the
// profile opens there instead of in your browser: the scanner takes it to the
// profile through Outlink and clicks nothing, it counts as one of the day's
// profile views, and Outlink writes down which profile and when. Anywhere
// else, or where the app says it can't (no scanner, a plugin before 1.0.5,
// scanning's one-time "I understand" not given yet), your own browser, as
// before. Blake, 2026-10-15: "I sent a request to connect manually in the
// Separation tab and it opened an external tab": every profile link is this
// one now, and tests/open-profile.test.mjs keeps it so.
//
// Several at once (Outlink's Open All, Open Top 10): in the panel they are
// stepped through, one at a time, each counted, with "Next profile (N left)"
// in the LinkedIn bar (ProfileSteps), never opened in a burst. Without the
// panel, the page of links in your browser, as before.

import { useState, useSyncExternalStore } from 'react';
import { useLinkedInPanel, showLinkedInPanel, panelNow } from './linkedInPanelState';
import { beginScrape } from '../../lib/scraper-client';

/** The profile link of a row: profile_url, or profileUrl. */
export const profileUrlOf = (person) => person?.profile_url || person?.profileUrl || null;

/** Can a profile open in the panel now: the desktop app's panel, with a scanner to take it there? */
export function panelCanOpen(panel = panelNow()) {
  return Boolean(panel?.available && panel?.scanner);
}

/** One profile in your own browser, as every link did before the panel. */
export function openProfileInBrowser(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

export const PANEL_TITLE = 'Opens in Sixgree’s own browser, and counts as one of today’s profile views';

/**
 * Open `person`'s profile: in the panel when it can (Outlink: one profile
 * view, recorded), else in your browser (unless `browser` is false).
 * → { where: 'panel' | 'browser' | 'fallback' | 'error', message? }:
 *   'fallback' the panel couldn't, and `browser` was false, so nothing opened.
 */
export async function openProfile(person, { browser = true } = {}) {
  const url = profileUrlOf(person);
  if (!url) return { where: 'error', message: 'There is no LinkedIn profile to open.' };
  if (!panelCanOpen() || !person?.id) {
    if (!browser) return { where: 'fallback' };
    openProfileInBrowser(url);
    return { where: 'browser' };
  }
  showLinkedInPanel();
  try {
    await beginScrape('outlink', { id: person.id, name: person.name });
    return { where: 'panel' };
  } catch (err) {
    if (err?.details?.fallback) {
      if (!browser) return { where: 'fallback', message: err.message };
      openProfileInBrowser(url);
      return { where: 'browser' };
    }
    return { where: 'error', message: err?.message || 'It couldn’t be opened.' };
  }
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
  if (!panelCanOpen(panel) || !person?.id) {
    return <a href={url} target="_blank" rel="noopener noreferrer" onClick={before} className={className} style={style} title={title}>{children}</a>;
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

// ── Several profiles, one at a time ──────────────────────────────────────────

let steps = null;   // { people, next, heading, busy, note }
const stepListeners = new Set();
function setSteps(next) {
  steps = next;
  for (const l of stepListeners) l();
}
const watchSteps = (fn) => {
  stepListeners.add(fn);
  return () => stepListeners.delete(fn);
};

/** The profiles being stepped through in the panel: { people, next, heading, busy, note }, or null. */
export function useProfileSteps() {
  return useSyncExternalStore(watchSteps, () => steps, () => null);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Without the panel: a page of their links in a window of its own, to open
 * them in your browser one by one (or all, a moment apart), as Outlink always
 * did. Only linkedin.com profile links are put in it.
 */
export function openLauncherInBrowser(people, { heading = 'Open profiles', color = '#FFD700' } = {}) {
  const list = people.filter((p) => /^https:\/\/([a-z]{2,3}\.|www\.)?linkedin\.com\/in\//i.test(profileUrlOf(p) || ''));
  if (!list.length) return;
  if (list.length === 1) { openProfileInBrowser(profileUrlOf(list[0])); return; }
  const html = `<!DOCTYPE html><html><head><title>${esc(heading)}</title>
    <style>body{background:#0a0a1a;color:#fff;font-family:-apple-system,sans-serif;padding:24px;margin:0}
    h2{color:${esc(color)};margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:16px}
    .btn{display:block;padding:12px 16px;margin-bottom:6px;background:rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;text-decoration:none;
    font-size:13px;transition:background 0.15s}.btn:hover{background:rgba(0,119,181,0.2)}
    .name{font-weight:700}.tier{font-size:11px;margin-left:8px;font-weight:600;color:#9aa}
    .open-all{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#FFD700,#FF6B35);
    color:#000;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;border:none;margin-bottom:20px}</style></head>
    <body><h2>${esc(heading)}</h2>
    <p>Click each link or use the button below to open all at once.</p>
    <button class="open-all" onclick="document.querySelectorAll('.btn').forEach((a,i)=>setTimeout(()=>a.click(),i*300))">
    Open All (${list.length})</button>
    ${list.map((r) => `<a class="btn" href="${esc(profileUrlOf(r))}" target="_blank"><span class="name">${esc(r.name || profileUrlOf(r).split('/in/')[1]?.replace(/\/.*$/, '') || '')}</span>${
      r.tier ? `<span class="tier">${esc(r.tier)} · ${esc(parseFloat(r.power_score || 0).toFixed(1))}</span>` : ''}${
      r.headline ? `<br><span style="color:#666;font-size:11px">${esc(String(r.headline).substring(0, 60))}</span>` : ''}</a>`).join('')}
    </body></html>`;
  window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
}

/**
 * Open several profiles. In the panel: the first now, then one each time
 * "Next profile" is pressed (ProfileSteps), each one counted. Without it: the
 * page of links in your browser, as before.
 */
export async function openProfiles(people, { heading = 'Open profiles', color } = {}) {
  const list = (people || []).filter((p) => profileUrlOf(p));
  if (!list.length) return;
  if (list.length === 1) { await openProfile(list[0]); return; }
  if (!panelCanOpen() || !list.every((p) => p.id)) {
    openLauncherInBrowser(list, { heading, color });
    return;
  }
  setSteps({ people: list, next: 1, heading, busy: true, note: null });
  const got = await openProfile(list[0], { browser: false });
  if (got.where === 'fallback') {
    setSteps(null);
    openLauncherInBrowser(list, { heading, color });
    return;
  }
  if (steps) setSteps({ ...steps, busy: false, note: got.where === 'error' ? got.message : null });
}

/** The next of the profiles being stepped through. */
export async function nextProfile() {
  if (!steps || steps.busy || steps.next >= steps.people.length) return;
  const person = steps.people[steps.next];
  setSteps({ ...steps, next: steps.next + 1, busy: true, note: null });
  const got = await openProfile(person, { browser: false });
  if (!steps) return;
  // Not opened (something else runs): it stays next.
  if (got.where !== 'panel') setSteps({ ...steps, next: steps.next - 1, busy: false, note: got.message || 'It couldn’t be opened here.' });
  else setSteps({ ...steps, busy: false });
}

/** Stop stepping through them. */
export function endProfileSteps() {
  setSteps(null);
}

/** "Next profile (N left)" and Done, for the LinkedIn bar while profiles are stepped through. */
export function ProfileSteps({ buttonStyle }) {
  const s = useProfileSteps();
  if (!s) return null;
  const left = s.people.length - s.next;
  const who = s.people[s.next]?.name;
  return (
    <span data-profile-steps="" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {s.note && <span role="status" style={{ color: 'var(--sd-gold, #FFD700)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.note}>{s.note}</span>}
      {left > 0 && (
        <button type="button" onClick={() => nextProfile()} disabled={s.busy} style={{ ...buttonStyle, opacity: s.busy ? 0.6 : 1 }}
          title={`${who ? `${who}. ` : ''}Each one counts as one of today’s profile views`}>
          Next profile ({left} left)
        </button>
      )}
      <button type="button" onClick={endProfileSteps} style={{ ...buttonStyle, fontWeight: 600 }}>
        {left > 0 ? 'Stop' : 'Done'}
      </button>
    </span>
  );
}
