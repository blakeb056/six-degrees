// Backups (lib/backups.js): made as .sixdegrees files with every photo, checked
// by the importer, kept by kind, and restored through the import. Each case
// pins a promise made about someone's whole network: a backup that is listed
// would restore, a damaged one says so, the rotation never takes one made by
// hand or a recent copy from before an import, and a restore only ever takes
// a name the backups folder holds. Every person here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, truncateSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../db/schema.js';
import { applySchema } from '../lib/db-client.js';
import {
  makeBackup, checkBackup, backupReport, describeBackups, rotateBackups, dailyDue, dailyBackupIfDue, newestDaily,
  findBackup, restoreBackup, restorePreflight, plainProblem, backupName, stampTime, KEEP, AUTO_BACKUP_PREFIX,
} from '../lib/backups.js';
import { applyPendingImport, pendingImport, stageImport, ImportError } from '../lib/data-import.js';
import { readSettings, writeSettings } from '../lib/settings.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'six-degrees-backups-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

const VERSION = '0.7.0';
const DAY = 24 * 3600 * 1000;
const folder = (tag) => mkdtempSync(path.join(scratch, `${tag}-`));
const dbIn = (dir) => path.join(dir, 'six-degrees.sqlite');
const backupsIn = (dir) => path.join(dir, 'backups');

/** A data folder with a network of invented people, their photos, the scanner's files and a Social file. */
function network(tag, { people = 3 } = {}) {
  const dir = folder(tag);
  const db = new DatabaseSync(dbIn(dir));
  db.exec('PRAGMA journal_mode = WAL');
  applySchema(db);
  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(`${tag}-me`, 'You');
  mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  const add = db.prepare(`INSERT INTO linkedin_connections (id, degree, name, profile_url, profile_image_url, user_id)
    VALUES (?, 1, ?, ?, ?, ?)`);
  for (let i = 0; i < people; i++) {
    add.run(`${tag}-${i}`, `Invented ${tag} ${i}`, `https://www.linkedin.com/in/invented-${tag}-${i}`, `/avatars/${tag}${i}.webp`, `${tag}-me`);
    writeFileSync(path.join(dir, 'avatars', `${tag}${i}.webp`), `RIFF-${tag}-${i}-webp`);
  }
  writeFileSync(path.join(dir, 'bridge-progress.json'), JSON.stringify({ [`${tag}-me`]: {} }));
  writeFileSync(path.join(dir, `crm-${tag}-me.json`), JSON.stringify({ notes: { x: `note from ${tag}` } }));
  return { dir, db };
}

const opts = (dir, db, extra = {}) => ({
  db, dataDir: dir, backupsDir: backupsIn(dir), appVersion: VERSION, schemaSql: SCHEMA_SQL, applySchema, ...extra,
});
const checks = { applySchema, schemaSql: SCHEMA_SQL, appVersion: VERSION };
const names = (dir) => {
  const db = new DatabaseSync(dbIn(dir), { readOnly: true });
  try { return db.prepare('SELECT name FROM linkedin_connections ORDER BY name').all().map((r) => r.name); } finally { db.close(); }
};
const listed = (dir) => describeBackups(backupsIn(dir)).map((b) => b.name);

// ── making and checking ──────────────────────────────────────────────────────

test('a backup is the whole network as a .sixdegrees file, photos and files too, and the importer passes it', () => {
  const { dir, db } = network('a', { people: 4 });
  const made = makeBackup('daily', opts(dir, db, { now: new Date('2026-10-03T14:05:09.123Z') }));
  db.close();
  assert.equal(made.name, 'daily-0.7.0-2026-10-03T14-05-09-123Z.sixdegrees');
  assert.equal(made.verified, true);
  assert.equal(made.people, 4);
  assert.equal(made.photos, 4);
  const check = checkBackup(made.file, checks);
  assert.equal(check.ok, true);
  assert.equal(check.people, 4);
  assert.equal(check.files, 1, 'the scanner file');
  // Nothing half-written beside it, hidden or not.
  assert.deepEqual(readdirSync(backupsIn(dir)), [made.name]);
});

