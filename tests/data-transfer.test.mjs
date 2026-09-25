// Moving a network to another computer (Settings → Your data): the export
// file, the checks an import must pass, and the swap at the next start. Each
// case pins a promise the feature makes about someone's whole network, above
// all that the LinkedIn sign-in never leaves the computer and that nothing is
// replaced before a copy of it is kept. Every person here is invented.

import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync,
  symlinkSync, rmSync, utimesSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { SCHEMA_SQL } from '../db/schema.js';

// Nothing here touches the real data folder, whatever the environment says.
const scratch = mkdtempSync(path.join(tmpdir(), 'six-degrees-transfer-'));
process.env.SIX_DEGREES_HOME = path.join(scratch, 'unused-home');
process.env.SIX_DEGREES_DB = path.join(scratch, 'unused-home', 'unused.sqlite');

let applySchema, backupOnNewVersion;
let buildExport, exportFileName, countPeople, appTables;
let validateImport, stageImport, applyPendingImport, pendingImport, cancelPendingImport;
let importPreflight, receiveUpload, ImportError, restartCodeFrom, restartAdvice, lastImport, recordImport;
let admitImport, keptCopyMatches, vacuumCopy, MAX_IMPORT_BYTES, travellingFiles, referencedPhotos, linkedinState, durable;
let folderReport, sweepLeftovers, revealFolder, folderOpener, UPLOAD_WORK_PREFIX, EXPORT_WORK_PREFIX;

before(async () => {
  ({ applySchema, backupOnNewVersion } = await import('../lib/db-client.js'));
  ({ buildExport, exportFileName, countPeople, appTables, travellingFiles, referencedPhotos } = await import('../lib/data-export.js'));
  ({
    validateImport, stageImport, applyPendingImport, pendingImport, cancelPendingImport,
    importPreflight, receiveUpload, ImportError, restartCodeFrom, restartAdvice, lastImport, recordImport,
    admitImport, keptCopyMatches, vacuumCopy, MAX_IMPORT_BYTES,
  } = await import('../lib/data-import.js'));
  ({ linkedinState } = await import('../lib/linkedin-limits.js'));
  ({ durable } = await import('../lib/durable.js'));
  ({
    folderReport, sweepLeftovers, revealFolder, folderOpener, UPLOAD_WORK_PREFIX, EXPORT_WORK_PREFIX,
  } = await import('../lib/data-folder.js'));
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
});

const VERSION = '0.2.1';
const folder = (tag) => mkdtempSync(path.join(scratch, `${tag}-`));
const dbIn = (dir) => path.join(dir, 'six-degrees.sqlite');

/** A network of invented people, as the app would have written it. The handle is left open. */
function seedNetwork(dir, { people = 3, tag = 'a' } = {}) {
  const db = new DatabaseSync(dbIn(dir));
  applySchema(db);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(`${tag}-me`, 'You');
  const add = db.prepare(`INSERT INTO linkedin_connections
    (id, degree, name, headline, company, profile_url, profile_image_url, user_id, tier, power_score)
    VALUES (?, 1, ?, ?, 'Northwind Labs', ?, ?, ?, 'B', 4.5)`);
  for (let i = 0; i < people; i++) {
    add.run(`${tag}-${i}`, `Invented Person ${tag}${i}`, 'Engineer at Northwind Labs',
      `https://www.linkedin.com/in/invented-${tag}-${i}`, `/avatars/${tag}${i}photo.webp`, `${tag}-me`);
  }
  db.prepare("INSERT INTO company_scores (id, name, score) VALUES (?, 'Northwind Labs', 8)").run(`${tag}-score`);
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('scoring_version', '2')").run();
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('settings', ?)").run(JSON.stringify({ from: tag }));
  return db;
}

/** The scanner's files and photos, plus everything that must never travel, each with a marker. */
function seedFiles(dir, { tag = 'a', photos = 2 } = {}) {
  mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  for (let i = 0; i < photos; i++) writeFileSync(path.join(dir, 'avatars', `${tag}${i}photo.webp`), `RIFF-${tag}-${i}-webp-bytes`);
  writeFileSync(path.join(dir, 'bridge-progress.json'), JSON.stringify({ [`${tag}-me`]: { 'https://www.linkedin.com/in/x': { pages: 3, more: true } } }));
  writeFileSync(path.join(dir, 'bridge-skips.json'), JSON.stringify({ [`https://www.linkedin.com/in/hidden-${tag}`]: { name: 'Hidden', reason: 'private' } }));
  writeFileSync(path.join(dir, 'scan-limits.json'), JSON.stringify({ daily: 25, monthly: 100, tag }));
  writeFileSync(path.join(dir, 'linkedin-activity.json'), JSON.stringify({ searches: [1700000000], profiles: [] }));

  // Never in an export.
  mkdirSync(path.join(dir, 'chrome-profile', 'Default'), { recursive: true });
  writeFileSync(path.join(dir, 'chrome-profile', 'Default', 'Cookies'), 'MARKER-CHROME-PROFILE-SESSION');
  mkdirSync(path.join(dir, 'venv', 'bin'), { recursive: true });
  writeFileSync(path.join(dir, 'venv', 'bin', 'python'), 'MARKER-VENV');
  // The Python "Set up the scanner" downloads: built for this computer, like venv/.
  mkdirSync(path.join(dir, 'python', 'bin'), { recursive: true });
  writeFileSync(path.join(dir, 'python', 'bin', 'python3'), 'MARKER-OWN-PYTHON');
  mkdirSync(path.join(dir, 'backups'), { recursive: true });
  writeFileSync(path.join(dir, 'backups', 'mine.sqlite'), 'MARKER-BACKUP');
  mkdirSync(path.join(dir, 'pushback'), { recursive: true });
  writeFileSync(path.join(dir, 'pushback', '2026-09-01.txt'), 'MARKER-PUSHBACK');
  writeFileSync(path.join(dir, 'app-version'), `${VERSION}\n`);
  writeFileSync(path.join(dir, '.linkedin-activity.lock'), 'MARKER-LOCK');
  writeFileSync(path.join(dir, 'scan-limits.json.1234.99.tmp'), 'MARKER-TMP');
  writeFileSync(path.join(dir, 'linkedin-activity.json.corrupt-1700000000'), 'MARKER-CORRUPT');
  writeFileSync(path.join(dir, 'notes.txt'), 'MARKER-STRAY');
  writeFileSync(path.join(dir, 'avatars', 'not a photo.txt'), 'MARKER-NOT-A-PHOTO');
}

/** Export a folder's network to a file outside it. */
function exportOf(dir, db, { includePhotos = true, appVersion = VERSION } = {}) {
  const out = path.join(folder('export-out'), exportFileName(new Date(2026, 8, 25)));
  const made = buildExport(db, { dir, outFile: out, includePhotos, appVersion, schemaSql: SCHEMA_SQL, now: new Date('2026-09-25T10:00:00Z') });
  return { out, made };
}

const manifestOf = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare('SELECT key, value FROM sd_export_manifest').all().map((r) => [r.key, r.value]));
  } finally { db.close(); }
};
const pathsIn = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT path FROM sd_export_files ORDER BY path').all().map((r) => r.path); } finally { db.close(); }
};

/** A copy of an export changed by some SQL, to stand for a damaged or hostile file. */
function tampered(file, sql, run) {
  const copy = path.join(folder('tampered'), 'x.sixdegrees');
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  if (sql) db.exec(sql);
  if (run) run(db);
  db.close();
  return copy;
}

/** Make a changed file's manifest agree with what it now holds, as a careful forger would. */
function recount(db) {
  const counts = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sd_export_%'").all()) {
    counts[name] = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n;
  }
  db.prepare("UPDATE sd_export_manifest SET value = ? WHERE key = 'counts'").run(JSON.stringify(counts));
  const files = db.prepare('SELECT count(*) AS n FROM sd_export_files').get().n;
  db.prepare("UPDATE sd_export_manifest SET value = ? WHERE key = 'files'").run(String(files));
}

const checks = { applySchema: (db) => applySchema(db), schemaSql: SCHEMA_SQL, appVersion: VERSION };
const refusedWith = (pattern) => (err) => err instanceof ImportError && pattern.test(err.message);

/** An uploaded file, where the import route leaves it: alone in its own working folder inside the data folder. */
function uploadInto(dir, file) {
  const work = mkdtempSync(path.join(dir, UPLOAD_WORK_PREFIX));
  const upload = path.join(work, 'upload.sixdegrees');
  copyFileSync(file, upload);
  return upload;
}

// ── the export ───────────────────────────────────────────────────────────────

