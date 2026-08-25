#!/usr/bin/env node
/**
 * Finishes the standalone build.
 *
 * `next build --output standalone` emits a server and its traced dependencies,
 * but deliberately leaves out the static assets and public files — it expects
 * the deployer to place them. When the deployment target is an npm package,
 * that deployer is this script.
 *
 * It runs as part of `npm run build` rather than before packing, because
 * `prepack` triggers a build that would wipe anything copied in beforehand —
 * which shipped a package whose CSS and JS all 404'd.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, '.next', 'standalone');

if (!existsSync(STANDALONE)) {
  console.log('  (no standalone output — nothing to prepare)');
  process.exit(0);
}

const copies = [
  { from: path.join(ROOT, '.next', 'static'), to: path.join(STANDALONE, '.next', 'static'), label: '.next/static' },
  { from: path.join(ROOT, 'public'), to: path.join(STANDALONE, 'public'), label: 'public' },
];

for (const { from, to, label } of copies) {
  if (!existsSync(from)) { console.log(`  skipped ${label} (not present)`); continue; }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`  copied ${label} into the standalone build`);
}

// Documentation images get traced in as a side effect and only add weight.
const docs = path.join(STANDALONE, 'docs');
if (existsSync(docs)) {
  rmSync(docs, { recursive: true, force: true });
  console.log('  dropped docs/ from the standalone build');
}
