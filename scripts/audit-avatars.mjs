#!/usr/bin/env node
// Find people wearing somebody else's face.
//
// The bridge scraper builds its name->URL map keyed by the anchor's TEXT, first
// one wins. Two results sharing display text therefore collapse onto one URL —
// and "LinkedIn Member" is the anchor text for every out-of-network person in a
// 2nd-degree search, so a run can attribute one person's photo to many rows.
//
// Read-only by default. --fix clears the shared photos so those people fall
// back to their initials, which is honest; a wrong face is worse than none.
// Nothing is re-scraped and no row is deleted.

import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

const apply = process.argv.includes('--fix');
const dir = process.env.SIX_DEGREES_HOME || path.join(homedir(), '.six-degrees');
const file = process.env.SIX_DEGREES_DB || path.join(dir, 'six-degrees.sqlite');

if (!existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}

const db = new DatabaseSync(file);

const shared = db.prepare(`
  SELECT profile_image_url AS img, COUNT(*) AS n, COUNT(DISTINCT profile_url) AS people
  FROM linkedin_connections
  WHERE profile_image_url IS NOT NULL AND profile_image_url <> ''
  GROUP BY profile_image_url
  HAVING people > 1
  ORDER BY people DESC
`).all();

const total = db.prepare(
  `SELECT COUNT(*) AS n FROM linkedin_connections WHERE profile_image_url IS NOT NULL AND profile_image_url <> ''`
).get().n;

const affected = shared.reduce((s, r) => s + r.n, 0);

console.log(`\n  Database: ${file}`);
console.log(`  People with a photo: ${total}`);
console.log(`  Photos used by more than one person: ${shared.length}`);
console.log(`  People affected: ${affected}\n`);

if (shared.length === 0) {
  console.log('  Nothing shared. Every photo belongs to one person.\n');
  process.exit(0);
}

for (const row of shared.slice(0, 10)) {
  const who = db.prepare(`
    SELECT name, degree FROM linkedin_connections
    WHERE profile_image_url = ? ORDER BY degree, name LIMIT 5
  `).all(row.img);
  const names = who.map((w) => `${w.name} (d${w.degree})`).join(', ');
  console.log(`  ${String(row.people).padStart(4)} people share ${path.basename(row.img)}`);
  console.log(`       ${names}${row.people > 5 ? ' …' : ''}`);
}
if (shared.length > 10) console.log(`\n  …and ${shared.length - 10} more shared photos`);

if (!apply) {
  console.log(`\n  Read-only. Re-run with --fix to clear these ${affected} photos.`);
  console.log('  They will show initials instead. No rows are deleted, nothing is re-scraped.\n');
  process.exit(0);
}

const stmt = db.prepare(
  `UPDATE linkedin_connections SET profile_image_url = NULL WHERE profile_image_url = ?`
);
let cleared = 0;
for (const row of shared) cleared += stmt.run(row.img).changes;
console.log(`\n  Cleared ${cleared} wrong photos. Those people now show initials.\n`);
