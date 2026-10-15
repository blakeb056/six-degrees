// Outlink's record of the profiles it opened in Sixgree's own browser (the
// LinkedIn panel, lib/linkedin-panel.js): who, which profile, and when. Each is
// also one of the day's profile views, written down by the scanner itself
// (scrape.py open_outlink, take_profile_view), so it counts against the same
// daily limit as the views a scan makes. This file is only the history.
//
// <data folder>/outlink-opened.json: { "opened": [{ id, name, url, at }] },
// oldest first, `at` in epoch milliseconds, the newest OUTLINK_KEPT kept.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { durable } from './durable.js';

export const OUTLINK_FILE = 'outlink-opened.json';
export const OUTLINK_KEPT = 500;

/** Every profile opened so far, oldest first; [] when there is no record or it can't be read. */
export function readOutlinkOpened(dir) {
  try {
    const data = JSON.parse(readFileSync(path.join(dir, OUTLINK_FILE), 'utf8'));
    return Array.isArray(data?.opened) ? data.opened.filter((e) => e && typeof e === 'object') : [];
  } catch {
    return [];
  }
}

/**
 * Write down one profile opened: { id, name, url } and when (`at`, now unless
 * given). Returns the entry kept. Never throws: a record that couldn't be
 * written takes nothing back from the profile that opened.
 */
export function recordOutlinkOpened(dir, { id = null, name = null, url, at = Date.now() } = {}) {
  const entry = {
    id: typeof id === 'string' && id ? id : null,
    name: typeof name === 'string' && name ? name : null,
    url: String(url ?? ''),
    at: Number.isFinite(at) ? at : Date.now(),
  };
  try {
    const opened = [...readOutlinkOpened(dir), entry].slice(-OUTLINK_KEPT);
    durable.writeJsonDurably(path.join(dir, OUTLINK_FILE), { opened });
  } catch { /* the history only */ }
  return entry;
}
