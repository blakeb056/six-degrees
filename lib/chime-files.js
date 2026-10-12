// The chimes (lib/chimes.js) as files in the data folder, for the scanner to
// play (scripts/scrape.py _chime): <data folder>/sounds/<name>.wav, and
// sounds/version saying which CHIME_VERSION wrote them. Written before a scan
// starts (app/api/scraper/route.js), and again only when they're missing or the
// sounds have changed. A sound that can't be written is no reason to stop a
// scan, so this never throws.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHIME_NAMES, CHIME_VERSION, chimeWav } from './chimes.js';

/** Write the chimes into `dir`/sounds if they're missing or old. True when it wrote them. */
export function ensureChimes(dir) {
  try {
    const folder = path.join(dir, 'sounds');
    const stamp = path.join(folder, 'version');
    const current = existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === String(CHIME_VERSION)
      && CHIME_NAMES.every((name) => existsSync(path.join(folder, `${name}.wav`)));
    if (current) return false;
    mkdirSync(folder, { recursive: true });
    for (const name of CHIME_NAMES) {
      const file = path.join(folder, `${name}.wav`);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, chimeWav(name));
      renameSync(tmp, file);
    }
    writeFileSync(stamp, String(CHIME_VERSION));
    return true;
  } catch {
    return false;
  }
}
