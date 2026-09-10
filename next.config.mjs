/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never trace build artefacts into the standalone bundle. Without this a
  // dist/ from a previous packaging run is copied inside the next one.
  outputFileTracingExcludes: {
    '*': ['dist/**', '.git/**', 'docs/**', 'tests/**'],
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
