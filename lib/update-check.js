// The daily update check: the work. Its decisions are in lib/update-notice.js.
//
// Once a day, while the app runs, the server asks GitHub for the newest
// release's version number, with the very request Settings → Updates → Check
// for updates makes (latestRelease, which app/api/update/route.js uses too):
// one path, so the two can never disagree about what "newer" means. Nothing
// about the user is sent, and nothing is downloaded. A newer version leaves one
// notification, never a second for the same version; Install and restart, or
// the instruction for this kind of install, is still a press in Settings →
// Updates.
//
// Only an installed copy checks: the Mac, Windows and Linux apps and the npm
// package. A git checkout updates with git, and is left alone.
//
// Started once per server by instrumentation.js. Never during tests, and never
// with SIX_DEGREES_NO_UPDATE_CHECK=1 (lib/update-notice.js autoCheckOff).
// Offline, or rate-limited by GitHub, it says nothing and tries again the next
// day: the time of the attempt is kept, not only of a check that worked.

import { getDb, newId } from './db-client.js';
import { readSettings } from './settings.js';
import { compareVersions, installKind, repoSlug } from './release.js';
import { releaseSource } from './updater.js';
import { isGitCheckout, projectRoot } from './paths.js';
import { resolveProfile } from './profile.js';
import { APP_VERSION } from './app-version.js';
import {
  LAST_CHECK_KEY, NOTIFIED_KEY, UPDATE_NOTE_TYPE,
  announcedVersion, autoCheckOff, checkDue, updateNotification,
} from './update-notice.js';
import pkg from '../package.json' with { type: 'json' };

/**
 * The newest release, as GitHub's releases/latest describes it: { version,
 * url, release }, or null when nothing is published yet. Throws on anything
 * else. `release` is GitHub's whole answer, for the Mac app's install check;
 * it is never sent to the page. `apiBase` is GitHub's API, or a test's server
 * on 127.0.0.1 (lib/updater.js releaseSource).
 */
export async function latestRelease(slug, apiBase, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${apiBase}/repos/${slug}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'six-degrees-update-check' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (res.status === 404) return null;           // nothing published yet
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const d = await res.json();
  return {
    version: String(d.tag_name || '').replace(/^v/i, ''),
    url: d.html_url || null,
    release: d,
  };
}

const readMeta = (db, key) => db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key)?.value ?? null;
const writeMeta = (db, key, value) => db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);

/**
 * Leave the notification for `note.data.version`, unless one for it (or for a
 * newer version) was left before. The version is recorded and the
 * notification written in one transaction, so neither happens without the
 * other, and a second copy of the app sharing the data can't add a second one.
 * @returns whether it was written.
 */
export function notifyOnce(db, note) {
  const version = note.data.version;
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = readMeta(db, NOTIFIED_KEY);
    if (before && compareVersions(version, before) <= 0) {
      db.exec('COMMIT');
      return false;
    }
    writeMeta(db, NOTIFIED_KEY, version);
    db.prepare(`INSERT INTO notifications (id, user_id, type, title, message, icon, seen, data)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)`).run(newId(), note.user_id, note.type, note.title, note.message, note.icon, JSON.stringify(note.data));
    db.exec('COMMIT');
    return true;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* nothing was begun */ }
    throw err;
  }
}

/**
 * One turn of the daily check: nothing when it's turned off or a day hasn't
 * passed, otherwise one request (`fetchLatest`) and, for a newer version, one
 * notification. Never throws for the network: a failure is returned as
 * `error` and the next try is a day later.
 * @returns {Promise<{ ran: boolean, reason?: string, error?: string, newer?: boolean, version?: string|null, notified?: boolean }>}
 */
export async function runUpdateCheck({ db, now = new Date(), currentVersion, kind = null, userId = null, fetchLatest }) {
  if (!readSettings(db).updateCheck) return { ran: false, reason: 'off' };
  // Something else holds the database in a transaction (an import, say): next hour.
  if (db.isTransaction) return { ran: false, reason: 'busy' };
  if (!checkDue(readMeta(db, LAST_CHECK_KEY), now)) return { ran: false, reason: 'not-due' };
  // Stamped before asking: offline, or GitHub's rate limit, waits a day like a check that worked.
  writeMeta(db, LAST_CHECK_KEY, now.toISOString());
  let latest;
  try {
    latest = await fetchLatest();
  } catch (err) {
    return { ran: true, error: err?.message || String(err) };
  }
  const version = announcedVersion(latest);
  if (!version || compareVersions(version, currentVersion) <= 0) return { ran: true, newer: false, version };
  return { ran: true, newer: true, version, notified: notifyOnce(db, updateNotification({ version, kind, userId })) };
}

