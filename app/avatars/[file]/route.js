import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../../../lib/db-client';

// Avatars are captured by the scraper and live in the user's data directory,
// never inside the app package — an installed copy must not write into its own
// files, and real faces must never end up in the repo. Rows store the path
// `/avatars/<name>.webp`, so this route resolves that to ~/.six-degrees/avatars.

export async function GET(_request, { params }) {
  const { file } = await params;

  // Serve only a plain filename from that one directory.
  if (!/^[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/.test(file)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(dataDir(), 'avatars', file));
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
    return new Response(bytes, {
      headers: {
        'Content-Type': type,
        // Content-addressed filenames, so they can be cached indefinitely.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    // Missing avatar: the UI already falls back to tier-colored initials.
    return new Response('Not found', { status: 404 });
  }
}
