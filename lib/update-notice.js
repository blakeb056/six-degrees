// The daily update check's decisions, with no side effects (the work is
// lib/update-check.js). Plain functions and constants, so the Settings page,
// the header and tests/update-check.test.mjs can all use them.
//
// Blake, 2026-10-14: "a notification if there's a new update for the user to
// update if possible", on by default, with a switch to turn it off. Once a day,
// while Sixgree runs, it asks GitHub for the newest release's version number:
// the same one request as Settings → Updates → Check for updates. A newer
// version leaves one notification, once per version. Nothing is ever
// downloaded by it; Install and restart stays a press of its own. This is the
// one exception spec invariant 2 makes to "nothing checks by itself".
//
// The plugins ride along (Blake, 2026-10-14: "there hasn't been a update
// button added yet for the plugins so make sure that is done"): with plugins on
// and one installed, the same daily turn also reads the plugin list (the GET
// Settings → Plugins makes, lib/plugin-catalog.js readCatalog), and a newer
// version of an installed plugin leaves one notification, once per plugin
// version. Its Update is a press in Settings → Plugins.

import { catalogAction } from './plugins-client.js';

/** Settings → Updates → "Check for updates once a day": on until it's turned off. */
export const UPDATE_CHECK_SETTING = {
  default: true,
  parse(value) {
    if (typeof value !== 'boolean') throw new Error('Check for updates once a day is either on or off.');
    return value;
  },
};

/** At most one check in this long. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/** Where the check keeps its state, in app_meta: when it last asked, and the last version it told you about. */
export const LAST_CHECK_KEY = 'update_check_at';
export const NOTIFIED_KEY = 'update_notified_version';

/** The notification's type, so the bell and the header can tell it from the scan ones. */
export const UPDATE_NOTE_TYPE = 'update_available';

/**
 * Why the automatic check mustn't run in this process, or null when it may.
 * Never during tests (node --test marks every process it starts with
 * NODE_TEST_CONTEXT, which the servers they start inherit), never in the
 * release smoke test, and never when SIX_DEGREES_NO_UPDATE_CHECK=1 says so.
 */
export function autoCheckOff(env = {}) {
  if (env.SIX_DEGREES_NO_UPDATE_CHECK === '1') return 'SIX_DEGREES_NO_UPDATE_CHECK=1';
  if (env.NODE_TEST_CONTEXT) return 'running under node --test';
  if (env.NODE_ENV === 'test') return 'NODE_ENV=test';
  if (env.SIX_DEGREES_SMOKE === '1') return 'the smoke test';
  return null;
}

/**
 * Has a day passed since the last check? Yes when there was none, when it
 * can't be read, and when it is in the future (the clock was moved back: a
 * check stamped "tomorrow" mustn't hold the next one off for days).
 */
export function checkDue(lastAt, now = new Date()) {
  const last = Date.parse(lastAt);
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(last) || last > at) return true;
  return at - last >= CHECK_EVERY_MS;
}

/**
 * The version a release offers, or null when it isn't one to tell anyone
 * about: a draft, a pre-release (a tag with a hyphen is one, release.yml), or a
 * tag that isn't plain numbers. releases/latest never returns a pre-release;
 * checked here as well, so a beta is never announced whatever GitHub answers.
 */
export function announcedVersion(latest) {
  if (!latest || typeof latest !== 'object') return null;
  const release = latest.release || {};
  if (release.draft || release.prerelease) return null;
  const version = String(latest.version || '').replace(/^v/i, '');
  return /^\d+(\.\d+){1,3}$/.test(version) ? version : null;
}

// What to do next, by how this copy was installed (lib/release.js installKind).
const HOW = {
  'mac-app': 'Install it from Settings → Updates.',
  'windows-app': 'Settings → Updates links to its installer.',
  'linux-app': 'Settings → Updates links to its installer.',
};

/**
 * The one notification for a newer version. Its message is what to do, not a
 * line from the release notes: those start with how to download each build
 * (release.yml), which says nothing about what changed.
 */
export function updateNotification({ version, kind = null, userId = null }) {
  return {
    user_id: userId || null,
    type: UPDATE_NOTE_TYPE,
    title: `Sixgree ${version} is out`,
    message: HOW[kind] || 'Settings → Updates shows how to update.',
    icon: '⬆️',
    data: { version },
  };
}

// ── the plugins ──

/** A plugin's notification type: the bell opens Settings → Plugins for it. */
export const PLUGIN_NOTE_TYPE = 'plugin_update_available';

/** Where the last plugin version told about is kept, in app_meta, one key per plugin. */
export function pluginNotifiedKey(id) {
  return `plugin_update_notified:${id}`;
}

/**
 * The installed plugins the plugin list has a newer version of: { id, name,
 * version, installed } each, `version` the list's and `installed` this
 * computer's. One the list has a problem with (not for this Sixgree) or whose
 * copy here is broken isn't one: the card says those (catalogAction).
 */
export function pluginUpdates(entries = [], installed = []) {
  return (entries || [])
    .filter((entry) => catalogAction(entry, installed) === 'update')
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      installed: installed.find((p) => p.id === entry.id).version,
    }));
}

/** The one notification for a newer version of an installed plugin. */
export function pluginUpdateNotification({ id, name, version, userId = null }) {
  return {
    user_id: userId || null,
    type: PLUGIN_NOTE_TYPE,
    title: `${name} ${version} is out`,
    message: 'Update it in Settings → Plugins.',
    icon: '🧩',
    data: { plugin: id, version },
  };
}

// ── the page's side ──

/** The address that opens Settings → Updates and runs its check (the same as the Mac app's menu). */
export const UPDATES_HREF = '/settings?check=updates';

/** Sent on the window to ask Settings → Updates to check, when the page is already open. */
export const CHECK_UPDATES_EVENT = 'sixgree:check-updates';

/** Sent once a check has been made, so the bell and the gear can drop their update dot. */
export const UPDATE_NOTES_SEEN_EVENT = 'sixgree:update-notes-seen';

/**
 * Open Settings → Updates and check, from the bell or the gear. On the
 * Settings page already, a new address wouldn't run the check (the panel runs
 * it once, when it appears), so the panel is asked directly.
 */
export function openUpdates(router) {
  if (typeof window !== 'undefined' && window.location.pathname === '/settings') {
    window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
    return;
  }
  router.push(UPDATES_HREF);
}

/** The address that opens Settings → Plugins, whose Browse reads the plugin list when it comes into view. */
export const PLUGINS_HREF = '/settings#plugins';

/** Sent on the window to ask Settings → Plugins to check the plugin list again, when the page is already open. */
export const CHECK_PLUGINS_EVENT = 'sixgree:check-plugins';

/** Open Settings → Plugins from a plugin's notification: on the Settings page already, it scrolls there and checks again. */
export function openPlugins(router) {
  if (typeof window !== 'undefined' && window.location.pathname === '/settings') {
    window.dispatchEvent(new Event(CHECK_PLUGINS_EVENT));
    return;
  }
  router.push(PLUGINS_HREF);
}
