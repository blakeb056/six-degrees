// Settings → Plugins, the page's side: what it asks /api/plugins, and the few
// facts the page and the server share (lib/plugins.js and lib/plugin-catalog.js
// do the work). No Node imports, so the page can use it. The guided setup's
// plugin cards ask the same.

import { compareVersions } from './release.js';

/**
 * The largest package an install accepts. Plugin packages are a few hundred
 * kilobytes. Next copies each request's body into memory for middleware.js,
 * up to 10 MB, and past that quietly keeps only the first 10 MB
 * (docs/brain/ENDPOINTS.md, "Request bodies over 10 MB"), so the cap stays
 * well under it and the page sends the size it means to send (SIZE_HEADER).
 */
export const MAX_PLUGIN_BYTES = 8 * 1024 * 1024;

/** The package's size as the page read it: a body that arrives shorter was cut on the way. */
export const SIZE_HEADER = 'X-Six-Degrees-Size';

/**
 * The yes: the checksum (SHA-256) of the package the person saw and agreed to
 * install, as the check answered it. An install without it, or of a package
 * with any other checksum, installs nothing.
 */
export const CONFIRM_HEADER = 'X-Six-Degrees-Plugin-Sha256';

/** Said beside every install's yes. */
export const PLUGIN_TRUST_LINE = 'A plugin runs its own code on this computer, with the same access as Sixgree.';

/** Said when the plugin list can't be had, above why and a Try again. */
export const CATALOG_UNLOADED = 'The plugin list couldn’t be loaded.';

/** Said beside the yes for a package from a link: nothing but the package vouches for it. */
export const LINK_CHECK_LINE = 'A link has no checksum from the plugin list to match, so the only check is the package’s own: every file must match the checksum its manifest lists.';

/** Said beside the yes for a package from the plugin list. */
export const LIST_CHECK_LINE = 'It matches the size and checksum the plugin list gives for it.';

async function answer(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || fallback), { data, status: res.status });
  return data;
}

/** { enabled, plugins, scanner }: whether plugins are on, what is installed, and which scanner scans use. */
export async function fetchPlugins() {
  return answer(await fetch('/api/plugins'), 'The plugins couldn’t be read.');
}

/** Enable plugins, on or off. Answers as fetchPlugins does. */
export async function savePluginsEnabled(enabled) {
  return answer(await fetch('/api/plugins/enabled', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
  }), 'Not saved.');
}

function sendPackage(file, extra = {}, query = '') {
  return fetch(`/api/plugins/install${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', [SIZE_HEADER]: String(file.size), ...extra },
    body: file,
  });
}

/** What a package is, checked through, with nothing installed: { plugin, sha256, replaces }. */
export async function checkPackage(file) {
  return answer(await sendPackage(file, {}, '?check=1'), 'The package couldn’t be checked.');
}

/** Install the package the person said yes to, by the checksum its check answered. */
export async function installPackage(file, sha256) {
  return answer(await sendPackage(file, { [CONFIRM_HEADER]: sha256 }), 'The plugin couldn’t be installed.');
}

/**
 * The plugin list, fetched by the server on this call and only on one:
 * { source, plugins, dropped }. Fails with CATALOG_UNLOADED, and why in
 * `error.data.detail`.
 */
export async function fetchCatalog() {
  return answer(await fetch('/api/plugins/catalog', { method: 'POST' }), CATALOG_UNLOADED);
}

/**
 * Download a package and check it, with nothing installed: `{ id }` from the
 * plugin list, or `{ url }` from a link. → { plugin, sha256, replaces, from }.
 */
export async function downloadPlugin(from) {
  return answer(await fetch('/api/plugins/download?check=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(from),
  }), 'The plugin couldn’t be downloaded.');
}

/** Install the downloaded package the person said yes to, by the checksum its check answered. */
export async function installDownloaded(sha256) {
  return answer(await fetch('/api/plugins/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [CONFIRM_HEADER]: sha256 }, body: '{}',
  }), 'The plugin couldn’t be installed.');
}

/**
 * What a plugin list card offers, given what is installed: 'install',
 * 'update' (the list has a newer version), 'reinstall' (the copy here is
 * broken), 'installed', or null when it is not for this version.
 */
export function catalogAction(entry, installed = []) {
  if (!entry || entry.problem) return null;
  const have = (installed || []).find((p) => p.id === entry.id);
  if (!have) return 'install';
  if (have.state === 'broken') return 'reinstall';
  return compareVersions(entry.version, have.version) > 0 ? 'update' : 'installed';
}

/** Remove an installed plugin, by its id. */
export async function removePlugin(id) {
  return answer(await fetch('/api/plugins/uninstall', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  }), 'The plugin couldn’t be removed.');
}

/**
 * A plugin list card's Install, up to its yes (settings/PluginBrowse.js): the
 * click that goes online. Plugins turned on first when they're off (`enabled`
 * false), since Install is the yes to that too; the live list fetched now,
 * which wins over the copy shipped with the app (lib/plugins-shipped.js); this
 * entry checked in it; then the package downloaded and checked, nothing
 * installed. → { offer, list, view, turnedOn }: `offer` is the checked
 * package ({ plugin, sha256, replaces, from }), `list` the live list, `view`
 * GET /api/plugins's answer when plugins were turned on (else null). On a
 * failure the error carries `turnedOn`, so the caller can put plugins back off.
 * `api` is these functions, replaced in tests.
 */
export async function cardInstall(entry, { enabled = true, api = { savePluginsEnabled, fetchCatalog, downloadPlugin } } = {}) {
  let turnedOn = false;
  let view = null;
  try {
    if (!enabled) {
      view = await api.savePluginsEnabled(true);
      turnedOn = true;
    }
    let list;
    try {
      list = await api.fetchCatalog();
    } catch (e) {
      throw new Error(`${CATALOG_UNLOADED}${e.data?.detail ? ` ${e.data.detail}` : ''}`);
    }
    const live = (list?.plugins || []).find((p) => p.id === entry.id);
    if (!live) throw new Error(`${entry.name} isn’t on the plugin list now, so it can’t be installed.`);
    if (live.problem) throw new Error(live.problem);
    const offer = await api.downloadPlugin({ id: entry.id });
    return { offer, list, view, turnedOn };
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { turnedOn, view });
  }
}

/**
 * Which state a plugin list card is in, from usePluginInstall's own
 * (settings/PluginBrowse.js), which every card draws inside itself:
 *   'downloading'  its Install was pressed: the list, then the package, being fetched and checked
 *   'confirm'      the checked package waits for its yes, here in the card
 *   'installing'   the yes was given
 *   'idle'         anything else: Install, Update, Reinstall or Installed
 * `error` is what went wrong for this card, if anything did.
 */
export function cardState(install, id) {
  const offerHere = install?.offer?.at === 'browse' && install.offer.id === id;
  const note = install?.note?.at === 'browse' && install.note.id === id ? install.note : null;
  const error = note?.tone === 'bad' ? note.text : null;
  if (install?.busy === `get:${id}`) return { state: 'downloading', error: null };
  if (offerHere && install.busy === 'install') return { state: 'installing', error: null };
  if (offerHere) return { state: 'confirm', error };
  return { state: 'idle', error };
}