test("REGRESSION: a backup never holds the Social tab's files, so Forget it forgets them everywhere", () => {
  const { dir, db } = network('s');
  writeFileSync(path.join(dir, 'social-s-me.json'), JSON.stringify({ people: {} }));
  writeFileSync(path.join(dir, 'social-messages-s-me.json'), JSON.stringify({ threads: { x: 'words someone wrote' } }));
  const made = makeBackup('manual', opts(dir, db));
  db.close();
  const inside = new DatabaseSync(made.file, { readOnly: true });
  const paths = inside.prepare('SELECT path FROM sd_export_files').all().map((r) => r.path);
  inside.close();
  assert.ok(paths.every((p) => !/^(social|social-messages|crm)-/.test(p)), paths.join(', '));
  assert.ok(!readFileSync(made.file).includes(Buffer.from('words someone wrote')));
});

test("a copy that fails the importer's check is never kept under a backup's name", () => {
  const { dir, db } = network('b');
  db.exec('CREATE TABLE something_else (x)');
  assert.throws(() => makeBackup('daily', opts(dir, db)), /failed its check.*something_else/);
  db.close();
  assert.deepEqual(readdirSync(backupsIn(dir)), [], 'no backup, no .partial');
});

test('only the kinds Sixgree makes', () => {
  const { dir, db } = network('k');
  assert.throws(() => makeBackup('before-import', opts(dir, db)), /no kind of backup/);
  assert.throws(() => makeBackup('../x', opts(dir, db)), /no kind of backup/);
  db.close();
});

test('REGRESSION (TRAPS §7): a damaged or cut-short backup is reported as not verified, never as verified', () => {
  const { dir, db } = network('c', { people: 3 });
  const made = makeBackup('daily', opts(dir, db, { now: new Date('2026-10-03T09:00:00Z') }));
  db.close();
  let report = backupReport(backupsIn(dir), checks);
  assert.equal(report.last.name, made.name);
  assert.equal(report.last.verified, true);
  assert.equal(report.last.people, 3);

  // Cut short, as a full disk or a stopped copy leaves a file.
  truncateSync(made.file, Math.floor(statSync(made.file).size / 2));
  report = backupReport(backupsIn(dir), checks);
  assert.equal(report.last.verified, false);
  assert.ok(report.last.problem, 'says what is wrong');
  assert.doesNotMatch(report.last.problem, /nothing was imported/, 'in words for a backup, not an import');

  // Not even SQLite.
  writeFileSync(made.file, 'not a database at all, but long enough to be read as one would be. '.repeat(3));
  report = backupReport(backupsIn(dir), checks);
  assert.equal(report.last.verified, false);
});

test('a photo changed inside a backup fails its checksum', () => {
  const { dir, db } = network('d');
  const made = makeBackup('manual', opts(dir, db));
  db.close();
  const inside = new DatabaseSync(made.file);
  inside.exec("UPDATE sd_export_files SET bytes = X'00' WHERE path LIKE 'avatars/%'");
  inside.close();
  const check = checkBackup(made.file, checks);
  assert.equal(check.ok, false);
  assert.match(check.problem, /checksum/);
});

test("a half-written backup (a stopped server's .partial) is never listed, and is swept once it is an hour old", () => {
  const { dir, db } = network('e');
  db.close();
  mkdirSync(backupsIn(dir));
  const partial = path.join(backupsIn(dir), `.${backupName('daily', VERSION, new Date('2026-10-01T00:00:00Z'))}.partial`);
  writeFileSync(partial, 'half');
  writeFileSync(`${partial}-journal`, 'half');
  assert.deepEqual(listed(dir), []);
  assert.equal(backupReport(backupsIn(dir), checks).last, null);
  rotateBackups(backupsIn(dir), { now: Date.now() });
  assert.ok(existsSync(partial), 'a fresh one may still be being written');
  rotateBackups(backupsIn(dir), { now: Date.now() + 2 * 3600 * 1000 });
  assert.ok(!existsSync(partial) && !existsSync(`${partial}-journal`));
});

