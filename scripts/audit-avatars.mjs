#!/usr/bin/env node
// Find people wearing somebody else's face.
//
// Two things had to be true before this worked:
//
//  1. The bridge scraper matched people by the TEXT of their link, and every
//     out-of-network person shows as "LinkedIn Member" — so they all inherited
//     the first one's profile and photograph.
//  2. Avatars are saved as sha1(profile_url).webp — named after the PERSON, not
//     the picture. One photo handed to fifty people therefore becomes fifty
//     separate files with identical bytes, and LinkedIn signs every image URL
//     with a unique token, so comparing URLs finds nothing at all.
//
// So compare the pictures. Group by the hash of the file contents.
//
// Read-only by default. --fix clears the database references so those people
// fall back to their initials; --prune also deletes the duplicate image files.
// Nothing is re-scraped and no person is deleted. A wrong face is worse than
// no face, and this needs no LinkedIn access — which is the point when the
// account is rate-limited.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const apply = process.argv.includes('--fix') || process.argv.includes('--prune');
const prune = process.argv.includes('--prune');

const dir = process.env.SIX_DEGREES_HOME || path.join(homedir(), '.six-degrees');
const file = process.env.SIX_DEGREES_DB || path.join(dir, 'six-degrees.sqlite');
const avatarDir = path.join(dir, 'avatars');

if (!existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}

const db = new DatabaseSync(file);
const rows = db.prepare(`
  SELECT id, name, degree, profile_image_url AS img
  FROM linkedin_connections
  WHERE profile_image_url IS NOT NULL AND profile_image_url <> ''
`).all();

// Group by what the picture actually is, not by what it is called.
const byContent = new Map();
const unreadable = [];
for (const r of rows) {
  let key;
  if (r.img.startsWith('/avatars/')) {
    const f = path.join(avatarDir, path.basename(r.img));
    if (!existsSync(f)) { unreadable.push(r); continue; }
    try {
      key = `sha:${createHash('sha256').update(readFileSync(f)).digest('hex')}`;
    } catch { unreadable.push(r); continue; }
  } else {
    // Not captured locally yet. Signed URLs differ per fetch, so this only
    // catches the exact-duplicate case — the local files are the real signal.
    key = `url:${r.img}`;
  }
  if (!byContent.has(key)) byContent.set(key, []);
  byContent.get(key).push(r);
}

const dupes = [...byContent.entries()]
  .filter(([, people]) => people.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

const affected = dupes.reduce((s, [, p]) => s + p.length, 0);

console.log(`\n  Database:  ${file}`);
console.log(`  Avatars:   ${avatarDir}`);
const local = rows.filter((r) => r.img.startsWith('/avatars/')).length;
const remote = rows.length - local;
const byDegree = {};
for (const r of rows) byDegree[r.degree] = (byDegree[r.degree] || 0) + 1;
console.log(`  People with a photo: ${rows.length}` +
  `  (${local} captured locally, ${remote} still remote)`);
console.log(`  By degree: ` + Object.entries(byDegree).map(([d, n]) => `d${d}=${n}`).join('  '));
if (remote > 0) {
  // Remote LinkedIn URLs carry a per-request signature, so two copies of the
  // same picture never look alike. Only captured files can be compared.
  console.log(`  Note: the ${remote} remote ones cannot be compared by content —`);
  console.log('        only exact URL matches show up for those.');
}
if (unreadable.length) console.log(`  Photos missing from disk: ${unreadable.length}`);
console.log(`  Distinct pictures shared by more than one person: ${dupes.length}`);
console.log(`  People wearing a shared picture: ${affected}\n`);

if (dupes.length === 0) {
  console.log('  Every picture belongs to exactly one person.\n');
  process.exit(0);
}

for (const [, people] of dupes.slice(0, 12)) {
  const names = people.slice(0, 4).map((p) => `${p.name} (d${p.degree})`).join(', ');
  console.log(`  ${String(people.length).padStart(4)} people share one picture`);
  console.log(`       ${names}${people.length > 4 ? ` … +${people.length - 4} more` : ''}`);
}
if (dupes.length > 12) console.log(`\n  …and ${dupes.length - 12} more shared pictures`);

if (!apply) {
  console.log(`\n  Read-only. --fix clears these ${affected} photos so those people show`);
  console.log('  initials. --prune also deletes the duplicate image files.');
  console.log('  No person is deleted and nothing is re-scraped.\n');
  process.exit(0);
}

// We cannot tell which of the group the picture truly belongs to, so none of
// them keeps it. Guessing would leave one person confidently mislabelled.
const clear = db.prepare('UPDATE linkedin_connections SET profile_image_url = NULL WHERE id = ?');
let cleared = 0;
let deleted = 0;
const seenFiles = new Set();
for (const [, people] of dupes) {
  for (const p of people) {
    cleared += clear.run(p.id).changes;
    if (prune && p.img.startsWith('/avatars/')) {
      const f = path.join(avatarDir, path.basename(p.img));
      if (!seenFiles.has(f) && existsSync(f)) {
        try { unlinkSync(f); deleted += 1; } catch { /* leave it */ }
        seenFiles.add(f);
      }
    }
  }
}

console.log(`\n  Cleared ${cleared} photos — those people now show initials.`);
if (prune) console.log(`  Deleted ${deleted} duplicate image files.`);
console.log('  Re-run without flags to confirm.\n');
