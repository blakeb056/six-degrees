// Settings → Plugins, the page's side: what it asks /api/plugins, and the few
// facts the page and the server share (lib/plugins.js does the work). No Node
// imports, so the page can use it.

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

/** Remove an installed plugin, by its id. */
export async function removePlugin(id) {
  return answer(await fetch('/api/plugins/uninstall', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  }), 'The plugin couldn’t be removed.');
}