test('the importer’s refusals read as a backup’s problem', () => {
  assert.equal(
    plainProblem("This file is damaged (its database fails SQLite's own check), so nothing was imported. Export it again on the other computer."),
    "This file is damaged (its database fails SQLite's own check).",
  );
  assert.equal(stampTime('daily-0.7.0-2026-10-03T14-05-09-123Z.sixdegrees'), Date.parse('2026-10-03T14:05:09.123Z'));
  assert.equal(stampTime('pre-relink-2026-09-24.sqlite'), null);
});

// ── keeping ──────────────────────────────────────────────────────────────────

/** A backups folder of named files only: the rotation goes by name and kind, never by reading them. */
function folderOf(files) {
  const dir = folder('rot');
  mkdirSync(backupsIn(dir));
  for (const f of files) {
    if (f.endsWith('/')) mkdirSync(path.join(backupsIn(dir), f), { recursive: true });
    else writeFileSync(path.join(backupsIn(dir), f), 'x');
  }
  return dir;
}
const at = (day, hour = 12) => new Date(Date.UTC(2026, 9, day, hour)).toISOString().replace(/[:.]/g, '-');

test('seven daily backups are kept, newest first', () => {
  const dir = folderOf(Array.from({ length: 9 }, (_, i) => `daily-0.7.0-${at(i + 1)}.sixdegrees`));
  const removed = rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2026, 9, 10)) });
  assert.deepEqual(removed.sort(), [`daily-0.7.0-${at(1)}.sixdegrees`, `daily-0.7.0-${at(2)}.sixdegrees`]);
  assert.equal(listed(dir).length, KEEP.daily);
});

test('three from before new versions, the database-only ones older versions made counted with them', () => {
  const dir = folderOf([
    `${AUTO_BACKUP_PREFIX}0.5.0-${at(1)}.sqlite`,
    `${AUTO_BACKUP_PREFIX}0.6.0-${at(2)}.sqlite`,
    `before-update-0.6.1-${at(3)}.sixdegrees`,
    `before-update-0.7.0-${at(4)}.sixdegrees`,
  ]);
  rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2026, 9, 5)) });
  assert.deepEqual(listed(dir).sort(), [
    `${AUTO_BACKUP_PREFIX}0.6.0-${at(2)}.sqlite`, `before-update-0.6.1-${at(3)}.sixdegrees`, `before-update-0.7.0-${at(4)}.sixdegrees`,
  ]);
});

test('three from before an import, but never one under 30 days old; each goes with its photos and its -wal', () => {
  const files = [];
  for (const day of [1, 2, 3, 4, 5]) files.push(`before-import-${at(day)}.sqlite`, `before-import-${at(day)}-files/`);
  files.push(`before-import-${at(1)}.sqlite-wal`);
  const dir = folderOf(files);
  mkdirSync(path.join(backupsIn(dir), `before-import-${at(1)}-files`, 'avatars'));
  writeFileSync(path.join(backupsIn(dir), `before-import-${at(1)}-files`, 'avatars', 'x.webp'), 'x');

  // On 10/20 every one of them is under 30 days old: all five stay.
  assert.deepEqual(rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2026, 9, 20)) }), []);
  assert.equal(listed(dir).length, 5);
  // On 11/1 the two oldest are past 30 days and beyond the newest three: they go, whole.
  rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2026, 10, 1, 13)) });
  assert.deepEqual(readdirSync(backupsIn(dir)).sort(), [3, 4, 5].flatMap((d) => [`before-import-${at(d)}-files`, `before-import-${at(d)}.sqlite`]).sort());
  // Much later, the newest three still stay.
  rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2027, 5, 1)) });
  assert.equal(listed(dir).length, KEEP['before-import']);
});

test('a backup made with Back up now, or put in the folder by hand, is never deleted', () => {
  const dir = folderOf([
    ...Array.from({ length: 12 }, (_, i) => `manual-0.7.0-${at(i + 1)}.sixdegrees`),
    'pre-relink-2026-09-24.sqlite',
    'Sixgree backup 2026-09-25.sixdegrees',
    'my notes/',
  ]);
  assert.deepEqual(rotateBackups(backupsIn(dir), { now: new Date(Date.UTC(2027, 0, 1)) }), []);
  assert.equal(listed(dir).length, 15);
});