test('an export carries the network, its photos and the scanner’s files, and nothing else', () => {
  const dir = folder('export');
  const db = seedNetwork(dir, { people: 5 });
  seedFiles(dir);
  const { out, made } = exportOf(dir, db);
  db.close();

  assert.deepEqual(pathsIn(out), [
    'avatars/a0photo.webp', 'avatars/a1photo.webp',
    'bridge-progress.json', 'bridge-skips.json', 'linkedin-activity.json', 'scan-limits.json',
  ]);
  // Not a name in a table, not a byte anywhere in the file.
  const raw = readFileSync(out);
  for (const marker of ['MARKER-CHROME-PROFILE-SESSION', 'MARKER-VENV', 'MARKER-OWN-PYTHON', 'MARKER-BACKUP', 'MARKER-PUSHBACK',
    'MARKER-LOCK', 'MARKER-TMP', 'MARKER-CORRUPT', 'MARKER-STRAY', 'MARKER-NOT-A-PHOTO']) {
    assert.equal(raw.includes(marker), false, `${marker} must never be in an export`);
  }
  assert.equal(raw.includes('chrome-profile'), false);
  assert.deepEqual({ people: made.people, photos: made.photos, files: made.files }, { people: 5, photos: 2, files: 6 });
});

test('the manifest says what the file is, from which version, and how many of each thing', () => {
  const dir = folder('manifest');
  const db = seedNetwork(dir, { people: 4 });
  seedFiles(dir);
  const { out } = exportOf(dir, db);
  db.close();

  const m = manifestOf(out);
  assert.equal(m.format, '1');
  assert.equal(m.app_version, VERSION);
  assert.equal(m.scoring_version, '2');
  assert.equal(m.exported_at, '2026-09-25T10:00:00.000Z');
  assert.equal(m.include_photos, '1');
  assert.equal(m.people, '4');
  assert.equal(m.photos, '2');
  const counts = JSON.parse(m.counts);
  assert.deepEqual(Object.keys(counts).sort(), appTables(SCHEMA_SQL).sort());
  assert.equal(counts.linkedin_connections, 4);
  assert.equal(counts.users, 1);
  assert.equal(counts.company_scores, 1);

  // One self-contained file: a whole database with no -wal to be forgotten beside it.
  const x = new DatabaseSync(out, { readOnly: true });
  assert.equal(x.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  assert.equal(x.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  x.close();
  assert.equal(existsSync(`${out}-wal`), false);
});

test('photos can be left out; the scanner’s files still travel', () => {
  const dir = folder('nophotos');
  const db = seedNetwork(dir);
  seedFiles(dir);
  const { out, made } = exportOf(dir, db, { includePhotos: false });
  db.close();
  assert.equal(pathsIn(out).some((p) => p.startsWith('avatars/')), false);
  assert.ok(pathsIn(out).includes('bridge-progress.json'));
  const m = manifestOf(out);
  assert.equal(m.include_photos, '0');
  assert.equal(m.photos, '0');
  assert.equal(made.photos, 0);
});

test('without photos, the copy’s rows stop pointing at photo files the other computer won’t have', () => {
  const dir = folder('nophoto-paths');
  const db = seedNetwork(dir, { people: 3 });
  // A photo the scanner hasn't saved yet is still LinkedIn's own (expiring) link.
  db.prepare("UPDATE linkedin_connections SET profile_image_url = 'https://media.licdn.com/dms/image/invented' WHERE id = 'a-2'").run();
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_import', '{\"people\":1}')").run();
  seedFiles(dir);
  const { out: without } = exportOf(dir, db, { includePhotos: false });
  const { out: withPhotos } = exportOf(dir, db);
  db.close();

  const images = (file) => {
    const x = new DatabaseSync(file, { readOnly: true });
    try { return x.prepare('SELECT profile_image_url AS img FROM linkedin_connections ORDER BY id').all().map((r) => r.img); } finally { x.close(); }
  };
  assert.deepEqual(images(without), [null, null, 'https://media.licdn.com/dms/image/invented']);
  assert.deepEqual(images(withPhotos), ['/avatars/a0photo.webp', '/avatars/a1photo.webp', 'https://media.licdn.com/dms/image/invented']);
  assert.deepEqual(images(dbIn(dir)), images(withPhotos), 'the network here is untouched');
  assert.equal(validateImport(without, checks).people, 3);

  // Which import this computer last finished is its own history; the other computer writes its own.
  for (const file of [without, withPhotos]) {
    const x = new DatabaseSync(file, { readOnly: true });
    assert.equal(x.prepare("SELECT count(*) AS n FROM app_meta WHERE key = 'last_import'").get().n, 0);
    assert.equal(x.prepare("SELECT count(*) AS n FROM app_meta WHERE key = 'settings'").get().n, 1, 'settings do travel');
    x.close();
  }
});

test('a link in the data folder is never followed out of it', () => {
  const dir = folder('links');
  const db = seedNetwork(dir);
  seedFiles(dir);
  const outside = path.join(folder('outside'), 'secret.json');
  writeFileSync(outside, JSON.stringify({ secret: 'MARKER-OUTSIDE' }));
  rmSync(path.join(dir, 'bridge-skips.json'));
  symlinkSync(outside, path.join(dir, 'bridge-skips.json'));
  symlinkSync(outside, path.join(dir, 'avatars', 'linked.webp'));
  const { out } = exportOf(dir, db);
  db.close();
  assert.equal(pathsIn(out).includes('bridge-skips.json'), false);
  assert.equal(pathsIn(out).includes('avatars/linked.webp'), false);
  assert.equal(readFileSync(out).includes('MARKER-OUTSIDE'), false);
});

test('the file name carries this computer’s date', () => {
  assert.equal(exportFileName(new Date(2026, 8, 5, 23, 30)), 'Six Degrees backup 2026-09-05.sixdegrees');
});

// ── what an import refuses ───────────────────────────────────────────────────

function goodExport(tag = 'b', people = 3) {
  const dir = folder(`src-${tag}`);
  const db = seedNetwork(dir, { people, tag });
  seedFiles(dir, { tag });
  const { out } = exportOf(dir, db);
  db.close();
  return out;
}

test('a good export passes every check', () => {
  const info = validateImport(goodExport('b', 3), checks);
  assert.equal(info.people, 3);
  assert.equal(info.photos, 2);
  assert.equal(info.files, 4);
  assert.equal(info.fromVersion, VERSION);
});

test('a file that is not a database is refused', () => {
  const file = path.join(folder('notdb'), 'x.sixdegrees');
  writeFileSync(file, 'first name,last name\nInvented,Person\n'.repeat(20));
  assert.throws(() => validateImport(file, checks), refusedWith(/isn't a Six Degrees export/));
  const tiny = path.join(folder('tiny'), 'x.sixdegrees');
  writeFileSync(tiny, 'SQLite format 3\0');
  assert.throws(() => validateImport(tiny, checks), refusedWith(/isn't a Six Degrees export/));
});

test('a plain database (a backup, a copied six-degrees.sqlite) is refused as not an export', () => {
  const dir = folder('plain');
  const db = seedNetwork(dir);
  const copy = path.join(folder('plain-copy'), 'x.sixdegrees');
  db.exec(`VACUUM INTO '${copy}'`);
  db.close();
  assert.throws(() => validateImport(copy, checks), refusedWith(/not a Six Degrees export/));
});

test('a damaged file is refused by SQLite’s own check', () => {
  const good = goodExport('d', 300);
  const copy = path.join(folder('damaged'), 'x.sixdegrees');
  copyFileSync(good, copy);
  const probe = new DatabaseSync(copy, { readOnly: true });
  const root = probe.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'linkedin_connections'").get().rootpage;
  const pageSize = probe.prepare('PRAGMA page_size').get().page_size;
  probe.close();
  const bytes = readFileSync(copy);
  bytes[(root - 1) * pageSize] = 0x7f; // not a b-tree page type
  writeFileSync(copy, bytes);
  assert.throws(() => validateImport(copy, checks), refusedWith(/damaged/));
});

test('a trigger, a view or a table an export never has is refused', () => {
  const good = goodExport();
  const cases = [
    ["CREATE TRIGGER sneaky AFTER INSERT ON users BEGIN DELETE FROM linkedin_connections; END;", /the trigger “sneaky”/],
    ['CREATE VIEW everyone AS SELECT * FROM linkedin_connections;', /the view “everyone”/],
    ['CREATE TABLE extra (x TEXT);', /the table “extra”/],
    ['CREATE INDEX idx_extra ON users(name);', /the index “idx_extra”/],
  ];
  for (const [sql, pattern] of cases) {
    assert.throws(() => validateImport(tampered(good, sql), checks), refusedWith(pattern), sql);
  }
});

test('a table laid out differently from the app’s is refused', () => {
  assert.throws(() => validateImport(tampered(goodExport(), 'ALTER TABLE users ADD COLUMN evil TEXT;'), checks),
    refusedWith(/“users” table isn't laid out/));
});

test('a table that only looks like the app’s is refused: virtual, WITHOUT ROWID, or with a hidden column', () => {
  const good = goodExport();
  const cases = [
    // A module of its own answers for a virtual table, whatever it is called.
    ['DROP TABLE users; CREATE VIRTUAL TABLE users USING fts5(id, name);', /the virtual table “users”/],
    ['DROP TABLE app_meta; CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;', /“app_meta” table isn't laid out/],
    // table_info doesn't list a generated column; table_xinfo does.
    [`DROP TABLE user_stats; CREATE TABLE user_stats (id TEXT PRIMARY KEY, xp INTEGER, level INTEGER, streak_weeks INTEGER,
      last_scrape_at TEXT, last_active_at TEXT, created_at TEXT, extra TEXT GENERATED ALWAYS AS (upper(id)) VIRTUAL);`,
    /“user_stats” table isn't laid out/],
  ];
  for (const [sql, pattern] of cases) {
    assert.throws(() => validateImport(tampered(good, sql, recount), checks), refusedWith(pattern), sql);
  }
});

test('a file changed since it was exported (rows or files added or taken out) is refused', async () => {
  const good = goodExport('b', 3);
  assert.throws(() => validateImport(tampered(good, "DELETE FROM linkedin_connections WHERE id = 'b-0';"), checks),
    refusedWith(/“linkedin_connections” table doesn't match its own export details \(2 rows, where they say 3\)/));
  assert.throws(() => validateImport(tampered(good, 'DROP TABLE company_scores;'), checks),
    refusedWith(/“company_scores” table doesn't match its own export details \(no table, where they say 1\)/));
  const { sha256 } = await import('../lib/data-export.js');
  const photo = Buffer.from('RIFF-added-later-webp');
  const added = tampered(good, null, (db) => {
    db.prepare('INSERT INTO sd_export_files (path, bytes, sha256) VALUES (?, ?, ?)').run('avatars/added.webp', photo, sha256(photo));
  });
  assert.throws(() => validateImport(added, checks), refusedWith(/list of files doesn't match its own export details \(7 files, where they say 6\)/));
  assert.throws(() => validateImport(tampered(good, "UPDATE sd_export_manifest SET value = 'lots' WHERE key = 'counts';"), checks),
    refusedWith(/export details aren't ones Six Degrees writes/));
});

test('an export from before a table or a column was added still imports, and what it lacks starts empty', () => {
  // As an older version would have written it: no user_profile table, no
  // score_why column, and counts that never name the missing table.
  const file = tampered(goodExport('o', 2), 'DROP TABLE user_profile; ALTER TABLE linkedin_connections DROP COLUMN score_why;', recount);
  assert.equal(validateImport(file, checks).people, 2);
  const here = folder('older');
  stageImport(uploadInto(here, file), { dir: here, ...checks });
  applyPendingImport({ dir: here, dbFile: dbIn(here) });
  const db = new DatabaseSync(dbIn(here), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_profile').get().n, 0);
  assert.deepEqual(db.prepare('SELECT id, score_why FROM linkedin_connections ORDER BY id').all().map((r) => ({ ...r })),
    [{ id: 'o-0', score_why: null }, { id: 'o-1', score_why: null }]);
  db.close();

  // But never without the network itself.
  const empty = tampered(goodExport('p', 2), 'DROP TABLE linkedin_connections;', recount);
  assert.throws(() => validateImport(empty, checks), refusedWith(/has no “linkedin_connections” table/));
});

test('a strange file SQLite itself can’t make sense of is still a plain refusal', () => {
  // A header that says SQLite, then noise: whatever SQLite trips on first.
  const file = path.join(folder('noise'), 'x.sixdegrees');
  const bytes = Buffer.alloc(8192, 0x5a);
  Buffer.from('SQLite format 3\0', 'latin1').copy(bytes);
  writeFileSync(file, bytes);
  assert.throws(() => validateImport(file, checks), (err) => err instanceof ImportError);
});

test('an unknown format, or a file from a newer version, is refused with what to do', () => {
  const good = goodExport();
  assert.throws(() => validateImport(tampered(good, "UPDATE sd_export_manifest SET value = '2' WHERE key = 'format';"), checks),
    refusedWith(/newer Six Degrees than this copy. Update this copy first/));
  assert.throws(() => validateImport(tampered(good, "UPDATE sd_export_manifest SET value = 'zip' WHERE key = 'format';"), checks),
    refusedWith(/aren't ones Six Degrees writes/));
  assert.throws(() => validateImport(tampered(good, "UPDATE sd_export_manifest SET value = '9.9.9' WHERE key = 'app_version';"), checks),
    refusedWith(/comes from Six Degrees 9\.9\.9, which is newer than this copy \(0\.2\.1\)\. Update this copy first/));
  assert.throws(() => validateImport(tampered(good, "DELETE FROM sd_export_manifest WHERE key = 'app_version';"), checks),
    refusedWith(/doesn't say which version/));
  // Older is fine: the schema step and the rescore bring it up to date.
  assert.equal(validateImport(tampered(good, "UPDATE sd_export_manifest SET value = '0.1.9' WHERE key = 'app_version';"), checks).fromVersion, '0.1.9');
});

test('a file whose bytes don’t match their checksum is refused', () => {
  const bad = tampered(goodExport(), "UPDATE sd_export_files SET bytes = CAST('changed' AS BLOB) WHERE path = 'avatars/b0photo.webp';");
  assert.throws(() => validateImport(bad, checks), refusedWith(/“avatars\/b0photo\.webp” inside this file is damaged/));
});

test('a scanner file that is not a JSON object is refused', async () => {
  const { sha256 } = await import('../lib/data-export.js');
  for (const text of ['not json at all', '[1, 2, 3]', '42']) {
    const bad = tampered(goodExport(), null, (db) => {
      const bytes = Buffer.from(text);
      db.prepare("UPDATE sd_export_files SET bytes = ?, sha256 = ? WHERE path = 'bridge-skips.json'").run(bytes, sha256(bytes));
    });
    assert.throws(() => validateImport(bad, checks), refusedWith(/“bridge-skips\.json” inside this file can't be read/), text);
  }
});

test('a name that could climb out of the data folder, or that an export never carries, is refused', async () => {
  const { sha256 } = await import('../lib/data-export.js');
  const bytes = Buffer.from('{}');
  for (const name of ['../escape.json', 'avatars/../../escape.webp', 'avatars/sub/x.webp', 'avatars/.hidden.webp',
    '/etc/passwd', 'chrome-profile/Default/Cookies', 'venv/bin/python', 'six-degrees.sqlite', 'app-version', 'avatars/x.svg']) {
    const bad = tampered(goodExport(), null, (db) => {
      db.prepare('INSERT INTO sd_export_files (path, bytes, sha256) VALUES (?, ?, ?)').run(name, bytes, sha256(bytes));
    });
    assert.throws(() => validateImport(bad, checks), refusedWith(/which an export never includes/), name);
  }
});

// ── before the file: may an import start at all ─────────────────────────────

test('an import is refused during a scan, beside another import, too big, or without a yes naming the count', () => {
  const ok = { scanRunning: false, pending: null, declared: 1000, currentPeople: 0 };
  assert.equal(importPreflight(ok), null);
  const scan = importPreflight({ ...ok, scanRunning: true });
  assert.equal(scan.status, 409);
  assert.match(scan.message, /A scan is running/);
  assert.equal(importPreflight({ ...ok, pending: { people: 3 } }).status, 409);
  assert.equal(importPreflight({ ...ok, declared: Number.NaN }).status, 400);
  assert.equal(importPreflight({ ...ok, declared: 0 }).status, 400);
  const big = importPreflight({ ...ok, declared: 300 * 1024 * 1024 });
  assert.equal(big.status, 413);
  assert.match(big.message, /300 MB\. This copy can import files up to 256 MB/);

  const unconfirmed = importPreflight({ ...ok, currentPeople: 1234, confirmedPeople: Number.NaN });
  assert.equal(unconfirmed.status, 409);
  assert.deepEqual(unconfirmed.extra, { needsConfirm: true, people: 1234 });
  assert.match(unconfirmed.message, /already has 1,234 people/);
  // A yes to a count that has since changed (a scan added people) is asked again.
  assert.equal(importPreflight({ ...ok, currentPeople: 1240, confirmedPeople: 1234 }).extra.needsConfirm, true);
  assert.equal(importPreflight({ ...ok, currentPeople: 1234, confirmedPeople: 1234 }), null);
});

test('an upload must arrive exactly as big as it said it was', async () => {
  const dir = folder('upload');
  const bytes = new Uint8Array(5000).fill(7);
  const whole = path.join(dir, 'whole');
  assert.equal(await receiveUpload(new Blob([bytes]).stream(), whole, { declared: 5000 }), 5000);
  assert.deepEqual(new Uint8Array(readFileSync(whole)), bytes);

  // What the proxy does to a body over its limit: cuts it short, and says nothing.
  await assert.rejects(receiveUpload(new Blob([bytes.subarray(0, 4000)]).stream(), path.join(dir, 'short'), { declared: 5000 }),
    refusedWith(/didn't arrive whole \(4000 of 5000 bytes\)/));
  await assert.rejects(receiveUpload(new Blob([bytes]).stream(), path.join(dir, 'long'), { declared: 4000 }),
    refusedWith(/bigger than the size it was sent with/));
  await assert.rejects(receiveUpload(null, path.join(dir, 'empty'), { declared: 10 }), refusedWith(/0 of 10 bytes/));
});

// ── staging, then the swap at the next start ─────────────────────────────────

/** This computer: a network whose newest person is only in the WAL, as after a hard stop. */
function hardStoppedNetwork(tag = 'a', people = 3) {
  const live = folder(`live-${tag}`);
  const db = seedNetwork(live, { people, tag });
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.prepare(`INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id)
    VALUES ('${tag}-wal', 1, 'Invented Walker', 'https://www.linkedin.com/in/invented-walker', '${tag}-me')`).run();
  // Copied while the handle is still open, so the -wal is there and unmerged.
  const here = folder(`here-${tag}`);
  for (const f of readdirSync(live)) if (f.startsWith('six-degrees.sqlite')) copyFileSync(path.join(live, f), path.join(here, f));
  db.close();
  assert.ok(existsSync(`${dbIn(here)}-wal`), 'the test needs a -wal left behind');
  return here;
}

const namesIn = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT id FROM linkedin_connections ORDER BY id').all().map((r) => r.id); } finally { db.close(); }
};

test('an import is checked and staged without changing anything, then swapped in at the next start', () => {
  const file = goodExport('b', 3);
  const here = hardStoppedNetwork('a', 3);
  seedFiles(here, { tag: 'a' });
  const before = readFileSync(dbIn(here));

  const staged = stageImport(uploadInto(here, file), { dir: here, ...checks, replacedPeople: 4, now: new Date('2026-09-25T11:00:00Z') });
  assert.equal(staged.people, 3);
  assert.equal(staged.replacedPeople, 4);
  assert.deepEqual(pendingImport(here), { ...staged, started: false, error: null });
  // Nothing in the data folder has changed yet.
  assert.deepEqual(readFileSync(dbIn(here)), before);
  assert.ok(existsSync(path.join(here, 'avatars', 'a0photo.webp')));
  assert.equal(readdirSync(here).some((f) => f.startsWith(UPLOAD_WORK_PREFIX)), false, 'the upload folder became import-pending/');

  const done = applyPendingImport({ dir: here, dbFile: dbIn(here), now: new Date('2026-09-26T09:00:00Z') });
  assert.equal(done.people, 3);
  assert.equal(done.keptDatabase, 'backups/before-import-2026-09-26T09-00-00-000Z.sqlite');
  assert.equal(done.keptFiles, 'backups/before-import-2026-09-26T09-00-00-000Z-files');

  // The old -wal and -shm went with the old file: a stale WAL is never replayed into the new one.
  assert.equal(existsSync(`${dbIn(here)}-wal`), false);
  assert.equal(existsSync(`${dbIn(here)}-shm`), false);
  assert.deepEqual(namesIn(dbIn(here)), ['b-0', 'b-1', 'b-2']);

  // The copy kept first holds everything, including the person only the WAL had.
  assert.deepEqual(namesIn(path.join(here, done.keptDatabase)), ['a-0', 'a-1', 'a-2', 'a-wal']);
  const keptFiles = path.join(here, done.keptFiles);
  assert.ok(existsSync(path.join(keptFiles, 'avatars', 'a0photo.webp')));
  assert.ok(existsSync(path.join(keptFiles, 'bridge-progress.json')));
  assert.equal(JSON.parse(readFileSync(path.join(keptFiles, 'scan-limits.json'), 'utf8')).tag, 'a', 'a copy of the budget as it was');

  // The photos and the network's own files that came with it are in place.
  assert.deepEqual(readdirSync(path.join(here, 'avatars')).sort(), ['b0photo.webp', 'b1photo.webp']);
  assert.equal(readFileSync(path.join(here, 'avatars', 'b1photo.webp'), 'utf8'), 'RIFF-b-1-webp-bytes');
  assert.ok(readFileSync(path.join(here, 'bridge-progress.json'), 'utf8').includes('b-me'), 'the scanner’s notes about the new network');
  assert.ok(readFileSync(path.join(here, 'bridge-skips.json'), 'utf8').includes('hidden-b'));
  // The LinkedIn budget belongs to the account: this computer's limits stay.
  assert.equal(JSON.parse(readFileSync(path.join(here, 'scan-limits.json'), 'utf8')).tag, 'a');

  // What belongs to this computer is exactly where it was.
  assert.equal(readFileSync(path.join(here, 'chrome-profile', 'Default', 'Cookies'), 'utf8'), 'MARKER-CHROME-PROFILE-SESSION');
  assert.equal(readFileSync(path.join(here, 'venv', 'bin', 'python'), 'utf8'), 'MARKER-VENV');
  assert.equal(readFileSync(path.join(here, 'python', 'bin', 'python3'), 'utf8'), 'MARKER-OWN-PYTHON');
  assert.equal(readFileSync(path.join(here, 'app-version'), 'utf8'), `${VERSION}\n`);
  assert.ok(existsSync(path.join(here, 'backups', 'mine.sqlite')));

  assert.equal(pendingImport(here), null);
  assert.equal(existsSync(path.join(here, 'import-pending')), false);
  assert.equal(applyPendingImport({ dir: here, dbFile: dbIn(here) }), null, 'nothing left to do next time');
});

test('the imported network is rebuilt into this version’s own tables: only rows travel', () => {
  // An export whose company_scores was redefined elsewhere: same columns, other rules.
  const file = tampered(goodExport('c', 2), `
    DROP TABLE company_scores;
    CREATE TABLE company_scores (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL NOT NULL, updated_at TEXT);
    INSERT INTO company_scores VALUES ('c-score', 'Northwind Labs', 8, NULL);`);
  const here = folder('rebuilt');
  stageImport(uploadInto(here, file), { dir: here, ...checks });
  applyPendingImport({ dir: here, dbFile: dbIn(here) });

  const reference = new DatabaseSync(':memory:');
  applySchema(reference);
  const schemaOf = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((r) => ({ ...r }));
  const imported = new DatabaseSync(dbIn(here), { readOnly: true });
  assert.deepEqual(schemaOf(imported), schemaOf(reference));
  assert.equal(imported.prepare("SELECT score FROM company_scores WHERE name = 'Northwind Labs'").get().score, 8);
  assert.equal(JSON.parse(imported.prepare("SELECT value FROM app_meta WHERE key = 'settings'").get().value).from, 'c',
    'settings travel with the network');
  imported.close();
  reference.close();
});

test('rows that break this version’s rules are refused before anything changes', () => {
  // Two copies of the same person behind the same bridge: the unique index
  // forbids it. The manifest is made to agree, so only the rows are wrong.
  const file = tampered(goodExport('e', 2), `
    DROP INDEX idx_connections_unique_per_user_bridge;
    INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id)
      SELECT 'e-dupe', degree, name, profile_url, user_id FROM linkedin_connections WHERE id = 'e-0';`, recount);
  const here = folder('dupes');
  // The dropped index is fine to validate (fewer objects), but the rows can't be rebuilt.
  assert.throws(() => stageImport(uploadInto(here, file), { dir: here, ...checks }), refusedWith(/doesn't fit this copy's database/));
  assert.equal(pendingImport(here), null);
});

test('an import waiting can be cancelled, and then nothing happens at the next start', () => {
  const here = hardStoppedNetwork('f', 2);
  const before = namesIn(dbIn(here));
  stageImport(uploadInto(here, goodExport('g', 2)), { dir: here, ...checks });
  assert.deepEqual(cancelPendingImport(here), { cancelled: true });
  assert.equal(pendingImport(here), null);
  assert.equal(readdirSync(here).some((f) => f.startsWith('import-pending')), false);
  assert.equal(applyPendingImport({ dir: here, dbFile: dbIn(here) }), null);
  assert.deepEqual(namesIn(dbIn(here)), before);
  assert.deepEqual(cancelPendingImport(here), { cancelled: false, reason: 'none' });
});

test('a start that fails keeps the import waiting with its reason, changes nothing, and the next start finishes it', () => {
  const here = hardStoppedNetwork('h', 2);
  stageImport(uploadInto(here, goodExport('i', 2)), { dir: here, ...checks });
  writeFileSync(path.join(here, 'backups'), 'a file where the folder should be');

  assert.throws(() => applyPendingImport({ dir: here, dbFile: dbIn(here) }));
  const waiting = pendingImport(here);
  assert.ok(waiting.error, 'the reason is kept for the Settings page');
  assert.equal(waiting.started, false, 'nothing moved, so it can still be cancelled');
  assert.deepEqual(namesIn(dbIn(here)), ['h-0', 'h-1', 'h-wal']);

  rmSync(path.join(here, 'backups'));
  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.deepEqual(namesIn(dbIn(here)), ['i-0', 'i-1']);
  assert.deepEqual(namesIn(path.join(here, done.keptDatabase)), ['h-0', 'h-1', 'h-wal']);
});

test('a start that stopped part-way carries on from its last step, and can no longer be cancelled', () => {
  // The old network still has a -wal beside it (something opened it after the
  // copy was kept): it must go before the new file takes its place, or it
  // would be replayed into the new one.
  const here = hardStoppedNetwork('j', 2);
  stageImport(uploadInto(here, goodExport('k', 2)), { dir: here, ...checks });
  // As a start that died after keeping the old network and its files would leave it.
  const stamp = '2026-09-25T12-00-00-000Z';
  mkdirSync(path.join(here, 'backups'), { recursive: true });
  writeFileSync(path.join(here, 'backups', `before-import-${stamp}.sqlite`), 'kept by the start that died');
  writeFileSync(path.join(here, 'import-pending', 'APPLYING'), JSON.stringify({ stamp, phase: 'files-kept' }));

  assert.equal(pendingImport(here).started, true);
  assert.equal(cancelPendingImport(here).reason, 'started');

  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.deepEqual(namesIn(dbIn(here)), ['k-0', 'k-1']);
  const placed = new DatabaseSync(dbIn(here), { readOnly: true });
  assert.equal(placed.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  placed.close();
  assert.equal(done.keptDatabase, `backups/before-import-${stamp}.sqlite`);
  assert.deepEqual(readdirSync(path.join(here, 'backups')), [`before-import-${stamp}.sqlite`], 'no second copy was made');
  // What the start that died kept can't be trusted (it never checked it, and
  // it may not have reached the disk), so it was made again from the network
  // still in place before that was replaced.
  assert.deepEqual(namesIn(path.join(here, done.keptDatabase)), ['j-0', 'j-1', 'j-wal']);
});

test('a network here that can’t be read is kept exactly as it was, and the import still finishes', () => {
  // The import someone makes to recover from a damaged database must not wait
  // forever on a copy of that database that can never be made.
  const here = folder('damaged-here');
  writeFileSync(dbIn(here), 'this is not a database any more');
  writeFileSync(`${dbIn(here)}-wal`, 'a wal that belongs to it');
  stageImport(uploadInto(here, goodExport('q', 2)), { dir: here, ...checks });

  const done = applyPendingImport({ dir: here, dbFile: dbIn(here), now: new Date('2026-09-27T08:00:00Z') });
  // Checked before anything opens the new file (opening it makes a -wal of its own).
  assert.equal(existsSync(`${dbIn(here)}-wal`), false, 'nothing of the old one is left beside the new one');
  assert.deepEqual(namesIn(dbIn(here)), ['q-0', 'q-1']);
  assert.equal(done.keptDatabase, 'backups/before-import-2026-09-27T08-00-00-000Z.sqlite');
  assert.ok(done.keptAsIs, 'the page can say it was kept as it was');
  assert.equal(readFileSync(path.join(here, done.keptDatabase), 'utf8'), 'this is not a database any more');
  assert.equal(readFileSync(path.join(here, `${done.keptDatabase}-wal`), 'utf8'), 'a wal that belongs to it', 'its -wal kept beside it, under the same name');
  assert.equal(pendingImport(here), null);

  // A real database with one damaged page: SQLite opens it, but can't copy it.
  const torn = folder('torn-here');
  seedNetwork(torn, { people: 200, tag: 'r' }).close();
  const probe = new DatabaseSync(dbIn(torn), { readOnly: true });
  const root = probe.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'linkedin_connections'").get().rootpage;
  const pageSize = probe.prepare('PRAGMA page_size').get().page_size;
  probe.close();
  const bytes = readFileSync(dbIn(torn));
  bytes[(root - 1) * pageSize] = 0x7f; // not a b-tree page type
  writeFileSync(dbIn(torn), bytes);
  stageImport(uploadInto(torn, goodExport('s', 2)), { dir: torn, ...checks });
  const kept = applyPendingImport({ dir: torn, dbFile: dbIn(torn) });
  assert.match(kept.keptAsIs, /malformed|corrupt/i);
  assert.deepEqual(readFileSync(path.join(torn, kept.keptDatabase)), bytes, 'kept byte for byte');
  assert.deepEqual(namesIn(dbIn(torn)), ['s-0', 's-1']);
});

test('copies kept before an import are never pruned with the automatic ones', () => {
  const here = hardStoppedNetwork('l', 2);
  stageImport(uploadInto(here, goodExport('m', 2)), { dir: here, ...checks });
  const { keptDatabase } = applyPendingImport({ dir: here, dbFile: dbIn(here), now: new Date('2026-09-20T00:00:00Z') });
  const kept = path.join(here, keptDatabase);
  const old = new Date('2026-09-01T00:00:00Z');
  utimesSync(kept, old, old); // older than every automatic copy below
  const db = new DatabaseSync(dbIn(here));
  for (let i = 1; i <= 7; i++) backupOnNewVersion(db, { dir: here, version: `9.${i}.0`, now: new Date(Date.UTC(2026, 8, 24, 12, i)) });
  db.close();
  assert.ok(existsSync(kept));
});

test('the finished import is remembered for the Settings page', () => {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  assert.equal(lastImport(db), null);
  recordImport(db, { appliedAt: '2026-09-25T10:00:00.000Z', people: 3 });
  recordImport(db, { appliedAt: '2026-09-26T10:00:00.000Z', people: 5 });
  assert.deepEqual(lastImport(db), { appliedAt: '2026-09-26T10:00:00.000Z', people: 5 });
  db.close();
});

test('a network moves whole: export on one computer, import on another, export again, same file contents', () => {
  const src = folder('round-src');
  const db = seedNetwork(src, { people: 6, tag: 'n' });
  seedFiles(src, { tag: 'n', photos: 3 });
  const { out: first } = exportOf(src, db);
  db.close();

  const dst = folder('round-dst');
  stageImport(uploadInto(dst, first), { dir: dst, ...checks });
  applyPendingImport({ dir: dst, dbFile: dbIn(dst) });
  const again = new DatabaseSync(dbIn(dst));
  applySchema(again);
  const { out: second } = exportOf(dst, again);
  again.close();

  const filesOf = (file) => {
    const x = new DatabaseSync(file, { readOnly: true });
    try { return x.prepare('SELECT path, sha256 FROM sd_export_files ORDER BY path').all().map((r) => ({ ...r })); } finally { x.close(); }
  };
  const budget = new Set(['scan-limits.json', 'linkedin-activity.json', 'linkedin-cooldown.json']);
  const byteForByte = (file) => filesOf(file).filter((f) => !budget.has(f.path));
  assert.deepEqual(byteForByte(second), byteForByte(first));
  assert.deepEqual(filesOf(second).map((f) => f.path), filesOf(first).map((f) => f.path));
  // The budget files are merged into the new computer's (none there), so they
  // are written again: the same budget, in the app's own layout.
  const fileIn = (file, rel) => {
    const x = new DatabaseSync(file, { readOnly: true });
    try { return JSON.parse(Buffer.from(x.prepare('SELECT bytes FROM sd_export_files WHERE path = ?').get(rel).bytes).toString('utf8')); } finally { x.close(); }
  };
  assert.deepEqual(fileIn(second, 'scan-limits.json'), { daily: 25, monthly: 100 });
  assert.deepEqual(fileIn(second, 'linkedin-activity.json'), fileIn(first, 'linkedin-activity.json'));
  const counts = (file) => JSON.parse(manifestOf(file).counts);
  assert.deepEqual(counts(second), counts(first));
  const reopened = new DatabaseSync(second, { readOnly: true });
  assert.equal(countPeople(reopened), 6);
  reopened.close();
});

// ── the folder, as the Settings page shows it ───────────────────────────────

test('the folder report gives sizes and counts, and only says whether a LinkedIn sign-in is there', () => {
  const dir = folder('report');
  seedNetwork(dir, { people: 2 }).close();
  seedFiles(dir, { photos: 3 });
  mkdirSync(path.join(dir, 'backups', 'before-import-2026-09-25T10-00-00-000Z-files', 'avatars'), { recursive: true });
  writeFileSync(path.join(dir, 'backups', 'before-import-2026-09-25T10-00-00-000Z-files', 'avatars', 'x.webp'), '12345');
  writeFileSync(path.join(dir, 'backups', 'auto-before-0.2.1-2026.sqlite'), 'x'.repeat(10));
  writeFileSync(path.join(dir, 'backups', 'before-import-2026-09-25T10-00-00-000Z.sqlite.partial'), 'half');

  const r = folderReport({ dir, dbFile: dbIn(dir), autoPrefix: 'auto-before-' });
  assert.equal(r.photos.count, 3);
  assert.equal(r.photos.bytes, 3 * 'RIFF-a-0-webp-bytes'.length);
  assert.equal(r.databaseBytes, statSync(dbIn(dir)).size + (existsSync(`${dbIn(dir)}-wal`) ? statSync(`${dbIn(dir)}-wal`).size : 0)
    + (existsSync(`${dbIn(dir)}-shm`) ? statSync(`${dbIn(dir)}-shm`).size : 0));
  assert.equal(r.linkedinSignIn, true);
  const kinds = Object.fromEntries(r.backups.map((b) => [b.name, [b.kind, b.folder, b.bytes]]));
  assert.deepEqual(kinds, {
    'mine.sqlite': ['manual', false, 'MARKER-BACKUP'.length],
    'auto-before-0.2.1-2026.sqlite': ['auto', false, 10],
    'before-import-2026-09-25T10-00-00-000Z-files': ['import', true, 5],
  }, 'a half-written copy is not listed');
  assert.equal(JSON.stringify(r).includes('Cookies'), false);
});

test('working folders a dead run left behind are swept once they are an hour old', () => {
  const dir = folder('sweep');
  const now = Date.now();
  const old = new Date(now - 2 * 3600 * 1000);
  for (const name of [`${EXPORT_WORK_PREFIX}old`, `${UPLOAD_WORK_PREFIX}old`]) {
    mkdirSync(path.join(dir, name));
    utimesSync(path.join(dir, name), old, old);
  }
  for (const name of [`${EXPORT_WORK_PREFIX}new`, `${UPLOAD_WORK_PREFIX}new`, 'import-pending.done-x', 'import-pending.cancelled-1', 'import-pending', 'avatars']) {
    mkdirSync(path.join(dir, name));
  }
  assert.equal(sweepLeftovers(dir, { now }), 4);
  assert.deepEqual(readdirSync(dir).sort(), [`${EXPORT_WORK_PREFIX}new`, `${UPLOAD_WORK_PREFIX}new`, 'avatars', 'import-pending'].sort());
});

// ── showing the folder, and restarting to finish ─────────────────────────────

function fakeChild() {
  const handlers = {};
  return {
    on(name, fn) { handlers[name] = fn; return this; },
    unref() {},
    emit(name, value) { handlers[name]?.(value); },
  };
}

test('the folder opens with open on a Mac and xdg-open on Linux, with the fixed path and nothing else', async () => {
  assert.equal(folderOpener('darwin'), 'open');
  assert.equal(folderOpener('linux'), 'xdg-open');
  assert.equal(folderOpener('win32'), null);

  const calls = [];
  const spawnOk = (cmd, args) => { calls.push([cmd, ...args]); const c = fakeChild(); setTimeout(() => c.emit('exit', 0)); return c; };
  assert.deepEqual(await revealFolder('/data/dir', { platform: 'darwin', spawnImpl: spawnOk }), { ok: true });
  assert.deepEqual(calls, [['open', '/data/dir']]);

  const missing = (cmd) => { const c = fakeChild(); setTimeout(() => c.emit('error', Object.assign(new Error('spawn'), { code: 'ENOENT' }))); return c; };
  const noDesktop = await revealFolder('/data/dir', { platform: 'linux', spawnImpl: missing });
  assert.equal(noDesktop.ok, false);
  assert.match(noDesktop.message, /no xdg-open/);

  const fails = () => { const c = fakeChild(); setTimeout(() => c.emit('exit', 3)); return c; };
  assert.match((await revealFolder('/d', { platform: 'linux', spawnImpl: fails })).message, /stopped with code 3/);

  const stays = () => fakeChild(); // a file browser that keeps running
  assert.deepEqual(await revealFolder('/d', { platform: 'linux', spawnImpl: stays, waitMs: 10 }), { ok: true });
  assert.equal((await revealFolder('/d', { platform: 'win32' })).ok, false);
});

test('only a launcher that set a restart code can restart; the rest are told how', () => {
  assert.equal(restartCodeFrom({ SIX_DEGREES_RESTART_CODE: '75' }), 75);
  for (const bad of [undefined, '', '0', '1', 'x', '143', '7.5']) assert.equal(restartCodeFrom({ SIX_DEGREES_RESTART_CODE: bad }), null, String(bad));

  const mac = restartAdvice({ kind: 'mac-app', code: 75 });
  assert.equal(mac.canRestart, true);
  // Shown before anyone has clicked: it must not say a restart is under way.
  assert.match(mac.how, /^Click Restart now/);
  assert.doesNotMatch(mac.how, /^Six Degrees restarts/);
  const classic = restartAdvice({ kind: 'mac-app', code: null });
  assert.equal(classic.canRestart, false);
  assert.match(classic.how, /Quit Six Degrees \(⌘Q\) and open it again/);
  const npx = restartAdvice({ kind: 'npm', code: null, dataDir: "/Users/x/my data's" });
  assert.match(npx.how, /Ctrl-C/);
  assert.equal(npx.command, "npx six-degrees --data-dir '/Users/x/my data'\\''s'");
  assert.equal(restartAdvice({ kind: 'npm', code: null }).command, 'npx six-degrees');
  assert.equal(restartAdvice({ kind: 'source', code: null }).command, 'npm run start:packaged');
  assert.equal(restartAdvice({ kind: 'git', code: null }).canRestart, false);
});

// ── what the photos and files in an export are ───────────────────────────────

test('only the photos of people still in the network travel', () => {
  // A deleted circle takes its rows but leaves their photos in avatars/: those
  // people aren't in the copy, so their faces have no reason to be (review).
  const dir = folder('orphans');
  const db = seedNetwork(dir, { people: 2, tag: 'o' });
  seedFiles(dir, { tag: 'o', photos: 2 });
  for (let i = 0; i < 3; i++) writeFileSync(path.join(dir, 'avatars', `gone${i}.webp`), 'RIFF-DELETED-PERSON');
  const { out, made } = exportOf(dir, db);
  db.close();
  assert.deepEqual(pathsIn(out).filter((p) => p.startsWith('avatars/')), ['avatars/o0photo.webp', 'avatars/o1photo.webp']);
  assert.equal(made.photos, 2);
  assert.equal(manifestOf(out).photos, '2');
  assert.equal(readFileSync(out).includes('RIFF-DELETED-PERSON'), false);
  assert.equal(validateImport(out, checks).photos, 2, 'and the file still checks out');
  // What the Settings page says a copy would carry, beside what the folder holds.
  const x = new DatabaseSync(dbIn(dir), { readOnly: true });
  const report = folderReport({ dir, dbFile: dbIn(dir), inNetwork: referencedPhotos(x) });
  x.close();
  assert.equal(report.photos.count, 5);
  assert.equal(report.photosInCopy.count, 2);
});

test('REGRESSION: an avatars folder that is a link to somewhere else is not followed', () => {
  // SECURITY.md: links are never followed out of the data folder. That held for
  // each file, but a link standing in for avatars/ itself was read through (review R8).
  const dir = folder('linked-avatars');
  const db = seedNetwork(dir, { people: 1, tag: 'l' });
  const elsewhere = folder('elsewhere');
  writeFileSync(path.join(elsewhere, 'l0photo.webp'), 'MARKER-OUTSIDE-FOLDER');
  symlinkSync(elsewhere, path.join(dir, 'avatars'));
  assert.deepEqual(travellingFiles(dir).map((f) => f.rel), []);
  const { out } = exportOf(dir, db);
  db.close();
  assert.equal(readFileSync(out).includes('MARKER-OUTSIDE-FOLDER'), false);
  assert.deepEqual(folderReport({ dir, dbFile: dbIn(dir) }).photos, { count: 0, bytes: 0 }, 'nor counted as this folder\'s');
});

// ── the LinkedIn budget travels, and an import keeps this computer's ────────

test('REGRESSION: importing onto a computer that has scanned keeps its LinkedIn budget and its pause', () => {
  // The other computer never scanned: its copy carries no budget files. This
  // one searched 40 times today and LinkedIn pushed back. The import used to
  // move this computer's files aside, so the searches were forgotten and the
  // pause lifted without anyone choosing to (review R1).
  const other = folder('never-scanned');
  const odb = seedNetwork(other, { people: 2, tag: 'v' });
  const { out: file } = exportOf(other, odb);
  odb.close();
  assert.equal(pathsIn(file).some((p) => p.startsWith('linkedin-')), false);

  const here = folder('scanned-here');
  seedNetwork(here, { people: 3, tag: 'w' }).close();
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  writeFileSync(path.join(here, 'linkedin-activity.json'), JSON.stringify({ searches: Array.from({ length: 40 }, (_, i) => sec - 60 * i), profiles: [] }));
  writeFileSync(path.join(here, 'linkedin-cooldown.json'), JSON.stringify({ until: sec + 86400, reason: 'LinkedIn pushed back', set_at: sec }));
  writeFileSync(path.join(here, 'scan-limits.json'), JSON.stringify({ daily: 25, monthly: 100 }));

  stageImport(uploadInto(here, file), { dir: here, ...checks, replacedPeople: 3 });
  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  const after = linkedinState(here, now);
  assert.equal(after.searchesToday, 40);
  assert.ok(after.cooldown, 'still paused');
  assert.deepEqual(after.limits, { daily: 25, monthly: 100 });
  assert.deepEqual(namesIn(dbIn(here)), ['v-0', 'v-1'], 'while the network itself was replaced');
  // A copy of the budget as it was is kept with the rest, for an undo.
  assert.equal(JSON.parse(readFileSync(path.join(here, done.keptFiles, 'linkedin-activity.json'), 'utf8')).searches.length, 40);
});

test('REGRESSION: a copy whose scan limits the app never offers is refused', async () => {
  // The scanner reads a daily limit of 0 as no limit at all (review R2). The
  // menu offers 25-500 a day; anything else in a file from elsewhere is refused.
  const { sha256 } = await import('../lib/data-export.js');
  const forged = (rel, value) => tampered(goodExport(), null, (db) => {
    const bytes = Buffer.from(JSON.stringify(value));
    db.prepare('DELETE FROM sd_export_files WHERE path = ?').run(rel);
    db.prepare('INSERT INTO sd_export_files (path, bytes, sha256) VALUES (?, ?, ?)').run(rel, bytes, sha256(bytes));
    recount(db);
  });
  assert.throws(() => validateImport(forged('scan-limits.json', { daily: 0, monthly: 0 }), checks),
    refusedWith(/“scan-limits\.json” inside this file can't be used \(its daily limit \(0\) is not one Six Degrees offers\)/));
  assert.throws(() => validateImport(forged('linkedin-activity.json', { searches: ['soon'] }), checks),
    refusedWith(/“linkedin-activity\.json” inside this file can't be used/));
  assert.throws(() => validateImport(forged('linkedin-cooldown.json', { reason: 'no end' }), checks),
    refusedWith(/“linkedin-cooldown\.json” inside this file can't be used/));
  assert.equal(validateImport(forged('scan-limits.json', { daily: 500, monthly: 0 }), checks).files, 4, 'the menu\'s own choices pass');
});

// ── nothing replaced before a whole copy of it is on the disk ────────────────

test('a copy that is empty, or missing rows, is not a copy of the network', () => {
  const dir = folder('copies');
  seedNetwork(dir, { people: 4, tag: 'c' }).close();
  const whole = path.join(dir, 'whole.sqlite');
  vacuumCopy(dbIn(dir), whole);
  assert.equal(keptCopyMatches(dbIn(dir), whole), true);
  assert.equal(existsSync(`${whole}.partial`), false);

  const empty = path.join(dir, 'empty.sqlite');
  writeFileSync(empty, '');
  assert.equal(keptCopyMatches(dbIn(dir), empty), false, 'an empty file passes quick_check as an empty database');
  const short = path.join(dir, 'short.sqlite');
  copyFileSync(whole, short);
  const s = new DatabaseSync(short);
  s.exec("DELETE FROM linkedin_connections WHERE id = 'c-3'");
  s.close();
  assert.equal(keptCopyMatches(dbIn(dir), short), false);
  assert.equal(keptCopyMatches(dbIn(dir), path.join(dir, 'missing.sqlite')), false);
  assert.equal(existsSync(`${dbIn(dir)}-wal`), false, 'checking leaves nothing beside the database');
});

test('REGRESSION: a start that finds a kept copy it can\'t trust makes it again before replacing anything', () => {
  // A power cut after step 1 can leave the kept copy's name on the disk and
  // not its bytes, with the journal saying "database-kept". The next start
  // trusted it and replaced the intact original: the only copy of the old
  // network was an empty file (review R4).
  const here = folder('untrusted-copy');
  seedNetwork(here, { people: 5, tag: 'old' }).close();
  stageImport(uploadInto(here, goodExport('nu', 2)), { dir: here, ...checks });
  const stamp = '2026-09-25T12-00-00-000Z';
  mkdirSync(path.join(here, 'backups'));
  const kept = path.join(here, 'backups', `before-import-${stamp}.sqlite`);
  writeFileSync(kept, '');
  writeFileSync(path.join(here, 'import-pending', 'APPLYING'), JSON.stringify({ stamp, phase: 'database-kept' }));

  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.equal(done.keptDatabase, `backups/before-import-${stamp}.sqlite`);
  assert.deepEqual(namesIn(kept), ['old-0', 'old-1', 'old-2', 'old-3', 'old-4'], 'the old network, copied again');
  assert.deepEqual(namesIn(dbIn(here)), ['nu-0', 'nu-1']);
});

test('if no whole copy of the network here can be made, it is not replaced, and the next start tries again', () => {
  const here = folder('bad-copies');
  seedNetwork(here, { people: 3, tag: 'keep' }).close();
  stageImport(uploadInto(here, goodExport('never', 2)), { dir: here, ...checks });
  // A copy that "succeeds" but comes out empty, every time.
  const emptyCopy = (_from, to) => writeFileSync(to, '');

  assert.throws(() => applyPendingImport({ dir: here, dbFile: dbIn(here), copyDatabase: emptyCopy }), /couldn't be checked, so it wasn't replaced/);
  assert.deepEqual(namesIn(dbIn(here)), ['keep-0', 'keep-1', 'keep-2'], 'the network here is untouched');
  const waiting = pendingImport(here);
  assert.match(waiting.error, /couldn't be checked/);
  assert.equal(waiting.started, true, 'its photos have moved aside: forward is the only way now');

  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.deepEqual(namesIn(path.join(here, done.keptDatabase)), ['keep-0', 'keep-1', 'keep-2']);
  assert.deepEqual(namesIn(dbIn(here)), ['never-0', 'never-1']);
});

test('the kept copy, and each step, is on the disk before the step after it counts on it', () => {
  // A rename is atomic but not durable, and SQLite doesn't sync what VACUUM
  // INTO writes. So: the copy is synced, renamed, its folder synced, and only
  // then does the journal say "database-kept" (itself written durably). Before
  // this nothing in the apply synced at all (review R5).
  const here = hardStoppedNetwork('dur', 2);
  seedFiles(here, { tag: 'dur' });
  stageImport(uploadInto(here, goodExport('dx', 2)), { dir: here, ...checks });
  const events = [];
  const journalPhase = (data) => { try { return JSON.parse(data).phase; } catch { return '?'; } };
  const spies = [
    mock.method(durable, 'syncFile', function syncFile(file) { events.push(['file', path.basename(file)]); }),
    mock.method(durable, 'syncFolder', function syncFolder(dir) { events.push(['folder', path.basename(dir)]); }),
    mock.method(durable, 'writeFileDurably', function writeFileDurably(file, data) {
      writeFileSync(file, data);
      events.push(['journal', path.basename(file) === 'APPLYING' ? journalPhase(data) : path.basename(file)]);
    }),
    mock.method(durable, 'writeJsonDurably', function writeJsonDurably(file, value) {
      writeFileSync(file, JSON.stringify(value));
      events.push(['budget', path.basename(file)]);
    }),
  ];
  try {
    applyPendingImport({ dir: here, dbFile: dbIn(here), now: new Date('2026-09-26T09:00:00Z') });
  } finally {
    for (const spy of spies) spy.mock.restore();
  }
  const at = (...event) => events.findIndex((e) => e[0] === event[0] && e[1] === event[1]);
  const partial = 'before-import-2026-09-26T09-00-00-000Z.sqlite.partial';
  assert.ok(at('file', partial) >= 0, 'the copy is synced');
  assert.ok(at('file', partial) < at('folder', 'backups'), 'then the rename, by syncing its folder');
  assert.ok(at('folder', 'backups') < at('journal', 'database-kept'), 'then the journal');
  assert.ok(at('journal', 'start') < at('file', partial), 'every journal entry goes through the durable writer');
  assert.ok(at('journal', 'files-kept') < at('journal', 'database-placed'));
  assert.ok(at('budget', 'linkedin-activity.json') < at('journal', 'done'), 'the budget is merged before the last step is recorded');
});

test('a staged import damaged since it was staged is refused before anything moves, and can be cancelled', () => {
  const here = folder('damaged-staging');
  seedNetwork(here, { people: 2, tag: 'ds' }).close();
  stageImport(uploadInto(here, goodExport('dz', 2)), { dir: here, ...checks });
  writeFileSync(path.join(here, 'import-pending', 'data.sqlite'), '');   // what a power cut can leave
  assert.throws(() => applyPendingImport({ dir: here, dbFile: dbIn(here) }), /damaged\. Cancel the import and import the file again/);
  assert.deepEqual(namesIn(dbIn(here)), ['ds-0', 'ds-1']);
  assert.equal(existsSync(path.join(here, 'backups')), false, 'nothing kept, because nothing moved');
  assert.equal(pendingImport(here).started, false);
  assert.deepEqual(cancelPendingImport(here), { cancelled: true });
});

// ── one copy of Six Degrees at a time ────────────────────────────────────────

/** Another process with this database open, the way a second server has it: read, and kept open. */
function anotherProcess(file) {
  const src = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.prepare("INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id) VALUES ('child-1', 1, 'Invented C1', 'https://www.linkedin.com/in/invented-c1', 'p-me')").run();
    process.stdout.write('ready\\n');
    process.stdin.once('data', () => {
      db.prepare("INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id) VALUES ('child-2', 1, 'Invented C2', 'https://www.linkedin.com/in/invented-c2', 'p-me')").run();
      db.close();
      process.exit(0);
    });`;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', src], { stdio: ['pipe', 'pipe', 'inherit'] });
  const ready = new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('ready')) resolve(); });
    child.on('exit', (code) => reject(new Error(`the other process ended first (${code})`)));
  });
  const finish = () => new Promise((resolve) => { child.once('exit', resolve); child.stdin.write('go\n'); });
  return { ready, finish, kill: () => child.kill('SIGKILL') };
}

test('REGRESSION: an import doesn\'t start while another copy of Six Degrees has the network open', async () => {
  // `npm run dev` or `npx six-degrees` on the same folder while the Mac app
  // runs: the swap went ahead under the other process, whose writes then
  // landed in neither database (review R3).
  const here = folder('two-servers');
  seedNetwork(here, { people: 2, tag: 'p' }).close();
  stageImport(uploadInto(here, goodExport('q2', 2)), { dir: here, ...checks });
  const other = anotherProcess(dbIn(here));
  try {
    await other.ready;
    assert.throws(() => applyPendingImport({ dir: here, dbFile: dbIn(here) }),
      /another copy of Six Degrees has this network open .*Quit that copy, then restart this one/);
    const waiting = pendingImport(here);
    assert.match(waiting.error, /another copy of Six Degrees has this network open/);
    assert.equal(waiting.started, false, 'nothing moved: it can still be cancelled');
    assert.equal(existsSync(path.join(here, 'backups')), false);
    await other.finish();
  } finally {
    other.kill();
  }
  // Its writes went where it expected, and the next start takes them along.
  const done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.deepEqual(namesIn(path.join(here, done.keptDatabase)), ['child-1', 'child-2', 'p-0', 'p-1']);
  assert.deepEqual(namesIn(dbIn(here)), ['q2-0', 'q2-1']);
});

// ── keeping a damaged database as it is ──────────────────────────────────────

test('keeping the database as it is is recorded before anything moves, and ends the chance to cancel', () => {
  // The move can stop half-way (its -wal moved, the database not). Recorded
  // first, the next start finishes it; not recorded, the page offered Cancel
  // with the database already gone from its place (review).
  const here = folder('as-is-journal');
  writeFileSync(dbIn(here), 'not a database');
  writeFileSync(`${dbIn(here)}-wal`, 'its wal');
  stageImport(uploadInto(here, goodExport('ai', 2)), { dir: here, ...checks });
  let atDecision = null;
  const real = durable.writeFileDurably;
  const spy = mock.method(durable, 'writeFileDurably', function writeFileDurably(file, data) {
    real(file, data);
    if (!atDecision && path.basename(file) === 'APPLYING' && JSON.parse(data).keptAsIs) {
      atDecision = {
        database: existsSync(dbIn(here)),
        wal: existsSync(`${dbIn(here)}-wal`),
        started: pendingImport(here).started,
      };
    }
  });
  let done;
  try {
    done = applyPendingImport({ dir: here, dbFile: dbIn(here) });
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(atDecision, { database: true, wal: true, started: true },
    'on the disk while both files were still in place, and from then on it can\'t be cancelled');
  assert.equal(readFileSync(path.join(here, done.keptDatabase), 'utf8'), 'not a database');
  assert.equal(readFileSync(path.join(here, `${done.keptDatabase}-wal`), 'utf8'), 'its wal', 'the pair kept together');
  assert.deepEqual(namesIn(dbIn(here)), ['ai-0', 'ai-1']);
});

test('a start that stopped half-way through keeping the database as it is finishes the move', () => {
  const here = folder('as-is-resume');
  writeFileSync(dbIn(here), 'not a database');
  stageImport(uploadInto(here, goodExport('ar', 2)), { dir: here, ...checks });
  const stamp = '2026-09-27T09-00-00-000Z';
  mkdirSync(path.join(here, 'backups'));
  // The -wal went, the database didn't: what the start that died left.
  writeFileSync(path.join(here, 'backups', `before-import-${stamp}.sqlite-wal`), 'its wal');
  writeFileSync(path.join(here, 'import-pending', 'APPLYING'), JSON.stringify({ stamp, phase: 'start', keptAsIs: 'it is not a SQLite database' }));
  assert.equal(pendingImport(here).started, true, 'no Cancel once the files may have moved');

  applyPendingImport({ dir: here, dbFile: dbIn(here) });
  assert.equal(readFileSync(path.join(here, 'backups', `before-import-${stamp}.sqlite`), 'utf8'), 'not a database');
  assert.deepEqual(namesIn(dbIn(here)), ['ar-0', 'ar-1']);
});

// ── an export from before a table or column was dropped ─────────────────────

test('a name this version retired is accepted and left behind; an unknown one is still refused', () => {
  // Dropping or renaming a table or column later must not turn away the
  // exports people already have (review R9): its old name goes in RETIRED.
  const file = tampered(goodExport('rt', 2), `
    CREATE TABLE retired_table (id TEXT PRIMARY KEY);
    INSERT INTO retired_table VALUES ('x');
    ALTER TABLE linkedin_connections ADD COLUMN old_column TEXT;
    UPDATE linkedin_connections SET old_column = 'old value';
    CREATE INDEX idx_retired ON linkedin_connections (old_column);`, recount);
  assert.throws(() => validateImport(file, checks), refusedWith(/the table “retired_table”/));
  const retired = { tables: ['retired_table'], indexes: ['idx_retired'], columns: { linkedin_connections: ['old_column'] } };
  assert.equal(validateImport(file, { ...checks, retired }).people, 2);

  const here = folder('retired');
  stageImport(uploadInto(here, file), { dir: here, ...checks, retired });
  applyPendingImport({ dir: here, dbFile: dbIn(here) });
  const db = new DatabaseSync(dbIn(here), { readOnly: true });
  const names = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('retired_table', 'idx_retired')").all();
  const cols = db.prepare('PRAGMA table_info(linkedin_connections)').all().map((c) => c.name);
  db.close();
  assert.deepEqual(names, []);
  assert.equal(cols.includes('old_column'), false);
  assert.deepEqual(namesIn(dbIn(here)), ['rt-0', 'rt-1']);
});

// ── the import route, before it reads a byte ─────────────────────────────────

/** A request whose body can't be read without the test noticing. */
function fakeRequest(headers, method = 'POST') {
  const touched = { body: false };
  return {
    touched,
    request: {
      method,
      headers: new Headers(headers),
      get body() { touched.body = true; return null; },
    },
  };
}

test('the import route refuses a cross-site, rebound, ungated or oversized upload without reading it', () => {
  // middleware.js leaves this route alone so Next doesn't copy the upload into
  // memory before refusing it (a 300 MB cross-site POST grew the server by
  // ~300 MB); so the route refuses these itself, before touching the body.
  const asked = [];
  const facts = {
    env: { SIX_DEGREES_BIND: '127.0.0.1' },
    scanRunning: () => { asked.push('scan'); return false; },
    pending: () => { asked.push('pending'); return null; },
    currentPeople: () => { asked.push('people'); return 0; },
  };
  const big = String(300 * 1024 * 1024);
  const cases = [
    [{ host: '127.0.0.1:6363', 'sec-fetch-site': 'cross-site', 'x-six-degrees-size': '1000' }, facts, 403],
    [{ host: 'rebind.attacker.test:6363', 'x-six-degrees-size': '1000' }, facts, 421],
    [{ host: 'box.lan:6363', 'x-six-degrees-size': '1000' }, { ...facts, env: { SIX_DEGREES_BIND: '0.0.0.0' } }, 503],
  ];
  for (const [headers, ctx, status] of cases) {
    const { request, touched } = fakeRequest(headers);
    const out = admitImport(request, ctx);
    assert.equal(out.refused?.status, status, JSON.stringify(headers));
    assert.equal(touched.body, false, 'the body is never read');
  }
  assert.deepEqual(asked, [], 'a request the gate refuses costs nothing: not even a look at the database');

  const { request, touched } = fakeRequest({ host: '127.0.0.1:6363', 'sec-fetch-site': 'same-origin', 'x-six-degrees-size': big });
  const oversized = admitImport(request, facts);
  assert.equal(oversized.refused.status, 413);
  assert.match(oversized.refused.error, /This copy can import files up to 256 MB/);
  assert.equal(touched.body, false);
  assert.equal(MAX_IMPORT_BYTES, 256 * 1024 * 1024);

  const ok = fakeRequest({ host: '127.0.0.1:6363', 'sec-fetch-site': 'same-origin', 'x-six-degrees-size': '5000' });
  assert.deepEqual(admitImport(ok.request, facts), { declared: 5000, currentPeople: 0 });
  assert.equal(ok.touched.body, false, 'admitting it reads nothing either: receiveUpload does, onto the disk');

  const unconfirmed = fakeRequest({ host: '127.0.0.1:6363', 'x-six-degrees-size': '5000' });
  const needsYes = admitImport(unconfirmed.request, { ...facts, currentPeople: () => 12 });
  assert.deepEqual(needsYes.refused, {
    status: 409, error: 'This copy already has 12 people. Confirm that the import replaces them.', needsConfirm: true, people: 12,
  });
});

test('an upload is written to disk as it arrives and stopped as soon as it is bigger than it said', async () => {
  const dir = folder('stream');
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024).fill(1);
  // A body that would go on for ever: nothing may wait for its end.
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(chunk); } });
  await assert.rejects(receiveUpload(endless, path.join(dir, 'endless'), { declared: 200 * 1024 }),
    refusedWith(/bigger than the size it was sent with/));
  assert.ok(pulled < 10, `stopped after ${pulled} chunks`);
});
