/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never trace build artefacts into the standalone bundle. Without this a
  // dist/ from a previous packaging run is copied inside the next one.
  //
  // These globs must be specific. Next matches them with picomatch in
  // `contains` mode, so a bare 'dist/**' also matches
  // node_modules/next/dist/** and can strip Next's own server runtime out of
  // the bundle. The page still renders and every API route returns 500, which
  // is a miserable thing to debug in a packaged app. Name the artefacts.
  //
  // The whole project folder gets traced (lib/paths.js looks around the working
  // directory for the scraper), so anything sitting in it rides along unless it
  // is named here. `.git` above all: inside the Mac app it made the installed
  // copy look like a checkout, so its Updates panel would have tried to
  // `git pull` into the app bundle. In a git worktree `.git` is a file, not a
  // folder, which '.git/**' doesn't match, so both are named. Logs carry local
  // paths and are never needed.
  //
  // The desktop shell (desktop/) and Electron itself are packed around the
  // server, never inside it: Electron alone is ~250 MB.
  outputFileTracingExcludes: {
    '*': ['dist/*.app/**', 'dist/*.dmg', 'dist/staging/**', 'dist/electron-stage/**', 'docs/**', 'tests/**',
          '.git', '.git/**', '*.log', 'scripts/dmg/**', 'desktop/**',
          'node_modules/electron/**', 'node_modules/@electron/**'],
  },
  // Emits .next/standalone with a server and only the dependencies actually
  // reached, so the published package can run without node_modules being
  // installed alongside it.
  output: 'standalone',

  // node:sqlite is a built-in, but bundling would rewrite the import; leave it
  // to be required at runtime.
  serverExternalPackages: ['node:sqlite'],

  experimental: {
    // middleware.js makes Next buffer every /api request body so both it and the
    // route can read it, and past 10 MB it keeps only the first 10 MB, with a
    // console warning and no error. An import (Settings → Your data) is one
    // file of about 5-25 MB, so it would arrive cut short. This is the most an
    // import accepts (MAX_IMPORT_BYTES in lib/data-import.js); the route also
    // compares what arrived with the size the page declared. Only a body this
    // big costs this much memory; everything else is a few KB.
    proxyClientMaxBodySize: '512mb',
  },
};

export default nextConfig;