test('one listing per backup: a database copy, its -wal and its folder of photos are one row', () => {
  const dir = folderOf([`before-import-${at(1)}.sqlite`, `before-import-${at(1)}.sqlite-wal`, `before-import-${at(1)}-files/`, 'loose-files/']);
  const rows = describeBackups(backupsIn(dir));
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.format, r.restorable]).sort(), [
    [`before-import-${at(1)}.sqlite`, 'before-import', 'database', true],
    ['loose-files', 'manual', null, false],
  ]);
  assert.equal(rows.find((r) => r.kind === 'before-import').withFiles, `before-import-${at(1)}-files`);
});

// ── once a day ───────────────────────────────────────────────────────────────

test('a daily backup is due when there is none, or the newest is a day old (or a day ahead: the clock was changed)', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  assert.equal(dailyDue(null, now), true);
  assert.equal(dailyDue(now - 23 * 3600 * 1000, now), false);
  assert.equal(dailyDue(now - DAY, now), true);
  assert.equal(dailyDue(now + 2 * 3600 * 1000, now), false);
  assert.equal(dailyDue(now + 2 * DAY, now), true);
});

test('the daily backup is made at most once a day, and never of an empty network', () => {
  const { dir, db } = network('f');
  const first = new Date('2026-10-03T08:00:00Z');
  assert.ok(dailyBackupIfDue(opts(dir, db, { now: first })));
  assert.equal(newestDaily(backupsIn(dir)), first.getTime());
  assert.equal(dailyBackupIfDue(opts(dir, db, { now: new Date('2026-10-03T20:00:00Z') })), null, 'twelve hours later: not again');
  assert.ok(dailyBackupIfDue(opts(dir, db, { now: new Date('2026-10-04T08:00:00Z') })), 'a day later: again');
  db.close();

  const empty = folder('empty');
  const edb = new DatabaseSync(dbIn(empty));
  applySchema(edb);
  assert.equal(dailyBackupIfDue(opts(empty, edb)), null);
  edb.close();
  assert.ok(!existsSync(backupsIn(empty)) || readdirSync(backupsIn(empty)).length === 0);
});

// ── restoring ────────────────────────────────────────────────────────────────

test('REGRESSION: a restore only takes a name the backups folder lists; a path, "..", or anything else is refused and nothing is staged', () => {
  const { dir, db } = network('g');
  const made = makeBackup('manual', opts(dir, db));
  db.close();
  mkdirSync(path.join(backupsIn(dir), 'some-folder'));
  writeFileSync(path.join(dir, 'elsewhere.sixdegrees'), readFileSync(made.file));
  const refused = [
    '', '.', '..', '../six-degrees.sqlite', '../elsewhere.sixdegrees', made.file, `./${made.name}`, `${made.name}/`,
    `backups/${made.name}`, '..\\six-degrees.sqlite', 'some-folder', 'nothing-here.sixdegrees', `${made.name}\0`,
    null, 42, { name: made.name },
  ];
  for (const name of refused) {
    assert.equal(findBackup(backupsIn(dir), name), null, String(name));
    assert.throws(
      () => restoreBackup(name, { dir, backupsDir: backupsIn(dir), ...checks }),
      (err) => err instanceof ImportError && err.status === 404,
      String(name),
    );
  }
  assert.equal(pendingImport(dir), null, 'nothing staged');
  assert.ok(findBackup(backupsIn(dir), made.name));
  assert.ok(findBackup(backupsIn(dir), 'some-folder', { restorable: false }), 'Show in Finder can show any listed backup');
});

