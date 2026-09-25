#!/usr/bin/env node
// A pretend GitHub release, served on 127.0.0.1, for testing the Mac app's
// in-app update without GitHub: tests/updater-job.test.mjs, a browser check of
// Settings → Updates, and a CI step that updates one build to the next.
//
//   node scripts/test-release-server.mjs --dir DIR [--version X.Y.Z] [--port 3303]
//
// It serves every .dmg in DIR as that version's release assets, with a
// SHA256SUMS made from them, the way release.yml publishes a release:
//
//   GET /repos/<owner/repo>/releases/latest                 the release, as GitHub describes it
//   GET /<owner/repo>/releases/download/v<version>/<name>   an asset
//
// Point the app at it with SIX_DEGREES_TEST_RELEASES=<the address it prints>.
// The app honours that only for a 127.0.0.1 address (lib/updater.js
// releaseSource). It is never set by the app, and nothing here ships in it.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Start the server. `release` (also settable later with setRelease) is:
 *   version   '0.2.2'
 *   assets    [{ name, data: Buffer } | { name, file: path }]
 *   sums      the SHA256SUMS text; computed from the assets when left out, and
 *             null for a release published without one
 *   stall     an asset name: send half of it, then nothing (a dead connection)
 *   prerelease, draft, tag   as GitHub would say them
 * Every request is recorded in `requests` (method and path).
 */
export async function startTestReleaseServer({ slug, port = 0, release = null } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug))) throw new Error(`Not an owner/repo: ${slug}`);
  let current = release;
  const requests = [];
  const open = new Set();

  const bytesOf = (asset) => (asset.data ? asset.data : fs.readFileSync(asset.file));
  const sizeOf = (asset) => (asset.data ? asset.data.length : fs.statSync(asset.file).size);
  const sumsOf = (r) => {
    if (r.sums === null) return null;
    if (typeof r.sums === 'string') return r.sums;
    return r.assets.map((a) => `${createHash('sha256').update(bytesOf(a)).digest('hex')}  ${a.name}`).join('\n') + '\n';
  };
  const tagOf = (r) => r.tag || `v${r.version}`;

  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const r = current;
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (!r) return send(404, JSON.stringify({ message: 'Not Found' }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const base = `${origin}/${slug}/releases/download/${encodeURIComponent(tagOf(r))}/`;
    const sums = sumsOf(r);

    if (url.pathname === `/repos/${slug}/releases/latest`) {
      const assets = r.assets.map((a) => ({ name: a.name, size: sizeOf(a), browser_download_url: base + encodeURIComponent(a.name) }));
      if (sums !== null) assets.push({ name: 'SHA256SUMS', size: Buffer.byteLength(sums), browser_download_url: `${base}SHA256SUMS` });
      return send(200, JSON.stringify({
        tag_name: tagOf(r),
        html_url: `${origin}/${slug}/releases/tag/${encodeURIComponent(tagOf(r))}`,
        draft: Boolean(r.draft),
        prerelease: Boolean(r.prerelease),
        assets,
      }));
    }
    const prefix = `/${slug}/releases/download/${encodeURIComponent(tagOf(r))}/`;
    if (url.pathname.startsWith(prefix)) {
      const name = decodeURIComponent(url.pathname.slice(prefix.length));
      if (name === 'SHA256SUMS' && sums !== null) return send(200, sums, 'text/plain');
      const asset = r.assets.find((a) => a.name === name);
      if (!asset) return send(404, 'Not Found', 'text/plain');
      const body = bytesOf(asset);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
      if (r.stall === name) {
        res.write(body.subarray(0, Math.floor(body.length / 2)));  // then nothing, until the client gives up
        return undefined;
      }
      return res.end(body);
    }
    return send(404, JSON.stringify({ message: 'Not Found' }));
  });
  server.on('connection', (socket) => { open.add(socket); socket.on('close', () => open.delete(socket)); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);   // this computer only, never another address
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    setRelease(next) { current = next; },
    close() {
      for (const socket of open) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ── from the command line ──
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg('dir');
  if (!dir) {
    console.error('Usage: node scripts/test-release-server.mjs --dir DIR [--version X.Y.Z] [--port 3303]');
    process.exit(2);
  }
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.dmg')).sort();
  const version = arg('version') || names.map((n) => n.match(/^Six-Degrees-(\d+(?:\.\d+)+)-(?:arm64|x64)\.dmg$/)?.[1]).find(Boolean);
  if (!names.length || !version) {
    console.error(`No Six-Degrees-<version>-<chip>.dmg in ${dir} (or pass --version).`);
    process.exit(2);
  }
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const slug = String(pkg.repository?.url || '').match(/github\.com[/:]([^/]+\/[^/.#?]+)/)?.[1];
  const served = await startTestReleaseServer({
    slug,
    port: Number(arg('port') || 0),
    release: { version, assets: names.map((name) => ({ name, file: path.join(dir, name) })) },
  });
  console.log(`A pretend release ${version} of ${slug}: ${names.join(', ')}, SHA256SUMS`);
  console.log(`SIX_DEGREES_TEST_RELEASES=${served.origin}`);
  const stop = () => served.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
