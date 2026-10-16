// The record of the profiles opened in Sixgree's own browser (the LinkedIn
// panel, lib/linkedin-panel.js): who, which profile, and when. Every profile
// link in the app (Connect, View profile, Outlink's Open profile) opens the
// panel straight on the profile (desktop/main.mjs showProfile), and the page
// then tells the server (app/api/profile-view), which writes both down here,
// with no scanner job and no wait (Blake, 2026-10-15: "it took like 2-3 min to
// load and it's not snappy like the view profile button"):
//
//   - one of the day's profile views, in the scanner's own record
//     (linkedin-activity.json "profiles", chargeProfileView), so it counts
//     against the same daily limit as the views a scan makes;
//   - the history, <data folder>/outlink-opened.json:
//     { "opened": [{ id, name, url, at }] }, oldest first, `at` in epoch
//     milliseconds, the newest OUTLINK_KEPT kept.

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

/** The scanner's record of searches, profile views and Auto's requests (scrape.py _read_activity). */
export const ACTIVITY_FILE = 'linkedin-activity.json';

/**
 * Write down one profile view made just now in the scanner's record: `now`
 * (epoch ms) added to its "profiles" list in epoch seconds, as scrape.py
 * charge_linkedin writes them, everything else in the file kept as it is.
 * True when it was written. A record that can't be read is left alone: the
 * scanner reads one as the day used up, which is the safe way round, and a
 * page's view never makes it readable again. Never throws.
 *
 * The scanner holds a lock around its own read and write; Node has none to
 * share, so a view written in the same instant as a scan's could be lost from
 * the count. The write itself is whole (durable.writeJsonDurably).
 */
export function chargeProfileView(dir, now = Date.now()) {
  const file = path.join(dir, ACTIVITY_FILE);
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') return false;
    data = { searches: [], profiles: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const profiles = data.profiles === undefined ? [] : data.profiles;
  if (!Array.isArray(profiles) || !profiles.every((t) => Number.isFinite(Number(t)))) return false;
  const at = (Number.isFinite(now) ? now : Date.now()) / 1000;
  try {
    durable.writeJsonDurably(file, { ...data, profiles: [...profiles, at] });
    return true;
  } catch {
    return false;
  }
}