test('a restore asks first: not while a scan runs, not with an import waiting, and only for the count agreed to', () => {
  assert.equal(restorePreflight({ scanRunning: 'full', currentPeople: 3, confirmedPeople: 3 }).status, 409);
  assert.match(restorePreflight({ scanRunning: 'install' }).message, /being installed/);
  assert.equal(restorePreflight({ pending: { people: 2 } }).status, 409);
  const ask = restorePreflight({ currentPeople: 5, confirmedPeople: 4 });
  assert.equal(ask.extra.needsConfirm, true);
  assert.equal(ask.extra.people, 5);
  assert.equal(restorePreflight({ currentPeople: 5, confirmedPeople: 5 }), null);
  assert.equal(restorePreflight({ currentPeople: 0 }), null);
});

test('restoring a backup puts its network, photos and files back at the next start, and keeps what was there to undo it', () => {
  const { dir, db } = network('h', { people: 2 });
  const made = makeBackup('daily', opts(dir, db, { now: new Date('2026-10-02T08:00:00Z') }));
  // The network changes after the backup: someone new, a photo gone.
  db.prepare(`INSERT INTO linkedin_connections (id, degree, name, profile_url, user_id)
    VALUES ('late', 1, 'Invented Latecomer', 'https://www.linkedin.com/in/invented-late', 'h-me')`).run();
  db.close();
  rmSync(path.join(dir, 'avatars', 'h0.webp'));
  writeFileSync(path.join(dir, 'crm-h-me.json'), JSON.stringify({ notes: { x: 'changed since' } }));

  const ready = restoreBackup(made.name, { dir, backupsDir: backupsIn(dir), ...checks, replacedPeople: 3 });
  assert.equal(ready.restoredFrom, made.name);
  assert.equal(ready.people, 2);
  assert.equal(pendingImport(dir).restoredFrom, made.name);
  assert.ok(existsSync(made.file), 'the backup itself is untouched');

  const done = applyPendingImport({ dir, dbFile: dbIn(dir) });
  assert.equal(done.restoredFrom, made.name);
  assert.deepEqual(names(dir), ['Invented h 0', 'Invented h 1']);
  assert.ok(existsSync(path.join(dir, 'avatars', 'h0.webp')), 'the photo is back');
  // The Social tab's files aren't in a backup, so a restore leaves this computer's where they are.
  assert.match(readFileSync(path.join(dir, 'crm-h-me.json'), 'utf8'), /changed since/);
  // What was there is kept, and listed, so the restore can be undone the same way.
  const kept = describeBackups(backupsIn(dir)).find((b) => b.kind === 'before-import');
  assert.ok(kept?.restorable && kept.withFiles);
});

test('a copy kept before an import is restored with its own photos and files (Undo an import)', () => {
  const { dir, db } = network('i', { people: 2 });
  db.close();
  // An import replaces the network: what was here goes to backups/before-import-….
  const other = network('j', { people: 1 });
  const theirs = makeBackup('manual', opts(other.dir, other.db));
  other.db.close();
  restoreUpload(dir, theirs.file);
  applyPendingImport({ dir, dbFile: dbIn(dir) });
  assert.deepEqual(names(dir), ['Invented j 0']);

  const kept = describeBackups(backupsIn(dir)).find((b) => b.kind === 'before-import');
  restoreBackup(kept.name, { dir, backupsDir: backupsIn(dir), ...checks, replacedPeople: 1 });
  applyPendingImport({ dir, dbFile: dbIn(dir) });
  assert.deepEqual(names(dir), ['Invented i 0', 'Invented i 1']);
  assert.ok(existsSync(path.join(dir, 'avatars', 'i0.webp')), 'its photos came back from the folder kept beside it');
  assert.ok(!existsSync(path.join(dir, 'avatars', 'j0.webp')), "the import's photos went aside with it");
});

/** Stage a .sixdegrees file the way the import route does: from its own working folder. */
function restoreUpload(dir, file) {
  const work = mkdtempSync(path.join(dir, '.import-upload-'));
  const upload = path.join(work, 'upload.sixdegrees');
  writeFileSync(upload, readFileSync(file));
  return stageImport(upload, { dir, ...checks });
}