/** The update notifications in the database, with the version each is about. */
function updateNotes(db) {
  return db.prepare('SELECT id, seen, data FROM notifications WHERE type = ?').all(UPDATE_NOTE_TYPE).map((row) => {
    let version = null;
    try { version = JSON.parse(row.data || '{}').version || null; } catch { /* no version: treated as old news */ }
    return { id: row.id, seen: Boolean(row.seen), version };
  });
}

/**
 * Count as read every update notification this copy has caught up with: the
 * version it names is installed now (or older), so its dot has nothing left to
 * say. `all` counts every one as read: someone has just checked by hand, so
 * they know.
 */
export function settleUpdateNotes(db, { currentVersion = APP_VERSION, all = false } = {}) {
  const done = updateNotes(db).filter((n) => !n.seen && (all || !n.version || compareVersions(n.version, currentVersion) <= 0));
  const mark = db.prepare('UPDATE notifications SET seen = 1 WHERE id = ?');
  for (const n of done) mark.run(n.id);
  return done.length;
}

/** The real app's turn of the check: this copy's version, kind, profile and release source. */
export async function checkForUpdateNow({ env = process.env, now = new Date(), fetchImpl } = {}) {
  const db = getDb();
  settleUpdateNotes(db);
  const slug = repoSlug(pkg.repository);
  if (!slug) return { ran: false, reason: 'no-slug' };
  const { apiBase } = releaseSource(env);
  let userId = null;
  try { userId = resolveProfile({ create: false })?.id || null; } catch { /* the gear's dot still shows it */ }
  const result = await runUpdateCheck({
    db,
    now,
    currentVersion: APP_VERSION,
    kind: installKind(env, projectRoot() || ''),
    userId,
    fetchLatest: () => latestRelease(slug, apiBase, { fetchImpl }),
  });
  // One line in the server's log, at most once a day; nothing on screen.
  if (result.error) console.log(`Sixgree: the daily update check didn't get an answer (tries again tomorrow): ${result.error}`);
  else if (result.notified) console.log(`Sixgree: ${result.version} is out (the daily update check).`);
  return result;
}

const SCHEDULER = Symbol.for('six-degrees.update-check');

/** The first check waits this long after the server starts, so the first page and the start's own work come first. */
export const FIRST_CHECK_DELAY_MS = 30 * 1000;

/**
 * How often the timer looks whether a day has passed. Hourly rather than once
 * every 24 hours: a timer doesn't count the time a laptop sleeps, so a daily
 * one could wait days. Each look reads two values from the database; only a
 * due one goes online, at most once in CHECK_EVERY_MS.
 */
export const TICK_MS = 60 * 60 * 1000;

/**
 * Start the daily check, once per server process (one globalThis per process,
 * whichever copy of this module the bundler hands out). The first look is
 * shortly after the start, then one an hour. The timers never keep the
 * process alive.
 * @returns {{ off: string|null, tick?: () => Promise<object|null>, stop?: () => void }}
 */
export function startUpdateChecks({ env = process.env, gitCheckout = isGitCheckout } = {}) {
  if (globalThis[SCHEDULER]) return globalThis[SCHEDULER];
  const off = autoCheckOff(env) || (gitCheckout() ? 'a git checkout updates with git' : null);
  if (off) {
    globalThis[SCHEDULER] = { off };
    return globalThis[SCHEDULER];
  }
  let running = null;
  const tick = () => {
    running ??= checkForUpdateNow({ env })
      .catch((err) => {
        console.log(`Sixgree: the daily update check stopped (tries again later): ${err.message}`);
        return null;
      })
      .finally(() => { running = null; });
    return running;
  };
  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS);
  const every = setInterval(tick, TICK_MS);
  first.unref?.();
  every.unref?.();
  globalThis[SCHEDULER] = {
    off: null,
    tick,
    stop() {
      clearTimeout(first);
      clearInterval(every);
      delete globalThis[SCHEDULER];
    },
  };
  return globalThis[SCHEDULER];
}
