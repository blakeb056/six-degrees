// Who has a list that was only partly read — the Scan page's Paused list.
//
// This must agree with the scanner's own queue (scripts/scrape.py,
// next_page_to_read and auto_bridge_all), or "Resume all" would read people the
// list doesn't show and skip people it does. The rules, mirrored:
//   - someone is mapped once they have a circle saved or a progress note;
//   - no note means they were mapped before 0.1.6, at 10 pages: carry on at 11;
//   - "hidden" and "no more pages" are not paused; neither is page 100.
// tests/paused.test.mjs pins them.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const LEGACY_PAGES_READ = 10;
export const LINKEDIN_MAX_PAGES = 100;

/** The scanner's next_page_to_read, in JS. null = nothing left. */
export function nextPageToRead(entry) {
  if (!entry) return LEGACY_PAGES_READ + 1;
  if (entry.hidden || !entry.more) return null;
  const next = (Number(entry.pages) || 0) + 1;
  return next <= LINKEDIN_MAX_PAGES ? next : null;
}

/** This profile's progress notes, keyed by profile URL. */
export function readProgress(dir, userId) {
  try {
    const all = JSON.parse(readFileSync(path.join(dir, 'bridge-progress.json'), 'utf8'));
    const mine = all?.[String(userId || 'default')];
    return mine && typeof mine === 'object' ? mine : {};
  } catch {
    return {};
  }
}

export function readUnclear(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, 'bridge-unclear.json'), 'utf8')) || {}; } catch { return {}; }
}

/**
 * @param {object[]} firstDegree  { id, name, tier, profile_url, connected_date, created_at }
 * @param {Set<string>} mappedIds ids of 1st-degree people with a saved circle
 * @param {object} progress       readProgress()
 * @param {object} unclear        readUnclear()
 * @returns people newest-connected first, each with pagesRead, nextPage, legacy, at, unclear
 */
export function pausedList(firstDegree, mappedIds, progress = {}, unclear = {}) {
  const out = [];
  for (const c of firstDegree) {
    const url = c.profile_url;
    const entry = url ? progress[url] : undefined;
    if (!mappedIds.has(c.id) && !entry) continue;         // not mapped yet: not paused
    const nextPage = nextPageToRead(entry);
    if (nextPage == null) continue;
    out.push({
      id: c.id,
      name: c.name,
      tier: c.tier,
      profileUrl: url,
      pagesRead: nextPage - 1,
      nextPage,
      legacy: !entry,
      at: entry?.at || null,
      unclear: Number(unclear?.[url]?.n) || 0,
      connected: c.connected_date || null,
    });
  }
  out.sort((a, b) => String(b.connected || '').localeCompare(String(a.connected || ''))
    || String(a.name || '').localeCompare(String(b.name || '')));
  return out;
}