test('a database-only copy from before backups had photos restores with the photos here now', () => {
  const { dir, db } = network('m', { people: 2 });
  mkdirSync(backupsIn(dir));
  const old = path.join(backupsIn(dir), `${AUTO_BACKUP_PREFIX}0.6.0-${at(1)}.sqlite`);
  db.exec(`VACUUM INTO '${old}'`);
  db.prepare("DELETE FROM linkedin_connections WHERE id = 'm-1'").run();
  db.close();
  const before = readdirSync(backupsIn(dir)).sort();
  restoreBackup(path.basename(old), { dir, backupsDir: backupsIn(dir), ...checks, replacedPeople: 1 });
  assert.deepEqual(readdirSync(backupsIn(dir)).sort(), before, 'nothing written into backups/ by a restore');
  applyPendingImport({ dir, dbFile: dbIn(dir) });
  assert.deepEqual(names(dir), ['Invented m 0', 'Invented m 1']);
  assert.ok(existsSync(path.join(dir, 'avatars', 'm1.webp')));
});

test('a backup that fails its check is refused by the restore, with nothing staged', () => {
  const { dir, db } = network('n');
  const made = makeBackup('manual', opts(dir, db));
  db.close();
  truncateSync(made.file, 4096);
  assert.throws(
    () => restoreBackup(made.name, { dir, backupsDir: backupsIn(dir), ...checks }),
    (err) => err instanceof ImportError && /backup/i.test(err.message) && !/nothing was imported/.test(err.message),
  );
  assert.equal(pendingImport(dir), null);
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('.import-upload-')), [], 'its working folder is gone');
});

// ── the look and the Galaxy's layouts travel with it ─────────────────────────

test('the look and the saved Galaxy layouts are kept with the network, so a backup carries them back', () => {
  const { dir, db } = network('t', { people: 1 });
  assert.equal(readSettings(db).theme, null, 'never chosen on this network');
  assert.equal(readSettings(db).galaxyLayouts, null);
  writeSettings(db, {
    theme: { base: 'glass', custom: { accent: '#00e5ff', bogus: 'dropped' } },
    galaxyLayouts: [{ name: '  Wide  ', settings: { push: 30, sizeBy: 'links', branch: true, evil: '<script>' } }],
  });
  assert.deepEqual(readSettings(db).theme, { base: 'glass', custom: { accent: '#00e5ff' } });
  assert.deepEqual(readSettings(db).galaxyLayouts, [{ name: 'Wide', settings: { push: 30, sizeBy: 'links', branch: true } }]);
  assert.throws(() => writeSettings(db, { theme: 'glass' }), /preset/);
  assert.throws(() => writeSettings(db, { galaxyLayouts: { name: 'x' } }), /list/);

  const made = makeBackup('manual', opts(dir, db));
  writeSettings(db, { theme: { base: 'daylight', custom: {} }, galaxyLayouts: [] });
  db.close();
  restoreBackup(made.name, { dir, backupsDir: backupsIn(dir), ...checks, replacedPeople: 1 });
  applyPendingImport({ dir, dbFile: dbIn(dir) });
  const back = new DatabaseSync(dbIn(dir));
  assert.equal(readSettings(back).theme.base, 'glass');
  assert.equal(readSettings(back).galaxyLayouts[0].name, 'Wide');
  back.close();
});

test('a backup is shown selected in Finder; elsewhere its folder opens', async () => {
  const calls = [];
  const spawnImpl = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { on: (event, f) => { if (event === 'exit') setImmediate(() => f(0)); }, unref() {} };
  };
  const { revealFolder } = await import('../lib/data-folder.js');
  const file = path.join('/data/backups', 'daily-0.7.0-x.sixdegrees');
  assert.deepEqual(await revealFolder('/data/backups', { platform: 'darwin', spawnImpl, select: file }), { ok: true });
  assert.deepEqual(await revealFolder('/data/backups', { platform: 'linux', spawnImpl, select: file }), { ok: true });
  assert.deepEqual(await revealFolder('/data', { platform: 'darwin', spawnImpl }), { ok: true });
  assert.deepEqual(calls, [
    ['open', '-R', file],
    ['xdg-open', '/data/backups'],
    ['open', '/data'],
  ]);
});
