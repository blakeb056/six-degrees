// Invented plugin packages, for the tests of the installer (lib/plugins.js),
// its routes (app/api/plugins) and the scanner lookup (lib/scanner-files.js),
// and invented plugin lists with a server on 127.0.0.1 to serve them
// (lib/plugin-catalog.js). Not a test file itself: `npm test` runs tests/*.test.mjs.
//
// The scanner in them is a stand-in whose scrape.py stops at once if a real
// Python ever runs it, as tests/helpers/scanner.mjs standInRoot's does.

import { createHash } from 'node:crypto';
import { writeZip } from '../../lib/zip-write.js';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** A stand-in scanner's files, as a scanner plugin holds them. */
export const STAND_IN_SCANNER = Object.freeze({
  'scanner/scrape.py': 'raise SystemExit("a stand-in: never a real scan")\n',
  'scanner/image_store.py': '# a stand-in\n',
  'scanner/requirements.txt': '# a stand-in: nothing to install\n',
});

/**
 * A package: manifest.json (filled in from `manifest`, with every file's
 * checksum) and `files`, plus `extra` entries the manifest doesn't know about.
 * `manifest` may override anything, files included; `rawManifest` replaces it whole.
 * @returns {{ zip: Buffer, sha256: string, manifest: object }}
 */
export function makePackage({ files = STAND_IN_SCANNER, manifest = {}, extra = [], rawManifest } = {}) {
  const list = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  const m = rawManifest ?? {
    format: 'sixgree.plugin',
    format_version: 1,
    id: 'manual-scan',
    name: 'Manual scan',
    version: '1.0.0',
    sixgree: '>=1.0.0',
    about: 'An invented scanner, for tests.',
    risk: 'An invented risk note.',
    kind: 'scanner',
    unlocks: ['manual'],
    files: Object.fromEntries(list.map((f) => [f.name, sha256(f.data)])),
    ...manifest,
  };
  const zip = writeZip([{ name: 'manifest.json', data: typeof m === 'string' ? m : JSON.stringify(m, null, 2) }, ...list, ...extra]);
  return { zip, sha256: sha256(zip), manifest: m };
}

/**
 * A server on 127.0.0.1 only, for the plugin list and its downloads: never the
 * real internet. `routes` maps a path to what it answers: a Buffer or string
 * (200), { status, body, headers }, or a function (req, res) that answers
 * itself. Anything else is 404. Every request is kept, with its headers.
 * @returns {Promise<{ base: string, requests: { path: string, headers: object }[], routes: object, close(): Promise<void> }>}
 */
export async function pluginServer(routes = {}) {
  const { createServer } = await import('node:http');
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url, headers: { ...req.headers } });
    const route = routes[req.url];
    if (typeof route === 'function') return route(req, res);
    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    const answer = Buffer.isBuffer(route) || typeof route === 'string' ? { body: route } : route;
    res.writeHead(answer.status || 200, answer.headers || {});
    return res.end(answer.body ?? '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    routes,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** A plugin list (lib/plugin-catalog.js) naming `pkgs` ({ pkg, url, ...entry overrides }). */
export function makeCatalog(items, top = {}) {
  return {
    format: 'sixgree.plugin-catalog',
    format_version: 1,
    plugins: items.map(({ pkg, url, ...over }) => ({
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      about: pkg.manifest.about,
      risk: pkg.manifest.risk,
      kind: pkg.manifest.kind,
      unlocks: pkg.manifest.unlocks,
      sixgree: pkg.manifest.sixgree,
      url,
      sha256: pkg.sha256,
      size: pkg.zip.length,
      ...over,
    })),
    ...top,
  };
}
