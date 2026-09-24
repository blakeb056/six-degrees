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
  // `git pull` into the app bundle. Logs carry local paths and are never needed.
  outputFileTracingExcludes: {
    '*': ['dist/*.app/**', 'dist/*.dmg', 'dist/staging/**', 'docs/**', 'tests/**',
          '.git/**', '*.log', 'scripts/dmg/**'],
  },
  // Emits .next/standalone with a server and only the dependencies actually
  // reached, so the published package can run without node_modules being
  // installed alongside it.
  output: 'standalone',

  // node:sqlite is a built-in, but bundling would rewrite the import; leave it
  // to be required at runtime.
  serverExternalPackages: ['node:sqlite'],
};

export default nextConfig;
